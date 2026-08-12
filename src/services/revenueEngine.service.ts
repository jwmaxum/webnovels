import { db } from '../config/db.js';

export class RevenueEngineService {
  /**
   * 월별 광고 매출 및 작가 Pool 정산 집계 실행
   * @param periodMonth 예: '2026-08'
   * @param grossRevenue 월 광고 총매출 (원)
   * @param adNetworkFee 광고 플랫폼 수수료 (원)
   * @param writerPoolRatio 작가 Pool 분배율 (기본 0.625 = 62.5%)
   */
  static async calculateMonthlyRevenue(
    periodMonth: string,
    grossRevenue: number,
    adNetworkFee: number,
    writerPoolRatio: number = 0.625
  ) {
    const netRevenue = Math.max(0, grossRevenue - adNetworkFee);
    const writerPool = netRevenue * writerPoolRatio;
    const platformRevenue = netRevenue - writerPool;

    // 1. RevenueEvent 기록 생성 또는 업데이트
    const revenueEvent = await db.revenueEvent.create({
      data: {
        periodMonth,
        grossRevenue,
        adNetworkFee,
        netRevenue,
        writerPoolRatio,
        writerPool,
        platformRevenue,
        isClosed: false
      }
    });

    // 2. 모든 작품의 기여도 점수 계산 및 총 기여도 합계 산출
    const works = await db.work.findMany({
      include: { statistics: true, author: true }
    });

    let grandTotalContribution = 0;
    const workScores: { workId: string; authorId: string; score: number }[] = [];

    for (const work of works) {
      const stats = work.statistics;
      const reads = stats?.totalReads || work.viewCount || 0;
      const adViews = stats?.totalAdViews || 0;
      const completionRate = stats?.completionRate || 50.0;
      const avgDwellTime = stats?.avgDwellTime || 120.0;

      // 작품 기여도 공식 = (유효조회수 * 1.0) + (광고완료 * 3.0) + (완독률 * 2.0) + (체류시간/60 * 0.5)
      const score = (reads * 1.0) + (adViews * 3.0) + (completionRate * 2.0) + ((avgDwellTime / 60) * 0.5);
      
      // 통계 점수 갱신
      if (stats) {
        await db.workStatistics.update({
          where: { id: stats.id },
          data: { contributionScore: score }
        });
      }

      workScores.push({ workId: work.id, authorId: work.authorId, score });
      grandTotalContribution += score;
    }

    // 3. 작가별 기여 비중에 맞춰 AuthorRevenue 생성 (Estimated 상태)
    const authorRevenues = [];
    for (const item of workScores) {
      const ratio = grandTotalContribution > 0 ? item.score / grandTotalContribution : 0;
      const estimatedAmount = Math.round(writerPool * ratio);

      const authorRev = await db.authorRevenue.create({
        data: {
          revenueEventId: revenueEvent.id,
          authorId: item.authorId,
          workId: item.workId,
          contributionScore: item.score,
          contributionRatio: Math.round(ratio * 10000) / 100, // %
          estimatedAmount,
          confirmedAmount: 0, // 마감 전 0
          periodMonth,
          status: 'PENDING'
        }
      });
      authorRevenues.push(authorRev);
    }

    return {
      revenueEvent,
      totalWorksProcessed: works.length,
      writerPool,
      authorRevenuesCount: authorRevenues.length
    };
  }

  /**
   * 해당 월의 정산을 마감하고 확정 수익(Confirmed Revenue)으로 변경
   */
  static async confirmMonthlySettlement(periodMonth: string) {
    const revenueEvent = await db.revenueEvent.findFirst({
      where: { periodMonth, isClosed: false },
      orderBy: { createdAt: 'desc' }
    });

    if (!revenueEvent) {
      throw new Error('마감 가능한 정산 이력이 없거나 이미 마감되었습니다.');
    }

    // AuthorRevenue들을 PENDING -> CONFIRMED 로 승인하고 estimatedAmount를 confirmedAmount로 확정
    const authorRevenues = await db.authorRevenue.findMany({
      where: { revenueEventId: revenueEvent.id }
    });

    for (const rev of authorRevenues) {
      await db.authorRevenue.update({
        where: { id: rev.id },
        data: {
          confirmedAmount: rev.estimatedAmount,
          status: 'CONFIRMED'
        }
      });
    }

    await db.revenueEvent.update({
      where: { id: revenueEvent.id },
      data: { isClosed: true }
    });

    return { success: true, confirmedMonth: periodMonth };
  }

  /**
   * 작가 Creator Studio 메인 수익 대시보드 데이터 산출
   * (Estimated / Confirmed / Payable Revenue 분리)
   */
  static async getAuthorRevenueDashboard(authorId: string) {
    const revenues = await db.authorRevenue.findMany({
      where: { authorId },
      include: { revenueEvent: true }
    });

    const settlements = await db.authorSettlement.findMany({
      where: { authorId }
    });

    // 1. 이번달 예상수익 (PENDING 상태 estimatedAmount 합계)
    const estimatedRevenue = revenues
      .filter(r => r.status === 'PENDING')
      .reduce((sum, r) => sum + r.estimatedAmount, 0);

    // 2. 확정수익 (CONFIRMED 상태 confirmedAmount 합계)
    const confirmedRevenue = revenues
      .filter(r => r.status === 'CONFIRMED' || r.status === 'PAID')
      .reduce((sum, r) => sum + r.confirmedAmount, 0);

    // 3. 이미 지급 완료된 정산액 (PAID settlement)
    const paidSettlements = settlements
      .filter(s => s.status === 'PAID')
      .reduce((sum, s) => sum + s.amount, 0);

    // 4. 정산 신청 처리 중인 금액 (PENDING settlement)
    const pendingSettlements = settlements
      .filter(s => s.status === 'PENDING')
      .reduce((sum, s) => sum + s.amount, 0);

    // 5. 출금 가능한 금액 (Payable Revenue = 확정수익 - 이미 지불된 금액 - 정산 대기금액)
    const payableRevenue = Math.max(0, confirmedRevenue - paidSettlements - pendingSettlements);

    return {
      authorId,
      estimatedRevenue,
      confirmedRevenue,
      payableRevenue,
      pendingSettlements,
      paidSettlements,
      history: revenues
    };
  }
}
