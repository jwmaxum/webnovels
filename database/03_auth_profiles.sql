-- WebNovels Production DB: 03_auth_profiles.sql
-- Auth 중심 프로필, 작가 개인정보/정산계좌 분리 및 트리거

-- 1. 독자 프로필 (auth.users 연동)
CREATE TABLE IF NOT EXISTS public.readers (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  nickname TEXT,
  email TEXT,
  phone TEXT,
  subscription_status TEXT NOT NULL DEFAULT '일반 회원',
  is_adult_verified BOOLEAN NOT NULL DEFAULT false,
  adult_verified_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'WITHDRAWN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 작가 공개 프로필 (Public)
CREATE TABLE IF NOT EXISTS public.authors (
  id BIGSERIAL PRIMARY KEY,
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  username TEXT UNIQUE NOT NULL,
  pen_name TEXT NOT NULL,
  profile_image TEXT,
  bio TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED')),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 작가 비공개 개인정보 (Private)
CREATE TABLE IF NOT EXISTS public.author_private_profiles (
  author_id BIGINT PRIMARY KEY REFERENCES public.authors(id) ON DELETE CASCADE,
  email TEXT,
  birthdate DATE,
  address TEXT,
  tax_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. 작가 정산 계좌 (암호화 계좌번호 및 인증 상태)
CREATE TABLE IF NOT EXISTS public.author_settlement_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id BIGINT NOT NULL REFERENCES public.authors(id) ON DELETE CASCADE,
  bank_name TEXT,
  account_number_encrypted TEXT,
  account_holder TEXT,
  verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  verified_at TIMESTAMPTZ,
  is_primary BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. 관리자 RBAC 사용자
CREATE TABLE IF NOT EXISTS public.admin_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  nickname TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'SUB_ADMIN' CHECK (role IN ('SUPER_ADMIN', 'SUB_ADMIN')),
  permissions JSONB NOT NULL DEFAULT '["DASHBOARD"]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Supabase Auth Trigger: auth.users 신규 가입 시 readers 프로필 자동 생성
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(NEW.raw_user_meta_data ->> 'user_type', 'READER') = 'READER' THEN
    INSERT INTO public.readers (id, username, nickname, email)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data ->> 'username', split_part(NEW.email, '@', 1)),
      NEW.raw_user_meta_data ->> 'nickname',
      NEW.email
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();
