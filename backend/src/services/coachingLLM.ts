/**
 * LLM 코칭 피드백 생성 서비스
 *
 * 이 파일이 하는 일:
 * - 발화 텍스트 + 규칙 분석 결과를 GPT-4o-mini에 보내서
 * - 면접 발음 코칭 피드백(개선점, 발음 팁, 연습 문장)을 생성
 * - API 키가 없거나 Mock 모드이면 빈 배열을 반환
 */
import OpenAI from 'openai';
import { config } from '../config.js';
import type { RuleIssue } from './sessionStore.js';

// OpenAI 클라이언트 (API 키가 있고 Mock 모드가 아닐 때만 생성)
let openai: OpenAI | null = null;
if (config.openaiApiKey && !config.useMockLlm) {
  openai = new OpenAI({ apiKey: config.openaiApiKey });
}

// 코칭 피드백의 타입 정의
export type CoachingFeedback = {
  topIssues: string[];          // 주요 개선점 목록 (예: "이 발화에서 ~가 ~. → 개선 방법")
  pronunciationTips: string[];   // 발음/전달 주의 포인트 (예: "御社를 뚜렷이 발음")
  practiceSentences: string[];   // 다음에 연습할 면접 일본어 문장들
};

/**
 * LLM을 사용하여 코칭 피드백 생성
 *
 * @param transcript - STT로 인식된 발화 텍스트
 * @param ruleIssues - 규칙 기반 분석에서 검출된 이슈 목록 (transcriptAnalyzer에서 온 결과)
 * @returns CoachingFeedback - topIssues, pronunciationTips, practiceSentences
 */
export async function generateCoachingFeedback(transcript: string, ruleIssues: RuleIssue[]): Promise<CoachingFeedback> {
  // Mock 모드이거나 API 클라이언트가 없으면 → 빈 결과 반환
  if (config.useMockLlm || !openai) {
    return { topIssues: [], pronunciationTips: [], practiceSentences: [] };
  }

  // 규칙 분석에서 검출된 이슈를 텍스트로 변환 (LLM에게 참고 정보로 전달)
  const issuesList = ruleIssues.length
    ? ruleIssues.map((i) => `- ${i.name}: ${i.detail || i.severity}`).join('\n')
    : '(규칙 기반으로 자동 검출된 이슈 없음)';

  // 시스템 프롬프트: LLM에게 "일본어 면접 발음 코치" 역할을 부여하고 출력 형식을 지정
  const systemPrompt = `당신은 일본어 면접 발음·클리어리티 코치입니다. 학습자에게 한국어로만 답하세요.

**중요 규칙**
- 피드백은 반드시 "아래 발화(transcript)에 실제로 있는 내용"만 근거로 할 것.
- topIssues: 이 발화에서 개선할 점이 있으면 "이 발화에서 [구체적 문장/표현]이 [문제]. → [한 줄 개선 방법]" 형태로 나열. 없으면 [].
- pronunciationTips: 이 발화에서 발음·전달 주의 포인트가 있으면 나열 (예: "御社(おんしゃ)를 뚜렷이", "よろしくお願いいたします는 끝까지 천천히"). 없으면 [].
- practiceSentences: 위 발화와 이어질 면접 일본어 문장이 있으면 나열. 없으면 []. 개수 제한 없음.

**출력 형식** (JSON만, 마크다운 없이). 없으면 빈 배열 [], 있으면 필요한 만큼 여러 개:
{"topIssues": [], "pronunciationTips": [], "practiceSentences": []}`;

  // 사용자 프롬프트: 실제 발화 내용과 자동 검출 이슈를 LLM에게 전달
  const userPrompt = `[발화 내용 - STT 인식 결과]\n${transcript}\n\n[자동 검출 이슈]\n${issuesList}\n\n위 발화만 보고, 위 규칙대로 JSON만 출력하세요.`;

  // GPT-4o-mini API 호출 (temperature 0.3으로 일관된 출력 유도)
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3, // 낮은 temperature → 더 일관되고 예측 가능한 응답
  });

  // LLM 응답에서 JSON 파싱
  const content = response.choices?.[0]?.message?.content?.trim() || '{}';
  try {
    // 혹시 마크다운 코드블록(```json ... ```)으로 감싸져 있으면 제거 후 파싱
    const parsed = JSON.parse(content.replace(/^```json?\s*|\s*```$/g, '')) as Partial<CoachingFeedback>;
    return {
      topIssues: Array.isArray(parsed.topIssues) ? parsed.topIssues : [],
      pronunciationTips: Array.isArray(parsed.pronunciationTips) ? parsed.pronunciationTips : [],
      practiceSentences: Array.isArray(parsed.practiceSentences) ? parsed.practiceSentences : [],
    };
  } catch {
    // JSON 파싱 실패 시 빈 배열 반환 (서버 크래시 방지)
    return { topIssues: [], pronunciationTips: [], practiceSentences: [] };
  }
}
