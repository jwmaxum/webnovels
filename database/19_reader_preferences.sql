-- WebNovels Production DB: 19_reader_preferences.sql
-- 독자 뷰어 개인화 환경설정 (테마, 글꼴, 줄간격, 여백, 문단간격 등) JSONB 필드 추가

ALTER TABLE public.readers ADD COLUMN IF NOT EXISTS reader_preferences JSONB DEFAULT '{
  "theme": "theme-dark",
  "fontFamily": "serif",
  "fontSize": 18,
  "lineHeight": 1.8,
  "paddingX": 20,
  "paragraphGap": 1.2
}'::jsonb;
