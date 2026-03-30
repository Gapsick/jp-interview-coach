/**
 * LLM 코칭 피드백 생성 서비스
 *
 * 두 가지 모드:
 * 1. reference 모드: 원문 텍스트가 있을 때 → 알고리즘 diff 결과(WordDiff[])를 받아 발음 피드백
 * 2. free 모드: 원문 없을 때 → 발음 수치 기반 피드백만 (내용 피드백 금지)
 *
 * 중요: wordDiff는 LLM이 생성하지 않고, textDiff.ts의 알고리즘이 생성한 결과를 입력으로 받음
 * → LLM은 코칭 피드백만 담당 (더 정확하고 일관된 비교 결과를 위해)
 *
 * API 키가 없거나 Mock 모드이면 기본값을 반환
 */
import OpenAI from 'openai';
import { config } from '../config.js';
import type { RuleIssue, PronunciationAnalysis } from './sessionStore.js';
import type { ISessionHistoryItem } from '../models/Session.js';
import type { WordDiff } from './textDiff.js';

// WordDiff를 re-export (다른 파일에서 import할 수 있도록)
export type { WordDiff };

// OpenAI 클라이언트 (API 키가 있고 Mock 모드가 아닐 때만 생성)
let openai: OpenAI | null = null;
if (config.openaiApiKey && !config.useMockLlm) {
  openai = new OpenAI({ apiKey: config.openaiApiKey });
}

// ===== 타입 정의 =====

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
  trainingRoutine: string[];   // 3분 훈련 루틴 (단계별 반복 지시 포함)

  // 종합 점수
  overallScore: number;

  // 발음 분석 (LLM 해석)
  pronunciationAnalysis: PronunciationAnalysisLLM;

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

/**
 * wordDiff를 프롬프트용으로 요약
 * - equal 항목은 제외 (틀린 것만 전달하여 토큰 절약)
 * - severity high/medium 항목만 topIssues로 강조
 */
function buildWordDiffForPrompt(wordDiff: WordDiff[]): object {
  const errors = wordDiff.filter(d => d.kind !== 'equal');
  const highSeverity = errors.filter(d => d.severity === 'high' || d.severity === 'medium');

  return {
    totalTokens: wordDiff.length,
    errorCount: errors.length,
    highSeverityErrors: highSeverity.map(d => ({
      ref: d.ref,
      hyp: d.hyp,
      kind: d.kind,
      severity: d.severity,
      reason: d.reason,
    })),
  };
}

// ===== 시스템 프롬프트 =====

/**
 * reference 모드: 원문 텍스트가 있을 때 사용
 * 알고리즘이 이미 diff를 계산했으므로, LLM은 결과를 해석하여 코칭만 제공
 */
const REFERENCE_SYSTEM_PROMPT = `You are a Japanese pronunciation reading coach.
The user read a Japanese text aloud. An algorithm has already compared the reference text with the Whisper STT output and produced a word-level diff.

Inputs:
- referenceText: original Japanese text the user should have read
- transcript: what Whisper recognized
- wordDiffSummary: algorithm-computed diff result (errors only, equal tokens excluded)
  - kind: "replace" (said differently), "delete" (skipped), "insert" (added extra)
  - severity: "high" (meaning changed), "medium" (minor error), "low" (same pronunciation, different script)
  - reason: "meaning_change", "orthography" (same pronunciation, different kanji), "unknown"
- pronunciation: Whisper metrics (WPM, pauses, unclear segments, overallScore)
- previousHistory: past session results (may be empty)

Your job:
- Interpret the diff errors and give pronunciation coaching
- For "orthography" reason errors: mention they are same pronunciation, different kanji — NOT a pronunciation error
- For "meaning_change" errors: these are actual mispronunciations — design targeted drills
- Design a 3-minute training routine based on the top 1-2 errors found in the diff
- Routine format: header line (🎯 today's focus) + 3 numbered drill steps with repetition count and speed instruction

Hard rules:
- Do NOT give content-based advice — this is reading practice
- Do NOT re-do the diff — trust the algorithm's result
- Output MUST be valid JSON ONLY. No markdown. No extra text.
- All feedback text must be in Korean

Return JSON in EXACT format:
{
  "overallScore": 0-100,
  "pronunciationAnalysis": {
    "wpm": number,
    "evaluation": "good|fast|slow|too_fast|too_slow",
    "evidence": "발음 수치를 근거로 한 설명",
    "tips": ["팁 1", "팁 2", "팁 3"]
  },
  "summary": {
    "topIssues": ["잘못 발음한 단어 + 이유"],
    "pronunciationTips": ["팁 1", "팁 2"],
    "trainingRoutine": [
      "🎯 오늘의 집중: [top diff error — specific phoneme or word]",
      "1️⃣ [ref word] / [hyp word] 교차 10회 (70% 속도)",
      "2️⃣ 「[ref word in context phrase]」 5회",
      "3️⃣ 문장 전체를 자연스러운 속도로 3회"
    ]
  },
  "historyNote": "이전 세션과의 트렌드 관찰 (없으면 빈 문자열)"
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
  "pronunciationAnalysis": {
    "wpm": number,
    "evaluation": "good|fast|slow|too_fast|too_slow",
    "evidence": "발음 수치를 근거로 한 설명",
    "tips": ["팁 1", "팁 2", "팁 3"]
  },
  "summary": {
    "topIssues": ["이슈 1", "이슈 2", "이슈 3"],
    "pronunciationTips": ["팁 1", "팁 2", "팁 3"],
    "trainingRoutine": [
      "🎯 오늘의 집중: [top acoustic issue e.g. 말하기 속도 / 긴 쉼]",
      "1️⃣ [specific drill targeting the issue] N회",
      "2️⃣ [next drill step] N회",
      "3️⃣ [full sentence/passage practice] N회 - [speed/pause instruction]"
    ]
  },
  "historyNote": "이전 세션과의 트렌드 관찰 (없으면 빈 문자열)"
}`;

/**
 * LLM을 사용하여 코칭 피드백 생성
 *
 * @param transcript - STT로 인식된 발화 텍스트
 * @param ruleIssues - 규칙 기반 분석에서 검출된 이슈 목록
 * @param pronunciation - Whisper 기반 발음 분석 결과
 * @param history - 과거 분석 이력
 * @param referenceText - 원문 텍스트 (있으면 reference 모드, 없으면 free 모드)
 * @param wordDiff - 알고리즘이 계산한 diff 결과 (reference 모드에서만 전달)
 * @returns CoachingFeedback - 코칭 피드백
 */
export async function generateCoachingFeedback(
  transcript: string,
  ruleIssues: RuleIssue[],
  pronunciation?: PronunciationAnalysis,
  history?: ISessionHistoryItem[],
  referenceText?: string,
  wordDiff?: WordDiff[],
): Promise<CoachingFeedback> {
  const empty: CoachingFeedback = {
    topIssues: [],
    pronunciationTips: [],
    trainingRoutine: [],
    overallScore: 0,
    pronunciationAnalysis: { wpm: 0, evaluation: '', evidence: '', tips: [] },
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

  let userPrompt: string;
  if (referenceText && wordDiff) {
    // reference 모드: 알고리즘 diff 결과를 요약해서 전달
    const wordDiffSummaryJson = JSON.stringify(buildWordDiffForPrompt(wordDiff), null, 2);
    userPrompt =
      `referenceText:\n${referenceText}\n\n` +
      `transcript (STT):\n${transcript}\n\n` +
      `wordDiffSummary (algorithm-computed):\n${wordDiffSummaryJson}\n\n` +
      `rule_issues (JSON):\n${ruleIssuesJson}\n\n` +
      `pronunciation (JSON):\n${pronunciationJson}\n\n` +
      `previousHistory (JSON):\n${historyJson}`;
  } else {
    // free 모드
    userPrompt =
      `transcript (STT):\n${transcript}\n\n` +
      `rule_issues (JSON):\n${ruleIssuesJson}\n\n` +
      `pronunciation (JSON):\n${pronunciationJson}\n\n` +
      `previousHistory (JSON):\n${historyJson}`;
  }

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
      trainingRoutine: Array.isArray(summary.trainingRoutine) ? summary.trainingRoutine : [],
      overallScore: typeof parsed.overallScore === 'number' ? parsed.overallScore : 0,
      pronunciationAnalysis: {
        wpm: parsed.pronunciationAnalysis?.wpm ?? 0,
        evaluation: parsed.pronunciationAnalysis?.evaluation ?? '',
        evidence: parsed.pronunciationAnalysis?.evidence ?? '',
        tips: Array.isArray(parsed.pronunciationAnalysis?.tips) ? parsed.pronunciationAnalysis.tips : [],
      },
      historyNote: typeof parsed.historyNote === 'string' ? parsed.historyNote : '',
    };
  } catch {
    return empty;
  }
}
