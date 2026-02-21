/**
 * Interview Pronunciation Coach Agent - Backend 진입점 (메인 서버 파일)
 *
 * 이 파일이 하는 일:
 * 1. MongoDB에 연결
 * 2. Express 서버를 생성하고 미들웨어(CORS, JSON 파싱)를 설정
 * 3. API 라우터를 연결하고 서버를 시작
 *
 * [MongoDB 전환으로 인한 변경]
 * - 이전: loadSessions(), loadUsers()로 JSON 파일에서 데이터 로드
 * - 현재: connectDB()로 MongoDB 연결 → Mongoose가 자동으로 데이터 관리
 * - 서버 시작 순서: MongoDB 연결 성공 → Express 서버 시작
 *   (DB 연결 전에 API 요청을 받으면 에러가 나므로, 연결 후에 서버를 시작)
 */
import express from 'express';       // Node.js 웹 프레임워크
import cors from 'cors';             // Cross-Origin 요청 허용 (프론트엔드 ↔ 백엔드 통신용)
import path from 'path';             // 파일 경로 유틸리티
import { fileURLToPath } from 'url'; // ES Module에서 __dirname을 쓰기 위한 유틸

import { config } from './config.js';                    // 환경 설정 (API 키, 포트, MongoDB URI 등)
import { connectDB } from './services/db.js';            // MongoDB 연결 함수
import { uploadRouter } from './routes/upload.js';        // 파일 업로드 & 분석 라우터
import { authRouter } from './routes/authRouter.js';      // 인증(회원가입/로그인) 라우터
import { sessionRouter } from './routes/sessionRouter.js'; // 세션/히스토리 조회 라우터
import { authMiddleware } from './middleware/authMiddleware.js'; // JWT 인증 미들웨어

// 디버그 로그: API 키가 설정되어 있는지, Mock 모드인지 콘솔에 출력 (키 값 자체는 출력 안 함)
console.log('[Config] OpenAI key:', config.openaiApiKey ? `set (length ${config.openaiApiKey.length})` : 'NOT SET');
console.log('[Config] Mock STT:', config.useMockStt, '| Mock LLM:', config.useMockLlm);
if (!config.openaiApiKey) {
  console.log('[Config] → .env의 OPENAI_API_KEY를 확인하거나, 키가 20자 이상·sk-로 시작하는지 확인하세요.');
}

// ES Module 환경에서 __dirname 대체 (현재 파일이 위치한 디렉토리 경로)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Express 앱 인스턴스 생성
const app = express();

// CORS 설정: 프론트엔드(Vue dev 서버 등)에서 오는 요청을 허용
app.use(cors({ origin: true, credentials: true }));
// JSON 요청 본문 파싱 (req.body로 접근 가능하게 함)
app.use(express.json());

// 정적 파일 제공: /uploads 경로로 업로드된 파일(음성 등)에 접근 가능
app.use('/uploads', express.static(path.join(__dirname, '..', config.uploadDir)));

// 인증 라우터 연결: POST /api/auth/register, /api/auth/login, GET /api/auth/me
app.use('/api/auth', authRouter);

// /api 경로에 업로드 & 분석 라우터 연결 (인증 필요)
// authMiddleware가 JWT 토큰을 검증한 후에만 분석 API에 접근 가능
app.use('/api', authMiddleware, uploadRouter);

// 세션/히스토리 라우터 연결 (인증 필요)
// GET /api/sessions, /api/sessions/latest, /api/sessions/:id/history
app.use('/api', authMiddleware, sessionRouter);

// 헬스 체크: 서버가 정상 동작하는지 확인용 엔드포인트 (GET /api/health)
app.get('/api/health', (_, res) => {
  res.json({ ok: true, service: 'interview-coach-api' });
});

// 상태 확인 엔드포인트 (GET /api/status): API 키 설정 여부와 Mock 모드 정보 반환
app.get('/api/status', (_, res) => {
  res.json({
    openaiKeySet: Boolean(config.openaiApiKey),  // API 키가 설정되어 있는지 (true/false)
    useMockStt: config.useMockStt,               // 음성인식(STT)을 Mock으로 하는지
    useMockLlm: config.useMockLlm,               // LLM 코칭을 Mock으로 하는지
    message: config.openaiApiKey
      ? 'Real API will be used for STT and coaching.'   // 실제 OpenAI API 사용
      : 'No valid API key → using mock responses.',      // Mock 데이터로 대체
  });
});

/**
 * 서버 시작 함수 (async)
 *
 * [왜 async 함수로 감쌌나?]
 * - MongoDB 연결(connectDB)이 비동기 작업이므로 await가 필요
 * - 최상위 레벨에서 await를 쓸 수도 있지만, 함수로 감싸면 에러 처리가 깔끔함
 *
 * [시작 순서]
 * 1. MongoDB 연결 (실패하면 서버 시작 안 함)
 * 2. Express 서버 리스닝 시작
 */
async function startServer() {
  // 1단계: MongoDB 연결
  // connectDB() 내부에서 연결 실패 시 process.exit(1)로 종료됨
  await connectDB();

  // 2단계: Express 서버 시작 (MongoDB 연결 성공 후에만 실행됨)
  app.listen(config.port, () => {
    console.log(`Interview Coach API listening on http://localhost:${config.port}`);
  });
}

// 서버 시작 실행
startServer();
