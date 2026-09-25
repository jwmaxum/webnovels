-- Account-only rollout. Does not activate P0/content/onboarding or change manuscript data.
begin;
set local lock_timeout='5s';
create schema if not exists launch_recovery;
revoke all on schema launch_recovery from public,anon,authenticated,service_role;
create table if not exists launch_recovery.account_service (
  version text primary key check(version='accounts-20260925'), enabled boolean not null default false,
  activated_at timestamptz
);
insert into launch_recovery.account_service(version) values('accounts-20260925') on conflict do nothing;
create table if not exists launch_recovery.account_links (
  kind text not null check(kind in ('author','reader','admin')), profile_id text not null,
  auth_user_id uuid not null references auth.users(id), evidence_ref text not null,
  operator_ref text not null, backup_sha256 text not null check(length(backup_sha256)=64),
  created_at timestamptz not null default now(), primary key(kind,profile_id), unique(kind,auth_user_id)
);
create table if not exists launch_recovery.virtual_accounts (
  kind text not null check(kind in ('author','reader')), profile_id text not null,
  auth_user_id uuid not null unique references auth.users(id), login_email text not null unique,
  revision bigint not null default 1, deleted_at timestamptz, previous_status text,
  auth_sync_pending boolean not null default false, desired_ban boolean not null default false,
  updated_at timestamptz not null default now(), primary key(kind,profile_id),
  foreign key(kind,profile_id) references launch_recovery.account_links(kind,profile_id)
);
create table if not exists launch_recovery.account_audit (
  id uuid primary key default gen_random_uuid(), actor_id uuid not null references auth.users(id),
  kind text not null, profile_id text not null, action text not null, reason text not null,
  before_value jsonb not null, after_value jsonb not null, created_at timestamptz not null default now()
);
alter table launch_recovery.account_service enable row level security;
alter table launch_recovery.account_links enable row level security;
alter table launch_recovery.virtual_accounts enable row level security;
alter table launch_recovery.account_audit enable row level security;
revoke all on all tables in schema launch_recovery from public,anon,authenticated,service_role;

create or replace function public.launch_accounts_ready() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from launch_recovery.account_service where version='accounts-20260925' and enabled)
   and not exists(select 1 from information_schema.role_column_grants
     where grantee in ('PUBLIC','anon','authenticated') and table_schema='public'
     and table_name in ('authors','readers','admin_users')
     and (privilege_type in ('INSERT','UPDATE','REFERENCES') or
       (privilege_type='SELECT' and (table_name in ('readers','admin_users') or
         (table_name='authors' and column_name not in ('id','username','pen_name','profile_image','bio','status'))))))
   and not exists(select 1 from information_schema.role_table_grants
     where grantee in ('PUBLIC','anon','authenticated') and table_schema='public'
     and table_name in ('authors','readers','admin_users') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE'))
$$;

create or replace function public.launch_account_actor(p_user uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb; a jsonb; m jsonb;
begin
 if not public.launch_accounts_ready() then return jsonb_build_object('error','ACCOUNT_SERVICE_NOT_ACTIVATED','status',503); end if;
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null
   and not is_anonymous and deleted_at is null and (banned_until is null or banned_until<=now())) then
   return jsonb_build_object('error','INVALID_SESSION','status',401); end if;
 if exists(select 1 from launch_recovery.virtual_accounts where auth_user_id=p_user and (deleted_at is not null or desired_ban)) then
   return jsonb_build_object('error','ACCOUNT_INACTIVE','status',403); end if;
 select jsonb_build_object('id',x.id::text,'username',x.username,'nickname',x.nickname,'status',x.status,
   'is_adult_verified',x.is_adult_verified,'adult_verified_at',x.adult_verified_at,'points',x.points)
 into r from public.readers x join launch_recovery.account_links l on l.kind='reader' and l.profile_id=x.id::text
   and l.auth_user_id=x.auth_user_id where x.auth_user_id=p_user;
 select jsonb_build_object('id',x.id::text,'username',x.username,'pen_name',x.pen_name,'bio',x.bio,'profile_image',x.profile_image,'status',x.status)
 into a from public.authors x join launch_recovery.account_links l on l.kind='author' and l.profile_id=x.id::text
   and l.auth_user_id=x.auth_user_id where x.auth_user_id=p_user;
 select jsonb_build_object('id',x.id::text,'username',x.username,'nickname',x.nickname,'role',x.role,'is_active',x.is_active,'permissions',x.permissions)
 into m from public.admin_users x join launch_recovery.account_links l on l.kind='admin' and l.profile_id=x.id::text
   and l.auth_user_id=x.auth_user_id where x.auth_user_id=p_user;
 if r is null and a is null and m is null then return jsonb_build_object('error','ACCOUNT_NOT_LINKED','status',403); end if;
 if (r is not null and coalesce(r->>'status','')<>'ACTIVE') or (a is not null and coalesce(a->>'status','')<>'APPROVED') or
   (m is not null and (m->>'is_active')::boolean is not true) then return jsonb_build_object('error','ACCOUNT_INACTIVE','status',403); end if;
 return jsonb_build_object('userId',p_user,'reader',r,'author',a,'admin',m);
end $$;

create or replace function launch_recovery.virtual_account_view(p_kind text,p_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('kind',v.kind,'id',v.profile_id,'email',v.login_email,'revision',v.revision::text,
   'deletedAt',v.deleted_at,'authSyncPending',v.auth_sync_pending,
   'displayName',case when v.kind='author' then a.pen_name else r.nickname end,
   'bio',case when v.kind='author' then coalesce(a.bio,'') else '' end,
   'status',case when v.kind='author' then a.status::text else r.status::text end,
   'works',case when v.kind='author' then (select count(*) from public.works w where w.author_id::text=v.profile_id) else 0 end)
 from launch_recovery.virtual_accounts v left join public.authors a on v.kind='author' and a.id::text=v.profile_id
 left join public.readers r on v.kind='reader' and r.id::text=v.profile_id
 where v.kind=p_kind and v.profile_id=p_id
$$;

create or replace function public.manage_virtual_account(p_user uuid,p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare who jsonb; v launch_recovery.virtual_accounts; before_value jsonb; after_value jsonb;
 k text:=p_data->>'kind'; pid text:=p_data->>'id'; expected text:=p_data->>'revision';
 reason text:=btrim(p_data->>'reason'); name text:=btrim(p_data->>'displayName'); profile_bio text:=p_data->>'bio'; target_status text;
begin
 who:=public.launch_account_actor(p_user);
 if who ? 'error' then return who; end if;
 if coalesce(who->'admin'->>'role','')<>'SUPER_ADMIN' then return jsonb_build_object('error','ADMIN_FORBIDDEN','status',403); end if;
 if p_action='list' then return jsonb_build_object('accounts',coalesce((select jsonb_agg(launch_recovery.virtual_account_view(x.kind,x.profile_id) order by x.kind,x.profile_id::bigint) from launch_recovery.virtual_accounts x),'[]'::jsonb)); end if;
 if p_action='audit' then return jsonb_build_object('events',coalesce((select jsonb_agg(to_jsonb(x)) from
   (select e.kind,e.profile_id,e.action,e.reason,e.before_value,e.after_value,e.created_at from launch_recovery.account_audit e order by e.created_at desc limit 100) x),'[]'::jsonb)); end if;
 if p_action not in ('update','suspend','restore','delete','sync','sync-complete') or
   k not in ('author','reader') or pid is null or expected is null then return jsonb_build_object('error','INVALID_ACCOUNT_REQUEST','status',400); end if;
 select * into v from launch_recovery.virtual_accounts where kind=k and profile_id=pid for update;
 if not found then return jsonb_build_object('error','VIRTUAL_ACCOUNT_NOT_FOUND','status',404); end if;
 if v.auth_user_id=p_user or exists(select 1 from public.admin_users where auth_user_id=v.auth_user_id) then
   return jsonb_build_object('error','PROTECTED_ACCOUNT','status',403); end if;
 if expected<>v.revision::text then return jsonb_build_object('error','CONFLICT','status',409); end if;
 if p_action='sync-complete' then
   update launch_recovery.virtual_accounts set auth_sync_pending=false where kind=k and profile_id=pid;
   return jsonb_build_object('account',launch_recovery.virtual_account_view(k,pid));
 end if;
 if p_action='sync' then return jsonb_build_object('authUserId',v.auth_user_id,'ban',v.desired_ban,'account',launch_recovery.virtual_account_view(k,pid)); end if;
 if v.auth_sync_pending then return jsonb_build_object('error','AUTH_SYNC_REQUIRED','status',409); end if;
 if reason is null or length(reason)<3 or length(reason)>500 then return jsonb_build_object('error','REASON_REQUIRED','status',400); end if;
 if (p_action='update' and exists(select 1 from jsonb_object_keys(p_data) f where f not in ('kind','id','revision','reason','displayName','bio'))) or
   (p_action<>'update' and exists(select 1 from jsonb_object_keys(p_data) f where f not in ('kind','id','revision','reason'))) then
   return jsonb_build_object('error','INVALID_ACCOUNT_REQUEST','status',400); end if;
 before_value:=launch_recovery.virtual_account_view(k,pid);
 if v.deleted_at is not null and p_action<>'restore' then return jsonb_build_object('error','ACCOUNT_DELETED','status',409); end if;
 if p_action='update' then
   if name is null or length(name) not between 2 and 40 or name ~ '[<>[:cntrl:]]' or profile_bio is null or length(profile_bio)>2000 then
     return jsonb_build_object('error','INVALID_PROFILE','status',400); end if;
   if k='author' then update public.authors set pen_name=name,bio=profile_bio where id::text=pid and auth_user_id=v.auth_user_id;
   else update public.readers set nickname=name where id::text=pid and auth_user_id=v.auth_user_id; end if;
   if not found then raise exception 'Identity mapping changed'; end if;
 else
   target_status:=case when p_action in ('suspend','delete') then 'SUSPENDED'
     when v.deleted_at is not null then coalesce(v.previous_status,case when k='author' then 'APPROVED' else 'ACTIVE' end)
     else case when k='author' then 'APPROVED' else 'ACTIVE' end end;
   if k='author' then update public.authors set status=target_status where id::text=pid and auth_user_id=v.auth_user_id;
   else update public.readers set status=target_status where id::text=pid and auth_user_id=v.auth_user_id; end if;
   if not found then raise exception 'Identity mapping changed'; end if;
   update launch_recovery.virtual_accounts set auth_sync_pending=true,desired_ban=(target_status='SUSPENDED'),
     deleted_at=case when p_action='delete' then now() else null end,
     previous_status=case when p_action='delete' then before_value->>'status' else previous_status end where kind=k and profile_id=pid;
 end if;
 update launch_recovery.virtual_accounts set revision=revision+1,updated_at=now() where kind=k and profile_id=pid returning * into v;
 after_value:=launch_recovery.virtual_account_view(k,pid);
 insert into launch_recovery.account_audit(actor_id,kind,profile_id,action,reason,before_value,after_value)
   values(p_user,k,pid,p_action,reason,before_value,after_value);
 return jsonb_build_object('account',after_value,'authUserId',v.auth_user_id,'ban',v.desired_ban);
end $$;

create or replace function launch_recovery.account_audit_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Account identity and audit records are immutable'; end $$;
drop trigger if exists account_audit_immutable on launch_recovery.account_audit;
create trigger account_audit_immutable before update or delete on launch_recovery.account_audit for each row execute function launch_recovery.account_audit_immutable();
drop trigger if exists account_links_immutable on launch_recovery.account_links;
create trigger account_links_immutable before update or delete on launch_recovery.account_links for each row execute function launch_recovery.account_audit_immutable();
revoke all on all functions in schema launch_recovery from public,anon,authenticated,service_role;
revoke all on function public.launch_accounts_ready(),public.launch_account_actor(uuid),public.manage_virtual_account(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.launch_accounts_ready(),public.launch_account_actor(uuid),public.manage_virtual_account(uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
