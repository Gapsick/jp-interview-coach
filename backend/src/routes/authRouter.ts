/**
 * 인증 라우터 - 회원가입/로그인/내 정보 조회 API
 *
 * 엔드포인트:
 * - POST /api/auth/register → 회원가입
 * - POST /api/auth/login    → 로그인 (JWT 토큰 발급)
 * - GET  /api/auth/me       → 현재 로그인한 사용자 정보 (토큰 필요)
 */
import express, { type Request, type Response } from 'express';
import { register, login } from '../services/auth.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

export const authRouter = express.Router();

/**
 * POST /api/auth/register - 회원가입
 *
 * 요청 body: { email: string, password: string, name: string }
 * 성공 응답: { status: 'success', message: '...', user: { id, email, name, createdAt } }
 * 실패 응답: { status: 'error', error: '...' }
 */
authRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    // 필수 필드 확인
    if (!email || !password || !name) {
      return res.status(400).json({
        status: 'error',
        error: '이메일, 비밀번호, 이름은 필수 항목입니다.',
      });
    }

    // 회원가입 처리 (이메일 중복 확인, 비밀번호 해싱, 사용자 생성)
    const user = await register(email, password, name);

    return res.status(201).json({
      status: 'success',
      message: '회원가입이 완료되었습니다.',
      user,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '회원가입 실패';
    return res.status(400).json({ status: 'error', error: msg });
  }
});

/**
 * POST /api/auth/login - 로그인
 *
 * 요청 body: { email: string, password: string }
 * 성공 응답: { status: 'success', token: 'eyJ...', user: { id, email, name, createdAt } }
 * 실패 응답: { status: 'error', error: '...' }
 */
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // 필수 필드 확인
    if (!email || !password) {
      return res.status(400).json({
        status: 'error',
        error: '이메일과 비밀번호를 입력해주세요.',
      });
    }

    // 로그인 처리 (이메일 조회, 비밀번호 검증, JWT 발급)
    const { token, user } = await login(email, password);

    return res.json({
      status: 'success',
      token,  // JWT 토큰 (프론트엔드에서 localStorage에 저장)
      user,   // 사용자 정보 (비밀번호 해시 제외)
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '로그인 실패';
    return res.status(401).json({ status: 'error', error: msg });
  }
});

/**
 * GET /api/auth/me - 현재 로그인한 사용자 정보 조회
 *
 * 헤더: Authorization: Bearer <JWT 토큰>
 * 성공 응답: { status: 'success', user: { id, email, name, createdAt } }
 * 실패 응답: 401 (authMiddleware에서 처리)
 *
 * authMiddleware가 토큰을 검증하고 req.user에 사용자 정보를 설정해줌
 */
authRouter.get('/me', authMiddleware, (req: Request, res: Response) => {
  return res.json({
    status: 'success',
    user: req.user, // authMiddleware가 설정한 사용자 정보
  });
});
