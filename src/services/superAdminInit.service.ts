// ============================================================
// [Service] Super Admin Initialization Service (최고 관리자 계정 자동 생성 및 동기화)
//
// [Purpose]
// - 서버 기동 시 `.env.local` 또는 시스템 환경변수에 설정된 최고 관리자(SUPER_ADMIN) 계정을 감지하여 DB에 자동 등록/비밀번호 동기화
//
// [Security Flow]
// 1. 환경변수 `system_admin_id`, `system_admin_password` 등 확인
// 2. bcrypt(솔트 라운드 10)로 비밀번호 해시화
// 3. 기존 계정이 없으면 신규 생성, 이미 존재하면 비밀번호 및 권한(Role: SUPER_ADMIN, permissions: ['ALL']) 업데이트
// ============================================================

import { db } from '../config/db.js';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import path from 'path';

// .env.local 로드
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

export class SuperAdminInitService {
  // ============================================================
  // [Function] initSuperAdmin
  // [Purpose] 서버 시작 시 환경변수 기반 SUPER_ADMIN 계정 생성/갱신 실행
  // ============================================================
  static async initSuperAdmin() {
    const adminId = process.env.system_admin_id || process.env.super_admin_id || process.env.SUPER_ADMIN_ID;
    const adminPassword = process.env.system_admin_password || process.env.super_admin_password || process.env.SUPER_ADMIN_PASSWORD;

    if (!adminId || !adminPassword) {
      console.log('⚠️ [SuperAdminInit] 환경변수(.env.local)에 SUPER_ADMIN 계정 정보가 지정되지 않았습니다.');
      return null;
    }

    const adminEmail = process.env.system_admin_email || process.env.super_admin_email || process.env.SUPER_ADMIN_EMAIL || (adminId.includes('@') ? adminId : 'admin@webnovel.local');

    const passwordHash = await bcrypt.hash(adminPassword, 10);

    let superAdmin = await db.user.findFirst({
      where: {
        OR: [
          { username: adminId },
          { email: adminEmail }
        ]
      }
    });

    if (!superAdmin) {
      superAdmin = await db.user.create({
        data: {
          email: adminEmail,
          username: adminId,
          passwordHash,
          nickname: '시스템 최고관리자',
          role: 'SUPER_ADMIN',
          isAdultVerified: true,
          permissions: JSON.stringify(['ALL'])
        }
      });
      console.log(`✅ [SuperAdminInit] .env.local 최고관리자 계정 (${adminId}) DB 등록 완료!`);
    } else {
      superAdmin = await db.user.update({
        where: { id: superAdmin.id },
        data: {
          username: adminId,
          email: adminEmail,
          passwordHash,
          role: 'SUPER_ADMIN',
          permissions: JSON.stringify(['ALL'])
        }
      });
      console.log(`✅ [SuperAdminInit] .env.local 최고관리자 계정 (${adminId}) DB 업데이트 완료!`);
    }

    return superAdmin;
  }
}

