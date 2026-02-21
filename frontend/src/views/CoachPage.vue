<!--
  CoachPage.vue - 메인 페이지 컴포넌트 (코칭 기능의 중심)

  이 컴포넌트가 하는 일:
  - 앱의 핵심 화면으로, 전체 사용자 플로우를 관리
  - 탭 네비게이션으로 2가지 모드 전환:
    1. 분석하기 탭: 파일 업로드/녹음 → 분석 → 결과 표시
    2. 히스토리 탭: 과거 분석 이력 목록 → 상세 보기

  데이터 흐름:
  - 분석하기: 파일/녹음 → runAnalysis() → 백엔드 API → 결과 표시
  - 히스토리: loadHistory() → 백엔드 API → 목록 표시 → 항목 클릭 → 상세 보기

  세션 복원:
  - 페이지 새로고침 시 onMounted에서 최근 세션을 DB에서 가져와 sessionId 복원
  - → 이전 분석과 같은 세션에서 계속 이어서 분석 가능
-->
<template>
  <div class="coach-page">
    <!-- ===== 탭 네비게이션: 분석하기 | 히스토리 ===== -->
    <!--
      [v-if가 아니라 탭을 쓰는 이유]
      - vue-router를 사용하지 않고도 여러 화면을 전환할 수 있음
      - activeTab ref 값에 따라 어떤 내용을 보여줄지 결정
      - :class="{ active: ... }" → 현재 탭이면 active 클래스 추가 (보라색 강조)
    -->
    <nav class="tab-nav">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'coach' }"
        @click="activeTab = 'coach'"
      >
        분석하기
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'history' }"
        @click="loadHistory"
      >
        히스토리
      </button>
    </nav>

    <!-- ===== 분석하기 탭 (기존 코칭 기능) ===== -->
    <template v-if="activeTab === 'coach'">
      <!-- 1. 입력 화면: 아직 분석 중이 아니고 결과도 없을 때 표시 -->
      <section v-if="!result && !processing">
        <!-- 원문 텍스트 입력 (선택사항): 있으면 단어별 비교 모드 -->
        <div class="ref-text-box">
          <label class="ref-text-label">
            원문 텍스트
            <span class="ref-text-optional">선택사항 · 입력하면 단어별 정확도 비교</span>
          </label>
          <textarea
            v-model="referenceText"
            class="ref-textarea"
            rows="3"
            placeholder="읽을 일본어 텍스트를 붙여넣으세요…"
          />
        </div>

        <!-- 파일 업로드 / 녹음 카드 -->
        <div class="input-cards">
          <FileUpload
            :disabled="processing"
            accept="video/mp4,audio/*"
            @file-selected="onFileSelected"
          />
          <AudioRecorder
            :disabled="processing"
            @recorded="onRecorded"
          />
        </div>
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
        :reference-text="result.referenceText"
        :word-diff="result.wordDiff"
        :top-issues="result.topIssues"
        :pronunciation-tips="result.pronunciationTips"
        :practice-sentences="result.practiceSentences"
        :pronunciation="result.pronunciation"
        :overall-score="result.overallScore"
        :pronunciation-analysis-l-l-m="result.pronunciationAnalysisLLM"
        :history-note="result.historyNote"
        @reset="result = null; errorMessage = ''"
      />
      <!-- reset 이벤트: 결과와 에러를 초기화 → 다시 입력 화면으로 돌아감 -->
    </template>

    <!-- ===== 히스토리 탭 (분석 이력 보기) ===== -->
    <template v-if="activeTab === 'history'">
      <!-- 로딩 중 -->
      <div v-if="historyLoading" class="card" style="text-align: center; padding: 2rem;">
        로딩 중...
      </div>

      <!-- 이력이 없을 때 -->
      <div v-else-if="historyList.length === 0" class="card" style="text-align: center; padding: 2rem;">
        <p style="color: #6b7280;">아직 분석 이력이 없습니다.</p>
        <button class="tab-btn active" @click="activeTab = 'coach'" style="margin-top: 1rem;">
          첫 분석하러 가기
        </button>
      </div>

      <template v-else>
        <!-- 선택한 히스토리 항목의 상세 보기 -->
        <div v-if="selectedHistory" class="card detail-card">
          <button class="back-btn" @click="selectedHistory = null">목록으로</button>
          <h3 class="detail-title">
            {{ formatDate(selectedHistory.at) }}
          </h3>

          <!-- 인식된 텍스트 -->
          <div class="detail-section">
            <p class="detail-label">인식된 텍스트</p>
            <p class="detail-transcript">{{ selectedHistory.transcript }}</p>
          </div>

          <!-- 검출된 이슈 -->
          <div v-if="selectedHistory.issues?.length" class="detail-section">
            <p class="detail-label">검출된 이슈</p>
            <div class="issue-tags">
              <span
                v-for="(issue, i) in selectedHistory.issues"
                :key="i"
                class="issue-tag"
                :class="'severity-' + issue.severity"
              >
                {{ issue.name }}
              </span>
            </div>
          </div>

          <!-- 주요 개선점 (LLM 피드백) -->
          <div v-if="selectedHistory.topIssues?.length" class="detail-section">
            <p class="detail-label">주요 개선점</p>
            <ul class="detail-list">
              <li v-for="(issue, i) in selectedHistory.topIssues" :key="i">{{ issue }}</li>
            </ul>
          </div>

          <!-- 발음 포인트 -->
          <div v-if="selectedHistory.pronunciationTips?.length" class="detail-section">
            <p class="detail-label">발음 포인트</p>
            <ul class="detail-list">
              <li v-for="(tip, i) in selectedHistory.pronunciationTips" :key="i">{{ tip }}</li>
            </ul>
          </div>

          <!-- 연습 문장 -->
          <div v-if="selectedHistory.practiceSentences?.length" class="detail-section">
            <p class="detail-label">연습 문장</p>
            <ul class="detail-list">
              <li v-for="(sent, i) in selectedHistory.practiceSentences" :key="i">{{ sent }}</li>
            </ul>
          </div>

          <!-- 발음 분석 데이터 (저장된 경우에만 표시) -->
          <div v-if="selectedHistory.pronunciation" class="detail-section">
            <p class="detail-label">발음 분석</p>
            <div class="hist-pron">
              <span class="hist-pron-score" :class="histScoreClass(selectedHistory.pronunciation.overallScore)">
                {{ selectedHistory.pronunciation.overallScore }}점
              </span>
              <span class="hist-pron-speed">
                {{ selectedHistory.pronunciation.speakingSpeed?.wpm }} WPM
                ({{ histSpeedLabel(selectedHistory.pronunciation.speakingSpeed?.rating) }})
              </span>
              <span v-if="selectedHistory.pronunciation.unclearSegments?.length" class="hist-pron-unclear">
                불명확 구간 {{ selectedHistory.pronunciation.unclearSegments.length }}곳
              </span>
              <span v-if="selectedHistory.pronunciation.pauses?.length" class="hist-pron-pause">
                긴 쉼 {{ selectedHistory.pronunciation.pauses.length }}곳
              </span>
            </div>
          </div>
        </div>

        <!-- 히스토리 목록 (카드형) -->
        <div v-else class="history-list">
          <div
            v-for="(item, i) in historyList"
            :key="i"
            class="card history-item"
            @click="selectedHistory = item"
          >
            <div class="history-item-header">
              <span class="history-date">{{ formatDate(item.at) }}</span>
              <div style="display:flex; gap:0.4rem; align-items:center;">
                <span
                  v-if="item.pronunciation?.overallScore != null"
                  class="history-score-badge"
                  :class="histScoreClass(item.pronunciation.overallScore)"
                >
                  {{ item.pronunciation.overallScore }}점
                </span>
                <span class="history-issues-badge" v-if="item.issues?.length">
                  이슈 {{ item.issues.length }}건
                </span>
              </div>
            </div>
            <p class="history-transcript-preview">
              {{ item.transcript?.slice(0, 80) }}{{ item.transcript?.length > 80 ? '...' : '' }}
            </p>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';

// 자식 컴포넌트들 import
import FileUpload from '../components/FileUpload.vue';       // 파일 업로드 카드
import AudioRecorder from '../components/AudioRecorder.vue'; // 마이크 녹음 카드
import ProcessingStatus from '../components/ProcessingStatus.vue'; // 분석 중 로딩 UI
import AnalysisResult from '../components/AnalysisResult.vue';     // 분석 결과 표시

// API 클라이언트
import { analyzeFile, getLatestSession, getSessionHistory } from '../api/coach.js';

// ===== 반응형 상태 변수들 =====

// -- 공통 --
const activeTab = ref('coach');       // 현재 활성 탭: 'coach'(분석하기) 또는 'history'(히스토리)
const sessionId = ref(null);          // 현재 세션 ID (서버에서 발급, 분석 이력 연결용)
const referenceText = ref('');        // 원문 텍스트 (선택사항, 입력하면 단어별 비교 모드)

// -- 분석하기 탭 --
const processing = ref(false);        // 분석 진행 중 여부
const statusMessage = ref('');        // 진행 상태 메시지 ("업로드 중...", "분석 중..." 등)
const errorMessage = ref('');         // 에러 메시지 (에러 발생 시)
const result = ref(null);             // 분석 결과 객체 (성공 시)

// -- 히스토리 탭 --
const historyList = ref([]);          // 히스토리 목록 (과거 분석 결과 배열)
const historyLoading = ref(false);    // 히스토리 로딩 중 여부
const selectedHistory = ref(null);    // 선택한 히스토리 항목 (상세 보기용, null이면 목록 표시)

// ===== 세션 복원 (페이지 새로고침 대응) =====

/**
 * [onMounted란?]
 * - Vue 컴포넌트가 화면에 처음 그려진 직후 실행되는 "생명주기 훅(lifecycle hook)"
 * - React의 useEffect(fn, [])와 비슷한 개념
 * - 여기서는: 페이지가 로드될 때 DB에서 유저의 최근 세션을 가져와 sessionId를 복원
 *
 * [왜 필요한가?]
 * - sessionId가 ref(null)로만 관리되어서 새로고침하면 사라짐
 * - 이 API 호출로 DB에서 복원 → 이전 세션에 계속 이어서 분석 가능
 */
onMounted(async () => {
  try {
    const data = await getLatestSession();
    if (data.session?.sessionId) {
      sessionId.value = data.session.sessionId;
    }
  } catch {
    // 세션 복원 실패해도 무시 (새 세션이 자동 생성됨)
  }
});

// ===== 분석하기 탭 함수들 =====

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
    // 백엔드 POST /api/analyze 호출 (원문 텍스트도 함께 전달)
    const data = await analyzeFile(file, sessionId.value ?? undefined, referenceText.value || undefined);
    sessionId.value = data.sessionId ?? sessionId.value; // 세션 ID 저장

    if (data.status === 'success') {
      // 분석 성공: 결과 저장 → AnalysisResult 컴포넌트에 표시됨
      result.value = {
        transcript: data.transcript,
        transcriptWarning: data.transcriptWarning,
        referenceText: referenceText.value || '',        // 원문 텍스트 (있으면 단어별 비교 표시)
        wordDiff: data.wordDiff ?? [],                   // 원문 비교 결과
        topIssues: data.topIssues ?? [],
        pronunciationTips: data.pronunciationTips ?? [],
        practiceSentences: data.practiceSentences ?? [],
        pronunciation: data.pronunciation ?? null,
        overallScore: data.overallScore ?? null,
        pronunciationAnalysisLLM: data.pronunciationAnalysisLLM ?? null,
        historyNote: data.historyNote ?? '',
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

// ===== 히스토리 탭 함수들 =====

/**
 * 히스토리 탭 클릭 시: 현재 세션의 분석 이력을 로드
 *
 * [동작]
 * 1. activeTab을 'history'로 변경 → 히스토리 탭 UI가 표시됨
 * 2. sessionId가 있으면 → 백엔드에서 해당 세션의 히스토리를 가져옴
 * 3. 결과를 최신순으로 정렬하여 historyList에 저장
 */
async function loadHistory() {
  activeTab.value = 'history';
  historyLoading.value = true;
  selectedHistory.value = null;  // 상세 보기 초기화 → 목록부터 표시

  try {
    if (sessionId.value) {
      const data = await getSessionHistory(sessionId.value);
      // .slice()로 복사 후 .reverse()로 최신순 정렬
      // (원본 배열은 시간순이라 오래된 게 먼저 → 뒤집어서 최신이 먼저 오게)
      historyList.value = (data.history || []).slice().reverse();
    } else {
      historyList.value = [];
    }
  } catch {
    historyList.value = [];
  } finally {
    historyLoading.value = false;
  }
}

/**
 * 날짜 문자열을 한국어 형식으로 변환
 * @param {string} dateStr - ISO 날짜 문자열 (예: "2024-01-15T09:30:00.000Z")
 * @returns {string} 한국어 형식 (예: "2024. 1. 15. 오전 9:30:00")
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString('ko-KR');
}

/** 히스토리 상세/목록에서 발음 점수 색상 클래스 반환 */
function histScoreClass(score) {
  if (score >= 80) return 'score-good';
  if (score >= 60) return 'score-ok';
  return 'score-bad';
}

/** 히스토리 상세에서 속도 등급 한국어 변환 */
function histSpeedLabel(rating) {
  const labels = { too_slow: '너무 느림', slow: '느림', good: '적절', fast: '빠름', too_fast: '너무 빠름' };
  return labels[rating] || rating || '';
}
</script>

<style scoped>
.coach-page { display: flex; flex-direction: column; gap: 1.5rem; }

/* ===== 탭 네비게이션 ===== */
.tab-nav {
  display: flex;
  gap: 0.5rem;
}
.tab-btn {
  padding: 0.5rem 1.25rem;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fff;
  font-size: 0.9rem;
  font-weight: 500;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.2s;
}
.tab-btn.active {
  background: #7c3aed;
  color: #fff;
  border-color: #7c3aed;
}
.tab-btn:hover:not(.active) {
  border-color: #d1d5db;
  background: #f9fafb;
}

/* ===== 원문 텍스트 입력 영역 ===== */
.ref-text-box {
  margin-bottom: 1rem;
}
.ref-text-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: #374151;
  margin-bottom: 0.4rem;
}
.ref-text-optional {
  font-size: 0.75rem;
  font-weight: 400;
  color: #9ca3af;
}
.ref-textarea {
  width: 100%;
  padding: 0.65rem 0.85rem;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  font-size: 0.9rem;
  font-family: inherit;
  line-height: 1.6;
  color: #1f2937;
  background: #fff;
  resize: vertical;
  box-sizing: border-box;
  transition: border-color 0.2s;
}
.ref-textarea:focus {
  outline: none;
  border-color: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.08);
}
.ref-textarea::placeholder { color: #d1d5db; }

/* ===== 입력 카드 영역 ===== */
/* 2열 그리드 (파일 업로드 | 녹음) */
.input-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.25rem;
}
/* 모바일(560px 이하): 1열로 변경 */
@media (max-width: 560px) {
  .input-cards { grid-template-columns: 1fr; }
}

/* ===== 공통 카드 스타일 ===== */
.card {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.06);
  padding: 1.25rem 1.5rem;
}
/* 에러 카드: 빨간색 테두리 + 연한 빨간 배경 */
.error-card { border: 1px solid rgba(239, 68, 68, 0.3); background: rgba(254, 226, 226, 0.5); }
.error-text { margin: 0; color: #b91c1c; font-size: 0.9rem; }

/* ===== 히스토리 목록 ===== */
.history-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.history-item {
  cursor: pointer;
  transition: box-shadow 0.2s, transform 0.1s;
  border: 1px solid rgba(0,0,0,0.04);
}
.history-item:hover {
  box-shadow: 0 6px 24px rgba(139, 92, 246, 0.1);
  transform: translateY(-1px);
}
.history-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}
.history-date {
  font-size: 0.8rem;
  color: #6b7280;
}
.history-issues-badge {
  font-size: 0.75rem;
  padding: 0.15rem 0.5rem;
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border-radius: 999px;
}
.history-transcript-preview {
  margin: 0;
  font-size: 0.9rem;
  color: #374151;
  line-height: 1.5;
}

/* ===== 히스토리 상세 보기 ===== */
.detail-card {
  padding: 1.5rem;
}
.back-btn {
  padding: 0.3rem 0.75rem;
  background: transparent;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.8rem;
  color: #6b7280;
  cursor: pointer;
}
.back-btn:hover {
  border-color: #7c3aed;
  color: #7c3aed;
}
.detail-title {
  margin: 0.5rem 0 0 0;
  font-size: 1rem;
  color: #374151;
}
.detail-section {
  margin-top: 1rem;
}
.detail-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #6b7280;
  margin: 0 0 0.35rem 0;
}
.detail-transcript {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.6;
  color: #1f2937;
  background: #f9fafb;
  padding: 0.75rem;
  border-radius: 8px;
}
.detail-list {
  margin: 0;
  padding-left: 1.25rem;
  font-size: 0.9rem;
  line-height: 1.7;
  color: #374151;
}

/* ===== 히스토리 목록 발음 점수 뱃지 ===== */
.history-score-badge {
  font-size: 0.75rem;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  font-weight: 600;
}
.history-score-badge.score-good { background: rgba(22,163,74,0.1); color: #15803d; }
.history-score-badge.score-ok   { background: rgba(245,158,11,0.1); color: #b45309; }
.history-score-badge.score-bad  { background: rgba(220,38,38,0.1);  color: #dc2626; }

/* ===== 히스토리 상세 발음 분석 요약 ===== */
.hist-pron {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}
.hist-pron-score {
  font-weight: 700;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
}
.hist-pron-score.score-good { background: rgba(22,163,74,0.1); color: #15803d; }
.hist-pron-score.score-ok   { background: rgba(245,158,11,0.1); color: #b45309; }
.hist-pron-score.score-bad  { background: rgba(220,38,38,0.1);  color: #dc2626; }
.hist-pron-speed  { color: #374151; }
.hist-pron-unclear { color: #b45309; font-size: 0.8rem; }
.hist-pron-pause   { color: #7c3aed; font-size: 0.8rem; }

/* 이슈 태그 (severity별 색상) */
.issue-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.issue-tag {
  font-size: 0.75rem;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
}
.severity-high {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
}
.severity-medium {
  background: rgba(245, 158, 11, 0.1);
  color: #d97706;
}
.severity-low {
  background: rgba(107, 114, 128, 0.1);
  color: #6b7280;
}
</style>
