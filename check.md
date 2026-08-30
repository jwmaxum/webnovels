# WebNovels Production DB 구축 최종 요청사항

## 1. 작업 목적

현재 개발된 WebNovels 데이터베이스 및 Front-end 구조를 기준으로,
Production 환경에서 사용할 수 있는 Supabase PostgreSQL 데이터베이스를 구축한다.

핵심 서비스는 다음과 같다.

> 독자 → 작품 → 회차 → 광고 시청 → 회차 Unlock → 독서 → 광고수익 → 작가 수익 → 정산

본 작업은 단순히 기존 SQL을 수정하는 작업이 아니라,
실서비스 운영을 전제로 다음 영역을 안전하게 분리하는 것을 목적으로 한다.

* Authentication
* Reader
* Author
* Content
* Reader Activity
* Advertisement
* Episode Access
* Revenue
* Settlement
* Community
* Commerce
* Admin / RBAC
* Audit / Security

---

# 2. 반드시 준수할 핵심 원칙

## 2.1 Supabase Auth 중심 인증

독자/작가/관리자의 비밀번호를 자체 Table에 저장하지 않는다.

사용자 인증은:

`auth.users`

를 기준으로 한다.

Public schema에는 Profile 정보만 저장한다.

---

## 2.2 개인정보와 공개 프로필 분리

Public API에서 작가의 다음 정보가 노출되지 않도록 한다.

* Email
* 생년월일
* 주소
* 세금정보
* 정산계좌
* 기타 개인정보

Public Profile과 Private Profile/Settlement 정보를 분리한다.

---

## 2.3 잠긴 회차 본문 보호

가장 중요한 보안요건이다.

일반 사용자가 `episodes` Table을 직접 조회해도
잠긴 회차의 본문(`content`) 또는 웹툰 이미지 URL을 얻을 수 없어야 한다.

따라서:

`Episode Metadata`

와

`Protected Episode Content`

를 분리한다.

---

## 2.4 광고 Reward는 Client를 신뢰하지 않는다

다음 로직은 Client에서 직접 결정하지 않는다.

* 광고 완료
* Reward 지급
* Episode Unlock
* 광고수익 생성

광고 Network의 Server-Side Verification 결과를
Server/Edge Function에서 검증한 후 DB를 변경한다.

---

## 2.5 Revenue는 Ledger 기반

현재 금액만 저장하지 않고,
수익 발생과 배분을 추적할 수 있는 원장 구조를 사용한다.

예:

광고수익
→ 작가 Pool
→ 작품 배분
→ 작가 Earnings
→ 정산 예약
→ 지급 완료

전체 흐름을 재현할 수 있어야 한다.

---

## 2.6 Settlement는 직접 INSERT 금지

작가가 `author_settlements`를 직접 INSERT하지 못하게 한다.

정산신청 RPC/Edge Function을 통해:

* 정산 가능 금액
* 최소 정산금액
* 중복 신청
* 작가 상태
* 계좌 상태

를 검증한다.

---

## 2.7 RLS와 GRANT를 함께 사용

RLS만 활성화하는 것으로 끝내지 않는다.

각 Table마다:

* `GRANT`
* `REVOKE`
* `RLS`
* `POLICY`

를 함께 설정한다.

특히 `anon` 권한은 공개 데이터에만 허용한다.

---

## 2.8 SECURITY DEFINER 최소 사용

`SECURITY DEFINER` 함수가 필요한 경우:

* `SET search_path = ''`
* 모든 객체를 `public.table` 식으로 schema-qualified
* 필요 없는 `EXECUTE` 권한 제거
* `anon`에게 실행권한 부여 금지
* 가능한 경우 `private` schema 사용

원칙을 적용한다.

---

# 3. 최종 Domain 구조

## AUTH

* auth.users
* readers
* authors
* admin_users

## CONTENT

* works
* episodes
* episode_contents
* episode_panels
* content_reviews
* media_assets

## READER

* reading_history
* favorites
* author_subscriptions
* episode_unlocks
* point_accounts
* point_transactions

## ADVERTISEMENT

* ad_units
* ad_events
* revenue_periods
* revenue_ledger

## CREATOR

* author_earnings
* author_settlement_accounts
* author_settlements

## COMMUNITY

* comments
* comment_likes
* reports

## COMMERCE

* fan_meetings
* fan_meeting_tickets
* goods
* goods_orders

## SYSTEM

* platform_stats
* system_config
* audit_logs

---

# 4. 핵심 Access 정책

## Public

허용:

* 공개 작품 정보
* 공개 작가 프로필
* 공개 회차 Metadata
* 공개 댓글
* 판매 중인 Goods / Fan Meeting

금지:

* 비공개 개인정보
* 잠긴 회차 본문
* Revenue
* Settlement
* Ad raw data
* Admin 정보

---

## Reader

본인만:

* Profile
* Reading History
* Favorites
* Author Subscription
* Unlock History
* Point History
* 자신의 댓글

---

## Author

본인 작품만:

* Work
* Episode
* Analytics
* Earnings
* Settlement

단, 수익과 정산 데이터는 Read Only 또는 RPC 기반 처리로 제한한다.

---

## Admin

RBAC에 따라:

* User
* Author
* Work
* Episode
* Review
* Report
* Ad
* Revenue
* Settlement
* Commerce
* System

을 관리한다.

---

# 5. 금지사항

Production DB에서 다음을 금지한다.

* anon full access
* 평문 비밀번호 저장
* Payment Secret 저장
* Ad Network Secret 저장
* 잠긴 Episode 본문 public SELECT
* 작가 정산금 직접 UPDATE
* 작가 정산금 직접 INSERT
* Client에서 임의 Reward 생성
* Client에서 Revenue 생성
* Client에서 Settlement 상태 변경
* 관리자 권한의 Client-side 단독 판정
* 테스트 데이터와 Production 데이터 혼합

---

# 6. Seed 정책

Production SQL에는 실제 테스트용 비밀번호와 테스트 Secret Key를 포함하지 않는다.

다음 데이터는 별도 `seed_dev.sql`로 분리한다.

* reader1 ~ reader10
* writer1 ~ writer30
* 테스트 관리자
* 테스트 광고수익
* 테스트 정산
* 테스트 작품

Production에서는 계정 생성과 인증을 Supabase Auth 또는 관리 도구에서 수행한다.

---

# 7. Front-end 연동 요구사항

Front-end는 Supabase Table을 무분별하게 직접 호출하지 않는다.

다음 구조를 사용한다.

Component
→ Hook
→ Service
→ Supabase / Edge Function

예:

`useEpisode()`
→ `episodeService.getEpisode()`

`useUnlockEpisode()`
→ `unlockService.unlock()`

`useCreatorRevenue()`
→ `revenueService.getCreatorRevenue()`

---

# 8. 핵심 Server Flow

## Episode

Reader
→ Episode Metadata
→ Access Check
→ Free면 Content
→ Locked면 Unlock UI
→ Reward Ad
→ Server Verification
→ Unlock
→ Protected Content 요청

## Revenue

Ad Network
→ Verification
→ ad_events
→ revenue_ledger
→ revenue allocation
→ author_earnings
→ settlement

---

# 9. 최종 산출물

다음 파일을 함께 관리한다.

database/
├── 01_extensions.sql
├── 02_types.sql
├── 03_auth_profiles.sql
├── 04_content.sql
├── 05_reader.sql
├── 06_advertisement.sql
├── 07_revenue.sql
├── 08_settlement.sql
├── 09_community.sql
├── 10_commerce.sql
├── 11_admin.sql
├── 12_functions.sql
├── 13_rls.sql
├── 14_grants.sql
├── 15_indexes.sql
├── 16_views.sql
└── 99_seed_dev.sql

그리고 최종 통합 파일:

WebNovels_Production_v1.sql

```
```
최종 SQL
-- WebNovels Database Schema (Production)
/* ============================================================
   WebNovels_Production_v1.sql
   Supabase PostgreSQL / Production Baseline

   핵심:
   - Supabase Auth
   - RLS + GRANT
   - Public / Private Data 분리
   - Protected Episode Content
   - Rewarded Ad Verification
   - Revenue Ledger
   - Author Earnings
   - Settlement
   - Admin RBAC
   - Audit Log
   ============================================================ */


/* ============================================================
   01. EXTENSION
   ============================================================ */

CREATE EXTENSION IF NOT EXISTS pgcrypto;


/* ============================================================
   02. PRIVATE SCHEMA
   SECURITY DEFINER 함수는 가능한 private schema에서 관리
   ============================================================ */

CREATE SCHEMA IF NOT EXISTS private;


/* ============================================================
   03. ENUMS
   ============================================================ */

DO $$
BEGIN

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'content_type'
  ) THEN
    CREATE TYPE public.content_type AS ENUM (
      'NOVEL',
      'WEBTOON'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'work_status'
  ) THEN
    CREATE TYPE public.work_status AS ENUM (
      'DRAFT',
      'REVIEW',
      'PUBLISHED',
      'ONGOING',
      'PAUSED',
      'COMPLETED',
      'REJECTED'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'episode_status'
  ) THEN
    CREATE TYPE public.episode_status AS ENUM (
      'DRAFT',
      'REVIEW',
      'SCHEDULED',
      'PUBLISHED',
      'HIDDEN',
      'DELETED'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'access_policy'
  ) THEN
    CREATE TYPE public.access_policy AS ENUM (
      'FREE',
      'REWARDED_AD',
      'POINT',
      'PURCHASE',
      'MEMBERSHIP'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'unlock_type'
  ) THEN
    CREATE TYPE public.unlock_type AS ENUM (
      'FREE',
      'REWARDED_AD',
      'POINT',
      'PURCHASE',
      'MEMBERSHIP'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'settlement_status'
  ) THEN
    CREATE TYPE public.settlement_status AS ENUM (
      'PENDING',
      'CONFIRMED',
      'PROCESSING',
      'PAID',
      'REJECTED',
      'ON_HOLD',
      'CANCELLED'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'review_status'
  ) THEN
    CREATE TYPE public.review_status AS ENUM (
      'PENDING',
      'APPROVED',
      'REJECTED'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'report_status'
  ) THEN
    CREATE TYPE public.report_status AS ENUM (
      'PENDING',
      'RESOLVED',
      'REJECTED'
    );
  END IF;

END $$;


/* ============================================================
   04. READERS
   Auth와 Profile 분리
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.readers (

  id UUID PRIMARY KEY
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  username TEXT UNIQUE NOT NULL,

  nickname TEXT,

  email TEXT,

  phone TEXT,

  subscription_status TEXT
    NOT NULL DEFAULT '일반 회원',

  is_adult_verified BOOLEAN
    NOT NULL DEFAULT false,

  adult_verified_at TIMESTAMPTZ,

  status TEXT
    NOT NULL DEFAULT 'ACTIVE'
    CHECK (
      status IN (
        'ACTIVE',
        'SUSPENDED',
        'WITHDRAWN'
      )
    ),

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   05. AUTHORS PUBLIC PROFILE
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.authors (

  id BIGSERIAL PRIMARY KEY,

  auth_user_id UUID UNIQUE
    REFERENCES auth.users(id)
    ON DELETE SET NULL,

  username TEXT UNIQUE NOT NULL,

  pen_name TEXT NOT NULL,

  profile_image TEXT,

  bio TEXT,

  status TEXT
    NOT NULL DEFAULT 'PENDING'
    CHECK (
      status IN (
        'PENDING',
        'APPROVED',
        'SUSPENDED',
        'REJECTED'
      )
    ),

  verified_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   06. AUTHORS PRIVATE PROFILE
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.author_private_profiles (

  author_id BIGINT PRIMARY KEY
    REFERENCES public.authors(id)
    ON DELETE CASCADE,

  email TEXT,

  birthdate DATE,

  address TEXT,

  tax_status TEXT,

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   07. AUTHOR SETTLEMENT ACCOUNTS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.author_settlement_accounts (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  author_id BIGINT NOT NULL
    REFERENCES public.authors(id)
    ON DELETE CASCADE,

  bank_name TEXT,

  account_number_encrypted TEXT,

  account_holder TEXT,

  verification_status TEXT
    NOT NULL DEFAULT 'PENDING'
    CHECK (
      verification_status IN (
        'PENDING',
        'VERIFIED',
        'REJECTED'
      )
    ),

  verified_at TIMESTAMPTZ,

  is_primary BOOLEAN
    NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   08. WORKS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.works (

  id BIGSERIAL PRIMARY KEY,

  author_id BIGINT NOT NULL
    REFERENCES public.authors(id)
    ON DELETE RESTRICT,

  title TEXT NOT NULL,

  content_type public.content_type
    NOT NULL DEFAULT 'NOVEL',

  genre TEXT[]
    NOT NULL DEFAULT '{}',

  tags TEXT[]
    NOT NULL DEFAULT '{}',

  description TEXT,

  cover_image TEXT,

  rating TEXT
    NOT NULL DEFAULT 'ALL'
    CHECK (
      rating IN (
        'ALL',
        '15',
        '18'
      )
    ),

  status public.work_status
    NOT NULL DEFAULT 'DRAFT',

  is_completed BOOLEAN
    NOT NULL DEFAULT false,

  is_top_recommended BOOLEAN
    NOT NULL DEFAULT false,

  is_popular_work BOOLEAN
    NOT NULL DEFAULT false,

  is_new_work BOOLEAN
    NOT NULL DEFAULT true,

  ai_usage_type TEXT
    NOT NULL DEFAULT 'NONE',

  view_count BIGINT
    NOT NULL DEFAULT 0,

  like_count BIGINT
    NOT NULL DEFAULT 0,

  published_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   09. EPISODES - METADATA ONLY
   본문 없음
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.episodes (

  id BIGSERIAL PRIMARY KEY,

  work_id BIGINT NOT NULL
    REFERENCES public.works(id)
    ON DELETE CASCADE,

  episode_number INT NOT NULL,

  title TEXT NOT NULL,

  access_policy public.access_policy
    NOT NULL DEFAULT 'FREE',

  author_comment TEXT,

  status public.episode_status
    NOT NULL DEFAULT 'DRAFT',

  scheduled_at TIMESTAMPTZ,

  view_count BIGINT
    NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW(),

  UNIQUE(work_id, episode_number)
);


/* ============================================================
   10. EPISODE CONTENT
   Protected Content
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.episode_contents (

  episode_id BIGINT PRIMARY KEY
    REFERENCES public.episodes(id)
    ON DELETE CASCADE,

  text_content TEXT,

  content_version INT
    NOT NULL DEFAULT 1,

  updated_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   11. WEBTOON PANELS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.episode_panels (

  id BIGSERIAL PRIMARY KEY,

  episode_id BIGINT NOT NULL
    REFERENCES public.episodes(id)
    ON DELETE CASCADE,

  panel_number INT NOT NULL,

  image_url TEXT NOT NULL,

  width INT,

  height INT,

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW(),

  UNIQUE(episode_id, panel_number)
);


/* ============================================================
   12. READING HISTORY
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.reading_history (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  work_id BIGINT NOT NULL
    REFERENCES public.works(id)
    ON DELETE CASCADE,

  episode_id BIGINT NOT NULL
    REFERENCES public.episodes(id)
    ON DELETE CASCADE,

  progress NUMERIC(5,2)
    NOT NULL DEFAULT 0
    CHECK (
      progress >= 0
      AND progress <= 100
    ),

  last_read_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW(),

  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, episode_id)
);


/* ============================================================
   13. FAVORITES
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.favorites (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  work_id BIGINT NOT NULL
    REFERENCES public.works(id)
    ON DELETE CASCADE,

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, work_id)
);


/* ============================================================
   14. AUTHOR SUBSCRIPTIONS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.author_subscriptions (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  author_id BIGINT NOT NULL
    REFERENCES public.authors(id)
    ON DELETE CASCADE,

  notification_enabled BOOLEAN
    NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, author_id)
);


/* ============================================================
   15. EPISODE UNLOCKS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.episode_unlocks (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  episode_id BIGINT NOT NULL
    REFERENCES public.episodes(id)
    ON DELETE CASCADE,

  unlock_type public.unlock_type
    NOT NULL,

  source_event_id UUID,

  granted_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW(),

  expires_at TIMESTAMPTZ,

  status TEXT
    NOT NULL DEFAULT 'ACTIVE'
    CHECK (
      status IN (
        'ACTIVE',
        'EXPIRED',
        'REVOKED'
      )
    )
);


/* ============================================================
   16. POINT ACCOUNT
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.point_accounts (

  user_id UUID PRIMARY KEY
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  balance BIGINT
    NOT NULL DEFAULT 0
    CHECK (balance >= 0),

  updated_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   17. POINT TRANSACTIONS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.point_transactions (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  type TEXT NOT NULL
    CHECK (
      type IN (
        'CHARGE',
        'USE',
        'REFUND',
        'BONUS',
        'AD_REWARD'
      )
    ),

  amount BIGINT NOT NULL,

  work_id BIGINT
    REFERENCES public.works(id)
    ON DELETE SET NULL,

  episode_id BIGINT
    REFERENCES public.episodes(id)
    ON DELETE SET NULL,

  reference_id TEXT,

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   18. AD UNITS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.ad_units (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  name TEXT NOT NULL,

  ad_network TEXT NOT NULL,

  placement TEXT NOT NULL,

  ad_unit_code TEXT,

  is_rewarded BOOLEAN
    NOT NULL DEFAULT false,

  is_active BOOLEAN
    NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   19. AD EVENTS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.ad_events (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  user_id UUID
    REFERENCES auth.users(id)
    ON DELETE SET NULL,

  work_id BIGINT
    REFERENCES public.works(id)
    ON DELETE SET NULL,

  episode_id BIGINT
    REFERENCES public.episodes(id)
    ON DELETE SET NULL,

  ad_unit_id UUID
    REFERENCES public.ad_units(id)
    ON DELETE SET NULL,

  ad_network TEXT NOT NULL,

  external_event_id TEXT,

  event_type TEXT NOT NULL
    CHECK (
      event_type IN (
        'REQUEST',
        'IMPRESSION',
        'START',
        'COMPLETE',
        'REWARD',
        'SKIP',
        'VERIFY_FAILED'
      )
    ),

  reward_granted BOOLEAN
    NOT NULL DEFAULT false,

  revenue NUMERIC(14,2)
    NOT NULL DEFAULT 0,

  currency TEXT
    NOT NULL DEFAULT 'KRW',

  metadata JSONB
    NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   20. REVENUE PERIODS
   월별 마감
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.revenue_periods (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  period_month DATE NOT NULL,

  gross_revenue NUMERIC(14,2)
    NOT NULL DEFAULT 0,

  network_fee NUMERIC(14,2)
    NOT NULL DEFAULT 0,

  net_revenue NUMERIC(14,2)
    NOT NULL DEFAULT 0,

  writer_pool_ratio NUMERIC(6,4)
    NOT NULL DEFAULT 0.625,

  writer_pool NUMERIC(14,2)
    NOT NULL DEFAULT 0,

  platform_revenue NUMERIC(14,2)
    NOT NULL DEFAULT 0,

  is_closed BOOLEAN
    NOT NULL DEFAULT false,

  closed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW(),

  UNIQUE(period_month)
);


/* ============================================================
   21. REVENUE LEDGER
   금액 이동 원장
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.revenue_ledger (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  revenue_period_id UUID
    REFERENCES public.revenue_periods(id)
    ON DELETE SET NULL,

  author_id BIGINT
    REFERENCES public.authors(id)
    ON DELETE SET NULL,

  work_id BIGINT
    REFERENCES public.works(id)
    ON DELETE SET NULL,

  transaction_type TEXT NOT NULL
    CHECK (
      transaction_type IN (
        'AD_REVENUE',
        'NETWORK_FEE',
        'WRITER_POOL',
        'AUTHOR_ALLOCATION',
        'PLATFORM_REVENUE',
        'ADJUSTMENT',
        'SETTLEMENT_RESERVED',
        'SETTLEMENT_PAID'
      )
    ),

  direction TEXT NOT NULL
    CHECK (
      direction IN (
        'CREDIT',
        'DEBIT'
      )
    ),

  amount NUMERIC(14,2)
    NOT NULL
    CHECK (amount >= 0),

  reference_id TEXT,

  description TEXT,

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   22. AUTHOR EARNINGS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.author_earnings (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  author_id BIGINT NOT NULL
    REFERENCES public.authors(id)
    ON DELETE CASCADE,

  work_id BIGINT
    REFERENCES public.works(id)
    ON DELETE SET NULL,

  period_date DATE NOT NULL,

  ad_impressions BIGINT
    NOT NULL DEFAULT 0,

  rewarded_views BIGINT
    NOT NULL DEFAULT 0,

  gross_revenue NUMERIC(14,2)
    NOT NULL DEFAULT 0,

  platform_fee NUMERIC(14,2)
    NOT NULL DEFAULT 0,

  author_revenue NUMERIC(14,2)
    NOT NULL DEFAULT 0,

  status TEXT
    NOT NULL DEFAULT 'ESTIMATED'
    CHECK (
      status IN (
        'ESTIMATED',
        'CONFIRMED',
        'SETTLED'
      )
    ),

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW(),

  UNIQUE(author_id, work_id, period_date)
);


/* ============================================================
   23. AUTHOR SETTLEMENTS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.author_settlements (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  author_id BIGINT NOT NULL
    REFERENCES public.authors(id)
    ON DELETE RESTRICT,

  author_name_snapshot TEXT NOT NULL,

  bank_name_snapshot TEXT,

  account_number_snapshot TEXT,

  account_holder_snapshot TEXT,

  amount NUMERIC(14,2)
    NOT NULL
    CHECK (amount > 0),

  status public.settlement_status
    NOT NULL DEFAULT 'PENDING',

  requested_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW(),

  processed_at TIMESTAMPTZ,

  processed_by UUID
    REFERENCES auth.users(id)
    ON DELETE SET NULL,

  reject_reason TEXT
);


/* ============================================================
   24. COMMENTS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.comments (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  nickname_snapshot TEXT NOT NULL,

  work_id BIGINT
    REFERENCES public.works(id)
    ON DELETE CASCADE,

  episode_id BIGINT
    REFERENCES public.episodes(id)
    ON DELETE CASCADE,

  parent_id UUID
    REFERENCES public.comments(id)
    ON DELETE CASCADE,

  content TEXT NOT NULL,

  likes_count INT
    NOT NULL DEFAULT 0,

  is_blocked BOOLEAN
    NOT NULL DEFAULT false,

  is_deleted BOOLEAN
    NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   25. COMMENT LIKES
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.comment_likes (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  comment_id UUID NOT NULL
    REFERENCES public.comments(id)
    ON DELETE CASCADE,

  user_id UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW(),

  UNIQUE(comment_id, user_id)
);


/* ============================================================
   26. CONTENT REVIEWS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.content_reviews (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  work_id BIGINT
    REFERENCES public.works(id)
    ON DELETE CASCADE,

  episode_id BIGINT
    REFERENCES public.episodes(id)
    ON DELETE CASCADE,

  work_title_snapshot TEXT NOT NULL,

  author_name_snapshot TEXT NOT NULL,

  status public.review_status
    NOT NULL DEFAULT 'PENDING',

  reject_reason TEXT,

  reviewer_id UUID
    REFERENCES auth.users(id)
    ON DELETE SET NULL,

  reviewer_name TEXT,

  reviewed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   27. REPORTS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.reports (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  reporter_id UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  target_type TEXT NOT NULL
    CHECK (
      target_type IN (
        'COMMENT',
        'WORK',
        'EPISODE',
        'USER',
        'AUTHOR'
      )
    ),

  target_id TEXT NOT NULL,

  reason TEXT NOT NULL,

  status public.report_status
    NOT NULL DEFAULT 'PENDING',

  resolved_action TEXT,

  resolved_by UUID
    REFERENCES auth.users(id)
    ON DELETE SET NULL,

  resolved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   28. ADMIN USERS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.admin_users (

  id UUID PRIMARY KEY
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  username TEXT UNIQUE NOT NULL,

  email TEXT UNIQUE NOT NULL,

  nickname TEXT NOT NULL,

  role TEXT
    NOT NULL DEFAULT 'SUB_ADMIN'
    CHECK (
      role IN (
        'SUPER_ADMIN',
        'SUB_ADMIN'
      )
    ),

  permissions JSONB
    NOT NULL DEFAULT '["DASHBOARD"]'::jsonb,

  is_active BOOLEAN
    NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   29. AUDIT LOG
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.audit_logs (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  admin_id UUID
    REFERENCES auth.users(id)
    ON DELETE SET NULL,

  action TEXT NOT NULL,

  target_type TEXT,

  target_id TEXT,

  old_data JSONB,

  new_data JSONB,

  ip_address INET,

  user_agent TEXT,

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   30. PLATFORM STATS
   Summary / Cache 용
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.platform_stats (

  id TEXT PRIMARY KEY DEFAULT 'current',

  total_users BIGINT NOT NULL DEFAULT 0,

  total_authors BIGINT NOT NULL DEFAULT 0,

  total_works BIGINT NOT NULL DEFAULT 0,

  total_episodes BIGINT NOT NULL DEFAULT 0,

  total_ad_views BIGINT NOT NULL DEFAULT 0,

  total_revenue NUMERIC(14,2)
    NOT NULL DEFAULT 0,

  total_author_revenue NUMERIC(14,2)
    NOT NULL DEFAULT 0,

  updated_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   31. SYSTEM CONFIG
   Secret key 저장 금지
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.system_config (

  id TEXT PRIMARY KEY DEFAULT 'default',

  service_name TEXT
    NOT NULL DEFAULT 'WebNovels',

  maintenance_mode BOOLEAN
    NOT NULL DEFAULT false,

  default_writer_pool_ratio NUMERIC(6,4)
    NOT NULL DEFAULT 0.625,

  minimum_settlement_amount NUMERIC(14,2)
    NOT NULL DEFAULT 10000,

  reward_ad_enabled BOOLEAN
    NOT NULL DEFAULT true,

  updated_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   32. FAN MEETINGS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.fan_meetings (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  author_id BIGINT
    REFERENCES public.authors(id)
    ON DELETE SET NULL,

  title TEXT NOT NULL,

  description TEXT,

  event_at TIMESTAMPTZ NOT NULL,

  location TEXT,

  ticket_price NUMERIC(12,2)
    NOT NULL DEFAULT 0,

  capacity INT,

  status TEXT
    NOT NULL DEFAULT 'DRAFT'
    CHECK (
      status IN (
        'DRAFT',
        'OPEN',
        'CLOSED',
        'COMPLETED',
        'CANCELLED'
      )
    ),

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   33. FAN MEETING TICKETS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.fan_meeting_tickets (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  meeting_id UUID NOT NULL
    REFERENCES public.fan_meetings(id)
    ON DELETE CASCADE,

  user_id UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  amount NUMERIC(12,2)
    NOT NULL,

  status TEXT
    NOT NULL DEFAULT 'PENDING'
    CHECK (
      status IN (
        'PENDING',
        'PAID',
        'CANCELLED',
        'REFUNDED'
      )
    ),

  purchased_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   34. GOODS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.goods (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  author_id BIGINT
    REFERENCES public.authors(id)
    ON DELETE SET NULL,

  name TEXT NOT NULL,

  description TEXT,

  price NUMERIC(12,2)
    NOT NULL,

  stock INT
    NOT NULL DEFAULT 0,

  image_url TEXT,

  status TEXT
    NOT NULL DEFAULT 'DRAFT'
    CHECK (
      status IN (
        'DRAFT',
        'ON_SALE',
        'SOLD_OUT',
        'HIDDEN'
      )
    ),

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   35. GOODS ORDERS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.goods_orders (

  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL
    REFERENCES auth.users(id)
    ON DELETE RESTRICT,

  total_amount NUMERIC(12,2)
    NOT NULL,

  status TEXT
    NOT NULL DEFAULT 'PENDING'
    CHECK (
      status IN (
        'PENDING',
        'PAID',
        'PREPARING',
        'SHIPPED',
        'DELIVERED',
        'CANCELLED',
        'REFUNDED'
      )
    ),

  created_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW()
);


/* ============================================================
   36. INDEXES
   ============================================================ */

CREATE INDEX IF NOT EXISTS idx_works_author
ON public.works(author_id);

CREATE INDEX IF NOT EXISTS idx_works_status
ON public.works(status);

CREATE INDEX IF NOT EXISTS idx_works_content_type
ON public.works(content_type);

CREATE INDEX IF NOT EXISTS idx_works_published
ON public.works(published_at DESC);

CREATE INDEX IF NOT EXISTS idx_episodes_work
ON public.episodes(work_id, episode_number);

CREATE INDEX IF NOT EXISTS idx_episodes_status
ON public.episodes(status);

CREATE INDEX IF NOT EXISTS idx_episode_unlock_user
ON public.episode_unlocks(user_id);

CREATE INDEX IF NOT EXISTS idx_episode_unlock_episode
ON public.episode_unlocks(episode_id);

CREATE INDEX IF NOT EXISTS idx_reading_user_recent
ON public.reading_history(user_id, last_read_at DESC);

CREATE INDEX IF NOT EXISTS idx_favorites_user
ON public.favorites(user_id);

CREATE INDEX IF NOT EXISTS idx_subscription_user
ON public.author_subscriptions(user_id);

CREATE INDEX IF NOT EXISTS idx_subscription_author
ON public.author_subscriptions(author_id);

CREATE INDEX IF NOT EXISTS idx_ad_events_user
ON public.ad_events(user_id);

CREATE INDEX IF NOT EXISTS idx_ad_events_episode
ON public.ad_events(episode_id);

CREATE INDEX IF NOT EXISTS idx_ad_events_created
ON public.ad_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_author_earnings_author
ON public.author_earnings(author_id);

CREATE INDEX IF NOT EXISTS idx_author_earnings_date
ON public.author_earnings(period_date);

CREATE INDEX IF NOT EXISTS idx_settlements_author
ON public.author_settlements(author_id);

CREATE INDEX IF NOT EXISTS idx_settlements_status
ON public.author_settlements(status);

CREATE INDEX IF NOT EXISTS idx_comments_episode
ON public.comments(episode_id);

CREATE INDEX IF NOT EXISTS idx_reports_status
ON public.reports(status);

CREATE INDEX IF NOT EXISTS idx_reviews_status
ON public.content_reviews(status);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created
ON public.audit_logs(created_at DESC);


/* ============================================================
   37. UPDATED_AT FUNCTION
   ============================================================ */

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


/* ============================================================
   38. UPDATED_AT TRIGGERS
   ============================================================ */

DROP TRIGGER IF EXISTS trg_readers_updated
ON public.readers;

CREATE TRIGGER trg_readers_updated
BEFORE UPDATE ON public.readers
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();


DROP TRIGGER IF EXISTS trg_authors_updated
ON public.authors;

CREATE TRIGGER trg_authors_updated
BEFORE UPDATE ON public.authors
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();


DROP TRIGGER IF EXISTS trg_author_private_updated
ON public.author_private_profiles;

CREATE TRIGGER trg_author_private_updated
BEFORE UPDATE ON public.author_private_profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();


DROP TRIGGER IF EXISTS trg_author_accounts_updated
ON public.author_settlement_accounts;

CREATE TRIGGER trg_author_accounts_updated
BEFORE UPDATE ON public.author_settlement_accounts
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();


DROP TRIGGER IF EXISTS trg_works_updated
ON public.works;

CREATE TRIGGER trg_works_updated
BEFORE UPDATE ON public.works
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();


DROP TRIGGER IF EXISTS trg_episodes_updated
ON public.episodes;

CREATE TRIGGER trg_episodes_updated
BEFORE UPDATE ON public.episodes
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();


DROP TRIGGER IF EXISTS trg_system_config_updated
ON public.system_config;

CREATE TRIGGER trg_system_config_updated
BEFORE UPDATE ON public.system_config
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();


/* ============================================================
   39. PRIVATE SECURITY DEFINER FUNCTIONS
   ============================================================ */


/* 관리자 여부 */

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
    WHERE id = (SELECT auth.uid())
      AND is_active = true
  );
$$;


/* SUPER ADMIN 여부 */

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
    WHERE id = (SELECT auth.uid())
      AND role = 'SUPER_ADMIN'
      AND is_active = true
  );
$$;


/* 현재 사용자가 해당 작가인지 확인 */

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
      AND auth_user_id = (SELECT auth.uid())
  );
$$;


/* ============================================================
   40. EPISODE ACCESS FUNCTION
   Protected Content 접근 여부
   ============================================================ */

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
            AND u.user_id = (SELECT auth.uid())
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


/* ============================================================
   41. SECURE EPISODE CONTENT FUNCTION
   잠긴 본문을 직접 SELECT할 수 없고
   권한 확인 후에만 반환
   ============================================================ */

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


/* ============================================================
   42. REWARDED AD UNLOCK
   Edge Function / 서버에서 호출하는 용도
   ============================================================ */

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

    AND user_id = p_user_id

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


/* ============================================================
   43. SETTLEMENT REQUEST
   ============================================================ */

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
      AND auth_user_id = (SELECT auth.uid())
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


  SELECT a
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


/* ============================================================
   44. AUTH USER → READER PROFILE
   Supabase Auth Trigger
   ============================================================ */

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN

  IF COALESCE(
    NEW.raw_user_meta_data ->> 'user_type',
    'READER'
  ) = 'READER'

  THEN

    INSERT INTO public.readers (
      id,
      username,
      nickname,
      email
    )

    VALUES (

      NEW.id,

      COALESCE(
        NEW.raw_user_meta_data ->> 'username',
        split_part(NEW.email, '@', 1)
      ),

      NEW.raw_user_meta_data ->> 'nickname',

      NEW.email

    )

    ON CONFLICT (id)
    DO NOTHING;

  END IF;

  RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS on_auth_user_created
ON auth.users;


CREATE TRIGGER on_auth_user_created

AFTER INSERT
ON auth.users

FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();


/* ============================================================
   45. DEFAULT CONFIG
   ============================================================ */

INSERT INTO public.system_config (
  id,
  service_name,
  default_writer_pool_ratio,
  minimum_settlement_amount,
  reward_ad_enabled
)

VALUES (
  'default',
  'WebNovels',
  0.625,
  10000,
  true
)

ON CONFLICT (id)
DO NOTHING;


INSERT INTO public.platform_stats (
  id
)

VALUES (
  'current'
)

ON CONFLICT (id)
DO NOTHING;


/* ============================================================
   46. RLS ENABLE
   ============================================================ */

ALTER TABLE public.readers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.author_private_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.author_settlement_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.works ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.episode_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.episode_panels ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.reading_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.author_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.episode_unlocks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.point_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ad_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_ledger ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.author_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.author_settlements ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.content_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.platform_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.fan_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fan_meeting_tickets ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.goods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_orders ENABLE ROW LEVEL SECURITY;


/* ============================================================
   47. REVOKE PUBLIC/ANON ACCESS
   ============================================================ */

REVOKE ALL ON ALL TABLES IN SCHEMA public
FROM anon;

REVOKE ALL ON ALL TABLES IN SCHEMA public
FROM authenticated;


/* ============================================================
   48. PUBLIC GRANTS
   ============================================================ */

/* 공개 작품 */
GRANT SELECT
ON public.works
TO anon, authenticated;


/* 공개 작가 */
GRANT SELECT
ON public.authors
TO anon, authenticated;


/* 공개 Episode Metadata */
GRANT SELECT
ON public.episodes
TO anon, authenticated;


/* 공개 댓글 */
GRANT SELECT
ON public.comments
TO anon, authenticated;


/* 공개 Goods */
GRANT SELECT
ON public.goods
TO anon, authenticated;


/* 공개 Fan Meeting */
GRANT SELECT
ON public.fan_meetings
TO anon, authenticated;


/* Platform 공개 통계 */
GRANT SELECT
ON public.platform_stats
TO anon, authenticated;


/* Reader 본인 데이터 */
GRANT SELECT, INSERT, UPDATE, DELETE
ON public.reading_history
TO authenticated;

GRANT SELECT, INSERT, DELETE
ON public.favorites
TO authenticated;

GRANT SELECT, INSERT, DELETE, UPDATE
ON public.author_subscriptions
TO authenticated;


/* Comments */
GRANT INSERT, UPDATE, DELETE
ON public.comments
TO authenticated;

GRANT INSERT, DELETE
ON public.comment_likes
TO authenticated;


/* User profile */
GRANT SELECT, UPDATE
ON public.readers
TO authenticated;


/* Author Profile */
GRANT SELECT, UPDATE
ON public.authors
TO authenticated;


/* ============================================================
   49. RLS POLICIES
   ============================================================ */


/* ---------- READERS ---------- */

DROP POLICY IF EXISTS readers_self_select
ON public.readers;

CREATE POLICY readers_self_select
ON public.readers

FOR SELECT
TO authenticated

USING (
  id = (SELECT auth.uid())
);


DROP POLICY IF EXISTS readers_self_update
ON public.readers;

CREATE POLICY readers_self_update
ON public.readers

FOR UPDATE
TO authenticated

USING (
  id = (SELECT auth.uid())
)

WITH CHECK (
  id = (SELECT auth.uid())
);


/* ---------- AUTHORS ---------- */

DROP POLICY IF EXISTS authors_public_select
ON public.authors;

CREATE POLICY authors_public_select
ON public.authors

FOR SELECT
TO anon, authenticated

USING (
  status = 'APPROVED'
);


/* ---------- WORKS ---------- */

DROP POLICY IF EXISTS works_public_select
ON public.works;

CREATE POLICY works_public_select
ON public.works

FOR SELECT
TO anon, authenticated

USING (
  status IN (
    'PUBLISHED',
    'ONGOING',
    'COMPLETED'
  )
);


/* ---------- EPISODES METADATA ---------- */

DROP POLICY IF EXISTS episodes_public_select
ON public.episodes;

CREATE POLICY episodes_public_select
ON public.episodes

FOR SELECT
TO anon, authenticated

USING (
  status = 'PUBLISHED'
);


/* ---------- READING HISTORY ---------- */

CREATE POLICY reading_history_self
ON public.reading_history

FOR ALL
TO authenticated

USING (
  user_id = (SELECT auth.uid())
)

WITH CHECK (
  user_id = (SELECT auth.uid())
);


/* ---------- FAVORITES ---------- */

CREATE POLICY favorites_self
ON public.favorites

FOR ALL
TO authenticated

USING (
  user_id = (SELECT auth.uid())
)

WITH CHECK (
  user_id = (SELECT auth.uid())
);


/* ---------- SUBSCRIPTIONS ---------- */

CREATE POLICY subscriptions_self
ON public.author_subscriptions

FOR ALL
TO authenticated

USING (
  user_id = (SELECT auth.uid())
)

WITH CHECK (
  user_id = (SELECT auth.uid())
);


/* ---------- EPISODE UNLOCK ---------- */

CREATE POLICY unlock_select_self
ON public.episode_unlocks

FOR SELECT
TO authenticated

USING (
  user_id = (SELECT auth.uid())
);


/* ---------- COMMENTS ---------- */

CREATE POLICY comments_public_select
ON public.comments

FOR SELECT
TO anon, authenticated

USING (
  is_blocked = false
  AND is_deleted = false
);


/* ---------- COMMENT INSERT ---------- */

CREATE POLICY comments_insert_self
ON public.comments

FOR INSERT
TO authenticated

WITH CHECK (
  user_id = (SELECT auth.uid())
);


/* ---------- COMMENT UPDATE ---------- */

CREATE POLICY comments_update_self
ON public.comments

FOR UPDATE
TO authenticated

USING (
  user_id = (SELECT auth.uid())
)

WITH CHECK (
  user_id = (SELECT auth.uid())
);


/* ---------- COMMENT DELETE ---------- */

CREATE POLICY comments_delete_self
ON public.comments

FOR DELETE
TO authenticated

USING (
  user_id = (SELECT auth.uid())
);


/* ---------- COMMENT LIKES ---------- */

CREATE POLICY comment_likes_public_select
ON public.comment_likes

FOR SELECT
TO anon, authenticated

USING (true);


CREATE POLICY comment_likes_insert_self
ON public.comment_likes

FOR INSERT
TO authenticated

WITH CHECK (
  user_id = (SELECT auth.uid())
);


CREATE POLICY comment_likes_delete_self
ON public.comment_likes

FOR DELETE
TO authenticated

USING (
  user_id = (SELECT auth.uid())
);


/* ---------- PLATFORM STATS ---------- */

CREATE POLICY platform_stats_public
ON public.platform_stats

FOR SELECT
TO anon, authenticated

USING (
  id = 'current'
);


/* ---------- GOODS ---------- */

CREATE POLICY goods_public
ON public.goods

FOR SELECT
TO anon, authenticated

USING (
  status IN (
    'ON_SALE',
    'SOLD_OUT'
  )
);


/* ---------- FAN MEETING ---------- */

CREATE POLICY fan_meeting_public
ON public.fan_meetings

FOR SELECT
TO anon, authenticated

USING (
  status IN (
    'OPEN',
    'CLOSED',
    'COMPLETED'
  )
);


/* ============================================================
   50. PRIVATE/FINANCIAL TABLES
   public/authenticated direct access intentionally blocked
   ============================================================ */


/*
  다음 테이블은 일반 Browser Client에 직접 GRANT 하지 않는다.

  author_private_profiles
  author_settlement_accounts
  ad_events
  revenue_periods
  revenue_ledger
  author_earnings
  author_settlements
  point_transactions
  point_accounts
  admin_users
  audit_logs
  system_config
  content_reviews
  reports

  필요한 작업은 Server / Edge Function / 관리자 API를 통해 수행한다.
*/


/* ============================================================
   51. REVOKE FUNCTION EXECUTION
   ============================================================ */

REVOKE EXECUTE
ON FUNCTION private.is_admin()
FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE
ON FUNCTION private.is_super_admin()
FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE
ON FUNCTION private.is_author(BIGINT)
FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE
ON FUNCTION private.can_read_episode(BIGINT)
FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE
ON FUNCTION private.get_episode_content(BIGINT)
FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE
ON FUNCTION private.grant_rewarded_ad_unlock(UUID, BIGINT, UUID)
FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE
ON FUNCTION private.request_author_settlement(BIGINT, NUMERIC)
FROM PUBLIC, anon, authenticated;


/* ============================================================
   52. GRANTS FOR SERVICE LAYER
   ============================================================ */

/*
  실제 운영에서는 Supabase Edge Function / 서버 환경에서
  service_role 또는 별도 server-side database access를 사용한다.

  따라서 민감한 Function은 Browser Client에 직접 노출하지 않는다.
*/


/* ============================================================
   53. SECURITY NOTE
   ============================================================ */

/*
  반드시 환경변수/Secret 관리:

  SUPABASE_SERVICE_ROLE_KEY
  TOSS_SECRET_KEY
  KCP_SITE_KEY
  AD_NETWORK_SECRET
  WEBHOOK_SECRET

  DB의 system_config에는 Secret을 저장하지 않는다.
*/


/* ============================================================
   END
   ============================================================ */