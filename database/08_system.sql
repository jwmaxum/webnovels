-- ============================================================
-- 08_system.sql: 시스템 설정, 대시보드 통계(실데이터 일치), 포인트 거래 및 RPC
-- ============================================================

-- 1. 시스템 설정 테이블 (system_config)
CREATE TABLE IF NOT EXISTS system_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  toss_client_key TEXT DEFAULT 'test_ck_docs_O7l2mZ1N3p81A2jL3b5z',
  toss_secret_key TEXT DEFAULT 'test_sk_docs_O7l2mZ1N3p81A2jL3b5z',
  toss_mid TEXT DEFAULT 'tosspayments',
  toss_mode TEXT DEFAULT 'TEST',
  kcp_site_code TEXT DEFAULT 'T0000',
  kcp_site_key TEXT DEFAULT '3383f5080e729a67a57a8a1c0d48',
  kcp_mode TEXT DEFAULT 'TEST',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. 대시보드 5대 KPI 통계 테이블 (platform_stats - 실데이터 30작품/180회차/30작가/10독자 일치)
CREATE TABLE IF NOT EXISTS platform_stats (
  id TEXT PRIMARY KEY DEFAULT 'current',
  total_users INT DEFAULT 10,
  total_authors INT DEFAULT 30,
  total_works INT DEFAULT 30,
  total_episodes INT DEFAULT 180,
  total_ad_views INT DEFAULT 54200,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. 독자 포인트 거래 내역 테이블 (point_transactions)
CREATE TABLE IF NOT EXISTS point_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'CHARGE', 'USE', 'REFUND'
  amount INT NOT NULL,
  work_id INT REFERENCES works(id) ON DELETE SET NULL,
  episode_id INT REFERENCES episodes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 관리자 로그인 검증 및 생성 RPC
CREATE OR REPLACE FUNCTION verify_admin_login(p_email TEXT, p_password TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin admin_users;
BEGIN
  SELECT * INTO v_admin FROM admin_users WHERE email = p_email OR username = p_email;
  
  IF v_admin IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid credentials');
  END IF;

  IF v_admin.password_hash = crypt(p_password, v_admin.password_hash) THEN
    RETURN jsonb_build_object(
      'success', true,
      'admin', jsonb_build_object(
        'id', v_admin.id,
        'email', v_admin.email,
        'username', v_admin.username,
        'nickname', v_admin.nickname,
        'role', v_admin.role,
        'permissions', v_admin.permissions
      )
    );
  END IF;
  
  IF v_admin.password_hash = p_password THEN
    RETURN jsonb_build_object(
      'success', true,
      'admin', jsonb_build_object(
        'id', v_admin.id,
        'email', v_admin.email,
        'username', v_admin.username,
        'nickname', v_admin.nickname,
        'role', v_admin.role,
        'permissions', v_admin.permissions
      )
    );
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'Invalid credentials');
END;
$$;

CREATE OR REPLACE FUNCTION create_admin_user(p_username TEXT, p_password TEXT, p_email TEXT, p_nickname TEXT, p_permissions TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO admin_users (username, email, password_hash, nickname, permissions, role)
  VALUES (p_username, p_email, crypt(p_password, gen_salt('bf')), p_nickname, p_permissions::jsonb, 'SUB_ADMIN')
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
