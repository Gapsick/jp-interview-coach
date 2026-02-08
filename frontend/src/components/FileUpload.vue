<!--
  FileUpload.vue - 파일 선택 업로드 컴포넌트

  이 컴포넌트가 하는 일:
  - 사용자가 클릭하면 파일 선택 대화상자를 열어줌
  - MP3, MP4, WAV 등 오디오/비디오 파일을 선택할 수 있음
  - 파일을 선택하면 'file-selected' 이벤트로 부모(CoachPage)에게 파일 전달

  Props:
  - disabled: true이면 클릭 불가 (분석 중일 때)
  - accept: 허용할 파일 MIME 타입 (기본: "video/mp4,audio/*")

  Events:
  - file-selected: 파일이 선택되면 File 객체를 전달
-->
<template>
  <!-- label로 감싸서 카드 어디를 클릭해도 파일 선택 가능 -->
  <label class="card upload-card" :class="{ disabled }">
    <!-- 숨겨진 file input (카드 클릭 시 열림) -->
    <input
      type="file"
      :accept="accept"
      :disabled="disabled"
      @change="onChange"
    />
    <span class="icon-wrap icon-upload">↑</span>
    <h3 class="card-title">파일 업로드</h3>
    <p class="card-desc">MP3, MP4, WAV 파일을 선택하세요</p>
    <span class="btn btn-upload">클릭하여 파일 선택</span>
  </label>
</template>

<script setup>
// Props 정의: 부모 컴포넌트에서 전달받는 값
defineProps({
  disabled: { type: Boolean, default: false },          // 비활성화 여부
  accept: { type: String, default: 'video/mp4,audio/*' }, // 허용 파일 타입
});

// 부모에게 보낼 이벤트 정의
const emit = defineEmits(['file-selected']);

/**
 * 파일이 선택되었을 때 호출되는 핸들러
 * - 선택된 파일을 부모 컴포넌트에 전달
 * - input의 value를 초기화하여 같은 파일을 다시 선택할 수 있게 함
 */
function onChange(e) {
  const file = e.target.files?.[0];       // 선택된 첫 번째 파일
  emit('file-selected', file ?? null);    // 부모에게 파일 전달
  e.target.value = '';                    // input 초기화 (같은 파일 재선택 허용)
}
</script>

<style scoped>
/* 업로드 카드 스타일 */
.upload-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 1.75rem 1.25rem;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.06);
  cursor: pointer;
  border: 1px solid rgba(0,0,0,0.04);
  transition: box-shadow 0.2s, transform 0.2s;
}
/* 호버 시 살짝 떠오르는 효과 */
.upload-card:hover:not(.disabled) {
  box-shadow: 0 8px 28px rgba(139, 92, 246, 0.12);
  transform: translateY(-2px);
}
.upload-card.disabled { opacity: 0.6; cursor: not-allowed; }
.upload-card input { display: none; } /* file input 숨김 */
.icon-wrap {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 1rem;
}
.icon-upload { background: rgba(139, 92, 246, 0.12); color: #6d28d9; }
.card-title { font-size: 1.05rem; font-weight: 600; margin: 0 0 0.35rem 0; color: #1f2937; }
.card-desc { font-size: 0.85rem; color: #6b7280; margin: 0 0 1rem 0; }
.btn {
  display: inline-block;
  padding: 0.5rem 1rem;
  border-radius: 10px;
  font-size: 0.9rem;
  font-weight: 500;
}
.btn-upload { background: rgba(139, 92, 246, 0.12); color: #6d28d9; }
</style>
