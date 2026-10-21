-- Independent of P0 content reconciliation. No legacy body is selected or copied.
begin;
set local lock_timeout='5s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
 or coalesce(current_setting('webnovels.workspace_backup_sha256',true),'') !~ '^[a-f0-9]{64}$'
 or not exists(select 1 from authoring.migrations where version='authoring-006') then
  raise exception 'Reviewed workspace and fresh backup required'; end if;
end $$;
lock table public.works, public.episodes, authoring.work_create_requests in share row exclusive mode;

create table if not exists authoring.new_serial_service(
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 backup_sha256 text not null check(backup_sha256 ~ '^[a-f0-9]{64}$'), captured_at timestamptz not null default now()
);
create table if not exists authoring.legacy_work_scope(work_id bigint primary key references public.works(id) on delete restrict);
create table if not exists authoring.legacy_episode_scope(episode_id bigint primary key references public.episodes(id) on delete restrict);
create table if not exists authoring.new_serial_works(
 work_id bigint primary key references public.works(id) on delete restrict,
 author_id bigint not null references public.authors(id) on delete restrict,
 user_id uuid not null references auth.users(id) on delete restrict, request_key uuid not null,
 registered_at timestamptz not null default now(), unique(user_id,request_key),
 foreign key(user_id,request_key) references authoring.work_create_requests(user_id,request_key) on delete restrict
);
alter table authoring.new_serial_service enable row level security;
alter table authoring.legacy_work_scope enable row level security;
alter table authoring.legacy_episode_scope enable row level security;
alter table authoring.new_serial_works enable row level security;
revoke all on authoring.new_serial_service,authoring.legacy_work_scope,authoring.legacy_episode_scope,authoring.new_serial_works from public,anon,authenticated,service_role;

-- Reapplication must never reclassify works registered after the first snapshot.
do $$ begin
 if not exists(select 1 from authoring.new_serial_service) then
  insert into authoring.new_serial_service(backup_sha256) values(current_setting('webnovels.workspace_backup_sha256'));
  insert into authoring.legacy_work_scope select id from public.works;
  insert into authoring.legacy_episode_scope select id from public.episodes;
 end if;
end $$;
create or replace function authoring.keep_serial_scope() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'Publication scope is immutable'; end $$;
revoke all on function authoring.keep_serial_scope() from public,anon,authenticated,service_role;
drop trigger if exists keep_serial_scope on authoring.legacy_work_scope;
create trigger keep_serial_scope before update or delete on authoring.legacy_work_scope for each row execute function authoring.keep_serial_scope();
drop trigger if exists keep_serial_scope on authoring.legacy_episode_scope;
create trigger keep_serial_scope before update or delete on authoring.legacy_episode_scope for each row execute function authoring.keep_serial_scope();
drop trigger if exists keep_serial_scope on authoring.new_serial_works;
create trigger keep_serial_scope before update or delete on authoring.new_serial_works for each row execute function authoring.keep_serial_scope();

-- This receipt is inserted only by canonical creator_works, in its creation transaction.
-- Retries return an existing receipt; direct administrator inserts have no receipt.
create or replace function authoring.register_new_serial() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner_id bigint;
begin
 select w.author_id into owner_id from public.works w
 join authoring.work_state s on s.work_id=w.id and s.author_id=w.author_id
 join public.authors a on a.id=w.author_id and a.auth_user_id=new.user_id
 where w.id=new.work_id and w.status::text='DRAFT' and s.visibility='PRIVATE'
 and s.trashed_at is null and a.status::text='APPROVED'
 and not exists(select 1 from public.episodes e where e.work_id=w.id)
 and not exists(select 1 from authoring.legacy_work_scope l where l.work_id=w.id);
 if owner_id is null then raise exception 'New work receipt does not match publication scope'; end if;
 insert into authoring.new_serial_works(work_id,author_id,user_id,request_key) values(new.work_id,owner_id,new.user_id,new.request_key);
 return new;
end $$;
revoke all on function authoring.register_new_serial() from public,anon,authenticated,service_role;
drop trigger if exists register_new_serial on authoring.work_create_requests;
create trigger register_new_serial after insert on authoring.work_create_requests for each row execute function authoring.register_new_serial();

-- The later file/publication SQL has a private legacy export dependency on this relation.
-- Leave it empty on this path. Existing installations retain all their rows unchanged.
create table if not exists public.secure_episode_contents(
 episode_id bigint primary key references public.episodes(id) on delete cascade,
 content text,image_urls jsonb,updated_at timestamptz not null default now()
);
alter table public.secure_episode_contents enable row level security;
revoke all on public.secure_episode_contents from public,anon,authenticated,service_role;
-- Access is deliberately through owner-checked SECURITY DEFINER RPCs, not direct REST.
insert into authoring.migrations(version) values('launch-new-serial-foundation-20261021') on conflict do nothing;
notify pgrst,'reload schema';
commit;
