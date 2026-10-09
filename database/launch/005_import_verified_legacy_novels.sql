-- PREPARED, NOT APPLIED. Operator-reviewed, backup-bound free NOVEL imports only.
-- The generator does not set this verification flag or connect to a remote database.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local timezone='UTC';
do $$ begin
  if current_user in ('anon','authenticated','service_role') or
    current_setting('webnovels.legacy_publication_import_verified',true) is distinct from 'true' then
    raise exception 'Verified database operator required'; end if;
  if (select count(*) from pg_temp.legacy_import_context)<>1 or not exists(select 1 from pg_temp.legacy_import_plan) then
    raise exception 'Reviewed import context required'; end if;
  if not exists(select 1 from public.p0_migration_status where version='p0-20260921' and phase in ('expanded','locked')) or
    not exists(select 1 from authoring.migrations where version='authoring-008') then
    raise exception 'P0 and publication migration required'; end if;
  if exists(select 1 from pg_temp.legacy_import_context where backup_sha256 !~ '^[a-f0-9]{64}$' or
    batch_id !~ '^legacy-novel-[a-f0-9]{64}$' or length(cutover_evidence)<10) then
    raise exception 'Backup and cutover evidence required'; end if;
end $$;
lock table public.works,public.authors,public.episodes,public.episode_contents,public.secure_episode_contents,
  auth.users,authoring.identity_evidence,authoring.work_state,authoring.publication_versions,
  authoring.publication_heads,authoring.schedules in share row exclusive mode;
do $$ begin
  if exists(select 1 from public.episodes e join public.episode_contents c on c.episode_id=e.id
    where e.content is distinct from c.text_content) then raise exception 'Unresolved body conflicts'; end if;
  if exists(select 1 from pg_temp.legacy_import_plan p
    left join public.episodes e on e.id=p.episode_id left join public.works w on w.id=e.work_id
    left join authoring.work_state s on s.work_id=w.id and s.author_id=w.author_id
    left join public.authors a on a.id=w.author_id left join auth.users u on u.id=a.auth_user_id
    left join authoring.identity_evidence i on i.profile_kind='author' and i.profile_id=a.id::text and i.auth_user_id=u.id
    left join public.secure_episode_contents c on c.episode_id=e.id
    left join public.episode_contents b on b.episode_id=e.id
    where e.id is null or w.id is null or s.work_id is null or a.id is null or u.id is null or i.profile_id is null
      or c.episode_id is null or b.episode_id is null
      or a.status::text<>'APPROVED' or u.email_confirmed_at is null or u.deleted_at is not null
      or coalesce(u.is_anonymous,false) or u.banned_until>now()
      or w.content_type::text<>'NOVEL' or w.rating::text not in ('ALL','AGE_15')
      or to_jsonb(w.genre) ?| array['성인','19세 이상'] or nullif(btrim(w.description),'') is null
      or (select count(*) from jsonb_array_elements_text(to_jsonb(w.genre)) g where nullif(btrim(g),'') is not null)=0
      or s.visibility<>'PUBLIC' or s.trashed_at is not null or s.moderation_state<>'CLEAR'
      or not s.rating_confirmed or not s.ai_confirmed or w.status::text not in ('PUBLISHED','ONGOING','PAUSED','COMPLETED') or w.published_at>now()
      or e.status::text<>'PUBLISHED' or e.is_free is distinct from true or e.access_policy<>'FREE'
      or e.scheduled_at>now() or nullif(btrim(e.title),'') is null or nullif(btrim(e.content),'') is null
      or coalesce(to_jsonb(e.image_urls),'[]'::jsonb)<>'[]'::jsonb
      or c.content is distinct from e.content or b.text_content is distinct from e.content
      or coalesce(to_jsonb(c.image_urls),'[]'::jsonb)<>coalesce(to_jsonb(e.image_urls),'[]'::jsonb)
      or md5(to_jsonb(e)::text) is distinct from p.episode_hash or md5(to_jsonb(w)::text) is distinct from p.work_hash
      or md5(to_jsonb(s)::text) is distinct from p.state_hash or md5(to_jsonb(a)::text) is distinct from p.author_hash
      or md5(to_jsonb(u)::text) is distinct from p.auth_hash or md5(to_jsonb(i)::text) is distinct from p.identity_hash
      or md5(to_jsonb(c)::text) is distinct from p.secure_hash or md5(to_jsonb(b)::text) is distinct from p.alternate_hash
      or p.published_at is null or e.created_at is null or p.published_at<e.created_at or p.published_at>now()
      or length(p.evidence_ref)<10 or exists(select 1 from authoring.publication_heads h where h.episode_id=e.id)
      or exists(select 1 from authoring.publication_versions v where v.id=p.version_id)
      or exists(select 1 from authoring.schedules q where q.episode_id=e.id and q.status in ('PENDING','RUNNING'))) then
    raise exception 'Import plan stale, unverified or invalid'; end if;
end $$;
create schema if not exists launch_recovery;
revoke all on schema launch_recovery from public,anon,authenticated,service_role;
create table if not exists launch_recovery.legacy_publication_imports(
  batch_id text not null,episode_id bigint not null,version_id uuid not null,
  before_data jsonb not null,after_data jsonb not null,evidence_ref text not null,
  backup_sha256 text not null,cutover_evidence text not null,recorded_at timestamptz not null default now(),
  primary key(batch_id,episode_id),unique(version_id)
);
alter table launch_recovery.legacy_publication_imports enable row level security;
revoke all on launch_recovery.legacy_publication_imports from public,anon,authenticated,service_role;
create or replace function launch_recovery.reject_legacy_import_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Legacy publication history is immutable'; end $$;
revoke all on function launch_recovery.reject_legacy_import_change() from public,anon,authenticated,service_role;
drop trigger if exists immutable_legacy_import on launch_recovery.legacy_publication_imports;
create trigger immutable_legacy_import before update or delete on launch_recovery.legacy_publication_imports
for each row execute function launch_recovery.reject_legacy_import_change();
insert into authoring.publication_versions(id,episode_id,work_id,source_draft_id,source_revision,title,content,author_comment,image_urls,created_at)
select p.version_id,e.id,e.work_id,null,null,e.title,e.content,coalesce(e.author_comment,''),'[]'::jsonb,now()
from pg_temp.legacy_import_plan p join public.episodes e on e.id=p.episode_id;
-- An imported historical episode is a baseline, never new growth activity.
-- Preinsert before the existing head trigger; its ON CONFLICT preserves this kind.
do $$ begin
  if to_regclass('growth.publication_activity') is not null then
    execute 'lock table growth.publication_activity in share row exclusive mode';
    execute 'insert into growth.publication_activity(version_id,work_id,episode_id,kind,created_at)
      select p.version_id,e.work_id,e.id,''BASELINE'',p.published_at
      from pg_temp.legacy_import_plan p join public.episodes e on e.id=p.episode_id';
  end if;
end $$;
insert into authoring.publication_heads(episode_id,version_id,published_at)
select episode_id,version_id,published_at from pg_temp.legacy_import_plan;
insert into launch_recovery.legacy_publication_imports(batch_id,episode_id,version_id,before_data,after_data,evidence_ref,backup_sha256,cutover_evidence)
select x.batch_id,e.id,p.version_id,
  jsonb_build_object('episode',to_jsonb(e),'work',to_jsonb(w),'state',to_jsonb(s),'author',to_jsonb(a),
    'auth',to_jsonb(u),'identity',to_jsonb(i),'secure',to_jsonb(c),'alternate',to_jsonb(b)),
  jsonb_build_object('version',to_jsonb(v),'head',to_jsonb(h)),p.evidence_ref,x.backup_sha256,x.cutover_evidence
from pg_temp.legacy_import_plan p join public.episodes e on e.id=p.episode_id join public.works w on w.id=e.work_id
join authoring.work_state s on s.work_id=w.id join public.authors a on a.id=w.author_id join auth.users u on u.id=a.auth_user_id
join authoring.identity_evidence i on i.profile_kind='author' and i.profile_id=a.id::text and i.auth_user_id=u.id
join public.secure_episode_contents c on c.episode_id=e.id join public.episode_contents b on b.episode_id=e.id
join authoring.publication_versions v on v.id=p.version_id join authoring.publication_heads h on h.episode_id=e.id
cross join pg_temp.legacy_import_context x;
do $$ begin
  if (select count(*) from pg_temp.legacy_import_plan)<>
    (select count(*) from launch_recovery.legacy_publication_imports h join pg_temp.legacy_import_context x using(batch_id)) then
    raise exception 'Incomplete imported publication history'; end if;
  if exists(select 1 from pg_temp.legacy_import_plan p join public.episodes e on e.id=p.episode_id
    join authoring.publication_versions v on v.id=p.version_id join authoring.publication_heads h on h.episode_id=e.id
    where h.version_id<>v.id or h.published_at<>p.published_at or v.source_draft_id is not null or v.source_revision is not null
      or v.title is distinct from e.title or v.content is distinct from e.content
      or v.author_comment is distinct from coalesce(e.author_comment,'') or v.image_urls<>'[]'::jsonb) then
    raise exception 'Unexpected imported publication mutation'; end if;
  if exists(select 1 from pg_temp.legacy_import_plan p
    join public.episodes e on e.id=p.episode_id join public.works w on w.id=e.work_id
    join authoring.work_state s on s.work_id=w.id join public.authors a on a.id=w.author_id
    join auth.users u on u.id=a.auth_user_id
    join authoring.identity_evidence i on i.profile_kind='author' and i.profile_id=a.id::text and i.auth_user_id=u.id
    join public.secure_episode_contents c on c.episode_id=e.id join public.episode_contents b on b.episode_id=e.id
    where md5(to_jsonb(e)::text) is distinct from p.episode_hash or md5(to_jsonb(w)::text) is distinct from p.work_hash
      or md5(to_jsonb(s)::text) is distinct from p.state_hash or md5(to_jsonb(a)::text) is distinct from p.author_hash
      or md5(to_jsonb(u)::text) is distinct from p.auth_hash or md5(to_jsonb(i)::text) is distinct from p.identity_hash
      or md5(to_jsonb(c)::text) is distinct from p.secure_hash or md5(to_jsonb(b)::text) is distinct from p.alternate_hash) then
    raise exception 'Unexpected imported source mutation'; end if;
end $$;
commit;
