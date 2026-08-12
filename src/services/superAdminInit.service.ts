import { db } from '../config/db.js';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import path from 'path';

// .env.local 로드
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

export class SuperAdminInitService {
  /**
   * .env.local에 정의된 SUPER_ADMIN 계정 자동 초기화/시딩
   */
  static async initSuperAdmin() {
    const adminId = process.env.system_admin_id || process.env.super_admin_id || process.env.SUPER_ADMIN_ID || 'jwmaxum@gmail.com';
    const adminPassword = process.env.system_admin_password || process.env.super_admin_password || process.env.SUPER_ADMIN_PASSWORD || 'SUPER_ADMIN_PASSWORD_REDACTED';
    const adminEmail = process.env.system_admin_email || process.env.super_admin_email || process.env.SUPER_ADMIN_EMAIL || (adminId.includes('@') ? adminId : 'admin@webnovel.com');

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
