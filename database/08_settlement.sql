-- WebNovels Production DB: 08_settlement.sql
-- 작가 정산 신청 및 지급 처리 (계좌 스냅샷 보존)

CREATE TABLE IF NOT EXISTS public.author_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id BIGINT NOT NULL REFERENCES public.authors(id) ON DELETE RESTRICT,
  author_name_snapshot TEXT NOT NULL,
  bank_name_snapshot TEXT,
  account_number_snapshot TEXT,
  account_holder_snapshot TEXT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  status public.settlement_status NOT NULL DEFAULT 'PENDING',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reject_reason TEXT
);
