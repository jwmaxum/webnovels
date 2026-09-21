-- Read only. Save output outside Git; run before any P0 migration.
select jsonb_build_object(
  'tables', (select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage') and c.relkind in ('r','p','v','m')),
  'columns', (select jsonb_agg(to_jsonb(c)) from information_schema.columns c where table_schema='public'),
  'policies', (select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname in ('public','storage')),
  'table_grants', (select jsonb_agg(to_jsonb(g)) from information_schema.role_table_grants g where table_schema='public'),
  'column_grants', (select jsonb_agg(to_jsonb(g)) from information_schema.role_column_grants g where table_schema='public'),
  'functions', (select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl,'definition',pg_get_functiondef(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
  'views', (select jsonb_agg(to_jsonb(v)) from pg_views v where schemaname='public'),
  'constraints', (select jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid))) from pg_constraint where connamespace='public'::regnamespace),
  'publication', (select jsonb_agg(to_jsonb(t)) from pg_publication_tables t),
  'counts', jsonb_build_object('works',(select count(*) from public.works),'episodes',(select count(*) from public.episodes),'authors',(select count(*) from public.authors),'readers',(select count(*) from public.readers))
) as audit;
