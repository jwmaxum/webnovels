-- WebNovels Production DB: 10_commerce.sql
-- 팬미팅, 티켓 예매, 굿즈(Goods) 판매 및 주문 원장

-- 1. 작가 팬미팅 행사
CREATE TABLE IF NOT EXISTS public.fan_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id BIGINT REFERENCES public.authors(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  event_at TIMESTAMPTZ NOT NULL,
  location TEXT,
  ticket_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  capacity INT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (
    status IN ('DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 팬미팅 티켓 예매
CREATE TABLE IF NOT EXISTS public.fan_meeting_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.fan_meetings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'PAID', 'CANCELLED', 'REFUNDED')
  ),
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 굿즈 상품 (Goods)
CREATE TABLE IF NOT EXISTS public.goods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id BIGINT REFERENCES public.authors(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(12,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (
    status IN ('DRAFT', 'ON_SALE', 'SOLD_OUT', 'HIDDEN')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. 굿즈 주문
CREATE TABLE IF NOT EXISTS public.goods_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  total_amount NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
