-- WebNovels Production DB: 14_grants.sql
-- 역할별 명시적 GRANT 및 REVOKE 권한 통제 (최소 권한의 원칙)

-- 1. PUBLIC SCHEMA USAGE
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;


-- 2. ANON GRANTS (익명 사용자 - 공개 데이터 조회만 허용)
GRANT SELECT ON public.works TO anon;
GRANT SELECT ON public.episodes TO anon;
GRANT SELECT ON public.authors TO anon;
GRANT SELECT ON public.comments TO anon;
GRANT SELECT ON public.platform_stats TO anon;
GRANT SELECT ON public.system_config TO anon;
GRANT SELECT ON public.fan_meetings TO anon;
GRANT SELECT ON public.goods TO anon;


-- 3. AUTHENTICATED GRANTS (로그인 독자 / 작가 / 관리자)
GRANT SELECT, UPDATE ON public.readers TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.reading_history TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.favorites TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.author_subscriptions TO authenticated;
GRANT SELECT ON public.episode_unlocks TO authenticated;
GRANT SELECT ON public.point_accounts TO authenticated;
GRANT SELECT ON public.point_transactions TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.comments TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.comment_likes TO authenticated;
GRANT INSERT ON public.reports TO authenticated;

GRANT SELECT, UPDATE ON public.author_private_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.author_settlement_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.works TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.episodes TO authenticated;
GRANT SELECT ON public.author_earnings TO authenticated;
GRANT SELECT ON public.author_settlements TO authenticated;

GRANT SELECT, INSERT ON public.fan_meeting_tickets TO authenticated;
GRANT SELECT, INSERT ON public.goods_orders TO authenticated;


-- 4. CRITICAL REVOKES (본문, 개인정보 및 원장의 직접 접근 원천 차단)
REVOKE ALL ON public.episode_contents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.episode_panels FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.author_private_profiles FROM anon;
REVOKE ALL ON public.author_settlement_accounts FROM anon;
REVOKE ALL ON public.revenue_ledger FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.admin_users FROM anon;
REVOKE ALL ON public.audit_logs FROM anon;

-- 민감한 Private Function은 Client의 직접 호출 차단 (Service Layer/RPC 전용)
REVOKE EXECUTE ON FUNCTION private.grant_rewarded_ad_unlock(UUID, BIGINT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.request_author_settlement(BIGINT, NUMERIC) FROM PUBLIC, anon, authenticated;
