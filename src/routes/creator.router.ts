// ============================================================
// [Router] Creator Studio Router (/api/creator)
//
// [Purpose]
// - 작가 등록, 크리에이터 스튜디오 대시보드 통계 및 3대 수익 지표(Estimated/Confirmed/Payable) 조회, 신규 작품/회차 등록, 정산 신청(출금), 정산 계좌 관리
//
// [Creator Revenue 3대 지표 정의]
// 1. Estimated Revenue (예상 수익): 당월 실시간 집계 중인 미마감 추정 수익 (PENDING)
// 2. Confirmed Revenue (확정 수익): 월말 마감 심사를 통과하여 공식 확정된 누적 정산금 (CONFIRMED)
// 3. Payable Revenue (정산 가능 금액): 확정 수익에서 기지급액 및 신청 대기액을 제외한 실제 출금 신청 가능 잔액 (최소 10,000원 이상 신청 가능)
//
// [Endpoints]
// - POST /api/creator/register : 일반 독자 -> 작가 전환 등록
// - GET  /api/creator/dashboard : 스튜디오 통계 및 3대 수익 대시보드 조회
// - POST /api/creator/works : 신규 웹소설 작품 등록
// - POST /api/creator/works/:workId/episodes : 작품 회차 등록 (1~3화 무료 기본, 4화부터 광고 필수)
// - POST /api/creator/settlement/request : 정산 가능 금액 출금 신청 (최소 10,000원)
// - PUT  /api/creator/profile : 작가 필명/소개 및 정산 계좌 수정
// ============================================================

import { Router, Response } from 'express';
import { db } from '../config/db.js';
import { authenticateToken, AuthRequest } from '../middlewares/auth.middleware.js';
import { RevenueEngineService } from '../services/revenueEngine.service.js';

export const creatorRouter = Router();

// ============================================================
// [Route] POST /api/creator/register
// [Purpose] 작가 등록 및 정산 계좌 연동
// [Business Logic]
// 1. 중복 작가 등록 방지
// 2. `Author` 및 `AuthorAccount` 레코드 생성
// 3. `User.role`을 'AUTHOR'로 변경
// ============================================================
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

// ============================================================
// [Route] GET /api/creator/dashboard
// [Purpose] 크리에이터 스튜디오 메인 대시보드 데이터 (작품수, 총 열람수, 광고 뷰수, 3대 수익 지표) 조회
// [API Integration] RevenueEngineService.getAuthorRevenueDashboard(authorId) 호출
// ============================================================
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

// ============================================================
// [Route] POST /api/creator/works
// [Purpose] 신규 웹소설 작품 등록
// [Parameters] title, coverImageUrl, description, genre, tags, rating(ALL/AGE_15/AGE_18), aiUsageType(NONE/ASSISTED/FULL), publishDays
// ============================================================
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

// ============================================================
// [Route] POST /api/creator/works/:workId/episodes
// [Purpose] 특정 작품의 신규 회차 등록
// [Business Logic]
// - 회차 번호(`episodeNumber`) 자동 증분 계산
// - 기본적으로 1~3화는 무료(`isFree: true, adUnlockRequired: false`), 4화부터 광고 필수(`adUnlockRequired: true`)로 자동 기본값 부여
// ============================================================
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

// ============================================================
// [Route] POST /api/creator/settlement/request
// [Purpose] 작가의 수익금 정산(출금) 신청
// [Business Rules]
// - 정산 가능 잔액(`payableRevenue`)이 10,000원 이상이어야 신청 가능
// - 신청 시 `AuthorSettlement` 테이블에 PENDING 상태로 등록되고, 정산 계좌 스냅샷 저장
// ============================================================
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

// ============================================================
// [Route] PUT /api/creator/profile
// [Purpose] 작가 프로필(필명, 소개) 및 정산 계좌 정보 수정
// [Security] 본인 작가 계정만 수정 가능
// ============================================================
creatorRouter.put('/profile', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { penName, bio, bankName, accountNumber, accountHolder } = req.body;

    const author = await db.author.findUnique({
      where: { userId },
      include: { account: true }
    });

    if (!author) {
      return res.status(404).json({ error: '등록된 작가 계정이 없습니다.' });
    }

    const authorUpdateData: any = {};
    if (penName && penName.trim() !== '') authorUpdateData.penName = penName.trim();
    if (bio !== undefined) authorUpdateData.bio = bio;

    // 작가 기본 정보 업데이트
    if (Object.keys(authorUpdateData).length > 0) {
      await db.author.update({
        where: { id: author.id },
        data: authorUpdateData
      });
    }

    // 정산 계좌 정보 업데이트
    if (bankName || accountNumber || accountHolder) {
      if (author.account) {
        await db.authorAccount.update({
          where: { authorId: author.id },
          data: {
            bankName: bankName || author.account.bankName,
            accountNumber: accountNumber || author.account.accountNumber,
            accountHolder: accountHolder || author.account.accountHolder
          }
        });
      } else if (bankName && accountNumber && accountHolder) {
        await db.authorAccount.create({
          data: {
            authorId: author.id,
            bankName,
            accountNumber,
            accountHolder
          }
        });
      }
    }

    const updatedAuthor = await db.author.findUnique({
      where: { id: author.id },
      include: { account: true }
    });

    return res.json({
      message: '작가 정보 및 정산 계좌가 성공적으로 수정되었습니다.',
      author: updatedAuthor
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || '작가 정보 수정 실패' });
  }
});

