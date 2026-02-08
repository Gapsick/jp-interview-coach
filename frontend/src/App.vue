<!--
  App.vue - 최상위 루트 컴포넌트

  이 컴포넌트가 하는 일:
  - 로그인 상태를 확인하여 로그인 폼 또는 메인 화면을 분기
  - 페이지 전체 레이아웃 정의 (헤더 + 메인 영역)
  - 헤더에 앱 타이틀과 설명 표시 (로그인 시 사용자 이름 + 로그아웃 버튼)
  - 메인 영역에 CoachPage(실제 기능 화면) 또는 LoginForm을 렌더링
  - 전역 스타일(폰트, 배경색 등) 설정
-->
<template>
  <div class="app">
    <!-- 상단 헤더: 앱 타이틀과 간단한 설명 -->
    <header class="header">
      <span class="badge">✨ AI 발음 분석</span>
      <h1>일본어 발음 체크</h1>
      <p class="subtitle">오디오를 업로드하거나 녹음하여 발음을 분석받으세요</p>

      <!-- 로그인 상태일 때: 사용자 이름과 로그아웃 버튼 표시 -->
      <div v-if="user" class="user-bar">
        <span class="user-name">{{ user.name }}님 환영합니다</span>
        <button class="logout-btn" @click="handleLogout">로그아웃</button>
      </div>
    </header>

    <!-- 메인 영역: 로그인 상태에 따라 분기 -->
    <main>
      <!-- 로그인 안 됨 → 로그인/회원가입 폼 표시 -->
      <LoginForm v-if="!user" @login-success="checkAuth" />
      <!-- 로그인 됨 → 실제 기능 화면 표시 -->
      <CoachPage v-else />
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
// CoachPage: 파일 업로드 + 녹음 + 분석 결과 표시를 담당하는 메인 페이지 컴포넌트
import CoachPage from './views/CoachPage.vue';
// LoginForm: 로그인/회원가입 폼 컴포넌트
import LoginForm from './components/LoginForm.vue';
// 인증 API 함수들
import { getMe, logout as authLogout, isLoggedIn } from './api/auth.js';

// 현재 로그인한 사용자 정보 (null이면 로그인 안 된 상태)
const user = ref(null);

/**
 * 인증 상태 확인 함수
 * - localStorage에 토큰이 있으면 백엔드에 유효성 확인 요청
 * - 유효하면 user 정보 설정, 무효하면 null로 초기화
 */
async function checkAuth() {
  if (!isLoggedIn()) {
    user.value = null;
    return;
  }
  try {
    const data = await getMe();
    user.value = data.user;
  } catch {
    user.value = null;
  }
}

/** 로그아웃 처리: 토큰 삭제 + user 상태 초기화 */
function handleLogout() {
  authLogout();
  user.value = null;
}

// 앱 시작 시 저장된 토큰으로 로그인 상태 복원 시도
onMounted(checkAuth);
</script>

<!-- 전역 스타일 (scoped가 아니므로 앱 전체에 적용) -->
<style>
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  /* 상단 연보라 → 하단 흰색 그라데이션 배경 */
  background: linear-gradient(180deg, #f5f0fc 0%, #faf8fc 40%, #fff 100%);
  color: #374151;
  min-height: 100vh;
}
/* 앱 컨테이너: 최대 680px 너비, 가운데 정렬 */
.app { max-width: 680px; margin: 0 auto; padding: 2rem 1.5rem; min-height: 100vh; }
.header { text-align: center; margin-bottom: 2.5rem; }
/* 상단 배지 스타일 (보라색 알약 모양) */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.75rem;
  background: rgba(139, 92, 246, 0.12);
  border: 1px solid rgba(139, 92, 246, 0.25);
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 500;
  color: #6d28d9;
  margin-bottom: 0.75rem;
}
.header h1 { font-size: 1.75rem; font-weight: 700; margin: 0 0 0.35rem 0; color: #1f2937; letter-spacing: -0.02em; }
.subtitle { color: #6b7280; font-size: 0.95rem; margin: 0; font-weight: 400; }

/* 사용자 정보 바 (로그인 상태일 때 헤더 하단에 표시) */
.user-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin-top: 1rem;
}
.user-name {
  font-size: 0.9rem;
  color: #374151;
  font-weight: 500;
}
.logout-btn {
  padding: 0.3rem 0.75rem;
  background: transparent;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.8rem;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.2s;
}
.logout-btn:hover {
  border-color: #ef4444;
  color: #ef4444;
}
</style>
