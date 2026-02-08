/**
 * 사용자 저장소 - 회원 데이터 관리
 *
 * 이 파일이 하는 일:
 * 1. 사용자 데이터를 메모리(Map)에 저장하고 관리
 * 2. data/users.json 파일에 영구 저장 (서버 재시작 후에도 유지)
 * 3. 사용자 생성, 이메일로 조회, ID로 조회 기능 제공
 *
 * sessionStore.ts와 동일한 패턴 (메모리 Map + JSON 파일)
 * 추후 MongoDB로 전환 예정
 */
import { v4 as uuidv4 } from 'uuid'; // 고유한 사용자 ID 생성용
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ===== 타입 정의 =====

/** 사용자 정보 타입 */
export type User = {
  id: string;           // 고유 사용자 ID (UUID)
  email: string;        // 이메일 (로그인용, 중복 불가)
  passwordHash: string; // bcrypt로 해싱된 비밀번호
  name: string;         // 사용자 이름
  createdAt: string;    // 가입 시각 (ISO 문자열)
};

/** 비밀번호 해시를 제외한 안전한 사용자 정보 (응답용) */
export type SafeUser = Omit<User, 'passwordHash'>;

// ===== 저장소 초기화 =====

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 메모리에 사용자 데이터를 저장하는 Map (key: userId, value: User)
const users = new Map<string, User>();

// JSON 파일 저장 경로 (backend/data/users.json)
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

/** data 폴더가 없으면 생성 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ===== 사용자 관리 함수들 =====

/**
 * 서버 시작 시 호출: data/users.json에서 사용자 데이터를 메모리로 로드
 */
export function loadUsers() {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) return; // 파일이 없으면 건너뜀 (첫 실행 시)
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    const arr = JSON.parse(data) as User[];
    arr.forEach((u) => users.set(u.id, u)); // 각 사용자를 Map에 등록
    console.log(`[UserStore] ${arr.length}명의 사용자 데이터 로드 완료`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('UserStore: could not load users file', msg);
  }
}

/**
 * 현재 메모리의 사용자 데이터를 data/users.json에 저장
 */
function saveUsers() {
  ensureDataDir();
  try {
    const arr = Array.from(users.values());
    fs.writeFileSync(USERS_FILE, JSON.stringify(arr, null, 2), 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('UserStore: could not save users file', msg);
  }
}

/**
 * 이메일로 사용자 조회
 * @param email - 찾을 이메일 주소
 * @returns User 객체 또는 undefined (없으면)
 */
export function findByEmail(email: string): User | undefined {
  for (const user of users.values()) {
    if (user.email === email) return user;
  }
  return undefined;
}

/**
 * ID로 사용자 조회
 * @param id - 찾을 사용자 ID
 * @returns User 객체 또는 undefined
 */
export function findById(id: string): User | undefined {
  return users.get(id);
}

/**
 * 새 사용자 생성
 * @param email - 이메일 주소
 * @param passwordHash - bcrypt로 해싱된 비밀번호
 * @param name - 사용자 이름
 * @returns 생성된 User 객체
 */
export function createUser(email: string, passwordHash: string, name: string): User {
  const user: User = {
    id: uuidv4(),                       // 고유 ID 발급
    email,
    passwordHash,
    name,
    createdAt: new Date().toISOString(), // 현재 시각 기록
  };
  users.set(user.id, user);
  saveUsers(); // 즉시 파일에 저장
  return user;
}

/**
 * User 객체에서 비밀번호 해시를 제거한 안전한 버전 반환
 * API 응답에 사용 (비밀번호 해시가 클라이언트에 노출되면 안 됨)
 */
export function toSafeUser(user: User): SafeUser {
  const { passwordHash, ...safe } = user;
  return safe;
}
