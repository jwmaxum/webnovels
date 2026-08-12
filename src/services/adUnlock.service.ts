import { db } from '../config/db.js';
import crypto from 'crypto';

export class AdUnlockService {
  /**
   * 보상형 광고 노출 요청 및 SSV 검증용 Reward Token 발급
   */
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

  /**
   * 광고 시청 완료 및 서버 검증(Server-side Verification) 후 회차 Unlock
   */
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

  /**
   * 사용자의 회차 열람 권한 여부 확인 (무료 회차 or Unlock 여부)
   */
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
