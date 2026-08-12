import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware.js';
import { db } from '../config/db.js';

export async function requireAdultVerification(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: '성인 콘텐츠 열람을 위해 로그인이 필요합니다.' });
  }

  const user = await db.user.findUnique({
    where: { id: req.user.userId },
    select: { isAdultVerified: true }
  });

  if (!user || !user.isAdultVerified) {
    return res.status(403).json({
      error: '성인 인증이 필요한 콘텐츠입니다.',
      code: 'ADULT_VERIFICATION_REQUIRED'
    });
  }

  next();
}
