-- PREPARED, NOT APPLIED. Generated only from a reviewed, restored private snapshot.
-- Does not alter ownership/type/images, create publication heads, or bypass P0 gates.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local timezone='UTC';
lock table public.works,public.authors,public.episodes,public.episode_contents,auth.users,authoring.identity_evidence in share row exclusive mode;
do $$ begin
  if current_user in ('anon','authenticated','service_role') then raise exception 'Database operator required'; end if;
  if (select count(*) from pg_temp.content_review_context)<>1 or not exists(select 1 from pg_temp.content_review_plan) then
    raise exception 'Reviewed content context required'; end if;
  if exists(select 1 from pg_temp.content_review_plan p
    left join public.episodes e on e.id=p.episode_id left join public.episode_contents c on c.episode_id=e.id
    left join public.works w on w.id=e.work_id left join public.authors a on a.id=w.author_id
    left join auth.users u on u.id=a.auth_user_id
    left join authoring.identity_evidence i on i.profile_kind='author' and i.profile_id=a.id::text and i.auth_user_id=u.id
    where e.id is null or c.episode_id is null or w.id is null or a.id is null or u.id is null or i.profile_id is null
      or u.email_confirmed_at is null or u.deleted_at is not null or coalesce(u.is_anonymous,false) or u.banned_until>now()
      or e.content is not distinct from c.text_content
      or md5(to_jsonb(e)::text) is distinct from p.episode_hash or md5(to_jsonb(c)::text) is distinct from p.content_hash
      or md5(to_jsonb(w)::text) is distinct from p.work_hash or md5(to_jsonb(a)::text) is distinct from p.author_hash
      or md5(to_jsonb(u)::text) is distinct from p.auth_hash or md5(to_jsonb(i)::text) is distinct from p.identity_hash
      or p.choice not in ('USE_EPISODES','USE_EPISODE_CONTENTS') or length(p.evidence_ref)<10
      or w.content_type::text not in ('NOVEL','WEBTOON')
      or (w.content_type::text='NOVEL' and nullif(btrim(case when p.choice='USE_EPISODES' then e.content else c.text_content end),'') is null)
      or (w.content_type::text='WEBTOON' and coalesce(jsonb_array_length(to_jsonb(e.image_urls)),0)=0)) then
    raise exception 'Reviewed content plan stale, unverified or invalid'; end if;
end $$;
create schema if not exists launch_recovery;
revoke all on schema launch_recovery from public,anon,authenticated,service_role;
create table if not exists launch_recovery.content_selection_history(
  batch_id text not null,episode_id bigint not null,choice text not null,
  before_data jsonb not null,after_data jsonb not null,evidence_ref text not null,
  backup_sha256 text not null,recorded_at timestamptz not null default now(),primary key(batch_id,episode_id)
);
alter table launch_recovery.content_selection_history enable row level security;
revoke all on launch_recovery.content_selection_history from public,anon,authenticated,service_role;
create or replace function launch_recovery.reject_content_selection_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Content selection history is immutable'; end $$;
revoke all on function launch_recovery.reject_content_selection_change() from public,anon,authenticated,service_role;
drop trigger if exists immutable_content_selection_history on launch_recovery.content_selection_history;
create trigger immutable_content_selection_history before update or delete on launch_recovery.content_selection_history
for each row execute function launch_recovery.reject_content_selection_change();
insert into launch_recovery.content_selection_history(batch_id,episode_id,choice,before_data,after_data,evidence_ref,backup_sha256)
select x.batch_id,e.id,p.choice,jsonb_build_object('episode',to_jsonb(e),'content',to_jsonb(c)),
  case when p.choice='USE_EPISODES' then jsonb_build_object('episode',to_jsonb(e),'content',to_jsonb(c)||
    jsonb_build_object('text_content',e.content,'content_version',coalesce(c.content_version,0)+1,'updated_at',now()))
  else jsonb_build_object('episode',to_jsonb(e)||jsonb_build_object('content',c.text_content),'content',to_jsonb(c)) end,
  p.evidence_ref,x.backup_sha256
from pg_temp.content_review_plan p join public.episodes e on e.id=p.episode_id
join public.episode_contents c on c.episode_id=e.id cross join pg_temp.content_review_context x;
update public.episode_contents c set text_content=e.content,content_version=coalesce(c.content_version,0)+1,updated_at=now()
from pg_temp.content_review_plan p join public.episodes e on e.id=p.episode_id where c.episode_id=p.episode_id and p.choice='USE_EPISODES';
update public.episodes e set content=c.text_content
from pg_temp.content_review_plan p join public.episode_contents c on c.episode_id=p.episode_id where e.id=p.episode_id and p.choice='USE_EPISODE_CONTENTS';
do $$ begin
  if exists(select 1 from launch_recovery.content_selection_history h join pg_temp.content_review_context x using(batch_id)
    join public.episodes e on e.id=h.episode_id join public.episode_contents c on c.episode_id=e.id
    where e.content is distinct from c.text_content or jsonb_build_object('episode',to_jsonb(e),'content',to_jsonb(c)) is distinct from h.after_data) then
    raise exception 'Unexpected content selection mutation'; end if;
end $$;
commit;
