-- OP-06 preparation only. Internal TEST evidence is not an advertising provider receipt.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if current_setting('webnovels.ad_rewards_test_apply_verified',true) is distinct from 'true'
 or to_regprocedure('commerce.op05_points_base(uuid,text,jsonb)') is null
 or to_regprocedure('public.op05_topups(uuid,text,jsonb)') is null
 or to_regclass('commerce.op06_config') is not null then raise exception 'Reviewed OP-06 TEST prerequisites required';end if;
 if (select md5(replace(prosrc,E'\r','')) from pg_proc where oid='commerce.op05_points_base(uuid,text,jsonb)'::regprocedure) is distinct from '59fc55122924f6d8fee6ef7b4d7d364a'
 or (select md5(replace(prosrc,E'\r','')) from pg_proc where oid='commerce.op04_access(uuid,bigint,integer,integer)'::regprocedure) is distinct from 'b53da78fa5a83a3634f4d3eac7edd5de'
 or (select md5(replace(prosrc,E'\r','')) from pg_proc where oid='public.op04_points_test(uuid,text,jsonb)'::regprocedure) is distinct from '3ab5cb01d59a7a8fb33c2b514692db44' then raise exception 'Unreviewed OP-04/05 function bodies';end if;
end $$;

create table commerce.op06_policies(
 id uuid primary key default gen_random_uuid(),ad_enabled boolean not null,campaign_enabled boolean not null,
 reward_hours integer not null check(reward_hours between 1 and 168),session_minutes integer not null check(session_minutes between 1 and 30),grace_minutes integer not null check(grace_minutes between 0 and 60),daily_limit integer not null check(daily_limit between 1 and 100),
 campaign_title text not null check(length(campaign_title)<=100),campaign_starts_at timestamptz,campaign_ends_at timestamptz,
 actor_id uuid references auth.users(id),reason text not null check(length(btrim(reason)) between 3 and 500),created_at timestamptz not null default now(),
 check((campaign_starts_at is null and campaign_ends_at is null) or (campaign_starts_at is not null and campaign_ends_at is not null and campaign_ends_at>campaign_starts_at)),
 check(not campaign_enabled or (length(btrim(campaign_title)) between 3 and 100 and campaign_starts_at is not null and campaign_ends_at is not null))
);
create table commerce.op06_config(singleton boolean primary key default true check(singleton),revision bigint not null default 0 check(revision>=0),policy_id uuid not null references commerce.op06_policies(id));
insert into commerce.op06_policies(id,ad_enabled,campaign_enabled,reward_hours,session_minutes,grace_minutes,daily_limit,campaign_title,reason)
 values('00000000-0000-4000-8000-000000000006',false,false,24,5,10,20,'','비활성 TEST 기본 정책');
insert into commerce.op06_config values(true,0,'00000000-0000-4000-8000-000000000006');
create table commerce.op06_sessions(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),episode_id bigint not null references public.episodes(id),work_id bigint not null references public.works(id),publication_id uuid not null references authoring.publication_versions(id),
 kind text not null check(kind in ('AD_REWARD','CAMPAIGN_FREE')),policy_id uuid not null references commerce.op06_policies(id),provider text not null check(provider in ('NONE','INTERNAL_TEST')),channel_id text,binding text,nonce text not null check(nonce~'^[a-f0-9]{64}$'),
 status text not null default 'WAITING_EVIDENCE' check(status in ('WAITING_EVIDENCE','CLOSED_PENDING','GRANTED','NO_FILL','REJECTED','EXPIRED')),
 created_at timestamptz not null default now(),expires_at timestamptz not null,accept_until timestamptz not null,closed_at timestamptz,
 check(expires_at>created_at and expires_at<=created_at+interval '30 minutes' and accept_until>=expires_at and accept_until<=expires_at+interval '60 minutes'),check(closed_at is null or closed_at>=created_at),
 check((kind='AD_REWARD' and provider='INTERNAL_TEST' and channel_id is not null and binding is not null and channel_id~'^[A-Za-z0-9_-]{1,80}$' and binding~'^[a-f0-9]{64}$') or (kind='CAMPAIGN_FREE' and provider='NONE' and channel_id is null and binding is null))
);
create index op06_sessions_user_recent on commerce.op06_sessions(user_id,created_at desc,id);
create unique index op06_one_pending_ad on commerce.op06_sessions(user_id,episode_id) where kind='AD_REWARD' and status in ('WAITING_EVIDENCE','CLOSED_PENDING');
create unique index op06_one_campaign_claim on commerce.op06_sessions(user_id,episode_id,policy_id) where kind='CAMPAIGN_FREE';
create table commerce.op06_events(
 id uuid primary key default gen_random_uuid(),provider text not null check(provider='INTERNAL_TEST'),channel_id text not null,event_id text not null check(event_id~'^[A-Za-z0-9_-]{1,128}$'),session_id uuid not null references commerce.op06_sessions(id),
 outcome text not null check(outcome in ('GRANTED','NO_FILL','REJECTED')),completed_at timestamptz not null,fingerprint text not null check(fingerprint~'^[a-f0-9]{64}$'),body_digest text not null check(body_digest~'^[a-f0-9]{64}$'),created_at timestamptz not null default now(),
 unique(provider,channel_id,event_id)
);
create table commerce.op06_grants(
 id uuid primary key default gen_random_uuid(),session_id uuid not null unique references commerce.op06_sessions(id),user_id uuid not null references auth.users(id),episode_id bigint not null references public.episodes(id),
 kind text not null check(kind in ('AD_REWARD','CAMPAIGN_FREE')),event_id uuid unique references commerce.op06_events(id),granted_at timestamptz not null,expires_at timestamptz not null,
 check(expires_at>granted_at),check((kind='AD_REWARD' and event_id is not null) or (kind='CAMPAIGN_FREE' and event_id is null))
);
create index op06_grants_active_lookup on commerce.op06_grants(user_id,episode_id,expires_at desc);
create table commerce.op06_receipts(actor_id uuid not null references auth.users(id),request_id uuid not null,action text not null,fingerprint text not null check(fingerprint~'^[a-f0-9]{64}$'),session_id uuid references commerce.op06_sessions(id),result jsonb not null,created_at timestamptz not null default now(),primary key(actor_id,request_id));
create table commerce.op06_audit(id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),action text not null,detail jsonb not null,created_at timestamptz not null default now());

create function commerce.op06_policy(p_id uuid) returns jsonb language sql stable set search_path='' set timezone='UTC' as $$
 select jsonb_build_object('id',id,'adEnabled',ad_enabled,'campaignEnabled',campaign_enabled,'rewardHours',reward_hours,'sessionMinutes',session_minutes,'graceMinutes',grace_minutes,'dailyLimit',daily_limit,'campaignTitle',campaign_title,'campaignStartsAt',campaign_starts_at,'campaignEndsAt',campaign_ends_at) from commerce.op06_policies where id=p_id
$$;
create function commerce.op06_state() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('revision',revision::text,'policy',commerce.op06_policy(policy_id),'providerReady',false) from commerce.op06_config where singleton
$$;
create function commerce.op06_session(p_id uuid,p_admin boolean default false) returns jsonb language sql stable set search_path='' set timezone='UTC' as $$
 select jsonb_build_object('id',s.id,'episodeId',s.episode_id::text,'kind',s.kind,'status',case when s.status in ('WAITING_EVIDENCE','CLOSED_PENDING') and s.expires_at<=now() then 'EXPIRED' else s.status end,'createdAt',s.created_at,'expiresAt',s.expires_at,'acceptUntil',s.accept_until,'closedAt',s.closed_at,'rewardHours',p.reward_hours,'policyVersion',s.policy_id,
 'grant',case when g.id is null then null else jsonb_build_object('id',g.id,'kind',g.kind,'expiresAt',g.expires_at) end)
 ||case when p_admin then jsonb_build_object('userId',s.user_id) else '{}'::jsonb end
 from commerce.op06_sessions s join commerce.op06_policies p on p.id=s.policy_id left join commerce.op06_grants g on g.session_id=s.id where s.id=p_id
$$;
create function commerce.op06_reward_access(p_user uuid,p_episode bigint,p_kind text default null) returns jsonb language sql stable set search_path='' set timezone='UTC' as $$
 select jsonb_build_object('kind',kind,'grantId',id,'expiresAt',expires_at) from commerce.op06_grants where user_id=p_user and episode_id=p_episode and expires_at>now() and (p_kind is null or kind=p_kind) order by case kind when 'AD_REWARD' then 1 else 2 end,expires_at desc,id limit 1
$$;
create or replace function commerce.op04_access(p_user uuid,p_episode bigint,p_number integer,p_points integer) returns text language sql stable set search_path='' as $$
 select case when p_number<=2 then 'MEMBER_FREE' when exists(select 1 from commerce.op04_entitlements r where r.user_id=p_user and r.episode_id=p_episode and r.revoked_at is null and (r.expires_at is null or r.expires_at>now())) then 'OWNED' when p_points=0 then 'MEMBER_FREE'
 when exists(select 1 from commerce.op06_grants g where g.user_id=p_user and g.episode_id=p_episode and g.kind='AD_REWARD' and g.expires_at>now()) then 'AD_REWARD'
 when exists(select 1 from commerce.op06_grants g where g.user_id=p_user and g.episode_id=p_episode and g.kind='CAMPAIGN_FREE' and g.expires_at>now()) then 'CAMPAIGN_FREE' else 'LOCKED' end
$$;
create or replace function public.op04_points_test(p_user uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare r jsonb;t bigint;h bigint;meta jsonb;current_access text;ep record;begin
 begin r:=commerce.op05_points_base(p_user,p_action,p_data);
 exception when raise_exception then if sqlerrm='OP05_AVAILABLE_POINTS_REQUIRED' then return jsonb_build_object('error','INSUFFICIENT_POINTS','status',409);else raise;end if;end;
 if r?'error' then return r;end if;
 if p_action in ('wallet','quote','purchase') then
  perform pg_advisory_xact_lock(hashtextextended('op04-wallet:'||p_user,0));
  select coalesce((select balance_points from commerce.op04_wallets where user_id=p_user),0),commerce.op05_reserved(p_user) into t,h;
  r:=r||jsonb_build_object('balancePoints',t-h,'totalPoints',t,'reservedPoints',h);
 end if;
 if p_action='episodes' then
  select r||jsonb_build_object('items',coalesce(jsonb_agg(case when x->>'access' in ('AD_REWARD','CAMPAIGN_FREE') then x||jsonb_build_object('rewardAccess',commerce.op06_reward_access(p_user,(x->>'id')::bigint,x->>'access')) else x end order by ord),'[]'::jsonb)) into r from jsonb_array_elements(r->'items') with ordinality j(x,ord);
 elsif p_action='quote' and r#>>'{quote,access}' in ('AD_REWARD','CAMPAIGN_FREE') then
  r:=jsonb_set(r,'{quote,rewardAccess}',commerce.op06_reward_access(p_user,(r#>>'{quote,episodeId}')::bigint,r#>>'{quote,access}'));
 elsif p_action='purchase' and r->>'access' in ('AD_REWARD','CAMPAIGN_FREE') then
  select * into ep from commerce.op04_episode_rows() where episode_id=(r->>'episodeId')::bigint;
  if not found then return jsonb_build_object('error','CONTENT_NOT_AVAILABLE','status',404);end if;
  current_access:=commerce.op04_access(p_user,ep.episode_id,ep.episode_number,(commerce.op04_price(ep.episode_id)).points);
  if current_access='LOCKED' then return jsonb_build_object('error','REWARD_EXPIRED','status',409);end if;
  r:=r||jsonb_build_object('access',current_access);
  if current_access in ('AD_REWARD','CAMPAIGN_FREE') then r:=r||jsonb_build_object('rewardAccess',commerce.op06_reward_access(p_user,ep.episode_id,current_access));
  elsif current_access='OWNED' then r:=r||jsonb_build_object('entitlementId',(select id from commerce.op04_entitlements where user_id=p_user and episode_id=ep.episode_id and revoked_at is null and (expires_at is null or expires_at>now())));end if;
 end if;return r;
end $$;

create function public.op06_rewards(p_user uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
#variable_conflict use_variable
declare base jsonb:='{"mode":"TEST","provenance":"LOCAL_SIMULATED","provider":"NONE"}';fallback jsonb:='{"kind":"POINTS","chargePath":"/charging-test","amountKrw":10000,"points":10000,"defaultEpisodePoints":100}';adm boolean:=left(p_action,6)='admin-';act text:=case when left(p_action,6)='admin-' then substr(p_action,7) else p_action end;
 fields text[];cfg commerce.op06_config;p commerce.op06_policies;s commerce.op06_sessions;rec commerce.op06_receipts;req uuid;fp text;eid bigint;ep record;access_kind text;ad_ok boolean:=false;campaign_ok boolean:=false;result jsonb;new_id uuid;off integer:=0;total_no bigint;items jsonb;filter text;start_time timestamptz;end_time timestamptz;
begin
 if not commerce.op05_actor(p_user,adm) then return jsonb_build_object('error',case when adm then 'ADMIN_FORBIDDEN' else 'READER_REQUIRED' end,'status',403);end if;
 fields:=case act when 'state' then case when adm then array[]::text[] end when 'policy' then case when adm then array['revision','adEnabled','campaignEnabled','rewardHours','sessionMinutes','graceMinutes','dailyLimit','campaignTitle','campaignStartsAt','campaignEndsAt','reason','requestId'] end
 when 'sessions' then case when adm then array['status','offset'] end when 'options' then case when not adm then array['episodeId','provider','channelId','binding'] end when 'start' then case when not adm then array['episodeId','policyVersion','kind','consent','requestId','provider','channelId','binding'] end when 'status' then case when not adm then array['sessionId'] end when 'close' then case when not adm then array['sessionId','requestId'] end end;
 if fields is null or jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text)>16384 or exists(select 1 from jsonb_object_keys(p_data)k where not k=any(fields)) then return jsonb_build_object('error','INVALID_REWARD_REQUEST','status',400);end if;
 if act in ('policy','start','close') then
  if coalesce(p_data->>'requestId','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return jsonb_build_object('error','INVALID_REWARD_REQUEST','status',400);end if;
  req:=(p_data->>'requestId')::uuid;fp:=encode(sha256(convert_to(p_action||':'||(p_data-array['provider','channelId','binding'])::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('op06-request:'||p_user||':'||req,0));
  select * into rec from commerce.op06_receipts where actor_id=p_user and request_id=req;
  if found then
   if rec.action<>p_action or rec.fingerprint<>fp then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT','status',409);end if;
   if rec.session_id is not null then return base||jsonb_build_object('provider',case when (select kind from commerce.op06_sessions where id=rec.session_id)='AD_REWARD' then 'INTERNAL_TEST' else 'NONE' end,'session',commerce.op06_session(rec.session_id),'replayed',true)||case when act='start' and (select kind from commerce.op06_sessions where id=rec.session_id)='AD_REWARD' then jsonb_build_object('challenge',(select jsonb_build_object('protocol','OP06_INTERNAL_TEST_V1','sessionId',id,'nonce',nonce,'channelId',channel_id,'policyVersion',policy_id) from commerce.op06_sessions where id=rec.session_id)) else '{}'::jsonb end;end if;
   return rec.result||jsonb_build_object('replayed',true);
  end if;
 end if;
 if act='policy' then select * into cfg from commerce.op06_config where singleton for update;else select * into cfg from commerce.op06_config where singleton for share;end if;select * into strict p from commerce.op06_policies where id=cfg.policy_id;
 if act='state' then return base||commerce.op06_state();end if;
 if act='start' then
  if jsonb_typeof(p_data->'policyVersion') is distinct from 'string' or coalesce(p_data->>'policyVersion','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return jsonb_build_object('error','INVALID_REWARD_REQUEST','status',400);end if;
  if (p_data->>'policyVersion')::uuid<>cfg.policy_id then return jsonb_build_object('error','REWARD_POLICY_CHANGED','status',409);end if;
 end if;
 if act='policy' then
  if jsonb_typeof(p_data->'revision') is distinct from 'string' or coalesce(p_data->>'revision','')!~'^(0|[1-9][0-9]{0,18})$' or (p_data->>'revision')::numeric>9223372036854775807
   or jsonb_typeof(p_data->'adEnabled') is distinct from 'boolean' or jsonb_typeof(p_data->'campaignEnabled') is distinct from 'boolean'
   or jsonb_typeof(p_data->'campaignTitle') is distinct from 'string' or length(p_data->>'campaignTitle')>100
   or jsonb_typeof(p_data->'reason') is distinct from 'string' or length(btrim(p_data->>'reason')) not between 3 and 500 then return jsonb_build_object('error','INVALID_REWARD_REQUEST','status',400);end if;
  foreach filter in array array['rewardHours','sessionMinutes','graceMinutes','dailyLimit'] loop if jsonb_typeof(p_data->filter) is distinct from 'number' or coalesce(p_data->>filter,'')!~'^(0|[1-9][0-9]{0,2})$' then return jsonb_build_object('error','INVALID_REWARD_REQUEST','status',400);end if;end loop;
  if (p_data->>'rewardHours')::integer not between 1 and 168 or (p_data->>'sessionMinutes')::integer not between 1 and 30 or (p_data->>'graceMinutes')::integer not between 0 and 60 or (p_data->>'dailyLimit')::integer not between 1 and 100 then return jsonb_build_object('error','INVALID_REWARD_REQUEST','status',400);end if;
  if p_data->'campaignStartsAt' is distinct from 'null'::jsonb then if jsonb_typeof(p_data->'campaignStartsAt') is distinct from 'string' or p_data->>'campaignStartsAt'!~'^\d{4}-\d{2}-\d{2}T.*Z$' then return jsonb_build_object('error','INVALID_REWARD_REQUEST','status',400);end if;start_time:=(p_data->>'campaignStartsAt')::timestamptz;end if;
  if p_data->'campaignEndsAt' is distinct from 'null'::jsonb then if jsonb_typeof(p_data->'campaignEndsAt') is distinct from 'string' or p_data->>'campaignEndsAt'!~'^\d{4}-\d{2}-\d{2}T.*Z$' then return jsonb_build_object('error','INVALID_REWARD_REQUEST','status',400);end if;end_time:=(p_data->>'campaignEndsAt')::timestamptz;end if;
  if (start_time is null)<>(end_time is null) or end_time<=start_time or ((p_data->>'campaignEnabled')::boolean and (start_time is null or end_time<=now() or length(btrim(p_data->>'campaignTitle'))<3)) then return jsonb_build_object('error','INVALID_REWARD_REQUEST','status',400);end if;
  select * into cfg from commerce.op06_config where singleton for update;if cfg.revision::text<>p_data->>'revision' then return jsonb_build_object('error','REVISION_CONFLICT','status',409);end if;
  insert into commerce.op06_policies(ad_enabled,campaign_enabled,reward_hours,session_minutes,grace_minutes,daily_limit,campaign_title,campaign_starts_at,campaign_ends_at,actor_id,reason) values((p_data->>'adEnabled')::boolean,(p_data->>'campaignEnabled')::boolean,(p_data->>'rewardHours')::integer,(p_data->>'sessionMinutes')::integer,(p_data->>'graceMinutes')::integer,(p_data->>'dailyLimit')::integer,btrim(p_data->>'campaignTitle'),start_time,end_time,p_user,btrim(p_data->>'reason')) returning id into new_id;
  update commerce.op06_config set revision=revision+1,policy_id=new_id where singleton;result:=base||commerce.op06_state()||jsonb_build_object('saved',true,'replayed',false);
 elsif act='sessions' then
  filter:=coalesce(p_data->>'status','ALL');if filter not in ('ALL','WAITING_EVIDENCE','CLOSED_PENDING','GRANTED','NO_FILL','REJECTED','EXPIRED') or p_data?'offset' and (jsonb_typeof(p_data->'offset') is distinct from 'number' or coalesce(p_data->>'offset','')!~'^(0|[1-9][0-9]{0,5})$' or (p_data->>'offset')::integer>100000) then return jsonb_build_object('error','INVALID_REWARD_REQUEST','status',400);end if;off:=coalesce((p_data->>'offset')::integer,0);
  select count(*) into total_no from commerce.op06_sessions where filter='ALL' or commerce.op06_session(id)->>'status'=filter;
  select coalesce(jsonb_agg(commerce.op06_session(id,true) order by created_at desc,id),'[]'::jsonb) into items from (select id,created_at from commerce.op06_sessions where filter='ALL' or commerce.op06_session(id)->>'status'=filter order by created_at desc,id limit 50 offset off)x;
  return base||jsonb_build_object('items',items,'offset',off,'limit',50,'total',total_no,'hasMore',total_no>off+50,'nextOffset',case when total_no>off+50 then off+50 else null end);
 elsif act in ('options','start') then
  if jsonb_typeof(p_data->'episodeId') is distinct from 'string' or coalesce(p_data->>'episodeId','')!~'^[1-9][0-9]{0,18}$' or (p_data->>'episodeId')::numeric>9223372036854775807 then return jsonb_build_object('error','INVALID_REWARD_REQUEST','status',400);end if;eid:=(p_data->>'episodeId')::bigint;
  perform pg_advisory_xact_lock(hashtextextended('op04-wallet:'||p_user,0));perform pg_advisory_xact_lock(hashtextextended('op04-episode:'||p_user||':'||eid,0));
  if act='start' then
   perform 1 from public.works where id=(select work_id from public.episodes where id=eid) for share;perform 1 from authoring.work_state where work_id=(select work_id from public.episodes where id=eid) for share;perform 1 from public.episodes where id=eid for share;perform 1 from authoring.publication_heads where episode_id=eid for share;
  end if;
  select * into ep from commerce.op04_episode_rows() where episode_id=eid;
  if not found then return jsonb_build_object('error','CONTENT_NOT_AVAILABLE','status',404);end if;
  if not exists(select 1 from commerce.op04_works where work_id=ep.work_id and enabled) then return jsonb_build_object('error','TEST_WORK_NOT_FOUND','status',404);end if;
  access_kind:=commerce.op04_access(p_user,eid,ep.episode_number,(commerce.op04_price(eid)).points);
  if coalesce(p_data->>'provider','NONE') not in ('NONE','INTERNAL_TEST') then return jsonb_build_object('error','PROVIDER_NOT_READY','status',503);end if;
  ad_ok:=p.ad_enabled and coalesce(p_data->>'provider','NONE')='INTERNAL_TEST' and coalesce(p_data->>'channelId','')~'^[A-Za-z0-9_-]{1,80}$' and coalesce(p_data->>'binding','')~'^[a-f0-9]{64}$';
  campaign_ok:=p.campaign_enabled and p.campaign_starts_at<=now() and p.campaign_ends_at>now() and not exists(select 1 from commerce.op06_sessions where user_id=p_user and episode_id=eid and policy_id=p.id and kind='CAMPAIGN_FREE');
  if act='options' then return base||jsonb_build_object('episodeId',eid::text,'access',access_kind,'provider',case when ad_ok then 'INTERNAL_TEST' else 'NONE' end,'availability',case when access_kind<>'LOCKED' then 'ALREADY_ACCESSIBLE' when ad_ok then 'INTERNAL_TEST' else 'UNAVAILABLE' end,'adAvailable',ad_ok and access_kind='LOCKED','campaignAvailable',campaign_ok and access_kind='LOCKED','policy',commerce.op06_policy(p.id),'fallback',fallback);end if;
  if p_data->'consent' is distinct from 'true'::jsonb or coalesce(p_data->>'kind','') not in ('AD_REWARD','CAMPAIGN_FREE') then return jsonb_build_object('error','CONSENT_REQUIRED','status',400);end if;
  if access_kind<>'LOCKED' then result:=base||jsonb_build_object('availability','ALREADY_ACCESSIBLE','session',null,'fallback',fallback,'replayed',false);
  elsif (p_data->>'kind'='AD_REWARD' and not ad_ok) or (p_data->>'kind'='CAMPAIGN_FREE' and not campaign_ok) then result:=base||jsonb_build_object('availability','UNAVAILABLE','session',null,'fallback',fallback,'replayed',false);
  else
   perform pg_advisory_xact_lock(hashtextextended('op06-user:'||p_user,0));
   update commerce.op06_sessions set status='EXPIRED' where user_id=p_user and kind='AD_REWARD' and status in ('WAITING_EVIDENCE','CLOSED_PENDING') and accept_until<=now();
   select * into s from commerce.op06_sessions where user_id=p_user and episode_id=eid and kind='AD_REWARD' and status in ('WAITING_EVIDENCE','CLOSED_PENDING') and p_data->>'kind'='AD_REWARD' for update;
   if found and s.policy_id<>p.id then return jsonb_build_object('error','REWARD_SESSION_PENDING','status',409);end if;
   if not found then
    if (select count(*) from commerce.op06_sessions where user_id=p_user and created_at>now()-interval '1 minute')>=5 or (select count(*) from commerce.op06_sessions where user_id=p_user and (created_at at time zone 'Asia/Seoul')::date=(now() at time zone 'Asia/Seoul')::date)>=p.daily_limit then return jsonb_build_object('error','RATE_LIMITED','status',429);end if;
    insert into commerce.op06_sessions(user_id,episode_id,work_id,publication_id,kind,policy_id,provider,channel_id,binding,nonce,expires_at,accept_until)
     values(p_user,eid,ep.work_id,ep.version_id,p_data->>'kind',p.id,case when p_data->>'kind'='AD_REWARD' then 'INTERNAL_TEST' else 'NONE' end,case when p_data->>'kind'='AD_REWARD' then p_data->>'channelId' end,case when p_data->>'kind'='AD_REWARD' then p_data->>'binding' end,encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex'),now()+p.session_minutes*interval '1 minute',now()+(p.session_minutes+p.grace_minutes)*interval '1 minute') returning * into s;
    if s.kind='CAMPAIGN_FREE' then insert into commerce.op06_grants(session_id,user_id,episode_id,kind,granted_at,expires_at) values(s.id,p_user,eid,'CAMPAIGN_FREE',now(),now()+p.reward_hours*interval '1 hour');update commerce.op06_sessions set status='GRANTED' where id=s.id;end if;
   end if;
   result:=base||jsonb_build_object('provider',s.provider,'session',commerce.op06_session(s.id),'replayed',false)||case when s.kind='AD_REWARD' then jsonb_build_object('challenge',jsonb_build_object('protocol','OP06_INTERNAL_TEST_V1','sessionId',s.id,'nonce',s.nonce,'channelId',s.channel_id,'policyVersion',s.policy_id)) else '{}'::jsonb end;
  end if;
 elsif act in ('status','close') then
  if coalesce(p_data->>'sessionId','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return jsonb_build_object('error','INVALID_REWARD_REQUEST','status',400);end if;
  select * into s from commerce.op06_sessions where id=(p_data->>'sessionId')::uuid and user_id=p_user for update;if not found then return jsonb_build_object('error','SESSION_NOT_FOUND','status',404);end if;
  if act='close' and s.status<>'GRANTED' then update commerce.op06_sessions set closed_at=coalesce(closed_at,now()),status=case when status in ('WAITING_EVIDENCE','CLOSED_PENDING') then 'CLOSED_PENDING' else status end where id=s.id;end if;
  result:=base||jsonb_build_object('provider',s.provider,'session',commerce.op06_session(s.id))||case when act='close' then jsonb_build_object('replayed',false) else '{}'::jsonb end;
 else return jsonb_build_object('error','INVALID_REWARD_REQUEST','status',400);end if;
 if req is not null then insert into commerce.op06_receipts(actor_id,request_id,action,fingerprint,session_id,result) values(p_user,req,p_action,fp,s.id,result);insert into commerce.op06_audit(actor_id,action,detail) values(p_user,p_action,jsonb_build_object('requestId',req,'sessionId',s.id));end if;return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then return jsonb_build_object('error','INVALID_REWARD_REQUEST','status',400);
 when unique_violation then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT','status',409);
end $$;

create function public.op06_apply_reward(p_evidence jsonb) returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
#variable_conflict use_variable
declare base jsonb:='{"mode":"TEST","provenance":"LOCAL_SIMULATED","provider":"INTERNAL_TEST"}';s commerce.op06_sessions;p commerce.op06_policies;e commerce.op06_events;fp text;at_time timestamptz;event_key uuid;outcome text;
begin
 if jsonb_typeof(p_evidence) is distinct from 'object' or length(p_evidence::text)>16384 or exists(select 1 from jsonb_object_keys(p_evidence)k where k not in ('protocol','eventId','sessionId','nonce','channelId','outcome','completedAt','reward','provider','binding','bodyDigest'))
 or p_evidence->>'protocol' is distinct from 'OP06_INTERNAL_TEST_V1' or p_evidence->>'provider' is distinct from 'INTERNAL_TEST'
 or coalesce(p_evidence->>'sessionId','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or coalesce(p_evidence->>'eventId','')!~'^[A-Za-z0-9_-]{1,128}$'
 or coalesce(p_evidence->>'nonce','')!~'^[a-f0-9]{64}$' or coalesce(p_evidence->>'binding','')!~'^[a-f0-9]{64}$' or coalesce(p_evidence->>'bodyDigest','')!~'^[a-f0-9]{64}$'
 or coalesce(p_evidence->>'channelId','')!~'^[A-Za-z0-9_-]{1,80}$' or coalesce(p_evidence->>'outcome','') not in ('GRANTED','NO_FILL','REJECTED')
 or exists(select 1 from unnest(array['protocol','eventId','sessionId','nonce','channelId','outcome','completedAt','provider','binding','bodyDigest']) k where jsonb_typeof(p_evidence->k) is distinct from 'string')
 or p_evidence->'reward' is distinct from '{"type":"EPISODE_ACCESS","quantity":1}'::jsonb or jsonb_typeof(p_evidence->'completedAt') is distinct from 'string' or p_evidence->>'completedAt'!~'^\d{4}-\d{2}-\d{2}T.*Z$' then return jsonb_build_object('error','INVALID_REWARD_EVIDENCE','status',400);end if;
 select * into s from commerce.op06_sessions where id=(p_evidence->>'sessionId')::uuid;if not found then return jsonb_build_object('error','SESSION_NOT_FOUND','status',404);end if;
 if not commerce.op05_actor(s.user_id,false) then return jsonb_build_object('error','READER_REQUIRED','status',403);end if;
 perform pg_advisory_xact_lock(hashtextextended('op04-wallet:'||s.user_id,0));perform pg_advisory_xact_lock(hashtextextended('op04-episode:'||s.user_id||':'||s.episode_id,0));
 select * into s from commerce.op06_sessions where id=s.id for update;
 if s.kind<>'AD_REWARD' or s.provider<>p_evidence->>'provider' or s.channel_id<>p_evidence->>'channelId' or s.binding<>p_evidence->>'binding' or s.nonce<>p_evidence->>'nonce' then return jsonb_build_object('error','REWARD_BINDING_MISMATCH','status',409);end if;
 fp:=encode(sha256(convert_to((p_evidence-'bodyDigest')::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('op06-event:'||s.provider||':'||s.channel_id||':'||(p_evidence->>'eventId'),0));
 select * into e from commerce.op06_events where provider=s.provider and channel_id=s.channel_id and event_id=p_evidence->>'eventId';
 if found then if e.fingerprint<>fp then return jsonb_build_object('error','EVENT_CONFLICT','status',409);end if;return base||jsonb_build_object('session',commerce.op06_session(s.id),'replayed',true);end if;
 at_time:=(p_evidence->>'completedAt')::timestamptz;
 if at_time<s.created_at or at_time>s.expires_at or at_time>now()+interval '30 seconds' or now()>=s.accept_until then return jsonb_build_object('error','REWARD_EVIDENCE_EXPIRED','status',409);end if;
 outcome:=p_evidence->>'outcome';
 if s.closed_at is not null and at_time>s.closed_at then outcome:='REJECTED';end if;
 insert into commerce.op06_events(provider,channel_id,event_id,session_id,outcome,completed_at,fingerprint,body_digest) values(s.provider,s.channel_id,p_evidence->>'eventId',s.id,outcome,at_time,fp,p_evidence->>'bodyDigest') returning id into event_key;
 if s.status<>'GRANTED' then
  if outcome='GRANTED' then select * into strict p from commerce.op06_policies where id=s.policy_id;insert into commerce.op06_grants(session_id,user_id,episode_id,kind,event_id,granted_at,expires_at) values(s.id,s.user_id,s.episode_id,'AD_REWARD',event_key,at_time,at_time+p.reward_hours*interval '1 hour');end if;
  update commerce.op06_sessions set status=outcome where id=s.id;
 end if;
 insert into commerce.op06_audit(actor_id,action,detail) values(s.user_id,'verified-internal-test-evidence',jsonb_build_object('sessionId',s.id,'eventId',event_key,'outcome',outcome));
 return base||jsonb_build_object('session',commerce.op06_session(s.id),'replayed',false);
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then return jsonb_build_object('error','INVALID_REWARD_EVIDENCE','status',400);
 when unique_violation then return jsonb_build_object('error','EVENT_CONFLICT','status',409);
end $$;

do $$ declare t text;f record;begin
 foreach t in array array['op06_config','op06_policies','op06_sessions','op06_events','op06_grants','op06_receipts','op06_audit'] loop execute format('alter table commerce.%I enable row level security',t);execute format('revoke all on commerce.%I from public,anon,authenticated,service_role',t);end loop;
 foreach t in array array['op06_policies','op06_events','op06_grants','op06_receipts','op06_audit'] loop execute format('create trigger op06_immutable before update or delete on commerce.%I for each row execute function commerce.op04_immutable()',t);end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='commerce' and p.proname like 'op06_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end $$;
revoke all on function commerce.op04_access(uuid,bigint,integer,integer) from public,anon,authenticated,service_role;
revoke all on function public.op04_points_test(uuid,text,jsonb),public.op06_rewards(uuid,text,jsonb),public.op06_apply_reward(jsonb) from public,anon,authenticated;
grant execute on function public.op04_points_test(uuid,text,jsonb),public.op06_rewards(uuid,text,jsonb),public.op06_apply_reward(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
