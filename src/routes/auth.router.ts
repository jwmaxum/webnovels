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
    const { email, username, password, nickname, role, phone, birthDate, address, penName, workTitle, bankInfo } = req.body;

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
    const userRole = role === 'AUTHOR' ? 'AUTHOR' : 'READER';
    
    // 프로필 데이터 준비
    const profileData: any = {
      notificationOn: true,
      subscriptionStatus: '일반 회원',
    };
    if (birthDate) profileData.birthDate = birthDate;
    if (address) profileData.address = address;

    const user = await db.user.create({
      data: {
        email,
        username: effectiveUsername,
        passwordHash,
        nickname,
        phone: phone || null,
        role: userRole,
        isAdultVerified: userRole === 'AUTHOR', // 작가는 기본 성인인증 간주 (예시)
        profile: {
          create: profileData
        }
      },
      select: { id: true, email: true, username: true, nickname: true, role: true, isAdultVerified: true }
    });

    if (userRole === 'AUTHOR' && penName) {
      const bankName = bankInfo ? bankInfo.split(' ')[0] : '미등록은행';
      const accountNumber = bankInfo ? bankInfo.split(' ').slice(1).join(' ') : '미등록계좌';
      
      const author = await db.author.create({
        data: {
          userId: user.id,
          penName: penName,
          account: {
            create: {
              bankName: bankName,
              accountNumber: accountNumber,
              accountHolder: penName
            }
          }
        }
      });
      
      if (workTitle) {
        await db.work.create({
          data: {
            authorId: author.id,
            title: workTitle,
            description: `${workTitle} 소개글입니다.`,
            genre: '판타지',
            tags: '신작',
            rating: 'ALL'
          }
        });
      }
    }

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
        phone: true,
        isAdultVerified: true,
        profile: true,
        author: { select: { id: true, penName: true } },
        subscriptions: { select: { authorId: true } },
        workFavorites: { select: { workId: true } },
        readingHistories: { select: { workId: true } }
      }
    });

    return res.json({ user });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 독자 회원 정보수정 (닉네임 변경, 비밀번호 변경)
 * 보안: 기존 비밀번호 검증 필수
 */
authRouter.put('/profile', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { nickname, currentPassword, newPassword } = req.body;

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    const updateData: any = {};

    // 닉네임 수정
    if (nickname && nickname.trim() !== '') {
      updateData.nickname = nickname.trim();
    }

    // 비밀번호 변경 요청 시 기존 비밀번호 검증
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: '비밀번호를 변경하려면 기존 비밀번호를 입력하셔야 합니다.' });
      }

      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isCurrentPasswordValid) {
        return res.status(401).json({ error: '기존 비밀번호가 일치하지 않습니다.' });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: '새 비밀번호는 최소 6자 이상이어야 합니다.' });
      }

      updateData.passwordHash = await bcrypt.hash(newPassword, 10);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: '수정할 정보를 입력해주세요.' });
    }

    const updatedUser = await db.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        username: true,
        nickname: true,
        role: true,
        isAdultVerified: true
      }
    });

    return res.json({
      message: '회원 정보가 성공적으로 수정되었습니다.',
      user: updatedUser
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || '프로필 수정 실패' });
  }
});

/**
 * 로그아웃
 */
authRouter.post('/logout', authenticateToken, async (req: AuthRequest, res: Response) => {
  return res.json({
    message: '성공적으로 로그아웃되었습니다. 클라이언트의 인증 토큰이 폐기되었습니다.'
  });
});
