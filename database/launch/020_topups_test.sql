-- Reviewed TEST-only preparation. No operational apply, provider credentials, or LIVE balances.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if current_setting('webnovels.topups_test_apply_verified',true) is distinct from 'true'
 or to_regprocedure('public.op04_points_test(uuid,text,jsonb)') is null
 or to_regprocedure('commerce.op05_points_base(uuid,text,jsonb)') is not null then
  raise exception 'Reviewed OP-05 TEST-only scope and untouched OP-04 prerequisite required';
 end if;
end $$;
do $$ begin
 if exists(select 1 from commerce.op04_wallets w where w.balance_points<>(select coalesce(sum(l.delta_points),0) from commerce.op04_ledger l where l.user_id=w.user_id))
 or exists(select 1 from commerce.op04_ledger l where not exists(select 1 from commerce.op04_wallets w where w.user_id=l.user_id)) then raise exception 'OP-04 opening ledger/wallet reconciliation required';end if;
end $$;

create table commerce.op05_config(singleton boolean primary key default true check(singleton),revision bigint not null default 0 check(revision>=0));
insert into commerce.op05_config values(true,0);
create table commerce.op05_products(id uuid primary key default gen_random_uuid(),current_version uuid not null);
create table commerce.op05_product_versions(
 id uuid primary key default gen_random_uuid(),product_id uuid not null references commerce.op05_products(id),
 title text not null check(length(btrim(title)) between 1 and 200),amount_krw integer not null check(amount_krw between 1 and 1000000),
 points integer not null check(points between 1 and 1000000),enabled boolean not null,starts_at timestamptz not null,ends_at timestamptz,
 expires_minutes integer not null check(expires_minutes between 5 and 1440),actor_id uuid not null references auth.users(id),reason text not null check(length(btrim(reason)) between 3 and 500),created_at timestamptz not null default now(),check(ends_at is null or ends_at>starts_at),unique(product_id,id)
);
alter table commerce.op05_products add foreign key(id,current_version) references commerce.op05_product_versions(product_id,id) deferrable initially deferred;
create table commerce.op05_orders(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),product_id uuid not null,
 product_version uuid not null,title text not null,method text not null check(method in ('BANK','CARD')),
 amount_krw integer not null check(amount_krw between 1 and 1000000),points integer not null check(points between 1 and 1000000),
 status text not null check(status in ('CREATED','WAITING_DEPOSIT','APPROVING','UNKNOWN','PAID','REFUND_PENDING','REFUND_UNKNOWN','REFUNDED','REVIEW','EXPIRED')),
 provider_mode text not null default 'LOCAL_SIMULATED' check(provider_mode in ('LOCAL_SIMULATED','PROVIDER_TEST')),
 merchant_id text,binding text,payment_key text unique,approval_transaction text unique,approved_at timestamptz,credited boolean not null default false,
 created_at timestamptz not null default now(),expires_at timestamptz not null,foreign key(product_id,product_version) references commerce.op05_product_versions(product_id,id),check(expires_at>created_at)
);
create index op05_orders_owner on commerce.op05_orders(user_id,created_at desc,id);
create table commerce.op05_lots(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),sequence bigint not null,
 source text not null check(source in ('OPENING_TEST_BALANCE','TEST_GIFT','TOPUP')),order_id uuid unique references commerce.op05_orders(id),
 credit_ledger_id uuid unique references commerce.op04_ledger(id),issued_points bigint not null check(issued_points>0),
 consumed_points bigint not null default 0 check(consumed_points>=0),refunded_points bigint not null default 0 check(refunded_points>=0),reserved_points bigint not null default 0 check(reserved_points>=0),
 amount_krw integer not null default 0 check(amount_krw>=0),consumed_krw integer not null default 0 check(consumed_krw>=0),refunded_krw integer not null default 0 check(refunded_krw>=0),
 opening_snapshot jsonb,created_at timestamptz not null default now(),unique(user_id,sequence),
 check(consumed_points+refunded_points+reserved_points<=issued_points),check(consumed_krw+refunded_krw<=amount_krw),
 check((source='TOPUP' and order_id is not null and credit_ledger_id is not null and amount_krw>0 and opening_snapshot is null) or (source='TEST_GIFT' and order_id is null and credit_ledger_id is not null and amount_krw=0 and opening_snapshot is null) or (source='OPENING_TEST_BALANCE' and order_id is null and credit_ledger_id is null and amount_krw=0 and opening_snapshot is not null))
);
create table commerce.op05_allocations(id uuid primary key default gen_random_uuid(),purchase_id uuid not null references commerce.op04_purchases(id),ledger_id uuid not null references commerce.op04_ledger(id),lot_id uuid not null references commerce.op05_lots(id),points integer not null check(points>0),amount_krw integer not null check(amount_krw>=0),created_at timestamptz not null default now(),unique(purchase_id,lot_id));
create table commerce.op05_refunds(id uuid primary key default gen_random_uuid(),order_id uuid not null unique references commerce.op05_orders(id),user_id uuid not null references auth.users(id),actor_id uuid not null references auth.users(id),points integer not null check(points>0),amount_krw integer not null check(amount_krw>0),status text not null check(status in ('PENDING','UNKNOWN','COMPLETED','REVIEW')),reason text not null check(length(btrim(reason)) between 3 and 500),request_id uuid not null,transaction_key text unique,created_at timestamptz not null default now(),completed_at timestamptz);
create table commerce.op05_bank_events(reference text primary key check(length(reference) between 3 and 200),kind text not null check(kind in ('DEPOSIT','REFUND')),order_id uuid not null references commerce.op05_orders(id),amount_krw integer not null check(amount_krw between 1 and 1000000),occurred_at timestamptz not null,actor_id uuid not null references auth.users(id),reason text not null check(length(btrim(reason)) between 3 and 500),created_at timestamptz not null default now());
create table commerce.op05_operations(id uuid primary key default gen_random_uuid(),order_id uuid not null references commerce.op05_orders(id),actor_id uuid not null references auth.users(id),admin_action boolean not null,kind text not null check(kind in ('confirm','query','cancel')),lease uuid not null default gen_random_uuid(),lease_until timestamptz not null default now()+interval '90 seconds',state text not null default 'CLAIMED' check(state in ('CLAIMED','UNKNOWN','DONE','REVIEW')),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(order_id,kind));
create table commerce.op05_receipts(actor_id uuid not null references auth.users(id),request_id uuid not null,action text not null,fingerprint text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(actor_id,request_id));
create table commerce.op05_events(id uuid primary key default gen_random_uuid(),order_id uuid not null references commerce.op05_orders(id),kind text not null check(kind in ('APPROVAL','REFUND')),transaction_key text not null unique,amount_krw integer not null check(amount_krw>0),points integer not null check(points>0),created_at timestamptz not null default now(),unique(order_id,kind));
create table commerce.op05_audit(id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),action text not null,detail jsonb not null,created_at timestamptz not null default now());

-- Old rows and ACLs remain intact. Only the reviewed original CHECKs are extended.
alter table commerce.op04_ledger add column order_id uuid references commerce.op05_orders(id),add column refund_id uuid references commerce.op05_refunds(id);
do $$ declare c record; n integer:=0; begin
 for c in select conname,pg_get_constraintdef(oid) def from pg_constraint where conrelid='commerce.op04_ledger'::regclass and contype='c' loop
  if c.def like '%kind%' and c.def like '%CREDIT%' and c.def like '%DEBIT%' then
   execute format('alter table commerce.op04_ledger drop constraint %I',c.conname);n:=n+1;
  end if;
 end loop;
 if n<>2 then raise exception 'Unexpected OP-04 ledger CHECK inventory';end if;
end $$;
alter table commerce.op04_ledger add constraint op05_ledger_kind_check check(kind in ('CREDIT','DEBIT','TOPUP','REFUND')),
 add constraint op05_ledger_source_check check(
 (kind='CREDIT' and delta_points between 1 and 1000000 and purchase_id is null and order_id is null and refund_id is null)
 or (kind='DEBIT' and delta_points between -1000000 and -1 and purchase_id is not null and order_id is null and refund_id is null)
 or (kind='TOPUP' and delta_points between 1 and 1000000 and purchase_id is null and order_id is not null and refund_id is null)
 or (kind='REFUND' and delta_points between -1000000 and -1 and purchase_id is null and order_id is not null and refund_id is not null));
create unique index op05_ledger_topup_once on commerce.op04_ledger(order_id) where kind='TOPUP';
create unique index op05_ledger_refund_once on commerce.op04_ledger(refund_id) where kind='REFUND';

-- A bounded opening snapshot does not invent historical purchase ordering.
insert into commerce.op05_lots(user_id,sequence,source,issued_points,opening_snapshot)
 select w.user_id,1,'OPENING_TEST_BALANCE',w.balance_points,jsonb_build_object('capturedAt',now(),'ledgerCount',count(l.id),'ledgerHash',encode(sha256(convert_to(coalesce(string_agg(l.id::text||':'||l.kind||':'||l.delta_points::text,',' order by l.id),''),'UTF8')),'hex'),'policy','NONREFUNDABLE_OPENING_SNAPSHOT')
 from commerce.op04_wallets w left join commerce.op04_ledger l on l.user_id=w.user_id where w.balance_points>0 group by w.user_id,w.balance_points;

create function commerce.op05_reserved(p_user uuid) returns bigint language sql stable set search_path='' as $$select coalesce(sum(reserved_points),0)::bigint from commerce.op05_lots where user_id=p_user$$;
create function commerce.op05_wallet_guard() returns trigger language plpgsql set search_path='' as $$begin
 if new.balance_points<commerce.op05_reserved(new.user_id) then raise exception 'OP05_AVAILABLE_POINTS_REQUIRED';end if;return new;end $$;
create trigger op05_wallet_guard before update of balance_points on commerce.op04_wallets for each row execute function commerce.op05_wallet_guard();
create function commerce.op05_ledger_sources() returns trigger language plpgsql set search_path='' as $$
declare l commerce.op05_lots;o commerce.op05_orders;remaining integer;take_points integer;cost integer;seq bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('op04-wallet:'||new.user_id,0));
 if new.kind in ('CREDIT','TOPUP') then
  select coalesce(max(sequence),0)+1 into seq from commerce.op05_lots where user_id=new.user_id;
  if new.kind='TOPUP' then select * into strict o from commerce.op05_orders where id=new.order_id and user_id=new.user_id;
   if o.points<>new.delta_points then raise exception 'OP05_SOURCE_MISMATCH';end if;
  end if;
  insert into commerce.op05_lots(user_id,sequence,source,order_id,credit_ledger_id,issued_points,amount_krw)
   values(new.user_id,seq,case when new.kind='TOPUP' then 'TOPUP' else 'TEST_GIFT' end,new.order_id,new.id,new.delta_points,case when new.kind='TOPUP' then o.amount_krw else 0 end);
 elsif new.kind='DEBIT' then
  remaining:=-new.delta_points;
  for l in select * from commerce.op05_lots where user_id=new.user_id and issued_points>consumed_points+refunded_points+reserved_points order by sequence for update loop
   take_points:=least(remaining,l.issued_points-l.consumed_points-l.refunded_points-l.reserved_points);
   cost:=ceil(l.amount_krw::numeric*(l.consumed_points+take_points)/l.issued_points)::integer-l.consumed_krw;
   update commerce.op05_lots set consumed_points=consumed_points+take_points,consumed_krw=consumed_krw+cost where id=l.id;
   insert into commerce.op05_allocations(purchase_id,ledger_id,lot_id,points,amount_krw) values(new.purchase_id,new.id,l.id,take_points,cost);
   remaining:=remaining-take_points;exit when remaining=0;
  end loop;
  if remaining<>0 then raise exception 'OP05_AVAILABLE_POINTS_REQUIRED';end if;
 end if;return new;
end $$;
create trigger op05_ledger_sources after insert on commerce.op04_ledger for each row execute function commerce.op05_ledger_sources();

-- ALTER preserves the exact original body and owner. The wrapper is the only service path.
do $$ declare body text;owner_id oid;begin
 select prosrc,proowner into body,owner_id from pg_proc where oid='public.op04_points_test(uuid,text,jsonb)'::regprocedure;
 if body is null or md5(replace(body,E'\r',''))<>'59fc55122924f6d8fee6ef7b4d7d364a'
 or not (select prosecdef and proconfig @> array['search_path=""','TimeZone=UTC'] from pg_proc where oid='public.op04_points_test(uuid,text,jsonb)'::regprocedure) then raise exception 'Unreviewed OP-04 RPC body/config';end if;
 alter function public.op04_points_test(uuid,text,jsonb) set schema commerce;
 alter function commerce.op04_points_test(uuid,text,jsonb) rename to op05_points_base;
 if (select prosrc is distinct from body or proowner<>owner_id from pg_proc where oid='commerce.op05_points_base(uuid,text,jsonb)'::regprocedure) then raise exception 'OP-04 body/owner preservation failed';end if;
end $$;
revoke all on function commerce.op05_points_base(uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.op04_points_test(p_user uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare r jsonb;t bigint;h bigint;begin
 begin r:=commerce.op05_points_base(p_user,p_action,p_data);
 exception when raise_exception then if sqlerrm='OP05_AVAILABLE_POINTS_REQUIRED' then return jsonb_build_object('error','INSUFFICIENT_POINTS','status',409);else raise;end if;end;
 if r?'error' then return r;end if;
 if p_action in ('wallet','quote','purchase') then
  perform pg_advisory_xact_lock(hashtextextended('op04-wallet:'||p_user,0));
  select coalesce((select balance_points from commerce.op04_wallets where user_id=p_user),0),commerce.op05_reserved(p_user) into t,h;
  r:=r||jsonb_build_object('balancePoints',t-h,'totalPoints',t,'reservedPoints',h);
 end if;return r;end $$;

create function commerce.op05_product(p_id uuid) returns jsonb language sql stable set search_path='' set timezone='UTC' as $$
 select jsonb_build_object('id',p.id,'versionId',v.id,'title',v.title,'amountKrw',v.amount_krw,'points',v.points,'enabled',v.enabled,'startsAt',v.starts_at,'endsAt',v.ends_at,'expiresMinutes',v.expires_minutes) from commerce.op05_products p join commerce.op05_product_versions v on v.id=p.current_version where p.id=p_id
$$;
create function commerce.op05_order(p_id uuid) returns jsonb language sql stable set search_path='' set timezone='UTC' as $$
 select jsonb_build_object('id',o.id,'checkoutId','wn05-'||o.id,'userId',o.user_id,'productId',o.product_id,'productVersion',o.product_version,'title',o.title,'method',o.method,'amountKrw',o.amount_krw,'points',o.points,'status',o.status,'createdAt',o.created_at,'expiresAt',o.expires_at,'credited',o.credited,
 'refundablePoints',case when l.source='TOPUP' then l.issued_points-l.consumed_points-l.refunded_points else 0 end,
 'refundAmountKrw',case when l.source='TOPUP' then l.amount_krw-l.consumed_krw-l.refunded_krw else 0 end,
 'refund',case when r.id is null then null else jsonb_build_object('id',r.id,'status',r.status,'points',r.points,'amountKrw',r.amount_krw,'createdAt',r.created_at) end)
 from commerce.op05_orders o left join commerce.op05_lots l on l.order_id=o.id left join commerce.op05_refunds r on r.order_id=o.id where o.id=p_id
$$;
create function commerce.op05_state() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('revision',(select revision::text from commerce.op05_config where singleton),'products',coalesce((select jsonb_agg(commerce.op05_product(id) order by id) from (select id from commerce.op05_products order by id limit 100)p),'[]'::jsonb))
$$;
create function commerce.op05_credit(p_id uuid,p_actor uuid,p_transaction text,p_at timestamptz) returns void language plpgsql set search_path='' as $$
declare o commerce.op05_orders;begin
 select * into strict o from commerce.op05_orders where id=p_id for update;if o.credited then return;end if;
 perform pg_advisory_xact_lock(hashtextextended('op04-wallet:'||o.user_id,0));
 insert into commerce.op04_wallets(user_id) values(o.user_id) on conflict do nothing;
 update commerce.op04_wallets set balance_points=balance_points+o.points where user_id=o.user_id;
 insert into commerce.op04_ledger(user_id,actor_id,request_id,kind,delta_points,order_id,reason) values(o.user_id,p_actor,gen_random_uuid(),'TOPUP',o.points,o.id,'검증한 TEST 충전 승인');
 insert into commerce.op05_events(order_id,kind,transaction_key,amount_krw,points) values(o.id,'APPROVAL',p_transaction,o.amount_krw,o.points);
 update commerce.op05_orders set credited=true,status='PAID',approval_transaction=p_transaction,approved_at=p_at where id=o.id;
end $$;
create function commerce.op05_finish_refund(p_id uuid,p_actor uuid,p_transaction text,p_at timestamptz) returns void language plpgsql set search_path='' as $$
declare o commerce.op05_orders;r commerce.op05_refunds;l commerce.op05_lots;begin
 select * into strict o from commerce.op05_orders where id=p_id for update;
 select * into strict r from commerce.op05_refunds where order_id=p_id for update;if r.status='COMPLETED' then return;end if;
 perform pg_advisory_xact_lock(hashtextextended('op04-wallet:'||o.user_id,0));
 select * into strict l from commerce.op05_lots where order_id=o.id for update;
 if l.reserved_points<>r.points or l.issued_points-l.consumed_points-l.refunded_points<>r.points or l.amount_krw-l.consumed_krw-l.refunded_krw<>r.amount_krw then raise exception 'OP05_REFUND_SOURCE_MISMATCH';end if;
 update commerce.op05_lots set reserved_points=0,refunded_points=refunded_points+r.points,refunded_krw=refunded_krw+r.amount_krw where id=l.id;
 update commerce.op04_wallets set balance_points=balance_points-r.points where user_id=o.user_id;
 insert into commerce.op04_ledger(user_id,actor_id,request_id,kind,delta_points,order_id,refund_id,reason) values(o.user_id,p_actor,gen_random_uuid(),'REFUND',-r.points,o.id,r.id,'검증한 TEST 미사용 포인트 환불');
 insert into commerce.op05_events(order_id,kind,transaction_key,amount_krw,points) values(o.id,'REFUND',p_transaction,r.amount_krw,r.points);
 update commerce.op05_refunds set status='COMPLETED',transaction_key=p_transaction,completed_at=p_at where id=r.id;
 update commerce.op05_orders set status='REFUNDED' where id=o.id;
end $$;

create function commerce.op05_actor(p_user uuid,p_admin boolean) returns boolean language plpgsql set search_path='' as $$begin
 perform 1 from auth.users u where u.id=p_user and u.email_confirmed_at is not null and u.is_anonymous is not true and (u.banned_until is null or u.banned_until<=now()) and coalesce(to_jsonb(u)->>'deleted_at','')='' for share;
 if not found then return false;end if;
 if p_admin then
  perform 1 from public.admin_users where auth_user_id=p_user and is_active and role::text='SUPER_ADMIN' and (select count(*) from public.admin_users where auth_user_id=p_user)=1 for share;
 else
  perform 1 from public.readers where auth_user_id=p_user and status::text='ACTIVE' and (select count(*) from public.readers where auth_user_id=p_user)=1 for share;
 end if;return found;end $$;

create function public.op05_topups(p_user uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
#variable_conflict use_variable
declare base jsonb:='{"mode":"TEST","provenance":"LOCAL_SIMULATED","providerMode":"LOCAL_SIMULATED"}';adm boolean:=left(p_action,6)='admin-';act text:=case when left(p_action,6)='admin-' then substr(p_action,7) else p_action end;
 fields text[];req uuid;fp text;rec commerce.op05_receipts;result jsonb;pid uuid;vid uuid;oid uuid;version_key uuid;o commerce.op05_orders;r commerce.op05_refunds;l commerce.op05_lots;op commerce.op05_operations;v commerce.op05_product_versions;
 rev bigint;off integer:=0;total_no bigint;items jsonb;status_filter text;reason text;amount_no integer;points_no integer;minutes_no integer;start_time timestamptz;end_time timestamptz;event_time timestamptz;ref text;kind text;claim boolean:=strpos(act,'claim-')=1;new_refund boolean:=false;replayed boolean:=false;
begin
 if not commerce.op05_actor(p_user,adm) then return jsonb_build_object('error',case when adm then 'ADMIN_FORBIDDEN' else 'READER_REQUIRED' end,'status',403);end if;
 fields:=case act when 'products' then array['offset'] when 'orders' then case when adm then array['status','offset'] else array['offset'] end when 'order' then array['orderId'] when 'state' then case when adm then array[]::text[] end
 when 'product' then case when adm then array['productId','title','amountKrw','points','enabled','startsAt','endsAt','expiresMinutes','revision','reason','requestId'] end
 when 'create' then case when not adm then array['productId','productVersion','method','requestId'] end
 when 'deposit' then case when adm then array['orderId','bankReference','amountKrw','receivedAt','reason','requestId'] end
 when 'bank-refund' then case when adm then array['orderId','bankReference','amountKrw','paidAt','reason','requestId'] end
 when 'refund' then array['orderId','reason','requestId'] when 'reconcile' then array['orderId'] when 'retry-refund' then array['orderId']
 when 'checkout' then case when not adm then array['orderId','providerMode','merchantId','binding'] end
 when 'claim-confirm' then case when not adm then array['orderId','paymentKey','providerMode','merchantId','binding'] end
 when 'claim-query' then array['orderId','providerMode','merchantId','binding']
 when 'claim-refund' then array['orderId','reason','requestId','providerMode','merchantId','binding']
 when 'claim-refund-retry' then array['orderId','providerMode','merchantId','binding'] end;
 if fields is null or jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text)>65536 or exists(select 1 from jsonb_object_keys(p_data)k where not k=any(fields)) then return jsonb_build_object('error','INVALID_TOPUP_REQUEST','status',400);end if;
 if p_data?'offset' then if jsonb_typeof(p_data->'offset') is distinct from 'number' or p_data->>'offset'!~'^(0|[1-9][0-9]{0,5})$' or (p_data->>'offset')::numeric>100000 then return jsonb_build_object('error','INVALID_TOPUP_REQUEST','status',400);end if;off:=(p_data->>'offset')::integer;end if;
 if act in ('product','create','deposit','bank-refund','refund','claim-refund') then
  if coalesce(p_data->>'requestId','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return jsonb_build_object('error','INVALID_TOPUP_REQUEST','status',400);end if;
  req:=(p_data->>'requestId')::uuid;fp:=encode(sha256(convert_to(replace(p_action,'claim-refund','refund')||':'||(p_data-array['providerMode','merchantId','binding'])::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('op05-request:'||p_user||':'||req,0));
  select * into rec from commerce.op05_receipts where actor_id=p_user and request_id=req;
  if found then
   if rec.fingerprint<>fp then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT','status',409);end if;
   if act not in ('refund','claim-refund') then return rec.result||jsonb_build_object('replayed',true);end if;replayed:=true;
  end if;
 end if;
 if act in ('product','deposit','bank-refund','refund','claim-refund') then
  if jsonb_typeof(p_data->'reason') is distinct from 'string' or length(btrim(p_data->>'reason')) not between 3 and 500 then return jsonb_build_object('error','REASON_REQUIRED','status',400);end if;reason:=btrim(p_data->>'reason');
 end if;
 if act='state' then return base||commerce.op05_state();end if;
 if act='products' then
  select count(*) into total_no from commerce.op05_products p join commerce.op05_product_versions pv on pv.id=p.current_version where pv.enabled and pv.starts_at<=now() and (pv.ends_at is null or pv.ends_at>now());
  select coalesce(jsonb_agg(commerce.op05_product(id) order by id),'[]'::jsonb) into items from (select p.id from commerce.op05_products p join commerce.op05_product_versions pv on pv.id=p.current_version where pv.enabled and pv.starts_at<=now() and (pv.ends_at is null or pv.ends_at>now()) order by p.id limit 50 offset off)x;
  return base||jsonb_build_object('items',items,'offset',off,'limit',50,'total',total_no,'hasMore',total_no>off+50,'nextOffset',case when total_no>off+50 then off+50 else null end);
 end if;
 if act='product' then
  if jsonb_typeof(p_data->'revision') is distinct from 'string' or coalesce(p_data->>'revision','')!~'^(0|[1-9][0-9]{0,18})$' or (p_data->>'revision')::numeric>9223372036854775807 then return jsonb_build_object('error','INVALID_TOPUP_REQUEST','status',400);end if;
  if jsonb_typeof(p_data->'title') is distinct from 'string' or length(btrim(p_data->>'title')) not between 1 and 200 or jsonb_typeof(p_data->'enabled') is distinct from 'boolean'
   or jsonb_typeof(p_data->'amountKrw') is distinct from 'number' or coalesce(p_data->>'amountKrw','')!~'^[1-9][0-9]{0,6}$' or (p_data->>'amountKrw')::integer>1000000
   or jsonb_typeof(p_data->'points') is distinct from 'number' or coalesce(p_data->>'points','')!~'^[1-9][0-9]{0,6}$' or (p_data->>'points')::integer>1000000
   or jsonb_typeof(p_data->'expiresMinutes') is distinct from 'number' or coalesce(p_data->>'expiresMinutes','')!~'^[1-9][0-9]{0,3}$' or (p_data->>'expiresMinutes')::integer not between 5 and 1440
   or jsonb_typeof(p_data->'startsAt') is distinct from 'string' or p_data->>'startsAt'!~'^\d{4}-\d{2}-\d{2}T.*Z$'
   or (p_data->'endsAt' is distinct from 'null'::jsonb and (jsonb_typeof(p_data->'endsAt') is distinct from 'string' or p_data->>'endsAt'!~'^\d{4}-\d{2}-\d{2}T.*Z$')) then return jsonb_build_object('error','INVALID_TOPUP_REQUEST','status',400);end if;
  amount_no:=(p_data->>'amountKrw')::integer;points_no:=(p_data->>'points')::integer;minutes_no:=(p_data->>'expiresMinutes')::integer;start_time:=(p_data->>'startsAt')::timestamptz;end_time:=(p_data->>'endsAt')::timestamptz;
  if end_time is not null and end_time<=start_time then return jsonb_build_object('error','INVALID_TOPUP_REQUEST','status',400);end if;
  select revision into rev from commerce.op05_config where singleton for update;if rev::text<>p_data->>'revision' then return jsonb_build_object('error','REVISION_CONFLICT','status',409);end if;
  version_key:=gen_random_uuid();
  if p_data->'productId'='null'::jsonb then pid:=gen_random_uuid();insert into commerce.op05_products values(pid,version_key);
  else pid:=(p_data->>'productId')::uuid;if pid is null or not exists(select 1 from commerce.op05_products where id=pid for update) then return jsonb_build_object('error','PRODUCT_NOT_FOUND','status',404);end if;end if;
  insert into commerce.op05_product_versions(id,product_id,title,amount_krw,points,enabled,starts_at,ends_at,expires_minutes,actor_id,reason) values(version_key,pid,btrim(p_data->>'title'),amount_no,points_no,(p_data->>'enabled')::boolean,start_time,end_time,minutes_no,p_user,reason);
  update commerce.op05_products set current_version=version_key where id=pid;update commerce.op05_config set revision=revision+1 where singleton;
  result:=base||commerce.op05_state()||jsonb_build_object('saved',true,'replayed',false);
 elsif act='create' then
  -- Serialize different request IDs too: retries replay above without consuming this budget.
  perform pg_advisory_xact_lock(hashtextextended('op05-order-create:'||p_user,0));
  if (select count(*) from commerce.op05_orders where user_id=p_user and created_at>now()-interval '1 minute')>=60 then return jsonb_build_object('error','RATE_LIMITED','status',429);end if;
  pid:=(p_data->>'productId')::uuid;vid:=(p_data->>'productVersion')::uuid;
  if jsonb_typeof(p_data->'method') is distinct from 'string' or p_data->>'method' not in ('BANK','CARD') or pid is null or vid is null then return jsonb_build_object('error','INVALID_TOPUP_REQUEST','status',400);end if;
  perform 1 from commerce.op05_products where id=pid for share;
  select x.* into v from commerce.op05_products p join commerce.op05_product_versions x on x.id=p.current_version where p.id=pid;
  if not found then return jsonb_build_object('error','PRODUCT_NOT_FOUND','status',404);end if;
  if v.id<>vid then return jsonb_build_object('error','PRODUCT_VERSION_CONFLICT','status',409);end if;
  if not v.enabled or v.starts_at>now() or (v.ends_at is not null and v.ends_at<=now()) then return jsonb_build_object('error','PRODUCT_UNAVAILABLE','status',409);end if;
  insert into commerce.op05_orders(user_id,product_id,product_version,title,method,amount_krw,points,status,expires_at) values(p_user,pid,vid,v.title,p_data->>'method',v.amount_krw,v.points,case when p_data->>'method'='BANK' then 'WAITING_DEPOSIT' else 'CREATED' end,now()+v.expires_minutes*interval '1 minute') returning * into o;
  result:=base||jsonb_build_object('order',commerce.op05_order(o.id),'replayed',false);
 elsif act='orders' then
  status_filter:=coalesce(p_data->>'status','ALL');if status_filter not in ('ALL','REVIEW','UNKNOWN','REFUND_UNKNOWN','REFUND_PENDING','PAID','WAITING_DEPOSIT') then return jsonb_build_object('error','INVALID_TOPUP_REQUEST','status',400);end if;
  select count(*) into total_no from commerce.op05_orders where (adm or user_id=p_user) and (status_filter='ALL' or status=status_filter);
  select coalesce(jsonb_agg(commerce.op05_order(id) order by created_at desc,id),'[]'::jsonb) into items from (select id,created_at from commerce.op05_orders where (adm or user_id=p_user) and (status_filter='ALL' or status=status_filter) order by created_at desc,id limit 50 offset off)x;
  return base||jsonb_build_object('items',items,'offset',off,'limit',50,'total',total_no,'hasMore',total_no>off+50,'nextOffset',case when total_no>off+50 then off+50 else null end);
 else
  oid:=(p_data->>'orderId')::uuid;if oid is null then return jsonb_build_object('error','INVALID_TOPUP_REQUEST','status',400);end if;
  select * into o from commerce.op05_orders where id=oid and (adm or user_id=p_user) for update;if not found then return jsonb_build_object('error','ORDER_NOT_FOUND','status',404);end if;
  base:=base||jsonb_build_object('providerMode',o.provider_mode);
  if act='order' then return base||jsonb_build_object('order',commerce.op05_order(oid));end if;
  if act='checkout' then
   if o.method<>'CARD' or o.status<>'CREATED' or now()>o.expires_at then return jsonb_build_object('error','ORDER_STATE_CONFLICT','status',409);end if;
   if jsonb_typeof(p_data->'providerMode') is distinct from 'string' or p_data->>'providerMode'<>'PROVIDER_TEST' or jsonb_typeof(p_data->'merchantId') is distinct from 'string' or length(p_data->>'merchantId') not between 1 and 200 or jsonb_typeof(p_data->'binding') is distinct from 'string' or p_data->>'binding'!~'^[a-f0-9]{64}$' then return jsonb_build_object('error','PROVIDER_CONFIG_REQUIRED','status',503);end if;
   if o.binding is not null and (o.binding<>p_data->>'binding' or o.merchant_id<>p_data->>'merchantId' or o.provider_mode<>p_data->>'providerMode') then return jsonb_build_object('error','PROVIDER_BINDING_CONFLICT','status',409);end if;
   update commerce.op05_orders set binding=p_data->>'binding',merchant_id=p_data->>'merchantId',provider_mode='PROVIDER_TEST' where id=oid;
   return base||jsonb_build_object('providerMode','PROVIDER_TEST','order',commerce.op05_order(oid));
  end if;
  if claim and o.method='CARD' and (jsonb_typeof(p_data->'providerMode') is distinct from 'string' or p_data->>'providerMode' not in ('LOCAL_SIMULATED','PROVIDER_TEST') or jsonb_typeof(p_data->'merchantId') is distinct from 'string' or length(p_data->>'merchantId') not between 1 and 200 or jsonb_typeof(p_data->'binding') is distinct from 'string' or p_data->>'binding'!~'^[a-f0-9]{64}$') then return jsonb_build_object('error','PROVIDER_CONFIG_REQUIRED','status',503);end if;
  perform pg_advisory_xact_lock(hashtextextended('op04-wallet:'||o.user_id,0));
  if act in ('deposit','bank-refund') then
   ref:=p_data->>'bankReference';event_time:=coalesce(p_data->>'receivedAt',p_data->>'paidAt')::timestamptz;
   if o.method<>'BANK' or jsonb_typeof(p_data->'bankReference') is distinct from 'string' or length(btrim(ref)) not between 3 and 200 or ref<>btrim(ref)
    or jsonb_typeof(p_data->'amountKrw') is distinct from 'number' or coalesce(p_data->>'amountKrw','')!~'^[1-9][0-9]{0,6}$' or (p_data->>'amountKrw')::integer>1000000 or event_time is null or event_time>now()+interval '5 minutes' or event_time<o.created_at then return jsonb_build_object('error','INVALID_TOPUP_REQUEST','status',400);end if;
   amount_no:=(p_data->>'amountKrw')::integer;
   if exists(select 1 from commerce.op05_bank_events where reference=ref) then return jsonb_build_object('error','BANK_REFERENCE_USED','status',409);end if;
   if act='deposit' then
    if o.credited or o.status not in ('WAITING_DEPOSIT','EXPIRED') then return jsonb_build_object('error','ORDER_STATE_CONFLICT','status',409);end if;
    insert into commerce.op05_bank_events values(ref,'DEPOSIT',oid,amount_no,event_time,p_user,reason,now());
    if amount_no<>o.amount_krw or event_time>o.expires_at then update commerce.op05_orders set status='REVIEW' where id=oid;
    else perform commerce.op05_credit(oid,p_user,'BANK:'||ref,event_time);end if;
   else
    select * into r from commerce.op05_refunds where order_id=oid for update;
    if not found or r.status<>'PENDING' or o.status<>'REFUND_PENDING' or amount_no<>r.amount_krw or event_time<r.created_at then return jsonb_build_object('error','REFUND_PROOF_MISMATCH','status',409);end if;
    insert into commerce.op05_bank_events values(ref,'REFUND',oid,amount_no,event_time,p_user,reason,now());
    perform commerce.op05_finish_refund(oid,p_user,'BANK:'||ref,event_time);
   end if;
   result:=base||jsonb_build_object('order',commerce.op05_order(oid),'replayed',false);
  else
   if act in ('refund','claim-refund') then
    select * into r from commerce.op05_refunds where order_id=oid for update;
    if found then
     if not replayed then return jsonb_build_object('error','REFUND_ALREADY_EXISTS','status',409);end if;
    else
     if not o.credited or o.status<>'PAID' then return jsonb_build_object('error','ORDER_STATE_CONFLICT','status',409);end if;
     select * into strict l from commerce.op05_lots where order_id=oid for update;
     if l.issued_points-l.consumed_points-l.refunded_points-l.reserved_points<1 then return jsonb_build_object('error','NO_REFUNDABLE_POINTS','status',409);end if;
     if l.amount_krw-l.consumed_krw-l.refunded_krw<1 then return jsonb_build_object('error','NO_REFUNDABLE_AMOUNT','status',409);end if;
     insert into commerce.op05_refunds(order_id,user_id,actor_id,points,amount_krw,status,reason,request_id) values(oid,o.user_id,p_user,l.issued_points-l.consumed_points-l.refunded_points,l.amount_krw-l.consumed_krw-l.refunded_krw,'PENDING',reason,req) returning * into r;
     update commerce.op05_lots set reserved_points=r.points where id=l.id;
     update commerce.op05_orders set status='REFUND_PENDING' where id=oid;new_refund:=true;
    end if;
   else select * into r from commerce.op05_refunds where order_id=oid for update;end if;
   if not claim or o.method='BANK' or r.status='COMPLETED' and act<>'claim-query' then
    result:=base||jsonb_build_object('order',commerce.op05_order(oid),'replayed',replayed);
   else
    if jsonb_typeof(p_data->'providerMode') is distinct from 'string' or p_data->>'providerMode' not in ('LOCAL_SIMULATED','PROVIDER_TEST') or jsonb_typeof(p_data->'merchantId') is distinct from 'string' or length(p_data->>'merchantId') not between 1 and 200 or jsonb_typeof(p_data->'binding') is distinct from 'string' or p_data->>'binding'!~'^[a-f0-9]{64}$' then return jsonb_build_object('error','PROVIDER_CONFIG_REQUIRED','status',503);end if;
    if o.binding is null then
     if act<>'claim-confirm' or o.status<>'CREATED' then return jsonb_build_object('error','ORDER_STATE_CONFLICT','status',409);end if;
     update commerce.op05_orders set provider_mode=p_data->>'providerMode',merchant_id=p_data->>'merchantId',binding=p_data->>'binding' where id=oid returning * into o;
    elsif o.binding<>p_data->>'binding' or o.merchant_id<>p_data->>'merchantId' or o.provider_mode<>p_data->>'providerMode' then
     update commerce.op05_orders set status='REVIEW' where id=oid;
     if r.id is not null and r.status<>'COMPLETED' then update commerce.op05_refunds set status='REVIEW' where id=r.id;end if;
     return base||jsonb_build_object('order',commerce.op05_order(oid));
    end if;
    base:=base||jsonb_build_object('providerMode',o.provider_mode);
    if act='claim-confirm' then
     if jsonb_typeof(p_data->'paymentKey') is distinct from 'string' or length(p_data->>'paymentKey') not between 3 and 200 then return jsonb_build_object('error','INVALID_TOPUP_REQUEST','status',400);end if;
     if o.payment_key is not null and o.payment_key<>p_data->>'paymentKey' then return jsonb_build_object('error','PAYMENT_KEY_CONFLICT','status',409);end if;
     if o.credited then return base||jsonb_build_object('order',commerce.op05_order(oid));end if;
     if o.status='CREATED' and now()>o.expires_at then update commerce.op05_orders set status='EXPIRED' where id=oid;return base||jsonb_build_object('order',commerce.op05_order(oid));end if;
     if o.status not in ('CREATED','APPROVING','UNKNOWN') then return jsonb_build_object('error','ORDER_STATE_CONFLICT','status',409);end if;
     update commerce.op05_orders set payment_key=p_data->>'paymentKey' where id=oid returning * into o;
     kind:='confirm';
     if exists(select 1 from commerce.op05_operations x where x.order_id=oid and x.kind='confirm') then kind:='query';end if;
    elsif act='claim-query' then kind:='query';
    elsif act in ('claim-refund','claim-refund-retry') then
     if r.id is null then return jsonb_build_object('error','REFUND_NOT_FOUND','status',404);end if;
     if o.status='REVIEW' or r.status='REVIEW' then return base||jsonb_build_object('order',commerce.op05_order(oid));end if;
     kind:=case when r.status='UNKNOWN' then 'query' else 'cancel' end;
    end if;
    if o.payment_key is null then return jsonb_build_object('error','PAYMENT_NOT_STARTED','status',409);end if;
    -- At most one in-flight provider operation per order, including different operation kinds.
    if exists(select 1 from commerce.op05_operations where order_id=oid and state='CLAIMED' and lease_until>now()) then return base||jsonb_build_object('order',commerce.op05_order(oid),'replayed',replayed);end if;
    -- An expired network lease cannot prove that the previous cancellation failed.
    if kind='cancel' and exists(select 1 from commerce.op05_operations x where x.order_id=oid and x.kind='cancel' and x.state='CLAIMED' and x.lease_until<=now()) then
     kind:='query';update commerce.op05_operations x set state='UNKNOWN' where x.order_id=oid and x.kind='cancel';update commerce.op05_refunds set status='UNKNOWN' where id=r.id;update commerce.op05_orders set status='REFUND_UNKNOWN' where id=oid;
    end if;
    if kind='cancel' and exists(select 1 from commerce.op05_operations x where x.order_id=oid and x.kind='cancel' and x.created_at<now()-interval '15 days') then update commerce.op05_orders set status='REVIEW' where id=oid;update commerce.op05_refunds set status='REVIEW' where id=r.id;return base||jsonb_build_object('order',commerce.op05_order(oid));end if;
    if kind='confirm' and o.created_at<now()-interval '15 days' then update commerce.op05_orders set status='REVIEW' where id=oid;return base||jsonb_build_object('order',commerce.op05_order(oid));end if;
    insert into commerce.op05_operations(order_id,actor_id,admin_action,kind) values(oid,p_user,adm,kind) on conflict on constraint op05_operations_order_id_kind_key do update set lease=gen_random_uuid(),lease_until=now()+interval '90 seconds',state='CLAIMED',updated_at=now(),actor_id=p_user,admin_action=adm returning * into op;
    if kind='confirm' then update commerce.op05_orders set status='APPROVING' where id=oid;
    elsif kind='cancel' then update commerce.op05_orders set status='REFUND_PENDING' where id=oid;
    end if;
    result:=base||jsonb_build_object('order',commerce.op05_order(oid),'replayed',replayed,'transport',jsonb_build_object('orderId',oid,'checkoutId','wn05-'||oid,'operationId',op.id,'operationCreatedAt',op.created_at,'lease',op.lease,'operation',kind,'paymentKey',o.payment_key,'amountKrw',o.amount_krw,'refundAmountKrw',coalesce(r.amount_krw,0),'expectedBalanceKrw',o.amount_krw-coalesce(r.amount_krw,0),'merchantId',o.merchant_id,'binding',o.binding,'providerMode',o.provider_mode,'reason',r.reason,'refundId',r.id));
   end if;
  end if;
 end if;
 if req is not null and not replayed then
  insert into commerce.op05_receipts(actor_id,request_id,action,fingerprint,result) values(p_user,req,p_action,fp,result-'transport');
  insert into commerce.op05_audit(actor_id,action,detail) values(p_user,p_action,jsonb_build_object('requestId',req,'orderId',oid,'productId',pid));
 end if;return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then return jsonb_build_object('error','INVALID_TOPUP_REQUEST','status',400);
 when unique_violation then return jsonb_build_object('error','TRANSACTION_CONFLICT','status',409);
end $$;

create function public.op05_apply(p_order uuid,p_operation uuid,p_lease uuid,p_receipt jsonb) returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare o commerce.op05_orders;r commerce.op05_refunds;op commerce.op05_operations;s text;tx text;approved_time timestamptz;cancel_time timestamptz;base jsonb:='{"mode":"TEST","provenance":"LOCAL_SIMULATED"}';bad boolean:=false;
begin
 select * into o from commerce.op05_orders where id=p_order for update;if not found then return jsonb_build_object('error','ORDER_NOT_FOUND','status',404);end if;
 select * into op from commerce.op05_operations where id=p_operation and order_id=p_order for update;
 if not found or op.lease<>p_lease then return jsonb_build_object('error','STALE_PROVIDER_LEASE','status',409);end if;
 if not commerce.op05_actor(op.actor_id,op.admin_action) then return jsonb_build_object('error','ACTOR_REVOKED','status',403);end if;
 base:=base||jsonb_build_object('providerMode',o.provider_mode);
 if jsonb_typeof(p_receipt) is distinct from 'object' or length(p_receipt::text)>65536 or exists(select 1 from jsonb_object_keys(p_receipt)k where k not in ('state','amountKrw','merchantId','paymentKey','approvedAt','transactionKey','cancelledAt','cancelAmountKrw','balanceKrw')) then return jsonb_build_object('error','INVALID_PROVIDER_RECEIPT','status',400);end if;
 s:=p_receipt->>'state';if s is null or s not in ('APPROVED','PENDING','NOT_PAID','CANCELLED','UNKNOWN','REVIEW') then return jsonb_build_object('error','INVALID_PROVIDER_RECEIPT','status',400);end if;
 if op.state='DONE' then return base||jsonb_build_object('order',commerce.op05_order(p_order),'replayed',true);end if;
 perform pg_advisory_xact_lock(hashtextextended('op04-wallet:'||o.user_id,0));
 select * into r from commerce.op05_refunds where order_id=p_order for update;
 if s not in ('UNKNOWN','REVIEW') then
  bad:=p_receipt->>'amountKrw' is distinct from o.amount_krw::text or p_receipt->>'merchantId' is distinct from o.merchant_id or p_receipt->>'paymentKey' is distinct from o.payment_key;
 end if;
 if s='APPROVED' then
  approved_time:=(p_receipt->>'approvedAt')::timestamptz;tx:=p_receipt->>'transactionKey';
  bad:=bad or approved_time is null or approved_time<o.created_at or approved_time>now()+interval '5 minutes' or length(coalesce(tx,'')) not between 3 and 200;
  if o.approval_transaction is not null and o.approval_transaction<>tx then bad:=true;end if;
  if exists(select 1 from commerce.op05_events where transaction_key=tx and (order_id<>o.id or kind<>'APPROVAL')) then bad:=true;end if;
  if not o.credited and approved_time>o.expires_at then bad:=true;end if;
 elsif s='CANCELLED' then
  cancel_time:=(p_receipt->>'cancelledAt')::timestamptz;tx:=p_receipt->>'transactionKey';
  bad:=bad or r.id is null or not o.credited or cancel_time is null or cancel_time<r.created_at or cancel_time>now()+interval '5 minutes' or length(coalesce(tx,'')) not between 3 and 200
   or p_receipt->>'cancelAmountKrw' is distinct from r.amount_krw::text or p_receipt->>'balanceKrw' is distinct from (o.amount_krw-r.amount_krw)::text;
  if r.status='COMPLETED' and r.transaction_key is distinct from tx then bad:=true;end if;
  if exists(select 1 from commerce.op05_events where transaction_key=tx and (order_id<>o.id or kind<>'REFUND')) then bad:=true;end if;
 end if;
 if bad then s:='REVIEW';end if;
 -- A completed refund is a monetary fact. A late query cannot undo it or reopen a hold.
 if r.status='COMPLETED' then
  if s in ('REVIEW','NOT_PAID') then
   insert into commerce.op05_audit(actor_id,action,detail) values(op.actor_id,'provider-terminal-refund-observation',jsonb_build_object('orderId',o.id,'operationId',op.id,'observedState',p_receipt->>'state','validationMismatch',bad,'financialStatus','REFUNDED'));
  end if;
  update commerce.op05_operations set state=case when s in ('REVIEW','NOT_PAID') then 'REVIEW' when s in ('UNKNOWN','PENDING') then 'UNKNOWN' else 'DONE' end where id=op.id;
  return base||jsonb_build_object('order',commerce.op05_order(p_order));
 end if;
 -- Network uncertainty is tracked on the operation, never by erasing a known approval.
 if o.credited and r.id is null and s in ('UNKNOWN','PENDING') then
  update commerce.op05_operations set state='UNKNOWN' where id=op.id;
  return base||jsonb_build_object('order',commerce.op05_order(p_order));
 end if;
 if s='REVIEW' then
  update commerce.op05_orders set status='REVIEW' where id=o.id;update commerce.op05_operations set state='REVIEW' where id=op.id;
  if r.id is not null and r.status<>'COMPLETED' then update commerce.op05_refunds set status='REVIEW' where id=r.id;end if;
 elsif s='UNKNOWN' then
  update commerce.op05_orders set status=case when r.id is null then 'UNKNOWN' else 'REFUND_UNKNOWN' end where id=o.id;
  update commerce.op05_operations set state='UNKNOWN' where id=op.id;
  if r.id is not null and r.status<>'COMPLETED' then update commerce.op05_refunds set status='UNKNOWN' where id=r.id;end if;
 elsif s='APPROVED' then
  if not o.credited then perform commerce.op05_credit(o.id,op.actor_id,tx,approved_time);end if;
  if o.credited and r.id is null and o.status<>'REVIEW' then update commerce.op05_orders set status='PAID' where id=o.id;end if;
  -- DONE proves approval only. An uncertain cancel continues to reserve all refund points.
  if r.id is not null and r.status<>'COMPLETED' then
   update commerce.op05_orders set status='REFUND_UNKNOWN' where id=o.id;
   update commerce.op05_refunds set status=case when op.kind='query' then 'PENDING' else 'UNKNOWN' end where id=r.id;
  end if;
  update commerce.op05_operations set state='DONE' where id=op.id;
 elsif s='CANCELLED' then
  perform commerce.op05_finish_refund(o.id,op.actor_id,tx,cancel_time);update commerce.op05_operations set state='DONE' where id=op.id;
 else
  if r.id is not null and r.status<>'COMPLETED' then update commerce.op05_orders set status='REFUND_UNKNOWN' where id=o.id;update commerce.op05_refunds set status='UNKNOWN' where id=r.id;
  elsif o.credited then update commerce.op05_orders set status='REVIEW' where id=o.id;
  else update commerce.op05_orders set status=case when s='NOT_PAID' then 'EXPIRED' else 'UNKNOWN' end where id=o.id;end if;
  update commerce.op05_operations set state=case when s='NOT_PAID' then 'DONE' else 'UNKNOWN' end where id=op.id;
 end if;
 return base||jsonb_build_object('order',commerce.op05_order(p_order));
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then return jsonb_build_object('error','INVALID_PROVIDER_RECEIPT','status',400);
 when unique_violation then return jsonb_build_object('error','TRANSACTION_CONFLICT','status',409);
end $$;

-- New objects are private intentionally; service can only execute the three public RPCs.
do $$ declare t text;f record;begin
 foreach t in array array['op05_config','op05_products','op05_product_versions','op05_orders','op05_lots','op05_allocations','op05_refunds','op05_bank_events','op05_operations','op05_receipts','op05_events','op05_audit'] loop
  execute format('alter table commerce.%I enable row level security',t);execute format('revoke all on commerce.%I from public,anon,authenticated,service_role',t);
 end loop;
 foreach t in array array['op05_product_versions','op05_allocations','op05_bank_events','op05_receipts','op05_events','op05_audit'] loop
  execute format('create trigger op05_immutable before update or delete on commerce.%I for each row execute function commerce.op04_immutable()',t);
 end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='commerce' and p.proname like 'op05_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end $$;
revoke all on function public.op04_points_test(uuid,text,jsonb),public.op05_topups(uuid,text,jsonb),public.op05_apply(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.op04_points_test(uuid,text,jsonb),public.op05_topups(uuid,text,jsonb),public.op05_apply(uuid,uuid,uuid,jsonb) to service_role;
commit;
