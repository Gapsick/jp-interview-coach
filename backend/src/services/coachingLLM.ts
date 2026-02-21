/**
 * LLM 코칭 피드백 생성 서비스
 *
 * 두 가지 모드:
 * 1. reference 모드: 원문 텍스트가 있을 때 → 단어별 비교(wordDiff) + 발음 피드백
 * 2. free 모드: 원문 없을 때 → 발음 수치 기반 피드백만 (내용 피드백 금지)
 *
 * API 키가 없거나 Mock 모드이면 기본값을 반환
 */
import OpenAI from 'openai';
import { config } from '../config.js';
import type { RuleIssue, PronunciationAnalysis } from './sessionStore.js';
import type { ISessionHistoryItem } from '../models/Session.js';

// OpenAI 클라이언트 (API 키가 있고 Mock 모드가 아닐 때만 생성)
let openai: OpenAI | null = null;
if (config.openaiApiKey && !config.useMockLlm) {
  openai = new OpenAI({ apiKey: config.openaiApiKey });
}

// ===== 타입 정의 =====

/**
 * 원문-STT 단어별 비교 항목
 * reference 모드에서만 채워짐
 */
export type WordDiffItem = {
  ref: string;    // 원문 단어/구절
  heard: string;  // STT가 인식한 내용 (missing이면 빈 문자열)
  status: 'correct' | 'wrong' | 'missing';
};

/** LLM이 생성한 발음 분석 (Whisper 수치 기반) */
export type PronunciationAnalysisLLM = {
  wpm: number;
  evaluation: string;   // "good" | "fast" | "slow" 등
  evidence: string;     // 수치를 기반으로 한 근거 설명 (한국어)
  tips: string[];       // 발음 팁 목록 (한국어)
};

/** LLM이 생성한 전체 코칭 피드백 타입 */
export type CoachingFeedback = {
  // UI 리스트용
  topIssues: string[];
  pronunciationTips: string[];
  practiceSentences: string[];

  // 종합 점수
  overallScore: number;

  // 발음 분석 (LLM 해석)
  pronunciationAnalysis: PronunciationAnalysisLLM;

  // 원문 비교 (reference 모드에서만 채워짐, free 모드는 빈 배열)
  wordDiff: WordDiffItem[];

  // 과거 이력 트렌드 메모 (있을 때만)
  historyNote: string;
};

// ===== 헬퍼 함수 =====

/**
 * 발음 분석 데이터를 프롬프트용 객체로 변환
 * words[] 배열은 토큰 낭비이므로 제외하고 핵심 수치만 전달
 */
function buildPronunciationForPrompt(pronunciation: PronunciationAnalysis): object {
  return {
    overallScore: pronunciation.overallScore,
    wpm: pronunciation.speakingSpeed.wpm,
    speedRating: pronunciation.speakingSpeed.rating,
    totalDuration: pronunciation.totalDuration,
    wordCount: pronunciation.wordCount,
    pauses: pronunciation.pauses.map(p => ({
      afterWord: p.afterWord,
      beforeWord: p.beforeWord,
      duration: p.duration,
    })),
    unclearSegments: pronunciation.unclearSegments,
  };
}

/**
 * 과거 히스토리를 프롬프트용 배열로 변환 (최근 3건, 핵심만)
 */
function buildHistoryForPrompt(history: ISessionHistoryItem[], maxItems = 3): object[] {
  if (!history || history.length === 0) return [];
  return history.slice(-maxItems).map(item => ({
    at: item.at,
    transcript: item.transcript.slice(0, 80),
    issues: item.issues?.map(i => i.id) ?? [],
    topIssues: item.topIssues?.slice(0, 2) ?? [],
  }));
}

// ===== 시스템 프롬프트 =====

/**
 * reference 모드: 원문 텍스트가 있을 때 사용
 * 형태소 단위로 분할하여 정확히 어떤 단어/조사가 틀렸는지 검출
 */
const REFERENCE_SYSTEM_PROMPT = `You are a Japanese pronunciation reading coach.
The user read a Japanese text aloud. Compare the reference text with the Whisper STT output.

Inputs:
- referenceText: original Japanese text the user should have read
- transcript: what Whisper recognized (Whisper auto-corrects mispronunciations to phonetically-similar valid Japanese words)
- pronunciation: Whisper metrics (WPM, pauses, unclear segments, overallScore)
- previousHistory: past session results (may be empty)

=== GRANULARITY RULES (MOST CRITICAL) ===
You MUST split the referenceText into the SMALLEST possible meaningful units.
- Japanese particles (が, は, を, で, に, の, と, から, まで, へ, や, も, ね, よ) → EACH is its own unit
- Individual words: 1–6 characters each
- NEVER put an entire sentence or clause as one unit
- If part of a phrase is correct and part is wrong, split them into separate units
- Punctuation (。、「」) attach to the preceding word

Splitting example:
  "銀メダルを獲得しました" → ["銀メダル","を","獲得","しました"]
  "コルティナオリンピックのニュースです" → ["コルティナ","オリンピック","の","ニュース","です"]
  "女子シングルで" → ["女子","シングル","で"]
  "2人の日本選手がメダルを取るのは初めてです" → ["2人","の","日本選手","が","メダル","を","取る","の","は","初めて","です"]

Target: 15–50 units per input (the more fine-grained, the better).

=== COMPARISON RULES ===
- Whisper auto-corrects mispronunciations: e.g., コルティナ mispronounced → フォルティナ; 銀 mispronounced → 金
- These substitutions in the transcript = mispronunciations → mark as "wrong"
- If a ref unit is completely absent from the transcript → "missing"
- If the ref unit appears correctly in the transcript → "correct"

Your job:
1. Split referenceText into fine-grained units using the rules above
2. For each unit, find it in the transcript and classify: correct / wrong / missing
3. Give pronunciation coaching based on the detected errors and Whisper metrics

Hard rules:
- Do NOT give content-based advice — this is reading practice
- Focus ONLY on pronunciation accuracy, fluency, speed, clarity
- Output MUST be valid JSON ONLY. No markdown. No extra text.
- All feedback text must be in Korean

Return JSON in EXACT format:
{
  "overallScore": 0-100,
  "wordDiff": [
    { "ref": "individual morpheme/word", "heard": "what STT shows (empty string if missing)", "status": "correct|wrong|missing" }
  ],
  "pronunciationAnalysis": {
    "wpm": number,
    "evaluation": "good|fast|slow|too_fast|too_slow",
    "evidence": "Korean: specific explanation using the metrics (WPM value, number of pauses, unclear segments)",
    "tips": ["Korean tip 1", "Korean tip 2", "Korean tip 3"]
  },
  "summary": {
    "topIssues": ["Korean: specific mispronounced word + why, e.g., 「コルティナ」를 「フォルティナ」로 발음함"],
    "pronunciationTips": ["Korean tip 1", "Korean tip 2"],
    "practiceSentences": ["Japanese practice sentence 1", "Japanese practice sentence 2"]
  },
  "historyNote": "Korean: 1-2 trend observations if previousHistory exists, else empty string"
}`;

/**
 * free 모드: 원문 없을 때 사용
 * 내용 평가 없이 발음 수치만으로 피드백 생성
 */
const FREE_SYSTEM_PROMPT = `You are a Japanese pronunciation coach for speaking practice.
The user spoke Japanese freely. Analyze pronunciation using ONLY the provided acoustic metrics.

Inputs:
- transcript: Whisper STT output (may be auto-corrected; do NOT evaluate content)
- pronunciation: Whisper metrics (WPM, pauses, unclear segments, overallScore)
- previousHistory: past session results (may be empty)

Hard rules:
- Do NOT give content-based advice ("be more specific", "add details") — you cannot evaluate content without a reference text
- Focus ONLY on: speaking speed, fluency, natural pausing, and clarity from metrics
- Speed guidance: 130–160 WPM is good for Japanese interviews; >170 is too fast; <80 is too slow
- Output MUST be valid JSON ONLY. No markdown. No extra text.
- All feedback text must be in Korean

Return JSON in EXACT format:
{
  "overallScore": 0-100,
  "wordDiff": [],
  "pronunciationAnalysis": {
    "wpm": number,
    "evaluation": "good|fast|slow|too_fast|too_slow",
    "evidence": "Korean: explanation using the provided metrics",
    "tips": ["Korean tip 1", "Korean tip 2", "Korean tip 3"]
  },
  "summary": {
    "topIssues": ["Korean issue 1", "Korean issue 2", "Korean issue 3"],
    "pronunciationTips": ["Korean tip 1", "Korean tip 2", "Korean tip 3"],
    "practiceSentences": ["Japanese practice sentence 1", "Japanese practice sentence 2"]
  },
  "historyNote": "Korean: 1-2 trend observations if previousHistory exists, else empty string"
}`;

/**
 * LLM을 사용하여 코칭 피드백 생성
 *
 * @param transcript - STT로 인식된 발화 텍스트
 * @param ruleIssues - 규칙 기반 분석에서 검출된 이슈 목록
 * @param pronunciation - Whisper 기반 발음 분석 결과
 * @param history - 과거 분석 이력
 * @param referenceText - 원문 텍스트 (있으면 reference 모드, 없으면 free 모드)
 * @returns CoachingFeedback - 코칭 피드백
 */
export async function generateCoachingFeedback(
  transcript: string,
  ruleIssues: RuleIssue[],
  pronunciation?: PronunciationAnalysis,
  history?: ISessionHistoryItem[],
  referenceText?: string,
): Promise<CoachingFeedback> {
  const empty: CoachingFeedback = {
    topIssues: [],
    pronunciationTips: [],
    practiceSentences: [],
    overallScore: 0,
    pronunciationAnalysis: { wpm: 0, evaluation: '', evidence: '', tips: [] },
    wordDiff: [],
    historyNote: '',
  };

  // Mock 모드이거나 API 클라이언트가 없으면 기본값 반환
  if (config.useMockLlm || !openai) return empty;

  // 프롬프트 입력값 준비
  const pronunciationJson = pronunciation
    ? JSON.stringify(buildPronunciationForPrompt(pronunciation), null, 2)
    : JSON.stringify({});
  const historyJson = JSON.stringify(
    history ? buildHistoryForPrompt(history) : [],
    null,
    2
  );

  const ruleIssuesJson = JSON.stringify(ruleIssues, null, 2);

  // 모드에 따라 시스템 프롬프트 + 유저 프롬프트 선택
  const systemPrompt = referenceText ? REFERENCE_SYSTEM_PROMPT : FREE_SYSTEM_PROMPT;

  const userPrompt = referenceText
    ? `referenceText:\n${referenceText}\n\ntranscript (STT):\n${transcript}\n\nrule_issues (JSON):\n${ruleIssuesJson}\n\npronunciation (JSON):\n${pronunciationJson}\n\npreviousHistory (JSON):\n${historyJson}`
    : `transcript (STT):\n${transcript}\n\nrule_issues (JSON):\n${ruleIssuesJson}\n\npronunciation (JSON):\n${pronunciationJson}\n\npreviousHistory (JSON):\n${historyJson}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' }, // JSON 모드 강제 (파싱 실패 방지)
  });

  const content = response.choices?.[0]?.message?.content?.trim() || '{}';

  try {
    const parsed = JSON.parse(content) as any;
    const summary = parsed.summary ?? {};

    return {
      topIssues: Array.isArray(summary.topIssues) ? summary.topIssues : [],
      pronunciationTips: Array.isArray(summary.pronunciationTips) ? summary.pronunciationTips : [],
      practiceSentences: Array.isArray(summary.practiceSentences) ? summary.practiceSentences : [],
      overallScore: typeof parsed.overallScore === 'number' ? parsed.overallScore : 0,
      pronunciationAnalysis: {
        wpm: parsed.pronunciationAnalysis?.wpm ?? 0,
        evaluation: parsed.pronunciationAnalysis?.evaluation ?? '',
        evidence: parsed.pronunciationAnalysis?.evidence ?? '',
        tips: Array.isArray(parsed.pronunciationAnalysis?.tips) ? parsed.pronunciationAnalysis.tips : [],
      },
      wordDiff: Array.isArray(parsed.wordDiff) ? parsed.wordDiff : [],
      historyNote: typeof parsed.historyNote === 'string' ? parsed.historyNote : '',
    };
  } catch {
    return empty;
  }
}
