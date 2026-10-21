-- Apply LAST, after genuine free-publication prerequisites; activation remains closed.
begin;
set local lock_timeout='5s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
 or exists(select 1 from unnest(array['authoring-002','authoring-007','authoring-008','authoring-009',
 'authoring-010','authoring-011','authoring-012','authoring-013','authoring-014','authoring-015',
 'authoring-021','authoring-022','launch-new-serial-foundation-20261021']) v
 where not exists(select 1 from authoring.migrations m where m.version=v)) then
  raise exception 'Reviewed free-publication migrations required'; end if;
end $$;

create or replace function authoring.new_serial_eligible(p_work bigint) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from authoring.new_serial_works n
 join public.works w on w.id=n.work_id and w.author_id=n.author_id
 join public.authors a on a.id=n.author_id and a.auth_user_id=n.user_id
 join authoring.work_create_requests r on r.user_id=n.user_id and r.request_key=n.request_key and r.work_id=n.work_id
 where n.work_id=p_work and not exists(select 1 from authoring.legacy_work_scope l where l.work_id=p_work))
$$;
revoke all on function authoring.new_serial_eligible(bigint) from public,anon,authenticated,service_role;

create or replace function authoring.stage8_visible(p_work bigint,p_episode bigint default null)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.works w join authoring.work_state s on s.work_id=w.id and s.author_id=w.author_id
 join public.authors a on a.id=w.author_id join auth.users u on u.id=a.auth_user_id
 where w.id=p_work and authoring.new_serial_eligible(w.id)
 and exists(select 1 from authoring.new_serial_service where enabled)
 and s.visibility='PUBLIC' and s.trashed_at is null and s.moderation_state='CLEAR'
 and w.status::text in ('PUBLISHED','ONGOING','PAUSED','COMPLETED')
 and w.content_type in ('NOVEL','WEBTOON') and w.rating::text in ('ALL','AGE_15')
 and not (coalesce(w.genre,'{}') && array['성인','19세 이상'])
 and a.status::text='APPROVED' and u.email_confirmed_at is not null and u.is_anonymous is not true
 and (u.banned_until is null or u.banned_until<=now())
 and not exists(select 1 from public.readers rd where rd.auth_user_id=u.id and rd.status::text<>'ACTIVE')
 and not exists(select 1 from public.admin_users ad where ad.auth_user_id=u.id and ad.is_active is distinct from true)
 and exists(select 1 from public.episodes e join authoring.publication_heads h on h.episode_id=e.id
 join authoring.publication_versions v on v.id=h.version_id and v.episode_id=e.id and v.work_id=w.id
 where e.work_id=w.id and (p_episode is null or e.id=p_episode) and e.status::text='PUBLISHED'
 and e.is_free is true and e.access_policy::text='FREE' and h.published_at<=now()
 and (e.scheduled_at is null or e.scheduled_at<=now())
 and not exists(select 1 from authoring.legacy_episode_scope l where l.episode_id=e.id)
 and (w.content_type='NOVEL' or authoring.webtoon_manifest_valid(w.id,v.webtoon,true))))
$$;
revoke all on function authoring.stage8_visible(bigint,bigint) from public,anon,authenticated,service_role;

-- Guard both creation and replacement, including scheduler and administrator paths.
create or replace function authoring.guard_new_serial_publication() returns trigger
language plpgsql security definer set search_path='' as $$
declare work bigint;
begin
 select e.work_id into work from public.episodes e where e.id=new.episode_id;
 if not coalesce(authoring.new_serial_eligible(work),false)
 or not exists(select 1 from authoring.new_serial_service where enabled)
 or exists(select 1 from authoring.legacy_episode_scope where episode_id=new.episode_id) then
  raise exception 'NEW_SERIAL_PUBLICATION_REQUIRED'; end if;
 return new;
end $$;
revoke all on function authoring.guard_new_serial_publication() from public,anon,authenticated,service_role;
drop trigger if exists new_serial_publication on authoring.publication_versions;
create trigger new_serial_publication before insert on authoring.publication_versions for each row execute function authoring.guard_new_serial_publication();
drop trigger if exists new_serial_publication on authoring.publication_heads;
create trigger new_serial_publication before insert or update on authoring.publication_heads for each row execute function authoring.guard_new_serial_publication();

-- Keep reviewed implementations intact, changing only their missing scope predicates.
do $$ declare signature text; definition text; needle text; replacement text; begin
 foreach signature in array array['public.run_creator_schedules(integer)','public.run_creator_schedules_v18(integer)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  needle:='where q.status=''PENDING'' and q.due_at<=now()';
  replacement:=needle||' and authoring.new_serial_eligible(e.work_id) and exists(select 1 from authoring.new_serial_service where enabled)';
  if position(replacement in definition)=0 then
   if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Scheduler scope patch requires review';end if;
   execute replace(definition,needle,replacement);
  end if;
 end loop;
 definition:=pg_get_functiondef('authoring.review_original_files(uuid,text,bigint,uuid,jsonb)'::regprocedure);
 needle:='and ws.visibility=''PUBLIC''';replacement:='and authoring.stage8_visible(w.id) '||needle;
 if position(replacement in definition)=0 then
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Cover scope patch requires review';end if;
  execute replace(definition,needle,replacement);
 end if;
end $$;

-- Close direct legacy REST/GraphQL access, including column grants and old body fallback.
revoke all on all tables in schema public from public,anon,authenticated;
revoke all on all sequences in schema public from public,anon,authenticated;
revoke execute on all functions in schema public from public,anon,authenticated;
do $$ declare t record; cols text; begin
 for t in select c.oid,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p','v') loop
  select string_agg(quote_ident(attname),',') into cols from pg_attribute where attrelid=t.oid and attnum>0 and not attisdropped;
  if cols is not null then execute format('revoke all privileges (%s) on public.%I from public,anon,authenticated',cols,t.relname);end if;
 end loop;
end $$;
revoke all on public.secure_episode_contents from public,anon,authenticated,service_role;
revoke all(content,image_urls,episode_id,updated_at) on public.secure_episode_contents from public,anon,authenticated,service_role;
grant select on public.works,public.episodes,public.authors,public.readers,public.admin_users to service_role;

-- Boolean-only policy helpers execute as the owner to avoid recursive RLS.
create or replace function public.new_serial_metadata_visible(p_work bigint,p_episode bigint default null) returns boolean
language sql stable security definer set search_path='' as $$ select authoring.stage8_visible(p_work,p_episode) $$;
create or replace function public.new_serial_author_visible(p_author bigint) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.works w where w.author_id=p_author and authoring.stage8_visible(w.id))
$$;
revoke all on function public.new_serial_metadata_visible(bigint,bigint),public.new_serial_author_visible(bigint) from public;
grant execute on function public.new_serial_metadata_visible(bigint,bigint),public.new_serial_author_visible(bigint) to anon,authenticated,service_role;
alter table public.works enable row level security;
alter table public.episodes enable row level security;
alter table public.authors enable row level security;
drop policy if exists webnovels_maintenance_works on public.works;
drop policy if exists webnovels_maintenance_episodes on public.episodes;
drop policy if exists webnovels_maintenance_authors on public.authors;
drop policy if exists new_serial_scope on public.works;
drop policy if exists new_serial_scope on public.episodes;
drop policy if exists new_serial_scope on public.authors;
create policy new_serial_scope on public.works as restrictive for select to anon,authenticated using(public.new_serial_metadata_visible(id));
create policy new_serial_scope on public.episodes as restrictive for select to anon,authenticated using(public.new_serial_metadata_visible(work_id,id));
create policy new_serial_scope on public.authors as restrictive for select to anon,authenticated using(public.new_serial_author_visible(id));
drop policy if exists new_serial_select on public.works;
drop policy if exists new_serial_select on public.episodes;
drop policy if exists new_serial_select on public.authors;
create policy new_serial_select on public.works for select to anon,authenticated using(true);
create policy new_serial_select on public.episodes for select to anon,authenticated using(true);
create policy new_serial_select on public.authors for select to anon,authenticated using(true);
grant select(id,title,author,author_id,genre,tags,description,cover_image,view_count,like_count,created_at,status,is_top_recommended,is_popular_work,is_new_work,content_type,is_completed,rating,ai_usage_type,published_at) on public.works to anon,authenticated;
grant select(id,work_id,episode_number,title,is_free,is_ad_free,author_comment,status,scheduled_at,access_policy,view_count,created_at) on public.episodes to anon,authenticated;
grant select(id,username,pen_name,profile_image,bio,status) on public.authors to anon,authenticated;

insert into authoring.migrations(version) values('launch-new-serial-publication-20261021') on conflict do nothing;
create or replace function public.new_serials_ready() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from authoring.new_serial_service where enabled)
 and exists(select 1 from authoring.migrations where version='launch-new-serial-publication-20261021')
 and not has_any_column_privilege('service_role','public.secure_episode_contents','SELECT')
 and not has_column_privilege('anon','public.episodes','content','SELECT')
 and not has_column_privilege('authenticated','public.episodes','content','SELECT')
 and (select count(*)=3 from pg_policy where polname='new_serial_scope' and not polpermissive
 and polrelid in ('public.works'::regclass,'public.episodes'::regclass,'public.authors'::regclass))
$$;
revoke all on function public.new_serials_ready() from public,anon,authenticated;
grant execute on function public.new_serials_ready() to service_role;
notify pgrst,'reload schema';
commit;
