-- PREPARED, NOT APPLIED. This intentionally closes ALL legacy public RPCs/views/writes.
-- Do not run until audit, backup, Auth mapping, new frontend/API and crossing-role tests pass.
-- Execute in a maintenance window. A missing gate aborts the whole transaction.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$ begin
  if current_setting('webnovels.p0_cutover_verified', true) is distinct from 'true' then
    raise exception 'Set webnovels.p0_cutover_verified only after completing the cutover checklist';
  end if;
  if not exists(select 1 from public.p0_migration_status where version='p0-20260921') then raise exception 'Expansion missing'; end if;
  if not exists(select 1 from public.admin_users where auth_user_id is not null and is_active and role='SUPER_ADMIN') then raise exception 'Verified admin mapping missing'; end if;
  if not exists(select 1 from public.readers where auth_user_id is not null and status='ACTIVE') then raise exception 'Reader mapping missing'; end if;
  if not exists(select 1 from public.authors where auth_user_id is not null and status='APPROVED') then raise exception 'Author mapping missing'; end if;
end $$;

-- Remove grants inherited through PUBLIC as well as direct anon/authenticated grants.
revoke all on all tables in schema public from public,anon,authenticated;
revoke all on all sequences in schema public from public,anon,authenticated;
revoke execute on all functions in schema public from public,anon,authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
-- Table REVOKE does not remove separate column-level privileges.
do $$ declare t record; p record; cols text; begin
  for t in select c.oid,c.relname,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','v','m') loop
    select string_agg(quote_ident(attname),',') into cols from pg_attribute where attrelid=t.oid and attnum>0 and not attisdropped;
    if cols is not null and t.relkind <> 'm' then
      execute format('revoke all privileges (%s) on table public.%I from public,anon,authenticated',cols,t.relname);
    end if;
    if t.relkind in ('r','p') then
      execute format('alter table public.%I enable row level security',t.relname);
      for p in select polname from pg_policy where polrelid=t.oid loop
        execute format('drop policy %I on public.%I',p.polname,t.relname);
      end loop;
    end if;
  end loop;
end $$;

-- Only the explicit public metadata columns are available outside the server.
grant select(id,title,author,author_id,genre,tags,description,cover_image,view_count,like_count,created_at,status,is_top_recommended,is_popular_work,is_new_work,content_type,is_completed,rating,ai_usage_type,published_at) on public.works to anon,authenticated;
grant select(id,work_id,episode_number,title,is_free,is_ad_free,author_comment,status,scheduled_at,access_policy,view_count,created_at) on public.episodes to anon,authenticated;
grant select(id,username,pen_name,profile_image,bio,status) on public.authors to anon,authenticated;
create policy p0_public_works on public.works for select to anon,authenticated using(status in ('PUBLISHED','ONGOING','PAUSED','COMPLETED'));
create policy p0_public_authors on public.authors for select to anon,authenticated using(status='APPROVED');
create policy p0_public_episodes on public.episodes for select to anon,authenticated using(
  status='PUBLISHED' and (scheduled_at is null or scheduled_at <= now()) and exists(
    select 1 from public.works w where w.id=work_id and w.status in ('PUBLISHED','ONGOING','PAUSED','COMPLETED')
  )
);
alter default privileges in schema public revoke all on tables from public,anon,authenticated;
alter default privileges in schema public revoke all on sequences from public,anon,authenticated;
alter default privileges in schema public revoke execute on functions from public,anon,authenticated;
update public.p0_migration_status set phase='locked',applied_at=now() where version='p0-20260921';
notify pgrst, 'reload schema';
commit;
