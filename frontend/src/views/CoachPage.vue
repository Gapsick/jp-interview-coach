<!--
  CoachPage.vue - 메인 페이지 컴포넌트 (코칭 기능의 중심)

  이 컴포넌트가 하는 일:
  - 앱의 핵심 화면으로, 전체 사용자 플로우를 관리
  - 3가지 화면 상태를 조건부 렌더링(v-if)으로 전환:
    1. 입력 화면: FileUpload + AudioRecorder 카드 표시 (파일 선택 또는 녹음)
    2. 분석 중: ProcessingStatus 표시 (로딩 애니메이션)
    3. 결과 화면: AnalysisResult 표시 (분석 결과 카드들)

  데이터 흐름:
  사용자 파일/녹음 선택 → runAnalysis() → 백엔드 API 호출 → 결과 표시
-->
<template>
  <div class="coach-page">
    <!-- 1. 입력 화면: 아직 분석 중이 아니고 결과도 없을 때 표시 -->
    <section v-if="!result && !processing" class="input-cards">
      <!-- 파일 업로드 카드 -->
      <FileUpload
        :disabled="processing"
        accept="video/mp4,audio/*"
        @file-selected="onFileSelected"
      />
      <!-- 마이크 녹음 카드 -->
      <AudioRecorder
        :disabled="processing"
        @recorded="onRecorded"
      />
    </section>

    <!-- 에러 메시지 (분석 실패, 음성 미인식 등) -->
    <section v-if="errorMessage" class="card error-card">
      <p class="error-text">{{ errorMessage }}</p>
    </section>

    <!-- 2. 분석 중 화면: 프로그레스 바와 상태 메시지 표시 -->
    <ProcessingStatus
      v-if="processing || (statusMessage && !result)"
      :processing="processing"
      :message="statusMessage"
    />

    <!-- 3. 분석 결과 화면: 인식 텍스트, 이슈, 팁, 연습문장 표시 -->
    <AnalysisResult
      v-if="result"
      :transcript="result.transcript"
      :transcript-warning="result.transcriptWarning"
      :top-issues="result.topIssues"
      :pronunciation-tips="result.pronunciationTips"
      :practice-sentences="result.practiceSentences"
      @reset="result = null; errorMessage = ''"
    />
    <!-- reset 이벤트: 결과와 에러를 초기화 → 다시 입력 화면으로 돌아감 -->
  </div>
</template>

<script setup>
import { ref } from 'vue';

// 자식 컴포넌트들 import
import FileUpload from '../components/FileUpload.vue';       // 파일 업로드 카드
import AudioRecorder from '../components/AudioRecorder.vue'; // 마이크 녹음 카드
import ProcessingStatus from '../components/ProcessingStatus.vue'; // 분석 중 로딩 UI
import AnalysisResult from '../components/AnalysisResult.vue';     // 분석 결과 표시

// API 클라이언트: 백엔드에 파일을 보내고 분석 결과를 받아오는 함수
import { analyzeFile } from '../api/coach.js';

// ===== 반응형 상태 변수들 =====
const sessionId = ref(null);      // 현재 세션 ID (서버에서 발급, 분석 이력 연결용)
const processing = ref(false);     // 분석 진행 중 여부
const statusMessage = ref('');     // 진행 상태 메시지 ("업로드 중...", "분석 중..." 등)
const errorMessage = ref('');      // 에러 메시지 (에러 발생 시)
const result = ref(null);          // 분석 결과 객체 (성공 시)

/**
 * 분석 실행: 파일/Blob을 백엔드에 전송하고 결과를 처리
 *
 * @param file - File 객체(파일 선택) 또는 Blob(녹음 결과)
 *
 * 처리 흐름:
 * 1. 로딩 상태 시작
 * 2. analyzeFile()로 백엔드 API 호출
 * 3. 응답의 status에 따라 결과/에러 처리
 * 4. 로딩 상태 종료
 */
async function runAnalysis(file) {
  processing.value = true;          // 로딩 시작
  statusMessage.value = '업로드 중…';
  result.value = null;               // 이전 결과 초기화
  errorMessage.value = '';           // 이전 에러 초기화

  try {
    statusMessage.value = '분석 중…';
    // 백엔드 POST /api/analyze 호출
    const data = await analyzeFile(file, sessionId.value ?? undefined);
    sessionId.value = data.sessionId ?? sessionId.value; // 세션 ID 저장

    if (data.status === 'success') {
      // 분석 성공: 결과 저장 → AnalysisResult 컴포넌트에 표시됨
      result.value = {
        transcript: data.transcript,             // 인식된 텍스트
        transcriptWarning: data.transcriptWarning, // 짧은 녹음 경고
        topIssues: data.topIssues ?? [],           // 주요 이슈
        pronunciationTips: data.pronunciationTips ?? [], // 발음 팁
        practiceSentences: data.practiceSentences ?? [], // 연습 문장
      };
      statusMessage.value = '';
    } else if (data.status === 'no_speech') {
      // 음성이 인식되지 않음: 에러 메시지 표시
      errorMessage.value = data.error || '음성이 인식되지 않았습니다.';
      statusMessage.value = '';
    } else {
      // 기타 에러
      errorMessage.value = data.error || '분석 실패';
      statusMessage.value = '';
    }
  } catch (err) {
    // 네트워크 에러 등 예외
    errorMessage.value = err.message || '요청 실패';
    statusMessage.value = '';
  } finally {
    processing.value = false; // 로딩 종료
  }
}

/**
 * FileUpload 컴포넌트에서 파일이 선택되었을 때 호출
 * @param file - 선택된 File 객체
 */
function onFileSelected(file) {
  if (!file) return;
  runAnalysis(file);
}

/**
 * AudioRecorder 컴포넌트에서 녹음이 완료되었을 때 호출
 * @param blob - 녹음된 오디오 Blob
 */
function onRecorded(blob) {
  if (!blob) return;
  runAnalysis(blob);
}
</script>

<style scoped>
.coach-page { display: flex; flex-direction: column; gap: 1.5rem; }
/* 입력 카드 영역: 2열 그리드 (파일 업로드 | 녹음) */
.input-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.25rem;
}
/* 모바일(560px 이하): 1열로 변경 */
@media (max-width: 560px) {
  .input-cards { grid-template-columns: 1fr; }
}
.card {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.06);
  padding: 1.25rem 1.5rem;
}
/* 에러 카드: 빨간색 테두리 + 연한 빨간 배경 */
.error-card { border: 1px solid rgba(239, 68, 68, 0.3); background: rgba(254, 226, 226, 0.5); }
.error-text { margin: 0; color: #b91c1c; font-size: 0.9rem; }
</style>
