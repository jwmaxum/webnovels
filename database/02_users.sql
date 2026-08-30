-- ============================================================
-- 02_users.sql: 관리자, 작가, 독자 사용자 계정 테이블
-- ============================================================

-- 1. 관리자 사용자 (admin_users - RBAC 권한 제어)
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'SUB_ADMIN' CHECK (role IN ('SUPER_ADMIN', 'SUB_ADMIN')),
  permissions JSONB DEFAULT '["DASHBOARD"]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. 등록 작가 (authors - 필명, 대표작, 정산계좌, 인증상태)
CREATE TABLE IF NOT EXISTS authors (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL DEFAULT '!123456',
  email TEXT UNIQUE NOT NULL,
  pen_name TEXT NOT NULL,
  work_title TEXT,
  birthdate TEXT,
  address TEXT,
  bank_info TEXT,
  status TEXT DEFAULT '공식 인증 작가',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE authors ADD COLUMN IF NOT EXISTS pen_name TEXT;
ALTER TABLE authors ADD COLUMN IF NOT EXISTS work_title TEXT;
ALTER TABLE authors ADD COLUMN IF NOT EXISTS bank_info TEXT;
ALTER TABLE authors ADD COLUMN IF NOT EXISTS status TEXT DEFAULT '공식 인증 작가';

-- 3. 독자 회원 (readers - 회원 기본 프로필)
CREATE TABLE IF NOT EXISTS readers (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL DEFAULT '!12345',
  email TEXT UNIQUE NOT NULL,
  phone TEXT DEFAULT '미입력',
  nickname TEXT,
  is_adult_verified BOOLEAN DEFAULT false,
  subscription_status TEXT DEFAULT '일반 회원',
  reading_history JSONB DEFAULT '[]'::jsonb, -- 하위 호환용
  favorites JSONB DEFAULT '[]'::jsonb,        -- 하위 호환용
  subscribed_authors JSONB DEFAULT '[]'::jsonb,-- 하위 호환용
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE readers ADD COLUMN IF NOT EXISTS nickname TEXT;
ALTER TABLE readers ADD COLUMN IF NOT EXISTS is_adult_verified BOOLEAN DEFAULT false;
ALTER TABLE readers ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT '일반 회원';
ALTER TABLE readers ADD COLUMN IF NOT EXISTS reading_history JSONB DEFAULT '[]'::jsonb;
ALTER TABLE readers ADD COLUMN IF NOT EXISTS favorites JSONB DEFAULT '[]'::jsonb;
ALTER TABLE readers ADD COLUMN IF NOT EXISTS subscribed_authors JSONB DEFAULT '[]'::jsonb;
