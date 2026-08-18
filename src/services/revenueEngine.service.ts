// ============================================================
// [Service] Revenue Engine Service (작가 광고 수익 풀 분배 및 정산 엔진)
//
// [Purpose]
// - 플랫폼의 월 광고 총매출 중 작가 풀(기본 62.5%)을 각 작품/작가의 기여도 점수에 비례하여 공정하게 배분
// - Creator Studio에서 사용되는 3대 핵심 수익 지표를 산출:
//   1. Estimated Revenue (예상 수익): 당월 집계 중인 실시간 추정 수익 (PENDING)
//   2. Confirmed Revenue (확정 수익): 월말 마감 심사를 거쳐 확정된 누적 정산금 (CONFIRMED)
//   3. Payable Revenue (정산 가능 금액): 확정 수익에서 기지급액 및 신청 대기액을 차감한 실제 출금 가능액
//
// [Contribution Score Formula (기여도 산출 공식)]
//   Score = (유효 독서수 * 1.0) + (광고 완독수 * 3.0) + (완독률% * 2.0) + ((평균 체류시간 초 / 60) * 0.5)
// ============================================================

import { db } from '../config/db.js';

export class RevenueEngineService {
  // ============================================================
  // [Function] calculateMonthlyRevenue
  // [Purpose] 월별 광고 매출 등록 및 모든 작품의 기여도 점수를 기반으로 작가별 추정 수익(Estimated) 분배
  // [Flow & Business Logic]
  // 1. 순수익 계산: `netRevenue = grossRevenue - adNetworkFee`
  // 2. 작가 Pool 산출: `writerPool = netRevenue * writerPoolRatio` (기본 62.5%)
  // 3. 모든 작품 통계(조회수, 광고뷰수, 완독률, 체류시간)를 조회하여 개별 `contributionScore` 산출
  // 4. 전체 총점(`grandTotalContribution`) 중 개별 작품 비중(`ratio`) 계산
  // 5. 비중에 따라 작가별 `estimatedAmount` 분배 후 `AuthorRevenue`에 PENDING 상태로 생성
  // ============================================================
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

  // ============================================================
  // [Function] confirmMonthlySettlement
  // [Purpose] 관리자가 해당 월의 정산을 공식 마감(Close)하여 PENDING 추정치를 확정 수익(CONFIRMED)으로 전환
  // [Flow]
  // 1. 미마감 상태의 `RevenueEvent` 조회
  // 2. 소속된 모든 `AuthorRevenue`의 `confirmedAmount = estimatedAmount`로 복사하고 상태를 `CONFIRMED`로 갱신
  // 3. `RevenueEvent.isClosed = true`로 마감 처리
  // ============================================================
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

  // ============================================================
  // [Function] getAuthorRevenueDashboard
  // [Purpose] 작가 스튜디오 메인 화면에 표시할 실시간 3대 수익 및 정산 내역 집계
  //
  // [Returned Metrics]
  // 1. estimatedRevenue: 이번 달 정산 대기 중인 추정 수익 합계 (AuthorRevenue.status == 'PENDING')
  // 2. confirmedRevenue: 마감 완료되어 확정된 총 누적 수익 (AuthorRevenue.status in ['CONFIRMED', 'PAID'])
  // 3. paidSettlements: 이미 작가 계좌로 실제 송금 완료된 정산금 (AuthorSettlement.status == 'PAID')
  // 4. pendingSettlements: 현재 정산 신청 후 관리자 심사 대기 중인 금액 (AuthorSettlement.status == 'PENDING')
  // 5. payableRevenue: 현재 즉시 출금 신청 가능한 정산 여력 (Confirmed - Paid - Pending)
  // ============================================================
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

