import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../config/db.js';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/jwt.js';
import { authenticateToken, AuthRequest } from '../middlewares/auth.middleware.js';
import { KcpVerificationService } from '../services/kcpVerification.service.js';

export const authRouter = Router();

/**
 * 일반 회원가입 (최소 개인정보 수집 원칙 준수)
 * 필수: email, password, nickname
 */
authRouter.post('/signup', async (req: Request, res: Response) => {
  try {
    const { email, username, password, nickname } = req.body;

    if (!email || !password || !nickname) {
      return res.status(400).json({ error: '필수 입력 항목이 누락되었습니다 (email, password, nickname).' });
    }

    const effectiveUsername = username || email.split('@')[0] + '_' + Math.floor(Math.random() * 10000);

    const existingUser = await db.user.findFirst({
      where: { OR: [{ email }, { username: effectiveUsername }] }
    });

    if (existingUser) {
      return res.status(409).json({ error: '이미 사용 중인 이메일 또는 ID입니다.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await db.user.create({
      data: {
        email,
        username: effectiveUsername,
        passwordHash,
        nickname,
        role: 'READER',
        isAdultVerified: false,
        profile: {
          create: {
            notificationOn: true
          }
        }
      },
      select: { id: true, email: true, username: true, nickname: true, role: true, isAdultVerified: true }
    });

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, isAdultVerified: user.isAdultVerified },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.status(201).json({
      message: '회원가입이 완료되었습니다.',
      user,
      token
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || '회원가입 실패' });
  }
});

/**
 * 로그인
 */
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, username, password } = req.body;
    const loginIdentifier = email || username;

    if (!loginIdentifier || !password) {
      return res.status(400).json({ error: '아이디/이메일과 비밀번호를 입력해주세요.' });
    }

    const user = await db.user.findFirst({
      where: {
        OR: [
          { email: loginIdentifier },
          { username: loginIdentifier }
        ]
      },
      include: { author: true }
    });

    if (!user) {
      return res.status(401).json({ error: '아이디/이메일 또는 비밀번호가 일치하지 않습니다.' });
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ error: '아이디/이메일 또는 비밀번호가 일치하지 않습니다.' });
    }

    let parsedPermissions: string[] = [];
    if (user.permissions) {
      try {
        parsedPermissions = JSON.parse(user.permissions);
      } catch (e) {
        parsedPermissions = [];
      }
    }

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        isAdultVerified: user.isAdultVerified,
        permissions: parsedPermissions
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.json({
      message: '로그인 성공',
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        nickname: user.nickname,
        role: user.role,
        isAdultVerified: user.isAdultVerified,
        permissions: parsedPermissions,
        authorId: user.author?.id
      }
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || '로그인 실패' });
  }
});

/**
 * PASS / KCP 본인인증 요청 초기화 (거래번호 발급)
 */
authRouter.post('/verify-adult/kcp/init', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const initData = await KcpVerificationService.initVerification(userId);

    return res.json({
      message: 'KCP PASS 본인인증 세션이 성공적으로 생성되었습니다.',
      data: initData
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'KCP 본인인증 초기화 실패' });
  }
});

/**
 * PASS / KCP 본인인증 결과 수신 및 성인 승인 처리
 */
authRouter.post('/verify-adult/kcp/confirm', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { ordrIdxx, certNo, userBirth, userName, phoneNo } = req.body;

    const result = await KcpVerificationService.confirmVerification({
      userId,
      ordrIdxx,
      certNo,
      userBirth,
      userName,
      phoneNo
    });

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, nickname: true, role: true, isAdultVerified: true }
    });

    const token = jwt.sign(
      { userId: user!.id, email: user!.email, role: user!.role, isAdultVerified: user!.isAdultVerified },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.json({
      message: result.message,
      result,
      user,
      token
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'KCP 본인인증 확정 실패' });
  }
});

/**
 * 성인 인증 API (Content Rating System)
 */
authRouter.post('/verify-adult', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    const user = await db.user.update({
      where: { id: userId },
      data: { isAdultVerified: true },
      select: { id: true, email: true, nickname: true, isAdultVerified: true, role: true }
    });

    // 토큰 재발급 (성인인증 플래그 반영)
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, isAdultVerified: user.isAdultVerified },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.json({
      message: '성인 인증이 완료되었습니다.',
      user,
      token
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || '성인 인증 실패' });
  }
});

/**
 * 내 프로필 조회
 */
authRouter.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        nickname: true,
        role: true,
        isAdultVerified: true,
        profile: true,
        author: { select: { id: true, penName: true } }
      }
    });

    return res.json({ user });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});
