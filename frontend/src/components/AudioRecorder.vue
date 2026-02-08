<!--
  AudioRecorder.vue - 마이크 녹음 컴포넌트

  이 컴포넌트가 하는 일:
  - 사용자가 클릭하면 마이크 접근 권한 요청 → 녹음 시작
  - 다시 클릭하면 녹음 중지 → 녹음된 오디오를 Blob으로 변환
  - 'recorded' 이벤트로 부모(CoachPage)에게 녹음 데이터(Blob) 전달

  Props:
  - disabled: true이면 녹음 버튼 비활성화

  Events:
  - recorded: 녹음 완료 시 Blob 전달 (실패 시 null)

  내부 동작:
  - Web API의 MediaRecorder를 사용하여 브라우저에서 직접 녹음
  - 녹음 포맷: 브라우저 기본 (보통 audio/webm)
-->
<template>
  <!-- 녹음 카드: 녹음 중이면 'recording' 클래스 추가 (스타일 변경) -->
  <div class="card record-card" :class="{ disabled, recording: isRecording }">
    <button
      type="button"
      class="record-inner"
      :disabled="disabled"
      @click="toggle"
    >
      <!-- 아이콘: 녹음 중이면 깜빡이는 애니메이션 적용 -->
      <span class="icon-wrap" :class="isRecording ? 'icon-recording' : 'icon-mic'">●</span>
      <h3 class="card-title">직접 녹음</h3>
      <p class="card-desc">마이크로 발음을 녹음하세요</p>
      <!-- 버튼 텍스트: 상태에 따라 변경 -->
      <span class="btn" :class="isRecording ? 'btn-recording' : 'btn-record'">
        {{ isRecording ? '클릭하여 녹음 완료' : '클릭하여 녹음 시작' }}
      </span>
    </button>
  </div>
</template>

<script setup>
import { ref, onUnmounted } from 'vue';

// Props 정의
defineProps({
  disabled: { type: Boolean, default: false },
});

// 부모에게 보낼 이벤트 정의
const emit = defineEmits(['recorded']);

// 반응형 상태: 현재 녹음 중인지 여부
const isRecording = ref(false);
// 일반 변수: MediaRecorder 인스턴스와 녹음 데이터 청크
let mediaRecorder = null;
let chunks = [];

/**
 * 녹음 토글: 녹음 중이면 중지, 아니면 시작
 */
function toggle() {
  if (isRecording.value) stop();
  else start();
}

/**
 * 녹음 시작
 * 1. 브라우저에 마이크 접근 권한 요청 (navigator.mediaDevices.getUserMedia)
 * 2. MediaRecorder 인스턴스 생성
 * 3. 녹음 데이터가 들어올 때마다 chunks에 저장
 * 4. 녹음 중지 시 → chunks를 하나의 Blob으로 합쳐서 부모에게 전달
 */
async function start() {
  try {
    // 마이크 접근 권한 요청 → 오디오 스트림 획득
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    chunks = [];

    // 녹음 데이터가 생길 때마다 chunks 배열에 추가
    mediaRecorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    // 녹음 중지 시 실행: 마이크 해제 + Blob 생성 + 부모에게 전달
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop()); // 마이크 스트림 해제
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      emit('recorded', blob); // 부모 컴포넌트에 녹음 Blob 전달
    };

    mediaRecorder.start();        // 녹음 시작
    isRecording.value = true;     // UI 상태 업데이트
  } catch (err) {
    console.error('Mic access failed:', err); // 마이크 접근 거부 등
    emit('recorded', null);       // 실패 시 null 전달
  }
}

/**
 * 녹음 중지
 */
function stop() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  mediaRecorder.stop();           // MediaRecorder 중지 → onstop 콜백 실행됨
  isRecording.value = false;      // UI 상태 업데이트
}

// 컴포넌트가 DOM에서 제거될 때 녹음 중이면 자동 중지 (리소스 정리)
onUnmounted(() => {
  if (isRecording.value) stop();
});
</script>

<style scoped>
/* 녹음 카드 스타일 */
.record-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 1.75rem 1.25rem;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.06);
  border: 1px solid rgba(0,0,0,0.04);
  transition: box-shadow 0.2s, transform 0.2s;
}
/* 호버 시 빨간색 그림자 + 살짝 떠오르기 */
.record-card:hover:not(.disabled):not(.recording) {
  box-shadow: 0 8px 28px rgba(239, 68, 68, 0.12);
  transform: translateY(-2px);
}
/* 녹음 중일 때 빨간 그림자 강조 */
.record-card.recording { box-shadow: 0 8px 28px rgba(239, 68, 68, 0.2); }
.record-card.disabled { opacity: 0.6; }
.record-inner {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: none;
  border: none;
  cursor: pointer;
  font: inherit;
  color: inherit;
  padding: 0;
}
.icon-wrap {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  margin-bottom: 1rem;
}
.icon-mic { background: rgba(239, 68, 68, 0.1); color: #dc2626; }
/* 녹음 중 아이콘: 깜빡이는 pulse 애니메이션 */
.icon-recording { background: rgba(239, 68, 68, 0.2); color: #dc2626; animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.7; } }
.card-title { font-size: 1.05rem; font-weight: 600; margin: 0 0 0.35rem 0; color: #1f2937; }
.card-desc { font-size: 0.85rem; color: #6b7280; margin: 0 0 1rem 0; }
.btn {
  display: inline-block;
  padding: 0.5rem 1rem;
  border-radius: 10px;
  font-size: 0.9rem;
  font-weight: 500;
}
.btn-record { background: rgba(239, 68, 68, 0.1); color: #dc2626; }
.btn-recording { background: rgba(239, 68, 68, 0.2); color: #b91c1c; }
</style>
