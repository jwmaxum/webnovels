-- Maintenance preparation only: no Auth user, profile mapping or role is created.
-- Review the trigger's backed-up definition and supply its MD5 in the same batch.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ declare definition text; begin
  if current_user in ('anon','authenticated','service_role') then raise exception 'Database operator required'; end if;
  select pg_get_functiondef(t.tgfoid) into definition from pg_trigger t
    where t.tgrelid='auth.users'::regclass and t.tgname='on_auth_user_created' and not t.tgisinternal;
  if found then
    if md5(definition) is distinct from current_setting('webnovels.legacy_auth_trigger_md5',true) then
      raise exception 'Legacy Auth trigger changed or was not reviewed'; end if;
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='readers'
      and column_name='id' and data_type='integer') or definition not ilike '%INSERT INTO public.readers%'
      or definition not ilike '%NEW.id%' then raise exception 'Unexpected legacy Auth trigger contract'; end if;
    drop trigger on_auth_user_created on auth.users;
  end if;
end $$;
-- Keep all legacy profile IDs/password fields unchanged. UUIDs use separate columns.
alter table public.readers add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
alter table public.authors add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
alter table public.admin_users add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
create unique index if not exists p0_readers_auth_uid on public.readers(auth_user_id) where auth_user_id is not null;
create unique index if not exists p0_authors_auth_uid on public.authors(auth_user_id) where auth_user_id is not null;
create unique index if not exists p0_admins_auth_uid on public.admin_users(auth_user_id) where auth_user_id is not null;
-- ADD COLUMN can inherit historical table grants. Explicitly keep linkage private.
revoke all(auth_user_id) on public.readers,public.authors,public.admin_users from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
