// ============================================================
// [Configuration] Database Client
//
// [Purpose]
// - Prisma Client 싱글톤 인스턴스를 생성하여 애플리케이션 전체에 제공
//
// [Usage]
// - 모든 Service, Router에서 `import { db } from '../config/db'`로 임포트하여 DB 쿼리 수행
// ============================================================

import { PrismaClient } from '@prisma/client';

export const db = new PrismaClient();
