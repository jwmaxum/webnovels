-- WebNovels Production DB: 07_revenue.sql
-- 월별 마감 기간, 복식부기 수익 원장 및 작가 일별 수익

-- 1. 월별 수익 마감 기간
CREATE TABLE IF NOT EXISTS public.revenue_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month DATE NOT NULL,
  gross_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  network_fee NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  writer_pool_ratio NUMERIC(6,4) NOT NULL DEFAULT 0.625,
  writer_pool NUMERIC(14,2) NOT NULL DEFAULT 0,
  platform_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_closed BOOLEAN NOT NULL DEFAULT false,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(period_month)
);

-- 2. 수익 원장 (Ledger - 금액 이동의 완전한 역추적)
CREATE TABLE IF NOT EXISTS public.revenue_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revenue_period_id UUID REFERENCES public.revenue_periods(id) ON DELETE SET NULL,
  author_id BIGINT REFERENCES public.authors(id) ON DELETE SET NULL,
  work_id BIGINT REFERENCES public.works(id) ON DELETE SET NULL,
  transaction_type TEXT NOT NULL CHECK (
    transaction_type IN (
      'AD_REVENUE', 'NETWORK_FEE', 'WRITER_POOL', 'AUTHOR_ALLOCATION',
      'PLATFORM_REVENUE', 'ADJUSTMENT', 'SETTLEMENT_RESERVED', 'SETTLEMENT_PAID'
    )
  ),
  direction TEXT NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  reference_id TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 작가 일별/월별 수익 집계
CREATE TABLE IF NOT EXISTS public.author_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id BIGINT NOT NULL REFERENCES public.authors(id) ON DELETE CASCADE,
  work_id BIGINT REFERENCES public.works(id) ON DELETE SET NULL,
  period_date DATE NOT NULL,
  ad_impressions BIGINT NOT NULL DEFAULT 0,
  rewarded_views BIGINT NOT NULL DEFAULT 0,
  gross_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  platform_fee NUMERIC(14,2) NOT NULL DEFAULT 0,
  author_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ESTIMATED' CHECK (status IN ('ESTIMATED', 'CONFIRMED', 'SETTLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(author_id, work_id, period_date)
);
