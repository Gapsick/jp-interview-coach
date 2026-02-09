/**
 * 사용자 저장소 - MongoDB를 통한 회원 데이터 관리
 *
 * 이 파일이 하는 일:
 * 1. MongoDB의 users Collection에서 사용자 데이터를 CRUD
 * 2. 사용자 생성, 이메일로 조회, ID로 조회 기능 제공
 * 3. 비밀번호 해시를 제거한 안전한 사용자 정보 변환
 *
 * [이전 버전과의 차이점]
 * - 이전: Map(메모리) + JSON 파일로 데이터 관리
 * - 현재: MongoDB + Mongoose로 데이터 관리
 * - 주요 변화: 모든 함수가 async/await로 변경됨
 *   (MongoDB 조회는 네트워크 통신이므로 비동기 처리가 필요)
 *
 * ========================================
 * Mongoose 쿼리 메서드 설명
 * ========================================
 *
 * [자주 쓰는 쿼리 메서드]
 * - Model.create(data)    : 새 Document 생성 후 저장 (INSERT)
 * - Model.findOne(조건)    : 조건에 맞는 Document 1개 조회 (SELECT ... LIMIT 1)
 * - Model.findById(id)    : _id로 Document 1개 조회
 * - Model.find(조건)       : 조건에 맞는 모든 Document 조회 (SELECT)
 * - Model.updateOne(조건)  : Document 1개 수정 (UPDATE ... LIMIT 1)
 * - Model.deleteOne(조건)  : Document 1개 삭제 (DELETE ... LIMIT 1)
 *
 * [조건 객체 문법]
 * - { email: "test@test.com" }     → email이 "test@test.com"인 것
 * - { age: { $gt: 20 } }          → age가 20보다 큰 것 ($gt = greater than)
 * - { name: { $regex: /홍/ } }    → name에 "홍"이 포함된 것
 */
import { UserModel, type IUser, type SafeUser } from '../models/User.js';

// 타입을 re-export (다른 파일에서 import할 수 있도록)
export type { SafeUser };
export type { IUser as User };

// ===== 사용자 관리 함수들 =====

/**
 * 이메일로 사용자 조회
 *
 * [.findOne() 설명]
 * - 조건에 맞는 첫 번째 Document를 반환
 * - 못 찾으면 null을 반환
 * - .lean()을 붙이면 순수 JS 객체로 반환 (Mongoose Document 기능 제거 → 성능 향상)
 *   lean() 없이 반환하면: save(), populate() 등 Mongoose 메서드 사용 가능
 *   lean()으로 반환하면: 순수 데이터만 (읽기 전용으로 쓸 때 좋음)
 *
 * @param email - 찾을 이메일 주소
 * @returns User 객체 또는 null
 */
export async function findByEmail(email: string) {
  // MongoDB에서 email 필드가 일치하는 사용자 1명을 조회
  const user = await UserModel.findOne({ email });
  return user; // IUser Document 또는 null
}

/**
 * ID로 사용자 조회
 *
 * [.findById() 설명]
 * - MongoDB의 _id 필드로 Document를 조회
 * - _id는 MongoDB가 모든 Document에 자동으로 부여하는 고유 식별자
 * - 형태: ObjectId("507f1f77bcf86cd799439011") - 24자리 16진수 문자열
 *
 * @param id - MongoDB _id (문자열로 전달해도 Mongoose가 자동 변환)
 * @returns User 객체 또는 null
 */
export async function findById(id: string) {
  const user = await UserModel.findById(id);
  return user;
}

/**
 * 새 사용자 생성
 *
 * [.create() 설명]
 * - 새 Document를 생성하고 MongoDB에 저장 (INSERT)
 * - 스키마에서 정의한 유효성 검사(required, unique 등)를 자동 실행
 * - 검사에 실패하면 에러를 throw
 * - 성공하면 저장된 Document를 반환 (_id, createdAt 등이 자동 추가됨)
 *
 * @param email - 이메일 주소
 * @param passwordHash - bcrypt로 해싱된 비밀번호
 * @param name - 사용자 이름
 * @returns 생성된 User Document
 */
export async function createUser(email: string, passwordHash: string, name: string) {
  // UserModel.create()로 새 사용자를 MongoDB에 저장
  // JSON 파일에 수동 저장하던 것과 달리, Mongoose가 알아서 MongoDB에 저장해줌
  const user = await UserModel.create({
    email,
    passwordHash,
    name,
    // createdAt, updatedAt은 timestamps: true 옵션으로 자동 생성됨 → 직접 안 넣어도 됨!
  });

  return user;
}

/**
 * User Document를 API 응답용 안전한 객체로 변환
 *
 * [왜 변환이 필요한가?]
 * - DB에서 조회한 User에는 passwordHash가 포함되어 있음
 * - 이걸 그대로 API 응답으로 보내면 비밀번호 해시가 클라이언트에 노출됨
 * - 그래서 passwordHash를 제거하고 필요한 필드만 골라서 반환
 *
 * [_id vs id]
 * - MongoDB는 내부적으로 _id를 사용 (ObjectId 타입)
 * - Mongoose는 자동으로 id라는 가상 필드를 만들어줌 (_id의 문자열 버전)
 * - 프론트엔드에는 _id 대신 id(문자열)를 보내는 것이 일반적
 *
 * @param user - Mongoose User Document (DB에서 조회한 원본)
 * @returns 비밀번호 해시가 제거된 안전한 사용자 정보
 */
export function toSafeUser(user: IUser): SafeUser {
  return {
    id: user._id.toString(),              // ObjectId → 문자열로 변환
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(), // Date → ISO 문자열로 변환
  };
}
