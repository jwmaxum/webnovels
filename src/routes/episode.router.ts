import { Router, Response } from 'express';
import { db } from '../config/db.js';
import { optionalAuthenticateToken, authenticateToken, AuthRequest } from '../middlewares/auth.middleware.js';
import { AdUnlockService } from '../services/adUnlock.service.js';

export const episodeRouter = Router();

/**
 * 회차 상세 본문 읽기
 */
episodeRouter.get('/:id', optionalAuthenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const episodeId = req.params.id;
    const userId = req.user?.userId;

    const episode = await db.episode.findUnique({
      where: { id: episodeId },
      include: {
        work: {
          include: { author: { select: { id: true, penName: true } } }
        }
      }
    });

    if (!episode || !episode.isPublished) {
      return res.status(404).json({ error: '회차를 찾을 수 없습니다.' });
    }

    // 1. 성인 콘텐츠 체크
    if (episode.work.rating === 'AGE_18') {
      if (!userId || !req.user?.isAdultVerified) {
        return res.status(403).json({
          error: '성인 인증이 완료된 회원만 열람 가능합니다.',
          code: 'ADULT_VERIFICATION_REQUIRED'
        });
      }
    }

    // 2. 회차 접근 권한 체크 (무료 or 광고 Unlock)
    const hasAccess = await AdUnlockService.checkEpisodeAccess(userId, episodeId);

    if (!hasAccess) {
      return res.status(402).json({
        error: '광고 시청 후 무료로 열람하실 수 있습니다.',
        code: 'AD_UNLOCK_REQUIRED',
        episode: {
          id: episode.id,
          episodeNumber: episode.episodeNumber,
          title: episode.title,
          isFree: episode.isFree,
          adUnlockRequired: episode.adUnlockRequired
        }
      });
    }

    // 3. 독서 히스토리 저장 & 조회수 증가
    if (userId) {
      await db.userReadingHistory.create({
        data: {
          userId,
          workId: episode.workId,
          episodeId: episode.id,
          readTimeSeconds: 60
        }
      });
    }

    await db.work.update({
      where: { id: episode.workId },
      data: { viewCount: { increment: 1 } }
    });

    await db.episodeStatistics.upsert({
      where: { episodeId },
      create: { episodeId, readCount: 1 },
      update: { readCount: { increment: 1 } }
    });

    return res.json({
      episode: {
        id: episode.id,
        workId: episode.workId,
        workTitle: episode.work.title,
        authorPenName: episode.work.author.penName,
        episodeNumber: episode.episodeNumber,
        title: episode.title,
        content: episode.content,
        authorComment: episode.authorComment,
        createdAt: episode.createdAt
      }
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});
