import { Router, Response } from 'express';
import { db } from '../config/db.js';
import { authenticateToken, AuthRequest } from '../middlewares/auth.middleware.js';

export const communityRouter = Router();

/**
 * 회차별 댓글 목록 조회
 */
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

/**
 * 댓글 작성
 */
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

/**
 * 댓글 좋아요 토글
 */
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

/**
 * 콘텐츠/댓글 신고 등록 (Section 26)
 */
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
