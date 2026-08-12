import { Router, Response } from 'express';
import { db } from '../config/db.js';
import { optionalAuthenticateToken, authenticateToken, AuthRequest } from '../middlewares/auth.middleware.js';

export const workRouter = Router();

/**
 * 7.1 메인 화면 영역별 작품 목록 조회
 */
workRouter.get('/home', optionalAuthenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;

    const newWorks = await db.work.findMany({
      take: 6,
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { penName: true } } }
    });

    const popularWorks = await db.work.findMany({
      take: 6,
      orderBy: { viewCount: 'desc' },
      include: { author: { select: { penName: true } } }
    });

    const completedWorks = await db.work.findMany({
      where: { status: 'COMPLETED' },
      take: 6,
      include: { author: { select: { penName: true } } }
    });

    const adUnlockableWorks = await db.work.findMany({
      take: 6,
      include: { author: { select: { penName: true } } }
    });

    // 내가 읽던 작품 (로그인 유저)
    let myRecentReads: any[] = [];
    if (userId) {
      myRecentReads = await db.userReadingHistory.findMany({
        where: { userId },
        take: 5,
        orderBy: { readAt: 'desc' }
      });
    }

    return res.json({
      newWorks,
      popularWorks,
      completedWorks,
      adUnlockableWorks,
      myRecentReads
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 작품 목록 검색 및 장르 필터링
 */
workRouter.get('/', optionalAuthenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { genre, keyword, status, rating } = req.query;

    const where: any = {};
    if (genre) where.genre = String(genre);
    if (status) where.status = String(status);
    if (rating) where.rating = String(rating);
    if (keyword) {
      where.OR = [
        { title: { contains: String(keyword) } },
        { description: { contains: String(keyword) } },
        { tags: { contains: String(keyword) } }
      ];
    }

    const works = await db.work.findMany({
      where,
      include: {
        author: { select: { id: true, penName: true } },
        statistics: true
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.json({ works });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 작품 상세 페이지 정보 조회 (8번)
 */
workRouter.get('/:id', optionalAuthenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const workId = req.params.id;
    const userId = req.user?.userId;

    const work = await db.work.findUnique({
      where: { id: workId },
      include: {
        author: { select: { id: true, penName: true, bio: true } },
        statistics: true,
        episodes: {
          where: { isPublished: true },
          orderBy: { episodeNumber: 'asc' },
          select: {
            id: true,
            episodeNumber: true,
            title: true,
            isFree: true,
            adUnlockRequired: true,
            createdAt: true
          }
        }
      }
    });

    if (!work) {
      return res.status(404).json({ error: '존재하지 않는 작품입니다.' });
    }

    let isFavorite = false;
    let isSubscribedAuthor = false;

    if (userId) {
      const fav = await db.workFavorite.findUnique({
        where: { userId_workId: { userId, workId } }
      });
      isFavorite = !!fav;

      const sub = await db.authorSubscription.findUnique({
        where: { userId_authorId: { userId, authorId: work.authorId } }
      });
      isSubscribedAuthor = !!sub;
    }

    return res.json({
      work,
      isFavorite,
      isSubscribedAuthor
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 관심 작품 토글
 */
workRouter.post('/:id/favorite', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const workId = req.params.id;
    const userId = req.user!.userId;

    const existing = await db.workFavorite.findUnique({
      where: { userId_workId: { userId, workId } }
    });

    if (existing) {
      await db.workFavorite.delete({ where: { id: existing.id } });
      return res.json({ message: '관심 작품에서 삭제되었습니다.', isFavorite: false });
    } else {
      await db.workFavorite.create({ data: { userId, workId } });
      return res.json({ message: '관심 작품으로 등록되었습니다.', isFavorite: true });
    }
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});
