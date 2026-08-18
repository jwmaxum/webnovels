// ============================================================
// [Router] Ad Router (/api/ads)
//
// [Purpose]
// - 보상형 광고(Rewarded Video) 시청 세션 발급 및 시청 완료 후 서버 사이드 검증(SSV)을 통한 회차 Unlock API 제공
//
// [Complete Ad Unlock Flow]
// 1. Episode 선택: 유저가 4화 이상의 잠긴 회차 선택
// 2. Access 확인: `GET /api/episodes/:id` -> 402 `AD_UNLOCK_REQUIRED`
// 3. Locked 상태: Unlock 안내 팝업 노출
// 4. 광고 시청 동의: 유저가 "광고 보고 무료 열람" 클릭
// 5. 광고 시작: `POST /api/ads/request-unlock` -> 난수 `rewardToken` 발급
// 6. 광고 완료: 클라이언트 광고 재생 완료 (타이머/SDK)
// 7. Backend Reward 검증: `POST /api/ads/verify-unlock` -> HMAC 서명 검증 및 `EpisodeUnlock` 레코드 생성
// 8. Unlock: 잠금 해제 및 회차/작품 광고 통계 +1 증가
// 9. 다음 회차 이동: Reader 페이지로 본문 열람
// ============================================================

import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middlewares/auth.middleware.js';
import { AdUnlockService } from '../services/adUnlock.service.js';

export const adRouter = Router();

// ============================================================
// [Route] POST /api/ads/request-unlock
// [Purpose] 1. 회차 열람용 Rewarded Ad 시청 요청 및 Reward Token 발급
// [Security] authenticateToken 필수 (로그인 유저만 광고 언락 가능)
// ============================================================
adRouter.post('/request-unlock', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { episodeId } = req.body;

    if (!episodeId) {
      return res.status(400).json({ error: 'episodeId가 필수로 전달되어야 합니다.' });
    }

    const result = await AdUnlockService.requestRewardedAd(userId, episodeId);
    return res.json({
      message: '보상형 광고 시청 세션이 생성되었습니다.',
      ...result
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================
// [Route] POST /api/ads/verify-unlock
// [Purpose] 2. Rewarded Ad 시청 완료 서버 검증(SSV) 및 회차 Unlock 권한 확정
// [Business Logic]
// - 전달받은 `rewardToken`의 유효성 검증
// - 서버 서명 생성 및 `EpisodeUnlock` upsert
// - 광고 노출 통계(`EpisodeStatistics.adUnlockCount`, `WorkStatistics.totalAdViews`) +1 증가
// ============================================================
adRouter.post('/verify-unlock', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { episodeId, rewardToken } = req.body;

    if (!episodeId || !rewardToken) {
      return res.status(400).json({ error: 'episodeId와 rewardToken이 필수입니다.' });
    }

    const result = await AdUnlockService.verifyAndUnlockEpisode(userId, episodeId, rewardToken);

    return res.json({
      message: '광고 시청 검증이 완료되어 다음 회차가 Unlock되었습니다.',
      ...result
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || '광고 보상 검증 실패' });
  }
});

