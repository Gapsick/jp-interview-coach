/**
 * User 모델 - MongoDB에 저장될 사용자 데이터의 구조(스키마)를 정의
 *
 * ========================================
 * Mongoose 모델 기본 개념
 * ========================================
 *
 * [Schema (스키마)]
 * - "이 Collection에 저장되는 Document는 이런 모양이어야 한다"는 설계도
 * - RDBMS의 CREATE TABLE과 비슷한 역할
 * - 각 필드의 타입, 필수 여부, 기본값, 유효성 검사 등을 정의
 *
 * [Model (모델)]
 * - Schema를 기반으로 만든 "조작 도구"
 * - 이 Model을 통해 CRUD(생성/조회/수정/삭제) 작업을 수행
 * - 예: UserModel.create(), UserModel.findOne(), UserModel.findById()
 *
 * [Document (도큐먼트)]
 * - MongoDB에 실제로 저장되는 하나의 데이터 레코드
 * - RDBMS의 Row(행)에 해당
 * - 예: { email: "test@test.com", name: "홍길동", ... } ← 이게 하나의 Document
 *
 * [Collection (컬렉션)]
 * - Document들의 모음 (RDBMS의 Table에 해당)
 * - 이 파일에서 정의한 모델은 "users" Collection에 저장됨
 *   (Mongoose가 모델명 "User"를 자동으로 소문자 복수형 "users"로 변환)
 */
import mongoose, { type Document } from 'mongoose';

// ===== TypeScript 타입 정의 =====

/**
 * User Document의 TypeScript 인터페이스
 *
 * Document를 extends(상속)하는 이유:
 * - Mongoose Document에는 _id, save(), toObject() 등의 내장 기능이 있음
 * - 우리가 정의한 필드 + Mongoose 내장 기능을 합친 타입이 필요
 */
export interface IUser extends Document {
  email: string;        // 로그인용 이메일 (중복 불가)
  passwordHash: string; // bcrypt로 해싱된 비밀번호
  name: string;         // 사용자 이름
  createdAt: Date;      // 가입 시각 (Mongoose가 자동 관리)
  updatedAt: Date;      // 수정 시각 (Mongoose가 자동 관리)
}

/** 비밀번호 해시를 제외한 안전한 사용자 정보 (API 응답용) */
export type SafeUser = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
};

// ===== Mongoose 스키마 정의 =====

/**
 * User 스키마: MongoDB에 저장될 사용자 데이터의 구조를 정의
 *
 * new mongoose.Schema({ 필드들 }, { 옵션 }) 형태로 작성합니다.
 *
 * 각 필드에서 사용 가능한 주요 옵션:
 * - type: 데이터 타입 (String, Number, Date, Boolean, Array 등)
 * - required: true이면 이 필드가 없으면 저장 거부 (NOT NULL과 비슷)
 * - unique: true이면 같은 값을 가진 Document가 2개 이상 못 들어감 (UNIQUE 제약)
 * - default: 값을 안 넣었을 때 사용할 기본값
 * - trim: true이면 문자열 앞뒤 공백을 자동 제거
 * - lowercase: true이면 문자열을 자동으로 소문자로 변환
 */
const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,       // 문자열 타입
      required: true,     // 필수 필드 (없으면 저장 실패)
      unique: true,       // 중복 불가 (같은 이메일로 2번 가입 불가)
      trim: true,         // " test@test.com " → "test@test.com" (공백 제거)
      lowercase: true,    // "Test@Test.com" → "test@test.com" (소문자 변환)
    },
    passwordHash: {
      type: String,
      required: true,     // 비밀번호 해시는 반드시 있어야 함
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    /**
     * timestamps 옵션:
     * true로 설정하면 Mongoose가 자동으로 2개의 필드를 추가해줌
     * - createdAt: Document가 처음 생성된 시각 (자동 기록)
     * - updatedAt: Document가 마지막으로 수정된 시각 (자동 갱신)
     *
     * 직접 new Date()를 넣을 필요 없이 Mongoose가 알아서 관리해줌!
     */
    timestamps: true,
  }
);

/**
 * 인덱스(Index) 설정
 *
 * [인덱스란?]
 * - "이 필드로 자주 검색하니까, 검색을 빠르게 할 수 있도록 색인을 만들어라"는 의미
 * - 책의 목차(index)와 같은 역할 → 전체를 훑지 않고 바로 찾을 수 있음
 * - 인덱스가 없으면: 모든 Document를 하나씩 확인 (Collection Scan) → 느림
 * - 인덱스가 있으면: 인덱스 테이블에서 바로 위치를 찾음 → 빠름
 *
 * email 필드에 unique: true를 설정하면 Mongoose가 자동으로 unique 인덱스를 생성합니다.
 * 아래는 추가적인 인덱스가 필요할 때 사용하는 방법의 예시입니다:
 *
 * userSchema.index({ name: 1 });  ← name 필드에 오름차순(1) 인덱스 생성
 * userSchema.index({ createdAt: -1 });  ← createdAt에 내림차순(-1) 인덱스 생성
 */

// ===== 모델 생성 & export =====

/**
 * mongoose.model<타입>('모델이름', 스키마)
 *
 * - '모델이름'이 'User'이면 → MongoDB에 'users' 컬렉션이 자동 생성됨
 *   (Mongoose가 자동으로 소문자 + 복수형으로 변환)
 * - <IUser>는 TypeScript에게 "이 모델의 Document는 IUser 타입이다"라고 알려줌
 */
export const UserModel = mongoose.model<IUser>('User', userSchema);
