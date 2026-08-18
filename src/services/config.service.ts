// ============================================================
// [Service] System Configuration Service (시스템 & 결제/인증 설정 관리)
//
// [Purpose]
// - DB `SystemConfig` 테이블을 기반으로 Toss Payments API 키, KCP 본인인증 키, 모드(TEST/LIVE)를 동적으로 관리
// - 관리자 화면(CMS) 노출 시 보안을 위해 Secret Key를 마스킹(`test****3b5z`) 처리
// - 설정 변경 시 마스킹된 문자열이 그대로 DB에 덮어써지지 않도록 방어 로직 내장
// ============================================================

import { db } from '../config/db.js';

export interface PgConfigInput {
  tossClientKey?: string;
  tossSecretKey?: string;
  tossMid?: string;
  tossMode?: 'TEST' | 'LIVE';
  kcpSiteCode?: string;
  kcpSiteKey?: string;
  kcpCertUrl?: string;
  kcpMode?: 'TEST' | 'LIVE';
  portoneImpKey?: string;
  portoneImpSecret?: string;
}

export class ConfigService {
  private static readonly DEFAULT_ID = 'default';

  // ============================================================
  // [Function] getConfig
  // [Purpose] DB에서 SystemConfig 단일 레코드를 조회하며, 없으면 기본 테스트 키로 자동 초기화
  // ============================================================
  static async getConfig() {
    let config = await db.systemConfig.findUnique({
      where: { id: this.DEFAULT_ID }
    });

    if (!config) {
      config = await db.systemConfig.create({
        data: {
          id: this.DEFAULT_ID,
          tossClientKey: process.env.TOSS_CLIENT_KEY || 'test_ck_docs_O7l2mZ1N3p81A2jL3b5z',
          tossSecretKey: process.env.TOSS_SECRET_KEY || 'test_sk_docs_O7l2mZ1N3p81A2jL3b5z',
          tossMid: process.env.TOSS_MID || 'tosspayments',
          tossMode: 'TEST',
          kcpSiteCode: process.env.KCP_SITE_CODE || 'T0000',
          kcpSiteKey: process.env.KCP_SITE_KEY || '3383f5080e729a67a57a8a1c0d48',
          kcpCertUrl: 'https://cert.kcp.co.kr',
          kcpMode: 'TEST'
        }
      });
    }

    return config;
  }

  // ============================================================
  // [Function] getMaskedConfig
  // [Purpose] 관리자 화면(CMS) 표시용으로 비밀키(Secret Key)를 마스킹 처리하여 반환
  // ============================================================
  static async getMaskedConfig() {
    const config = await this.getConfig();
    return {
      tossClientKey: config.tossClientKey,
      tossSecretKey: this.maskSecret(config.tossSecretKey),
      tossMid: config.tossMid,
      tossMode: config.tossMode,
      kcpSiteCode: config.kcpSiteCode,
      kcpSiteKey: this.maskSecret(config.kcpSiteKey),
      kcpCertUrl: config.kcpCertUrl,
      kcpMode: config.kcpMode,
      portoneImpKey: config.portoneImpKey,
      portoneImpSecret: this.maskSecret(config.portoneImpSecret),
      updatedAt: config.updatedAt
    };
  }

  // ============================================================
  // [Function] updateConfig
  // [Purpose] 관리자 콘솔에서 결제 PG 및 KCP 본인인증 설정을 저장/업데이트
  // [Business Exception Rule]
  // - 전달된 비밀키에 `***` 마스킹이 포함되어 있으면 변경하지 않고 기존 키를 유지
  // ============================================================
  static async updateConfig(input: PgConfigInput) {
    await this.getConfig(); // ensure default config exists

    const dataToUpdate: any = {};
    if (input.tossClientKey !== undefined) dataToUpdate.tossClientKey = input.tossClientKey;
    if (input.tossSecretKey !== undefined && !input.tossSecretKey.includes('***')) {
      dataToUpdate.tossSecretKey = input.tossSecretKey;
    }
    if (input.tossMid !== undefined) dataToUpdate.tossMid = input.tossMid;
    if (input.tossMode !== undefined) dataToUpdate.tossMode = input.tossMode;

    if (input.kcpSiteCode !== undefined) dataToUpdate.kcpSiteCode = input.kcpSiteCode;
    if (input.kcpSiteKey !== undefined && !input.kcpSiteKey.includes('***')) {
      dataToUpdate.kcpSiteKey = input.kcpSiteKey;
    }
    if (input.kcpCertUrl !== undefined) dataToUpdate.kcpCertUrl = input.kcpCertUrl;
    if (input.kcpMode !== undefined) dataToUpdate.kcpMode = input.kcpMode;

    if (input.portoneImpKey !== undefined) dataToUpdate.portoneImpKey = input.portoneImpKey;
    if (input.portoneImpSecret !== undefined && !input.portoneImpSecret.includes('***')) {
      dataToUpdate.portoneImpSecret = input.portoneImpSecret;
    }

    const updated = await db.systemConfig.update({
      where: { id: this.DEFAULT_ID },
      data: dataToUpdate
    });

    return updated;
  }

  // ============================================================
  // [Helper] maskSecret
  // [Purpose] 비밀키 앞 4자리와 뒤 4자리만 남기고 중간을 `****`로 치환
  // ============================================================
  private static maskSecret(secret?: string | null): string {
    if (!secret) return '';
    if (secret.length <= 8) return '****';
    return `${secret.substring(0, 4)}****${secret.substring(secret.length - 4)}`;
  }
}

