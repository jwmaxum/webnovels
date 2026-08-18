// ============================================================
// [Router] Work Router (/api/works)
//
// [Purpose]
// - 메인 홈 큐레이션 영역별 작품 목록, 작품 검색 및 필터링, 작품 상세 정보(회차 리스트, 북마크 상태), 관심 작품(Favorite) 토글 기능 제공
//
// [Endpoints]
// - GET  /api/works/home : 메인 홈 큐레이션 목록 (상단추천, 신작, 인기작, 완결작, 최근읽은작품)
// - PATCH /api/works/:id/admin-settings : 관리자용 작품 추천/인기/신작 플래그 및 상태 토글
// - GET  /api/works : 장르, 검색어, 연재상태, 연령등급 조건별 작품 검색
// - GET  /api/works/:id : 작품 상세 메타데이터, 작가 정보, 공개 회차 목록, 유저 관심/구독 여부 조회
// - POST /api/works/:id/favorite : 작품 관심등록(북마크) 토글 (등록 <-> 해제)
// ============================================================

import { Router, Response } from 'express';
import { db } from '../config/db.js';
import { optionalAuthenticateToken, authenticateToken, AuthRequest } from '../middlewares/auth.middleware.js';

export const workRouter = Router();

// ============================================================
// [Route] GET /api/works/home
// [Purpose] 메인 화면 영역별 큐레이션 작품 데이터 조회
// [Business Logic]
// 1. 신작 목록 (`isNewWork: true` 우선, 부족 시 최신 등록순 fallback)
// 2. 인기 작품 목록 (`isPopularWork: true` 우선, 업데이트순 fallback)
// 3. 완결 작품 목록 (`status: 'COMPLETED'`)
// 4. 상단 추천작 (`isTopRecommended: true`)
// 5. 로그인 유저인 경우 최근 읽던 작품 이력(`userReadingHistory`) 5건 조회
// ============================================================
workRouter.get('/home', optionalAuthenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;

    let newWorks = await db.work.findMany({
      where: { isNewWork: true },
      take: 6,
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { penName: true } } }
    });
    if (newWorks.length < 6) {
      const fallback = await db.work.findMany({
        where: { isNewWork: false },
        take: 6 - newWorks.length,
        orderBy: { createdAt: 'desc' },
        include: { author: { select: { penName: true } } }
      });
      newWorks = [...newWorks, ...fallback];
    }

    let popularWorks = await db.work.findMany({
      where: { isPopularWork: true },
      take: 10,
      orderBy: { updatedAt: 'desc' },
      include: { author: { select: { penName: true } } }
    });
    if (popularWorks.length < 10) {
      const fallback = await db.work.findMany({
        where: { isPopularWork: false },
        take: 10 - popularWorks.length,
        orderBy: { updatedAt: 'desc' },
        include: { author: { select: { penName: true } } }
      });
      popularWorks = [...popularWorks, ...fallback];
    }

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

    const topWorks = await db.work.findMany({
      where: { isTopRecommended: true },
      take: 4,
      orderBy: { updatedAt: 'desc' },
      include: { author: { select: { penName: true } } }
    });

    return res.json({
      topWorks,
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

// ============================================================
// [Route] PATCH /api/works/:id/admin-settings
// [Purpose] 관리자 콘솔(CMS)에서 작품의 추천/인기/신작 노출 플래그 및 연재 상태(ONGOING/PAUSED/COMPLETED) 일괄 변경
// ============================================================
workRouter.patch('/:id/admin-settings', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const workId = req.params.id;
    const { isTopRecommended, isPopularWork, isNewWork, status } = req.body;

    const data: any = {};
    if (isTopRecommended !== undefined) data.isTopRecommended = Boolean(isTopRecommended);
    if (isPopularWork !== undefined) data.isPopularWork = Boolean(isPopularWork);
    if (isNewWork !== undefined) data.isNewWork = Boolean(isNewWork);
    if (status !== undefined) data.status = String(status);

    const updatedWork = await db.work.update({
      where: { id: workId },
      data
    });

    return res.json({ message: '관리자 설정이 변경되었습니다.', work: updatedWork });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================
// [Route] GET /api/works
// [Purpose] 장르별 필터링, 키워드 검색(제목/설명/태그), 연령가/연재상태 조건에 따른 작품 목록 검색
// ============================================================
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

// ============================================================
// [Route] GET /api/works/:id
// [Purpose] 작품 상세 페이지 정보 (작품 메타데이터, 작가 정보, 발행된 회차 리스트, 독자의 관심등록 및 작가 구독 여부) 반환
// ============================================================
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

// ============================================================
// [Route] POST /api/works/:id/favorite
// [Purpose] 독자의 작품 관심등록(북마크) 토글 (기존 등록되어 있으면 삭제, 없으면 등록)
// ============================================================
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

