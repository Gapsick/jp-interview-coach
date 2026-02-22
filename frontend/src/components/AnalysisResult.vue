<!--
  AnalysisResult.vue - 분석 결과 (인라인 diff + 발음 분석)

  섹션 순서 (UX 우선순위 기준):
  1. 헤더: 점수(라벨 포함) + WPM + 속도
  2. 🔥 오늘의 훈련 루틴 (점수 바로 아래 → 행동 유도)
  3. 단어별 비교 (reference 모드)
  4. 인식된 텍스트 (free 모드)
  5. 발음 분석
  6. 다시 시작 버튼
-->
<template>
  <section class="analysis-result">

    <!-- ===== 1. 헤더: 점수 + 발음 수치 ===== -->
    <div class="result-header card">
      <div class="header-row">

        <!-- 점수 그룹 -->
        <div class="scores-group">
          <!-- 정확도 점수 (LLM) -->
          <div v-if="overallScore != null" class="score-item">
            <div class="score-circle" :class="scoreClass(overallScore)">
              <span class="score-num">{{ overallScore }}</span>
            </div>
            <span class="score-item-label">{{ referenceText ? '정확도' : '종합' }}</span>
            <!-- 점수 등급 레이블 (좋음/보통/개선 필요) -->
            <span class="score-grade" :class="scoreClass(overallScore)">{{ scoreLabel(overallScore) }}</span>
          </div>

          <!-- 발음 점수 (Whisper) -->
          <div v-if="pronunciation" class="score-item">
            <div class="score-circle" :class="scoreClass(pronunciation.overallScore)">
              <span class="score-num">{{ pronunciation.overallScore }}</span>
            </div>
            <span class="score-item-label">발음</span>
            <span class="score-grade" :class="scoreClass(pronunciation.overallScore)">{{ scoreLabel(pronunciation.overallScore) }}</span>
          </div>
        </div>

        <!-- 오른쪽: WPM + 속도 뱃지 -->
        <div v-if="pronunciation" class="header-metrics">
          <span class="metric-item">
            <span class="metric-val">{{ pronunciation.speakingSpeed.wpm }}</span>
            <span class="metric-key">WPM</span>
          </span>
          <span class="divider">·</span>
          <span class="metric-item">
            <span class="metric-val">{{ pronunciation.totalDuration }}초</span>
            <span class="metric-key">발화</span>
          </span>
          <span class="divider">·</span>
          <span class="speed-badge" :class="'speed-' + pronunciation.speakingSpeed.rating">
            {{ speedLabel(pronunciation.speakingSpeed.rating) }}
          </span>
        </div>
      </div>

      <!-- 짧은 녹음 경고 -->
      <p v-if="transcriptWarning" class="transcript-warning">⚠ {{ transcriptWarning }}</p>
      <!-- 과거 이력 트렌드 -->
      <p v-if="historyNote" class="history-note">{{ historyNote }}</p>
    </div>

    <!-- ===== 2. 오늘의 훈련 루틴 (점수 바로 아래 배치) ===== -->
    <!--
      [왜 여기에 위치하는가?]
      - 사용자는 점수를 본 직후 "그래서 뭘 해야 하지?"를 가장 궁금해함
      - 루틴을 먼저 보여주면 "리포트 읽기"가 아니라 "훈련 시작"으로 흐름이 전환됨
      - 단어 비교/발음 분석은 루틴의 근거로서 아래에서 확인 가능
    -->
    <div v-if="trainingRoutine?.length" class="card block routine-card">
      <div class="routine-header">
        <h3 class="block-title routine-title">오늘의 훈련 루틴</h3>
        <!-- 다시 녹음하기: 루틴을 훈련하고 바로 재측정으로 이어지는 핵심 플로우 -->
        <button class="btn btn-restart" @click="$emit('reset')">🔁 다시 녹음</button>
      </div>
      <ol class="routine-list">
        <li
          v-for="(step, i) in trainingRoutine"
          :key="i"
          class="routine-step"
          :class="i === 0 ? 'routine-step-focus' : 'routine-step-drill'"
        >
          {{ step }}
        </li>
      </ol>
    </div>

    <!-- ===== 3. 단어별 비교 (reference 모드) ===== -->
    <div v-if="referenceText && wordDiff.length" class="card block">
      <div class="diff-header">
        <h3 class="block-title">· 단어별 비교</h3>
        <div class="diff-counts">
          <span v-if="wrongCount > 0" class="diff-cnt wrong">의미 오류 {{ wrongCount }}</span>
          <span v-if="missingCount > 0" class="diff-cnt missing">누락 {{ missingCount }}</span>
          <span v-if="minorCount > 0" class="diff-cnt minor">표기 차이 {{ minorCount }}</span>
          <span v-if="wrongCount === 0 && missingCount === 0" class="diff-cnt perfect">완벽!</span>
        </div>
      </div>

      <!-- 인라인 형태소 diff 흐름 -->
      <div class="diff-flow">
        <span
          v-for="(item, i) in wordDiff"
          :key="i"
          class="diff-token"
          :class="tokenClass(item)"
        >
          <span class="token-ref">{{ item.ref || item.hyp }}</span>
          <span v-if="item.kind === 'replace' && item.severity === 'low'" class="token-minor-label">표기</span>
          <span v-else-if="item.kind === 'replace' && item.hyp" class="token-heard">{{ item.hyp }}</span>
          <span v-else-if="item.kind === 'delete'" class="token-missing-mark">빠짐</span>
          <span v-else-if="item.kind === 'insert'" class="token-heard">+추가</span>
        </span>
      </div>

      <!-- 오발음 상세 목록 -->
      <div v-if="wrongItems.length" class="wrong-list">
        <p class="wrong-list-title">오발음 상세</p>
        <div class="wrong-list-items">
          <span v-for="(item, i) in wrongItems" :key="i" class="wrong-list-item">
            <span class="wl-ref">{{ item.ref }}</span>
            <span class="wl-arrow">→</span>
            <span class="wl-heard">{{ item.hyp }}</span>
          </span>
        </div>
      </div>
    </div>

    <!-- ===== 4. 인식된 텍스트 (free 모드) ===== -->
    <div v-else-if="transcript" class="card block">
      <h3 class="block-title">· 인식된 텍스트</h3>
      <p class="transcript-text">{{ transcript }}</p>
    </div>

    <!-- ===== 5. 발음 분석 ===== -->
    <div
      v-if="pronunciationAnalysisLLM?.evidence || pronunciation?.unclearSegments?.length || pronunciation?.pauses?.length || pronunciationAnalysisLLM?.tips?.length"
      class="card block"
    >
      <h3 class="block-title">· 발음 분석</h3>

      <p v-if="pronunciationAnalysisLLM?.evidence" class="pron-evidence">
        {{ pronunciationAnalysisLLM.evidence }}
      </p>

      <div v-if="pronunciation?.unclearSegments?.length" class="pron-row">
        <span class="pron-row-label">⚠ 불명확 구간</span>
        <span
          v-for="(seg, i) in pronunciation.unclearSegments"
          :key="i"
          class="pron-badge unclear"
        >
          「{{ seg.text }}」<small>{{ Math.round(seg.confidence * 100) }}%</small>
        </span>
        <span class="pron-hint">Whisper가 이 구간 인식에 자신 없었음 → 발음을 더 또렷하게</span>
      </div>

      <div v-if="pronunciation?.pauses?.length" class="pron-row">
        <span class="pron-row-label">⏸ 긴 쉼</span>
        <span
          v-for="(pause, i) in pronunciation.pauses"
          :key="i"
          class="pron-badge pause"
        >
          「{{ pause.afterWord }}」뒤 {{ pause.duration }}초
        </span>
      </div>

      <ul v-if="pronunciationAnalysisLLM?.tips?.length" class="tip-list">
        <li v-for="(tip, i) in pronunciationAnalysisLLM.tips" :key="i">{{ tip }}</li>
      </ul>
    </div>

    <!-- 다시 시작 버튼 (하단) -->
    <div class="actions">
      <button type="button" class="btn btn-secondary" @click="$emit('reset')">다시 시작</button>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  transcript: { type: String, default: '' },
  transcriptWarning: { type: String, default: '' },
  referenceText: { type: String, default: '' },
  wordDiff: { type: Array, default: () => [] },
  topIssues: { type: Array, default: () => [] },
  pronunciationTips: { type: Array, default: () => [] },
  trainingRoutine: { type: Array, default: () => [] },
  pronunciation: { type: Object, default: null },
  overallScore: { type: Number, default: null },
  pronunciationAnalysisLLM: { type: Object, default: null },
  historyNote: { type: String, default: '' },
});

defineEmits(['reset']);

// 오발음/누락 카운트
const wrongCount = computed(() =>
  props.wordDiff.filter(w => w.kind === 'replace' && w.severity !== 'low').length
);
const missingCount = computed(() => props.wordDiff.filter(w => w.kind === 'delete').length);
const minorCount = computed(() =>
  props.wordDiff.filter(w => w.kind === 'replace' && w.severity === 'low').length
);

const wrongItems = computed(() =>
  props.wordDiff.filter(w => w.kind === 'replace' && w.hyp && w.severity !== 'low')
);

function tokenClass(item) {
  if (item.kind === 'equal') return 'token-correct';
  if (item.kind === 'delete') return 'token-missing';
  if (item.kind === 'insert') return 'token-insert';
  if (item.kind === 'replace') {
    if (item.severity === 'low') return 'token-minor';
    if (item.severity === 'medium') return 'token-warn';
    return 'token-wrong';
  }
  return '';
}

function scoreClass(score) {
  if (score >= 80) return 'score-good';
  if (score >= 60) return 'score-ok';
  return 'score-bad';
}

// 점수 등급 텍스트 (헤더 아래 감정적 연결용)
function scoreLabel(score) {
  if (score >= 80) return '좋음';
  if (score >= 60) return '보통';
  return '개선 필요';
}

function speedLabel(rating) {
  const labels = {
    too_slow: '너무 느림',
    slow: '느림',
    good: '적절',
    fast: '빠름',
    too_fast: '너무 빠름',
  };
  return labels[rating] || rating;
}
</script>

<style scoped>
.analysis-result { display: flex; flex-direction: column; gap: 1rem; }

/* ===== 헤더 카드 ===== */
.result-header {
  padding: 1rem 1.25rem;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.06);
  border: 1px solid rgba(0,0,0,0.04);
}
.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

/* 점수 그룹 */
.scores-group { display: flex; align-items: center; gap: 0.85rem; }
.score-item { display: flex; flex-direction: column; align-items: center; gap: 0.1rem; }
.score-circle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 3px solid currentColor;
}
.score-circle.score-good { color: #16a34a; background: rgba(22,163,74,0.07); }
.score-circle.score-ok   { color: #d97706; background: rgba(217,119,6,0.07); }
.score-circle.score-bad  { color: #dc2626; background: rgba(220,38,38,0.07); }
.score-num { font-size: 1.1rem; font-weight: 700; }
.score-item-label { font-size: 0.68rem; color: #9ca3af; font-weight: 500; }

/* 점수 등급 레이블 */
.score-grade {
  font-size: 0.7rem;
  font-weight: 600;
}
.score-grade.score-good { color: #16a34a; }
.score-grade.score-ok   { color: #d97706; }
.score-grade.score-bad  { color: #dc2626; }

/* 오른쪽 수치 메트릭 */
.header-metrics { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.metric-item { display: flex; flex-direction: column; align-items: center; line-height: 1.2; }
.metric-val { font-size: 0.95rem; font-weight: 700; color: #1f2937; }
.metric-key { font-size: 0.68rem; color: #9ca3af; }
.divider { color: #e5e7eb; font-size: 0.8rem; }

/* 속도 뱃지 */
.speed-badge { font-size: 0.72rem; padding: 0.15rem 0.5rem; border-radius: 999px; font-weight: 500; }
.speed-good     { background: rgba(22,163,74,0.1);  color: #15803d; }
.speed-slow,
.speed-fast     { background: rgba(245,158,11,0.1); color: #b45309; }
.speed-too_slow,
.speed-too_fast { background: rgba(220,38,38,0.1);  color: #dc2626; }

.transcript-warning { margin: 0.5rem 0 0 0; font-size: 0.8rem; color: #ea580c; }
.history-note {
  margin: 0.6rem 0 0 0;
  padding: 0.45rem 0.75rem;
  background: #f5f3ff;
  border-left: 3px solid #7c3aed;
  border-radius: 0 8px 8px 0;
  font-size: 0.82rem;
  color: #5b21b6;
  line-height: 1.5;
}

/* ===== 공통 블록 카드 ===== */
.card.block {
  padding: 1rem 1.25rem;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.06);
  border: 1px solid rgba(0,0,0,0.04);
}
.block-title { font-size: 0.88rem; font-weight: 600; margin: 0; color: #374151; }

/* ===== 훈련 루틴 카드 ===== */
.routine-card {
  border: 1px solid rgba(124,58,237,0.15);
  background: #fff;
}
.routine-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.85rem;
}
.routine-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: #5b21b6;
}
.routine-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

/* 첫 번째 단계 (🎯 오늘의 집중): 강조 스타일 */
.routine-step-focus {
  font-size: 0.92rem;
  font-weight: 700;
  color: #4c1d95;
  line-height: 1.5;
  padding: 0.65rem 0.9rem;
  background: #ede9fe;
  border-left: 4px solid #7c3aed;
  border-radius: 0 10px 10px 0;
  box-shadow: 0 2px 8px rgba(124,58,237,0.1);
}

/* 드릴 단계 (1️⃣ 2️⃣ 3️⃣): 카드 스타일 */
.routine-step-drill {
  font-size: 0.9rem;
  color: #1f2937;
  line-height: 1.5;
  padding: 0.55rem 0.85rem;
  background: #f5f3ff;
  border-left: 3px solid #a78bfa;
  border-radius: 0 10px 10px 0;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}

/* 재녹음 버튼 */
.btn-restart {
  padding: 0.35rem 0.85rem;
  background: #7c3aed;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s;
  white-space: nowrap;
}
.btn-restart:hover { background: #6d28d9; }

/* ===== 단어별 비교 (diff) ===== */
.diff-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.85rem;
}
.diff-counts { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.diff-cnt {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
}
.diff-cnt.wrong   { background: rgba(220,38,38,0.1); color: #dc2626; }
.diff-cnt.missing { background: rgba(107,114,128,0.1); color: #6b7280; }
.diff-cnt.minor   { background: rgba(234,179,8,0.1); color: #a16207; }
.diff-cnt.perfect { background: rgba(22,163,74,0.1); color: #15803d; }

/* 인라인 형태소 흐름 */
.diff-flow {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.2rem 0.1rem;
  line-height: 1;
  padding: 0.5rem 0;
}

.diff-token {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  padding: 0.25rem 0.3rem;
  border-radius: 5px;
  cursor: default;
}

.token-correct .token-ref { font-size: 1rem; color: #6b7280; line-height: 1.4; }

.token-wrong { background: rgba(220,38,38,0.06); border-radius: 6px; }
.token-wrong .token-ref {
  font-size: 1rem; color: #dc2626; font-weight: 700;
  text-decoration: underline; text-decoration-style: wavy;
  text-decoration-color: rgba(220,38,38,0.6); line-height: 1.4;
}
.token-heard {
  font-size: 0.65rem; color: #b91c1c; margin-top: 2px;
  white-space: nowrap; max-width: 120px; overflow: hidden; text-overflow: ellipsis;
}
.token-warn .token-heard { color: #c2410c; }

.token-minor { background: rgba(234,179,8,0.07); border-radius: 6px; }
.token-minor .token-ref {
  font-size: 1rem; color: #a16207;
  text-decoration: underline; text-decoration-style: dotted;
  text-decoration-color: rgba(161,98,7,0.5); line-height: 1.4;
}
.token-minor-label { font-size: 0.6rem; color: #a16207; margin-top: 2px; }

.token-warn { background: rgba(234,88,12,0.06); border-radius: 6px; }
.token-warn .token-ref {
  font-size: 1rem; color: #ea580c; font-weight: 600;
  text-decoration: underline; text-decoration-style: wavy;
  text-decoration-color: rgba(234,88,12,0.5); line-height: 1.4;
}

.token-insert .token-ref { font-size: 1rem; color: #7c3aed; font-style: italic; line-height: 1.4; }

.token-missing .token-ref {
  font-size: 1rem; color: #d1d5db;
  text-decoration: line-through; text-decoration-color: #9ca3af; line-height: 1.4;
}
.token-missing-mark { font-size: 0.6rem; color: #9ca3af; margin-top: 2px; }

/* 오발음 상세 */
.wrong-list { margin-top: 0.85rem; padding-top: 0.75rem; border-top: 1px solid #f3f4f6; }
.wrong-list-title { font-size: 0.78rem; font-weight: 600; color: #9ca3af; margin: 0 0 0.5rem 0; }
.wrong-list-items { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.wrong-list-item {
  display: inline-flex; align-items: center; gap: 0.3rem;
  font-size: 0.85rem; background: rgba(220,38,38,0.05);
  padding: 0.2rem 0.6rem; border-radius: 6px; border: 1px solid rgba(220,38,38,0.15);
}
.wl-ref   { color: #dc2626; font-weight: 600; }
.wl-arrow { color: #9ca3af; }
.wl-heard { color: #374151; }

/* ===== 인식된 텍스트 (free 모드) ===== */
.transcript-text {
  margin: 0; font-size: 0.9rem; white-space: pre-wrap; word-break: break-word;
  color: #374151; line-height: 1.7; background: #f9fafb;
  padding: 0.6rem 0.8rem; border-radius: 8px;
}

/* ===== 발음 분석 ===== */
.pron-evidence { margin: 0 0 0.75rem 0; font-size: 0.86rem; color: #374151; line-height: 1.6; }
.pron-row { display: flex; align-items: center; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.6rem; }
.pron-row-label { font-size: 0.78rem; font-weight: 600; color: #6b7280; min-width: 72px; }
.pron-badge { font-size: 0.78rem; padding: 0.15rem 0.5rem; border-radius: 999px; }
.pron-badge.unclear { background: rgba(220,38,38,0.08); color: #b91c1c; }
.pron-badge.pause   { background: rgba(124,58,237,0.08); color: #7c3aed; }
.pron-hint { font-size: 0.74rem; color: #9ca3af; width: 100%; margin-top: 0.1rem; }

.tip-list { margin: 0.5rem 0 0 0; padding-left: 1.1rem; font-size: 0.86rem; color: #374151; line-height: 1.7; }
.tip-list li { margin-bottom: 0.15rem; }

/* ===== 액션 버튼 ===== */
.actions { display: flex; gap: 0.75rem; flex-wrap: wrap; }
.btn { padding: 0.55rem 1.1rem; border-radius: 10px; font-size: 0.88rem; font-weight: 500; cursor: pointer; border: none; font-family: inherit; }
.btn-secondary { background: #fff; color: #374151; border: 1px solid #e5e7eb; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
.btn-secondary:hover { background: #f9fafb; border-color: #d1d5db; }
</style>
