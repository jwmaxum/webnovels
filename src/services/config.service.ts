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

  /**
   * DB에서 SystemConfig를 조회하며, 없으면 기본 레코드 생성
   */
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

  /**
   * UI 출력용 시크릿 키 마스킹 처리된 PG 설정 조회
   */
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

  /**
   * 관리자 CMS에서 PG 및 본인인증 설정 갱신
   */
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

  private static maskSecret(secret?: string | null): string {
    if (!secret) return '';
    if (secret.length <= 8) return '****';
    return `${secret.substring(0, 4)}****${secret.substring(secret.length - 4)}`;
  }
}
