-- ============================================================
-- 06_revenue_earnings.sql: 플랫폼 수익 이벤트, 작가별 일별 수익, 정산 스냅샷
-- ============================================================

-- 1. 월별 플랫폼 수익 이벤트 테이블 (revenue_events)
CREATE TABLE IF NOT EXISTS revenue_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month TEXT NOT NULL,
  gross_revenue NUMERIC NOT NULL DEFAULT 0,
  ad_network_fee NUMERIC NOT NULL DEFAULT 0,
  net_revenue NUMERIC NOT NULL DEFAULT 0,
  writer_pool_ratio NUMERIC NOT NULL DEFAULT 0.625,
  writer_pool NUMERIC NOT NULL DEFAULT 0,
  platform_revenue NUMERIC NOT NULL DEFAULT 0,
  is_closed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. 작가별 일별/실시간 수익 테이블 (author_earnings)
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
  CONSTRAINT unique_author_work_date UNIQUE(author_id, work_id, period_date)
);

-- 작가별 월별 수익 분배 테이블 (author_revenues - 하위 호환)
CREATE TABLE IF NOT EXISTS author_revenues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id INT REFERENCES authors(id) ON DELETE CASCADE,
  revenue_event_id UUID REFERENCES revenue_events(id) ON DELETE SET NULL,
  period_month TEXT NOT NULL,
  contribution_score NUMERIC DEFAULT 0,
  estimated_amount NUMERIC DEFAULT 0,
  confirmed_amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'PAID', 'REJECTED')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 작가 정산 출금 신청 테이블 (author_settlements - 스냅샷 보강)
CREATE TABLE IF NOT EXISTS author_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id INT REFERENCES authors(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  author_name_snapshot TEXT,
  bank_name_snapshot TEXT,
  account_number_snapshot TEXT,
  amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'PAID', 'REJECTED')),
  bank_info TEXT,
  requested_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

ALTER TABLE author_settlements ADD COLUMN IF NOT EXISTS author_id INT;
ALTER TABLE author_settlements ADD COLUMN IF NOT EXISTS author_name_snapshot TEXT;
ALTER TABLE author_settlements ADD COLUMN IF NOT EXISTS bank_name_snapshot TEXT;
ALTER TABLE author_settlements ADD COLUMN IF NOT EXISTS account_number_snapshot TEXT;
