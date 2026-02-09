/**
 * 세션 저장소 - MongoDB를 통한 분석 이력 관리
 *
 * 이 파일이 하는 일:
 * 1. MongoDB의 sessions Collection에서 세션 데이터를 CRUD
 * 2. 세션 생성, 분석 결과 추가, 세션 조회 기능 제공
 *
 * [이전 버전과의 차이점]
 * - 이전: Map(메모리) + JSON 파일로 데이터 관리
 * - 현재: MongoDB + Mongoose로 데이터 관리
 * - 주요 변화: 모든 함수가 async/await로 변경됨
 */
import { v4 as uuidv4 } from 'uuid';
import { SessionModel, type ISession, type AnalysisResult, type RuleIssue } from '../models/Session.js';

// 타입을 re-export (다른 파일에서 import할 수 있도록)
export type { AnalysisResult, RuleIssue };

// ===== 세션 관리 함수들 =====

/**
 * 새 세션 생성
 *
 * [동작 과정]
 * 1. UUID로 고유한 sessionId 생성
 * 2. MongoDB에 빈 history 배열을 가진 새 Session Document 저장
 * 3. 생성된 sessionId 반환
 *
 * @returns 생성된 세션 ID (UUID 문자열)
 */
export async function createSession(): Promise<string> {
  const sessionId = uuidv4();

  // SessionModel.create()로 새 세션을 MongoDB에 저장
  await SessionModel.create({
    sessionId,
    history: [], // 빈 히스토리로 시작 (분석 결과가 추가될 때마다 여기에 push됨)
  });

  return sessionId;
}

/**
 * 세션에 분석 결과 추가
 *
 * [.findOneAndUpdate() 설명]
 * - 조건에 맞는 Document를 찾아서 수정하는 메서드
 * - findOne() + update()를 한 번에 하는 것 (원자적 연산 = atomic operation)
 * - 원자적이란? → 찾기와 수정이 동시에 일어나서 중간에 다른 요청이 끼어들 수 없음
 *
 * [$push 연산자]
 * - MongoDB의 배열 업데이트 연산자
 * - 배열의 끝에 새 요소를 추가 (JavaScript의 Array.push()와 같은 역할)
 * - 예: { $push: { history: newItem } } → history 배열에 newItem을 추가
 *
 * [다른 유용한 배열 연산자들]
 * - $pull: 배열에서 조건에 맞는 요소 제거
 * - $addToSet: 중복 없이 배열에 추가 (Set처럼)
 * - $pop: 배열의 첫 번째(−1) 또는 마지막(1) 요소 제거
 *
 * @param sessionId - 대상 세션 ID
 * @param result - 추가할 분석 결과
 */
export async function addResult(sessionId: string, result: AnalysisResult): Promise<void> {
  await SessionModel.findOneAndUpdate(
    { sessionId },                   // 조건: sessionId가 일치하는 Document를 찾아서
    {
      $push: {                       // $push: 배열에 새 요소 추가
        history: {
          at: new Date().toISOString(), // 분석 시각 기록
          ...result,                    // 분석 결과 데이터 (transcript, issues, tips 등)
        },
      },
    }
  );
}

/**
 * 세션 조회
 *
 * @param sessionId - 조회할 세션 ID
 * @returns Session Document 또는 null
 */
export async function getSession(sessionId: string): Promise<ISession | null> {
  // sessionId 필드가 일치하는 세션을 조회
  const session = await SessionModel.findOne({ sessionId });
  return session;
}

/**
 * 세션 ID가 있으면 기존 세션 사용, 없거나 유효하지 않으면 새 세션 생성
 *
 * [.exists() 설명]
 * - 조건에 맞는 Document가 존재하는지만 확인 (Document 전체를 가져오지 않음)
 * - findOne()보다 가벼움 (데이터를 전송하지 않고 존재 여부만 확인)
 * - 결과: { _id: ObjectId } 또는 null
 *
 * @param sessionId - 클라이언트가 보낸 세션 ID (없을 수 있음)
 * @returns 유효한 세션 ID
 */
export async function getOrCreateSession(sessionId?: string): Promise<string> {
  // sessionId가 있으면 MongoDB에서 해당 세션이 실제로 존재하는지 확인
  if (sessionId) {
    const exists = await SessionModel.exists({ sessionId });
    if (exists) return sessionId; // 존재하면 기존 세션 재사용
  }

  // 존재하지 않거나 sessionId가 없으면 새 세션 생성
  return createSession();
}
