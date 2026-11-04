-- OP15: immutable bank allocation, exclusive earnings reservations and notification journal.
begin;
set local lock_timeout='5s';
do $$begin
 if current_setting('webnovels.commerce_allocations_apply_verified',true) is distinct from 'true'
 or to_regprocedure('public.op14_commerce_operations(uuid,text,jsonb)') is null
 or to_regclass('live_commerce.funding_plans') is not null then raise exception 'Reviewed OP15 prerequisites required';end if;
end$$;
create table live_commerce.funding_plans(id uuid primary key,kind text not null check(kind in ('CREDIT','RETURN')),order_id uuid not null references live_commerce.orders(id),amount integer not null check(amount between 1 and 1000000000),reason_ref text not null check(reason_ref~'^[A-Za-z0-9_.:/-]{3,80}$'),actor_id uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),check(kind<>'CREDIT' or amount=10000));
create table live_commerce.funding_sources(plan_id uuid not null references live_commerce.funding_plans(id),deposit_id uuid not null references live_commerce.deposits(id),amount integer not null check(amount>0),primary key(plan_id,deposit_id));
create index op15_source_deposit on live_commerce.funding_sources(deposit_id);
create table live_commerce.funding_reviews(id uuid primary key references live_commerce.funding_plans(id),approved boolean not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp());
create table live_commerce.funding_returns(id uuid primary key references live_commerce.funding_plans(id),actor_id uuid not null references auth.users(id),bank_ref_hash text not null unique check(bank_ref_hash~'^[a-f0-9]{64}$'),document_id uuid not null unique references live_commerce.documents(id),occurred_at timestamptz not null,created_at timestamptz not null default clock_timestamp());
create table live_commerce.payout_sources(payout_id uuid not null references live_commerce.payouts(id),purchase_id uuid not null references live_commerce.purchases(id),amount integer not null check(amount>0),primary key(payout_id,purchase_id));
create index op15_payout_purchase on live_commerce.payout_sources(purchase_id);
create table live_commerce.payout_recoveries(payout_id uuid not null references live_commerce.payouts(id),purchase_id uuid not null references live_commerce.purchases(id),debt_payout_id uuid not null references live_commerce.payouts(id),debt_purchase_id uuid not null references live_commerce.purchases(id),amount integer not null check(amount>0),primary key(payout_id,purchase_id,debt_payout_id,debt_purchase_id));
create index op15_recovery_purchase on live_commerce.payout_recoveries(purchase_id);
create table live_commerce.notification_outbox(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),event_type text not null check(event_type in ('POINTS_CREDITED','CORRECTION_CONFIRMED','PAYOUT_PAID','BANK_RETURNED')),target_id uuid not null,created_at timestamptz not null default clock_timestamp(),unique(event_type,target_id));
create table live_commerce.notification_attempts(id uuid primary key default gen_random_uuid(),notification_id uuid not null references live_commerce.notification_outbox(id),actor_id uuid not null references auth.users(id),attempt integer not null check(attempt between 1 and 5),outcome text not null check(outcome in ('TEST_RETRY','TEST_READY')),created_at timestamptz not null default clock_timestamp(),unique(notification_id,attempt));
-- Legacy exact-deposit lots keep their unique deposit reference. Aggregate lots use the plan ID.
alter table live_commerce.lots alter column deposit_id drop not null;
create function live_commerce.op15_deposit_remaining(d uuid) returns bigint language sql stable set search_path='' as $$
 select amount-case when exists(select 1 from live_commerce.lots l where l.deposit_id=x.id) then amount else 0 end
 -coalesce((select sum(s.amount) from live_commerce.funding_sources s where s.deposit_id=x.id and not exists(select 1 from live_commerce.funding_reviews r where r.id=s.plan_id and not r.approved)),0)
 from live_commerce.deposits x where id=d
$$;
create function live_commerce.op15_lot_guard() returns trigger language plpgsql set search_path='' as $$begin
 perform pg_advisory_xact_lock(hashtextextended('op13-financial-ledger',0));
 if new.deposit_id is not null then
  if live_commerce.op15_deposit_remaining(new.deposit_id)<>10000 then raise exception 'OP15_SOURCE_RESERVED';end if;
 elsif not exists(select 1 from live_commerce.funding_plans p join live_commerce.funding_reviews r on r.id=p.id join live_commerce.orders o on o.id=p.order_id
  where p.id=new.id and p.kind='CREDIT' and r.approved and o.id=new.order_id and o.user_id=new.user_id and new.confirmed_by=r.actor_id
  and (select sum(amount) from live_commerce.funding_sources where plan_id=p.id)=new.points) then raise exception 'OP15_SOURCE_RESERVED';end if;
 return new;
end$$;
create trigger op15_lot_guard before insert on live_commerce.lots for each row execute function live_commerce.op15_lot_guard();
create function live_commerce.op15_bank_guard() returns trigger language plpgsql set search_path='' as $$begin
 perform pg_advisory_xact_lock(hashtextextended('op13-financial-ledger',0));
 if exists(select 1 from live_commerce.deposits where bank_ref_hash=new.bank_ref_hash)
 or exists(select 1 from live_commerce.corrections where bank_ref_hash=new.bank_ref_hash)
 or exists(select 1 from live_commerce.payout_completions where bank_ref_hash=new.bank_ref_hash)
 or exists(select 1 from live_commerce.funding_returns where bank_ref_hash=new.bank_ref_hash) then raise unique_violation using message='BANK_REFERENCE_USED';end if;
 return new;
end$$;
do $$declare t text;begin foreach t in array array['deposits','corrections','payout_completions','funding_returns'] loop
 execute format('create trigger op15_bank_guard before insert on live_commerce.%I for each row execute function live_commerce.op15_bank_guard()',t);end loop;end$$;
create function live_commerce.op15_unreserved(p uuid) returns bigint language sql stable set search_path='' as $$
 select revenue-coalesce((select sum(s.amount) from live_commerce.payout_sources s where s.purchase_id=x.id and not exists(select 1 from live_commerce.payout_cancellations c where c.id=s.payout_id)),0)
 -coalesce((select sum(s.amount) from live_commerce.payout_recoveries s where s.purchase_id=x.id and not exists(select 1 from live_commerce.payout_cancellations c where c.id=s.payout_id)),0)
 from live_commerce.purchases x where id=p and not exists(select 1 from live_commerce.revocations r where r.purchase_id=x.id)
$$;
create function live_commerce.op15_reserve_payout() returns trigger language plpgsql set search_path='' as $$
declare debt record;src record;needed bigint;take_no integer;left_no bigint:=new.gross;
begin
 perform pg_advisory_xact_lock(hashtextextended('op13-financial-ledger',0));
 -- Never infer exclusive allocations from a legacy cumulative sources array.
 if exists(select 1 from live_commerce.payouts p where p.author_id=new.author_id and p.id<>new.id and not exists(select 1 from live_commerce.payout_cancellations c where c.id=p.id)
 and p.gross<>(select coalesce(sum(amount),0) from live_commerce.payout_sources where payout_id=p.id)) then raise exception 'OP15_LEGACY_RECONCILIATION_REQUIRED';end if;
 for debt in select s.*,s.amount-coalesce((select sum(r.amount) from live_commerce.payout_recoveries r where r.debt_payout_id=s.payout_id and r.debt_purchase_id=s.purchase_id and not exists(select 1 from live_commerce.revocations v where v.purchase_id=r.purchase_id) and not exists(select 1 from live_commerce.revocations v where v.purchase_id=r.purchase_id) and not exists(select 1 from live_commerce.payout_cancellations c where c.id=r.payout_id)),0) owed
 from live_commerce.payout_sources s join live_commerce.payouts p on p.id=s.payout_id join live_commerce.revocations v on v.purchase_id=s.purchase_id
 where p.author_id=new.author_id and p.owner_id=new.owner_id and not exists(select 1 from live_commerce.payout_cancellations c where c.id=p.id) order by p.created_at,p.id,s.purchase_id loop
  needed:=debt.owed;
  for src in select id from live_commerce.purchases where author_id=new.author_id and owner_id=new.owner_id order by created_at,id loop
   exit when needed<=0;take_no:=least(needed,coalesce(live_commerce.op15_unreserved(src.id),0));
   if take_no>0 then insert into live_commerce.payout_recoveries values(new.id,src.id,debt.payout_id,debt.purchase_id,take_no);needed:=needed-take_no;end if;
  end loop;
  if needed>0 then raise exception 'OP15_SOURCE_RESERVED';end if;
 end loop;
 for src in select id from live_commerce.purchases where author_id=new.author_id and owner_id=new.owner_id order by created_at,id loop
  exit when left_no<=0;take_no:=least(left_no,coalesce(live_commerce.op15_unreserved(src.id),0));
  if take_no>0 then insert into live_commerce.payout_sources values(new.id,src.id,take_no);left_no:=left_no-take_no;end if;
 end loop;
 if left_no<>0 then raise exception 'OP15_SOURCE_RESERVED';end if;return new;
end$$;
create trigger op15_reserve_payout after insert on live_commerce.payouts for each row execute function live_commerce.op15_reserve_payout();
create function live_commerce.op15_payout_guard() returns trigger language plpgsql set search_path='' as $$begin
 if (select gross from live_commerce.payouts where id=new.id)<>(select coalesce(sum(amount),0) from live_commerce.payout_sources where payout_id=new.id) then raise exception 'OP15_LEGACY_RECONCILIATION_REQUIRED';end if;
 if exists(select 1 from live_commerce.payout_sources s join live_commerce.revocations r on r.purchase_id=s.purchase_id where s.payout_id=new.id)
 or exists(select 1 from live_commerce.payout_recoveries s join live_commerce.revocations r on r.purchase_id=s.purchase_id where s.payout_id=new.id) then raise exception 'OP15_REVOKED_SOURCE';end if;
 return new;
end$$;
create trigger op15_payout_guard before insert on live_commerce.payout_approvals for each row execute function live_commerce.op15_payout_guard();
create trigger op15_payout_guard before insert on live_commerce.payout_completions for each row execute function live_commerce.op15_payout_guard();
create function live_commerce.op15_enqueue() returns trigger language plpgsql set search_path='' as $$declare uid uuid;event text;begin
 if tg_table_name='lots' then uid:=new.user_id;event:='POINTS_CREDITED';
 elsif tg_table_name='payout_completions' then select owner_id into uid from live_commerce.payouts where id=new.id;event:='PAYOUT_PAID';
 elsif tg_table_name='correction_confirmations' then select l.user_id into uid from live_commerce.corrections c join live_commerce.lots l on l.id=c.lot_id where c.id=new.id;event:='CORRECTION_CONFIRMED';
 else select o.user_id into uid from live_commerce.funding_plans p join live_commerce.orders o on o.id=p.order_id where p.id=new.id;event:='BANK_RETURNED';end if;
 insert into live_commerce.notification_outbox(user_id,event_type,target_id) values(uid,event,new.id) on conflict(event_type,target_id) do nothing;return new;
end$$;
do $$declare t text;begin foreach t in array array['lots','payout_completions','correction_confirmations','funding_returns'] loop
 execute format('create trigger op15_enqueue after insert on live_commerce.%I for each row execute function live_commerce.op15_enqueue()',t);end loop;end$$;

create function public.op15_commerce_allocations(p_user uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare who jsonb;fields text[];rid uuid;fp text;cached live_commerce.receipts;result jsonb;plan live_commerce.funding_plans;ord live_commerce.orders;dep live_commerce.deposits;review live_commerce.funding_reviews;rec record;amt bigint;off integer;is_write boolean;doc uuid;
begin
 if jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text)>310000 then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
 perform pg_advisory_xact_lock(hashtextextended('op13-financial-ledger',0));
 perform 1 from auth.users where id=p_user for share;who:=public.launch_account_actor(p_user);if who?'error' then return who;end if;
 perform 1 from public.admin_users where auth_user_id=p_user and role::text='SUPER_ADMIN' and is_active for share;
 if not found or who->'admin'->>'role' is distinct from 'SUPER_ADMIN' then return '{"error":"ADMIN_FORBIDDEN","status":403}';end if;
 fields:=case p_action when 'funding-list' then array['offset'] when 'funding-propose' then array['requestId','kind','orderId','sources','reasonRef','destinationHash','reassignmentConfirmed']
 when 'funding-review' then array['requestId','planId','approved','destinationHash'] when 'funding-return' then array['requestId','planId','amount','occurredAt','bankRefHash','evidence']
 when 'payout-sources' then array['payoutId'] when 'notification-list' then array['offset'] when 'notification-test' then array['requestId','notificationId','expectedAttempt','outcome'] end;
 if fields is null or exists(select 1 from jsonb_object_keys(p_data) k where not k=any(fields)) then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
 is_write:=p_action in ('funding-propose','funding-review','funding-return','notification-test');
 if is_write then
  rid:=(p_data->>'requestId')::uuid;if rid is null then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
  fp:=encode(sha256(convert_to('op15:'||p_action||':'||(p_data #- '{evidence,envelope}')::text,'UTF8')),'hex');select * into cached from live_commerce.receipts where actor_id=p_user and request_id=rid;
  if found then if fp<>cached.fingerprint then return '{"error":"IDEMPOTENCY_CONFLICT","status":409}';end if;return cached.result||'{"replayed":true}';end if;
 end if;
 if exists(select 1 from live_commerce.limits where actor_id=p_user and window_at>now()-interval '1 minute' and calls>=120) then return '{"error":"RATE_LIMITED","status":429}';end if;
 insert into live_commerce.limits values(p_user,now(),1) on conflict(actor_id) do update set calls=case when limits.window_at>now()-interval '1 minute' then limits.calls+1 else 1 end,window_at=case when limits.window_at>now()-interval '1 minute' then limits.window_at else now() end;
 off:=coalesce((p_data->>'offset')::integer,0);if off not between 0 and 100000 then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
 if p_action='funding-list' then
  result:=jsonb_build_object('deposits',(select coalesce(jsonb_agg(x.row),'[]') from(select jsonb_build_object('id',d.id,'orderId',d.order_id,'amount',d.amount,'available',live_commerce.op15_deposit_remaining(d.id)::text) row from live_commerce.deposits d where live_commerce.op15_deposit_remaining(d.id)>0 order by d.created_at desc,d.id offset off limit 30)x),
  'plans',(select coalesce(jsonb_agg(x.row),'[]') from(select jsonb_build_object('id',p.id,'kind',p.kind,'orderId',p.order_id,'amount',p.amount,'actorId',p.actor_id,'reasonRef',p.reason_ref,'createdAt',p.created_at,'status',case when exists(select 1 from live_commerce.funding_returns r where r.id=p.id) then 'RETURNED' when v.approved and p.kind='CREDIT' then 'CREDITED' when v.approved then 'RETURN_APPROVED' when v.approved=false then 'REJECTED' else 'PENDING' end,'sources',(select jsonb_agg(jsonb_build_object('depositId',s.deposit_id,'amount',s.amount) order by s.deposit_id) from live_commerce.funding_sources s where s.plan_id=p.id)) row from live_commerce.funding_plans p left join live_commerce.funding_reviews v on v.id=p.id order by p.created_at desc,p.id offset off limit 30)x));
 elsif p_action='funding-propose' then
  select * into ord from live_commerce.orders where id=(p_data->>'orderId')::uuid;
  if ord.id is null or ord.user_id=p_user or p_data->>'kind' not in ('CREDIT','RETURN') or p_data->>'kind' is null then return '{"error":"ORDER_NOT_READY","status":409}';end if;
  if p_data->>'kind'='CREDIT' and (ord.destination_hash is distinct from p_data->>'destinationHash' or exists(select 1 from live_commerce.lots where order_id=ord.id) or exists(select 1 from live_commerce.funding_plans p where p.order_id=ord.id and p.kind='CREDIT' and not exists(select 1 from live_commerce.funding_reviews r where r.id=p.id and not r.approved))) then return '{"error":"ORDER_NOT_READY","status":409}';end if;
  if jsonb_typeof(p_data->'sources') is distinct from 'array' or jsonb_array_length(p_data->'sources') not between 1 and 20 or coalesce(p_data->>'reasonRef','')!~'^[A-Za-z0-9_.:/-]{3,80}$' then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
  amt:=0;
  for rec in select value v from jsonb_array_elements(p_data->'sources') loop
   if jsonb_typeof(rec.v) is distinct from 'object' or exists(select 1 from jsonb_object_keys(rec.v) k where k not in ('depositId','amount')) or jsonb_typeof(rec.v->'amount') is distinct from 'number' or rec.v->>'amount'!~'^[1-9][0-9]{0,8}$' then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
   select * into dep from live_commerce.deposits where id=(rec.v->>'depositId')::uuid;
   if dep.id is null or live_commerce.op15_deposit_remaining(dep.id)<(rec.v->>'amount')::integer then return '{"error":"OP15_SOURCE_RESERVED","status":409}';end if;
   if (select user_id from live_commerce.orders where id=dep.order_id)=p_user then return '{"error":"INDEPENDENT_REVIEW_REQUIRED","status":403}';end if;
   if dep.order_id<>ord.id and (p_data->'reassignmentConfirmed' is distinct from 'true'::jsonb or p_data->>'kind'='RETURN') then return '{"error":"OP15_REASSIGNMENT_REQUIRED","status":409}';end if;
   if p_data->>'kind'='CREDIT' and (select destination_hash from live_commerce.orders where id=dep.order_id)<>ord.destination_hash then return '{"error":"ORDER_NOT_READY","status":409}';end if;
   if live_commerce.op14_held('DEPOSIT',dep.id) then return '{"error":"OP14_CASE_OPEN","status":409}';end if;
   if not exists(select 1 from live_commerce.documents where id=live_commerce.op14_document('DEPOSIT',dep.id,dep.document_id) and envelope is not null and expires_at>clock_timestamp()) then return '{"error":"DOCUMENT_UNAVAILABLE","status":409}';end if;
   amt:=amt+(rec.v->>'amount')::integer;
  end loop;
  if amt not between 1 and 1000000000 or p_data->>'kind'='CREDIT' and amt<>10000 then return '{"error":"AMOUNT_MISMATCH","status":409}';end if;
  insert into live_commerce.funding_plans(id,kind,order_id,amount,reason_ref,actor_id) values(rid,p_data->>'kind',ord.id,amt,p_data->>'reasonRef',p_user);
  insert into live_commerce.funding_sources select rid,(v->>'depositId')::uuid,(v->>'amount')::integer from jsonb_array_elements(p_data->'sources') v;
  result:=jsonb_build_object('id',rid);
 elsif p_action in ('funding-review','funding-return') then
  select * into plan from live_commerce.funding_plans where id=(p_data->>'planId')::uuid;select * into ord from live_commerce.orders where id=plan.order_id;
  select * into review from live_commerce.funding_reviews where id=plan.id;
  if plan.id is null then return '{"error":"ORDER_NOT_READY","status":409}';end if;
  if p_user=ord.user_id or p_user=plan.actor_id or exists(select 1 from live_commerce.funding_sources s join live_commerce.deposits d on d.id=s.deposit_id join live_commerce.orders o on o.id=d.order_id where s.plan_id=plan.id and (o.user_id=p_user or d.recorded_by=p_user)) then return '{"error":"INDEPENDENT_REVIEW_REQUIRED","status":403}';end if;
  if p_action='funding-review' then
   if review.id is not null or jsonb_typeof(p_data->'approved') is distinct from 'boolean' then return '{"error":"OP15_PLAN_CHANGED","status":409}';end if;
   if (p_data->>'approved')::boolean then
    perform 1 from auth.users where id=ord.user_id for share;perform 1 from public.readers where auth_user_id=ord.user_id for share;
    if exists(select 1 from live_commerce.funding_sources s join live_commerce.deposits d on d.id=s.deposit_id where s.plan_id=plan.id and (live_commerce.op14_held('DEPOSIT',d.id) or not exists(select 1 from live_commerce.documents x where x.id=live_commerce.op14_document('DEPOSIT',d.id,d.document_id) and x.envelope is not null and x.expires_at>clock_timestamp()))) then return '{"error":"DOCUMENT_UNAVAILABLE","status":409}';end if;
    if plan.kind='CREDIT' and (ord.destination_hash is distinct from p_data->>'destinationHash' or exists(select 1 from live_commerce.lots where order_id=ord.id) or live_commerce.balance(ord.user_id)+10000>1000000000 or not exists(select 1 from public.readers r join auth.users u on u.id=r.auth_user_id where u.id=ord.user_id and r.status::text='ACTIVE' and u.email_confirmed_at is not null and u.is_anonymous is not true and (u.banned_until is null or u.banned_until<=now()) and coalesce(to_jsonb(u)->>'deleted_at','')='')) then return '{"error":"ORDER_NOT_READY","status":409}';end if;
   end if;
   insert into live_commerce.funding_reviews(id,approved,actor_id) values(plan.id,(p_data->>'approved')::boolean,p_user);
   if (p_data->>'approved')::boolean and plan.kind='CREDIT' then insert into live_commerce.lots values(plan.id,ord.id,null,ord.user_id,10000,p_user,clock_timestamp());end if;
  else
   if plan.kind<>'RETURN' or review.approved is distinct from true or p_user=review.actor_id or exists(select 1 from live_commerce.funding_returns where id=plan.id) then return '{"error":"OP15_PLAN_CHANGED","status":409}';end if;
   if (p_data->>'amount')::integer is distinct from plan.amount or (p_data->>'occurredAt')::timestamptz<review.created_at or (p_data->>'occurredAt')::timestamptz>clock_timestamp() or p_data->>'occurredAt' is null then return '{"error":"AMOUNT_MISMATCH","status":409}';end if;
   doc:=live_commerce.save_evidence(p_user,'REFUND',p_data->'evidence');
   insert into live_commerce.funding_returns(id,actor_id,bank_ref_hash,document_id,occurred_at) values(plan.id,p_user,p_data->>'bankRefHash',doc,(p_data->>'occurredAt')::timestamptz);
  end if;result:=jsonb_build_object('id',plan.id);
 elsif p_action='payout-sources' then
  result:=jsonb_build_object('id',(p_data->>'payoutId')::uuid,'legacyReconciliationRequired',exists(select 1 from live_commerce.payouts p where p.id=(p_data->>'payoutId')::uuid and p.gross<>(select coalesce(sum(amount),0) from live_commerce.payout_sources where payout_id=p.id)),
   'sources',(select coalesce(jsonb_agg(jsonb_build_object('purchaseId',purchase_id,'amount',amount) order by purchase_id),'[]') from live_commerce.payout_sources where payout_id=(p_data->>'payoutId')::uuid),
   'recoveries',(select coalesce(jsonb_agg(jsonb_build_object('purchaseId',purchase_id,'debtPayoutId',debt_payout_id,'debtPurchaseId',debt_purchase_id,'amount',amount) order by purchase_id,debt_payout_id,debt_purchase_id),'[]') from live_commerce.payout_recoveries where payout_id=(p_data->>'payoutId')::uuid));
 elsif p_action='notification-list' then
  result:=jsonb_build_object('deliveryEnabled',false,'items',(select coalesce(jsonb_agg(x.row),'[]') from(select jsonb_build_object('id',n.id,'userId',n.user_id,'eventType',n.event_type,'targetId',n.target_id,'createdAt',n.created_at,'attempt',(select count(*) from live_commerce.notification_attempts a where a.notification_id=n.id),'outcome',coalesce((select outcome from live_commerce.notification_attempts a where a.notification_id=n.id order by attempt desc limit 1),'NOT_SENT')) row from live_commerce.notification_outbox n order by n.created_at desc,n.id offset off limit 30)x));
 elsif p_action='notification-test' then
  if not exists(select 1 from live_commerce.notification_outbox where id=(p_data->>'notificationId')::uuid) or p_data->>'outcome' not in ('TEST_RETRY','TEST_READY') or p_data->>'outcome' is null then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
  select count(*) into amt from live_commerce.notification_attempts where notification_id=(p_data->>'notificationId')::uuid;
  if amt>=5 or amt is distinct from (p_data->>'expectedAttempt')::integer or exists(select 1 from live_commerce.notification_attempts where notification_id=(p_data->>'notificationId')::uuid and outcome='TEST_READY') then return '{"error":"OP15_PLAN_CHANGED","status":409}';end if;
  insert into live_commerce.notification_attempts(notification_id,actor_id,attempt,outcome) values((p_data->>'notificationId')::uuid,p_user,amt+1,p_data->>'outcome');result:=jsonb_build_object('id',rid);
 end if;
 if result is null then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
 result:=result||'{"mode":"LIVE_MANUAL","source":"BANK_RECONCILED"}';
 if is_write then insert into live_commerce.receipts values(p_user,rid,fp,result);insert into live_commerce.audit(actor_id,action,target_id) values(p_user,p_action,rid);end if;return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or not_null_violation or check_violation then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';when unique_violation then return '{"error":"COMMERCE_CONFLICT","status":409}';
end$$;

do $$declare t text;f record;begin
 foreach t in array array['funding_plans','funding_sources','funding_reviews','funding_returns','payout_sources','payout_recoveries','notification_outbox','notification_attempts'] loop
  execute format('alter table live_commerce.%I enable row level security',t);
  execute format('revoke all on live_commerce.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger op15_immutable before update or delete on live_commerce.%I for each row execute function live_commerce.immutable()',t);
 end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='live_commerce' and p.proname like 'op15_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end$$;
revoke all on function public.op15_commerce_allocations(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.op15_commerce_allocations(uuid,text,jsonb) to service_role;
-- Static OP13 compatibility: translate new trigger guards without changing existing financial actions.
create or replace function public.op13_commerce(p_user uuid,p_role text,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare who jsonb;fields text[];rid uuid;fp text;cached live_commerce.receipts;result jsonb;items jsonb;rec record;ep record;panel record;
 pol live_commerce.policies;ord live_commerce.orders;dep live_commerce.deposits;lot live_commerce.lots;qt live_commerce.quotes;pay live_commerce.payouts;approval live_commerce.payout_approvals;corr live_commerce.corrections;
 aid bigint;uid uuid;eid bigint;remaining integer;take_points integer;amount_no integer;facts jsonb;offset_no integer;write_action boolean;document_key uuid;
begin
 if p_role not in ('reader','admin','author') or p_role is null or jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text)>310000 then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
 -- One bounded financial critical section; no external network calls under this lock.
 perform pg_advisory_xact_lock(hashtextextended('op13-financial-ledger',0));
 perform 1 from auth.users where id=p_user for share;
 who:=public.launch_account_actor(p_user);if who?'error' then return who;end if;
 if p_role='admin' then
  perform 1 from public.admin_users where auth_user_id=p_user and role::text='SUPER_ADMIN' and is_active for share;
  if not found or who->'admin'->>'role' is distinct from 'SUPER_ADMIN' then return '{"error":"ADMIN_FORBIDDEN","status":403}';end if;
 elsif p_role='reader' then
  perform 1 from public.readers where auth_user_id=p_user and status::text='ACTIVE' for share;
  if not found or who->'reader'->>'status' is distinct from 'ACTIVE' then return '{"error":"READER_REQUIRED","status":403}';end if;
 else
  if who->'author'->>'status' is distinct from 'APPROVED' then return '{"error":"AUTHOR_REQUIRED","status":403}';end if;
  aid:=(who->'author'->>'id')::bigint;
 end if;
 fields:=case p_role||':'||p_action
 when 'reader:state' then array['offset'] when 'reader:episodes' then array['workId','offset']
 when 'reader:order' then array['requestId','destinationHash'] when 'reader:quote' then array['episodeId']
 when 'reader:purchase' then array['quoteId','requestId'] when 'reader:content' then array['episodeId']
 when 'reader:panel' then array['episodeId','versionId','panelId','format']
 when 'author:state' then array[]::text[] when 'author:request' then array['requestId','binding']
 when 'admin:list' then array['query','offset'] when 'admin:policy' then array['requestId','workId','price','shareBps','contractRef','expectedPolicyId']
 when 'admin:deposit' then array['requestId','orderId','amount','bankRefHash','occurredAt','evidence','destinationHash']
 when 'admin:confirm' then array['requestId','depositId']
 when 'admin:correction' then array['requestId','lotId','kind','amount','bankRefHash','evidence']
 when 'admin:confirm-correction' then array['requestId','correctionId'] when 'admin:reject-correction' then array['requestId','correctionId']
 when 'admin:approve' then array['requestId','payoutId','deduction','basisRef']
 when 'admin:complete' then array['requestId','payoutId','net','bankRefHash','occurredAt','evidence']
 when 'admin:cancel' then array['requestId','payoutId','notTransferredConfirmed','reasonRef'] when 'admin:reveal' then array['documentId'] end;
 if fields is null or exists(select 1 from jsonb_object_keys(p_data) k where not k=any(fields)) then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
 if exists(select 1 from jsonb_each(p_data) e where e.key=any(array['requestId','orderId','quoteId','depositId','lotId','correctionId','payoutId','documentId','versionId','panelId']) and (jsonb_typeof(e.value)<>'string' or e.value#>>'{}'!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'))
 or exists(select 1 from jsonb_each(p_data) e where e.key=any(array['workId','episodeId']) and (jsonb_typeof(e.value)<>'string' or e.value#>>'{}'!~'^[1-9][0-9]{0,17}$'))
 or exists(select 1 from jsonb_each(p_data) e where e.key=any(array['amount','price','shareBps','deduction','net','offset']) and (jsonb_typeof(e.value)<>'number' or e.value#>>'{}'!~'^(0|[1-9][0-9]{0,8})$')) then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
 write_action:=p_action in ('order','purchase','request','policy','deposit','confirm','correction','confirm-correction','reject-correction','approve','complete','cancel');
 if write_action then
  if not p_data?'requestId' then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
  rid:=(p_data->>'requestId')::uuid;
  fp:=encode(sha256(convert_to(p_role||':'||p_action||':'||(p_data #- '{evidence,envelope}')::text,'UTF8')),'hex');
  select * into cached from live_commerce.receipts where actor_id=p_user and request_id=rid;
  if found then if cached.fingerprint<>fp then return '{"error":"IDEMPOTENCY_CONFLICT","status":409}';end if;return cached.result||'{"replayed":true}';end if;
 end if;
 if exists(select 1 from live_commerce.limits where actor_id=p_user and window_at>now()-interval '1 minute' and calls>=120) then return '{"error":"RATE_LIMITED","status":429}';end if;
 insert into live_commerce.limits values(p_user,now(),1) on conflict(actor_id) do update set calls=case when limits.window_at>now()-interval '1 minute' then limits.calls+1 else 1 end,window_at=case when limits.window_at>now()-interval '1 minute' then limits.window_at else now() end;
 offset_no:=coalesce((p_data->>'offset')::integer,0);if offset_no>100000 then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
 if p_action='reveal' then
  select * into rec from live_commerce.documents where id=(p_data->>'documentId')::uuid and envelope is not null and expires_at>now();
  if not found then return '{"error":"DOCUMENT_UNAVAILABLE","status":404}';end if;
  insert into live_commerce.audit(actor_id,action,target_id) values(p_user,'REVEAL',rec.id);
  return jsonb_build_object('documentId',rec.id,'actorId',rec.actor_id,'purpose',rec.purpose,'digest',rec.digest,'envelope',rec.envelope);
 end if;
 if p_action='list' then
  if jsonb_typeof(p_data->'query') is distinct from 'string' or length(p_data->>'query')>80 then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
  select coalesce(jsonb_agg(x.item order by x.created_at desc,x.id),'[]') into items from (
   select o.id,o.created_at,jsonb_build_object('id',o.id,'userId',o.user_id,'amount',o.amount,'destinationHash',o.destination_hash,'lotId',(select id from live_commerce.lots where order_id=o.id),'confirmed',exists(select 1 from live_commerce.lots l where l.order_id=o.id),'deposits',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'amount',d.amount,'available',live_commerce.op15_deposit_remaining(d.id)::text,'documentId',d.document_id,'recordedBy',d.recorded_by)) from live_commerce.deposits d where d.order_id=o.id),'[]')) item
   from live_commerce.orders o where p_data->>'query'='' or o.id::text=p_data->>'query' or o.user_id::text=p_data->>'query' order by o.created_at desc,o.id offset offset_no limit 30)x;
  result:=jsonb_build_object('orders',items);
  select coalesce(jsonb_agg(x.item order by x.id),'[]') into items from(select w.id,jsonb_build_object('id',w.id::text,'title',w.title,'author',a.pen_name,'policyId',c.policy_id,'price',p.price,'shareBps',p.share_bps) item from public.works w join public.authors a on a.id=w.author_id left join live_commerce.catalog c on c.work_id=w.id left join live_commerce.policies p on p.id=c.policy_id where p_data->>'query'='' or w.id::text=p_data->>'query' or strpos(lower(w.title),lower(p_data->>'query'))>0 order by w.id offset offset_no limit 30)x;
  result:=result||jsonb_build_object('works',items);
  select coalesce(jsonb_agg(x.item order by x.created_at desc,x.id),'[]') into items from(select p.id,p.created_at,live_commerce.payout_card(p.id) item from live_commerce.payouts p join public.authors a on a.id=p.author_id where p_data->>'query'='' or p.id::text=p_data->>'query' or p.author_id::text=p_data->>'query' or strpos(lower(coalesce(a.pen_name,'')),lower(p_data->>'query'))>0 order by p.created_at desc,p.id offset offset_no limit 30)x;
  result:=result||jsonb_build_object('payouts',items,'corrections',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'amount',c.amount,'documentId',c.document_id,'recordedBy',c.recorded_by)),'[]') from (select * from live_commerce.corrections where not exists(select 1 from live_commerce.correction_confirmations x where x.id=corrections.id) and not exists(select 1 from live_commerce.correction_rejections x where x.id=corrections.id) order by created_at,id offset offset_no limit 30)c));
 elsif p_action='state' and p_role='reader' then
  result:=jsonb_build_object('balance',live_commerce.balance(p_user),'orders',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'amount',o.amount,'confirmed',exists(select 1 from live_commerce.lots l where l.order_id=o.id)) order by o.created_at desc),'[]') from (select * from live_commerce.orders where user_id=p_user order by created_at desc,id limit 30)o),
  'lots',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'remaining',live_commerce.remaining(l.id)) order by l.created_at),'[]') from(select * from live_commerce.lots where user_id=p_user order by created_at desc,id limit 30)l),
  'works',(select coalesce(jsonb_agg(jsonb_build_object('id',w.id::text,'title',w.title,'type',w.content_type) order by w.id),'[]') from(select w.* from public.works w join live_commerce.catalog c on c.work_id=w.id where live_commerce.work_visible(w.id) order by w.id offset offset_no limit 30)w));
 elsif p_role='author' and p_action in ('state','request') then
  perform 1 from launch_recovery.virtual_accounts where kind='author' and profile_id=aid::text for update;
  select auth_user_id into uid from public.authors where id=aid and status::text='APPROVED' for update;
  if uid is distinct from p_user then return '{"error":"AUTHOR_REQUIRED","status":403}';end if;
  perform 1 from launch_recovery.author_payout_details where author_id=aid for update;
  perform 1 from launch_recovery.author_settlement_applications where author_id=aid for update;
  facts:=launch_recovery.op12_facts(aid);
  if p_action='state' then
   result:=jsonb_build_object('available',live_commerce.earnings(aid,uid),'binding',facts->>'binding','bankConfirmed',facts->'bankConfirmed','payouts',(select coalesce(jsonb_agg(live_commerce.payout_card(p.id) order by p.created_at desc),'[]') from(select * from live_commerce.payouts where author_id=aid and owner_id=uid order by created_at desc,id limit 30)p));
  else
   amount_no:=live_commerce.earnings(aid,uid);
   if facts->>'bankConfirmed'<>'true' or p_data->>'binding' is distinct from facts->>'binding' or amount_no<=0 or amount_no>1000000000 then return '{"error":"PAYOUT_NOT_READY","status":409}';end if;
   if exists(select 1 from live_commerce.payouts p where p.author_id=aid and not exists(select 1 from live_commerce.payout_completions c where c.id=p.id) and not exists(select 1 from live_commerce.payout_cancellations c where c.id=p.id)) then return '{"error":"PAYOUT_PENDING","status":409}';end if;
   select coalesce(jsonb_agg(p.id order by p.created_at,p.id),'[]') into items from live_commerce.purchases p where p.author_id=aid and p.owner_id=uid and not exists(select 1 from live_commerce.revocations r where r.purchase_id=p.id);
   insert into live_commerce.payouts values(rid,aid,uid,amount_no,facts->>'binding',(facts->>'reviewId')::uuid,items,now());result:=jsonb_build_object('id',rid,'gross',amount_no);
  end if;
 elsif p_action='policy' then
  select w.author_id,a.auth_user_id into aid,uid from public.works w join public.authors a on a.id=w.author_id where w.id=(p_data->>'workId')::bigint and a.status::text='APPROVED' for share of w,a;
  if aid is null or (p_data->>'price')::integer not between 1 and 1000000 or (p_data->>'shareBps')::integer not between 1 and 10000 or coalesce(length(p_data->>'contractRef'),0) not between 3 and 80 then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
  if (select policy_id::text from live_commerce.catalog where work_id=(p_data->>'workId')::bigint) is distinct from p_data->>'expectedPolicyId' then return '{"error":"PRICE_CHANGED","status":409}';end if;
  insert into live_commerce.policies values(rid,(p_data->>'workId')::bigint,aid,uid,(p_data->>'price')::integer,(p_data->>'shareBps')::integer,p_data->>'contractRef',p_user,now());
  insert into live_commerce.catalog values((p_data->>'workId')::bigint,rid) on conflict(work_id) do update set policy_id=excluded.policy_id;result:=jsonb_build_object('id',rid);
 elsif p_action='order' then
  if coalesce(p_data->>'destinationHash','')!~'^[a-f0-9]{64}$' then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
  insert into live_commerce.orders(id,user_id,destination_hash) values(rid,p_user,p_data->>'destinationHash');result:=jsonb_build_object('id',rid,'amount',10000,'points',10000);
 elsif p_action in ('deposit','correction','complete') then
  if coalesce(p_data->>'bankRefHash','')!~'^[a-f0-9]{64}$' or not live_commerce.valid_evidence(p_data->'evidence') then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
  if exists(select 1 from live_commerce.deposits where bank_ref_hash=p_data->>'bankRefHash') or exists(select 1 from live_commerce.corrections where bank_ref_hash=p_data->>'bankRefHash') or exists(select 1 from live_commerce.payout_completions where bank_ref_hash=p_data->>'bankRefHash') then return '{"error":"BANK_REFERENCE_USED","status":409}';end if;
  if p_action='deposit' then
   select * into ord from live_commerce.orders where id=(p_data->>'orderId')::uuid;
   if ord.destination_hash is distinct from p_data->>'destinationHash' then return '{"error":"ORDER_NOT_READY","status":409}';end if;
   if ord.id is null or ord.user_id=p_user or exists(select 1 from live_commerce.lots where order_id=ord.id) then return '{"error":"ORDER_NOT_READY","status":409}';end if;
   if coalesce((p_data->>'amount')::integer,0)<1 or (p_data->>'occurredAt')::timestamptz>now() or (p_data->>'occurredAt')::timestamptz<ord.created_at-interval '1 day' then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
   document_key:=live_commerce.save_evidence(p_user,'BANK_DEPOSIT',p_data->'evidence');
   insert into live_commerce.deposits values(rid,ord.id,p_data->>'bankRefHash',(p_data->>'amount')::integer,document_key,p_user,(p_data->>'occurredAt')::timestamptz,now());
  elsif p_action='correction' then
   select * into lot from live_commerce.lots where id=(p_data->>'lotId')::uuid;
   if lot.id is null or lot.user_id=p_user or p_data->>'kind' not in ('REFUND','BANK_REVERSAL') or exists(select 1 from live_commerce.corrections c where c.lot_id=lot.id and c.kind='BANK_REVERSAL' and not exists(select 1 from live_commerce.correction_rejections r where r.id=c.id)) then return '{"error":"CORRECTION_NOT_READY","status":409}';end if;
   amount_no:=case when p_data->>'kind'='REFUND' then live_commerce.remaining(lot.id) else lot.points end;
   if amount_no<=0 or (p_data->>'amount')::integer is distinct from amount_no then return '{"error":"AMOUNT_MISMATCH","status":409}';end if;
   document_key:=live_commerce.save_evidence(p_user,p_data->>'kind',p_data->'evidence');
   insert into live_commerce.corrections values(rid,lot.id,p_data->>'kind',amount_no,document_key,p_data->>'bankRefHash',p_user,now());
  else
   select * into pay from live_commerce.payouts where id=(p_data->>'payoutId')::uuid;
   select * into approval from live_commerce.payout_approvals where id=pay.id;
   if pay.id is null or approval.id is null or p_user in (pay.owner_id,approval.actor_id) or exists(select 1 from live_commerce.payout_completions where id=pay.id) or exists(select 1 from live_commerce.payout_cancellations where id=pay.id) then return '{"error":"PAYOUT_NOT_READY","status":409}';end if;
   if not live_commerce.payout_ready(pay.id) then return '{"error":"PAYOUT_NOT_READY","status":409}';end if;
   if (p_data->>'net')::integer is distinct from pay.gross-approval.deduction or (p_data->>'occurredAt')::timestamptz<approval.created_at or (p_data->>'occurredAt')::timestamptz>now() then return '{"error":"AMOUNT_MISMATCH","status":409}';end if;
   document_key:=live_commerce.save_evidence(p_user,'MANUAL_EXTERNAL',p_data->'evidence');
   insert into live_commerce.payout_completions values(pay.id,p_user,(p_data->>'net')::integer,p_data->>'bankRefHash',document_key,(p_data->>'occurredAt')::timestamptz,now());
  end if;result:=jsonb_build_object('id',rid);
 elsif p_action='confirm' then
  select * into dep from live_commerce.deposits where id=(p_data->>'depositId')::uuid;
  select * into ord from live_commerce.orders where id=dep.order_id;
  if dep.id is null or p_user in (dep.recorded_by,ord.user_id) then return '{"error":"INDEPENDENT_REVIEW_REQUIRED","status":403}';end if;
  if dep.amount<>ord.amount then return '{"error":"AMOUNT_MISMATCH","status":409}';end if;
  if not exists(select 1 from live_commerce.documents where id=live_commerce.op14_document('DEPOSIT',dep.id,dep.document_id) and envelope is not null and expires_at>clock_timestamp()) then return '{"error":"DOCUMENT_UNAVAILABLE","status":409}';end if;
  if live_commerce.op14_held('DEPOSIT',dep.id) then return '{"error":"OP14_CASE_OPEN","status":409}';end if;
  if live_commerce.balance(ord.user_id)+ord.points>1000000000 then return '{"error":"COMMERCE_CONFLICT","status":409}';end if;
  insert into live_commerce.lots values(rid,ord.id,dep.id,ord.user_id,ord.points,p_user,now());result:=jsonb_build_object('id',rid,'points',ord.points);
 elsif p_action in ('confirm-correction','reject-correction') then
  select * into corr from live_commerce.corrections where id=(p_data->>'correctionId')::uuid;
  select * into lot from live_commerce.lots where id=corr.lot_id;
  if corr.id is null or p_user in (corr.recorded_by,lot.user_id) then return '{"error":"INDEPENDENT_REVIEW_REQUIRED","status":403}';end if;
  if exists(select 1 from live_commerce.correction_rejections where id=corr.id) or exists(select 1 from live_commerce.correction_confirmations where id=corr.id) then return '{"error":"CORRECTION_NOT_READY","status":409}';end if;
  if p_action='confirm-correction' and not exists(select 1 from live_commerce.documents where id=live_commerce.op14_document('CORRECTION',corr.id,corr.document_id) and envelope is not null and expires_at>clock_timestamp()) then return '{"error":"DOCUMENT_UNAVAILABLE","status":409}';end if;
  if p_action='confirm-correction' and live_commerce.op14_held('CORRECTION',corr.id) then return '{"error":"OP14_CASE_OPEN","status":409}';end if;
  if p_action='reject-correction' then insert into live_commerce.correction_rejections values(corr.id,p_user,now());
  else
   insert into live_commerce.correction_confirmations values(corr.id,p_user,now());
   if corr.kind='BANK_REVERSAL' then insert into live_commerce.revocations(purchase_id,correction_id) select purchase_id,corr.id from live_commerce.allocations where lot_id=lot.id on conflict do nothing;end if;
  end if;
  result:=jsonb_build_object('id',corr.id);
 elsif p_action in ('approve','cancel') then
  select * into pay from live_commerce.payouts where id=(p_data->>'payoutId')::uuid;
  if pay.id is null or pay.owner_id=p_user or exists(select 1 from live_commerce.payout_completions where id=pay.id) or exists(select 1 from live_commerce.payout_cancellations where id=pay.id) then return '{"error":"PAYOUT_NOT_READY","status":409}';end if;
  if p_action='cancel' then
   if p_data->'notTransferredConfirmed' is distinct from 'true'::jsonb or coalesce(length(p_data->>'reasonRef'),0) not between 3 and 80 or exists(select 1 from live_commerce.payout_approvals where id=pay.id and actor_id=p_user) then return '{"error":"INDEPENDENT_REVIEW_REQUIRED","status":403}';end if;
   insert into live_commerce.payout_cancellations values(pay.id,p_user,p_data->>'reasonRef',now());
  else
   if not live_commerce.payout_ready(pay.id) then return '{"error":"PAYOUT_NOT_READY","status":409}';end if;
   if coalesce((p_data->>'deduction')::integer,-1) not between 0 and pay.gross-1 or coalesce(length(p_data->>'basisRef'),0) not between 3 and 80 then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
   insert into live_commerce.payout_approvals values(pay.id,p_user,(p_data->>'deduction')::integer,p_data->>'basisRef',now());
  end if;result:=jsonb_build_object('id',pay.id);
 elsif p_action='episodes' then
  select coalesce(jsonb_agg(jsonb_build_object('id',e.episode_id::text,'number',e.episode_number,'title',e.title,'price',case when e.episode_number<=2 then 0 else p.price end,'owned',live_commerce.owned(p_user,e.episode_id)) order by e.episode_number),'[]') into items from (select * from live_commerce.episode_rows((p_data->>'workId')::bigint) order by episode_number offset offset_no limit 30)e join live_commerce.catalog c on c.work_id=e.work_id join live_commerce.policies p on p.id=c.policy_id;
  result:=jsonb_build_object('episodes',items);
 elsif p_action in ('quote','purchase','content','panel') then
  if p_action='purchase' then select * into qt from live_commerce.quotes where id=(p_data->>'quoteId')::uuid and user_id=p_user;eid:=qt.episode_id;else eid:=(p_data->>'episodeId')::bigint;end if;
  perform 1 from public.works w join public.episodes e on e.work_id=w.id where e.id=eid for share of w;
  perform 1 from authoring.work_state s join public.episodes e on e.work_id=s.work_id where e.id=eid for share of s;
  perform 1 from public.episodes where id=eid for share;perform 1 from authoring.publication_heads where episode_id=eid for share;
  select * into ep from live_commerce.episode_rows() where episode_id=eid;
  select p.* into pol from live_commerce.policies p join live_commerce.catalog c on c.policy_id=p.id where c.work_id=ep.work_id;
  if ep.episode_id is null or pol.id is null or pol.author_id<>ep.author_id or pol.owner_id is distinct from (select auth_user_id from public.authors where id=ep.author_id) then return '{"error":"CONTENT_NOT_AVAILABLE","status":404}';end if;
  amount_no:=case when ep.episode_number<=2 or live_commerce.owned(p_user,eid) then 0 else pol.price end;
  if p_action='quote' then
   insert into live_commerce.quotes(id,user_id,episode_id,publication_id,policy_id,price) values(gen_random_uuid(),p_user,eid,ep.version_id,pol.id,amount_no) returning * into qt;
   result:=jsonb_build_object('id',qt.id,'episodeId',eid::text,'price',amount_no,'expiresAt',qt.expires_at,'balance',live_commerce.balance(p_user));
  elsif p_action='purchase' then
   if qt.id is null or qt.expires_at<=now() or qt.policy_id<>pol.id or qt.publication_id<>ep.version_id then return '{"error":"PRICE_CHANGED","status":409}';end if;
   if amount_no>0 then
    if qt.price<>amount_no or live_commerce.balance(p_user)<amount_no then return '{"error":"INSUFFICIENT_POINTS","status":409}';end if;
    insert into live_commerce.purchases values(rid,p_user,eid,ep.version_id,pol.id,pol.author_id,pol.owner_id,amount_no,floor(amount_no::numeric*pol.share_bps/10000)::integer,now());remaining:=amount_no;
    for lot in select * from live_commerce.lots where user_id=p_user order by created_at,id loop
     take_points:=least(remaining,live_commerce.remaining(lot.id));if take_points>0 then insert into live_commerce.allocations values(rid,lot.id,take_points);remaining:=remaining-take_points;end if;exit when remaining=0;
    end loop;if remaining<>0 then raise exception 'OP13 allocation invariant';end if;
   end if;result:=jsonb_build_object('id',rid,'charged',amount_no,'balance',live_commerce.balance(p_user));
  else
   if amount_no>0 then return '{"error":"EPISODE_LOCKED","status":403}';end if;
   if p_action='content' then
    items:='[]';if ep.content_type='WEBTOON' then select coalesce(jsonb_agg(jsonb_build_object('id',v.value->>'id','order',v.ord-1,'width',(v.value->>'width')::integer,'height',(v.value->>'height')::integer,'format','webp') order by v.ord),'[]') into items from jsonb_array_elements(authoring.webtoon_panels_json(ep.manifest)) with ordinality v(value,ord);end if;
    result:=jsonb_build_object('episodeId',eid::text,'workId',ep.work_id::text,'versionId',ep.version_id,'contentType',ep.content_type,'title',ep.title,'content',case when ep.content_type='NOVEL' then ep.content else null end,'contentDocument',case when ep.content_type='NOVEL' then ep.document else null end,'panels',items);
   else
    if ep.content_type<>'WEBTOON' or ep.version_id is distinct from (p_data->>'versionId')::uuid or p_data->>'format' not in ('webp','png') then return '{"error":"CONTENT_NOT_AVAILABLE","status":404}';end if;
    select a.id asset_id,p.part,p.webp_sha,p.png_sha into panel from authoring.webtoon_assets a join authoring.webtoon_panels p on p.asset_id=a.id where a.work_id=ep.work_id and a.state='READY' and a.id in(select value::uuid from jsonb_array_elements_text(ep.manifest->'assetIds')) and p.id=(p_data->>'panelId')::uuid;
    if not found then return '{"error":"CONTENT_NOT_AVAILABLE","status":404}';end if;
    result:=jsonb_build_object('bucket','authoring-webtoons','path','webtoon/'||ep.work_id||'/'||panel.asset_id||'/'||panel.part||'/'||case when p_data->>'format'='webp' then panel.webp_sha||'.webp' else panel.png_sha||'.png' end,'mimeType','image/'||(p_data->>'format'),'bytes',null);
   end if;
  end if;
 end if;
 if result is null then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
 result:=result||'{"mode":"LIVE_MANUAL","source":"BANK_RECONCILED"}';
 if write_action then insert into live_commerce.receipts values(p_user,rid,fp,result);insert into live_commerce.audit(actor_id,action,target_id) values(p_user,p_action,rid);end if;
 return result;
exception when raise_exception then if sqlerrm in ('OP15_SOURCE_RESERVED','OP15_LEGACY_RECONCILIATION_REQUIRED','OP15_REVOKED_SOURCE') then return jsonb_build_object('error',sqlerrm,'status',409);end if;raise;when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or not_null_violation or check_violation then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';when unique_violation then return '{"error":"COMMERCE_CONFLICT","status":409}';
end$$;

-- Existing approved snapshots remain immutable; new previews include OP15 provenance.
create or replace function live_commerce.op14_events(m date) returns table(event_type text,event_id uuid,recorded_at timestamptz,amount bigint,points bigint,revenue bigint,data jsonb) language sql stable set search_path='' as $$
 with events as (
 select 'DEPOSIT_RECORDED'::text typ,d.id,d.created_at at,d.amount::bigint amount,0::bigint points,0::bigint revenue,jsonb_build_object('orderId',d.order_id,'occurredAt',d.occurred_at) data from live_commerce.deposits d
 union all select 'POINTS_CREDITED',l.id,l.created_at,10000,10000,0,jsonb_build_object('depositId',l.deposit_id,'orderId',l.order_id,'fundingSources',coalesce((select jsonb_agg(jsonb_build_object('depositId',deposit_id,'amount',amount) order by deposit_id) from live_commerce.funding_sources where plan_id=l.id),'[]'::jsonb)) from live_commerce.lots l
 union all select 'EPISODE_PURCHASED',p.id,p.created_at,p.points,p.points,p.revenue,jsonb_build_object('authorId',p.author_id::text,'episodeId',p.episode_id::text,'workId',q.work_id::text,'policyId',p.policy_id,'contractRef',q.contract_ref,'shareBps',q.share_bps,'allocations',(select jsonb_agg(jsonb_build_object('lotId',a.lot_id,'points',a.points) order by a.lot_id) from live_commerce.allocations a where a.purchase_id=p.id)) from live_commerce.purchases p join live_commerce.policies q on q.id=p.policy_id
 union all select c.kind||'_CONFIRMED',r.id,r.created_at,c.amount,0,0,jsonb_build_object('lotId',c.lot_id) from live_commerce.correction_confirmations r join live_commerce.corrections c on c.id=r.id
 union all select 'REVENUE_REVERSED',r.purchase_id,r.created_at,0,0,-p.revenue,jsonb_build_object('authorId',p.author_id::text,'purchaseId',p.id,'correctionId',r.correction_id) from live_commerce.revocations r join live_commerce.purchases p on p.id=r.purchase_id
 union all select 'PAYOUT_REQUESTED',p.id,p.created_at,p.gross,0,0,jsonb_build_object('authorId',p.author_id::text,'sourcePurchaseIds',p.sources,'sourceScope','CUMULATIVE_ELIGIBLE_PURCHASES_NOT_EXCLUSIVE_ALLOCATION','exclusiveSources',coalesce((select jsonb_agg(jsonb_build_object('purchaseId',purchase_id,'amount',amount) order by purchase_id) from live_commerce.payout_sources where payout_id=p.id),'[]'::jsonb),'recoveries',coalesce((select jsonb_agg(jsonb_build_object('purchaseId',purchase_id,'debtPayoutId',debt_payout_id,'debtPurchaseId',debt_purchase_id,'amount',amount) order by purchase_id,debt_payout_id,debt_purchase_id) from live_commerce.payout_recoveries where payout_id=p.id),'[]'::jsonb)) from live_commerce.payouts p
 union all select 'PAYOUT_CANCELLED',c.id,c.created_at,p.gross,0,0,jsonb_build_object('authorId',p.author_id::text) from live_commerce.payout_cancellations c join live_commerce.payouts p on p.id=c.id
 union all select 'PAYOUT_PAID',c.id,c.created_at,c.net,0,0,jsonb_build_object('authorId',p.author_id::text,'gross',p.gross,'deduction',a.deduction,'net',c.net,'basisRef',a.basis_ref,'occurredAt',c.occurred_at) from live_commerce.payout_completions c join live_commerce.payouts p on p.id=c.id join live_commerce.payout_approvals a on a.id=c.id
 union all select 'BANK_RETURNED',r.id,r.created_at,p.amount,0,0,jsonb_build_object('orderId',p.order_id,'occurredAt',r.occurred_at,'fundingSources',(select jsonb_agg(jsonb_build_object('depositId',deposit_id,'amount',amount) order by deposit_id) from live_commerce.funding_sources where plan_id=p.id)) from live_commerce.funding_returns r join live_commerce.funding_plans p on p.id=r.id
 ) select typ,id,at,amount,points,revenue,data from events where at >= m::timestamp at time zone 'Asia/Seoul' and at < (m+interval '1 month')::timestamp at time zone 'Asia/Seoul'
$$;
create or replace function live_commerce.op14_snapshot(m date) returns jsonb language plpgsql stable set search_path='' as $$declare events jsonb;totals jsonb;issues jsonb;begin
 if (select count(*) from live_commerce.op14_events(m))>10000 then raise exception 'OP14_REPORT_TOO_LARGE';end if;
 select coalesce(jsonb_agg(jsonb_build_object('type',event_type,'id',event_id,'recordedAt',recorded_at,'amount',amount::text,'points',points::text,'revenue',revenue::text,'data',data) order by recorded_at,event_type,event_id),'[]') into events from live_commerce.op14_events(m);
 select coalesce(jsonb_agg(jsonb_build_object('type',typ,'count',n::text,'amount',amount::text,'points',points::text,'revenue',revenue::text) order by typ),'[]') into totals from (select event_type typ,count(*) n,sum(amount) amount,sum(points) points,sum(revenue) revenue from live_commerce.op14_events(m) group by event_type)x;
 with unresolved as (
  select 'CASE'::text kind,c.id,c.kind target_kind,c.target_id from live_commerce.operation_cases c where not exists(select 1 from live_commerce.case_resolutions r where r.id=c.id)
  union all select 'FUNDING',p.id,'FUNDING',p.id from live_commerce.funding_plans p where not exists(select 1 from live_commerce.funding_reviews r where r.id=p.id and (not r.approved or p.kind='CREDIT')) and not exists(select 1 from live_commerce.funding_returns r where r.id=p.id)
  union all select 'REPROOF',p.id,p.kind,p.target_id from live_commerce.reproofs p where not exists(select 1 from live_commerce.reproof_reviews r where r.id=p.id)
 ),dated as(select u.*,case when target_kind='FUNDING' then (select created_at from live_commerce.funding_plans where id=u.target_id) when target_kind='DEPOSIT' then (select created_at from live_commerce.deposits where id=u.target_id) else (select created_at from live_commerce.corrections where id=u.target_id) end at from unresolved u)
 select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'targetId',target_id) order by kind,id),'[]') into issues from dated where at>=m::timestamp at time zone 'Asia/Seoul' and at<(m+interval '1 month')::timestamp at time zone 'Asia/Seoul';
 if length(events::text)>3000000 or jsonb_array_length(issues)>10000 then raise exception 'OP14_REPORT_TOO_LARGE';end if;
 return jsonb_build_object('schemaVersion',1,'month',to_char(m,'YYYY-MM'),'timezone','Asia/Seoul','basis','RECORDED_AT','events',events,'totals',totals,'reviewIssues',issues);
end$$;

create or replace function live_commerce.op14_target(k text,t uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('kind',k,'id',t,'userId',o.user_id,'recordedBy',d.recorded_by,'bankRefHash',d.bank_ref_hash,'amount',d.amount,'orderId',o.id,'purpose','BANK_DEPOSIT','documentId',live_commerce.op14_document(k,t,d.document_id),'done',(exists(select 1 from live_commerce.lots l where l.deposit_id=d.id) or coalesce((select sum(s.amount) from live_commerce.funding_sources s join live_commerce.funding_reviews r on r.id=s.plan_id and r.approved where s.deposit_id=d.id),0)>=d.amount)) from live_commerce.deposits d join live_commerce.orders o on o.id=d.order_id where k='DEPOSIT' and d.id=t
 union all
 select jsonb_build_object('kind',k,'id',t,'userId',l.user_id,'recordedBy',c.recorded_by,'bankRefHash',c.bank_ref_hash,'amount',c.amount,'purpose',c.kind,'documentId',live_commerce.op14_document(k,t,c.document_id),'done',exists(select 1 from live_commerce.correction_confirmations x where x.id=c.id) or exists(select 1 from live_commerce.correction_rejections x where x.id=c.id)) from live_commerce.corrections c join live_commerce.lots l on l.id=c.lot_id where k='CORRECTION' and c.id=t
$$;

-- Report events use recorded time for accounting, and preserve bank occurrence separately.

create or replace function public.op14_commerce_operations(p_user uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare who jsonb;fields text[];target jsonb;k text;t uuid;rid uuid;fp text;cached live_commerce.receipts;result jsonb;proof live_commerce.reproofs;cas live_commerce.operation_cases;rep live_commerce.monthly_reports;doc uuid;items jsonb;snap jsonb;digest text;prev uuid;m date;off integer;write_action boolean;
begin
 if jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text)>310000 then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
 perform pg_advisory_xact_lock(hashtextextended('op13-financial-ledger',0));
 perform 1 from auth.users where id=p_user for share;who:=public.launch_account_actor(p_user);if who?'error' then return who;end if;
 perform 1 from public.admin_users where auth_user_id=p_user and role::text='SUPER_ADMIN' and is_active for share;
 if not found or who->'admin'->>'role' is distinct from 'SUPER_ADMIN' then return '{"error":"ADMIN_FORBIDDEN","status":403}';end if;
 fields:=case p_action when 'exceptions' then array['query','filter','offset','destinationHash'] when 'proof-context' then array['kind','targetId']
 when 'case-open' then array['requestId','kind','targetId','reasonRef'] when 'case-resolve' then array['requestId','caseId','reasonRef']
 when 'reproof' then array['requestId','kind','targetId','reasonRef','bankRefHash','evidence'] when 'review-reproof' then array['requestId','proofId','approved']
 when 'month-preview' then array['month'] when 'month-draft' then array['requestId','month','expectedDigest','previousId','reasonRef']
 when 'month-approve' then array['requestId','reportId','expectedDigest'] when 'month-list' then array['offset'] when 'month-detail' then array['reportId'] when 'operations-readiness' then array[]::text[] end;
 if fields is null or exists(select 1 from jsonb_object_keys(p_data) key where not key=any(fields)) then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
 if exists(select 1 from jsonb_each(p_data) e where e.key=any(array['requestId','targetId','caseId','proofId','reportId']) and (jsonb_typeof(e.value)<>'string' or e.value#>>'{}'!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')) or p_data?'reasonRef' and coalesce(p_data->>'reasonRef','')!~'^[A-Za-z0-9_.:/-]{3,80}$' then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
 write_action:=p_action in ('case-open','case-resolve','reproof','review-reproof','month-draft','month-approve');
 if write_action then
  rid:=(p_data->>'requestId')::uuid;if rid is null then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
  fp:=encode(sha256(convert_to('op14:'||p_action||':'||(p_data #- '{evidence,envelope}')::text,'UTF8')),'hex');select * into cached from live_commerce.receipts where actor_id=p_user and request_id=rid;
  if found then if cached.fingerprint<>fp then return '{"error":"IDEMPOTENCY_CONFLICT","status":409}';end if;return cached.result||'{"replayed":true}';end if;
 end if;
 if exists(select 1 from live_commerce.limits where actor_id=p_user and window_at>now()-interval '1 minute' and calls>=120) then return '{"error":"RATE_LIMITED","status":429}';end if;
 insert into live_commerce.limits values(p_user,now(),1) on conflict(actor_id) do update set calls=case when limits.window_at>now()-interval '1 minute' then limits.calls+1 else 1 end,window_at=case when limits.window_at>now()-interval '1 minute' then limits.window_at else now() end;
 off:=coalesce((p_data->>'offset')::integer,0);if off not between 0 and 100000 then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
 if p_action in ('proof-context','case-open','reproof') then
  k:=p_data->>'kind';t:=(p_data->>'targetId')::uuid;target:=live_commerce.op14_target(k,t);
  if target is null or (target->>'done')::boolean then return '{"error":"OP14_TARGET_NOT_READY","status":409}';end if;
  if target->>'userId'=p_user::text then return '{"error":"INDEPENDENT_REVIEW_REQUIRED","status":403}';end if;
 end if;
 if p_action='proof-context' then result:=target;
 elsif p_action='case-open' then
  if exists(select 1 from live_commerce.operation_cases c where c.kind=k and c.target_id=t and not exists(select 1 from live_commerce.case_resolutions r where r.id=c.id)) then return '{"error":"OP14_CASE_OPEN","status":409}';end if;
  insert into live_commerce.operation_cases values(rid,k,t,p_data->>'reasonRef',p_user,clock_timestamp());result:=jsonb_build_object('id',rid);
 elsif p_action='case-resolve' then
  select * into cas from live_commerce.operation_cases where id=(p_data->>'caseId')::uuid;target:=live_commerce.op14_target(cas.kind,cas.target_id);
  if cas.id is null or exists(select 1 from live_commerce.case_resolutions where id=cas.id) then return '{"error":"OP14_TARGET_NOT_READY","status":409}';end if;
  if p_user=cas.actor_id or p_user::text=target->>'userId' then return '{"error":"INDEPENDENT_REVIEW_REQUIRED","status":403}';end if;
  insert into live_commerce.case_resolutions values(cas.id,p_user,p_data->>'reasonRef',clock_timestamp());result:=jsonb_build_object('id',cas.id);
 elsif p_action='reproof' then
  if p_data->>'bankRefHash' is distinct from target->>'bankRefHash' or not live_commerce.valid_evidence(p_data->'evidence') then return '{"error":"OP14_EVIDENCE_MISMATCH","status":409}';end if;
  if exists(select 1 from live_commerce.reproofs p where p.kind=k and p.target_id=t and not exists(select 1 from live_commerce.reproof_reviews r where r.id=p.id)) then return '{"error":"OP14_REVIEW_PENDING","status":409}';end if;
  doc:=live_commerce.save_evidence(p_user,target->>'purpose',p_data->'evidence');insert into live_commerce.reproofs values(rid,k,t,(target->>'documentId')::uuid,doc,p_user,p_data->>'reasonRef',clock_timestamp());result:=jsonb_build_object('id',rid);
 elsif p_action='review-reproof' then
  select * into proof from live_commerce.reproofs where id=(p_data->>'proofId')::uuid;target:=live_commerce.op14_target(proof.kind,proof.target_id);
  if proof.id is null or ((target->>'done')::boolean and p_data->'approved'='true'::jsonb) or exists(select 1 from live_commerce.reproof_reviews where id=proof.id) or jsonb_typeof(p_data->'approved') is distinct from 'boolean' then return '{"error":"OP14_TARGET_NOT_READY","status":409}';end if;
  if p_user=proof.actor_id or p_user::text in (target->>'userId',target->>'recordedBy') then return '{"error":"INDEPENDENT_REVIEW_REQUIRED","status":403}';end if;
  if (p_data->>'approved')::boolean and (target->>'documentId' is distinct from proof.base_document_id::text or not exists(select 1 from live_commerce.documents where id=proof.document_id and envelope is not null and expires_at>clock_timestamp())) then return '{"error":"DOCUMENT_UNAVAILABLE","status":409}';end if;
  insert into live_commerce.reproof_reviews values(proof.id,p_user,(p_data->>'approved')::boolean,clock_timestamp());result:=jsonb_build_object('id',proof.id);
 elsif p_action='exceptions' then
  if jsonb_typeof(p_data->'query') is distinct from 'string' or length(p_data->>'query')>80 or p_data->>'filter' not in ('ALL','MISMATCH','EXPIRED','OLD_INSTRUCTIONS','HELD','REVIEW_PENDING') or coalesce(p_data->>'destinationHash','')!~'^[a-f0-9]{64}$' then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
  with targets as (
   select 'DEPOSIT'::text kind,d.id,d.amount,d.created_at,d.order_id,o.user_id,d.document_id,o.destination_hash<>p_data->>'destinationHash' old_instructions,d.amount<>o.amount mismatch from live_commerce.deposits d join live_commerce.orders o on o.id=d.order_id where (live_commerce.op14_target('DEPOSIT',d.id)->>'done')::boolean=false
   union all select 'CORRECTION',c.id,c.amount,c.created_at,l.order_id,l.user_id,c.document_id,false,false from live_commerce.corrections c join live_commerce.lots l on l.id=c.lot_id where not exists(select 1 from live_commerce.correction_confirmations x where x.id=c.id) and not exists(select 1 from live_commerce.correction_rejections x where x.id=c.id)
  ),cards as(select x.*,live_commerce.op14_document(kind,id,document_id) effective_doc,
   (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'reasonRef',c.reason_ref,'createdAt',c.created_at,'actorId',c.actor_id) order by c.created_at),'[]') from live_commerce.operation_cases c where c.kind=x.kind and c.target_id=x.id and not exists(select 1 from live_commerce.case_resolutions r where r.id=c.id)) cases,
   (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'documentId',p.document_id,'reasonRef',p.reason_ref,'actorId',p.actor_id) order by p.created_at),'[]') from live_commerce.reproofs p where p.kind=x.kind and p.target_id=x.id and not exists(select 1 from live_commerce.reproof_reviews r where r.id=p.id)) proofs
   from targets x where p_data->>'query'='' or x.id::text=p_data->>'query' or x.order_id::text=p_data->>'query' or x.user_id::text=p_data->>'query'),reasoned as(select c.*,array_remove(array[case when mismatch then 'MISMATCH' end,case when old_instructions then 'OLD_INSTRUCTIONS' end,case when d.envelope is null or d.expires_at<=clock_timestamp() then 'EXPIRED' end,case when jsonb_array_length(cases)>0 then 'HELD' end,case when jsonb_array_length(proofs)>0 then 'REVIEW_PENDING' end],null) reasons from cards c join live_commerce.documents d on d.id=c.effective_doc)
  select coalesce(jsonb_agg(item order by created_at,id),'[]') into items from (select id,created_at,jsonb_build_object('kind',kind,'id',id,'orderId',order_id,'userId',user_id,'amount',amount,'documentId',effective_doc,'reasons',to_jsonb(reasons),'cases',cases,'proofs',proofs,'createdAt',created_at) item from reasoned where p_data->>'filter'='ALL' or p_data->>'filter'=any(reasons) order by created_at,id offset off limit 30)x;
  result:=jsonb_build_object('items',items,'staleOrders',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'userId',o.user_id,'createdAt',o.created_at) order by o.created_at,o.id),'[]') from (
   select * from live_commerce.orders o where o.destination_hash<>p_data->>'destinationHash' and not exists(select 1 from live_commerce.lots l where l.order_id=o.id)
   and (p_data->>'query'='' or o.id::text=p_data->>'query' or o.user_id::text=p_data->>'query') and p_data->>'filter' in ('ALL','OLD_INSTRUCTIONS') order by o.created_at,o.id offset off limit 30)o));
 elsif p_action in ('month-preview','month-draft') then
  if coalesce(p_data->>'month','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;m:=(p_data->>'month'||'-01')::date;
  snap:=live_commerce.op14_snapshot(m);digest:=encode(sha256(convert_to(snap::text,'UTF8')),'hex');select r.id into prev from live_commerce.monthly_reports r join live_commerce.monthly_approvals a on a.id=r.id where r.month=m order by a.created_at desc,a.id desc limit 1;
  if p_action='month-preview' then result:=jsonb_build_object('snapshot',snap,'digest',digest,'previousId',prev);
  else
   if m>=date_trunc('month',clock_timestamp() at time zone 'Asia/Seoul')::date or digest is distinct from p_data->>'expectedDigest' or prev is distinct from (p_data->>'previousId')::uuid then return '{"error":"OP14_REPORT_CHANGED","status":409}';end if;
   if prev is not null and (select r.digest from live_commerce.monthly_reports r where r.id=prev)=digest then return '{"error":"OP14_REPORT_UNCHANGED","status":409}';end if;
   insert into live_commerce.monthly_reports values(rid,m,prev,snap,digest,p_user,p_data->>'reasonRef',clock_timestamp());result:=jsonb_build_object('id',rid);
  end if;
 elsif p_action='month-approve' then
  select * into rep from live_commerce.monthly_reports where id=(p_data->>'reportId')::uuid;
  if rep.id is null or exists(select 1 from live_commerce.monthly_approvals where id=rep.id) or rep.digest is distinct from p_data->>'expectedDigest' then return '{"error":"OP14_REPORT_CHANGED","status":409}';end if;
  if rep.actor_id=p_user then return '{"error":"INDEPENDENT_REVIEW_REQUIRED","status":403}';end if;
  select r.id into prev from live_commerce.monthly_reports r join live_commerce.monthly_approvals a on a.id=r.id where r.month=rep.month order by a.created_at desc,a.id desc limit 1;
  snap:=live_commerce.op14_snapshot(rep.month);
  if jsonb_array_length(snap->'reviewIssues')>0 then return '{"error":"OP14_CASE_OPEN","status":409}';end if;
  if prev is distinct from rep.previous_id or rep.digest<>encode(sha256(convert_to(snap::text,'UTF8')),'hex') then return '{"error":"OP14_REPORT_CHANGED","status":409}';end if;
  insert into live_commerce.monthly_approvals values(rep.id,rep.month,rep.previous_id,p_user,clock_timestamp());result:=jsonb_build_object('id',rep.id);
 elsif p_action='month-list' then
  select coalesce(jsonb_agg(item order by created_at desc,id),'[]') into items from (select r.id,r.created_at,jsonb_build_object('id',r.id,'month',to_char(r.month,'YYYY-MM'),'digest',r.digest,'previousId',r.previous_id,'actorId',r.actor_id,'approved',a.id is not null,'createdAt',r.created_at) item from live_commerce.monthly_reports r left join live_commerce.monthly_approvals a on a.id=r.id order by r.created_at desc,r.id offset off limit 30)x;result:=jsonb_build_object('reports',items);
 elsif p_action='month-detail' then
  select * into rep from live_commerce.monthly_reports where id=(p_data->>'reportId')::uuid;if rep.id is null then return '{"error":"OP14_TARGET_NOT_READY","status":404}';end if;
  insert into live_commerce.audit(actor_id,action,target_id) values(p_user,'OP14_REPORT_EXPORT',rep.id);result:=jsonb_build_object('id',rep.id,'digest',rep.digest,'previousId',rep.previous_id,'approved',exists(select 1 from live_commerce.monthly_approvals where id=rep.id),'snapshot',rep.snapshot);
 elsif p_action='operations-readiness' then
  result:=jsonb_build_object('activeSuperAdmins',(select count(*)::integer from public.admin_users a join auth.users u on u.id=a.auth_user_id where a.is_active and a.role::text='SUPER_ADMIN' and u.deleted_at is null and (u.banned_until is null or u.banned_until<clock_timestamp())),
   'openCases',(select count(*)::text from live_commerce.operation_cases c where not exists(select 1 from live_commerce.case_resolutions r where r.id=c.id)),
   'pendingProofs',(select count(*)::text from live_commerce.reproofs p where not exists(select 1 from live_commerce.reproof_reviews r where r.id=p.id)),
   'documentKeys',(select coalesce(jsonb_agg(jsonb_build_object('version',version,'count',n::text)),'[]') from(
    select e->>'keyVersion' version,count(*) n from (
     select envelope e from live_commerce.documents where envelope is not null union all select envelope from launch_recovery.op12_documents where envelope is not null
     union all select profile_envelope from launch_recovery.author_settlement_applications where profile_envelope is not null
     union all select identity_envelope from launch_recovery.author_settlement_applications where identity_envelope is not null
     union all select business_envelope from launch_recovery.author_settlement_applications where business_envelope is not null
    ) envelopes group by e->>'keyVersion')x));
 end if;
 if result is null then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';end if;
 result:=result||'{"mode":"LIVE_MANUAL","source":"BANK_RECONCILED"}';
 if write_action then insert into live_commerce.receipts values(p_user,rid,fp,result);insert into live_commerce.audit(actor_id,action,target_id) values(p_user,'OP14_'||p_action,rid);end if;return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or not_null_violation or check_violation then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';when unique_violation then return '{"error":"COMMERCE_CONFLICT","status":409}';when raise_exception then if sqlerrm='OP14_REPORT_TOO_LARGE' then return '{"error":"OP14_REPORT_TOO_LARGE","status":409}';end if;raise;
end$$;

-- The compatible OP13 function below changes only pending-case and effective-evidence checks.
-- Existing public content RPCs and their grants are not modified.

commit;