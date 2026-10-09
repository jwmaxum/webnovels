-- TEST-only preparation. No price/policy seeds, LIVE mode, legacy migration or payout grants.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
 or not exists(select 1 from authoring.migrations where version='authoring-014') then
  raise exception 'Reviewed authoring-014 and backup prerequisites required';
 end if;
end $$;
create schema if not exists commerce;
revoke all on schema commerce from public,anon,authenticated,service_role;
create table if not exists commerce.policies(
 version text primary key check(length(version) between 3 and 80),
 mode text not null default 'TEST' check(mode='TEST'),
 provenance text not null check(provenance in ('LOCAL_SIMULATED','PROVIDER_TEST')),
 merchant_id text not null check(merchant_id ~ '^[A-Za-z0-9_-]{1,200}$'),
 fee_bps integer not null check(fee_bps between 0 and 10000),
 author_bps integer not null check(author_bps between 0 and 10000),
 terms text not null check(length(terms) between 10 and 2000),
 created_at timestamptz not null default now()
);
create table if not exists commerce.offers(
 episode_id bigint primary key references public.episodes(id),
 version uuid not null unique default gen_random_uuid(),
 policy_version text not null references commerce.policies(version),
 amount_krw integer not null check(amount_krw between 1 and 1000000),
 access_kind text not null check(access_kind in ('OWN','RENT')),
 duration_hours integer check(duration_hours between 1 and 8760),
 enabled boolean not null default false,
 check((access_kind='OWN' and duration_hours is null) or (access_kind='RENT' and duration_hours is not null))
);
create table if not exists commerce.orders(
 id text primary key default ('wn20-'||gen_random_uuid()),
 user_id uuid not null references auth.users(id),episode_id bigint not null references public.episodes(id),
 work_id bigint not null references public.works(id),author_id bigint not null references public.authors(id),
 publication_id uuid not null references authoring.publication_versions(id),
 request_id uuid not null,request_payload jsonb not null,
 policy_version text not null references commerce.policies(version),offer_version uuid not null,
 mode text not null check(mode='TEST'),provenance text not null check(provenance in ('LOCAL_SIMULATED','PROVIDER_TEST')),
 merchant_id text not null,amount_krw integer not null check(amount_krw between 1 and 1000000),
 currency text not null default 'KRW' check(currency='KRW'),
 fee_krw integer not null check(fee_krw>=0),author_krw integer not null check(author_krw>=0),
 platform_krw integer not null check(platform_krw>=0),
 access_kind text not null check(access_kind in ('OWN','RENT')),duration_hours integer,
 status text not null default 'CREATED' check(status in
 ('CREATED','APPROVING','UNKNOWN','PAID','REFUNDING','REFUND_UNKNOWN','REFUNDED','FAILED','REVIEW')),
 payment_key text,lease uuid,lease_until timestamptz,lease_action text,
 refund_reason text,created_at timestamptz not null default now(),approved_at timestamptz,
 updated_at timestamptz not null default now(),
 unique(user_id,request_id),unique(mode,merchant_id,payment_key),
 check(amount_krw=fee_krw+author_krw+platform_krw),
 check((access_kind='OWN' and duration_hours is null) or (access_kind='RENT' and duration_hours between 1 and 8760))
);
create index if not exists commerce_orders_user on commerce.orders(user_id,created_at desc,id);
create table if not exists commerce.ledger(
 id uuid primary key default gen_random_uuid(),order_id text not null references commerce.orders(id),
 kind text not null check(kind in ('SALE','REVERSAL')),original_id uuid references commerce.ledger(id),
 external_ref text not null,transaction_ref text,mode text not null check(mode='TEST'),merchant_id text not null,
 gross_krw integer not null,fee_krw integer not null,author_krw integer not null,platform_krw integer not null,
 created_at timestamptz not null default now(),unique(order_id,kind),unique(mode,merchant_id,external_ref),
 unique(mode,merchant_id,transaction_ref),
 check(gross_krw=fee_krw+author_krw+platform_krw),
 check((kind='SALE' and original_id is null and gross_krw>0 and fee_krw>=0 and author_krw>=0 and platform_krw>=0)
 or (kind='REVERSAL' and original_id is not null and gross_krw<0 and fee_krw<=0 and author_krw<=0 and platform_krw<=0))
);
create table if not exists commerce.entitlements(
 order_id text primary key references commerce.orders(id),user_id uuid not null references auth.users(id),
 episode_id bigint not null references public.episodes(id),granted_at timestamptz not null,
 expires_at timestamptz,revoked_at timestamptz,
 check(expires_at is null or expires_at>granted_at)
);
create index if not exists commerce_entitlement_user on commerce.entitlements(user_id,episode_id);
create table if not exists commerce.events(
 id uuid primary key default gen_random_uuid(),order_id text not null references commerce.orders(id),
 actor_user_id uuid references auth.users(id),action text not null,state text not null,
 detail jsonb not null default '{}',created_at timestamptz not null default now()
);
create table if not exists commerce.attempts(
 user_id uuid not null references auth.users(id),bucket timestamptz not null,n integer not null,
 primary key(user_id,bucket)
);
create or replace function commerce.immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Commerce evidence is immutable'; end $$;
revoke all on function commerce.immutable() from public,anon,authenticated,service_role;
create or replace function commerce.offer_revision() returns trigger language plpgsql set search_path='' as $$
begin
 if new.episode_id is distinct from old.episode_id then raise exception 'Offer episode is immutable'; end if;
 if row(new.policy_version,new.amount_krw,new.access_kind,new.duration_hours,new.enabled)
 is distinct from row(old.policy_version,old.amount_krw,old.access_kind,old.duration_hours,old.enabled) then
  new.version:=gen_random_uuid();
 else new.version:=old.version; end if;
 return new;
end $$;
revoke all on function commerce.offer_revision() from public,anon,authenticated,service_role;
drop trigger if exists commerce_offer_revision on commerce.offers;
create trigger commerce_offer_revision before update on commerce.offers for each row execute function commerce.offer_revision();
do $$ declare t text; begin
 foreach t in array array['policies','offers','orders','ledger','entitlements','events','attempts'] loop
  execute format('alter table commerce.%I enable row level security',t);
  execute format('revoke all on commerce.%I from public,anon,authenticated,service_role',t);
 end loop;
 foreach t in array array['policies','ledger','events'] loop
  execute format('drop trigger if exists commerce_immutable on commerce.%I',t);
  execute format('create trigger commerce_immutable before update or delete on commerce.%I for each row execute function commerce.immutable()',t);
 end loop;
end $$;
create or replace function commerce.summary(o commerce.orders) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',o.id,'episodeId',o.episode_id::text,'workId',o.work_id::text,
 'status',o.status,'mode',o.mode,'provenance',o.provenance,'amountKrw',o.amount_krw,'currency',o.currency,
 'policyVersion',o.policy_version,'accessKind',o.access_kind,'durationHours',o.duration_hours,
 'approvedAt',o.approved_at,'createdAt',o.created_at,'expiresAt',e.expires_at,
 'sandboxEntitled',coalesce(e.revoked_at is null and (e.expires_at is null or e.expires_at>now()) and e.order_id is not null,false),
 'liveContentAccess',false) from (select 1) dummy left join commerce.entitlements e on e.order_id=o.id
$$;
create or replace function commerce.sellable(p_episode bigint) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.episodes e join public.works w on w.id=e.work_id
 join public.authors a on a.id=w.author_id join authoring.work_state s on s.work_id=w.id
 join authoring.publication_heads h on h.episode_id=e.id
 where e.id=p_episode and e.status::text='PUBLISHED' and (e.scheduled_at is null or e.scheduled_at<=now())
 and e.is_free=false and e.access_policy='PAID' and w.status::text in ('PUBLISHED','ONGOING','PAUSED','COMPLETED')
 and w.content_type='NOVEL' and w.rating in ('ALL','AGE_15') and not coalesce(w.genre,'{}') && array['성인','19세 이상']
 and a.status::text='APPROVED' and s.visibility='PUBLIC' and s.moderation_state='CLEAR'
 and s.trashed_at is null and s.rating_confirmed and s.ai_confirmed)
$$;
revoke all on function commerce.summary(commerce.orders),commerce.sellable(bigint) from public,anon,authenticated,service_role;
create or replace function commerce.entries(p_author bigint,p_order text) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(x.item order by x.created_at desc,x.id),'[]'::jsonb) from (
  select l.id,l.created_at,jsonb_build_object('id',l.id,'orderId',l.order_id,'kind',l.kind,
   'originalId',l.original_id,'mode',l.mode,'provenance',o.provenance,'grossKrw',l.gross_krw,
   'feeKrw',l.fee_krw,'authorKrw',l.author_krw,'platformKrw',l.platform_krw,'createdAt',l.created_at) item
  from commerce.ledger l join commerce.orders o on o.id=l.order_id
  where (p_author is null or o.author_id=p_author) and (p_order is null or o.id=p_order)
  order by l.created_at desc,l.id limit 100) x
$$;
revoke all on function commerce.entries(bigint,text) from public,anon,authenticated,service_role;

-- Caller supplies an already server-verified Auth UUID; identity/status are rechecked here too.
create or replace function public.stage20_payments(p_user uuid,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare a public.authors; ad public.admin_users; is_finance boolean; o commerce.orders;
 f commerce.offers; p commerce.policies; k text; items jsonb; n integer; q jsonb;
 v_publication uuid; v_fee integer; v_author integer;
begin
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null
 and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then
  return jsonb_build_object('error','INVALID_SESSION','status',401); end if;
 select * into ad from public.admin_users where auth_user_id=p_user and is_active;
 -- Existing SUPER_ADMIN authority only; no invented/unassignable finance permission.
 is_finance:=coalesce(ad.role::text='SUPER_ADMIN',false);
 select * into a from public.authors where auth_user_id=p_user and status::text='APPROVED';
 if p_action='earnings' then
  if a.id is null then return jsonb_build_object('error','AUTHOR_REQUIRED','status',403); end if;
  return jsonb_build_object('mode','TEST','estimatedKrw',null,'confirmedTestKrw',
   coalesce((select sum(l.author_krw) from commerce.ledger l join commerce.orders z on z.id=l.order_id where z.author_id=a.id),0),
   'payableKrw',0,'paidKrw',0,'payoutStatus','NOT_AVAILABLE','entries',commerce.entries(a.id,null),
   'orders',coalesce((select jsonb_agg(commerce.summary(z) order by z.created_at desc,z.id) from
    (select * from commerce.orders where author_id=a.id order by created_at desc,id limit 50) z),'[]'::jsonb));
 end if;
 if p_action in ('review','audit','claim-refund','admin-query') then
  if not is_finance then return jsonb_build_object('error','FINANCE_PERMISSION_REQUIRED','status',403); end if;
 elsif not exists(select 1 from public.readers where auth_user_id=p_user and status::text='ACTIVE') then
  return jsonb_build_object('error','READER_REQUIRED','status',403);
 end if;
 if jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text)>4000 then
  return jsonb_build_object('error','INVALID_FIELD','status',400); end if;
 if p_action='review' then
  return jsonb_build_object('mode','TEST','orders',coalesce((select jsonb_agg(commerce.summary(z) order by z.updated_at,z.id)
   from (select * from commerce.orders where status in ('UNKNOWN','REFUND_UNKNOWN','REVIEW','APPROVING','REFUNDING')
   order by updated_at,id limit 50) z),'[]'::jsonb));
 end if;
 if p_action='list' then
  return jsonb_build_object('mode','TEST','orders',coalesce((select jsonb_agg(commerce.summary(z) order by z.created_at desc,z.id)
   from (select * from commerce.orders where user_id=p_user order by created_at desc,id limit 50) z),'[]'::jsonb));
 end if;
 if p_action in ('quote','create') then
  if (p_data->>'episodeId') is null or (p_data->>'episodeId')!~'^[1-9][0-9]{0,17}$'
  or exists(select 1 from jsonb_object_keys(p_data) x where x not in
   ('episodeId','requestId','offerVersion','policyVersion','expectedAmountKrw','provenance','merchantId')) then
   return jsonb_build_object('error','INVALID_FIELD','status',400); end if;
  if p_action='create' then
   if (p_data->>'requestId') is null or (p_data->>'requestId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('error','INVALID_REQUEST_ID','status',400); end if;
   perform pg_advisory_xact_lock(hashtextextended('commerce-request:'||p_user||':'||(p_data->>'requestId'),0));
   select * into o from commerce.orders where user_id=p_user and request_id=(p_data->>'requestId')::uuid;
   if found then
    if o.request_payload is distinct from p_data then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT','status',409); end if;
    return jsonb_build_object('order',commerce.summary(o));
   end if;
  end if;
  select * into f from commerce.offers where episode_id=(p_data->>'episodeId')::bigint and enabled;
  if not found or not commerce.sellable(f.episode_id) then return jsonb_build_object('error','OFFER_NOT_FOUND','status',404); end if;
  select * into p from commerce.policies where version=f.policy_version;
  if p.merchant_id is distinct from p_data->>'merchantId' or p.provenance is distinct from p_data->>'provenance' then
   return jsonb_build_object('error','PAYMENT_CONFIGURATION_MISMATCH','status',503); end if;
  q:=jsonb_build_object('mode','TEST','provenance',p.provenance,'episodeId',f.episode_id::text,
   'offerVersion',f.version,'policyVersion',p.version,'amountKrw',f.amount_krw,'currency','KRW',
   'accessKind',f.access_kind,'durationHours',f.duration_hours,'terms',p.terms,
   'freeScope','이 회차는 유료 시험 대상이며 무료 회차 접근은 기존 정책을 따릅니다.','liveContentAccess',false);
  if p_action='quote' then return jsonb_build_object('quote',q); end if;
  if (p_data->>'offerVersion') is distinct from f.version::text or (p_data->>'policyVersion') is distinct from p.version
  or p_data->'expectedAmountKrw' is distinct from to_jsonb(f.amount_krw) then
   return jsonb_build_object('error','QUOTE_CHANGED','status',409); end if;
  perform pg_advisory_xact_lock(hashtextextended('commerce-episode:'||p_user||':'||f.episode_id,0));
  with expired as (update commerce.orders set status='FAILED',updated_at=now()
   where user_id=p_user and episode_id=f.episode_id and status='CREATED'
   and created_at<now()-interval '30 minutes' returning id)
   insert into commerce.events(order_id,actor_user_id,action,state) select id,p_user,'EXPIRE_UNSTARTED','FAILED' from expired;
  if exists(select 1 from commerce.entitlements where user_id=p_user and episode_id=f.episode_id
   and revoked_at is null and (expires_at is null or expires_at>now())) then
   return jsonb_build_object('error','ALREADY_PURCHASED','status',409); end if;
  if exists(select 1 from commerce.orders where user_id=p_user and episode_id=f.episode_id
   and status in ('CREATED','APPROVING','UNKNOWN','REFUNDING','REFUND_UNKNOWN','REVIEW')) then
   return jsonb_build_object('error','PURCHASE_PENDING','status',409); end if;
  -- Lock/recheck the exact head; prices/policies are copied and never client-authoritative.
  select h.version_id into v_publication from authoring.publication_heads h where h.episode_id=f.episode_id for share;
  if not commerce.sellable(f.episode_id) then return jsonb_build_object('error','OFFER_NOT_FOUND','status',404); end if;
  insert into commerce.attempts(user_id,bucket,n) values(p_user,date_trunc('minute',now()),1)
  on conflict(user_id,bucket) do update set n=commerce.attempts.n+1 returning commerce.attempts.n into n;
  if n>10 then return jsonb_build_object('error','RATE_LIMITED','status',429); end if;
  v_fee:=floor(f.amount_krw::numeric*p.fee_bps/10000)::integer;
  v_author:=floor((f.amount_krw-v_fee)::numeric*p.author_bps/10000)::integer;
  insert into commerce.orders(user_id,episode_id,work_id,author_id,publication_id,request_id,request_payload,
   policy_version,offer_version,mode,provenance,merchant_id,amount_krw,fee_krw,author_krw,platform_krw,access_kind,duration_hours)
   select p_user,e.id,w.id,w.author_id,v_publication,(p_data->>'requestId')::uuid,p_data,
   p.version,f.version,'TEST',p.provenance,p.merchant_id,f.amount_krw,v_fee,v_author,f.amount_krw-v_fee-v_author,f.access_kind,f.duration_hours
   from public.episodes e join public.works w on w.id=e.work_id where e.id=f.episode_id returning * into o;
  insert into commerce.events(order_id,actor_user_id,action,state) values(o.id,p_user,'CREATE',o.status);
  return jsonb_build_object('order',commerce.summary(o));
 end if;
 if p_action not in ('get','audit','claim-confirm','claim-query','claim-refund','admin-query') then
  return jsonb_build_object('error','INVALID_ACTION','status',400); end if;
 if (p_data->>'orderId') is null or (p_data->>'orderId')!~'^wn20-[0-9a-f-]{36}$'
 or exists(select 1 from jsonb_object_keys(p_data) x where x not in ('orderId','paymentKey','reason')) then
  return jsonb_build_object('error','INVALID_FIELD','status',400); end if;
 select * into o from commerce.orders where id=p_data->>'orderId' for update;
 if not found or (p_action not in ('audit','claim-refund','admin-query') and o.user_id<>p_user) then
  return jsonb_build_object('error','ORDER_NOT_FOUND','status',404); end if;
 if p_action='get' then return jsonb_build_object('order',commerce.summary(o)); end if;
 if p_action='audit' then
  return jsonb_build_object('order',commerce.summary(o),'entries',commerce.entries(null,o.id),'events',coalesce((select jsonb_agg(jsonb_build_object(
   'action',e.action,'state',e.state,'createdAt',e.created_at) order by e.created_at,e.id) from commerce.events e where e.order_id=o.id),'[]'::jsonb));
 end if;
 if p_action='claim-confirm' and ((p_data->>'paymentKey') is null or (p_data->>'paymentKey')!~'^[A-Za-z0-9_-]{1,200}$') then
  return jsonb_build_object('error','INVALID_PAYMENT_REFERENCE','status',400); end if;
 if p_action='claim-refund' and (length(btrim(coalesce(p_data->>'reason','')))<3 or length(p_data->>'reason')>200) then
  return jsonb_build_object('error','REFUND_REASON_REQUIRED','status',400); end if;
 if o.payment_key is not null and p_action='claim-confirm' and o.payment_key is distinct from p_data->>'paymentKey' then
  return jsonb_build_object('error','PAYMENT_KEY_CONFLICT','status',409); end if;
 if o.status in ('REFUNDED','FAILED') or (o.status='PAID' and p_action='claim-confirm') then
  return jsonb_build_object('order',commerce.summary(o)); end if;
 if p_action='claim-confirm' and o.status<>'CREATED' then
  return jsonb_build_object('error','RECONCILIATION_REQUIRED','status',409); end if;
 if p_action='claim-confirm' and o.created_at<now()-interval '30 minutes' then
  update commerce.orders set status='FAILED',updated_at=now() where id=o.id;
  insert into commerce.events(order_id,actor_user_id,action,state) values(o.id,p_user,'EXPIRE_UNSTARTED','FAILED');
  return jsonb_build_object('error','ORDER_EXPIRED','status',409); end if;
 if p_action='claim-confirm' and not commerce.sellable(o.episode_id) then
  return jsonb_build_object('error','OFFER_NOT_FOUND','status',404); end if;
 if p_action='claim-refund' and o.status not in ('PAID','REFUND_UNKNOWN') then
  return jsonb_build_object('error','REFUND_NOT_READY','status',409); end if;
 if p_action='claim-refund' and o.refund_reason is not null and o.refund_reason is distinct from p_data->>'reason' then
  return jsonb_build_object('error','REFUND_REASON_CONFLICT','status',409); end if;
 if o.lease_until>now() then return jsonb_build_object('error','PAYMENT_PROCESSING','status',409); end if;
 if p_action<>'claim-confirm' and o.payment_key is null then
  return jsonb_build_object('error','PAYMENT_NOT_STARTED','status',409); end if;
 insert into commerce.attempts(user_id,bucket,n) values(p_user,date_trunc('minute',now()),1)
 on conflict(user_id,bucket) do update set n=commerce.attempts.n+1 returning commerce.attempts.n into n;
 if n>10 then return jsonb_build_object('error','RATE_LIMITED','status',429); end if;
 k:=case p_action when 'claim-confirm' then 'confirm' when 'claim-refund' then 'cancel' else 'query' end;
 update commerce.orders set payment_key=coalesce(payment_key,p_data->>'paymentKey'),
 status=case k when 'confirm' then 'APPROVING' when 'cancel' then 'REFUNDING' else status end,
 refund_reason=case when k='cancel' then coalesce(refund_reason,p_data->>'reason') else refund_reason end,
 lease=gen_random_uuid(),lease_until=now()+interval '90 seconds',lease_action=k,updated_at=now()
 where id=o.id returning * into o;
 insert into commerce.events(order_id,actor_user_id,action,state) values(o.id,p_user,'CLAIM_'||upper(k),o.status);
 return jsonb_build_object('order',commerce.summary(o),'transport',jsonb_build_object(
  'id',o.id,'payment_key',o.payment_key,'merchant_id',o.merchant_id,'mode',o.mode,
  'amount_krw',o.amount_krw,'currency',o.currency,'lease',o.lease,'operation',k,'reason',o.refund_reason));
exception when unique_violation then return jsonb_build_object('error','PAYMENT_KEY_CONFLICT','status',409);
end $$;

-- Server-only observation finalization. No route accepts a browser receipt, success flag or lease.
create or replace function public.stage20_apply_payment(p_order text,p_lease uuid,p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare o commerce.orders; sale commerce.ledger; state text; approved timestamptz; cancelled timestamptz;
begin
 select * into o from commerce.orders where id=p_order for update;
 if not found then return jsonb_build_object('error','ORDER_NOT_FOUND','status',404); end if;
 if o.lease is distinct from p_lease or o.lease_until is null or o.lease_until<=now() then
  return jsonb_build_object('error','PAYMENT_LEASE_STALE','status',409); end if;
 state:=p_receipt->>'state';
 if state is null or state not in ('UNKNOWN','PENDING','NOT_PAID','REVIEW','APPROVED','CANCELLED') then
  return jsonb_build_object('error','INVALID_RECEIPT','status',400); end if;
 if state<>'UNKNOWN' and (p_receipt->>'paymentKey' is distinct from o.payment_key
 or p_receipt->>'merchantId' is distinct from o.merchant_id or p_receipt->>'mode' is distinct from o.mode
 or p_receipt->>'currency' is distinct from o.currency or p_receipt->'amountKrw' is distinct from to_jsonb(o.amount_krw)) then
  return jsonb_build_object('error','INVALID_RECEIPT','status',400); end if;
 if state in ('APPROVED','CANCELLED') then
  if (p_receipt->>'transactionKey') is null or (p_receipt->>'transactionKey')!~'^[A-Za-z0-9_-]{1,200}$'
  or (p_receipt->>'approvedAt') is null then return jsonb_build_object('error','INVALID_RECEIPT','status',400); end if;
  approved:=(p_receipt->>'approvedAt')::timestamptz;
  if not isfinite(approved) or approved>now()+interval '5 minutes' or approved<o.created_at-interval '5 minutes' then
   return jsonb_build_object('error','INVALID_RECEIPT','status',400); end if;
  if state='CANCELLED' then
   cancelled:=(p_receipt->>'cancelledAt')::timestamptz;
   if cancelled is null or not isfinite(cancelled) or cancelled<approved or cancelled>now()+interval '5 minutes' then
    return jsonb_build_object('error','INVALID_RECEIPT','status',400); end if;
  end if;
  select * into sale from commerce.ledger where order_id=o.id and kind='SALE';
  if found and o.approved_at is distinct from approved then return jsonb_build_object('error','INVALID_RECEIPT','status',400); end if;
  if not found then
   insert into commerce.ledger(order_id,kind,external_ref,transaction_ref,mode,merchant_id,gross_krw,fee_krw,author_krw,platform_krw)
   values(o.id,'SALE','approve-'||o.payment_key,case when state='APPROVED' then p_receipt->>'transactionKey' end,
    o.mode,o.merchant_id,o.amount_krw,o.fee_krw,o.author_krw,o.platform_krw) returning * into sale;
   insert into commerce.entitlements(order_id,user_id,episode_id,granted_at,expires_at)
   values(o.id,o.user_id,o.episode_id,approved,case when o.access_kind='RENT' then approved+o.duration_hours*interval '1 hour' end);
  end if;
  if state='CANCELLED' then
   insert into commerce.ledger(order_id,kind,original_id,external_ref,transaction_ref,mode,merchant_id,
    gross_krw,fee_krw,author_krw,platform_krw)
   values(o.id,'REVERSAL',sale.id,'cancel-'||(p_receipt->>'transactionKey'),p_receipt->>'transactionKey',
    o.mode,o.merchant_id,-sale.gross_krw,-sale.fee_krw,-sale.author_krw,-sale.platform_krw) on conflict(order_id,kind) do nothing;
   update commerce.entitlements set revoked_at=cancelled where order_id=o.id and revoked_at is null;
  end if;
  update commerce.orders set status=case state when 'APPROVED' then 'PAID' else 'REFUNDED' end,
   approved_at=approved where id=o.id;
 else
  update commerce.orders set status=case
   when state='REVIEW' then 'REVIEW'
   when state='NOT_PAID' and not exists(select 1 from commerce.ledger where order_id=o.id) then 'FAILED'
   when state='NOT_PAID' then 'REVIEW'
   when o.status='PAID' then 'PAID'
   when o.status in ('REFUNDING','REFUND_UNKNOWN') then 'REFUND_UNKNOWN' else 'UNKNOWN' end where id=o.id;
 end if;
 update commerce.orders set lease=null,lease_until=null,lease_action=null,updated_at=now() where id=o.id returning * into o;
 insert into commerce.events(order_id,action,state,detail) values(o.id,'OBSERVE',o.status,jsonb_build_object('observation',state));
 return jsonb_build_object('order',commerce.summary(o));
exception when invalid_datetime_format or datetime_field_overflow or unique_violation then
 return jsonb_build_object('error','INVALID_RECEIPT','status',409);
end $$;
revoke all on function public.stage20_payments(uuid,text,jsonb),public.stage20_apply_payment(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.stage20_payments(uuid,text,jsonb),public.stage20_apply_payment(text,uuid,jsonb) to service_role;
insert into authoring.migrations(version) values('authoring-016') on conflict do nothing;
commit;
