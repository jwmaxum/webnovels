-- Operator-only, targeted repair. Caller supplies pg_temp.launch_owner_plan,
-- launch_body_plan and launch_context from a hash-verified, restored snapshot.
-- Never execute an entire seed against production. Never infer identity from names.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local timezone='UTC';
lock table public.works,public.authors,public.episodes,public.episode_contents in share row exclusive mode;
do $$ begin
  if current_user in ('anon','authenticated','service_role') then raise exception 'Database operator required'; end if;
  if (select count(*) from pg_temp.launch_context) <> 1 then raise exception 'Backup and selection context required'; end if;
  if exists(select 1 from pg_temp.launch_context where length(backup_sha256)<>64 or length(btrim(evidence_ref))<10) then
    raise exception 'Backup and selection evidence required'; end if;
  if exists(select 1 from pg_temp.launch_owner_plan p left join public.works w on w.id=p.work_id
    left join public.authors a on a.id=p.author_id where w.id is null or a.id is null or w.author_id is not null
    or md5(to_jsonb(w)::text) is distinct from p.work_hash or md5(to_jsonb(a)::text) is distinct from p.author_hash) then
    raise exception 'Owner plan stale or conflicting'; end if;
  if exists(select 1 from pg_temp.launch_body_plan p left join public.episodes e on e.id=p.episode_id
    left join public.episode_contents c on c.episode_id=p.episode_id where e.id is null or c.episode_id is null
    or nullif(btrim(e.content),'') is null or e.content is not distinct from c.text_content
    or md5(to_jsonb(e)::text) is distinct from p.episode_hash or md5(to_jsonb(c)::text) is distinct from p.content_hash) then
    raise exception 'Body plan stale, empty or conflicting'; end if;
end $$;

create schema if not exists launch_recovery;
revoke all on schema launch_recovery from public,anon,authenticated,service_role;
create table if not exists launch_recovery.reconciliation_history (
  batch_id text not null, entity_kind text not null check(entity_kind in ('owner','body')),
  entity_id text not null, before_data jsonb not null, after_data jsonb not null,
  evidence_ref text not null, backup_sha256 text not null, recorded_at timestamptz not null default now(),
  primary key(batch_id,entity_kind,entity_id)
);
alter table launch_recovery.reconciliation_history enable row level security;
revoke all on launch_recovery.reconciliation_history from public,anon,authenticated,service_role;
create or replace function launch_recovery.reject_history_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Reconciliation history is immutable'; end $$;
revoke all on function launch_recovery.reject_history_change() from public,anon,authenticated,service_role;
drop trigger if exists immutable_reconciliation_history on launch_recovery.reconciliation_history;
create trigger immutable_reconciliation_history before update or delete on launch_recovery.reconciliation_history
for each row execute function launch_recovery.reject_history_change();

insert into launch_recovery.reconciliation_history(batch_id,entity_kind,entity_id,before_data,after_data,evidence_ref,backup_sha256)
select x.batch_id,'owner',w.id::text,to_jsonb(w),to_jsonb(w)||jsonb_build_object('author_id',p.author_id),p.evidence_ref,x.backup_sha256
from pg_temp.launch_owner_plan p join public.works w on w.id=p.work_id cross join pg_temp.launch_context x;
update public.works w set author_id=p.author_id from pg_temp.launch_owner_plan p where p.work_id=w.id;

insert into launch_recovery.reconciliation_history(batch_id,entity_kind,entity_id,before_data,after_data,evidence_ref,backup_sha256)
select x.batch_id,'body',e.id::text,jsonb_build_object('episode',to_jsonb(e),'content',to_jsonb(c)),
  jsonb_build_object('episode',to_jsonb(e),'content',to_jsonb(c)||jsonb_build_object('text_content',e.content,
    'content_version',coalesce(c.content_version,0)+1,'updated_at',now())),x.evidence_ref,x.backup_sha256
from pg_temp.launch_body_plan p join public.episodes e on e.id=p.episode_id
join public.episode_contents c on c.episode_id=e.id cross join pg_temp.launch_context x;
update public.episode_contents c set text_content=e.content,content_version=coalesce(c.content_version,0)+1,updated_at=now()
from pg_temp.launch_body_plan p join public.episodes e on e.id=p.episode_id where c.episode_id=p.episode_id;

do $$ begin
  if exists(select 1 from pg_temp.launch_owner_plan p join public.works w on w.id=p.work_id where w.author_id<>p.author_id) then
    raise exception 'Owner verification failed'; end if;
  if exists(select 1 from pg_temp.launch_body_plan p join public.episodes e on e.id=p.episode_id
    join public.episode_contents c on c.episode_id=e.id where c.text_content is distinct from e.content) then
    raise exception 'Body verification failed'; end if;
  if exists(select 1 from launch_recovery.reconciliation_history h join pg_temp.launch_context x using(batch_id)
    join public.works w on h.entity_kind='owner' and w.id::text=h.entity_id where to_jsonb(w) is distinct from h.after_data) then
    raise exception 'Unexpected work mutation'; end if;
  if exists(select 1 from launch_recovery.reconciliation_history h join pg_temp.launch_context x using(batch_id)
    join public.episodes e on h.entity_kind='body' and e.id::text=h.entity_id
    join public.episode_contents c on c.episode_id=e.id where
      jsonb_build_object('episode',to_jsonb(e),'content',to_jsonb(c)) is distinct from h.after_data) then
    raise exception 'Unexpected body mutation'; end if;
end $$;
commit;
