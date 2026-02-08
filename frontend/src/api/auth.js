/**
 * Auth API 클라이언트 - 인증 관련 백엔드 통신 함수 모음
 *
 * 이 파일이 하는 일:
 * - 회원가입 (register): 이메일, 비밀번호, 이름을 백엔드로 전송
 * - 로그인 (login): 이메일, 비밀번호로 JWT 토큰 발급
 * - 내 정보 조회 (getMe): 저장된 토큰으로 현재 사용자 정보 가져오기
 * - 토큰 관리: localStorage에 JWT 토큰 저장/삭제/조회
 */

// API 기본 경로 (Vite 프록시 설정에 의해 백엔드로 자동 포워딩됨)
const API_BASE = '/api/auth';

// ============================================================
// 토큰 관리 함수들 - localStorage에 JWT 토큰을 저장/조회/삭제
// ============================================================

/** localStorage에서 JWT 토큰 가져오기 */
export function getToken() {
  return localStorage.getItem('token');
}

/** localStorage에 JWT 토큰 저장 */
export function setToken(token) {
  localStorage.setItem('token', token);
}

/** localStorage에서 JWT 토큰 삭제 (로그아웃 시 사용) */
export function removeToken() {
  localStorage.removeItem('token');
}

/** 토큰이 존재하는지 확인 (로그인 여부 간단 체크) */
export function isLoggedIn() {
  return Boolean(getToken());
}

// ============================================================
// API 통신 함수들
// ============================================================

/**
 * 회원가입 요청
 *
 * @param {string} email - 이메일 주소
 * @param {string} password - 비밀번호
 * @param {string} name - 사용자 이름
 * @returns {Promise<Object>} { user } - 생성된 사용자 정보
 */
export async function register(email, password, name) {
  const res = await fetch(`${API_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `회원가입 실패 (HTTP ${res.status})`);
  }
  return data;
}

/**
 * 로그인 요청 - 성공 시 JWT 토큰을 localStorage에 자동 저장
 *
 * @param {string} email - 이메일 주소
 * @param {string} password - 비밀번호
 * @returns {Promise<Object>} { token, user } - JWT 토큰과 사용자 정보
 */
export async function login(email, password) {
  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `로그인 실패 (HTTP ${res.status})`);
  }

  // 로그인 성공 시 토큰을 localStorage에 자동 저장
  if (data.token) {
    setToken(data.token);
  }

  return data;
}

/**
 * 현재 로그인한 사용자 정보 조회
 * - 저장된 JWT 토큰을 Authorization 헤더에 담아서 요청
 * - 토큰이 유효하면 사용자 정보 반환, 만료/무효하면 에러
 *
 * @returns {Promise<Object>} { user } - 현재 사용자 정보
 */
export async function getMe() {
  const token = getToken();
  if (!token) {
    throw new Error('토큰이 없습니다. 로그인이 필요합니다.');
  }

  const res = await fetch(`${API_BASE}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // 토큰 만료/무효 시 저장된 토큰 삭제
    if (res.status === 401) {
      removeToken();
    }
    throw new Error(data.error || `인증 실패 (HTTP ${res.status})`);
  }

  return data;
}

/**
 * 로그아웃 - 저장된 토큰 삭제 (서버 요청 불필요, 클라이언트에서만 처리)
 */
export function logout() {
  removeToken();
}
