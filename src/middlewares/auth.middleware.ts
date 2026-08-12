import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/jwt.js';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: string;
    isAdultVerified: boolean;
    permissions?: string[];
  };
}

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

/**
 * 메뉴별 접근 권한 검증 미들웨어
 * @param menuKey 예: 'DASHBOARD', 'USER_MGMT', 'SYSTEM_MGMT'
 */
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

