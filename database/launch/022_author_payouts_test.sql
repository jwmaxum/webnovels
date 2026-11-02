-- Reviewed synthetic TEST settlements. No production apply, real account or transfer.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if current_setting('webnovels.author_payouts_test_apply_verified',true) is distinct from 'true'
 or to_regprocedure('public.op05_topups(uuid,text,jsonb)') is null
 or to_regprocedure('public.op06_rewards(uuid,text,jsonb)') is null
 or to_regclass('commerce.op07_config') is not null then raise exception 'Reviewed OP-07 TEST prerequisites required';end if;
end $$;

create table commerce.op07_policies(id uuid primary key default gen_random_uuid(),enabled boolean not null,author_bps integer not null check(author_bps between 0 and 10000),deduction_bps integer not null check(deduction_bps between 0 and 10000),actor_id uuid references auth.users(id),reason text not null check(length(btrim(reason)) between 3 and 300),created_at timestamptz not null default now());
create table commerce.op07_config(singleton boolean primary key default true check(singleton),revision bigint not null default 0 check(revision>=0),policy_id uuid not null references commerce.op07_policies(id));
insert into commerce.op07_policies(id,enabled,author_bps,deduction_bps,reason) values('00000000-0000-4000-8000-000000000007',false,0,0,'명시적 TEST 정책 설정 전 비활성');
insert into commerce.op07_config values(true,0,'00000000-0000-4000-8000-000000000007');
create table commerce.op07_payees(author_id bigint primary key references public.authors(id),revision bigint not null check(revision>0),ready boolean not null,test_reference text not null check(test_reference~'^TEST-[A-Za-z0-9_-]{1,72}$'),actor_id uuid not null references auth.users(id),updated_at timestamptz not null default now());
create table commerce.op07_earnings(id uuid primary key default gen_random_uuid(),allocation_id uuid not null unique references commerce.op05_allocations(id),author_id bigint not null references public.authors(id),work_id bigint not null references public.works(id),work_title text not null,policy_id uuid not null references commerce.op07_policies(id),source_amount_krw integer not null check(source_amount_krw>0),author_gross_krw integer not null check(author_gross_krw>=0),policy_deduction_krw integer not null check(policy_deduction_krw>=0),net_krw integer not null check(net_krw>=0),actor_id uuid not null references auth.users(id),reason text not null,created_at timestamptz not null default now(),check(author_gross_krw<=source_amount_krw and policy_deduction_krw<=author_gross_krw and net_krw=author_gross_krw-policy_deduction_krw));
create table commerce.op07_adjustments(id uuid primary key default gen_random_uuid(),earning_id uuid not null references commerce.op07_earnings(id),amount_krw integer not null check(amount_krw>0),actor_id uuid not null references auth.users(id),reason text not null check(length(btrim(reason)) between 3 and 300),created_at timestamptz not null default now());
create index op07_adjustments_earning on commerce.op07_adjustments(earning_id,created_at,id);
create table commerce.op07_payouts(id uuid primary key default gen_random_uuid(),author_id bigint not null references public.authors(id),author_name text not null,amount_krw integer not null check(amount_krw between 1 and 1000000000),policy_id uuid not null references commerce.op07_policies(id),payee_revision bigint not null check(payee_revision>0),test_reference text not null check(test_reference~'^TEST-[A-Za-z0-9_-]{1,72}$'),status text not null check(status in ('REQUESTED','APPROVED','UNKNOWN','PAID','FAILED','REJECTED','CANCELLED')),revision bigint not null default 0 check(revision>=0),created_at timestamptz not null default now(),approved_at timestamptz,dispatched_at timestamptz,completed_at timestamptz);
create index op07_payouts_author on commerce.op07_payouts(author_id,created_at desc,id);
create table commerce.op07_evidence(id uuid primary key default gen_random_uuid(),payout_id uuid not null unique references commerce.op07_payouts(id),outcome text not null check(outcome in ('PAID','FAILED')),reference text not null unique check(reference~'^TEST-[A-Za-z0-9_-]{1,72}$'),test_reference text not null check(test_reference~'^TEST-[A-Za-z0-9_-]{1,72}$'),amount_krw integer not null check(amount_krw between 1 and 1000000000),occurred_at timestamptz not null,source text not null default 'LOCAL_SIMULATED' check(source='LOCAL_SIMULATED'),actor_id uuid not null references auth.users(id),reason text not null,created_at timestamptz not null default now());
create table commerce.op07_receipts(actor_id uuid not null references auth.users(id),request_id uuid not null,action text not null,fingerprint text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(actor_id,request_id));
create index op07_receipts_actor_recent on commerce.op07_receipts(actor_id,created_at desc);
-- One bounded counter row per actor. Business rejection still consumes a write attempt.
create table commerce.op07_write_limits(actor_id uuid primary key references auth.users(id),window_at timestamptz not null,writes integer not null check(writes between 1 and 60));
create table commerce.op07_audit(id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),author_id bigint references public.authors(id),action text not null,detail jsonb not null,reason text,created_at timestamptz not null default now());

create function commerce.op07_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'OP07_IMMUTABLE';end $$;
create function commerce.op07_policy(p_id uuid) returns jsonb language sql stable set search_path='' as $$select jsonb_build_object('id',id,'enabled',enabled,'authorBps',author_bps,'deductionBps',deduction_bps) from commerce.op07_policies where id=p_id$$;
create function commerce.op07_payee(p_author bigint) returns jsonb language sql stable set search_path='' as $$select coalesce((select jsonb_build_object('revision',revision::text,'ready',ready,'testReference',test_reference) from commerce.op07_payees where author_id=p_author),'{"revision":"0","ready":false,"testReference":null}'::jsonb)$$;
create function commerce.op07_source_ready(p_allocation uuid) returns boolean language sql stable set search_path='' as $$
 select coalesce((select l.source='TOPUP' and a.amount_krw>0 and o.credited and o.status in ('PAID','REFUND_PENDING','REFUNDED') and o.approved_at is not null
 and exists(select 1 from commerce.op05_events v where v.order_id=o.id and v.kind='APPROVAL' and v.transaction_key=o.approval_transaction and v.amount_krw=o.amount_krw and v.points=o.points)
 from commerce.op05_allocations a join commerce.op05_lots l on l.id=a.lot_id join commerce.op05_orders o on o.id=l.order_id where a.id=p_allocation),false)
$$;
create function commerce.op07_summary(p_author bigint default null) returns jsonb language sql stable set search_path='' as $$
 with amounts as(select e.author_id,coalesce(sum(e.net_krw),0)::bigint confirmed,coalesce(sum((select coalesce(sum(a.amount_krw),0) from commerce.op07_adjustments a where a.earning_id=e.id)),0)::bigint deducted,
 coalesce(sum(case when not commerce.op07_source_ready(e.allocation_id) then e.net_krw-(select coalesce(sum(a.amount_krw),0) from commerce.op07_adjustments a where a.earning_id=e.id) else 0 end),0)::bigint held from commerce.op07_earnings e where p_author is null or e.author_id=p_author group by e.author_id),
 paid as(select author_id,coalesce(sum(amount_krw) filter(where status='PAID'),0)::bigint paid,coalesce(sum(amount_krw) filter(where status in ('REQUESTED','APPROVED','UNKNOWN')),0)::bigint reserved from commerce.op07_payouts where p_author is null or author_id=p_author group by author_id),
 owners as(select author_id from amounts union select author_id from paid),
 balances as(select coalesce(a.confirmed,0) confirmed,coalesce(a.deducted,0) deducted,coalesce(a.held,0) held,coalesce(p.paid,0) paid,coalesce(p.reserved,0) reserved from owners o left join amounts a on a.author_id=o.author_id left join paid p on p.author_id=o.author_id)
 select jsonb_build_object('confirmedKrw',coalesce(sum(confirmed),0),'deductedKrw',coalesce(sum(deducted),0),'netKrw',coalesce(sum(confirmed-deducted),0),'paidKrw',coalesce(sum(paid),0),'reservedKrw',coalesce(sum(reserved),0),'heldKrw',coalesce(sum(held),0),'availableKrw',coalesce(sum(greatest(confirmed-deducted-paid-reserved-held,0)),0),'debtKrw',coalesce(sum(greatest(paid+reserved-confirmed+deducted,0)),0)) from balances
$$;
create function commerce.op07_earning(p_id uuid) returns jsonb language sql stable set search_path='' set timezone='UTC' as $$
 select jsonb_build_object('id',e.id,'allocationId',e.allocation_id,'authorId',e.author_id::text,'workId',e.work_id::text,'workTitle',e.work_title,'sourceAmountKrw',e.source_amount_krw,'authorGrossKrw',e.author_gross_krw,'policyDeductionKrw',e.policy_deduction_krw,'netKrw',e.net_krw,'adjustedKrw',(select coalesce(sum(amount_krw),0) from commerce.op07_adjustments where earning_id=e.id),'availableNetKrw',e.net_krw-(select coalesce(sum(amount_krw),0) from commerce.op07_adjustments where earning_id=e.id),'sourceHeld',not commerce.op07_source_ready(e.allocation_id),'policyVersion',e.policy_id,'createdAt',e.created_at,
 'adjustments',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'amountKrw',x.amount_krw,'reason',x.reason,'createdAt',x.created_at) order by x.created_at,x.id) from commerce.op07_adjustments x where x.earning_id=e.id),'[]'::jsonb)) from commerce.op07_earnings e where e.id=p_id
$$;
create function commerce.op07_payout(p_id uuid) returns jsonb language sql stable set search_path='' set timezone='UTC' as $$
 select jsonb_build_object('id',p.id,'authorId',p.author_id::text,'authorName',p.author_name,'amountKrw',p.amount_krw,'status',p.status,'revision',p.revision::text,'policyVersion',p.policy_id,'payeeRevision',p.payee_revision::text,'testReference',p.test_reference,'createdAt',p.created_at,'approvedAt',p.approved_at,'dispatchedAt',p.dispatched_at,'completedAt',p.completed_at,
 'evidence',(select jsonb_build_object('outcome',e.outcome,'reference',e.reference,'testReference',e.test_reference,'amountKrw',e.amount_krw,'occurredAt',e.occurred_at,'source',e.source) from commerce.op07_evidence e where e.payout_id=p.id)) from commerce.op07_payouts p where p.id=p_id
$$;

create function public.op07_payouts(p_user uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
#variable_conflict use_variable
declare base jsonb:='{"mode":"TEST","provenance":"LOCAL_SIMULATED","currency":"KRW","livePayouts":false}';adm boolean:=left(p_action,6)='admin-';act text:=case when left(p_action,6)='admin-' then substr(p_action,7) else p_action end;
 aid bigint;target bigint;fields text[];is_write boolean;req uuid;fp text;rec commerce.op07_receipts;cfg commerce.op07_config;pol commerce.op07_policies;pay commerce.op07_payees;po commerce.op07_payouts;src record;en commerce.op07_earnings;result jsonb;items jsonb;summary jsonb;new_id uuid;id_no uuid;off integer:=0;total_no bigint;filter text;query_text text;reason text;amount integer;gross integer;deduction integer;at_time timestamptz;active_author boolean;
begin
 perform 1 from auth.users u where u.id=p_user and u.email_confirmed_at is not null and u.is_anonymous is not true and (u.banned_until is null or u.banned_until<=now()) and coalesce(to_jsonb(u)->>'deleted_at','')='' for share;
 if not found then return jsonb_build_object('error',case when adm then 'ADMIN_FORBIDDEN' else 'AUTHOR_REQUIRED' end,'status',403);end if;
 if adm then
  perform 1 from public.admin_users a where a.auth_user_id=p_user and a.role::text='SUPER_ADMIN' and a.is_active and (select count(*) from public.admin_users where auth_user_id=p_user)=1 for share;
  if not found then return jsonb_build_object('error','ADMIN_FORBIDDEN','status',403);end if;
 else
  select a.id into aid from public.authors a where a.auth_user_id=p_user and a.status::text='APPROVED' and (select count(*) from public.authors where auth_user_id=p_user)=1 for share;
  if aid is null then return jsonb_build_object('error','AUTHOR_REQUIRED','status',403);end if;
 end if;
 fields:=case act
 when 'state' then case when adm then array[]::text[] end
 when 'summary' then case when not adm then array[]::text[] end
 when 'policy' then case when adm then array['enabled','authorBps','deductionBps','revision','reason','requestId'] end
 when 'authors' then case when adm then array['offset','query'] end
 when 'payee' then case when adm then array['authorId','ready','testReference','revision','reason','requestId'] end
 when 'sources' then case when adm then array['offset','authorId'] end
 when 'confirm' then case when adm then array['allocationId','policyVersion','reason','requestId'] end
 when 'adjust' then case when adm then array['earningId','amountKrw','reason','requestId'] end
 when 'earnings' then case when adm then array['offset','authorId'] else array['offset'] end
 when 'requests' then case when adm then array['status','offset','authorId'] else array['status','offset'] end
 when 'detail' then case when adm then array['payoutId'] end
 when 'request-detail' then case when not adm then array['payoutId'] end
 when 'request' then case when not adm then array['amountKrw','policyVersion','payeeRevision','requestId'] end
 when 'cancel' then case when not adm then array['payoutId','revision','reason','requestId'] end
 when 'approve' then case when adm then array['payoutId','revision','reason','requestId'] end
 when 'reject' then case when adm then array['payoutId','revision','reason','requestId'] end
 when 'begin' then case when adm then array['payoutId','revision','reason','requestId'] end
 when 'paid' then case when adm then array['payoutId','revision','reference','testReference','amountKrw','paidAt','reason','requestId'] end
 when 'fail' then case when adm then array['payoutId','revision','reference','testReference','reason','requestId'] end end;
 if fields is null or jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text)>16384 or exists(select 1 from jsonb_object_keys(p_data) k where not k=any(fields)) then return jsonb_build_object('error','INVALID_PAYOUT_REQUEST','status',400);end if;
 is_write:=act in ('policy','payee','confirm','adjust','request','cancel','approve','reject','begin','paid','fail');
 if p_data?'offset' then if jsonb_typeof(p_data->'offset') is distinct from 'number' or coalesce(p_data->>'offset','')!~'^(0|[1-9][0-9]{0,5})$' or (p_data->>'offset')::integer>100000 then return jsonb_build_object('error','INVALID_PAYOUT_REQUEST','status',400);end if;off:=(p_data->>'offset')::integer;end if;
 if p_data?'authorId' then if jsonb_typeof(p_data->'authorId') is distinct from 'string' or coalesce(p_data->>'authorId','')!~'^[1-9][0-9]{0,18}$' or (p_data->>'authorId')::numeric>9223372036854775807 then return jsonb_build_object('error','INVALID_PAYOUT_REQUEST','status',400);end if;target:=(p_data->>'authorId')::bigint;end if;
 if is_write then
  if jsonb_typeof(p_data->'requestId') is distinct from 'string' or coalesce(p_data->>'requestId','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return jsonb_build_object('error','INVALID_PAYOUT_REQUEST','status',400);end if;
  req:=(p_data->>'requestId')::uuid;fp:=encode(sha256(convert_to(p_action||':'||p_data::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('op07-write-user:'||p_user,0));
  select * into rec from commerce.op07_receipts where actor_id=p_user and request_id=req;
  if found then if rec.action<>p_action or rec.fingerprint<>fp then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT','status',409);end if;return rec.result||jsonb_build_object('replayed',true);end if;
  insert into commerce.op07_write_limits(actor_id,window_at,writes) values(p_user,clock_timestamp(),1)
   on conflict(actor_id) do update set window_at=case when commerce.op07_write_limits.window_at<=excluded.window_at-interval '1 minute' then excluded.window_at else commerce.op07_write_limits.window_at end,writes=case when commerce.op07_write_limits.window_at<=excluded.window_at-interval '1 minute' then 1 else commerce.op07_write_limits.writes+1 end
   where commerce.op07_write_limits.window_at<=excluded.window_at-interval '1 minute' or commerce.op07_write_limits.writes<60 returning writes into amount;
  if not found then return jsonb_build_object('error','RATE_LIMITED','status',429);end if;
  if act<>'request' then
   if jsonb_typeof(p_data->'reason') is distinct from 'string' or length(btrim(p_data->>'reason')) not between 3 and 300 or p_data->>'reason'~'[<>[:cntrl:]]' then return jsonb_build_object('error','INVALID_PAYOUT_REQUEST','status',400);end if;reason:=btrim(p_data->>'reason');
  end if;
 end if;
 if act='policy' then select * into cfg from commerce.op07_config where singleton for update;else select * into cfg from commerce.op07_config where singleton for share;end if;
 select * into strict pol from commerce.op07_policies where id=cfg.policy_id;
 if act='state' then return base||jsonb_build_object('revision',cfg.revision::text,'policy',commerce.op07_policy(pol.id),'summary',commerce.op07_summary());end if;
 if act='policy' then
  if jsonb_typeof(p_data->'revision') is distinct from 'string' or coalesce(p_data->>'revision','')!~'^(0|[1-9][0-9]{0,18})$' or jsonb_typeof(p_data->'enabled') is distinct from 'boolean' or jsonb_typeof(p_data->'authorBps') is distinct from 'number' or coalesce(p_data->>'authorBps','')!~'^(0|[1-9][0-9]{0,4})$' or (p_data->>'authorBps')::integer>10000 or jsonb_typeof(p_data->'deductionBps') is distinct from 'number' or coalesce(p_data->>'deductionBps','')!~'^(0|[1-9][0-9]{0,4})$' or (p_data->>'deductionBps')::integer>10000 then return jsonb_build_object('error','INVALID_PAYOUT_REQUEST','status',400);end if;
  if cfg.revision::text<>p_data->>'revision' then return jsonb_build_object('error','REVISION_CONFLICT','status',409);end if;
  insert into commerce.op07_policies(enabled,author_bps,deduction_bps,actor_id,reason) values((p_data->>'enabled')::boolean,(p_data->>'authorBps')::integer,(p_data->>'deductionBps')::integer,p_user,reason) returning id into new_id;
  update commerce.op07_config set revision=revision+1,policy_id=new_id where singleton;
  result:=base||jsonb_build_object('revision',(cfg.revision+1)::text,'policy',commerce.op07_policy(new_id),'summary',commerce.op07_summary(),'saved',true,'replayed',false);
 elsif act='authors' then
  query_text:=coalesce(p_data->>'query','');if jsonb_typeof(coalesce(p_data->'query','""')) is distinct from 'string' or length(query_text)>80 or query_text~'[<>[:cntrl:]]' then return jsonb_build_object('error','INVALID_PAYOUT_REQUEST','status',400);end if;
  select count(*) into total_no from public.authors a where query_text='' or position(lower(query_text) in lower(a.pen_name))>0;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id::text,'penName',a.pen_name,'status',a.status::text,'payee',commerce.op07_payee(a.id),'summary',commerce.op07_summary(a.id)) order by a.id),'[]'::jsonb) into items from (select * from public.authors a where query_text='' or position(lower(query_text) in lower(a.pen_name))>0 order by a.id limit 50 offset off)a;
 elsif act='sources' then
  select count(*) into total_no from commerce.op05_allocations x join commerce.op05_lots l on l.id=x.lot_id join commerce.op04_purchases p on p.id=x.purchase_id where l.source='TOPUP' and x.amount_krw>0 and (target is null or p.author_id=target);
  select coalesce(jsonb_agg(jsonb_build_object('allocationId',x.id,'purchaseId',x.purchase_id,'authorId',p.author_id::text,'authorName',a.pen_name,'workId',p.work_id::text,'workTitle',w.title,'sourceAmountKrw',x.amount_krw,'points',x.points,'createdAt',x.created_at,'orderStatus',o.status,'eligible',pol.enabled and commerce.op07_source_ready(x.id) and e.id is null,'earningId',e.id) order by x.created_at desc,x.id),'[]'::jsonb) into items
  from (select x.* from commerce.op05_allocations x join commerce.op05_lots l on l.id=x.lot_id join commerce.op04_purchases p on p.id=x.purchase_id where l.source='TOPUP' and x.amount_krw>0 and (target is null or p.author_id=target) order by x.created_at desc,x.id limit 50 offset off)x join commerce.op05_lots l on l.id=x.lot_id join commerce.op05_orders o on o.id=l.order_id join commerce.op04_purchases p on p.id=x.purchase_id join public.authors a on a.id=p.author_id join public.works w on w.id=p.work_id left join commerce.op07_earnings e on e.allocation_id=x.id;
 elsif act in ('earnings','requests') then
  if not adm then target:=aid;end if;
  if act='earnings' then
   select count(*) into total_no from commerce.op07_earnings e where target is null or e.author_id=target;
   select coalesce(jsonb_agg(commerce.op07_earning(e.id) order by e.created_at desc,e.id),'[]'::jsonb) into items from (select * from commerce.op07_earnings where target is null or author_id=target order by created_at desc,id limit 50 offset off)e;
  else
   filter:=coalesce(p_data->>'status','ALL');if filter not in ('ALL','REQUESTED','APPROVED','UNKNOWN','PAID','FAILED','REJECTED','CANCELLED') then return jsonb_build_object('error','INVALID_PAYOUT_REQUEST','status',400);end if;
   select count(*) into total_no from commerce.op07_payouts p where (target is null or p.author_id=target) and (filter='ALL' or p.status=filter);
   select coalesce(jsonb_agg(commerce.op07_payout(p.id) order by p.created_at desc,p.id),'[]'::jsonb) into items from (select * from commerce.op07_payouts where (target is null or author_id=target) and (filter='ALL' or status=filter) order by created_at desc,id limit 50 offset off)p;
  end if;
 elsif act='summary' then
  summary:=commerce.op07_summary(aid);return base||jsonb_build_object('authorId',aid::text,'policy',commerce.op07_policy(pol.id),'payee',commerce.op07_payee(aid),'summary',summary,'eligibility',jsonb_build_object('canRequest',pol.enabled and (commerce.op07_payee(aid)->>'ready')::boolean and (summary->>'availableKrw')::bigint>0,'authorActive',true,'accountReady',(commerce.op07_payee(aid)->>'ready')::boolean,'sourceHold',(summary->>'heldKrw')::bigint>0));
 else
  -- Determine the historical author before acquiring its common mutation lock.
  if act in ('confirm','adjust') then
   if coalesce(p_data->>(case when act='confirm' then 'allocationId' else 'earningId' end),'')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return jsonb_build_object('error','INVALID_PAYOUT_REQUEST','status',400);end if;
   id_no:=(p_data->>(case when act='confirm' then 'allocationId' else 'earningId' end))::uuid;
   if act='confirm' then select p.author_id into target from commerce.op05_allocations x join commerce.op04_purchases p on p.id=x.purchase_id where x.id=id_no;else select author_id into target from commerce.op07_earnings where id=id_no;end if;
  elsif act='request' then target:=aid;
  elsif act<>'payee' then
   if coalesce(p_data->>'payoutId','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return jsonb_build_object('error','INVALID_PAYOUT_REQUEST','status',400);end if;
   id_no:=(p_data->>'payoutId')::uuid;select author_id into target from commerce.op07_payouts where id=id_no;
  end if;
  if target is null or not exists(select 1 from public.authors where id=target) or (not adm and target<>aid) then return jsonb_build_object('error','PAYOUT_NOT_FOUND','status',404);end if;
  if act in ('detail','request-detail') then return base||jsonb_build_object('payout',commerce.op07_payout(id_no));end if;
  perform pg_advisory_xact_lock(hashtextextended('op07-author:'||target,0));
  -- Lock underlying mutable funding rows in stable order; historical purchases/allocations are immutable.
  perform 1 from commerce.op05_orders o where o.id in(select l.order_id from commerce.op05_allocations x join commerce.op05_lots l on l.id=x.lot_id join commerce.op04_purchases p on p.id=x.purchase_id where p.author_id=target) order by o.id for share;
  select * into pay from commerce.op07_payees where author_id=target for update;
  -- Target Auth status participates in the dispatch decision and is locked too.
  perform 1 from auth.users u where u.id=(select a.auth_user_id from public.authors a where a.id=target) for share;
  select a.status::text='APPROVED' and exists(select 1 from auth.users u where u.id=a.auth_user_id and u.email_confirmed_at is not null and u.is_anonymous is not true and (u.banned_until is null or u.banned_until<=now()) and coalesce(to_jsonb(u)->>'deleted_at','')='') into active_author from public.authors a where a.id=target for share;
  if act in ('payee','cancel','approve','reject','begin','paid','fail') then
   if jsonb_typeof(p_data->'revision') is distinct from 'string' or coalesce(p_data->>'revision','')!~'^(0|[1-9][0-9]{0,18})$' then return jsonb_build_object('error','INVALID_PAYOUT_REQUEST','status',400);end if;
  end if;
  if act='payee' then
   if jsonb_typeof(p_data->'ready') is distinct from 'boolean' or coalesce(p_data->>'testReference','')!~'^TEST-[A-Za-z0-9_-]{1,72}$' then return jsonb_build_object('error','INVALID_PAYOUT_REQUEST','status',400);end if;
   if coalesce(pay.revision,0)::text<>p_data->>'revision' then return jsonb_build_object('error','REVISION_CONFLICT','status',409);end if;
   insert into commerce.op07_payees(author_id,revision,ready,test_reference,actor_id) values(target,1,(p_data->>'ready')::boolean,p_data->>'testReference',p_user) on conflict(author_id) do update set revision=commerce.op07_payees.revision+1,ready=excluded.ready,test_reference=excluded.test_reference,actor_id=p_user,updated_at=now();
   result:=base||jsonb_build_object('authorId',target::text,'payee',commerce.op07_payee(target),'summary',commerce.op07_summary(target),'replayed',false);
  elsif act='confirm' then
   if coalesce(p_data->>'policyVersion','')<>pol.id::text then return jsonb_build_object('error','PAYOUT_POLICY_CHANGED','status',409);end if;
   if not pol.enabled then return jsonb_build_object('error','PAYOUT_POLICY_DISABLED','status',409);end if;
   if exists(select 1 from commerce.op07_earnings where allocation_id=id_no) then return jsonb_build_object('error','SOURCE_ALREADY_CONFIRMED','status',409);end if;
   if not commerce.op07_source_ready(id_no) then return jsonb_build_object('error','SOURCE_NOT_PAYABLE','status',409);end if;
   select x.*,p.author_id,p.work_id,w.title into src from commerce.op05_allocations x join commerce.op04_purchases p on p.id=x.purchase_id join public.works w on w.id=p.work_id where x.id=id_no;
   gross:=floor(src.amount_krw::numeric*pol.author_bps/10000)::integer;deduction:=floor(gross::numeric*pol.deduction_bps/10000)::integer;
   insert into commerce.op07_earnings(allocation_id,author_id,work_id,work_title,policy_id,source_amount_krw,author_gross_krw,policy_deduction_krw,net_krw,actor_id,reason) values(id_no,target,src.work_id,src.title,pol.id,src.amount_krw,gross,deduction,gross-deduction,p_user,reason) returning id into new_id;
   result:=base||jsonb_build_object('earning',commerce.op07_earning(new_id),'summary',commerce.op07_summary(target),'replayed',false);
  elsif act='adjust' then
   select * into strict en from commerce.op07_earnings where id=id_no;
   if jsonb_typeof(p_data->'amountKrw') is distinct from 'number' or coalesce(p_data->>'amountKrw','')!~'^[1-9][0-9]{0,8}$' then return jsonb_build_object('error','INVALID_PAYOUT_REQUEST','status',400);end if;amount:=(p_data->>'amountKrw')::integer;
   if (select count(*) from commerce.op07_adjustments where earning_id=id_no)>=100 then return jsonb_build_object('error','ADJUSTMENT_LIMIT','status',409);end if;
   if amount>en.net_krw-(select coalesce(sum(amount_krw),0) from commerce.op07_adjustments where earning_id=id_no) then return jsonb_build_object('error','ADJUSTMENT_EXCEEDS_EARNING','status',409);end if;
   insert into commerce.op07_adjustments(earning_id,amount_krw,actor_id,reason) values(id_no,amount,p_user,reason);
   result:=base||jsonb_build_object('earning',commerce.op07_earning(id_no),'summary',commerce.op07_summary(target),'replayed',false);
  elsif act='request' then
   if coalesce(p_data->>'policyVersion','')<>pol.id::text then return jsonb_build_object('error','PAYOUT_POLICY_CHANGED','status',409);end if;
   if not pol.enabled then return jsonb_build_object('error','PAYOUT_POLICY_DISABLED','status',409);end if;
   if not active_author or pay.author_id is null or not pay.ready or pay.revision::text is distinct from p_data->>'payeeRevision' then return jsonb_build_object('error','PAYEE_CHANGED','status',409);end if;
   if jsonb_typeof(p_data->'amountKrw') is distinct from 'number' or coalesce(p_data->>'amountKrw','')!~'^[1-9][0-9]{0,9}$' or (p_data->>'amountKrw')::bigint>1000000000 then return jsonb_build_object('error','INVALID_PAYOUT_REQUEST','status',400);end if;amount:=(p_data->>'amountKrw')::integer;
   summary:=commerce.op07_summary(target);if amount>(summary->>'availableKrw')::bigint then return jsonb_build_object('error','INSUFFICIENT_SETTLEMENT_BALANCE','status',409);end if;
   insert into commerce.op07_payouts(author_id,author_name,amount_krw,policy_id,payee_revision,test_reference,status) select target,pen_name,amount,pol.id,pay.revision,pay.test_reference,'REQUESTED' from public.authors where id=target returning id into new_id;
   result:=base||jsonb_build_object('payout',commerce.op07_payout(new_id),'summary',commerce.op07_summary(target),'replayed',false);
  else
   select * into strict po from commerce.op07_payouts where id=id_no for update;
   if po.revision::text<>p_data->>'revision' then return jsonb_build_object('error','REVISION_CONFLICT','status',409);end if;
   if act in ('cancel','reject') then
    if po.status not in ('REQUESTED','APPROVED') then return jsonb_build_object('error','PAYOUT_STATE_CONFLICT','status',409);end if;
    update commerce.op07_payouts set status=case when act='cancel' then 'CANCELLED' else 'REJECTED' end,revision=revision+1,completed_at=now() where id=id_no;
   elsif act in ('approve','begin') then
    if po.status<>(case when act='approve' then 'REQUESTED' else 'APPROVED' end) then return jsonb_build_object('error','PAYOUT_STATE_CONFLICT','status',409);end if;
    if not pol.enabled then return jsonb_build_object('error','PAYOUT_POLICY_DISABLED','status',409);end if;
    if not active_author then return jsonb_build_object('error','AUTHOR_NOT_PAYABLE','status',409);end if;
    if pay.author_id is null or not pay.ready or pay.revision<>po.payee_revision or pay.test_reference<>po.test_reference then return jsonb_build_object('error','PAYEE_CHANGED','status',409);end if;
    summary:=commerce.op07_summary(target);if (summary->>'debtKrw')::bigint>0 or (summary->>'heldKrw')::bigint>0 then return jsonb_build_object('error','SETTLEMENT_HOLD','status',409);end if;
    update commerce.op07_payouts set status=case when act='approve' then 'APPROVED' else 'UNKNOWN' end,revision=revision+1,approved_at=case when act='approve' then now() else approved_at end,dispatched_at=case when act='begin' then now() else dispatched_at end where id=id_no;
   elsif act in ('paid','fail') then
    if po.status<>'UNKNOWN' then return jsonb_build_object('error','PAYOUT_STATE_CONFLICT','status',409);end if;
    if coalesce(p_data->>'reference','')!~'^TEST-[A-Za-z0-9_-]{1,72}$' or coalesce(p_data->>'testReference','')!~'^TEST-[A-Za-z0-9_-]{1,72}$' then return jsonb_build_object('error','INVALID_PAYOUT_REQUEST','status',400);end if;
    if p_data->>'testReference'<>po.test_reference then return jsonb_build_object('error','PAYOUT_PROOF_MISMATCH','status',409);end if;
    at_time:=now();
    if act='paid' then
     if jsonb_typeof(p_data->'amountKrw') is distinct from 'number' or p_data->>'amountKrw'<>po.amount_krw::text or jsonb_typeof(p_data->'paidAt') is distinct from 'string' or coalesce(p_data->>'paidAt','')!~'^\d{4}-\d{2}-\d{2}T.*Z$' then return jsonb_build_object('error','PAYOUT_PROOF_MISMATCH','status',409);end if;
     at_time:=(p_data->>'paidAt')::timestamptz;if at_time<po.dispatched_at or at_time>clock_timestamp()+interval '5 minutes' then return jsonb_build_object('error','PAYOUT_PROOF_MISMATCH','status',409);end if;
    end if;
    if exists(select 1 from commerce.op07_evidence where reference=p_data->>'reference') then return jsonb_build_object('error','PAYOUT_EVIDENCE_CONFLICT','status',409);end if;
    insert into commerce.op07_evidence(payout_id,outcome,reference,test_reference,amount_krw,occurred_at,actor_id,reason) values(id_no,case when act='paid' then 'PAID' else 'FAILED' end,p_data->>'reference',po.test_reference,po.amount_krw,at_time,p_user,reason);
    update commerce.op07_payouts set status=case when act='paid' then 'PAID' else 'FAILED' end,revision=revision+1,completed_at=at_time where id=id_no;
   else return jsonb_build_object('error','INVALID_PAYOUT_REQUEST','status',400);end if;
   result:=base||jsonb_build_object('payout',commerce.op07_payout(id_no),'summary',commerce.op07_summary(target),'replayed',false);
  end if;
 end if;
 if items is not null then return base||jsonb_build_object('items',items,'offset',off,'limit',50,'total',total_no,'hasMore',total_no>off+50,'nextOffset',case when total_no>off+50 then off+50 else null end);end if;
 if is_write then
  insert into commerce.op07_receipts(actor_id,request_id,action,fingerprint,result) values(p_user,req,p_action,fp,result);
  insert into commerce.op07_audit(actor_id,author_id,action,detail,reason) values(p_user,target,p_action,jsonb_build_object('requestId',req,'payoutId',result#>>'{payout,id}','earningId',result#>>'{earning,id}'),reason);
 end if;
 return result;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('error','INVALID_PAYOUT_REQUEST','status',400);
 when unique_violation then return jsonb_build_object('error','PAYOUT_EVIDENCE_CONFLICT','status',409);
end $$;

do $$ declare t text;f text;begin
 foreach t in array array['op07_policies','op07_config','op07_payees','op07_earnings','op07_adjustments','op07_payouts','op07_evidence','op07_receipts','op07_write_limits','op07_audit'] loop
  execute format('alter table commerce.%I enable row level security',t);execute format('revoke all on table commerce.%I from public,anon,authenticated,service_role',t);
 end loop;
 foreach t in array array['op07_policies','op07_earnings','op07_adjustments','op07_evidence','op07_receipts','op07_audit'] loop execute format('create trigger op07_immutable before update or delete on commerce.%I for each row execute function commerce.op07_immutable()',t);end loop;
 foreach f in array array['commerce.op07_immutable()','commerce.op07_policy(uuid)','commerce.op07_payee(bigint)','commerce.op07_source_ready(uuid)','commerce.op07_summary(bigint)','commerce.op07_earning(uuid)','commerce.op07_payout(uuid)'] loop execute 'revoke all on function '||f||' from public,anon,authenticated,service_role';end loop;
end $$;
revoke all on function public.op07_payouts(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.op07_payouts(uuid,text,jsonb) to service_role;
commit;
