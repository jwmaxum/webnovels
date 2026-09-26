-- Private works/drafts rollout. Does not reconcile or expose legacy episode bodies.
begin;
set local lock_timeout='5s';
do $$ begin
  if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
    or coalesce(current_setting('webnovels.workspace_backup_sha256',true),'') !~ '^[a-f0-9]{64}$'
    or not public.launch_accounts_ready() then
    raise exception 'Reviewed backup and account service required';
  end if;
end $$;
create table if not exists launch_recovery.author_workspace_service (
  version text primary key check(version='workspace-20260926'),
  enabled boolean not null default false,
  backup_sha256 text not null check(backup_sha256 ~ '^[a-f0-9]{64}$'),
  reviewed_at timestamptz not null default now(), activated_at timestamptz
);
alter table launch_recovery.author_workspace_service enable row level security;
revoke all on launch_recovery.author_workspace_service from public,anon,authenticated,service_role;
insert into launch_recovery.author_workspace_service(version,backup_sha256)
values('workspace-20260926',current_setting('webnovels.workspace_backup_sha256')) on conflict do nothing;

create or replace function launch_recovery.private_authoring_prerequisites() returns boolean
language sql stable security definer set search_path='' as $$
 select public.launch_accounts_ready()
 and exists(select 1 from launch_recovery.author_workspace_service where version='workspace-20260926')
 and not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   cross join pg_catalog.pg_roles r where n.nspname='public' and c.relkind in ('r','p')
   and r.rolname in ('anon','authenticated') and has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE'))
 and not exists(select 1 from information_schema.column_privileges where table_schema='public'
   and grantee in ('PUBLIC','anon','authenticated') and privilege_type in ('INSERT','UPDATE'))
 and not exists(select 1 from pg_catalog.pg_roles r where r.rolname in ('anon','authenticated') and (
   has_column_privilege(r.oid,'public.episodes','content','SELECT')
   or has_column_privilege(r.oid,'public.episode_contents','text_content','SELECT')))
 and not exists(select 1 from public.works w left join public.authors a on a.id=w.author_id where a.id is null)
 and not exists(select 1 from public.episode_drafts d left join public.works w on w.id=d.work_id
   where w.id is null or d.author_id is distinct from w.author_id)
$$;
revoke all on function launch_recovery.private_authoring_prerequisites() from public,anon,authenticated,service_role;
do $$ begin
  if not launch_recovery.private_authoring_prerequisites() then raise exception 'Private authoring prerequisites failed'; end if;
end $$;
commit;
