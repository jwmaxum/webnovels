// ============================================================
// [Middleware] Authentication & Authorization Guard
//
// [Purpose]
// - 요청 헤더의 JWT Bearer Token을 검증하고 사용자 인증 객체(req.user)를 주입
// - 사용자 역할(Role: READER, AUTHOR, ADMIN, SUPER_ADMIN, SUB_ADMIN) 및 서브 관리자 메뉴 권한 검증
//
// [Security Flow]
// 1. HTTP Request Header에서 `Authorization: Bearer <token>` 추출
// 2. JWT 검증 실패 시 401(토큰 누락) 또는 403(만료/위조) 반환
// 3. 검증 성공 시 `req.user`에 `{ userId, email, role, isAdultVerified, permissions }` 저장
// ============================================================

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/jwt.js';

// ============================================================
// [Interface] AuthRequest
// [Purpose] Express Request 객체에 인증된 사용자 정보를 확장
// ============================================================
export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: string;
    isAdultVerified: boolean;
    permissions?: string[];
  };
}

// ============================================================
// [Function] authenticateToken
// [Purpose] 필수 인증 미들웨어. 유효한 토큰이 없으면 즉시 에러 응답
// ============================================================
export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: '인증 토큰이 누락되었습니다.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: '유효하지 않거나 만료된 토큰입니다.' });
  }
}

// ============================================================
// [Function] optionalAuthenticateToken
// [Purpose] 선택적 인증 미들웨어. 게스트 사용자도 통과시키되, 토큰이 있으면 유저 정보 주입 (예: 북마크/좋아요 여부 확인용)
// ============================================================
export function optionalAuthenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      req.user = decoded;
    } catch (e) {
      // optional, continue as guest
    }
  }
  next();
}

// ============================================================
// [Function] requireRole
// [Purpose] 역할 기반 접근 제어 (RBAC) 미들웨어
// [Business Logic]
// - SUPER_ADMIN 및 ADMIN은 ADMIN 권한을 요구하는 모든 엔드포인트 자동 통과
// - SUB_ADMIN도 기본 ADMIN 역할 그룹에 포함되어 1차 통과 후 메뉴별 권한 확인 진행
// ============================================================
export function requireRole(roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(403).json({ error: '접근 권한이 없습니다.' });
    }
    // SUPER_ADMIN, ADMIN은 모든 관리자 권한 포함
    if (roles.includes('ADMIN') && (req.user.role === 'SUPER_ADMIN' || req.user.role === 'SUB_ADMIN')) {
      return next();
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '접근 권한이 없습니다.' });
    }
    next();
  };
}

// ============================================================
// [Function] requirePermission
// [Purpose] 서브 관리자(SUB_ADMIN)의 세부 메뉴별 접근 권한(JSON 배열) 검증
// @param menuKey 예: 'DASHBOARD', 'USER_MGMT', 'SYSTEM_MGMT', 'WORK_MGMT', 'SETTLEMENT_MGMT'
// ============================================================
export function requirePermission(menuKey: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: '인증 정보가 없습니다.' });
    }

    // SUPER_ADMIN 및 일반 ADMIN은 모든 권한 자동 통과
    if (req.user.role === 'SUPER_ADMIN' || req.user.role === 'ADMIN') {
      return next();
    }

    // SUB_ADMIN인 경우 부여된 permissions 검증
    if (req.user.role === 'SUB_ADMIN') {
      const userPermissions = req.user.permissions || [];
      if (userPermissions.includes(menuKey)) {
        return next();
      }
      return res.status(403).json({
        error: `[${menuKey}] 메뉴에 대한 접근 권한이 없습니다. 시스템 관리자에게 문의하세요.`,
        code: 'PERMISSION_DENIED',
        requiredPermission: menuKey
      });
    }

    return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  };
}


