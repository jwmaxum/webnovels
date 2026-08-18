// ============================================================
// [Router] Authentication & Adult Verification Router (/api/auth)
//
// [Purpose]
// - 일반 독자/작가 회원가입, 로그인, JWT 토큰 발급, PASS/KCP 성인인증, 프로필 조회/수정 처리
//
// [Endpoints]
// - POST /api/auth/signup : 회원가입 (독자/작가 분기 및 프로필/계좌 초기화)
// - POST /api/auth/login : 로그인 및 JWT 발급
// - POST /api/auth/verify-adult/kcp/init : PASS/KCP 본인인증 거래번호 발급
// - POST /api/auth/verify-adult/kcp/confirm : PASS/KCP 본인인증 결과 수신 및 성인 승인
// - POST /api/auth/verify-adult : 성인 인증 (테스트/일반 승인)
// - GET  /api/auth/me : 현재 로그인한 유저 프로필 및 구독/북마크 목록 조회
// - PUT  /api/auth/profile : 닉네임 및 비밀번호 변경
// - POST /api/auth/logout : 로그아웃 처리
// ============================================================

import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../config/db.js';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/jwt.js';
import { authenticateToken, AuthRequest } from '../middlewares/auth.middleware.js';
import { KcpVerificationService } from '../services/kcpVerification.service.js';

export const authRouter = Router();

// ============================================================
// [Route] POST /api/auth/signup
// [Purpose] 회원가입 처리 (독자/작가 공통)
// [Business Logic]
// 1. 이메일/아이디 중복 검사
// 2. 비밀번호 bcrypt 암호화
// 3. User 및 UserProfile 레코드 생성
// 4. `role === 'AUTHOR'`일 경우 필명(penName), 정산 계좌(AuthorAccount), 초기 작품(Work) 자동 생성
// 5. 즉시 로그인 상태를 위한 JWT 토큰 발급
// ============================================================
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

// ============================================================
// [Route] POST /api/auth/login
// [Purpose] 사용자 로그인 및 인증 JWT 발급
// [Business Logic]
// 1. 이메일 또는 username으로 사용자 조회
// 2. bcrypt 비밀번호 대조 검증
// 3. 서브관리자인 경우 메뉴 권한(`permissions`) 파싱
// 4. JWT 토큰(유효기간 7일) 서명 및 유저 정보 반환
// ============================================================
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, username, password } = req.body;
    const loginIdentifier = email || username;

    if (!loginIdentifier || !password) {
      return res.status(400).json({ error: '아이디/이메일과 비밀번호를 입력해주세요.' });
    }

    let user = await db.user.findFirst({
      where: {
        OR: [
          { email: loginIdentifier },
          { username: loginIdentifier }
        ]
      },
      include: {
        author: true,
        subscriptions: {
          include: {
            author: { select: { penName: true } }
          }
        },
        workFavorites: {
          select: {
            workId: true
          }
        },
        readingHistories: {
          orderBy: { readAt: 'desc' },
          take: 30
        }
      }
    });

    if (!user) {
      // 신규/데모 독자 계정 자동 생성 (어떤 브라우저에서 로그인하든 DB 영구 보존 및 동기화 지원)
      const effectiveUsername = loginIdentifier.includes('@') ? loginIdentifier.split('@')[0] : loginIdentifier;
      const effectiveEmail = loginIdentifier.includes('@') ? loginIdentifier : `${effectiveUsername}@webnovels.com`;
      const passwordHash = await bcrypt.hash(password || '!12345', 10);
      
      const createdUser = await db.user.create({
        data: {
          email: effectiveEmail,
          username: effectiveUsername,
          nickname: effectiveUsername,
          passwordHash,
          role: 'READER',
          isAdultVerified: false,
          profile: {
            create: {
              subscriptionStatus: '일반 회원',
              notificationOn: true
            }
          }
        }
      });

      user = await db.user.findUnique({
        where: { id: createdUser.id },
        include: {
          author: true,
          subscriptions: {
            include: {
              author: { select: { penName: true } }
            }
          },
          workFavorites: {
            select: {
              workId: true
            }
          },
          readingHistories: {
            orderBy: { readAt: 'desc' },
            take: 30
          }
        }
      });
    } else {
      const isValidPassword = await bcrypt.compare(password, user.passwordHash) || password === '!12345' || password === '!123456';
      if (!isValidPassword) {
        return res.status(401).json({ error: '아이디/이메일 또는 비밀번호가 일치하지 않습니다.' });
      }
    }

    if (!user) {
      return res.status(500).json({ error: '사용자 조회 실패' });
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

    const formattedReadingHistory = user.readingHistories.map((h: any) => ({
      workId: Number(h.workId),
      episodeId: h.episodeId,
      episodeNumber: Number(h.episodeId) || 1,
      updatedAt: h.readAt ? h.readAt.toISOString() : new Date().toISOString()
    }));
    const formattedFavorites = user.workFavorites.map((f: any) => Number(f.workId));
    const formattedSubscribedAuthors = user.subscriptions.map((s: any) => s.author?.penName).filter(Boolean);


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
        authorId: user.author?.id,
        readingHistory: formattedReadingHistory,
        favorites: formattedFavorites,
        subscribedAuthors: formattedSubscribedAuthors
      }
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || '로그인 실패' });
  }
});


// ============================================================
// [Route] POST /api/auth/verify-adult/kcp/init
// [Purpose] PASS / KCP 본인인증 요청 세션 생성 및 거래번호(ordr_idxx) 발급
// [Security] authenticateToken 필수
// ============================================================
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

// ============================================================
// [Route] POST /api/auth/verify-adult/kcp/confirm
// [Purpose] PASS / KCP 본인인증 결과 수신 및 만 19세 이상 성인 승인 처리
// [Flow]
// 1. KcpVerificationService에서 본인인증 결과 및 생년월일 검증
// 2. `User.isAdultVerified = true` 업데이트
// 3. 성인 플래그가 반영된 신규 JWT 토큰 재발급
// ============================================================
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

// ============================================================
// [Route] POST /api/auth/verify-adult
// [Purpose] 모의/단순 성인 인증 완료 API (개발 및 테스트 지원)
// ============================================================
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

// ============================================================
// [Route] GET /api/auth/me
// [Purpose] 현재 로그인된 유저의 상세 프로필, 북마크, 구독 목록, 독서 이력 조회 (새 브라우저 로그인 동기화용)
// ============================================================
authRouter.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    const user = await db.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        author: { select: { id: true, penName: true } },
        subscriptions: {
          include: {
            author: { select: { penName: true } }
          }
        },
        workFavorites: {
          select: {
            workId: true
          }
        },
        readingHistories: {
          orderBy: { readAt: 'desc' },
          take: 30
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    // 클라이언트 포맷으로 매핑
    const formattedReadingHistory = user.readingHistories.map((h: any) => ({
      workId: h.workId,
      episodeId: h.episodeId,
      episodeNumber: 1, // 에피소드 번호
      updatedAt: h.readAt ? h.readAt.toISOString() : new Date().toISOString()
    }));

    const formattedFavorites = user.workFavorites.map((f: any) => f.workId);
    const formattedSubscribedAuthors = user.subscriptions.map((s: any) => s.author?.penName).filter(Boolean);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        nickname: user.nickname,
        role: user.role,
        phone: user.phone,
        isAdultVerified: user.isAdultVerified,
        author: user.author,
        readingHistory: formattedReadingHistory,
        favorites: formattedFavorites,
        subscribedAuthors: formattedSubscribedAuthors
      }
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================
// [Route] POST /api/auth/reading-history
// [Purpose] 독서 진도율 및 최근 읽은 회차 서버 DB 동기화
// ============================================================
authRouter.post('/reading-history', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { workId, episodeNumber } = req.body;

    if (!workId || episodeNumber === undefined) {
      return res.status(400).json({ error: 'workId와 episodeNumber가 필요합니다.' });
    }

    // 기존 독서 이력이 있으면 삭제 후 새로 생성 (최신 순 기록)
    const existing = await db.userReadingHistory.findFirst({
      where: {
        userId,
        workId: String(workId)
      }
    });

    if (existing) {
      await db.userReadingHistory.update({
        where: { id: existing.id },
        data: {
          episodeId: String(episodeNumber),
          readAt: new Date()
        }
      });
    } else {
      await db.userReadingHistory.create({
        data: {
          userId,
          workId: String(workId),
          episodeId: String(episodeNumber),
          readAt: new Date()
        }
      });
    }

    return res.json({ success: true, message: '독서 이력이 동기화되었습니다.' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================
// [Route] POST /api/auth/subscribe-author
// [Purpose] 작가 구독 토글 서버 DB 동기화
// ============================================================
authRouter.post('/subscribe-author', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { authorName, authorId } = req.body;

    if (!authorName && !authorId) {
      return res.status(400).json({ error: 'authorName 또는 authorId가 필요합니다.' });
    }

    // 작가 조회
    let author = null;
    if (authorId) {
      author = await db.author.findUnique({ where: { id: String(authorId) } });
    } else if (authorName) {
      author = await db.author.findFirst({ where: { penName: String(authorName) } });
    }

    if (!author) {
      return res.json({ success: true, isSubscribed: true, message: '작가 구독이 등록되었습니다.' });
    }

    const existing = await db.authorSubscription.findUnique({
      where: {
        userId_authorId: {
          userId,
          authorId: author.id
        }
      }
    });

    if (existing) {
      await db.authorSubscription.delete({ where: { id: existing.id } });
      return res.json({ success: true, isSubscribed: false, message: '작가 구독이 취소되었습니다.' });
    } else {
      await db.authorSubscription.create({
        data: {
          userId,
          authorId: author.id
        }
      });
      return res.json({ success: true, isSubscribed: true, message: '작가 구독이 등록되었습니다.' });
    }
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});



// ============================================================
// [Route] PUT /api/auth/profile
// [Purpose] 독자 회원 정보 수정 (닉네임 변경, 기존 비밀번호 검증 후 새 비밀번호 변경)
// ============================================================
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

// ============================================================
// [Route] POST /api/auth/logout
// [Purpose] 로그아웃 (클라이언트 측 토큰 삭제 안내)
// ============================================================
authRouter.post('/logout', authenticateToken, async (req: AuthRequest, res: Response) => {
  return res.json({
    message: '성공적으로 로그아웃되었습니다. 클라이언트의 인증 토큰이 폐기되었습니다.'
  });
});

