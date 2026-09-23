-- STEP 2: additive, NOT applied to production. Apply after p0/001, never auto-enable v2.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$ begin
  if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true' then
    raise exception 'Authoring schema/backup review gate required';
  end if;
  if not exists(select 1 from public.p0_migration_status where version='p0-20260921') then
    raise exception 'P0 expansion required';
  end if;
  if exists(select 1 from public.episodes where episode_number is null or episode_number<1) then
    raise exception 'Invalid legacy episode number: reconcile before migration';
  end if;
  if exists(select 1 from public.works w left join public.authors a on a.id=w.author_id where a.id is null)
    or exists(select 1 from public.episodes e left join public.works w on w.id=e.work_id where w.id is null) then
    raise exception 'Legacy owner/work reference unresolved';
  end if;
end $$;

-- Duplicates must be reconciled with their owner, never silently renumbered/deleted.
create unique index if not exists authoring_work_owner_uq on public.works(id,author_id);
create unique index if not exists authoring_episode_work_uq on public.episodes(id,work_id);
create unique index if not exists authoring_episode_number_uq on public.episodes(work_id,episode_number);
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.episodes'::regclass and conname='authoring_episode_number_valid') then
    alter table public.episodes add constraint authoring_episode_number_valid check(work_id is not null and episode_number is not null and episode_number>0);
  end if;
end $$;

create schema if not exists authoring;
revoke all on schema authoring from public,anon,authenticated;
grant usage on schema authoring to service_role;

create table if not exists authoring.migrations (
  version text primary key, applied_at timestamptz not null default now()
);
create table if not exists authoring.retention_policy (
  singleton boolean primary key default true check(singleton),
  revision_days integer check(revision_days > 0), trash_days integer check(trash_days > 0),
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  check((approved_by is null) = (approved_at is null)),
  check((revision_days is null and trash_days is null) or approved_at is not null)
);
-- NULL means no automatic purge. No invented retention decision.
insert into authoring.retention_policy(singleton) values(true) on conflict do nothing;

create table if not exists authoring.identity_evidence (
  profile_kind text not null check(profile_kind in ('reader','author','admin')),
  profile_id text not null check(length(profile_id)>0),
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  evidence_ref text not null check(length(btrim(evidence_ref))>0),
  verified_by uuid not null references auth.users(id) on delete restrict,
  verified_at timestamptz not null default now(),
  primary key(profile_kind,profile_id), unique(profile_kind,auth_user_id)
);
-- Evidence is an audit record, not an alternative authentication/authorization source.

create table if not exists authoring.work_state (
  work_id bigint primary key, author_id bigint not null,
  visibility text not null default 'PRIVATE' check(visibility in ('PRIVATE','PUBLIC')),
  serial_state text not null default 'ONGOING' check(serial_state in ('ONGOING','HIATUS','COMPLETED')),
  moderation_state text not null default 'CLEAR' check(moderation_state in ('CLEAR','RESTRICTED')),
  moderation_reason text,
  trashed_at timestamptz, updated_at timestamptz not null default now(),
  unique(work_id,author_id),
  foreign key(work_id,author_id) references public.works(id,author_id) on delete restrict on update restrict,
  check(moderation_state <> 'RESTRICTED' or length(btrim(moderation_reason))>0 and moderation_reason is not null)
);

create table if not exists authoring.drafts (
  id uuid primary key default gen_random_uuid(),
  work_id bigint not null, author_id bigint not null,
  episode_id bigint, legacy_draft_id uuid unique,
  current_revision bigint not null default 1 check(current_revision>0),
  lifecycle text not null default 'ACTIVE' check(lifecycle in ('ACTIVE','PUBLISHED','TRASHED')),
  trashed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,work_id),
  foreign key(work_id,author_id) references authoring.work_state(work_id,author_id) on delete restrict,
  foreign key(episode_id,work_id) references public.episodes(id,work_id) on delete restrict,
  check((lifecycle='TRASHED') = (trashed_at is not null))
);
create table if not exists authoring.draft_revisions (
  draft_id uuid not null references authoring.drafts(id) on delete restrict,
  revision bigint not null check(revision>0),
  title text not null default '', content text not null default '', author_comment text not null default '',
  image_urls jsonb not null default '[]' check(jsonb_typeof(image_urls)='array'),
  created_at timestamptz not null default now(), primary key(draft_id,revision)
);
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='authoring.drafts'::regclass and conname='draft_current_revision_fk') then
    alter table authoring.drafts add constraint draft_current_revision_fk
      foreign key(id,current_revision) references authoring.draft_revisions(draft_id,revision)
      deferrable initially deferred;
  end if;
end $$;

-- A version is not public merely because it exists. A head + work/episode policy is required.
create table if not exists authoring.publication_versions (
  id uuid primary key default gen_random_uuid(),
  episode_id bigint not null, work_id bigint not null,
  source_draft_id uuid, source_revision bigint,
  title text not null, content text not null, author_comment text not null default '',
  image_urls jsonb not null default '[]' check(jsonb_typeof(image_urls)='array'),
  created_at timestamptz not null default now(),
  unique(id,episode_id), unique(id,work_id),
  foreign key(episode_id,work_id) references public.episodes(id,work_id) on delete restrict,
  foreign key(source_draft_id,source_revision) references authoring.draft_revisions(draft_id,revision) match full on delete restrict,
  foreign key(source_draft_id,work_id) references authoring.drafts(id,work_id) on delete restrict
);
create table if not exists authoring.publication_heads (
  episode_id bigint primary key references public.episodes(id) on delete restrict,
  version_id uuid not null, published_at timestamptz not null default now(),
  foreign key(version_id,episode_id) references authoring.publication_versions(id,episode_id) on delete restrict
);
create table if not exists authoring.publish_requests (
  work_id bigint not null references authoring.work_state(work_id) on delete restrict,
  idempotency_key uuid not null,
  payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
  result_version_id uuid,
  created_at timestamptz not null default now(), primary key(work_id,idempotency_key),
  foreign key(result_version_id,work_id) references authoring.publication_versions(id,work_id) on delete restrict
);
create table if not exists authoring.schedules (
  id uuid primary key default gen_random_uuid(),
  episode_id bigint not null, version_id uuid not null,
  due_at timestamptz not null, display_timezone text not null default 'Asia/Seoul',
  status text not null default 'PENDING' check(status in ('PENDING','RUNNING','SUCCEEDED','CANCELLED','FAILED')),
  attempts integer not null default 0 check(attempts>=0),
  lease_token uuid, lease_until timestamptz,
  last_error_code text, updated_at timestamptz not null default now(),
  foreign key(version_id,episode_id) references authoring.publication_versions(id,episode_id) on delete restrict,
  check((status='RUNNING') = (lease_token is not null and lease_until is not null)),
  check((lease_token is null) = (lease_until is null))
);
create unique index if not exists authoring_active_schedule_uq on authoring.schedules(episode_id) where status in ('PENDING','RUNNING');
create index if not exists authoring_due_schedule_idx on authoring.schedules(due_at) where status='PENDING';

create table if not exists authoring.files (
  id uuid primary key default gen_random_uuid(), work_id bigint not null, author_id bigint not null,
  bucket_id text not null check(bucket_id in ('authoring-originals','authoring-covers')),
  object_key text not null check(length(btrim(object_key))>0),
  purpose text not null check(purpose in ('MANUSCRIPT_ORIGINAL','COVER_ORIGINAL','COVER_DERIVATIVE')),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), byte_size bigint not null check(byte_size>=0),
  trashed_at timestamptz, created_at timestamptz not null default now(),
  unique(bucket_id,object_key), unique(id,work_id),
  foreign key(work_id,author_id) references authoring.work_state(work_id,author_id) on delete restrict,
  check((purpose='COVER_DERIVATIVE') = (bucket_id='authoring-covers'))
);
create table if not exists authoring.revision_files (
  draft_id uuid not null, revision bigint not null, file_id uuid not null, work_id bigint not null,
  primary key(draft_id,revision,file_id),
  foreign key(draft_id,revision) references authoring.draft_revisions(draft_id,revision) on delete restrict,
  foreign key(draft_id,work_id) references authoring.drafts(id,work_id) on delete restrict,
  foreign key(file_id,work_id) references authoring.files(id,work_id) on delete restrict
);

create or replace function authoring.reject_mutation() returns trigger
language plpgsql set search_path='' as $$ begin
  raise exception 'Immutable authoring record' using errcode='55000';
end $$;
create or replace function authoring.validate_snapshot() returns trigger
language plpgsql set search_path='' as $$ begin
  if new.source_draft_id is not null and not exists(
    select 1 from authoring.draft_revisions r where r.draft_id=new.source_draft_id and r.revision=new.source_revision
      and (r.title,r.content,r.author_comment,r.image_urls) is not distinct from (new.title,new.content,new.author_comment,new.image_urls)
  ) then raise exception 'Publication must match its source revision' using errcode='23514'; end if;
  return new;
end $$;
drop trigger if exists validate_snapshot on authoring.publication_versions;
create trigger validate_snapshot before insert on authoring.publication_versions for each row execute function authoring.validate_snapshot();
create or replace function authoring.protect_request() returns trigger
language plpgsql set search_path='' as $$ begin
  if (new.work_id,new.idempotency_key,new.payload_sha256) is distinct from (old.work_id,old.idempotency_key,old.payload_sha256)
    or (old.result_version_id is not null and new.result_version_id is distinct from old.result_version_id) then
    raise exception 'Idempotent request identity/result cannot change' using errcode='55000';
  end if;
  return new;
end $$;
drop trigger if exists protect_request on authoring.publish_requests;
create trigger protect_request before update on authoring.publish_requests for each row execute function authoring.protect_request();
do $$ declare t text; begin
  foreach t in array array['draft_revisions','publication_versions','identity_evidence'] loop
    execute format('drop trigger if exists immutable_record on authoring.%I',t);
    execute format('create trigger immutable_record before update or delete on authoring.%I for each row execute function authoring.reject_mutation()',t);
  end loop;
end $$;

-- Trusted server only; caller authorization belongs to step 3. No public RPC wrapper.
create or replace function authoring.save_draft(p_id uuid,p_expected bigint,p_title text,p_content text,p_comment text)
returns bigint language plpgsql set search_path='' as $$
declare d authoring.drafts; next_revision bigint;
begin
  select * into d from authoring.drafts where id=p_id for update;
  if not found then raise exception 'Draft not found' using errcode='P0002'; end if;
  if d.lifecycle <> 'ACTIVE' then raise exception 'Draft not active' using errcode='55000'; end if;
  if p_expected is distinct from d.current_revision then raise exception 'DRAFT_CONFLICT' using errcode='40001'; end if;
  next_revision := d.current_revision+1;
  insert into authoring.draft_revisions(draft_id,revision,title,content,author_comment,image_urls)
    select p_id,next_revision,p_title,p_content,p_comment,image_urls from authoring.draft_revisions where draft_id=p_id and revision=d.current_revision;
  update authoring.drafts set current_revision=next_revision,updated_at=now() where id=p_id;
  return next_revision;
end $$;

-- A separate schema avoids p0/002's broad service_role grants to public tables.
revoke all on all tables in schema authoring from public,anon,authenticated;
revoke all on all functions in schema authoring from public,anon,authenticated;
grant select,insert,update on all tables in schema authoring to service_role;
revoke update on authoring.draft_revisions,authoring.publication_versions,authoring.identity_evidence from service_role;
grant execute on function authoring.save_draft(uuid,bigint,text,text,text) to service_role;
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='authoring' loop
    execute format('alter table authoring.%I enable row level security',t.tablename);
  end loop;
end $$;
alter default privileges in schema authoring revoke all on tables from public,anon,authenticated;
alter default privileges in schema authoring revoke execute on functions from public,anon,authenticated;
insert into authoring.migrations(version) values('authoring-001') on conflict do nothing;
commit;
