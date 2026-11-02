-- OP-10: external TEST acceptance journal. Never updates the OP-07 money ledger.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$begin
 if current_setting('webnovels.payout_provider_test_apply_verified',true) is distinct from 'true'
 or to_regprocedure('public.op07_payouts(uuid,text,jsonb)') is null
 or to_regclass('commerce.op10_settings') is not null then raise exception 'Reviewed OP10 prerequisites required';end if;
end$$;
create table commerce.op10_configs(id uuid primary key default gen_random_uuid(),revision bigint not null unique check(revision>0),merchant_id text not null check(merchant_id~'^[A-Za-z0-9_-]{1,100}$'),envelope jsonb not null check(jsonb_typeof(envelope)='object' and length(envelope::text)<12000),actor_id uuid not null references auth.users(id),created_at timestamptz not null default now());
create table commerce.op10_settings(singleton boolean primary key default true check(singleton),revision bigint not null default 0,config_id uuid references commerce.op10_configs(id));
insert into commerce.op10_settings values(true,0,null);
create table commerce.op10_jobs(
 id uuid primary key,source_id uuid not null unique references commerce.op07_payouts(id),source_revision bigint not null,
 author_id bigint not null references public.authors(id),amount_krw integer not null check(amount_krw between 1 and 1000000),
 config_id uuid not null references commerce.op10_configs(id),merchant_id text not null,
 destination text not null check(destination~'^[A-Za-z0-9_-]{1,64}$'),
 schedule_type text not null check(schedule_type in ('EXPRESS','SCHEDULED')),payout_date date,
 description text not null check(length(btrim(description)) between 1 and 7 and description!~'[[:cntrl:]]'),
 ref_id text not null unique,state text not null default 'READY' check(state in ('READY','UNKNOWN','PENDING','COMPLETED','REVIEW')),
 provider_id text,dispatched_at timestamptz,lease_id uuid,lease_until timestamptz,next_query_at timestamptz,
 created_at timestamptz not null default now(),actor_id uuid not null references auth.users(id),
 check((schedule_type='EXPRESS' and payout_date is null) or (schedule_type='SCHEDULED' and payout_date is not null)),unique(merchant_id,provider_id));
create index op10_jobs_due on commerce.op10_jobs(next_query_at) where dispatched_at is not null;
create table commerce.op10_evidence(id uuid primary key default gen_random_uuid(),job_id uuid not null references commerce.op10_jobs(id),lease_id uuid not null unique,observation jsonb not null check(length(observation::text)<4096),created_at timestamptz not null default now());
create table commerce.op10_inbox(config_id uuid not null references commerce.op10_configs(id),event_id text not null check(length(event_id) between 1 and 64),job_id uuid not null references commerce.op10_jobs(id),digest text not null check(digest~'^[a-f0-9]{64}$'),created_at timestamptz not null default now(),primary key(config_id,event_id));
create table commerce.op10_limits(actor_id uuid primary key references auth.users(id),window_at timestamptz not null,writes integer not null);
create table commerce.op10_audit(id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),action text not null,target_id uuid,created_at timestamptz not null default now());
create function commerce.op10_frozen() returns trigger language plpgsql set search_path='' as $$begin
 if (to_jsonb(new)-array['state','provider_id','dispatched_at','lease_id','lease_until','next_query_at']) is distinct from
 (to_jsonb(old)-array['state','provider_id','dispatched_at','lease_id','lease_until','next_query_at']) then raise exception 'OP10_FROZEN';end if;
 if old.dispatched_at is not null and new.dispatched_at is distinct from old.dispatched_at then raise exception 'OP10_FROZEN';end if;
 if old.provider_id is not null and new.provider_id is distinct from old.provider_id then raise exception 'OP10_FROZEN';end if;
 return new;end$$;
create trigger op10_jobs_frozen before update on commerce.op10_jobs for each row execute function commerce.op10_frozen();
create function commerce.op10_job(p_id uuid) returns jsonb language sql stable set search_path='' set timezone='UTC' as $$
 select jsonb_build_object('id',j.id,'sourceId',j.source_id,'authorId',j.author_id::text,'amountKrw',j.amount_krw,'configId',j.config_id,'state',j.state,'createdAt',j.created_at,'dispatchedAt',j.dispatched_at,
 'providerPayoutId',j.provider_id,'refPayoutId',j.ref_id,'destination',j.destination,'scheduleType',j.schedule_type,'payoutDate',j.payout_date,'transactionDescription',j.description,
 'operationId',j.id,'operationCreatedAt',j.created_at,'providerMode','PROVIDER_TEST','ledgerApplyAllowed',false,'liveReady',false)
 from commerce.op10_jobs j where j.id=p_id$$;

create function public.op10_payout_admin(p_user uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare cfg commerce.op10_settings;src commerce.op07_payouts;job commerce.op10_jobs;ident uuid;cid uuid;off integer:=0;fields text[];rev bigint;existing jsonb;
begin
 perform 1 from auth.users u where u.id=p_user and u.email_confirmed_at is not null and u.is_anonymous is not true and (u.banned_until is null or u.banned_until<=now()) and coalesce(to_jsonb(u)->>'deleted_at','')='' for share;
 if not found then return '{"error":"ADMIN_FORBIDDEN","status":403}';end if;
 perform 1 from public.admin_users a where a.auth_user_id=p_user and a.is_active and a.role::text='SUPER_ADMIN' and (select count(*) from public.admin_users where auth_user_id=p_user)=1 for share;
 if not found then return '{"error":"ADMIN_FORBIDDEN","status":403}';end if;
 fields:=case p_action when 'state' then array[]::text[] when 'attempt' then array[]::text[] when 'save' then array['revision','merchantId','envelope'] when 'list' then array['offset'] when 'detail' then array['id'] when 'prepare' then array['id','sourceId','configId','destination','scheduleType','payoutDate','transactionDescription'] when 'authorize' then array['id'] end;
 if fields is null or jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text)>16000 or exists(select 1 from jsonb_object_keys(p_data) k where not k=any(fields)) then return '{"error":"INVALID_PAYOUT_REQUEST","status":400}';end if;
 if p_action in ('attempt','prepare','authorize') then
  perform pg_advisory_xact_lock(hashtextextended('op10-limit:'||p_user,0));
  if exists(select 1 from commerce.op10_limits where actor_id=p_user and window_at>now()-interval '1 minute' and writes>=5) then return '{"error":"RATE_LIMITED","status":429}';end if;
  insert into commerce.op10_limits values(p_user,now(),1) on conflict(actor_id) do update set writes=case when op10_limits.window_at>now()-interval '1 minute' then op10_limits.writes+1 else 1 end,window_at=case when op10_limits.window_at>now()-interval '1 minute' then op10_limits.window_at else now() end;
  if p_action='attempt' then return '{"ok":true}';end if;
 end if;
 if p_action='state' then
  select * into cfg from commerce.op10_settings;
  return jsonb_build_object('revision',cfg.revision::text,'configId',cfg.config_id,'configured',cfg.config_id is not null,'mode','PROVIDER_TEST','liveReady',false);
 elsif p_action='save' then
  if jsonb_typeof(p_data->'revision') is distinct from 'string' or coalesce(p_data->>'revision','')!~'^(0|[1-9][0-9]{0,17})$' or coalesce(p_data->>'merchantId','')!~'^[A-Za-z0-9_-]{1,100}$'
   or jsonb_typeof(p_data->'envelope') is distinct from 'object' or length((p_data->'envelope')::text)>12000 then return '{"error":"INVALID_PAYOUT_REQUEST","status":400}';end if;
  select * into cfg from commerce.op10_settings for update;
  if cfg.revision::text<>p_data->>'revision' then return '{"error":"CONFLICT","status":409}';end if;
  rev:=cfg.revision+1;
  insert into commerce.op10_configs(revision,merchant_id,envelope,actor_id) values(rev,p_data->>'merchantId',p_data->'envelope',p_user) returning id into cid;
  update commerce.op10_settings set revision=rev,config_id=cid;
  insert into commerce.op10_audit(actor_id,action,target_id) values(p_user,'save',cid);
  return jsonb_build_object('saved',true,'revision',rev::text,'configId',cid,'configured',true);
 elsif p_action='list' then
  if p_data?'offset' then
   if jsonb_typeof(p_data->'offset') is distinct from 'number' or coalesce(p_data->>'offset','')!~'^(0|[1-9][0-9]{0,4})$' then return '{"error":"INVALID_PAYOUT_REQUEST","status":400}';end if;off:=(p_data->>'offset')::integer;
  end if;
  return jsonb_build_object('items',coalesce((select jsonb_agg(commerce.op10_job(x.id) order by x.created_at desc,x.id) from (select id,created_at from commerce.op10_jobs order by created_at desc,id limit 20 offset off) x),'[]'::jsonb),'offset',off,'total',(select count(*) from commerce.op10_jobs));
 end if;
 if jsonb_typeof(p_data->'id') is distinct from 'string' or coalesce(p_data->>'id','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then return '{"error":"INVALID_PAYOUT_REQUEST","status":400}';end if;ident:=(p_data->>'id')::uuid;
 if p_action='prepare' then
  if exists(select 1 from unnest(array['sourceId','configId','destination','scheduleType']) k where jsonb_typeof(p_data->k) is distinct from 'string') then return '{"error":"INVALID_PAYOUT_REQUEST","status":400}';end if;
  if coalesce(p_data->>'sourceId','')!~*'^[a-f0-9-]{36}$' or coalesce(p_data->>'configId','')!~*'^[a-f0-9-]{36}$' or coalesce(p_data->>'destination','')!~'^[A-Za-z0-9_-]{1,64}$'
   or coalesce(p_data->>'scheduleType','') not in ('EXPRESS','SCHEDULED') or jsonb_typeof(p_data->'transactionDescription') is distinct from 'string' or length(btrim(p_data->>'transactionDescription')) not between 1 and 7 or (p_data->>'transactionDescription')~'[[:cntrl:]]'
   or (p_data->>'scheduleType'='EXPRESS' and coalesce(p_data->'payoutDate','null')<>'null')
   or (p_data->>'scheduleType'='SCHEDULED' and coalesce(p_data->>'payoutDate','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then return '{"error":"INVALID_PAYOUT_REQUEST","status":400}';end if;
  perform pg_advisory_xact_lock(hashtextextended('op10-prepare:'||ident,0));
  select * into job from commerce.op10_jobs where id=ident;
  if found then
   if job.source_id::text=p_data->>'sourceId' and job.config_id::text=p_data->>'configId' and job.destination=p_data->>'destination' and job.schedule_type=p_data->>'scheduleType' and job.payout_date is not distinct from (p_data->>'payoutDate')::date and job.description=p_data->>'transactionDescription' then return jsonb_build_object('job',commerce.op10_job(ident));end if;
   return '{"error":"CONFLICT","status":409}';
  end if;
  select * into cfg from commerce.op10_settings for share;
  if cfg.config_id is null or cfg.config_id::text<>p_data->>'configId' then return '{"error":"CONFLICT","status":409}';end if;
  select * into src from commerce.op07_payouts where id=(p_data->>'sourceId')::uuid for share;
  if not found or src.status<>'APPROVED' or src.amount_krw>1000000 or not exists(select 1 from public.authors where id=src.author_id and status::text='APPROVED') then return '{"error":"SOURCE_NOT_READY","status":409}';end if;
  insert into commerce.op10_jobs(id,source_id,source_revision,author_id,amount_krw,config_id,merchant_id,destination,schedule_type,payout_date,description,ref_id,actor_id)
   select ident,src.id,src.revision,src.author_id,src.amount_krw,cfg.config_id,c.merchant_id,p_data->>'destination',p_data->>'scheduleType',(p_data->>'payoutDate')::date,p_data->>'transactionDescription','wn10-'||ident,p_user from commerce.op10_configs c where c.id=cfg.config_id;
  insert into commerce.op10_audit(actor_id,action,target_id) values(p_user,'prepare',ident);
 end if;
 select * into job from commerce.op10_jobs where id=ident;
 if not found then return '{"error":"NOT_FOUND","status":404}';end if;
 if p_action='authorize' then insert into commerce.op10_audit(actor_id,action,target_id) values(p_user,'authorize',ident);end if;
 return jsonb_build_object('job',commerce.op10_job(ident),'evidence',coalesce((select jsonb_agg(x.observation order by x.created_at desc) from (select observation,created_at from commerce.op10_evidence where job_id=ident order by created_at desc limit 20) x),'[]'::jsonb));
exception when unique_violation then return '{"error":"CONFLICT","status":409}';
 when invalid_text_representation or datetime_field_overflow then return '{"error":"INVALID_PAYOUT_REQUEST","status":400}';
end$$;

-- Internal service-only channel. Browser roles cannot read keys or claim jobs.
create function public.op10_payout_runtime(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare j commerce.op10_jobs;c commerce.op10_configs;src commerce.op07_payouts;lid uuid;obs jsonb;old_digest text;pid text;ids jsonb;
begin
 if jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text)>16000 then raise exception 'OP10_INVALID';end if;
 if p_action='due' then return jsonb_build_object('items',coalesce((select jsonb_agg(id) from (select id from commerce.op10_jobs where dispatched_at is not null and next_query_at<=now() and (lease_until is null or lease_until<=now()) order by next_query_at,id limit 5) x),'[]'::jsonb));end if;
 if p_action='config' then
  select * into c from commerce.op10_configs where id=(p_data->>'configId')::uuid;
  return jsonb_build_object('configId',c.id,'merchantId',c.merchant_id,'envelope',c.envelope);
 end if;
 if p_action='inbox' then
  if coalesce(p_data->>'eventId','')!~'^[A-Za-z0-9_.:-]{1,64}$' or coalesce(p_data->>'digest','')!~'^[a-f0-9]{64}$' then raise exception 'OP10_INVALID';end if;
  select * into j from commerce.op10_jobs where config_id=(p_data->>'configId')::uuid and ref_id=p_data->>'refPayoutId' and dispatched_at is not null for update;
  if not found or (j.provider_id is not null and j.provider_id is distinct from p_data->>'providerPayoutId') then return '{"accepted":true,"ignored":true}';end if;
  select digest into old_digest from commerce.op10_inbox where config_id=j.config_id and event_id=p_data->>'eventId';
  if found then
   if old_digest<>p_data->>'digest' then return '{"error":"CONFLICT","status":409}';end if;
   return '{"accepted":true,"duplicate":true}';
  end if;
  -- Provider normally emits only terminal changes. Bound even authenticated noise.
  if (select count(*) from commerce.op10_inbox where job_id=j.id)>=100 then return '{"error":"RATE_LIMITED","status":429}';end if;
  insert into commerce.op10_inbox values(j.config_id,p_data->>'eventId',j.id,p_data->>'digest',now());
  update commerce.op10_jobs set next_query_at=now() where id=j.id;
  return '{"accepted":true}';
 end if;
 select * into j from commerce.op10_jobs where id=(p_data->>'id')::uuid for update;
 if not found then return '{"error":"NOT_FOUND","status":404}';end if;
 if p_action in ('claim-create','claim-query') then
  if j.lease_until>now() then return '{"claimed":false}';end if;
  if p_action='claim-create' then
   if j.config_id::text is distinct from p_data->>'reviewedConfigId' then return '{"error":"CONFIG_NOT_REVIEWED","status":409}';end if;
   perform 1 from auth.users u join public.admin_users a on a.auth_user_id=u.id where u.id=(p_data->>'actorId')::uuid and u.email_confirmed_at is not null and u.is_anonymous is not true and (u.banned_until is null or u.banned_until<=now()) and coalesce(to_jsonb(u)->>'deleted_at','')='' and a.is_active and a.role::text='SUPER_ADMIN' and (select count(*) from public.admin_users where auth_user_id=u.id)=1 for share;
   if not found then return '{"error":"ADMIN_FORBIDDEN","status":403}';end if;
   if j.dispatched_at is not null or j.state<>'READY' then return '{"claimed":false}';end if;
   select * into src from commerce.op07_payouts where id=j.source_id for share;
   if src.status<>'APPROVED' or src.revision<>j.source_revision or not exists(select 1 from public.authors where id=j.author_id and status::text='APPROVED') or j.created_at<now()-interval '14 days' then return '{"error":"SOURCE_NOT_READY","status":409}';end if;
   -- Commit this RPC before doing network I/O. A lost response never permits create again.
   perform set_config('synchronous_commit','on',true);
  elsif j.dispatched_at is null then return '{"claimed":false}';end if;
  if (select count(*) from commerce.op10_evidence where job_id=j.id)>=200 then
   update commerce.op10_jobs set state=case when state='COMPLETED' then state else 'REVIEW' end,next_query_at=null where id=j.id;
   return '{"claimed":false,"reviewRequired":true}';
  end if;
  lid:=gen_random_uuid();
  update commerce.op10_jobs set dispatched_at=coalesce(dispatched_at,now()),state=case when p_action='claim-create' then 'UNKNOWN' else state end,lease_id=lid,lease_until=now()+interval '2 minutes',next_query_at=now()+interval '5 minutes' where id=j.id;
  select * into c from commerce.op10_configs where id=j.config_id;
  return jsonb_build_object('claimed',true,'leaseId',lid,'job',commerce.op10_job(j.id),'envelope',c.envelope,'merchantId',c.merchant_id);
 elsif p_action='observe' then
  lid:=(p_data->>'leaseId')::uuid;obs:=p_data->'observation';
  if exists(select 1 from commerce.op10_evidence where lease_id=lid and job_id=j.id) then return jsonb_build_object('job',commerce.op10_job(j.id));end if;
  if j.lease_id is distinct from lid then return '{"error":"CONFLICT","status":409}';end if;
  if jsonb_typeof(obs) is distinct from 'object' or coalesce(obs->>'state','') not in ('UNKNOWN','PENDING','COMPLETED','REVIEW') or length(obs::text)>4096 then raise exception 'OP10_INVALID';end if;
  pid:=obs->>'providerPayoutId';
  if obs->>'state'<>'UNKNOWN' and (coalesce(pid,'')!~'^[A-Za-z0-9_-]{1,64}$' or obs->>'refPayoutId' is distinct from j.ref_id or obs->>'destination' is distinct from j.destination or obs->>'amountKrw' is distinct from j.amount_krw::text or obs->>'currency' is distinct from 'KRW' or obs->>'provenance' is distinct from 'PROVIDER_TEST') then raise exception 'OP10_RECEIPT_MISMATCH';end if;
  if j.provider_id is not null and pid is not null and j.provider_id<>pid then raise exception 'OP10_RECEIPT_MISMATCH';end if;
  insert into commerce.op10_evidence(job_id,lease_id,observation) values(j.id,lid,obs);
  update commerce.op10_jobs set provider_id=coalesce(provider_id,pid),state=case when j.state='COMPLETED' then 'COMPLETED' else obs->>'state' end,lease_id=null,lease_until=null,
   next_query_at=case when j.state='COMPLETED' or obs->>'state' in ('COMPLETED','REVIEW') then null else now()+interval '5 minutes' end where id=j.id;
  return jsonb_build_object('job',commerce.op10_job(j.id));
 end if;
 raise exception 'OP10_INVALID_ACTION';
end$$;

do $$declare t text;f record;begin
 foreach t in array array['configs','settings','jobs','evidence','inbox','limits','audit'] loop
  execute format('alter table commerce.op10_%I enable row level security',t);
  execute format('revoke all on commerce.op10_%I from public,anon,authenticated,service_role',t);
 end loop;
 foreach t in array array['configs','evidence','inbox','audit'] loop
  execute format('create trigger op10_immutable before update or delete on commerce.op10_%I for each row execute function commerce.op07_immutable()',t);
 end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('commerce','public') and p.proname like 'op10_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end$$;
grant execute on function public.op10_payout_admin(uuid,text,jsonb),public.op10_payout_runtime(text,jsonb) to service_role;
comment on table commerce.op10_jobs is 'External PROVIDER_TEST acceptance only; OP07 source is a frozen reference, never actual revenue or payment proof.';
commit;
