/**
 * Backend 환경 설정 파일
 *
 * 이 파일이 하는 일:
 * 1. backend/.env 파일에서 환경 변수를 읽어옴
 * 2. OpenAI API 키가 유효한지 검증
 * 3. 앱 전체에서 사용할 설정 객체(config)를 export
 */
import dotenv from 'dotenv';          // .env 파일을 읽어 process.env에 주입하는 라이브러리
import path from 'path';
import { fileURLToPath } from 'url';

// 현재 파일 기준으로 상위 폴더(backend/)에 있는 .env 파일 로드
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// .env에서 가져온 API 키 정리 (앞뒤 공백/줄바꿈 제거)
const rawKey = (process.env.OPENAI_API_KEY || '').trim();

// API 키 유효성 검사: 20자 이상, "sk-"로 시작, 플레이스홀더("your-", "****")가 아닌지 확인
const isValidKey =
  rawKey.length > 20 &&
  rawKey.startsWith('sk-') &&
  !rawKey.includes('your-') &&
  !rawKey.includes('****');

// 앱 전체에서 사용하는 설정 객체
export const config = {
  port: Number(process.env.PORT) || 3000,         // 서버 포트 (기본값: 3000)
  openaiApiKey: isValidKey ? rawKey : '',          // 유효한 키만 사용, 아니면 빈 문자열 → Mock 모드로 전환됨
  useMockStt: process.env.USE_MOCK_STT === 'true', // true이면 실제 Whisper 대신 가짜 음성인식 결과 사용
  useMockLlm: process.env.USE_MOCK_LLM === 'true', // true이면 실제 GPT 대신 빈 피드백 반환
  uploadDir: 'uploads',                            // 업로드된 파일 저장 폴더
  dataDir: 'data',                                  // 세션 데이터 저장 폴더
  ffmpegPath: (process.env.FFMPEG_PATH || '').trim(), // ffmpeg 실행 파일 경로 (시스템 PATH에 없을 때 지정)
  jwtSecret: (process.env.JWT_SECRET || 'default-secret-key').trim(), // JWT 토큰 서명용 비밀 키

  // ===== MongoDB 설정 =====
  // MongoDB 연결 문자열 (Connection String)
  // 형식: mongodb://아이디:비밀번호@호스트:포트/데이터베이스명
  // 로컬 MongoDB는 보통 mongodb://localhost:27017/DB이름
  // MongoDB Atlas(클라우드)를 쓰면 mongodb+srv://... 형태
  mongoUri: (process.env.MONGODB_URI || 'mongodb://localhost:27017/interview-coach').trim(),
} as const;
