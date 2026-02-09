/**
 * JWT 인증 미들웨어
 *
 * 이 미들웨어가 하는 일:
 * - HTTP 요청의 Authorization 헤더에서 JWT 토큰을 추출
 * - 토큰을 검증하여 유효한 사용자인지 확인
 * - 유효하면 req.user에 사용자 정보를 설정하고 다음 미들웨어로 진행
 * - 유효하지 않으면 401 Unauthorized 응답
 *
 * [MongoDB 전환으로 인한 변경]
 * - verifyToken이 async 함수로 변경됨 (MongoDB 조회가 비동기이므로)
 * - 따라서 이 미들웨어도 async로 변경
 *
 * 사용법: 보호할 라우트 앞에 이 미들웨어를 추가
 * 예: app.use('/api', authMiddleware, uploadRouter);
 */
import { type Request, type Response, type NextFunction } from 'express';
import { verifyToken } from '../services/auth.js';
import type { SafeUser } from '../services/userStore.js';

// Express의 Request 타입에 user 필드를 추가 (TypeScript용)
declare global {
  namespace Express {
    interface Request {
      user?: SafeUser; // 인증된 사용자 정보 (미들웨어가 설정)
    }
  }
}

/**
 * 인증 미들웨어 함수 (async 버전)
 *
 * 요청 헤더에서 "Authorization: Bearer <토큰>" 형태로 토큰을 추출하고 검증
 *
 * @param req - Express 요청 객체
 * @param res - Express 응답 객체
 * @param next - 다음 미들웨어로 넘기는 함수
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Authorization 헤더 가져오기 (예: "Bearer eyJhbGci...")
  const authHeader = req.headers.authorization;

  // 헤더가 없거나 "Bearer "로 시작하지 않으면 → 인증 실패
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 'error',
      error: '로그인이 필요합니다. (토큰이 없음)',
    });
  }

  // "Bearer " 뒤의 토큰 문자열 추출
  const token = authHeader.split(' ')[1];

  try {
    // JWT 토큰 검증 → 성공하면 사용자 정보 반환
    // await 추가: verifyToken이 MongoDB 조회를 하므로 비동기
    const user = await verifyToken(token);

    // req.user에 사용자 정보 저장 → 이후 라우트 핸들러에서 사용 가능
    req.user = user;

    // 다음 미들웨어/라우트 핸들러로 진행
    next();
  } catch {
    // 토큰 검증 실패 (만료, 변조 등)
    return res.status(401).json({
      status: 'error',
      error: '인증이 만료되었거나 유효하지 않습니다. 다시 로그인해주세요.',
    });
  }
}
