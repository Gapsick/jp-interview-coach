/**
 * 규칙 기반 발화 분석기 + 발음 분석
 *
 * 이 파일이 하는 일:
 * 1. 일본어 면접 발화(transcript)를 정규식 규칙으로 분석
 *    - 필러 사용, 긴 침묵, 짧은 답변, 표현 반복 등의 이슈를 검출
 * 2. Whisper 단어 타임스탬프를 분석하여 발음 품질 평가
 *    - 말하기 속도(WPM), 쉼 패턴, 불명확 발음 구간 감지
 *    - 종합 발음 점수(0~100) 산출
 *
 * 이 결과는 이후 LLM(coachingLLM.ts)에 전달되어 더 상세한 코칭 피드백 생성에 활용됨
 */
import type { RuleIssue, WordTimestamp, PronunciationAnalysis } from './sessionStore.js';
import type { WhisperSegment } from './transcription.js';

// 규칙 하나의 타입 정의
type Rule = {
  id: RuleIssue['id'];           // 규칙 식별자 (예: 'filler')
  name: string;                  // 규칙 이름 (한국어 설명)
  severity: RuleIssue['severity']; // 심각도: 'high' | 'medium' | 'low'
  pattern?: RegExp;              // 검출용 정규식 (있을 때만 패턴 매칭)
  minLength?: number;            // 최소 길이 조건 (답변이 이보다 짧으면 이슈)
};

// 검출 규칙 목록: 실제 발화에서 확인 가능한 패턴만 정의
const RULES: Rule[] = [
  {
    // 필러 검출: "えーと", "あのう", "まあ", "なんか" 뒤에 구두점이 오는 패턴
    id: 'filler',
    name: '필러 사용 (えーと, あのう 등)',
    pattern: /(えーと|あのう|まあ|なんか)(\s|、|。)/g,
    severity: 'medium',
  },
  {
    // 긴 침묵/끊김 검출: "...", "…", 연속 전각 공백 등
    id: 'long_pause',
    name: '긴 침묵/끊김',
    pattern: /(\.\.\.|…|　{2,})/g,
    severity: 'medium',
  },
  {
    // 짧은 답변 검출: 전체 텍스트가 30자 미만이면 경고
    id: 'short_answer',
    name: '답변이 너무 짧음',
    minLength: 30,
    severity: 'low',
  },
  {
    // 같은 표현 반복 검출: 같은 2~8자 표현이 조사(が/は/を)를 사이에 두고 반복되는 패턴
    id: 'repetition',
    name: '같은 표현 반복',
    pattern: /(.{2,8})\s*(が|は|を)\s*\1/g,
    severity: 'medium',
  },
];

/**
 * 발화 텍스트를 규칙 기반으로 분석하여 이슈 목록을 반환
 *
 * @param transcript - 분석할 텍스트 (STT 결과)
 * @returns issues: 검출된 이슈 배열 (심각도 순 정렬), meta: 분석 메타데이터
 */
export function analyzeTranscript(transcript: string): { issues: RuleIssue[]; meta: { totalRules: number; transcriptLength: number } } {
  const issues: RuleIssue[] = [];
  const trimmed = (transcript || '').trim();

  // 각 규칙을 순회하며 텍스트에 매칭되는지 확인
  for (const rule of RULES) {
    // 정규식 패턴이 있는 규칙: 매칭되면 이슈로 추가
    if (rule.pattern) {
      const matches = trimmed.match(rule.pattern);
      if (matches && matches.length > 0) {
        issues.push({
          id: rule.id,
          name: rule.name,
          severity: rule.severity,
          detail: `${matches.length}회 발견`, // 몇 번 발견되었는지 표시
        });
      }
    }
    // 최소 길이 조건이 있는 규칙: 텍스트가 기준보다 짧으면 이슈로 추가
    if (rule.minLength != null && trimmed.length < rule.minLength) {
      issues.push({
        id: rule.id,
        name: rule.name,
        severity: rule.severity,
        detail: `길이 ${trimmed.length}자`, // 현재 텍스트 길이 표시
      });
    }
  }

  // 심각도 순으로 정렬: high(0) → medium(1) → low(2)
  const order: Record<RuleIssue['severity'], number> = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    issues,
    meta: { totalRules: RULES.length, transcriptLength: trimmed.length },
  };
}

// ===== 발음 분석 (Whisper 단어 타임스탬프 기반) =====

// 말하기 속도 기준 (일본어 면접 기준 WPM)
// 일본어는 영어보다 단어당 음절이 많아서 WPM 기준이 다름
const SPEED_THRESHOLDS = {
  TOO_SLOW: 60,    // 60 WPM 미만: 너무 느림
  SLOW: 100,       // 60~100: 느림
  GOOD_MIN: 100,   // 100~180: 적절
  GOOD_MAX: 180,
  FAST: 220,       // 180~220: 빠름
  // 220 초과: 너무 빠름
};

// 쉼(pause) 감지 기준 (초)
const PAUSE_THRESHOLD = 1.0; // 1초 이상 쉼이면 "긴 쉼"으로 검출

// 세그먼트 신뢰도 기준 (avg_logprob)
const CONFIDENCE_THRESHOLD = -0.7; // 이보다 낮으면 "불명확한 발음" 구간

/**
 * Whisper 단어 타임스탬프 + 세그먼트 신뢰도를 분석하여 발음 품질 평가
 *
 * [분석 항목]
 * 1. 말하기 속도 (WPM): 전체 단어 수 / 전체 시간(분)
 * 2. 쉼 패턴: 단어 사이의 긴 공백을 감지 (1초 이상)
 * 3. 불명확 구간: Whisper 세그먼트의 avg_logprob이 낮은 구간
 * 4. 종합 점수: 위 항목들을 가중치로 결합한 0~100점
 *
 * @param words - Whisper가 반환한 단어별 타임스탬프 배열
 * @param segments - Whisper가 반환한 세그먼트별 신뢰도 배열
 * @param duration - 전체 오디오 길이 (초)
 * @returns PronunciationAnalysis - 발음 분석 결과
 */
export function analyzePronunciation(
  words: WordTimestamp[],
  segments: WhisperSegment[],
  duration: number,
): PronunciationAnalysis {
  const wordCount = words.length;

  // === 1. 말하기 속도 (WPM) 계산 ===
  // 실제 말하는 시간 = 전체 길이에서 긴 쉼을 제외한 시간
  const durationMin = duration / 60; // 초 → 분
  const wpm = durationMin > 0 ? Math.round(wordCount / durationMin) : 0;

  // WPM에 따른 속도 등급 판정
  let rating: PronunciationAnalysis['speakingSpeed']['rating'];
  if (wpm < SPEED_THRESHOLDS.TOO_SLOW) rating = 'too_slow';
  else if (wpm < SPEED_THRESHOLDS.SLOW) rating = 'slow';
  else if (wpm <= SPEED_THRESHOLDS.GOOD_MAX) rating = 'good';
  else if (wpm <= SPEED_THRESHOLDS.FAST) rating = 'fast';
  else rating = 'too_fast';

  // === 2. 쉼(pause) 패턴 감지 ===
  // 연속 단어 사이의 시간 간격이 PAUSE_THRESHOLD를 넘으면 "긴 쉼"
  const pauses: PronunciationAnalysis['pauses'] = [];
  for (let i = 0; i < words.length - 1; i++) {
    const gap = words[i + 1].start - words[i].end;
    if (gap >= PAUSE_THRESHOLD) {
      pauses.push({
        afterWord: words[i].word,
        beforeWord: words[i + 1].word,
        duration: Math.round(gap * 10) / 10, // 소수점 1자리
        position: i,
      });
    }
  }

  // === 3. 불명확 발음 구간 감지 ===
  // avg_logprob이 기준보다 낮은 세그먼트 = Whisper가 인식에 자신없는 구간
  // → 발음이 불명확하거나, 노이즈가 많거나, 말이 빠른 구간
  const unclearSegments: PronunciationAnalysis['unclearSegments'] = [];
  for (const seg of segments) {
    if (seg.avg_logprob < CONFIDENCE_THRESHOLD && seg.no_speech_prob < 0.5) {
      // no_speech_prob이 높으면 그냥 침묵이므로 제외
      // avg_logprob을 0~1 신뢰도로 변환: logprob -2 → 0, logprob 0 → 1
      const confidence = Math.max(0, Math.min(1, (seg.avg_logprob + 2) / 2));
      unclearSegments.push({
        text: seg.text.trim(),
        confidence: Math.round(confidence * 100) / 100,
      });
    }
  }

  // === 4. 종합 점수 계산 (0~100) ===
  // 가중치: 속도 적절성(30%) + 쉼 패턴(20%) + 발음 명확도(50%)
  const speedScore = calculateSpeedScore(wpm);
  const pauseScore = calculatePauseScore(pauses.length, wordCount);
  const clarityScore = calculateClarityScore(segments);

  const overallScore = Math.round(
    speedScore * 0.3 + pauseScore * 0.2 + clarityScore * 0.5
  );

  return {
    overallScore: Math.max(0, Math.min(100, overallScore)),
    speakingSpeed: { wpm, rating },
    pauses,
    unclearSegments,
    totalDuration: Math.round(duration * 10) / 10,
    wordCount,
    words,
  };
}

/**
 * 속도 점수 계산 (0~100)
 * 적절한 범위(100~180 WPM)에서 100점, 범위를 벗어날수록 감점
 */
function calculateSpeedScore(wpm: number): number {
  if (wpm >= SPEED_THRESHOLDS.GOOD_MIN && wpm <= SPEED_THRESHOLDS.GOOD_MAX) {
    return 100; // 적절한 속도
  }
  if (wpm < SPEED_THRESHOLDS.GOOD_MIN) {
    // 느릴수록 감점 (0 WPM → 30점, 100 WPM → 100점)
    return Math.max(30, Math.round((wpm / SPEED_THRESHOLDS.GOOD_MIN) * 100));
  }
  // 빠를수록 감점 (180 WPM → 100점, 300 WPM → 30점)
  const overSpeed = wpm - SPEED_THRESHOLDS.GOOD_MAX;
  return Math.max(30, 100 - Math.round(overSpeed * 0.6));
}

/**
 * 쉼 패턴 점수 계산 (0~100)
 * 적절한 쉼은 좋지만, 너무 많으면 감점
 * 기준: 단어 20개당 쉼 1~2개가 자연스러움
 */
function calculatePauseScore(pauseCount: number, wordCount: number): number {
  if (wordCount === 0) return 50;
  // 단어 20개당 쉼 비율
  const pauseRatio = (pauseCount / wordCount) * 20;
  if (pauseRatio <= 2) return 100;   // 자연스러운 쉼
  if (pauseRatio <= 4) return 75;    // 약간 많음
  if (pauseRatio <= 6) return 50;    // 많음
  return 30;                          // 너무 많음
}

/**
 * 발음 명확도 점수 계산 (0~100)
 * 세그먼트들의 avg_logprob 평균을 기반으로 산출
 * avg_logprob이 높을수록(0에 가까울수록) 명확한 발음
 */
function calculateClarityScore(segments: WhisperSegment[]): number {
  if (segments.length === 0) return 70; // 데이터 없으면 기본값

  // 전체 세그먼트의 avg_logprob 평균 계산
  const avgLogprob = segments.reduce((sum, s) => sum + s.avg_logprob, 0) / segments.length;

  // avg_logprob을 0~100 점수로 변환
  // -0.2 이상 → 100점 (매우 명확)
  // -1.5 이하 → 20점 (매우 불명확)
  const score = Math.round(((avgLogprob + 1.5) / 1.3) * 80 + 20);
  return Math.max(0, Math.min(100, score));
}
