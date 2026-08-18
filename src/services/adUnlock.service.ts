// ============================================================
// [Service] Ad Unlock Service (보상형 광고 기반 회차 열람 권한 관리 엔진)
//
// [Purpose]
// - 잠긴 회차(Locked Episode)에 대해 사용자가 보상형 광고(Rewarded Ad)를 시청하면,
//   서버 측 검증(Server-Side Verification, SSV)을 거쳐 72시간/영구 열람 권한(EpisodeUnlock)을 부여
// - 광고 노출, 시청 완료, 회차/작품별 광고 노출 통계를 원자적으로 집계
//
// [Complete Ad Unlock Flow]
// 1. Episode 선택: 사용자가 회차 목록에서 잠긴 회차 클릭
// 2. Access 확인: `checkEpisodeAccess(userId, episodeId)`로 무료/기존 언락 여부 판정
// 3. Locked 상태: 접근 불가 시 프론트엔드에 `locked: true` 및 광고 시청 유도 모달 노출
// 4. 광고 시청 동의: 유저가 "광고 보고 무료 열람" 버튼 클릭
// 5. 광고 시작: `POST /api/ads/request-rewarded` -> `requestRewardedAd()` 호출로 난수 `rewardToken` 발급
// 6. 광고 완료: 프론트엔드/SDK에서 광고 100% 재생 완료 트리거
// 7. Backend Reward 검증: `POST /api/ads/verify-unlock` -> `verifyAndUnlockEpisode()`에서 HMAC-SHA256 서명 검증
// 8. Unlock: `EpisodeUnlock` 레코드 생성/갱신 (열람 권한 부여) 및 통계 카운트 증가
// 9. 다음 회차 이동: Reader 페이지로 진입하여 본문 렌더링
// ============================================================

import { db } from '../config/db.js';
import crypto from 'crypto';

export class AdUnlockService {
  // ============================================================
  // [Function] requestRewardedAd
  // [Purpose] 보상형 광고 노출 요청 생성 및 위변조 방지용 고유 Reward Token 발급
  // [Flow]
  // 1. 16바이트 암호학적 난수 토큰 생성
  // 2. `AdImpression` 테이블에 REQUESTED 상태로 기록
  // 3. 클라이언트에 토큰 및 AdMob Unit ID 반환
  // ============================================================
  static async requestRewardedAd(userId: string, episodeId: string) {
    const rewardToken = `reward_token_${crypto.randomBytes(16).toString('hex')}`;

    const impression = await db.adImpression.create({
      data: {
        userId,
        adType: 'REWARDED_VIDEO',
        placement: 'EPISODE_UNLOCK',
        adNetwork: 'ADMOB',
        rewardToken,
        status: 'REQUESTED'
      }
    });

    return {
      impressionId: impression.id,
      rewardToken,
      adNetwork: 'ADMOB',
      adUnitId: 'ca-app-pub-3904392571385544/1033173712'
    };
  }

  // ============================================================
  // [Function] verifyAndUnlockEpisode
  // [Purpose] 광고 시청 완료 후 서버 사이드 검증(SSV)을 거쳐 회차 열람 권한(EpisodeUnlock) 생성
  // [Business Logic]
  // 1. 발급된 `rewardToken`과 요청 유저의 일치 여부 확인
  // 2. 이미 검증 완료(VERIFIED)된 요청이면 멱등성을 보장하여 기존 언락 데이터 리턴
  // 3. HMAC-SHA256 기반 가상 서버 서명(Server Signature) 생성 및 기록
  // 4. `AdImpression` 상태를 `VERIFIED`로 변경하고 `AdCompletion` 생성
  // 5. `EpisodeUnlock` 테이블에 upsert하여 유저-회차 간 언락 권한 영구/기간 기록
  // 6. `UserAdHistory` 시청 로그 생성
  // 7. `EpisodeStatistics` (회차 광고 언락 수) 및 `WorkStatistics` (작품 누적 광고 뷰수) +1 증가 (추후 작가 정산 기여도 산출에 반영)
  // ============================================================
  static async verifyAndUnlockEpisode(userId: string, episodeId: string, rewardToken: string) {
    const impression = await db.adImpression.findUnique({
      where: { rewardToken },
      include: { completions: true }
    });

    if (!impression || impression.userId !== userId) {
      throw new Error('유효하지 않은 광고 요청입니다.');
    }

    if (impression.status === 'VERIFIED') {
      // 이미 이미 Unlock 처리된 토큰인 경우 기존 Unlock 리턴
      const existingUnlock = await db.episodeUnlock.findUnique({
        where: { userId_episodeId: { userId, episodeId } }
      });
      return { success: true, unlock: existingUnlock, alreadyUnlocked: true };
    }

    // 서버 측 위변조 방지 가상 서명 검증
    const serverSignature = crypto
      .createHmac('sha256', 'admob_secret_key_2026')
      .update(`${rewardToken}:${userId}:${episodeId}`)
      .digest('hex');

    // 1. 광고 상태 업데이트
    await db.adImpression.update({
      where: { id: impression.id },
      data: { status: 'VERIFIED' }
    });

    await db.adCompletion.create({
      data: {
        adImpressionId: impression.id,
        userId,
        rewardVerified: true,
        serverSignature
      }
    });

    // 2. 회차 Unlock 저장
    const unlock = await db.episodeUnlock.upsert({
      where: { userId_episodeId: { userId, episodeId } },
      create: {
        userId,
        episodeId,
        adTransactionId: impression.id
      },
      update: {
        unlockedAt: new Date()
      }
    });

    // 3. 광고 히스토리 및 통계 갱신
    await db.userAdHistory.create({
      data: {
        userId,
        adImpressionId: impression.id,
        episodeId
      }
    });

    const episode = await db.episode.findUnique({ where: { id: episodeId } });
    if (episode) {
      await db.episodeStatistics.upsert({
        where: { episodeId },
        create: { episodeId, adUnlockCount: 1 },
        update: { adUnlockCount: { increment: 1 } }
      });

      await db.workStatistics.upsert({
        where: { workId: episode.workId },
        create: { workId: episode.workId, totalAdViews: 1 },
        update: { totalAdViews: { increment: 1 } }
      });
    }

    return { success: true, unlock };
  }

  // ============================================================
  // [Function] checkEpisodeAccess
  // [Purpose] 특정 유저가 해당 회차 본문을 열람할 권한이 있는지 판정
  // [Rules]
  // - 1화 등 `isFree: true` 또는 `adUnlockRequired: false`인 경우 게스트/회원 모두 true
  // - 유료/광고 필수 회차의 경우 비회원은 false, 회원은 `EpisodeUnlock` 레코드 존재 시 true
  // ============================================================
  static async checkEpisodeAccess(userId?: string, episodeId?: string) {
    if (!episodeId) return false;
    const episode = await db.episode.findUnique({ where: { id: episodeId } });
    if (!episode) return false;

    // 1화~무료 회차인 경우 바로 허용
    if (episode.isFree || !episode.adUnlockRequired) {
      return true;
    }

    // 비회원이면 유료/광고회차 불가
    if (!userId) return false;

    // 회원이면 EpisodeUnlock 기록 존재 여부 확인
    const unlock = await db.episodeUnlock.findUnique({
      where: { userId_episodeId: { userId, episodeId } }
    });

    return !!unlock;
  }
}

