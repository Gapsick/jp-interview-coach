<!--
  ProcessingStatus.vue - 분석 진행 중 상태 표시 컴포넌트

  이 컴포넌트가 하는 일:
  - 백엔드에서 분석이 진행 중일 때 로딩 UI를 보여줌
  - 좌우로 움직이는 프로그레스 바 애니메이션 표시
  - 현재 진행 상태 메시지(예: "업로드 중...", "분석 중...")를 표시

  Props:
  - processing: true이면 프로그레스 바 애니메이션 활성화
  - message: 현재 상태 메시지
-->
<template>
  <section class="card processing-card">
    <div class="icon-wrap">✨</div>
    <h3 class="status-title">AI가 발음을 분석하고 있습니다</h3>
    <p class="status-steps">음성 인식 · 발음 평가 · 피드백 생성</p>
    <!-- 프로그레스 바: processing이 true이면 좌우 무한 애니메이션 -->
    <div class="progress-wrap">
      <div class="progress-bar" :class="{ indeterminate: processing }"></div>
    </div>
    <!-- 상태 메시지: "업로드 중...", "분석 중..." 등 -->
    <span v-if="message" class="status-message">{{ message }}</span>
  </section>
</template>

<script setup>
// Props 정의
defineProps({
  processing: { type: Boolean, default: false }, // 분석 진행 중 여부
  message: { type: String, default: '' },         // 진행 상태 메시지
});
</script>

<style scoped>
.processing-card {
  text-align: center;
  padding: 2rem 1.5rem;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.06);
  border: 1px solid rgba(0,0,0,0.04);
}
/* 상단 아이콘 (보라색 원형 배경) */
.icon-wrap {
  width: 64px;
  height: 64px;
  margin: 0 auto 1rem;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(99, 102, 241, 0.15));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.75rem;
}
.status-title { font-size: 1.1rem; font-weight: 600; margin: 0 0 0.35rem 0; color: #1f2937; }
.status-steps { font-size: 0.85rem; color: #6b7280; margin: 0 0 1.25rem 0; }
/* 프로그레스 바 트랙 */
.progress-wrap {
  height: 6px;
  background: #e5e7eb;
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: 0.75rem;
}
/* 프로그레스 바 (보라색 그라데이션) */
.progress-bar {
  height: 100%;
  width: 40%;
  background: linear-gradient(90deg, #8b5cf6, #6366f1);
  border-radius: 999px;
  transition: width 0.3s;
}
/* 무한 좌우 움직임 애니메이션 (분석 중일 때) */
.progress-bar.indeterminate {
  width: 40%;
  animation: progress-move 1.5s ease-in-out infinite;
}
@keyframes progress-move {
  0% { transform: translateX(-100%); }
  50% { transform: translateX(200%); }
  100% { transform: translateX(-100%); }
}
.status-message { font-size: 0.85rem; color: #6b7280; }
</style>
