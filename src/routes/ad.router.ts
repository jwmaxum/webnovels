import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middlewares/auth.middleware.js';
import { AdUnlockService } from '../services/adUnlock.service.js';

export const adRouter = Router();

/**
 * 1. 회차 열람용 Rewarded Ad 시청 요청 API
 */
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

/**
 * 2. Rewarded Ad 시청 완료 서버 검증 (SSV) 및 회차 Unlock 확정 API
 */
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
