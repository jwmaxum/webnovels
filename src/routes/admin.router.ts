import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import { db } from '../config/db.js';
import { authenticateToken, requireRole, requirePermission, AuthRequest } from '../middlewares/auth.middleware.js';
import { RevenueEngineService } from '../services/revenueEngine.service.js';
import { ConfigService } from '../services/config.service.js';
import { TossPaymentService } from '../services/tossPayment.service.js';
import { KcpVerificationService } from '../services/kcpVerification.service.js';

export const adminRouter = Router();

// 관리자 권한 미들웨어 일괄 적용 (SUPER_ADMIN, SUB_ADMIN, ADMIN 모두 접근)
adminRouter.use(authenticateToken);
adminRouter.use(requireRole(['ADMIN']));

// ----------------------------------------------------
// [SUPER_ADMIN 전용] 서브 관리자 생성/권한부여/비밀번호변경 API
// ----------------------------------------------------

/**
 * 서브 관리자 계정 생성 (SUPER_ADMIN 전용)
 * Body: { username, password, email, nickname, permissions }
 */
adminRouter.post('/sub-admins', async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: '서브 관리자 생성 권한은 최고 관리자(SUPER_ADMIN)에게만 있습니다.' });
    }

    const { username, password, email, nickname, permissions } = req.body;

    if (!username || !password || !nickname) {
      return res.status(400).json({ error: '필수 항목이 누락되었습니다 (username, password, nickname).' });
    }

    const effectiveEmail = email || `${username}@webnovel-admin.com`;

    const existing = await db.user.findFirst({
      where: { OR: [{ username }, { email: effectiveEmail }] }
    });

    if (existing) {
      return res.status(409).json({ error: '이미 존재하는 ID 또는 이메일입니다.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const permissionJson = JSON.stringify(Array.isArray(permissions) ? permissions : ['DASHBOARD']);

    const subAdmin = await db.user.create({
      data: {
        username,
        email: effectiveEmail,
        passwordHash,
        nickname,
        role: 'SUB_ADMIN',
        permissions: permissionJson,
        isAdultVerified: true
      },
      select: {
        id: true,
        username: true,
        email: true,
        nickname: true,
        role: true,
        permissions: true,
        createdAt: true
      }
    });

    return res.status(201).json({
      message: '서브 관리자 계정이 성공적으로 생성되었습니다.',
      subAdmin: {
        ...subAdmin,
        permissions: JSON.parse(subAdmin.permissions || '[]')
      }
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 서브 관리자 목록 및 메뉴 권한 조회 (SUPER_ADMIN 전용)
 */
adminRouter.get('/sub-admins', async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: '서브 관리자 목록 조회의 권한은 최고 관리자에게만 있습니다.' });
    }

    const subAdmins = await db.user.findMany({
      where: { role: 'SUB_ADMIN' },
      select: {
        id: true,
        username: true,
        email: true,
        nickname: true,
        role: true,
        permissions: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = subAdmins.map(admin => ({
      ...admin,
      permissions: admin.permissions ? JSON.parse(admin.permissions) : []
    }));

    return res.json({ subAdmins: formatted });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 서브 관리자의 메뉴 접근 권한 수정/변경 (SUPER_ADMIN 전용)
 * Body: { permissions: ["DASHBOARD", "USER_MGMT", "WORK_MGMT"] }
 */
adminRouter.put('/sub-admins/:id/permissions', async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: '서브 관리자 권한 변경은 최고 관리자만 가능합니다.' });
    }

    const subAdminId = req.params.id;
    const { permissions } = req.body;

    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: 'permissions는 메뉴 키 배열이어야 합니다.' });
    }

    const targetUser = await db.user.findUnique({ where: { id: subAdminId } });
    if (!targetUser || targetUser.role !== 'SUB_ADMIN') {
      return res.status(404).json({ error: '수정할 서브 관리자 계정을 찾을 수 없습니다.' });
    }

    const updated = await db.user.update({
      where: { id: subAdminId },
      data: { permissions: JSON.stringify(permissions) },
      select: { id: true, username: true, nickname: true, role: true, permissions: true }
    });

    return res.json({
      message: '서브 관리자의 메뉴 접근 권한이 변경되었습니다.',
      subAdmin: {
        ...updated,
        permissions: JSON.parse(updated.permissions || '[]')
      }
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 서브 관리자의 비밀번호 변경 (SUPER_ADMIN 전용)
 * Body: { newPassword }
 */
adminRouter.put('/sub-admins/:id/password', async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: '서브 관리자 비밀번호 변경은 최고 관리자만 가능합니다.' });
    }

    const subAdminId = req.params.id;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: '새 비밀번호는 최소 4자 이상이어야 합니다.' });
    }

    const targetUser = await db.user.findUnique({ where: { id: subAdminId } });
    if (!targetUser || targetUser.role !== 'SUB_ADMIN') {
      return res.status(404).json({ error: '수정할 서브 관리자 계정을 찾을 수 없습니다.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.user.update({
      where: { id: subAdminId },
      data: { passwordHash }
    });

    return res.json({ message: `${targetUser.nickname} (${targetUser.username}) 서브 관리자의 비밀번호가 성공적으로 변경되었습니다.` });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 서브 관리자 계정 삭제 (SUPER_ADMIN 전용)
 */
adminRouter.delete('/sub-admins/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: '서브 관리자 삭제는 최고 관리자만 가능합니다.' });
    }

    const subAdminId = req.params.id;
    const targetUser = await db.user.findUnique({ where: { id: subAdminId } });
    if (!targetUser || targetUser.role !== 'SUB_ADMIN') {
      return res.status(404).json({ error: '삭제할 서브 관리자 계정을 찾을 수 없습니다.' });
    }

    await db.user.delete({ where: { id: subAdminId } });

    return res.json({ message: '서브 관리자 계정이 삭제되었습니다.' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------
// 메뉴별 접근 권한 미들웨어 적용 API
// ----------------------------------------------------

/**
 * PG 및 PASS/KCP 본인인증 설정 조회 (Section 33 - 시스템관리)
 */
adminRouter.get('/config/pg', requirePermission('SYSTEM_MGMT'), async (req: AuthRequest, res: Response) => {
  try {
    const maskedConfig = await ConfigService.getMaskedConfig();
    return res.json({ config: maskedConfig });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * PG 및 PASS/KCP 본인인증 설정 저장/업데이트
 */
adminRouter.put('/config/pg', requirePermission('SYSTEM_MGMT'), async (req: AuthRequest, res: Response) => {
  try {
    const updated = await ConfigService.updateConfig(req.body);
    const maskedConfig = await ConfigService.getMaskedConfig();
    return res.json({
      message: 'PG 및 PASS/KCP 본인인증 API 연동 설정이 저장되었습니다.',
      config: maskedConfig
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * PG 및 PASS/KCP 연동 상태 테스트
 */
adminRouter.post('/config/pg/test-connection', requirePermission('SYSTEM_MGMT'), async (req: AuthRequest, res: Response) => {
  try {
    const tossTest = await TossPaymentService.testConnection();
    const kcpTest = await KcpVerificationService.testConnection();

    return res.json({
      tossPayments: tossTest,
      kcpPass: kcpTest,
      testedAt: new Date().toISOString()
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 관리자 Dashboard KPI 통계 (Section 32, 33)
 */
adminRouter.get('/dashboard', requirePermission('DASHBOARD'), async (req: AuthRequest, res: Response) => {
  try {
    const totalUsers = await db.user.count();
    const totalAuthors = await db.author.count();
    const totalWorks = await db.work.count();
    const totalEpisodes = await db.episode.count();
    const totalAdViews = await db.adCompletion.count();

    const pendingSettlements = await db.authorSettlement.findMany({
      where: { status: 'PENDING' },
      include: { author: { select: { penName: true } } }
    });

    const recentRevenueEvents = await db.revenueEvent.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' }
    });

    return res.json({
      kpi: {
        totalUsers,
        totalAuthors,
        totalWorks,
        totalEpisodes,
        totalAdViews
      },
      pendingSettlements,
      recentRevenueEvents
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 광고 총매출 입력 및 작가 Pool 수익배분 집계 실행 (Section 13, 14, 15)
 */
adminRouter.post('/revenue/calculate', requirePermission('AD_REVENUE'), async (req: AuthRequest, res: Response) => {
  try {
    const { periodMonth, grossRevenue, adNetworkFee, writerPoolRatio } = req.body;

    if (!periodMonth || grossRevenue === undefined || adNetworkFee === undefined) {
      return res.status(400).json({ error: 'periodMonth, grossRevenue, adNetworkFee는 필수입니다.' });
    }

    const result = await RevenueEngineService.calculateMonthlyRevenue(
      periodMonth,
      Number(grossRevenue),
      Number(adNetworkFee),
      writerPoolRatio ? Number(writerPoolRatio) : 0.625
    );

    return res.json({
      message: `${periodMonth} 광고 매출 수익배분 계산이 완료되었습니다 (Estimated 상태).`,
      result
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 월 정산 마감 승인 (Estimated -> Confirmed 변환)
 */
adminRouter.post('/revenue/confirm', requirePermission('AD_REVENUE'), async (req: AuthRequest, res: Response) => {
  try {
    const { periodMonth } = req.body;

    if (!periodMonth) {
      return res.status(400).json({ error: 'periodMonth가 필수입니다.' });
    }

    const result = await RevenueEngineService.confirmMonthlySettlement(periodMonth);

    return res.json({
      message: `${periodMonth} 정산이 최종 마감/확정 처리되었습니다.`,
      result
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

/**
 * 작가 정산 신청 승인/지급 완료 처리 (Section 19)
 */
adminRouter.post('/settlement/:id/approve', requirePermission('AUTHOR_SETTLEMENT'), async (req: AuthRequest, res: Response) => {
  try {
    const settlementId = req.params.id;

    const settlement = await db.authorSettlement.findUnique({ where: { id: settlementId } });
    if (!settlement) {
      return res.status(404).json({ error: '정산 신청 내역을 찾을 수 없습니다.' });
    }

    const updated = await db.authorSettlement.update({
      where: { id: settlementId },
      data: {
        status: 'PAID',
        processedAt: new Date()
      }
    });

    return res.json({
      message: '작가 정산금 지급 승인이 완료되었습니다.',
      settlement: updated
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

