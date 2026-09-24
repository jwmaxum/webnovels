-- PREPARED, NOT APPLIED. Review 000_preflight and verify a restorable backup first.
-- Additive: keep original IDs, profiles, passwords, content, and all existing records.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Multiple legacy generations can contain different bodies. Never silently select one.
-- The operator must preserve both sources, identify the authoritative version and reconcile first.
do $$ declare body_conflict boolean; begin
  if to_regclass('public.episode_contents') is not null then
    if not exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='episode_contents' and column_name='text_content') then
      raise exception 'Legacy body source structure requires review before expansion';
    end if;
    execute 'select exists(select 1 from public.episodes e join public.episode_contents c on c.episode_id=e.id
      where e.content is distinct from c.text_content)' into body_conflict;
    if body_conflict then raise exception 'Legacy body sources disagree: reconcile verified content before expansion'; end if;
  end if;
end $$;

alter table public.readers add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
alter table public.authors add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
alter table public.admin_users add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
-- Fail on conflicting mappings instead of merging or deleting accounts.
create unique index if not exists p0_readers_auth_uid on public.readers(auth_user_id) where auth_user_id is not null;
create unique index if not exists p0_authors_auth_uid on public.authors(auth_user_id) where auth_user_id is not null;
create unique index if not exists p0_admins_auth_uid on public.admin_users(auth_user_id) where auth_user_id is not null;

create table if not exists public.p0_migration_status (
  version text primary key, phase text not null check (phase in ('expanded','locked')), applied_at timestamptz not null default now()
);
create table if not exists public.secure_episode_contents (
  episode_id bigint primary key references public.episodes(id) on delete cascade,
  content text, image_urls jsonb, updated_at timestamptz not null default now()
);
create table if not exists public.p0_episode_entitlements (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  episode_id bigint not null references public.episodes(id) on delete cascade,
  source_event_id text not null unique,
  expires_at timestamptz, revoked_at timestamptz, created_at timestamptz not null default now(),
  unique(auth_user_id, episode_id)
);
-- Do not backfill this from the old client-writable is_adult_verified flag.
create table if not exists public.p0_identity_verifications (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null, provider_verification_id text not null,
  provider_mode text not null check(provider_mode in ('TEST','LIVE')),
  adult_eligible boolean not null default false,
  verified_at timestamptz not null, expires_at timestamptz not null,
  revoked_at timestamptz,
  unique(provider,provider_verification_id), check(expires_at > verified_at)
);

alter table public.p0_migration_status enable row level security;
alter table public.secure_episode_contents enable row level security;
alter table public.p0_episode_entitlements enable row level security;
alter table public.p0_identity_verifications enable row level security;
revoke all on public.p0_migration_status, public.secure_episode_contents, public.p0_episode_entitlements, public.p0_identity_verifications from public, anon, authenticated;
grant all on public.p0_migration_status, public.secure_episode_contents, public.p0_episode_entitlements, public.p0_identity_verifications to service_role;

-- Capture edits during migration, using an atomic trigger rather than two HTTP writes.
create or replace function public.p0_mirror_episode_content() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.secure_episode_contents(episode_id,content,image_urls,updated_at)
  values(new.id,new.content,to_jsonb(new.image_urls),now())
  on conflict(episode_id) do update set content=excluded.content,image_urls=excluded.image_urls,updated_at=excluded.updated_at;
  return new;
end $$;
revoke all on function public.p0_mirror_episode_content() from public,anon,authenticated;
drop trigger if exists p0_mirror_episode_content on public.episodes;
create trigger p0_mirror_episode_content after insert or update of content,image_urls on public.episodes
for each row execute function public.p0_mirror_episode_content();

-- Lock out concurrent edits until backfill + verification are committed.
lock table public.episodes in share row exclusive mode;
insert into public.secure_episode_contents(episode_id,content,image_urls)
select id,content,to_jsonb(image_urls) from public.episodes
on conflict(episode_id) do update set content=excluded.content,image_urls=excluded.image_urls,updated_at=now();
do $$ begin
  if exists(select 1 from public.episodes e left join public.secure_episode_contents c on c.episode_id=e.id
    where c.episode_id is null or c.content is distinct from e.content or c.image_urls is distinct from to_jsonb(e.image_urls)) then
    raise exception 'Content preservation check failed';
  end if;
end $$;
insert into public.p0_migration_status(version,phase) values('p0-20260921','expanded') on conflict(version) do nothing;
commit;
