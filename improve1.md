# 🚀 [Improvement Step 1] DB 구조 고도화 & 모듈형 SQL 및 실데이터 일관성 구축

본 문서는 `needtochange1.md`의 핵심 개선 사항 중 **1단계: 데이터베이스 스키마 고도화, 모듈형 SQL 구축 및 시드/통계 데이터 정합성 일치** 작업을 위한 명세서입니다.

---

## 1. 개요 및 목적
- **광고 기반 비즈니스 모델 핵심 테이블 신설**:
  - `episode_unlocks` (독자별 회차 해금 이력: 무료, 보상형광고, 포인트, 결제)
  - `ad_events` (광고 노출, 시작, 완료, 리워드 지급 로그)
  - `author_earnings` (작가별/작품별 일별·월별 실시간 추정 및 확정 수익)
- **정산 데이터 계좌 스냅샷 체계 구축**:
  - `author_settlements` 테이블에 `author_id` 및 정산 당시 계좌/필명 스냅샷 컬럼 추가
- **댓글 시스템 고도화 (대댓글 계층 구조 지원)**:
  - `comments` 테이블에 `parent_id UUID`, `is_deleted BOOLEAN`, `updated_at TIMESTAMPTZ` 추가
- **실데이터 기준 통계/시드 일치화**:
  - `readers`(10명), `authors`(30명), `works`(30개), `episodes`(180회차) 실데이터 기준과 `platform_stats` 대시보드 통계 수치를 1:1 완벽 일치화
- **모듈형 SQL 파일 구조 (`/database`) 구축**:
  - 단일 대형 파일에서 유지보수가 용이한 도메인별 SQL 파일 분할 체계 구축

---

## 2. 세부 구현 대상 (Tasks)

### 2.1. 신규/개선 테이블 DDL 명세

#### 1) `episode_unlocks` (회차 해금 마스터 테이블)
```sql
CREATE TABLE IF NOT EXISTS episode_unlocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  episode_id INT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  unlock_type TEXT NOT NULL CHECK (unlock_type IN ('FREE', 'REWARDED_AD', 'POINT', 'PURCHASE')),
  ad_network TEXT,
  ad_event_id TEXT,
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ, -- 보상형 광고의 경우 기본 72시간 후 만료
  UNIQUE(user_id, episode_id)
);
```

#### 2) `ad_events` (광고 라이프사이클 이벤트 로그)
```sql
CREATE TABLE IF NOT EXISTS ad_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  work_id INT REFERENCES works(id) ON DELETE SET NULL,
  episode_id INT REFERENCES episodes(id) ON DELETE SET NULL,
  ad_network TEXT NOT NULL,
  ad_unit TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('IMPRESSION', 'START', 'COMPLETE', 'REWARD', 'SKIP')),
  reward_granted BOOLEAN DEFAULT false,
  revenue NUMERIC DEFAULT 0,
  external_event_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 3) `author_earnings` (작가별 일별/실시간 수익)
```sql
CREATE TABLE IF NOT EXISTS author_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id INT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  work_id INT REFERENCES works(id) ON DELETE SET NULL,
  period_date DATE NOT NULL,
  ad_impressions INT DEFAULT 0,
  rewarded_views INT DEFAULT 0,
  gross_revenue NUMERIC DEFAULT 0,
  platform_fee NUMERIC DEFAULT 0,
  author_revenue NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'ESTIMATED' CHECK (status IN ('ESTIMATED', 'CONFIRMED', 'SETTLED')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(author_id, work_id, period_date)
);
```

#### 4) `author_settlements` (스냅샷 보강)
```sql
ALTER TABLE author_settlements ADD COLUMN IF NOT EXISTS author_id INT REFERENCES authors(id);
ALTER TABLE author_settlements ADD COLUMN IF NOT EXISTS author_name_snapshot TEXT;
ALTER TABLE author_settlements ADD COLUMN IF NOT EXISTS bank_name_snapshot TEXT;
ALTER TABLE author_settlements ADD COLUMN IF NOT EXISTS account_number_snapshot TEXT;
```

#### 5) `comments` (대댓글 계층 지원)
```sql
ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES comments(id) ON DELETE CASCADE;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
```

---

### 2.2. 모듈형 SQL 디렉토리 구조 (`/database`)
```text
database/
  ├── 01_extensions.sql       -- pgcrypto 등 확장 모듈
  ├── 02_users.sql            -- admin_users, authors, readers
  ├── 03_content.sql          -- works, episodes, works.author_id FK
  ├── 04_reader_activity.sql  -- reading_history, favorites, author_subscriptions
  ├── 05_ads_and_unlocks.sql  -- episode_unlocks, ad_events
  ├── 06_revenue_earnings.sql -- revenue_events, author_earnings, author_settlements
  ├── 07_community.sql        -- comments (parent_id), comment_likes, reports, content_reviews
  ├── 08_system.sql           -- system_config, platform_stats
  ├── 09_rls_and_security.sql -- RLS 활성화 및 권한 정책
  ├── 10_indexes.sql          -- 성능 최적화 인덱스
  └── 99_seed_30_works.sql    -- 30개 작품/180회차/30명 작가/10명 독자 실데이터 및 통계 시드
```

---

## 3. 코드 연동 반영 (`public/supabase-admin.js`, `public/app.js`)
- `recordEpisodeUnlock`: `episode_unlocks` 테이블에 해금 사유(`unlock_type: REWARDED_AD / POINT`) 및 만료일자(`expires_at`) 저장
- `logAdEvent`: `ad_events` 테이블에 광고 시작/완료/리워드 이벤트 기록
- `fetchAuthorEarnings`: `author_earnings` 테이블에서 일별/월별 작가 수익 조회
- `public/supabase-setup.sql` & `scripts/supabase_patch_latest.sql` 동기화

---

## 4. 검증 계획
1. `node scripts/verify_normalized_db.js`로 모든 신규 테이블 및 컬럼 접근성 테스트 통과
2. `public/dataset_30_works.json`과 `platform_stats`의 수치 정합성(독자 10명, 작가 30명, 작품 30개, 회차 180개) 확인
3. TypeScript 컴파일 무오류 검증 (`npx tsc --noEmit`)
