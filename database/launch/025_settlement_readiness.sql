-- OP12 preparation, never authorizes a transfer or promotes a TEST balance.
begin;
set local lock_timeout='5s';
do $$begin
 if current_setting('webnovels.settlement_readiness_apply_verified',true) is distinct from 'true'
 or to_regprocedure('public.author_settlement_registration_ready()') is null
 or not public.author_settlement_registration_ready()
 or to_regclass('launch_recovery.op12_reviews') is not null then raise exception 'Reviewed OP12 prerequisites required';end if;
end$$;
create table launch_recovery.op12_documents(
 id uuid primary key,author_id bigint not null references public.authors(id),owner_id uuid not null references auth.users(id),
 bank_revision bigint not null,identity_revision bigint not null,envelope jsonb,digest text not null check(digest~'^[a-f0-9]{64}$'),
 policy_version text not null,policy_hash text not null check(policy_hash~'^[a-f0-9]{64}$'),retention_days integer not null check(retention_days between 1 and 3650),
 created_at timestamptz not null default now(),expires_at timestamptz not null,purged_at timestamptz,
 check(expires_at=created_at+retention_days*interval '1 day'),check((envelope is null)=(purged_at is not null)));
create table launch_recovery.op12_reviews(
 id uuid primary key,author_id bigint not null references public.authors(id),owner_id uuid not null references auth.users(id),
 bank_revision bigint not null,identity_revision bigint not null,binding text not null check(binding~'^[a-f0-9]{64}$'),
 document_id uuid not null unique references launch_recovery.op12_documents(id),reviewer_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
 check(owner_id<>reviewer_id));
create table launch_recovery.op12_revocations(review_id uuid primary key references launch_recovery.op12_reviews(id),actor_id uuid not null references auth.users(id),reason text not null check(reason in ('INCORRECT_EVIDENCE','AUTHOR_REQUEST','BANK_CHANGED','OTHER_REVIEW')),created_at timestamptz not null default now());
create table launch_recovery.op12_snapshots(id uuid primary key,author_id bigint not null references public.authors(id),actor_id uuid not null references auth.users(id),period text not null check(period~'^20[0-9]{2}-(0[1-9]|1[0-2])$'),facts jsonb not null,created_at timestamptz not null default now());
create table launch_recovery.op12_audit(id uuid primary key default gen_random_uuid(),actor_id uuid references auth.users(id),author_id bigint not null references public.authors(id),action text not null check(action in ('CONFIRM','REVOKE','REVEAL','SNAPSHOT','PURGE')),target_id uuid not null,created_at timestamptz not null default now());
create table launch_recovery.op12_receipts(actor_id uuid not null references auth.users(id),request_id uuid not null,fingerprint text not null,result jsonb not null,primary key(actor_id,request_id));
create table launch_recovery.op12_limits(actor_id uuid primary key references auth.users(id),window_at timestamptz not null,writes integer not null check(writes between 1 and 30));
create index op12_review_author on launch_recovery.op12_reviews(author_id,created_at desc,id);
create index op12_snapshot_author on launch_recovery.op12_snapshots(author_id,created_at desc,id);
create index op12_document_expiry on launch_recovery.op12_documents(expires_at) where envelope is not null;

create function launch_recovery.op12_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'OP12 evidence metadata is immutable';end$$;
create function launch_recovery.op12_document_guard() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='UPDATE' and old.expires_at<=now() and old.envelope is not null and new.envelope is null and new.purged_at=now()
 and (to_jsonb(old)-array['envelope','purged_at'])=(to_jsonb(new)-array['envelope','purged_at']) then return new;end if;
 raise exception 'OP12 document metadata is immutable';end$$;
create trigger op12_document_guard before update or delete on launch_recovery.op12_documents for each row execute function launch_recovery.op12_document_guard();

create function launch_recovery.op12_facts(aid bigint) returns jsonb language plpgsql stable set search_path='' as $$
declare b launch_recovery.author_payout_details;i launch_recovery.author_settlement_applications;r launch_recovery.op12_reviews;u uuid;bank_binding text;identity_ok boolean;
begin
 select auth_user_id into u from public.authors where id=aid;
 select * into b from launch_recovery.author_payout_details where author_id=aid;
 select * into i from launch_recovery.author_settlement_applications where author_id=aid;
 identity_ok:=coalesce(i.user_id=u and i.status='APPROVED' and i.profile_envelope is not null and i.profile_expires_at>now(),false);
 bank_binding:=encode(sha256(convert_to(jsonb_build_array(aid,u,b.revision,b.bank_name,b.account_holder,b.last4,b.account_envelope,i.revision,i.status,identity_ok)::text,'UTF8')),'hex');
 select x.* into r from launch_recovery.op12_reviews x join launch_recovery.op12_documents d on d.id=x.document_id
 where x.author_id=aid and x.binding=bank_binding and d.envelope is not null and d.expires_at>now() and identity_ok
 and not exists(select 1 from launch_recovery.op12_revocations z where z.review_id=x.id) order by x.created_at desc,x.id desc limit 1;
 return jsonb_build_object('authorId',aid::text,'binding',bank_binding,'bankRevision',b.revision::text,'identityRevision',i.revision::text,
 'identityApproved',identity_ok,'bankRegistered',b.author_id is not null,'bankConfirmed',r.id is not null,'reviewId',r.id,
 'sourceStatus','UNCONNECTED','grossKrw',null,'deductionsKrw',null,'payableKrw',null,'canPay',false,
 'blockers',to_jsonb(array_remove(array[case when b.author_id is null then 'BANK_MISSING' end,case when not identity_ok then 'IDENTITY_NOT_APPROVED' end,case when r.id is null then 'BANK_REVIEW_REQUIRED' end,'LIVE_REVENUE_UNCONNECTED','PAYOUT_RELEASE_NOT_APPROVED'],null)));
end$$;

create function public.op12_settlement_readiness(p_user uuid,p_action text,p_data jsonb default '{}',p_admin boolean default false) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare who jsonb;aid bigint;owner_uid uuid;current_facts jsonb;fields text[];rid uuid;fp text;cached launch_recovery.op12_receipts;result jsonb;b launch_recovery.author_payout_details;d launch_recovery.op12_documents;r launch_recovery.op12_reviews;items jsonb;offset_no integer;
begin
 if p_admin is null or jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text)>310000 then return '{"error":"INVALID_READINESS_REQUEST","status":400}';end if;
 if not public.launch_author_workspace_ready() then return '{"error":"SETTLEMENT_NOT_ACTIVATED","status":503}';end if;
 who:=public.launch_account_actor(p_user);if who?'error' then return who;end if;
 if p_admin then
  if who->'admin'->>'role' is distinct from 'SUPER_ADMIN' or who->'admin'->>'is_active' is distinct from 'true' then return '{"error":"ADMIN_FORBIDDEN","status":403}';end if;
 else
  if who->'author'->>'status' is distinct from 'APPROVED' then return '{"error":"AUTHOR_REQUIRED","status":403}';end if;
  if p_action<>'detail' then return '{"error":"ADMIN_FORBIDDEN","status":403}';end if;
 end if;
 fields:=case p_action when 'list' then array['query','offset'] when 'detail' then array['authorId']
 when 'confirm' then array['authorId','binding','requestId','fingerprint','documentId','envelope','digest','policyVersion','policyHash','retentionDays']
 when 'revoke' then array['authorId','binding','requestId','reviewId','reason']
 when 'snapshot' then array['authorId','binding','requestId','period']
 when 'reveal' then array['authorId','reviewId'] end;
 if fields is null or exists(select 1 from jsonb_object_keys(p_data) k where not k=any(fields)) then return '{"error":"INVALID_READINESS_REQUEST","status":400}';end if;
 if p_action='list' then
  if not p_admin or jsonb_typeof(p_data->'query') is distinct from 'string' or length(p_data->>'query')>80 or (p_data->>'query')~'[<>[:cntrl:]]' or jsonb_typeof(p_data->'offset') is distinct from 'number' or coalesce(p_data->>'offset','')!~'^(0|[1-9][0-9]{0,5})$' then return '{"error":"INVALID_READINESS_REQUEST","status":400}';end if;
  offset_no:=(p_data->>'offset')::integer;
  select coalesce(jsonb_agg(v.item order by v.id),'[]') into items from(select a.id,jsonb_build_object('authorId',a.id::text,'penName',a.pen_name,'facts',launch_recovery.op12_facts(a.id)) item from public.authors a where a.status='APPROVED' and (position(lower(p_data->>'query') in lower(coalesce(a.pen_name,'')))>0 or a.id::text=p_data->>'query') order by a.id offset offset_no limit 31)v;
  return jsonb_build_object('mode','PREPARATION','canPay',false,'items',items);
 end if;
 if p_admin then
  if jsonb_typeof(p_data->'authorId') is distinct from 'string' or coalesce(p_data->>'authorId','')!~'^[1-9][0-9]{0,17}$' then return '{"error":"INVALID_READINESS_REQUEST","status":400}';end if;aid:=(p_data->>'authorId')::bigint;
 else aid:=(who->'author'->>'id')::bigint;if p_data?'authorId' then return '{"error":"INVALID_READINESS_REQUEST","status":400}';end if;end if;
 -- Matches account/bank registration lock order; the owner binding is re-read.
 perform 1 from launch_recovery.virtual_accounts where kind='author' and profile_id=aid::text for update;
 select auth_user_id into owner_uid from public.authors where id=aid and status='APPROVED' for update;
 if owner_uid is null then return '{"error":"AUTHOR_NOT_FOUND","status":404}';end if;
 who:=public.launch_account_actor(p_user);if who?'error' then return who;end if;
 if p_admin then
  if who->'admin'->>'role' is distinct from 'SUPER_ADMIN' or who->'admin'->>'is_active' is distinct from 'true' then return '{"error":"ADMIN_FORBIDDEN","status":403}';end if;
 elsif owner_uid<>p_user or who->'author'->>'id' is distinct from aid::text or who->'author'->>'status' is distinct from 'APPROVED' then return '{"error":"AUTHOR_REQUIRED","status":403}';end if;
 select * into b from launch_recovery.author_payout_details where author_id=aid for update;
 perform 1 from launch_recovery.author_settlement_applications where author_id=aid for update;
 current_facts:=launch_recovery.op12_facts(aid);
 if p_action='detail' then
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'period',s.period,'createdAt',s.created_at,'stale',s.facts is distinct from current_facts,'facts',s.facts) order by s.created_at desc,s.id desc),'[]') into items from(select * from launch_recovery.op12_snapshots where author_id=aid order by created_at desc,id desc limit 10)s;
  return jsonb_build_object('mode','PREPARATION','canPay',false,'ownerUserId',owner_uid,'facts',current_facts,'bank',case when b.author_id is null then null else jsonb_build_object('bankName',b.bank_name,'holder',b.account_holder,'maskedNumber','**** '||b.last4) end,'snapshots',items,
   'reviews',case when p_admin then (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'createdAt',x.created_at,'revoked',exists(select 1 from launch_recovery.op12_revocations z where z.review_id=x.id),'documentAvailable',dd.envelope is not null and dd.expires_at>now()) order by x.created_at desc,x.id desc),'[]') from (select * from launch_recovery.op12_reviews where author_id=aid and owner_id=owner_uid order by created_at desc,id desc limit 10)x join launch_recovery.op12_documents dd on dd.id=x.document_id) else '[]' end);
 end if;
 if p_action='reveal' then
  select * into r from launch_recovery.op12_reviews where id=(p_data->>'reviewId')::uuid and author_id=aid;
  select * into d from launch_recovery.op12_documents where id=r.document_id and envelope is not null and expires_at>now();
  if d.id is null or d.owner_id<>owner_uid then return '{"error":"BANK_DOCUMENT_UNAVAILABLE","status":404}';end if;
  insert into launch_recovery.op12_audit(actor_id,author_id,action,target_id) values(p_user,aid,'REVEAL',r.id);
  return jsonb_build_object('encrypted',jsonb_build_object('id',d.id,'authorId',aid::text,'userId',d.owner_id,'bankRevision',d.bank_revision::text,'identityRevision',d.identity_revision::text,'envelope',d.envelope,'digest',d.digest));
 end if;
 if jsonb_typeof(p_data->'requestId') is distinct from 'string' or coalesce(p_data->>'requestId','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' or coalesce(p_data->>'binding','')!~'^[a-f0-9]{64}$' then return '{"error":"INVALID_READINESS_REQUEST","status":400}';end if;
 rid:=(p_data->>'requestId')::uuid;
 fp:=encode(sha256(convert_to(p_action||':'||(p_data-'envelope')::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('op12-actor:'||p_user,0));
 select * into cached from launch_recovery.op12_receipts where actor_id=p_user and request_id=rid;
 if found then if cached.fingerprint<>fp then return '{"error":"IDEMPOTENCY_CONFLICT","status":409}';end if;return cached.result||'{"replayed":true}';end if;
 if current_facts->>'binding'<>p_data->>'binding' then return '{"error":"SETTLEMENT_CONFLICT","status":409}';end if;
 if exists(select 1 from launch_recovery.op12_limits where actor_id=p_user and window_at>now()-interval '1 minute' and writes>=30) then return '{"error":"RATE_LIMITED","status":429}';end if;
 insert into launch_recovery.op12_limits values(p_user,now(),1) on conflict(actor_id) do update set writes=case when op12_limits.window_at>now()-interval '1 minute' then op12_limits.writes+1 else 1 end,window_at=case when op12_limits.window_at>now()-interval '1 minute' then op12_limits.window_at else now() end;
 if p_action='confirm' then
  if p_user=owner_uid then return '{"error":"INDEPENDENT_REVIEW_REQUIRED","status":403}';end if;
  if current_facts->>'identityApproved'<>'true' or b.author_id is null then return '{"error":"BANK_REVIEW_NOT_READY","status":409}';end if;
  if current_facts->>'bankConfirmed'='true' then return '{"error":"BANK_ALREADY_CONFIRMED","status":409}';end if;
  if not launch_recovery.settlement_envelope_valid(p_data->'envelope',290000) or coalesce(p_data->>'fingerprint','')!~'^[a-f0-9]{64}$' or coalesce(p_data->>'digest','')!~'^[a-f0-9]{64}$' or coalesce(p_data->>'policyHash','')!~'^[a-f0-9]{64}$' or coalesce(p_data->>'policyVersion','')!~'^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$' or p_data->>'policyVersion'~*'draft' or jsonb_typeof(p_data->'retentionDays') is distinct from 'number' or coalesce(p_data->>'retentionDays','')!~'^[1-9][0-9]{0,3}$' or (p_data->>'retentionDays')::integer>3650 then return '{"error":"INVALID_READINESS_REQUEST","status":400}';end if;
  insert into launch_recovery.op12_documents values((p_data->>'documentId')::uuid,aid,owner_uid,b.revision,(current_facts->>'identityRevision')::bigint,p_data->'envelope',p_data->>'digest',p_data->>'policyVersion',p_data->>'policyHash',(p_data->>'retentionDays')::integer,now(),now()+(p_data->>'retentionDays')::integer*interval '1 day',null);
  insert into launch_recovery.op12_reviews values(rid,aid,owner_uid,b.revision,(current_facts->>'identityRevision')::bigint,current_facts->>'binding',(p_data->>'documentId')::uuid,p_user,now());
 elsif p_action='revoke' then
  if coalesce(p_data->>'reason','') not in ('INCORRECT_EVIDENCE','AUTHOR_REQUEST','BANK_CHANGED','OTHER_REVIEW') or not exists(select 1 from launch_recovery.op12_reviews where id=(p_data->>'reviewId')::uuid and author_id=aid) then return '{"error":"INVALID_READINESS_REQUEST","status":400}';end if;
  insert into launch_recovery.op12_revocations values((p_data->>'reviewId')::uuid,p_user,p_data->>'reason',now());
 elsif p_action='snapshot' then
  if coalesce(p_data->>'period','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' or p_data->>'period'>to_char(now(),'YYYY-MM') then return '{"error":"INVALID_READINESS_REQUEST","status":400}';end if;
  insert into launch_recovery.op12_snapshots values(rid,aid,p_user,p_data->>'period',current_facts,now());
 end if;
 insert into launch_recovery.op12_audit(actor_id,author_id,action,target_id) values(p_user,aid,upper(p_action),case when p_action='revoke' then (p_data->>'reviewId')::uuid else rid end);
 result:=jsonb_build_object('mode','PREPARATION','canPay',false,'saved',true,'replayed',false);
 insert into launch_recovery.op12_receipts values(p_user,rid,fp,result);return result;
exception when invalid_text_representation or numeric_value_out_of_range then return '{"error":"INVALID_READINESS_REQUEST","status":400}';when unique_violation then return '{"error":"SETTLEMENT_CONFLICT","status":409}';
end$$;

create function public.op12_purge_documents() returns jsonb language plpgsql security definer set search_path='' as $$declare n integer;begin
 with due as(select id from launch_recovery.op12_documents where expires_at<=now() and envelope is not null order by expires_at,id limit 100 for update skip locked),purged as(update launch_recovery.op12_documents d set envelope=null,purged_at=now() from due where d.id=due.id returning d.id,d.author_id)
 insert into launch_recovery.op12_audit(author_id,action,target_id) select author_id,'PURGE',id from purged;
 get diagnostics n=row_count;return jsonb_build_object('purged',n);end$$;
do $$declare t text;f record;begin
 foreach t in array array['documents','reviews','revocations','snapshots','audit','receipts','limits'] loop
  execute format('alter table launch_recovery.op12_%I enable row level security',t);
  execute format('revoke all on launch_recovery.op12_%I from public,anon,authenticated,service_role',t);
 end loop;
 foreach t in array array['reviews','revocations','snapshots','audit','receipts'] loop execute format('create trigger op12_immutable before update or delete on launch_recovery.op12_%I for each row execute function launch_recovery.op12_immutable()',t);end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('launch_recovery','public') and p.proname like 'op12_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end$$;
grant execute on function public.op12_settlement_readiness(uuid,text,jsonb,boolean),public.op12_purge_documents() to service_role;
commit;
