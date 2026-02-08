/**
 * 세션 저장소 - 사용자별 분석 이력 관리
 *
 * 이 파일이 하는 일:
 * 1. 세션(분석 이력)을 메모리(Map)에 저장하고 관리
 * 2. data/sessions.json 파일에 영구 저장 (서버 재시작 후에도 유지)
 * 3. 세션 생성, 결과 추가, 세션 조회 기능 제공
 *
 * 세션 구조: 하나의 세션 = 한 사용자의 여러 분석 결과(history) 모음
 */
import { v4 as uuidv4 } from 'uuid'; // UUID 생성 라이브러리 (고유한 세션 ID 생성)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ===== 타입 정의 =====

/** 규칙 분석에서 검출된 이슈 하나의 타입 */
export type RuleIssue = { id: string; name: string; severity: 'high' | 'medium' | 'low'; detail?: string };

/** 한 번의 분석 결과 타입 */
export type AnalysisResult = {
  transcript: string;              // STT로 인식된 텍스트
  issues: RuleIssue[];             // 규칙 분석에서 검출된 이슈 목록
  topIssues: string[];             // LLM이 생성한 주요 개선점
  pronunciationTips: string[];     // LLM이 생성한 발음 팁
  practiceSentences: string[];     // LLM이 생성한 연습 문장
  rawAnalysis?: Record<string, unknown>; // 기타 원본 분석 데이터
};

/** 세션 히스토리 아이템: 분석 결과 + 분석 시각(at) */
export type SessionHistoryItem = { at: string } & AnalysisResult;

/** 세션 타입: 세션 ID, 생성 시각, 분석 히스토리 배열 */
export type Session = {
  sessionId: string;
  createdAt: string;
  history: SessionHistoryItem[];
};

// ===== 세션 저장소 초기화 =====

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 메모리에 세션 데이터를 저장하는 Map (key: sessionId, value: Session)
const sessions = new Map<string, Session>();

// JSON 파일 저장 경로 (backend/data/sessions.json)
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

/** data 폴더가 없으면 생성 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ===== 세션 관리 함수들 =====

/**
 * 서버 시작 시 호출: data/sessions.json에서 이전 세션 데이터를 메모리로 로드
 */
export function loadSessions() {
  ensureDataDir();
  if (!fs.existsSync(SESSIONS_FILE)) return; // 파일이 없으면 건너뜀 (첫 실행 시)
  try {
    const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
    const arr = JSON.parse(data) as Session[];
    arr.forEach((s) => sessions.set(s.sessionId, s)); // 각 세션을 Map에 등록
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('SessionStore: could not load sessions file', msg);
  }
}

/**
 * 현재 메모리의 세션 데이터를 data/sessions.json에 저장
 * 세션 생성/결과 추가 시마다 호출되어 자동 영구 저장
 */
function saveSessions() {
  ensureDataDir();
  try {
    const arr = Array.from(sessions.values());
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(arr, null, 2), 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('SessionStore: could not save sessions file', msg);
  }
}

/**
 * 새 세션 생성: UUID를 발급하고 빈 히스토리로 초기화
 * @returns 생성된 세션 ID
 */
export function createSession(): string {
  const sessionId = uuidv4();
  const session: Session = {
    sessionId,
    createdAt: new Date().toISOString(),
    history: [],
  };
  sessions.set(sessionId, session);
  saveSessions(); // 즉시 파일에 저장
  return sessionId;
}

/**
 * 세션에 분석 결과 추가: 타임스탬프와 함께 히스토리에 push
 * @param sessionId - 대상 세션 ID
 * @param result - 추가할 분석 결과
 */
export function addResult(sessionId: string, result: AnalysisResult) {
  const session = sessions.get(sessionId);
  if (!session) return; // 해당 세션이 없으면 무시
  session.history.push({
    at: new Date().toISOString(), // 분석 시각 기록
    ...result,
  });
  saveSessions(); // 즉시 파일에 저장
}

/**
 * 세션 조회
 * @param sessionId - 조회할 세션 ID
 * @returns Session 객체 또는 undefined
 */
export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

/**
 * 세션 ID가 있으면 기존 세션 사용, 없거나 유효하지 않으면 새 세션 생성
 * @param sessionId - 클라이언트가 보낸 세션 ID (없을 수 있음)
 * @returns 유효한 세션 ID
 */
export function getOrCreateSession(sessionId?: string): string {
  if (sessionId && sessions.has(sessionId)) return sessionId; // 기존 세션 있으면 재사용
  return createSession(); // 없으면 새로 생성
}
