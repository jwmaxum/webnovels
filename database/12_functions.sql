-- WebNovels Production DB: 12_functions.sql
-- Private 보안 함수 (SECURITY DEFINER, SET search_path = '', Type-Safe)

-- 1. 관리자 여부 판정
CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE id::TEXT = (SELECT auth.uid())::TEXT
      AND is_active = true
  );
$$;

-- 2. 최고 관리자 (SUPER_ADMIN) 여부 판정
CREATE OR REPLACE FUNCTION private.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE id::TEXT = (SELECT auth.uid())::TEXT
      AND role = 'SUPER_ADMIN'
      AND is_active = true
  );
$$;

-- 3. 작가 본인 여부 판정
CREATE OR REPLACE FUNCTION private.is_author(
  p_author_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.authors
    WHERE id = p_author_id
      AND auth_user_id::TEXT = (SELECT auth.uid())::TEXT
  );
$$;

-- 4. 회차 본문 열람 권한 검증 (무료, 유효한 언락, 관리자)
CREATE OR REPLACE FUNCTION private.can_read_episode(
  p_episode_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.episodes e
    WHERE e.id = p_episode_id
      AND e.status = 'PUBLISHED'
      AND (
        e.access_policy = 'FREE'
        OR EXISTS (
          SELECT 1
          FROM public.episode_unlocks u
          WHERE u.episode_id = p_episode_id
            AND u.user_id::TEXT = (SELECT auth.uid())::TEXT
            AND u.status = 'ACTIVE'
            AND (
              u.expires_at IS NULL
              OR u.expires_at > NOW()
            )
        )
        OR (
          (SELECT private.is_admin())
        )
      )
  );
$$;

-- 5. 보호된 회차 본문 조회 함수
CREATE OR REPLACE FUNCTION private.get_episode_content(
  p_episode_id BIGINT
)
RETURNS TABLE (
  episode_id BIGINT,
  text_content TEXT,
  content_version INT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT
    c.episode_id,
    c.text_content,
    c.content_version
  FROM public.episode_contents c
  WHERE c.episode_id = p_episode_id
    AND (
      SELECT private.can_read_episode(p_episode_id)
    );
$$;

-- 6. 보상형 광고 시청 후 안전 해금 RPC
CREATE OR REPLACE FUNCTION private.grant_rewarded_ad_unlock(
  p_user_id UUID,
  p_episode_id BIGINT,
  p_ad_event_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event public.ad_events;
BEGIN
  SELECT *
  INTO v_event
  FROM public.ad_events
  WHERE id = p_ad_event_id
    AND user_id::TEXT = p_user_id::TEXT
    AND episode_id = p_episode_id
    AND event_type = 'REWARD'
    AND reward_granted = true;

  IF v_event.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_REWARD'
    );
  END IF;

  INSERT INTO public.episode_unlocks (
    user_id,
    episode_id,
    unlock_type,
    source_event_id
  )
  VALUES (
    p_user_id,
    p_episode_id,
    'REWARDED_AD',
    v_event.id
  );

  RETURN jsonb_build_object(
    'success', true
  );
END;
$$;

-- 7. 정산 안전 신청 RPC (최소금액, 확정잔액, 계좌인증 검증)
CREATE OR REPLACE FUNCTION private.request_author_settlement(
  p_author_id BIGINT,
  p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_author public.authors;
  v_account public.author_settlement_accounts;
  v_minimum NUMERIC;
  v_balance NUMERIC;
  v_settlement_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.authors
    WHERE id = p_author_id
      AND auth_user_id::TEXT = (SELECT auth.uid())::TEXT
      AND status = 'APPROVED'
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'NOT_AUTHORIZED'
    );
  END IF;

  SELECT minimum_settlement_amount
  INTO v_minimum
  FROM public.system_config
  WHERE id = 'default';

  IF p_amount < v_minimum THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'BELOW_MINIMUM'
    );
  END IF;

  SELECT COALESCE(
    SUM(
      CASE
        WHEN status = 'CONFIRMED'
        THEN author_revenue
        ELSE 0
      END
    ), 0
  )
  INTO v_balance
  FROM public.author_earnings
  WHERE author_id = p_author_id;

  SELECT *
  INTO v_account
  FROM public.author_settlement_accounts
  WHERE author_id = p_author_id
    AND is_primary = true
    AND verification_status = 'VERIFIED'
  LIMIT 1;

  IF v_account.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'SETTLEMENT_ACCOUNT_NOT_VERIFIED'
    );
  END IF;

  IF p_amount > v_balance THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INSUFFICIENT_BALANCE'
    );
  END IF;

  SELECT *
  INTO v_author
  FROM public.authors a
  WHERE a.id = p_author_id;

  INSERT INTO public.author_settlements (
    author_id,
    author_name_snapshot,
    bank_name_snapshot,
    account_number_snapshot,
    account_holder_snapshot,
    amount
  )
  VALUES (
    v_author.id,
    v_author.pen_name,
    v_account.bank_name,
    v_account.account_number_encrypted,
    v_account.account_holder,
    p_amount
  )
  RETURNING id INTO v_settlement_id;

  RETURN jsonb_build_object(
    'success', true,
    'settlement_id', v_settlement_id
  );
END;
$$;
