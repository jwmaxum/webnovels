# 🔒 [Improvement Step 2] Protected Content 접근 통제, RLS & GRANT 보안 아키텍처

본 문서는 `check.md`의 프로덕션 가이드라인을 바탕으로 한 **2단계: 회차 본문 보호(Protected Content), RLS 정책 및 GRANT/REVOKE 역할별 권한 제어** 실행 명세서입니다.

---

## 1. 개요 및 목적
- **잠긴 회차 본문 보호 (Protected Content Isolation)**:
  - 일반 독자/익명 사용자가 `episodes` 테이블을 직접 `SELECT`해도 본문(`episode_contents`)이나 웹툰 컷(`episode_panels`)을 열람할 수 없도록 격리
  - 본문 조회는 반드시 `private.get_episode_content(p_episode_id)` 보안 함수를 경유하며, 내부에서 `private.can_read_episode`를 통해 무료 회차이거나 유효한 `episode_unlocks`가 있는 경우에만 데이터 반환
- **RLS + GRANT/REVOKE 이중 방어선 구축**:
  - `anon` 역할: 공개 데이터(`works`, `episodes` 메타데이터, 공개 `authors`, `comments`, `platform_stats`, `system_config`)만 SELECT 허용
  - `episode_contents`, `episode_panels`, `author_private_profiles`, `author_settlement_accounts`, `revenue_ledger` 등에 대해 `REVOKE ALL ON ... FROM PUBLIC, anon, authenticated` 적용
- **관리자 RBAC 및 작가 판정 함수 (`private` 스키마)**:
  - `private.is_admin()`, `private.is_super_admin()`, `private.is_author(p_author_id)`를 `SECURITY DEFINER` 및 `SET search_path = ''`로 안전하게 정의

---

## 2. 세부 구현 대상 (Tasks)

### 2.1. 회차 본문 보호 함수 (`database/12_functions.sql`)
```sql
CREATE OR REPLACE FUNCTION private.can_read_episode(p_episode_id BIGINT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.episodes e
    WHERE e.id = p_episode_id
      AND e.status = 'PUBLISHED'
      AND (
        e.access_policy = 'FREE'
        OR EXISTS (
          SELECT 1 FROM public.episode_unlocks u
          WHERE u.episode_id = p_episode_id
            AND u.user_id = (SELECT auth.uid())
            AND u.status = 'ACTIVE'
            AND (u.expires_at IS NULL OR u.expires_at > NOW())
        )
        OR (SELECT private.is_admin())
      )
  );
$$;

CREATE OR REPLACE FUNCTION private.get_episode_content(p_episode_id BIGINT)
RETURNS TABLE (episode_id BIGINT, text_content TEXT, content_version INT)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $$
  SELECT c.episode_id, c.text_content, c.content_version
  FROM public.episode_contents c
  WHERE c.episode_id = p_episode_id
    AND (SELECT private.can_read_episode(p_episode_id));
$$;
```

### 2.2. RLS 정책 및 GRANT/REVOKE (`database/13_rls.sql`, `database/14_grants.sql`)
- 각 도메인별 RLS 활성화 및 `auth.uid()` 기준 정책 적용
- `anon`, `authenticated`, `service_role`에 대한 명시적 `GRANT`/`REVOKE` 설정

---

## 3. 검증 계획
1. 익명(`anon`) 클라이언트에서 `episode_contents` 직접 조회 시 빈 결과 또는 Permission Denied 확인
2. 광고 해금되지 않은 회차에 대해 `private.get_episode_content` 호출 시 빈 결과 반환 확인
3. 무료 회차 또는 광고 언락 완료 후 정상적으로 본문 텍스트가 조회되는지 검증
