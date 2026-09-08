-- ============================================================
-- WebNovels Production DB: 17_creators_view.sql
-- 작가 명칭 통일(Author -> Creator)을 위한 뷰 및 별칭 생성 스크립트
-- ============================================================

-- 1. creators 뷰 생성 (기존 authors 테이블 1:1 매핑)
CREATE OR REPLACE VIEW public.creators AS
SELECT 
  id,
  auth_user_id,
  username,
  pen_name,
  profile_image,
  bio,
  status,
  verified_at,
  created_at,
  updated_at
FROM public.authors;

-- 2. 권한 부여
GRANT SELECT ON public.creators TO anon, authenticated, service_role;

-- 3. creator_settlement_accounts 뷰 생성
CREATE OR REPLACE VIEW public.creator_settlement_accounts AS
SELECT 
  id,
  author_id AS creator_id,
  bank_name,
  account_number_encrypted,
  account_holder,
  verification_status,
  verified_at,
  is_primary,
  created_at,
  updated_at
FROM public.author_settlement_accounts;

GRANT SELECT ON public.creator_settlement_accounts TO anon, authenticated, service_role;
