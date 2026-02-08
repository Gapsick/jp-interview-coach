/**
 * 규칙 기반 발화 분석기
 *
 * 이 파일이 하는 일:
 * - 일본어 면접 발화(transcript)를 정규식 규칙으로 분석
 * - 필러 사용, 긴 침묵, 짧은 답변, 표현 반복 등의 이슈를 검출
 * - 검출된 이슈를 심각도(severity) 순으로 정렬하여 반환
 *
 * 이 결과는 이후 LLM(coachingLLM.ts)에 전달되어 더 상세한 코칭 피드백 생성에 활용됨
 */
import type { RuleIssue } from './sessionStore.js';

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
