# 🏗️ [Improvement Step 1] Production DB 스키마 정규화 및 모듈형 SQL 구축

본 문서는 `check.md`의 프로덕션 가이드라인을 바탕으로 한 **1단계: Production DB 스키마 정규화, Private/Public 분리 및 모듈형 SQL 구축** 실행 명세서입니다.

---

## 1. 개요 및 목적
- **Auth 중심 사용자 프로필 분리**:
  - `auth.users`를 단일 진실 공급원(SSOT)으로 삼고, 자체 비밀번호 저장을 완전 배제
  - `readers`: 독자 기본 프로필 및 성인인증 정보
  - `authors`: 작가 공개 프로필 (필명, 프로필 이미지, 소개)
  - `author_private_profiles`: 작가 비공개 개인정보 (생년월일, 주소, 세금정보)
  - `author_settlement_accounts`: 작가 정산 계좌 (암호화 계좌번호, 인증상태)
  - `admin_users`: 관리자 RBAC 프로필
  - `auth.users` 신규 가입 시 자동 프로필 생성 트리거 (`handle_new_user`)
- **콘텐츠 메타데이터와 본문 완전 분리**:
  - `works`: 작품 메타데이터 (`author_id BIGINT REFERENCES authors(id)`)
  - `episodes`: 회차 메타데이터 (본문 없이 회차번호, 제목, 접근정책, 조회수만 보관)
  - `episode_contents`: 웹소설 텍스트 본문 (Protected Content)
  - `episode_panels`: 웹툰 컷 이미지 (Protected Content)
- **독자 활동 및 커머스/포인트 스키마 구축**:
  - `reading_history`, `favorites`, `author_subscriptions`, `episode_unlocks`
  - `point_accounts`, `point_transactions`, `fan_meetings`, `goods`, `goods_orders`
- **모듈형 SQL 체계 (`/database`) 및 통합 배포본 (`WebNovels_Production_v1.sql`) 생성**

---

## 2. 세부 구현 대상 (Tasks)

### 2.1. 도메인별 모듈 SQL 파일 생성 (`/database`)
```
database/
├── 01_extensions.sql       -- pgcrypto 및 private schema
├── 02_types.sql            -- content_type, work_status, episode_status, access_policy 등 Enum
├── 03_auth_profiles.sql    -- readers, authors, author_private_profiles, accounts, admin_users, trigger
├── 04_content.sql          -- works, episodes, episode_contents, episode_panels, content_reviews
├── 05_reader.sql           -- reading_history, favorites, author_subscriptions, episode_unlocks
├── 06_advertisement.sql    -- ad_units, ad_events
├── 07_revenue.sql          -- revenue_periods, revenue_ledger, author_earnings
├── 08_settlement.sql       -- author_settlements
├── 09_community.sql        -- comments (with parent_id), comment_likes, reports
├── 10_commerce.sql         -- fan_meetings, fan_meeting_tickets, goods, goods_orders
├── 11_system.sql           -- platform_stats, system_config, audit_logs
├── 15_indexes.sql          -- 쿼리 속도 및 조인 성능 최적화 인덱스
└── 99_seed_dev.sql         -- 개발/테스트용 30작품/180회차/30작가/10독자 시드
```

### 2.2. 통합 배포본 생성
- [`WebNovels_Production_v1.sql`](file:///D:/Antigravity/webnovels/WebNovels_Production_v1.sql): Supabase SQL Editor에서 1클릭으로 배포 가능한 전체 통합 SQL
- [`public/supabase-setup.sql`](file:///D:/Antigravity/webnovels/public/supabase-setup.sql) 및 [`scripts/supabase_patch_latest.sql`](file:///D:/Antigravity/webnovels/scripts/supabase_patch_latest.sql) 최신화

---

## 3. 검증 계획
1. `node scripts/verify_normalized_db.js`로 모든 25개 Production 테이블 생성 여부 확인
2. `npx tsc --noEmit` 백엔드 구문 검증
