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

async function getOwnedWork(userId: string, workId: string) {
  const author = await db.author.findUnique({ where: { userId } });
  const work = author ? await db.work.findFirst({ where: { id: workId, authorId: author.id } }) : null;
  return { author, work };
}

// ============================================================
// [Route] GET /api/community/episodes/:episodeId/comments
// [Purpose] 특정 회차의 공개 댓글 목록 및 각 댓글별 좋아요 개수 조회 (블라인드 처리된 `isBlocked: true` 댓글은 자동 제외)
// ============================================================
communityRouter.get('/episodes/:episodeId/comments', async (req: AuthRequest, res: Response) => {
  try {
    const episodeId = req.params.episodeId;

    const comments = await db.comment.findMany({
      where: { episodeId, isBlocked: false, isHiddenByAuthor: false },
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
    const { content, anchorParagraph, quoteText, contentVersion, isSpoiler } = req.body;

    if (!content || typeof content !== 'string' || content.trim().length === 0 || content.trim().length > 1000) {
      return res.status(400).json({ error: '댓글 내용을 입력해주세요.' });
    }

    const episode = await db.episode.findUnique({ where: { id: episodeId }, select: { content: true, workId: true } });
    if (!episode) return res.status(404).json({ error: '회차를 찾을 수 없습니다.' });
    const policy = await db.workCommentPolicy.findUnique({ where: { workId: episode.workId } });
    if (policy && !policy.commentsEnabled) return res.status(403).json({ error: '작가가 이 작품의 댓글을 잠시 닫았습니다.' });

    const blocked = await db.creatorCommentBlock.findUnique({ where: { workId_readerId: { workId: episode.workId, readerId: userId } } });
    if (blocked) return res.status(403).json({ error: '이 작품에는 더 이상 댓글을 작성할 수 없습니다.' });

    const blockedTerms = (policy?.blockedTerms || '').split(',').map((term) => term.trim().toLowerCase()).filter(Boolean);
    if (blockedTerms.some((term) => content.toLowerCase().includes(term))) {
      return res.status(400).json({ error: '작가 댓글 관리 규칙에 의해 등록할 수 없는 표현이 포함되어 있습니다.' });
    }

    if ((policy?.minReadEpisodes || 0) > 0) {
      const reads = await db.userReadingHistory.findMany({ where: { userId, workId: episode.workId }, distinct: ['episodeId'], select: { episodeId: true } });
      if (reads.length < policy!.minReadEpisodes) return res.status(403).json({ error: `${policy!.minReadEpisodes}화 이상 읽은 독자만 댓글을 작성할 수 있습니다.` });
    }

    const parsedAnchor = anchorParagraph === undefined || anchorParagraph === null ? null : Number(anchorParagraph);
    const quote = typeof quoteText === 'string' ? quoteText.trim().slice(0, 300) : null;
    if (parsedAnchor !== null && (!Number.isInteger(parsedAnchor) || parsedAnchor < 0 || !quote)) {
      return res.status(400).json({ error: '문단 댓글에는 올바른 문단 위치와 인용문이 필요합니다.' });
    }

    const comment = await db.comment.create({
      data: {
        userId,
        episodeId,
        content: content.trim(),
        anchorParagraph: parsedAnchor,
        quoteText: quote,
        contentVersion: typeof contentVersion === 'string' ? contentVersion.slice(0, 100) : null,
        isSpoiler: Boolean(isSpoiler)
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
// [Creator moderation] 작품 소유 작가만 댓글 운영 정책·독자 차단·댓글 숨김을 관리한다.
// ============================================================
communityRouter.put('/works/:workId/comment-policy', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { author, work } = await getOwnedWork(req.user!.userId, req.params.workId);
    if (!author || !work) return res.status(403).json({ error: '본인 작품의 댓글 정책만 변경할 수 있습니다.' });
    const terms = Array.isArray(req.body?.blockedTerms) ? req.body.blockedTerms : String(req.body?.blockedTerms || '').split(',');
    const blockedTerms = [...new Set(terms.map((term: unknown) => String(term).trim().toLowerCase()).filter(Boolean))].slice(0, 50).join(',');
    const minReadEpisodes = Math.max(0, Math.min(100, Number(req.body?.minReadEpisodes) || 0));
    const policy = await db.workCommentPolicy.upsert({
      where: { workId: work.id },
      create: { workId: work.id, commentsEnabled: req.body?.commentsEnabled !== false, blockedTerms, minReadEpisodes },
      update: { commentsEnabled: req.body?.commentsEnabled !== false, blockedTerms, minReadEpisodes }
    });
    return res.json({ policy });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

communityRouter.patch('/works/:workId/comments/:commentId/hide', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { author, work } = await getOwnedWork(req.user!.userId, req.params.workId);
    if (!author || !work) return res.status(403).json({ error: '본인 작품의 댓글만 숨길 수 있습니다.' });
    const comment = await db.comment.findUnique({ where: { id: req.params.commentId }, include: { episode: { select: { workId: true } } } });
    if (!comment || comment.episode.workId !== work.id) return res.status(404).json({ error: '댓글을 찾을 수 없습니다.' });
    const updated = await db.comment.update({ where: { id: comment.id }, data: { isHiddenByAuthor: req.body?.hidden !== false } });
    return res.json({ comment: updated });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

communityRouter.post('/works/:workId/comment-blocks/:readerId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { author, work } = await getOwnedWork(req.user!.userId, req.params.workId);
    if (!author || !work) return res.status(403).json({ error: '본인 작품의 댓글 작성자만 차단할 수 있습니다.' });
    if (req.params.readerId === author.userId) return res.status(400).json({ error: '본인은 차단할 수 없습니다.' });
    const block = await db.creatorCommentBlock.upsert({
      where: { workId_readerId: { workId: work.id, readerId: req.params.readerId } },
      create: { workId: work.id, creatorId: author.id, readerId: req.params.readerId },
      update: {}
    });
    return res.status(201).json({ block });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

communityRouter.delete('/works/:workId/comment-blocks/:readerId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { author, work } = await getOwnedWork(req.user!.userId, req.params.workId);
    if (!author || !work) return res.status(403).json({ error: '본인 작품의 차단만 해제할 수 있습니다.' });
    await db.creatorCommentBlock.deleteMany({ where: { workId: work.id, readerId: req.params.readerId } });
    return res.json({ message: '댓글 작성 차단을 해제했습니다.' });
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
