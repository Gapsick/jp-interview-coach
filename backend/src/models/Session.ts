/**
 * Session 모델 - 분석 세션과 히스토리 데이터의 구조(스키마)를 정의
 *
 * ========================================
 * 이 모델의 데이터 구조 (시각적으로 이해하기)
 * ========================================
 *
 * sessions Collection에 저장되는 Document의 모양:
 *
 * {
 *   _id: ObjectId("..."),           ← MongoDB가 자동 생성하는 고유 ID
 *   sessionId: "uuid-문자열",        ← 우리가 사용하는 세션 식별자
 *   userId: ObjectId("..."),         ← 이 세션의 주인 (users Collection 참조)
 *   history: [                       ← 분석 결과 배열 (Embedding 방식)
 *     {
 *       at: "2024-01-01T...",
 *       transcript: "인식된 일본어 텍스트",
 *       issues: [{ id: "filler", name: "...", severity: "medium" }],
 *       topIssues: ["개선점1", "개선점2"],
 *       pronunciationTips: ["팁1", "팁2"],
 *       practiceSentences: ["연습문장1", "연습문장2"]
 *     },
 *     { ... 두 번째 분석 결과 ... }
 *   ],
 *   createdAt: ISODate("..."),       ← 자동 생성
 *   updatedAt: ISODate("...")        ← 자동 갱신
 * }
 *
 * ========================================
 * Embedding(내장) vs Reference(참조)
 * ========================================
 *
 * 이 모델에서는 두 가지 방식을 모두 사용합니다:
 *
 * [Embedding - history 배열]
 * - 분석 결과(history)를 Session Document 안에 직접 배열로 저장
 * - 장점: 세션 조회 시 history도 한 번에 가져옴 (추가 쿼리 불필요)
 * - 단점: Document 크기 제한 16MB (history가 수천 개면 문제 될 수 있음)
 * - 적합한 경우: 1:Few 관계 (한 세션에 분석 결과가 수십 개 수준)
 *
 * [Reference - userId]
 * - userId에 User의 _id만 저장하고, 실제 User 데이터는 users Collection에 있음
 * - 장점: 데이터 중복 없음, User 정보가 바뀌어도 한 곳만 수정
 * - 단점: User 정보가 필요하면 별도 조회(populate) 필요
 * - 적합한 경우: 1:Many 관계 (한 유저가 여러 세션을 가짐)
 */
import mongoose, { type Document } from 'mongoose';

// ===== TypeScript 타입 정의 =====

/** 규칙 분석에서 검출된 이슈 하나의 타입 */
export type RuleIssue = {
  id: string;                              // 이슈 종류 ID (예: 'filler', 'long_pause')
  name: string;                            // 이슈 이름 (예: '必要な表現の使用')
  severity: 'high' | 'medium' | 'low';     // 심각도
  detail?: string;                         // 상세 설명 (예: '3回 発見')
};

/** Whisper가 반환한 단어별 타임스탬프 */
export type WordTimestamp = {
  word: string;    // 인식된 단어 (예: "こんにちは")
  start: number;   // 단어 시작 시간 (초)
  end: number;     // 단어 끝 시간 (초)
};

/** 발음 분석에서 검출된 쉼(pause) */
export type DetectedPause = {
  afterWord: string;    // 쉼 직전 단어
  beforeWord: string;   // 쉼 직후 단어
  duration: number;     // 쉼 길이 (초)
  position: number;     // 단어 배열에서의 인덱스
};

/** 발음이 불명확한 구간 (Whisper 신뢰도가 낮은 세그먼트) */
export type UnclearSegment = {
  text: string;           // 해당 구간의 텍스트
  confidence: number;     // 신뢰도 (0~1, 낮을수록 불명확)
};

/**
 * 발음 분석 결과 타입
 *
 * Whisper의 단어별 타임스탬프 + 세그먼트 신뢰도를 분석하여 생성
 * - 말하기 속도(WPM), 쉼 패턴, 불명확 구간, 종합 점수를 포함
 */
export type PronunciationAnalysis = {
  overallScore: number;          // 종합 발음 점수 (0~100)
  speakingSpeed: {
    wpm: number;                 // 분당 단어수 (Words Per Minute)
    rating: 'too_slow' | 'slow' | 'good' | 'fast' | 'too_fast';
  };
  pauses: DetectedPause[];       // 검출된 긴 쉼 목록
  unclearSegments: UnclearSegment[]; // 불명확한 발음 구간 목록
  totalDuration: number;         // 전체 오디오 길이 (초)
  wordCount: number;             // 총 단어 수
  words: WordTimestamp[];        // 전체 단어별 타임스탬프 (프론트엔드 표시용)
};

/** 한 번의 분석 결과 타입 */
export type AnalysisResult = {
  transcript: string;              // STT로 인식된 텍스트
  issues: RuleIssue[];             // 규칙 분석에서 검출된 이슈 목록
  topIssues: string[];             // LLM이 생성한 주요 개선점
  pronunciationTips: string[];     // LLM이 생성한 발음 팁
  practiceSentences: string[];     // LLM이 생성한 연습 문장
  pronunciation?: PronunciationAnalysis; // 발음 분석 결과 (Whisper 단어 타임스탬프 기반)
  rawAnalysis?: Record<string, unknown>; // 기타 원본 분석 데이터
};

/** 세션 히스토리 아이템: 분석 결과 + 분석 시각 */
export interface ISessionHistoryItem extends AnalysisResult {
  at: string; // 분석 시각 (ISO 문자열)
}

/** Session Document의 TypeScript 인터페이스 */
export interface ISession extends Document {
  sessionId: string;                   // 세션 식별자 (UUID)
  userId?: mongoose.Types.ObjectId;    // 세션 소유자 (User 참조, 선택적)
  history: ISessionHistoryItem[];      // 분석 결과 히스토리 배열
  createdAt: Date;
  updatedAt: Date;
}

// ===== 하위 스키마 (Sub-Schema) 정의 =====

/**
 * [하위 스키마란?]
 * - Document 안에 내장(Embedding)되는 객체의 구조를 정의
 * - history 배열 안의 각 아이템이 어떤 모양이어야 하는지 정의
 * - 별도의 Collection을 만들지 않고, 부모 Document 안에 포함됨
 */

/** 규칙 이슈 하위 스키마 */
const ruleIssueSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    severity: {
      type: String,
      required: true,
      enum: ['high', 'medium', 'low'], // enum: 이 3개 값만 허용 (다른 값 넣으면 에러)
    },
    detail: { type: String }, // required가 없으면 선택적 필드 (있어도 되고 없어도 됨)
  },
  { _id: false } // _id: false → 하위 Document에 _id를 자동 생성하지 않음 (불필요한 ID 방지)
);

/** 히스토리 아이템 하위 스키마 */
const historyItemSchema = new mongoose.Schema(
  {
    at: { type: String, required: true },           // 분석 시각
    transcript: { type: String, required: true },   // 인식된 텍스트
    issues: [ruleIssueSchema],                      // 이슈 배열 (ruleIssueSchema의 배열)

    // [Mixed 타입]
    // - 어떤 형태의 데이터든 저장할 수 있는 유연한 타입
    // - String, Number뿐 아니라 배열, 객체 등 뭐든 OK
    // - 여기서는 string 배열(["문장1", "문장2"])을 저장하는데 사용
    topIssues: [{ type: String }],                  // 주요 개선점 문자열 배열
    pronunciationTips: [{ type: String }],          // 발음 팁 문자열 배열
    practiceSentences: [{ type: String }],          // 연습 문장 문자열 배열

    // 발음 분석 결과 (Whisper 단어 타임스탬프 기반)
    // Mixed 타입: PronunciationAnalysis 객체를 그대로 저장
    pronunciation: { type: mongoose.Schema.Types.Mixed },

    rawAnalysis: { type: mongoose.Schema.Types.Mixed }, // 기타 데이터 (자유 형식)
  },
  { _id: false }
);

// ===== 메인 Session 스키마 =====

const sessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true, // 세션 ID는 중복 불가
    },
    /**
     * userId - User Document를 참조하는 필드
     *
     * [ref란?]
     * - "이 필드의 값은 'User' 모델의 _id를 가리킨다"는 의미
     * - RDBMS의 FOREIGN KEY와 비슷한 개념
     * - 나중에 populate()를 사용하면 userId로 User 정보를 자동 조회할 수 있음
     *
     * 예시:
     *   session.userId = "507f1f77bcf86cd799439011"  (User의 _id)
     *   await session.populate('userId')  → userId가 { email: "...", name: "..." }로 채워짐
     */
    userId: {
      type: mongoose.Schema.Types.ObjectId, // MongoDB의 고유 ID 타입 (ObjectId)
      ref: 'User',                          // 'User' 모델을 참조
    },
    history: [historyItemSchema], // 히스토리 배열 (historyItemSchema의 배열)
  },
  {
    timestamps: true, // createdAt, updatedAt 자동 관리
  }
);

// ===== 모델 생성 & export =====

/** 'Session' 모델 → MongoDB에 'sessions' 컬렉션으로 저장됨 */
export const SessionModel = mongoose.model<ISession>('Session', sessionSchema);
