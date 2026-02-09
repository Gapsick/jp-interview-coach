/**
 * MongoDB 연결 모듈
 *
 * 이 파일이 하는 일:
 * 1. Mongoose를 사용하여 MongoDB 서버에 연결
 * 2. 연결 성공/실패 시 로그 출력
 * 3. 앱 종료 시 연결을 깔끔하게 종료 (graceful shutdown)
 *
 * ========================================
 * MongoDB 기본 개념 (처음 배우는 분을 위한 설명)
 * ========================================
 *
 * [Mongoose란?]
 * - MongoDB를 Node.js에서 쉽게 사용하게 해주는 ODM(Object Document Mapper) 라이브러리
 * - RDBMS에서 ORM(Sequelize 등)과 비슷한 역할
 * - 스키마 정의, 데이터 검증, 타입 안전성을 제공
 *
 * [연결 문자열 (Connection String)]
 * - MongoDB에 접속하기 위한 주소
 * - 로컬: mongodb://localhost:27017/데이터베이스이름
 * - 클라우드(Atlas): mongodb+srv://유저:비밀번호@클러스터주소/DB이름
 *
 * [연결 흐름]
 * 앱 시작 → mongoose.connect(URI) 호출 → MongoDB 서버에 TCP 연결
 * → 성공하면 이후 모든 Model 조작이 이 연결을 통해 이루어짐
 */
import mongoose from 'mongoose';
import { config } from '../config.js';

/**
 * MongoDB에 연결하는 함수
 *
 * 서버 시작 시 index.ts에서 한 번만 호출됩니다.
 * 연결이 실패하면 에러를 throw하여 서버 시작을 중단합니다.
 */
export async function connectDB(): Promise<void> {
  try {
    // mongoose.connect()는 Promise를 반환합니다.
    // await로 연결이 완료될 때까지 기다립니다.
    // 이 한 줄로 MongoDB 서버와의 연결이 수립됩니다.
    await mongoose.connect(config.mongoUri);

    console.log(`[MongoDB] 연결 성공: ${config.mongoUri}`);
  } catch (err) {
    console.error('[MongoDB] 연결 실패:', err);
    // MongoDB 연결 실패 시 서버를 시작해도 의미가 없으므로 프로세스 종료
    process.exit(1);
  }
}

// ===== 연결 상태 이벤트 리스너 =====
// Mongoose는 연결 상태가 변할 때 이벤트를 발생시킵니다.
// 이 리스너들은 디버깅과 모니터링에 유용합니다.

// 연결이 끊어졌을 때 (네트워크 문제 등)
mongoose.connection.on('disconnected', () => {
  console.warn('[MongoDB] 연결이 끊어졌습니다. 자동 재연결을 시도합니다...');
});

// 연결 에러 발생 시
mongoose.connection.on('error', (err) => {
  console.error('[MongoDB] 연결 에러:', err);
});

// 앱이 종료될 때 MongoDB 연결을 깔끔하게 닫기
// 이렇게 하지 않으면 연결이 갑자기 끊겨서 MongoDB 서버에 불필요한 부하가 생길 수 있음
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('[MongoDB] 연결 종료 (앱 종료)');
  process.exit(0);
});
