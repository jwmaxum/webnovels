// ============================================================
// [Router] Community Router (/api/community)
//
// [Purpose]
// - 회차별 독자 댓글 목록 조회, 댓글 등록, 댓글 좋아요(Like) 토글, 부적절한 콘텐츠/댓글 신고(Report) 접수 기능 제공
//
// [Endpoints]
// - GET  /api/community/episodes/:episodeId/comments : 회차 댓글 목록 (블라인드 제외, 최신순, 좋아요수 포함)
// - POST /api/community/episodes/:episodeId/comments : 회차 댓글 작성
// - POST /api/community/comments/:commentId/like : 댓글 좋아요 토글 (추가 <-> 취소)
// - POST /api/community/report : 댓글/작품/회차 신고 접수 (관리자 심사 대기)
// ============================================================

import { Router, Response } from 'express';
import { db } from '../config/db.js';
import { authenticateToken, AuthRequest } from '../middlewares/auth.middleware.js';

export const communityRouter = Router();

// ============================================================
// [Route] GET /api/community/episodes/:episodeId/comments
// [Purpose] 특정 회차의 공개 댓글 목록 및 각 댓글별 좋아요 개수 조회 (블라인드 처리된 `isBlocked: true` 댓글은 자동 제외)
// ============================================================
communityRouter.get('/episodes/:episodeId/comments', async (req: AuthRequest, res: Response) => {
  try {
    const episodeId = req.params.episodeId;

    const comments = await db.comment.findMany({
      where: { episodeId, isBlocked: false },
      include: {
        user: { select: { id: true, nickname: true } },
        _count: { select: { likes: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.json({ comments });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================
// [Route] POST /api/community/episodes/:episodeId/comments
// [Purpose] 회차 댓글 등록
// [Security] authenticateToken 필수
// ============================================================
communityRouter.post('/episodes/:episodeId/comments', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const episodeId = req.params.episodeId;
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: '댓글 내용을 입력해주세요.' });
    }

    const comment = await db.comment.create({
      data: {
        userId,
        episodeId,
        content: content.trim()
      },
      include: { user: { select: { nickname: true } } }
    });

    return res.status(201).json({
      message: '댓글이 등록되었습니다.',
      comment
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================
// [Route] POST /api/community/comments/:commentId/like
// [Purpose] 댓글 좋아요 토글 (기존 좋아요가 있으면 취소, 없으면 추가)
// ============================================================
communityRouter.post('/comments/:commentId/like', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const commentId = req.params.commentId;

    const existing = await db.like.findUnique({
      where: { userId_commentId: { userId, commentId } }
    });

    if (existing) {
      await db.like.delete({ where: { id: existing.id } });
      return res.json({ message: '좋아요 취소', liked: false });
    } else {
      await db.like.create({ data: { userId, commentId } });
      return res.json({ message: '좋아요 추가', liked: true });
    }
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================
// [Route] POST /api/community/report
// [Purpose] 부적절한 콘텐츠/댓글/작품 신고 접수
// [Parameters] targetType ('COMMENT' | 'WORK' | 'EPISODE'), targetId, reason
// ============================================================
communityRouter.post('/report', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { targetType, targetId, reason } = req.body;

    if (!targetType || !targetId || !reason) {
      return res.status(400).json({ error: 'targetType, targetId, reason 필수 항목입니다.' });
    }

    const report = await db.report.create({
      data: {
        userId,
        targetType,
        targetId,
        reason,
        status: 'PENDING'
      }
    });

    return res.status(201).json({
      message: '신고가 정상적으로 접수되었습니다.',
      report
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

