-- Reviewed deployment only. Apply before P0 lockdown; never enables the API.
begin;
do $$ begin
  if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
    or not exists(select 1 from authoring.migrations where version='authoring-003') then
    raise exception 'Reviewed foundation and identity mapping required';
  end if;
end $$;

-- Profile creation must occur after confirmation, not from untrusted signup metadata.
drop trigger if exists on_auth_user_created on auth.users;

create table if not exists authoring.signup_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started timestamptz not null, attempts integer not null
);
alter table authoring.signup_attempts enable row level security;
revoke all on authoring.signup_attempts from public,anon,authenticated,service_role;
create or replace function public.consume_authoring_signup_attempt(p_user_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare total integer; stamp timestamptz := clock_timestamp();
begin
  insert into authoring.signup_attempts(user_id,window_started,attempts) values(p_user_id,stamp,1)
  on conflict(user_id) do update set
    attempts=case when authoring.signup_attempts.window_started <= stamp-interval '60 seconds' then 1 else least(authoring.signup_attempts.attempts+1,1000000) end,
    window_started=case when authoring.signup_attempts.window_started <= stamp-interval '60 seconds' then stamp else authoring.signup_attempts.window_started end
  returning attempts into total;
  return total<=5;
end $$;
revoke all on function public.consume_authoring_signup_attempt(uuid) from public,anon,authenticated;
grant execute on function public.consume_authoring_signup_attempt(uuid) to service_role;

create or replace function public.complete_authoring_signup(p_user_id uuid, p_kind text, p_display_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  account auth.users; target_table text; profile_id text; profile_status text;
  t text; collision boolean; columns_sql text; values_sql text; id_type text;
begin
  if p_kind is null or p_kind not in ('reader','author') or p_display_name is null
    or length(btrim(p_display_name)) not between 2 and 40 or p_display_name ~ '[[:cntrl:]<>]' then
    raise exception 'Invalid signup fields' using errcode='22023';
  end if;
  -- Serializes retries, including attempts to create a different profile for the same user.
  select * into account from auth.users where id=p_user_id for update;
  if not found or account.email_confirmed_at is null or account.email is null
    or account.is_anonymous is true or account.banned_until > now() then
    raise exception 'Confirmed account required' using errcode='42501';
  end if;
  if exists(select 1 from public.readers where auth_user_id=p_user_id and status is distinct from 'ACTIVE')
    or exists(select 1 from public.authors where auth_user_id=p_user_id and status is distinct from 'APPROVED')
    or exists(select 1 from public.admin_users where auth_user_id=p_user_id and is_active is distinct from true) then
    raise exception 'Inactive account' using errcode='42501';
  end if;
  target_table := case p_kind when 'author' then 'authors' else 'readers' end;
  execute format('select id::text,status::text from public.%I where auth_user_id=$1',target_table)
    into profile_id,profile_status using p_user_id;
  if profile_id is not null then return jsonb_build_object('created',false); end if;
  -- Email equality is NOT evidence to claim an old profile. Operator linking is separate.
  foreach t in array array['readers','authors','admin_users'] loop
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='email') then
      execute format('select exists(select 1 from public.%I where lower(email)=lower($1) and auth_user_id is distinct from $2)',t)
        into collision using account.email,p_user_id;
      if collision then raise exception 'Legacy identity requires verified linking' using errcode='23505'; end if;
    end if;
  end loop;
  columns_sql := 'auth_user_id,username,status,' || case p_kind when 'author' then 'pen_name' else 'nickname' end;
  values_sql := '$1,$2,$3,$4';
  select data_type into id_type from information_schema.columns where table_schema='public' and table_name=target_table and column_name='id';
  if id_type='uuid' then columns_sql:=columns_sql||',id'; values_sql:=values_sql||',$1'; end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name=target_table and column_name='email') then
    columns_sql:=columns_sql||',email'; values_sql:=values_sql||',$5';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name=target_table and column_name='password_hash') then
    -- Legacy required column: random non-credential, never a user password or reusable default.
    columns_sql:=columns_sql||',password_hash'; values_sql:=values_sql||',$6';
  end if;
  execute format('insert into public.%I (%s) values (%s)',target_table,columns_sql,values_sql)
    using p_user_id,'auth_'||replace(p_user_id::text,'-',''),
      case p_kind when 'author' then 'APPROVED' else 'ACTIVE' end,btrim(p_display_name),account.email,
      'AUTH_ONLY_DISABLED_'||gen_random_uuid()::text;
  return jsonb_build_object('created',true);
end $$;
revoke all on function public.complete_authoring_signup(uuid,text,text) from public,anon,authenticated;
grant execute on function public.complete_authoring_signup(uuid,text,text) to service_role;
create or replace function public.authoring_signup_ready() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from authoring.migrations where version='authoring-004');
$$;
revoke all on function public.authoring_signup_ready() from public,anon,authenticated;
grant execute on function public.authoring_signup_ready() to service_role;
insert into authoring.migrations(version) values('authoring-004') on conflict do nothing;
commit;
