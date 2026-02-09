/**
 * 인증 서비스 - 회원가입/로그인 비즈니스 로직
 *
 * 이 파일이 하는 일:
 * 1. 회원가입: 이메일 중복 확인 → 비밀번호 bcrypt 해싱 → 사용자 생성
 * 2. 로그인: 이메일로 사용자 조회 → 비밀번호 검증 → JWT 토큰 발급
 * 3. 토큰 검증: JWT 토큰을 해독하여 사용자 정보 반환
 *
 * [MongoDB 전환으로 인한 변경점]
 * - findByEmail, findById, createUser가 모두 async 함수로 변경됨
 * - 따라서 이들을 호출하는 코드에 await를 추가해야 함
 * - verifyToken도 async로 변경됨 (findById가 async이므로)
 */
import bcrypt from 'bcryptjs';    // 비밀번호 해싱 라이브러리
import jwt from 'jsonwebtoken';   // JWT 토큰 생성/검증 라이브러리

import { config } from '../config.js';
import { findByEmail, createUser, findById, toSafeUser, type SafeUser } from './userStore.js';

// bcrypt 해싱 라운드 수 (높을수록 보안 강하지만 느려짐, 10이 일반적)
const SALT_ROUNDS = 10;
// JWT 토큰 만료 시간 (24시간)
const TOKEN_EXPIRY = '24h';

/** JWT 토큰의 페이로드(내용물) 타입 */
export type TokenPayload = {
  userId: string; // 사용자 ID (MongoDB의 _id 문자열)
  email: string;  // 이메일
};

/**
 * 회원가입 처리
 *
 * @param email - 이메일 주소
 * @param password - 비밀번호 (평문, 해싱 전)
 * @param name - 사용자 이름
 * @returns 생성된 사용자 정보 (비밀번호 해시 제외)
 * @throws 이메일 중복, 유효성 검사 실패 시 에러
 */
export async function register(email: string, password: string, name: string): Promise<SafeUser> {
  // 이메일 형식 검증
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('이메일 형식이 올바르지 않습니다.');
  }

  // 비밀번호 최소 길이 검증
  if (password.length < 6) {
    throw new Error('비밀번호는 최소 6자 이상이어야 합니다.');
  }

  // 이름 검증
  if (!name || name.trim().length === 0) {
    throw new Error('이름을 입력해주세요.');
  }

  // 이메일 중복 확인 (await 추가: MongoDB 조회는 비동기)
  const existing = await findByEmail(email);
  if (existing) {
    throw new Error('이미 등록된 이메일입니다.');
  }

  // 비밀번호를 bcrypt로 해싱 (평문 저장 금지!)
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // 사용자 생성 (await 추가: MongoDB에 저장하는 비동기 작업)
  const user = await createUser(email, passwordHash, name);

  // 비밀번호 해시를 제외한 안전한 사용자 정보 반환
  return toSafeUser(user);
}

/**
 * 로그인 처리
 *
 * @param email - 이메일 주소
 * @param password - 비밀번호 (평문)
 * @returns { token, user } - JWT 토큰과 사용자 정보
 * @throws 이메일/비밀번호 불일치 시 에러
 */
export async function login(email: string, password: string): Promise<{ token: string; user: SafeUser }> {
  // 이메일로 사용자 조회 (await 추가)
  const user = await findByEmail(email);
  if (!user) {
    throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
  }

  // 입력된 비밀번호와 저장된 해시 비교
  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
  }

  // JWT 토큰 생성
  // [MongoDB 전환 후 변경점]
  // - 이전: user.id (UUID 문자열)
  // - 현재: user._id.toString() (MongoDB ObjectId → 문자열)
  const payload: TokenPayload = { userId: user._id.toString(), email: user.email };
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: TOKEN_EXPIRY });

  return { token, user: toSafeUser(user) };
}

/**
 * JWT 토큰 검증 및 사용자 정보 반환
 *
 * [MongoDB 전환으로 인한 변경]
 * - findById가 async로 변경되었으므로 이 함수도 async로 변경
 * - 이 함수를 호출하는 authMiddleware도 async로 변경 필요
 *
 * @param token - 검증할 JWT 토큰
 * @returns 안전한 사용자 정보 (비밀번호 해시 제외)
 * @throws 토큰이 유효하지 않거나 만료된 경우 에러
 */
export async function verifyToken(token: string): Promise<SafeUser> {
  // JWT 검증 (서명 확인 + 만료 확인)
  const decoded = jwt.verify(token, config.jwtSecret) as TokenPayload;

  // 토큰에 담긴 userId로 사용자 조회 (await 추가)
  const user = await findById(decoded.userId);
  if (!user) {
    throw new Error('사용자를 찾을 수 없습니다.');
  }

  return toSafeUser(user);
}
