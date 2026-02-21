/**
 * 세션/히스토리 라우터 - 사용자의 분석 이력 조회 API
 *
 * [이 파일이 하는 일]
 * - 로그인한 유저가 자신의 분석 이력을 조회할 수 있는 API 제공
 * - 모든 엔드포인트는 authMiddleware를 통과해야 함 (로그인 필수)
 *
 * 엔드포인트:
 * - GET /api/sessions         → 내 세션 목록 조회 (요약 형태)
 * - GET /api/sessions/latest   → 가장 최근 세션 1개 (페이지 새로고침 시 세션 복원용)
 * - GET /api/sessions/:sessionId/history → 특정 세션의 전체 히스토리
 */
import express, { type Request, type Response } from 'express';
import { getSessionsByUser, getSession, getLatestSessionByUser } from '../services/sessionStore.js';

export const sessionRouter = express.Router();

/**
 * GET /api/sessions - 내 세션 목록 조회
 *
 * [응답 형태]
 * {
 *   status: 'success',
 *   sessions: [
 *     { sessionId: "uuid", analysisCount: 3, lastAnalyzedAt: "2024-...", createdAt: "..." },
 *     ...
 *   ]
 * }
 *
 * [왜 요약 형태로 보내는가?]
 * - 전체 히스토리(transcript, issues 등)를 다 보내면 데이터가 너무 큼
 * - 목록에서는 "몇 번 분석했는지", "마지막으로 언제 했는지"만 보여주면 충분
 * - 상세 내용은 GET /api/sessions/:id/history로 따로 요청
 */
sessionRouter.get('/sessions', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ status: 'error', error: '로그인이 필요합니다.' });
    }

    // 유저의 모든 세션 조회 (최신순)
    const sessions = await getSessionsByUser(userId);

    // 세션 목록을 요약 형태로 변환
    const summary = sessions.map(s => ({
      sessionId: s.sessionId,
      analysisCount: s.history.length,       // 이 세션에서 분석한 횟수
      lastAnalyzedAt: s.history.length > 0
        ? s.history[s.history.length - 1].at // 마지막 분석 시각
        : null,
      createdAt: s.createdAt,
    }));

    return res.json({ status: 'success', sessions: summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '세션 조회 실패';
    return res.status(500).json({ status: 'error', error: msg });
  }
});

/**
 * GET /api/sessions/latest - 내 최근 세션 조회
 *
 * [용도]
 * - 프론트엔드에서 페이지를 새로고침하면 sessionId가 사라짐 (메모리에만 있었으므로)
 * - 이 API로 유저의 가장 최근 세션을 가져와서 sessionId를 복원
 * - → 이전 분석과 같은 세션에서 계속 이어서 분석 가능
 *
 * [응답 형태]
 * { status: 'success', session: { sessionId, history, ... } }
 * 또는 세션이 없으면
 * { status: 'success', session: null }
 */
sessionRouter.get('/sessions/latest', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ status: 'error', error: '로그인이 필요합니다.' });
    }

    const session = await getLatestSessionByUser(userId);
    return res.json({ status: 'success', session });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '세션 조회 실패';
    return res.status(500).json({ status: 'error', error: msg });
  }
});

/**
 * GET /api/sessions/:sessionId/history - 특정 세션의 전체 히스토리 조회
 *
 * [보안]
 * - 다른 유저의 세션에 접근하는 것을 방지
 * - session.userId와 req.user.id를 비교하여 본인 세션만 조회 가능
 *
 * [응답 형태]
 * {
 *   status: 'success',
 *   history: [
 *     { at: "2024-...", transcript: "...", issues: [...], topIssues: [...], ... },
 *     ...
 *   ]
 * }
 */
sessionRouter.get('/sessions/:sessionId/history', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ status: 'error', error: '로그인이 필요합니다.' });
    }

    const session = await getSession(req.params.sessionId);

    // 세션이 없거나, 다른 유저의 세션이면 404 응답
    // toString()으로 비교: userId는 ObjectId 타입이라 문자열로 변환해야 비교 가능
    if (!session || session.userId?.toString() !== userId) {
      return res.status(404).json({ status: 'error', error: '세션을 찾을 수 없습니다.' });
    }

    return res.json({ status: 'success', history: session.history });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '히스토리 조회 실패';
    return res.status(500).json({ status: 'error', error: msg });
  }
});
