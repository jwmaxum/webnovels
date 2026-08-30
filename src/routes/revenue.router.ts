// ============================================================
// [Router] Revenue & Settlement API Router
// ============================================================

import { Router, Request, Response } from 'express';
import { RevenueEngineService } from '../services/revenueEngine.service.js';

export const revenueRouter = Router();

// 1. 작가별 수익 대시보드 지표 조회
revenueRouter.get('/author/:authorId', async (req: Request, res: Response) => {
  try {
    const { authorId } = req.params;
    const dashboard = await RevenueEngineService.getAuthorRevenueDashboard(authorId);
    res.json({ success: true, data: dashboard });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. 안전한 정산 신청 API (계좌 스냅샷 보존)
revenueRouter.post('/settlement/request', async (req: Request, res: Response) => {
  try {
    const { authorId, amount, bankName, accountNumber, accountHolder } = req.body;
    
    if (!authorId || !amount) {
      return res.status(400).json({ success: false, error: 'authorId와 amount는 필수 항목입니다.' });
    }

    const result = await RevenueEngineService.requestAuthorSettlementSecure(
      authorId,
      Number(amount),
      { bankName, accountNumber, accountHolder }
    );

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 3. 관리자 월별 광고 매출 및 기여도 분배 계산
revenueRouter.post('/admin/calculate', async (req: Request, res: Response) => {
  try {
    const { periodMonth, grossRevenue, adNetworkFee, writerPoolRatio } = req.body;
    const result = await RevenueEngineService.calculateMonthlyRevenue(
      periodMonth,
      Number(grossRevenue),
      Number(adNetworkFee),
      writerPoolRatio ? Number(writerPoolRatio) : 0.625
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. 관리자 월별 정산 공식 마감 (CONFIRMED)
revenueRouter.post('/admin/confirm', async (req: Request, res: Response) => {
  try {
    const { periodMonth } = req.body;
    const result = await RevenueEngineService.confirmMonthlySettlement(periodMonth);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
