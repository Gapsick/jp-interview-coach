<!--
  AnalysisResult.vue - 분석 결과 표시 컴포넌트

  이 컴포넌트가 하는 일:
  - 백엔드에서 받은 발음 분석 결과를 카드 형태로 보여줌
  - 표시 항목:
    1. 인식된 텍스트 (STT 결과)
    2. 발음/클리어리티 이슈 (topIssues)
    3. 발음/전달 포인트 (pronunciationTips)
    4. 연습 문장 (practiceSentences)
  - "다시 시작" 버튼으로 초기 화면으로 돌아감

  Props: (부모 CoachPage에서 전달)
  - transcript: 인식된 텍스트
  - transcriptWarning: 짧은 녹음 경고 메시지
  - topIssues: 주요 이슈 배열
  - pronunciationTips: 발음 팁 배열
  - practiceSentences: 연습 문장 배열

  Events:
  - reset: "다시 시작" 클릭 시 발생
-->
<template>
  <section class="analysis-result">
    <!-- 분석 완료 헤더 -->
    <div class="result-header card">
      <span class="complete-badge">분석 완료</span>
      <h2 class="result-title">분석 결과</h2>
    </div>

    <!-- 1. 인식된 텍스트 (STT 결과) -->
    <div v-if="transcript" class="card block">
      <h3 class="block-title">· 인식된 텍스트</h3>
      <!-- 녹음이 짧았을 때 경고 메시지 -->
      <p v-if="transcriptWarning" class="transcript-warning">{{ transcriptWarning }}</p>
      <p class="transcript-text">{{ transcript }}</p>
    </div>

    <!-- 2. 발음/클리어리티 이슈 목록 (LLM이 생성한 주요 개선점) -->
    <div v-if="topIssues?.length" class="card block">
      <h3 class="block-title">발음 · 클리어리티 이슈</h3>
      <ul class="list">
        <li v-for="(issue, i) in topIssues" :key="i">{{ issue }}</li>
      </ul>
    </div>

    <!-- 3. 발음/전달 주의 포인트 -->
    <div v-if="pronunciationTips?.length" class="card block">
      <h3 class="block-title">발음 · 전달 포인트</h3>
      <p class="tips-desc">이 발화에서 특히 주의할 발음·전달 부분입니다.</p>
      <ul class="list">
        <li v-for="(tip, i) in pronunciationTips" :key="i">{{ tip }}</li>
      </ul>
    </div>

    <!-- 4. 다음 연습 문장 -->
    <div v-if="practiceSentences?.length" class="card block">
      <h3 class="block-title">다음 연습 문장</h3>
      <ul class="list">
        <li v-for="(s, i) in practiceSentences" :key="i">{{ s }}</li>
      </ul>
    </div>

    <!-- 다시 시작 버튼: 클릭하면 부모에게 reset 이벤트 전달 → 초기 화면으로 돌아감 -->
    <div class="actions">
      <button type="button" class="btn btn-secondary" @click="$emit('reset')">다시 시작</button>
    </div>
  </section>
</template>

<script setup>
// Props 정의: 부모(CoachPage)에서 분석 결과 데이터를 받음
defineProps({
  transcript: { type: String, default: '' },           // 인식된 텍스트
  transcriptWarning: { type: String, default: '' },    // 짧은 녹음 경고
  topIssues: { type: Array, default: () => [] },       // 주요 이슈 배열
  pronunciationTips: { type: Array, default: () => [] }, // 발음 팁 배열
  practiceSentences: { type: Array, default: () => [] }, // 연습 문장 배열
});

// 부모에게 보낼 이벤트 정의
defineEmits(['reset']); // "다시 시작" 버튼 클릭 시
</script>

<style scoped>
.analysis-result { display: flex; flex-direction: column; gap: 1.25rem; }
.result-header {
  padding: 1.25rem 1.5rem;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.06);
  border: 1px solid rgba(0,0,0,0.04);
}
.complete-badge {
  display: inline-block;
  font-size: 0.8rem;
  font-weight: 500;
  color: #6d28d9;
  margin-bottom: 0.35rem;
}
.result-title { font-size: 1.25rem; font-weight: 700; margin: 0; color: #1f2937; }
.card.block {
  padding: 1.25rem 1.5rem;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.06);
  border: 1px solid rgba(0,0,0,0.04);
}
.block-title {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0 0 0.75rem 0;
  color: #374151;
}
.tips-desc { font-size: 0.85rem; color: #6b7280; margin: 0 0 0.5rem 0; }
.transcript-warning { margin: 0 0 0.5rem 0; color: #ea580c; font-size: 0.9rem; }
.transcript-text { margin: 0; white-space: pre-wrap; word-break: break-word; color: #374151; line-height: 1.6; }
.list { margin: 0; padding-left: 1.25rem; }
.list li { margin-bottom: 0.4rem; color: #374151; line-height: 1.5; }
.actions { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.5rem; }
.btn {
  padding: 0.6rem 1.25rem;
  border-radius: 12px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  font-family: inherit;
}
.btn-secondary {
  background: #fff;
  color: #374151;
  border: 1px solid #e5e7eb;
  box-shadow: 0 2px 8px rgba(0,0,0,0.04);
}
.btn-secondary:hover { background: #f9fafb; border-color: #d1d5db; }
</style>
