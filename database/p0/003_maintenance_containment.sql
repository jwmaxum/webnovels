-- Maintenance protection only; does NOT mark P0 locked or activate application features.
-- Save effective ACLs/policies and verify data fingerprints before running this transaction.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$ begin
  if current_setting('webnovels.containment_reviewed', true) is distinct from 'true' then
    raise exception 'Reviewed permission backup and maintenance impact required';
  end if;
end $$;

-- Close legacy direct writes, sensitive tables/views and SECURITY DEFINER RPCs.
-- Do not change any application row, profile mapping, password or manuscript.
revoke all on all tables in schema public from public,anon,authenticated;
revoke all on all sequences in schema public from public,anon,authenticated;
revoke execute on all functions in schema public from public,anon,authenticated;
do $$ declare t record; cols text; begin
  for t in select c.oid,c.relname,c.relkind from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','v') loop
    select string_agg(quote_ident(attname),',') into cols from pg_catalog.pg_attribute
      where attrelid=t.oid and attnum>0 and not attisdropped;
    if cols is not null then
      execute format('revoke all privileges (%s) on table public.%I from public,anon,authenticated',cols,t.relname);
    end if;
  end loop;
end $$;

-- Existing permissive policies cannot widen these restrictive metadata filters.
alter table public.works enable row level security;
alter table public.episodes enable row level security;
alter table public.authors enable row level security;
drop policy if exists webnovels_maintenance_works on public.works;
drop policy if exists webnovels_maintenance_episodes on public.episodes;
drop policy if exists webnovels_maintenance_authors on public.authors;
create policy webnovels_maintenance_works on public.works as restrictive for select to anon,authenticated
  using(status in ('PUBLISHED','ONGOING','PAUSED','COMPLETED') and rating in ('ALL','AGE_15')
    and content_type='NOVEL' and not (coalesce(genre,'{}') && array['성인','19세 이상']));
create policy webnovels_maintenance_episodes on public.episodes as restrictive for select to anon,authenticated
  using(status='PUBLISHED' and is_free is true and access_policy::text='FREE'
    and (scheduled_at is null or scheduled_at<=now())
    and exists(select 1 from public.works w where w.id=work_id));
create policy webnovels_maintenance_authors on public.authors as restrictive for select to anon,authenticated
  using(status='APPROVED');
grant select(id,title,author,author_id,genre,tags,description,cover_image,view_count,like_count,created_at,status,is_top_recommended,is_popular_work,is_new_work,content_type,is_completed,rating,ai_usage_type,published_at) on public.works to anon,authenticated;
grant select(id,work_id,episode_number,title,is_free,is_ad_free,author_comment,status,scheduled_at,access_policy,view_count,created_at) on public.episodes to anon,authenticated;
grant select(id,username,pen_name,profile_image,bio,status) on public.authors to anon,authenticated;
notify pgrst, 'reload schema';
commit;
