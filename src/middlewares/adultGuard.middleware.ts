// ============================================================
// [Middleware] Adult Verification Guard (성인 콘텐츠 보호)
//
// [Purpose]
// - 연령 등급이 19세 이상(AGE_18)인 작품 및 회차에 접근할 때 사용자의 성인 인증 완료 여부(isAdultVerified)를 검증
//
// [Flow]
// 1. 요청 사용자(req.user) 로그인 여부 확인 (미로그인 시 401)
// 2. DB에서 실시간 `isAdultVerified` 상태 조회
// 3. 미인증 회원인 경우 403 Forbidden 응답 및 에러 코드 `ADULT_VERIFICATION_REQUIRED` 반환 -> 클라이언트에서 KCP 성인인증 팝업 트리거
// 4. 인증 완료된 회원이면 `next()` 호출하여 콘텐츠 접근 허용
// ============================================================

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

