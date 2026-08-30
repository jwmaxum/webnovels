-- WebNovels Production DB: 01_extensions.sql
-- Extension 및 Private Schema 생성

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- SECURITY DEFINER 함수는 가능한 private schema에서 관리
CREATE SCHEMA IF NOT EXISTS private;
