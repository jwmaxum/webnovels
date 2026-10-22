-- Stage 35: private, encrypted provider drafts. No provider is enabled by this migration.
begin;
set local lock_timeout='5s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
 or not exists(select 1 from authoring.migrations where version='authoring-004') then
  raise exception 'Reviewed onboarding foundation required';
 end if;
end $$;
create table if not exists authoring.provider_settings (
 provider text not null check(provider in ('TOSS','PASS')),
 mode text not null check(mode in ('TEST','LIVE')), primary key(provider,mode),
 revision bigint not null default 0 check(revision>=0), envelope jsonb,
 configured_fields jsonb not null default '[]', complete boolean not null default false,
 enabled boolean not null default false, review_ref text, reviewed_revision bigint,
 updated_by uuid references auth.users(id), updated_at timestamptz not null default now(),
 check(jsonb_typeof(configured_fields)='array'),
 check(not enabled or (complete and envelope is not null and nullif(review_ref,'') is not null and reviewed_revision is not null and reviewed_revision=revision))
);
create table if not exists authoring.provider_settings_audit (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references auth.users(id),
 provider text not null, mode text not null, action text not null check(action in ('SAVE','CLEAR')),
 revision bigint not null, created_at timestamptz not null default now()
);
create table if not exists authoring.provider_settings_limits (
 auth_user_id uuid primary key references auth.users(id), window_start timestamptz not null,
 attempts integer not null check(attempts between 1 and 5)
);
-- Deliberately no direct API table/sequence access, including service_role. The service
-- invokes only the reviewed SECURITY DEFINER RPCs below. Automatic grants are not used.
alter table authoring.provider_settings enable row level security;
alter table authoring.provider_settings_audit enable row level security;
alter table authoring.provider_settings_limits enable row level security;
revoke all on authoring.provider_settings,authoring.provider_settings_audit,authoring.provider_settings_limits from public,anon,authenticated,service_role;
insert into authoring.provider_settings(provider,mode)
 select p,m from unnest(array['TOSS','PASS']) p cross join unnest(array['TEST','LIVE']) m on conflict do nothing;

create or replace function public.manage_provider_settings(p_user uuid,p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target authoring.provider_settings; provider_name text:=p_data->>'provider'; run_mode text:=p_data->>'mode';
 expected text:=p_data->>'revision'; allowed text[]; field_names text[]; rows jsonb; hits integer;
begin
 if (select count(*) from public.admin_users a join auth.users u on u.id=a.auth_user_id
  where a.auth_user_id=p_user and a.is_active and a.role='SUPER_ADMIN' and u.email_confirmed_at is not null
  and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())
  and nullif(to_jsonb(u)->>'deleted_at','') is null)<>1 then
  return jsonb_build_object('error','ADMIN_FORBIDDEN','status',403);
 end if;
 if p_action='list' then
  select jsonb_agg(jsonb_build_object('provider',provider,'mode',mode,'revision',revision::text,
   'configuredFields',configured_fields,'complete',complete,'enabled',enabled,
   'updatedAt',case when revision>0 then updated_at end) order by provider,mode) into rows from authoring.provider_settings;
  return jsonb_build_object('items',rows);
 end if;
 if p_action='attempt' then
  insert into authoring.provider_settings_limits(auth_user_id,window_start,attempts) values(p_user,now(),1)
  on conflict(auth_user_id) do update set
   window_start=case when authoring.provider_settings_limits.window_start<=now()-interval '1 minute' then now() else authoring.provider_settings_limits.window_start end,
   attempts=case when authoring.provider_settings_limits.window_start<=now()-interval '1 minute' then 1 else authoring.provider_settings_limits.attempts+1 end
  where authoring.provider_settings_limits.window_start<=now()-interval '1 minute' or authoring.provider_settings_limits.attempts<5
  returning attempts into hits;
  if hits is null then return jsonb_build_object('error','RATE_LIMITED','status',429);end if;
  return jsonb_build_object('allowed',true);
 end if;
 if p_action not in ('get','save','clear') or provider_name not in ('TOSS','PASS') or run_mode not in ('TEST','LIVE')
 or provider_name is null or run_mode is null or jsonb_typeof(p_data)<>'object' then
  return jsonb_build_object('error','INVALID_PROVIDER_SETTINGS','status',400);
 end if;
 select * into target from authoring.provider_settings where provider=provider_name and mode=run_mode for update;
 if p_action='get' then return jsonb_build_object('revision',target.revision::text,'envelope',target.envelope);end if;
 if expected is null or expected!~'^(0|[1-9][0-9]{0,17})$' or expected::bigint<>target.revision then
  return jsonb_build_object('error','CONFLICT','status',409);
 end if;
 if p_action='save' then
  allowed:=case provider_name when 'TOSS' then array['clientKey','secretKey','merchantId'] else array['storeId','channelKey','apiSecret','pgProvider','identifierType','hmacKey','keyVersion'] end;
  if jsonb_typeof(p_data->'configuredFields') is distinct from 'array' or jsonb_typeof(p_data->'complete') is distinct from 'boolean'
   or jsonb_typeof(p_data->'envelope') is distinct from 'object' then return jsonb_build_object('error','INVALID_PROVIDER_SETTINGS','status',400);end if;
  select array_agg(x) into field_names from jsonb_array_elements_text(p_data->'configuredFields') x;
  field_names:=coalesce(field_names,'{}');
  if not field_names<@allowed or cardinality(field_names)<>(select count(distinct x) from unnest(field_names) x)
   or (p_data->>'complete')::boolean is distinct from (field_names @> allowed)
   or (p_data->'envelope'->>'version') is distinct from '1'
   or coalesce(p_data->'envelope'->>'keyVersion','')!~'^[A-Za-z0-9_-]{1,32}$'
   or coalesce(p_data->'envelope'->>'iv','')!~'^[A-Za-z0-9+/]{16}$'
   or coalesce(p_data->'envelope'->>'ciphertext','')!~'^[A-Za-z0-9+/]+={0,2}$'
   or length(coalesce(p_data->'envelope'->>'ciphertext','')) not between 20 and 18002
   or exists(select 1 from jsonb_object_keys(p_data->'envelope') k where k not in ('version','keyVersion','iv','ciphertext')) then
   return jsonb_build_object('error','INVALID_PROVIDER_SETTINGS','status',400);
  end if;
  update authoring.provider_settings set envelope=p_data->'envelope',configured_fields=p_data->'configuredFields',
   complete=(p_data->>'complete')::boolean,revision=revision+1,enabled=false,review_ref=null,reviewed_revision=null,updated_by=p_user,updated_at=now()
   where provider=provider_name and mode=run_mode returning * into target;
 else
  update authoring.provider_settings set envelope=null,configured_fields='[]',complete=false,revision=revision+1,
   enabled=false,review_ref=null,reviewed_revision=null,updated_by=p_user,updated_at=now()
   where provider=provider_name and mode=run_mode returning * into target;
 end if;
 insert into authoring.provider_settings_audit(actor_id,provider,mode,action,revision)
 values(p_user,provider_name,run_mode,upper(p_action),target.revision);
 return jsonb_build_object('saved',true,'provider',provider_name,'mode',run_mode,'revision',target.revision::text,
  'configuredFields',target.configured_fields,'complete',target.complete,'enabled',false);
end $$;

create or replace function public.provider_runtime_config(p_provider text,p_mode text)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('enabled',true,'envelope',envelope,'revision',revision::text)
  from authoring.provider_settings where provider=p_provider and mode=p_mode and enabled and complete
  and nullif(review_ref,'') is not null and reviewed_revision=revision),jsonb_build_object('enabled',false));
$$;
revoke all on function public.manage_provider_settings(uuid,text,jsonb),public.provider_runtime_config(text,text) from public,anon,authenticated;
grant execute on function public.manage_provider_settings(uuid,text,jsonb),public.provider_runtime_config(text,text) to service_role;
insert into authoring.migrations(version) values('authoring-025') on conflict do nothing;
notify pgrst,'reload schema';
commit;
