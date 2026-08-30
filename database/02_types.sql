-- WebNovels Production DB: 02_types.sql
-- 8대 Custom Enum 타입 정의

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'content_type') THEN
    CREATE TYPE public.content_type AS ENUM ('NOVEL', 'WEBTOON');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_status') THEN
    CREATE TYPE public.work_status AS ENUM (
      'DRAFT', 'REVIEW', 'PUBLISHED', 'ONGOING', 'PAUSED', 'COMPLETED', 'REJECTED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'episode_status') THEN
    CREATE TYPE public.episode_status AS ENUM (
      'DRAFT', 'REVIEW', 'SCHEDULED', 'PUBLISHED', 'HIDDEN', 'DELETED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'access_policy') THEN
    CREATE TYPE public.access_policy AS ENUM (
      'FREE', 'REWARDED_AD', 'POINT', 'PURCHASE', 'MEMBERSHIP'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'unlock_type') THEN
    CREATE TYPE public.unlock_type AS ENUM (
      'FREE', 'REWARDED_AD', 'POINT', 'PURCHASE', 'MEMBERSHIP'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'settlement_status') THEN
    CREATE TYPE public.settlement_status AS ENUM (
      'PENDING', 'CONFIRMED', 'PROCESSING', 'PAID', 'REJECTED', 'ON_HOLD', 'CANCELLED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'review_status') THEN
    CREATE TYPE public.review_status AS ENUM (
      'PENDING', 'APPROVED', 'REJECTED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_status') THEN
    CREATE TYPE public.report_status AS ENUM (
      'PENDING', 'RESOLVED', 'REJECTED'
    );
  END IF;
END $$;
