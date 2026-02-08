<!--
  LoginForm.vue - 로그인/회원가입 폼 컴포넌트

  이 컴포넌트가 하는 일:
  - 로그인 모드와 회원가입 모드를 토글로 전환
  - 이메일, 비밀번호 (회원가입 시 이름 추가) 입력 폼 제공
  - 로그인/회원가입 API 호출 후 결과를 부모 컴포넌트에 전달
  - 에러 메시지 표시
-->
<template>
  <div class="login-card">
    <!-- 상단 타이틀: 현재 모드에 따라 텍스트 변경 -->
    <h2>{{ isRegister ? '회원가입' : '로그인' }}</h2>
    <p class="login-desc">
      {{ isRegister ? '계정을 만들어 분석 이력을 저장하세요' : '이메일과 비밀번호로 로그인하세요' }}
    </p>

    <!-- 로그인/회원가입 입력 폼 -->
    <form @submit.prevent="handleSubmit">
      <!-- 이름 입력: 회원가입 모드에서만 표시 -->
      <div v-if="isRegister" class="field">
        <label for="name">이름</label>
        <input
          id="name"
          v-model="name"
          type="text"
          placeholder="홍길동"
          required
        />
      </div>

      <!-- 이메일 입력 -->
      <div class="field">
        <label for="email">이메일</label>
        <input
          id="email"
          v-model="email"
          type="email"
          placeholder="example@email.com"
          required
        />
      </div>

      <!-- 비밀번호 입력 -->
      <div class="field">
        <label for="password">비밀번호</label>
        <input
          id="password"
          v-model="password"
          type="password"
          placeholder="비밀번호 입력"
          required
        />
      </div>

      <!-- 에러 메시지 표시 -->
      <p v-if="error" class="error">{{ error }}</p>

      <!-- 제출 버튼 -->
      <button type="submit" class="submit-btn" :disabled="loading">
        {{ loading ? '처리 중...' : (isRegister ? '회원가입' : '로그인') }}
      </button>
    </form>

    <!-- 로그인 ↔ 회원가입 모드 전환 -->
    <p class="toggle">
      {{ isRegister ? '이미 계정이 있으신가요?' : '계정이 없으신가요?' }}
      <a href="#" @click.prevent="toggleMode">
        {{ isRegister ? '로그인' : '회원가입' }}
      </a>
    </p>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { login, register } from '../api/auth.js';

// 부모 컴포넌트에 로그인 성공을 알리는 이벤트
const emit = defineEmits(['login-success']);

// 반응형 상태 변수들
const isRegister = ref(false); // true면 회원가입 모드, false면 로그인 모드
const email = ref('');         // 이메일 입력값
const password = ref('');      // 비밀번호 입력값
const name = ref('');          // 이름 입력값 (회원가입용)
const error = ref('');         // 에러 메시지
const loading = ref(false);    // 로딩 상태 (중복 클릭 방지)

/** 로그인 ↔ 회원가입 모드 전환 */
function toggleMode() {
  isRegister.value = !isRegister.value;
  error.value = ''; // 모드 전환 시 에러 초기화
}

/** 폼 제출 처리 (로그인 또는 회원가입) */
async function handleSubmit() {
  error.value = '';
  loading.value = true;

  try {
    if (isRegister.value) {
      // 회원가입 → 성공 후 자동으로 로그인
      await register(email.value, password.value, name.value);
      await login(email.value, password.value);
    } else {
      // 로그인
      await login(email.value, password.value);
    }
    // 성공 시 부모 컴포넌트에 알림
    emit('login-success');
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
/* 로그인 카드 스타일 */
.login-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  padding: 2rem;
  max-width: 400px;
  margin: 0 auto;
}
.login-card h2 {
  margin: 0 0 0.25rem 0;
  font-size: 1.35rem;
  color: #1f2937;
}
.login-desc {
  color: #6b7280;
  font-size: 0.9rem;
  margin: 0 0 1.5rem 0;
}
/* 입력 필드 영역 */
.field {
  margin-bottom: 1rem;
}
.field label {
  display: block;
  font-size: 0.85rem;
  font-weight: 500;
  color: #374151;
  margin-bottom: 0.35rem;
}
.field input {
  width: 100%;
  padding: 0.6rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.2s;
}
.field input:focus {
  border-color: #8b5cf6;
  box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
}
/* 에러 메시지 */
.error {
  color: #ef4444;
  font-size: 0.85rem;
  margin: 0 0 0.75rem 0;
}
/* 제출 버튼 */
.submit-btn {
  width: 100%;
  padding: 0.65rem;
  background: #7c3aed;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}
.submit-btn:hover:not(:disabled) {
  background: #6d28d9;
}
.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
/* 모드 전환 텍스트 */
.toggle {
  text-align: center;
  font-size: 0.85rem;
  color: #6b7280;
  margin: 1rem 0 0 0;
}
.toggle a {
  color: #7c3aed;
  text-decoration: none;
  font-weight: 500;
}
.toggle a:hover {
  text-decoration: underline;
}
</style>
