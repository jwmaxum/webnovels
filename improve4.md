# 🎨 [Improvement Step 4] Front-end 연동 계층 고도화 (Protected Reader & Creator Studio & Views)

본 문서는 `check.md`의 프로덕션 가이드라인을 바탕으로 한 **4단계: Front-end 연동 계층(Service/Hook 패턴) 개편, Protected Viewer, Creator Studio 및 데이터베이스 View 연동** 실행 명세서입니다.

---

## 1. 개요 및 목적
- **Front-end 데이터 조회 원칙 (Service Pattern) 적용**:
  - 컴포넌트나 UI 스크립트에서 Supabase 테이블을 무분별하게 직접 쿼리하지 않고, `Component → Service → Supabase / Protected RPC` 계층형 아키텍처를 확립
- **Protected Episode Content 뷰어 연동**:
  - `openReaderDirect`에서 `episodes` 테이블의 평문 본문을 읽지 않고, `private.get_episode_content(episodeId)`를 호출하여 권한 검증을 거친 본문/웹툰컷을 안전하게 수신
- **작가 Creator Studio & 안전 정산 신청 UI 연동**:
  - `loadCreatorStudioEarnings`: `author_earnings` 원장 기반 실시간 수익 대시보드 렌더링
  - `requestAuthorSettlement`: `private.request_author_settlement` RPC를 통해 인증된 계좌 스냅샷 기반 정산 신청
- **데이터베이스 뷰 (`database/16_views.sql`) 도입**:
  - `v_public_works`, `v_public_episodes`, `v_author_earnings_summary` 등 프론트엔드 전용 고성능 뷰 생성

---

## 2. 세부 구현 대상 (Tasks)

### 2.1. 프론트엔드 최적화 뷰 생성 (`database/16_views.sql`)
```sql
CREATE OR REPLACE VIEW public.v_public_works AS
SELECT
  w.id,
  w.author_id,
  a.pen_name AS author_name,
  w.title,
  w.content_type,
  w.genre,
  w.tags,
  w.description,
  w.cover_image,
  w.rating,
  w.status,
  w.is_completed,
  w.is_top_recommended,
  w.is_popular_work,
  w.is_new_work,
  w.view_count,
  w.like_count,
  w.published_at
FROM public.works w
JOIN public.authors a ON a.id = w.author_id
WHERE w.status IN ('PUBLISHED', 'ONGOING', 'COMPLETED');
```

### 2.2. 클라이언트 연동 모듈 갱신 (`public/supabase-admin.js`, `public/app.js`)
- `fetchEpisodeContent(episodeId)`: Protected RPC 경유 본문 수신
- `requestSettlementRPC(authorId, amount)`: 보안 정산 신청 RPC 호출
- 대댓글 트리 및 관리자 CMS 15대 메뉴 연동 최종 검증

---

## 3. 검증 계획
1. `node scripts/verify_normalized_db.js`로 전체 17개 SQL 모듈 및 뷰/함수 정합성 검증
2. `npx tsc --noEmit` 빌드 무오류 확인
3. `git add .`, `git commit`, `git push origin main` 실행 및 CI 통과 확인
