-- PRIVATE CANDIDATE, NOT AN APPLIED MIGRATION. Reviewed maintenance operator only.
-- Generated from a verified snapshot and actual stage30 evidence. Never creates a publication.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local timezone='UTC';
set local standard_conforming_strings=on;
__PRELUDE__
do $$ begin
 if current_user in ('anon','authenticated','service_role')
 or current_setting('webnovels.submitted_restore_reviewed',true) is distinct from 'true'
 or current_setting('webnovels.restore_runtime_disabled',true) is distinct from 'true'
 or current_setting('webnovels.restore_target_ref',true) is distinct from (select target_ref from pg_temp.submitted_restore_context)
 then raise exception 'SUBMITTED_RESTORE_OPERATOR_CONTEXT_REQUIRED'; end if;
 if to_regclass('launch_recovery.submitted_restore_history') is not null then
  if exists(select 1 from launch_recovery.submitted_restore_history h join pg_temp.submitted_restore_plan p on p.request_id=h.request_id)
  then raise exception 'SUBMITTED_RESTORE_REPLAY_FORBIDDEN'; end if;
 end if;
end $$;
__LOCKS__
__SOURCE_GUARD__
do $$ begin
 if not exists(select 1 from pg_temp.submitted_restore_plan) or exists(
  select 1 from pg_temp.submitted_restore_plan p
  left join authoring.recovery_requests r on r.id=p.request_id
  left join lateral(select * from authoring.recovery_review_events x where x.request_id=r.id order by x.revision desc limit 1) v on true
  left join public.admin_users ad on ad.auth_user_id=v.actor_user_id
  left join auth.users au on au.id=v.actor_user_id
  left join public.episodes e on e.id=p.episode_id
  left join public.secure_episode_contents c on c.episode_id=e.id
  where r.id is null or e.id is null or c.episode_id is null
   or e.scheduled_at is not null or exists(select 1 from authoring.publication_heads h where h.episode_id=e.id)
   or exists(select 1 from authoring.schedules s where s.episode_id=e.id and s.status in ('PENDING','RUNNING'))
   or v.revision is distinct from p.review_revision or v.disposition is distinct from 'READY_FOR_RESTORE_REVIEW'
   or ad.role::text is distinct from 'SUPER_ADMIN' or ad.is_active is distinct from true
   or au.email_confirmed_at is null or au.is_anonymous is true or au.banned_until>now() or to_jsonb(au)->>'deleted_at' is not null
   or (authoring.recovery_review_context(r)->>'eligible')::boolean is distinct from true
   or authoring.recovery_review_context(r)->>'digest' is distinct from p.context_digest
   or v.context_digest is distinct from p.context_digest
   or authoring.recovery_target(e.id) is distinct from p.before_target
   or nullif(btrim(p.submitted->>'content'),'') is null)
 then raise exception 'SUBMITTED_RESTORE_CURRENT_REVIEW_INVALID'; end if;
end $$;
create schema if not exists launch_recovery;
revoke all on schema launch_recovery from public,anon,authenticated,service_role;
create table if not exists launch_recovery.submitted_restore_history(
 batch_id text not null,request_id uuid not null unique,episode_id bigint not null,
 source_ref text not null,target_ref text not null,backup_sha256 text not null,
 packet_sha256 text not null,decisions_sha256 text not null,review_revision bigint not null,
 before_data jsonb not null,after_data jsonb not null,submitted jsonb not null,imported jsonb not null,
 evidence jsonb not null,recorded_at timestamptz not null default now(),primary key(batch_id,request_id)
);
alter table launch_recovery.submitted_restore_history enable row level security;
revoke all on launch_recovery.submitted_restore_history from public,anon,authenticated,service_role;
create or replace function launch_recovery.reject_submitted_restore_change() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'SUBMITTED_RESTORE_HISTORY_IMMUTABLE'; end $$;
revoke all on function launch_recovery.reject_submitted_restore_change() from public,anon,authenticated,service_role;
drop trigger if exists immutable_submitted_restore on launch_recovery.submitted_restore_history;
create trigger immutable_submitted_restore before update or delete on launch_recovery.submitted_restore_history
 for each row execute function launch_recovery.reject_submitted_restore_change();
drop trigger if exists immutable_submitted_restore_truncate on launch_recovery.submitted_restore_history;
create trigger immutable_submitted_restore_truncate before truncate on launch_recovery.submitted_restore_history
 for each statement execute function launch_recovery.reject_submitted_restore_change();
update public.episodes e set content=p.submitted->>'content'
 from pg_temp.submitted_restore_plan p where e.id=p.episode_id;
-- The existing P0 mirror may refresh these fields when episodes.content changes.
-- Preserve the reviewed original image bytes/references and timestamp explicitly.
update public.secure_episode_contents e set content=p.submitted->>'content',
 image_urls=nullif(p.before_target->'protected'->'image_urls','null'::jsonb),
 updated_at=(p.before_target->'protected'->>'updated_at')::timestamptz
 from pg_temp.submitted_restore_plan p where e.episode_id=p.episode_id;
do $$ begin
 if to_regclass('public.episode_contents') is not null then
  execute 'update public.episode_contents e set text_content=p.submitted->>''content''
   from pg_temp.submitted_restore_plan p where e.episode_id=p.episode_id';
 end if;
end $$;
__AFTER_GUARD__
insert into launch_recovery.submitted_restore_history(batch_id,request_id,episode_id,source_ref,target_ref,
 backup_sha256,packet_sha256,decisions_sha256,review_revision,before_data,after_data,submitted,imported,evidence)
select x.batch_id,p.request_id,p.episode_id,x.source_ref,x.target_ref,x.backup_sha256,x.packet_sha256,
 x.decisions_sha256,p.review_revision,p.before_target,authoring.recovery_target(p.episode_id),p.submitted,p.imported,p.evidence
 from pg_temp.submitted_restore_plan p cross join pg_temp.submitted_restore_context x;
do $$ begin
 if (select count(*) from launch_recovery.submitted_restore_history h join pg_temp.submitted_restore_context x using(batch_id))
 is distinct from (select count(*) from pg_temp.submitted_restore_plan)
 then raise exception 'SUBMITTED_RESTORE_HISTORY_INCOMPLETE'; end if;
end $$;
commit;
