import { Router, Response } from 'express';
import { db } from '../config/db.js';
import { authenticateToken, AuthRequest } from '../middlewares/auth.middleware.js';
import { RevenueEngineService } from '../services/revenueEngine.service.js';

export const creatorRouter = Router();

/**
 * 작가 등록 API
 */
creatorRouter.post('/register', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { penName, bio, bankName, accountNumber, accountHolder } = req.body;

    if (!penName || !bankName || !accountNumber || !accountHolder) {
      return res.status(400).json({ error: '작가 필명 및 계좌 정보가 필수입니다.' });
    }

    // 이미 작가로 등록되어 있는지 체크
    let author = await db.author.findUnique({ where: { userId } });
    if (author) {
      return res.status(409).json({ error: '이미 작가로 등록되어 있습니다.' });
    }

    author = await db.author.create({
      data: {
        userId,
        penName,
        bio,
        copyrightAgreed: true,
        account: {
          create: {
            bankName,
            accountNumber,
            accountHolder
          }
        }
      }
    });

    // User Role AUTHOR 변경
    await db.user.update({
      where: { id: userId },
      data: { role: 'AUTHOR' }
    });

    return res.status(201).json({
      message: '작가 등록이 성공적으로 완료되었습니다.',
      author
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Creator Studio 수익 Dashboard (Section 16~18)
 */
creatorRouter.get('/dashboard', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    const author = await db.author.findUnique({
      where: { userId },
      include: { works: { include: { statistics: true } } }
    });

    if (!author) {
      return res.status(403).json({ error: '작가 등록이 필요합니다.' });
    }

    const revenueDashboard = await RevenueEngineService.getAuthorRevenueDashboard(author.id);

    // 총 조회수 및 통계 합계
    let totalReads = 0;
    let totalAdViews = 0;
    for (const work of author.works) {
      totalReads += work.statistics?.totalReads || work.viewCount || 0;
      totalAdViews += work.statistics?.totalAdViews || 0;
    }

    return res.json({
      author: {
        id: author.id,
        penName: author.penName
      },
      stats: {
        totalWorks: author.works.length,
        totalReads,
        totalAdViews
      },
      revenue: revenueDashboard
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 작품 등록 API (Section 20)
 */
creatorRouter.post('/works', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { title, coverImageUrl, description, genre, tags, rating, aiUsageType, publishDays } = req.body;

    const author = await db.author.findUnique({ where: { userId } });
    if (!author) {
      return res.status(403).json({ error: '작가 등록 후 작품을 등록할 수 있습니다.' });
    }

    const work = await db.work.create({
      data: {
        authorId: author.id,
        title,
        coverImageUrl,
        description,
        genre,
        tags: tags || '',
        rating: rating || 'ALL',
        aiUsageType: aiUsageType || 'NONE',
        publishDays: publishDays || 'MON,WED,FRI',
        statistics: {
          create: {}
        }
      }
    });

    return res.status(201).json({
      message: '새로운 작품이 등록되었습니다.',
      work
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 회차 등록 API (Section 20~21)
 */
creatorRouter.post('/works/:workId/episodes', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const workId = req.params.workId;
    const { title, content, authorComment, isFree, adUnlockRequired, isPublished, scheduledAt } = req.body;

    const work = await db.work.findUnique({ where: { id: workId } });
    if (!work) {
      return res.status(404).json({ error: '작품을 찾을 수 없습니다.' });
    }

    const author = await db.author.findUnique({ where: { userId } });
    if (!author || work.authorId !== author.id) {
      return res.status(403).json({ error: '본인 작품에만 회차를 등록할 수 있습니다.' });
    }

    const lastEpisode = await db.episode.findFirst({
      where: { workId },
      orderBy: { episodeNumber: 'desc' }
    });

    const episodeNumber = (lastEpisode?.episodeNumber || 0) + 1;

    const episode = await db.episode.create({
      data: {
        workId,
        episodeNumber,
        title,
        content,
        authorComment,
        isFree: isFree ?? (episodeNumber <= 3), // 기본 1~3화 무료
        adUnlockRequired: adUnlockRequired ?? (episodeNumber > 3),
        isPublished: isPublished ?? true,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        statistics: {
          create: {}
        }
      }
    });

    return res.status(201).json({
      message: `${episodeNumber}화가 정상 등록되었습니다.`,
      episode
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 정산 신청 API (Section 19)
 */
creatorRouter.post('/settlement/request', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const author = await db.author.findUnique({
      where: { userId },
      include: { account: true }
    });

    if (!author || !author.account) {
      return res.status(403).json({ error: '작가 정보 및 계좌 정보가 설정되어 있어야 합니다.' });
    }

    const dashboard = await RevenueEngineService.getAuthorRevenueDashboard(author.id);

    if (dashboard.payableRevenue < 10000) {
      return res.status(400).json({
        error: '최소 정산 가능 금액은 10,000원 이상입니다.',
        payableRevenue: dashboard.payableRevenue
      });
    }

    const settlement = await db.authorSettlement.create({
      data: {
        authorId: author.id,
        amount: dashboard.payableRevenue,
        status: 'PENDING',
        bankInfo: `${author.account.bankName} ${author.account.accountNumber} (${author.account.accountHolder})`
      }
    });

    return res.status(201).json({
      message: '정산 신청이 접수되었습니다.',
      settlement
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});
