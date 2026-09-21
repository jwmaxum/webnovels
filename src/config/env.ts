// ============================================================
// [Config] Environment Variables Config (보안 분리된 환경 변수 로더)
// ============================================================
import dotenv from 'dotenv';
import path from 'path';

// Deployment environment wins; locally .env.local takes precedence over .env.
dotenv.config({ path: [path.resolve(process.cwd(), '.env.local'), path.resolve(process.cwd(), '.env')] });

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 4000,
  
  // JWT & Security
  JWT_SECRET: process.env.JWT_SECRET || '',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  
  // Supabase Service Role Key (Backend Server 전용)
  SUPABASE_URL: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  
  // Toss Payments (Secret Key는 서버에서만 격리 보관)
  TOSS_CLIENT_KEY: process.env.TOSS_CLIENT_KEY || 'test_ck_docs_O7l2mZ1N3p81A2jL3b5z',
  TOSS_SECRET_KEY: process.env.TOSS_SECRET_KEY || 'test_sk_docs_O7l2mZ1N3p81A2jL3b5z',
  TOSS_MID: process.env.TOSS_MID || 'tosspayments',
  
  // KCP Verification (Secret Key는 서버에서만 격리 보관)
  KCP_SITE_CODE: process.env.KCP_SITE_CODE || 'T0000',
  KCP_SITE_KEY: process.env.KCP_SITE_KEY || '3383f5080e729a67a57a8a1c0d48'
};
