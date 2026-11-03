-- OP13: new manual-bank ledger. Never imports TEST or legacy balances.
begin;
set local lock_timeout='5s';
do $$begin
 if current_setting('webnovels.live_commerce_apply_verified',true) is distinct from 'true'
 or to_regprocedure('launch_recovery.op12_facts(bigint)') is null
 or not exists(select 1 from authoring.migrations where version='authoring-021')
 or to_regnamespace('live_commerce') is not null then raise exception 'Reviewed OP13 prerequisites required';end if;
end$$;
create schema live_commerce;
revoke all on schema live_commerce from public,anon,authenticated,service_role;
create table live_commerce.policies(id uuid primary key,work_id bigint not null references public.works(id),author_id bigint not null references public.authors(id),owner_id uuid not null references auth.users(id),price integer not null check(price between 1 and 1000000),share_bps integer not null check(share_bps between 1 and 10000),contract_ref text not null check(length(contract_ref) between 3 and 80),actor_id uuid not null references auth.users(id),created_at timestamptz not null default now());
create table live_commerce.catalog(work_id bigint primary key references public.works(id),policy_id uuid not null references live_commerce.policies(id));
create table live_commerce.orders(id uuid primary key,user_id uuid not null references auth.users(id),amount integer not null default 10000 check(amount=10000),points integer not null default 10000 check(points=10000),destination_hash text not null check(destination_hash~'^[a-f0-9]{64}$'),created_at timestamptz not null default now());
create table live_commerce.documents(id uuid primary key,actor_id uuid not null references auth.users(id),purpose text not null check(purpose in ('BANK_DEPOSIT','MANUAL_EXTERNAL','REFUND','BANK_REVERSAL')),envelope jsonb,digest text not null check(digest~'^[a-f0-9]{64}$'),policy_version text not null,policy_hash text not null check(policy_hash~'^[a-f0-9]{64}$'),retention_days integer not null check(retention_days between 1 and 3650),created_at timestamptz not null default now(),expires_at timestamptz not null,purged_at timestamptz,check(expires_at=created_at+retention_days*interval '1 day'),check((envelope is null)=(purged_at is not null)));
create table live_commerce.deposits(id uuid primary key,order_id uuid not null references live_commerce.orders(id),bank_ref_hash text not null unique check(bank_ref_hash~'^[a-f0-9]{64}$'),amount integer not null check(amount between 1 and 1000000000),document_id uuid not null unique references live_commerce.documents(id),recorded_by uuid not null references auth.users(id),occurred_at timestamptz not null,created_at timestamptz not null default now());
create table live_commerce.lots(id uuid primary key,order_id uuid not null unique references live_commerce.orders(id),deposit_id uuid not null unique references live_commerce.deposits(id),user_id uuid not null references auth.users(id),points integer not null check(points=10000),confirmed_by uuid not null references auth.users(id),created_at timestamptz not null default now());
create table live_commerce.quotes(id uuid primary key,user_id uuid not null references auth.users(id),episode_id bigint not null references public.episodes(id),publication_id uuid not null references authoring.publication_versions(id),policy_id uuid not null references live_commerce.policies(id),price integer not null check(price between 0 and 1000000),created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '5 minutes');
create table live_commerce.purchases(id uuid primary key,user_id uuid not null references auth.users(id),episode_id bigint not null references public.episodes(id),publication_id uuid not null references authoring.publication_versions(id),policy_id uuid not null references live_commerce.policies(id),author_id bigint not null references public.authors(id),owner_id uuid not null references auth.users(id),points integer not null check(points>0),revenue integer not null check(revenue>=0),created_at timestamptz not null default now());
create table live_commerce.allocations(purchase_id uuid not null references live_commerce.purchases(id),lot_id uuid not null references live_commerce.lots(id),points integer not null check(points>0),primary key(purchase_id,lot_id));
create table live_commerce.revocations(purchase_id uuid primary key references live_commerce.purchases(id),correction_id uuid not null,created_at timestamptz not null default now());
create table live_commerce.corrections(id uuid primary key,lot_id uuid not null references live_commerce.lots(id),kind text not null check(kind in ('REFUND','BANK_REVERSAL')),amount integer not null check(amount between 1 and 10000),document_id uuid not null references live_commerce.documents(id),bank_ref_hash text not null unique,recorded_by uuid not null references auth.users(id),created_at timestamptz not null default now());
create table live_commerce.correction_confirmations(id uuid primary key references live_commerce.corrections(id),confirmed_by uuid not null references auth.users(id),created_at timestamptz not null default now());
create table live_commerce.correction_rejections(id uuid primary key references live_commerce.corrections(id),actor_id uuid not null references auth.users(id),created_at timestamptz not null default now());
create table live_commerce.payouts(id uuid primary key,author_id bigint not null references public.authors(id),owner_id uuid not null references auth.users(id),gross integer not null check(gross between 1 and 1000000000),binding text not null,review_id uuid not null references launch_recovery.op12_reviews(id),sources jsonb not null,created_at timestamptz not null default now());
create table live_commerce.payout_approvals(id uuid primary key references live_commerce.payouts(id),actor_id uuid not null references auth.users(id),deduction integer not null check(deduction>=0),basis_ref text not null check(length(basis_ref) between 3 and 80),created_at timestamptz not null default now());
create table live_commerce.payout_completions(id uuid primary key references live_commerce.payouts(id),actor_id uuid not null references auth.users(id),net integer not null check(net>0),bank_ref_hash text not null unique,document_id uuid not null references live_commerce.documents(id),occurred_at timestamptz not null,created_at timestamptz not null default now());
create table live_commerce.payout_cancellations(id uuid primary key references live_commerce.payouts(id),actor_id uuid not null references auth.users(id),reason_ref text not null check(length(reason_ref) between 3 and 80),created_at timestamptz not null default now());
create table live_commerce.receipts(actor_id uuid not null,request_id uuid not null,fingerprint text not null,result jsonb not null,primary key(actor_id,request_id));
create table live_commerce.audit(id uuid primary key default gen_random_uuid(),actor_id uuid,action text not null,target_id uuid,created_at timestamptz not null default now());
create table live_commerce.limits(actor_id uuid primary key,window_at timestamptz not null,calls integer not null);
create index op13_lot_user on live_commerce.lots(user_id,created_at,id);
create index op13_purchase_user on live_commerce.purchases(user_id,episode_id);
create index op13_purchase_author on live_commerce.purchases(author_id,owner_id);
create index op13_payout_author on live_commerce.payouts(author_id,owner_id);
create index op13_allocation_lot on live_commerce.allocations(lot_id);
create index op13_correction_lot on live_commerce.corrections(lot_id);
create index op13_deposit_order on live_commerce.deposits(order_id);
create function live_commerce.immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'OP13 immutable ledger';end$$;
create trigger op13_document_guard before update or delete on live_commerce.documents for each row execute function launch_recovery.op12_document_guard();
create function live_commerce.remaining(lid uuid) returns integer language sql stable set search_path='' as $$
 select case when exists(select 1 from live_commerce.corrections c where c.lot_id=l.id and c.kind='BANK_REVERSAL' and not exists(select 1 from live_commerce.correction_rejections r where r.id=c.id)) then 0 else
 l.points-coalesce((select sum(a.points) from live_commerce.allocations a where a.lot_id=l.id and not exists(select 1 from live_commerce.revocations r where r.purchase_id=a.purchase_id)),0)::integer
 -coalesce((select sum(c.amount) from live_commerce.corrections c where c.lot_id=l.id and c.kind='REFUND' and not exists(select 1 from live_commerce.correction_rejections r where r.id=c.id)),0)::integer end from live_commerce.lots l where l.id=lid
$$;
create function live_commerce.balance(uid uuid) returns bigint language sql stable set search_path='' as $$select coalesce(sum(live_commerce.remaining(id)),0)::bigint from live_commerce.lots where user_id=uid$$;
create function live_commerce.earnings(aid bigint,uid uuid) returns bigint language sql stable set search_path='' as $$
 select coalesce((select sum(p.revenue) from live_commerce.purchases p where p.author_id=aid and p.owner_id=uid and not exists(select 1 from live_commerce.revocations r where r.purchase_id=p.id)),0)
 -coalesce((select sum(p.gross) from live_commerce.payouts p where p.author_id=aid and p.owner_id=uid and not exists(select 1 from live_commerce.payout_cancellations c where c.id=p.id)),0)
$$;
create function live_commerce.owned(uid uuid,eid bigint) returns boolean language sql stable set search_path='' as $$select exists(select 1 from live_commerce.purchases p where p.user_id=uid and p.episode_id=eid and not exists(select 1 from live_commerce.revocations r where r.purchase_id=p.id))$$;

create function live_commerce.work_visible(p_work bigint) returns boolean language sql stable set search_path='' as $$
 select authoring.stage18_work_visible(p_work) and exists(select 1 from public.works w join public.authors a on a.id=w.author_id
 join auth.users u on u.id=a.auth_user_id where w.id=p_work and a.status::text='APPROVED' and u.email_confirmed_at is not null
 and u.is_anonymous is not true and (u.banned_until is null or u.banned_until<=now()) and coalesce(to_jsonb(u)->>'deleted_at','')='')
$$;
create function live_commerce.episode_rows(p_work bigint default null)
returns table(episode_id bigint,work_id bigint,author_id bigint,episode_number integer,title text,version_id uuid,content_type text,content text,document jsonb,manifest jsonb)
language sql stable set search_path='' as $$
 select e.id,e.work_id,w.author_id,e.episode_number,v.title,h.version_id,w.content_type::text,v.content,v.content_document,v.webtoon
 from public.episodes e join public.works w on w.id=e.work_id
 join authoring.publication_heads h on h.episode_id=e.id
 join authoring.publication_versions v on v.id=h.version_id and v.episode_id=e.id and v.work_id=e.work_id
 where (p_work is null or e.work_id=p_work) and live_commerce.work_visible(e.work_id)
 and e.status::text='PUBLISHED' and (e.scheduled_at is null or e.scheduled_at<=now()) and h.published_at<=now()
 and (w.published_at is null or w.published_at<=now())
 and (w.content_type::text='NOVEL' and v.webtoon is null or w.content_type::text='WEBTOON' and authoring.webtoon_manifest_valid(e.work_id,v.webtoon,true))
$$;

create function public.op13_commerce(p_user uuid,p_role text,p_action text,p_data jsonb default '{}') returns jsonb
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
   select o.id,o.created_at,jsonb_build_object('id',o.id,'userId',o.user_id,'amount',o.amount,'destinationHash',o.destination_hash,'lotId',(select id from live_commerce.lots where order_id=o.id),'confirmed',exists(select 1 from live_commerce.lots l where l.order_id=o.id),'deposits',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'amount',d.amount,'documentId',d.document_id,'recordedBy',d.recorded_by)) from live_commerce.deposits d where d.order_id=o.id),'[]')) item
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
  if not exists(select 1 from live_commerce.documents where id=dep.document_id and envelope is not null and expires_at>now()) then return '{"error":"DOCUMENT_UNAVAILABLE","status":409}';end if;
  if live_commerce.balance(ord.user_id)+ord.points>1000000000 then return '{"error":"COMMERCE_CONFLICT","status":409}';end if;
  insert into live_commerce.lots values(rid,ord.id,dep.id,ord.user_id,ord.points,p_user,now());result:=jsonb_build_object('id',rid,'points',ord.points);
 elsif p_action in ('confirm-correction','reject-correction') then
  select * into corr from live_commerce.corrections where id=(p_data->>'correctionId')::uuid;
  select * into lot from live_commerce.lots where id=corr.lot_id;
  if corr.id is null or p_user in (corr.recorded_by,lot.user_id) then return '{"error":"INDEPENDENT_REVIEW_REQUIRED","status":403}';end if;
  if exists(select 1 from live_commerce.correction_rejections where id=corr.id) or exists(select 1 from live_commerce.correction_confirmations where id=corr.id) then return '{"error":"CORRECTION_NOT_READY","status":409}';end if;
  if p_action='confirm-correction' and not exists(select 1 from live_commerce.documents where id=corr.document_id and envelope is not null and expires_at>now()) then return '{"error":"DOCUMENT_UNAVAILABLE","status":409}';end if;
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
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or not_null_violation or check_violation then return '{"error":"INVALID_COMMERCE_REQUEST","status":400}';when unique_violation then return '{"error":"COMMERCE_CONFLICT","status":409}';
end$$;

create function live_commerce.valid_evidence(d jsonb) returns boolean language sql immutable set search_path='' as $$select coalesce(
 jsonb_typeof(d)='object' and (d->>'id')~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 and launch_recovery.settlement_envelope_valid(d->'envelope',290000) and (d->>'digest')~'^[a-f0-9]{64}$' and (d->>'policyHash')~'^[a-f0-9]{64}$'
 and (d->>'policyVersion')~'^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$' and d->>'policyVersion'!~*'draft'
 and jsonb_typeof(d->'retentionDays')='number' and (d->>'retentionDays')~'^[1-9][0-9]{0,3}$' and (d->>'retentionDays')::integer<=3650,false)$$;
create function live_commerce.save_evidence(uid uuid,purpose text,d jsonb) returns uuid language plpgsql set search_path='' as $$begin
 insert into live_commerce.documents values((d->>'id')::uuid,uid,purpose,d->'envelope',d->>'digest',d->>'policyVersion',d->>'policyHash',(d->>'retentionDays')::integer,now(),now()+(d->>'retentionDays')::integer*interval '1 day',null);return (d->>'id')::uuid;end$$;
create function live_commerce.payout_ready(pid uuid) returns boolean language plpgsql set search_path='' as $$declare p live_commerce.payouts;u uuid;f jsonb;begin
 select * into p from live_commerce.payouts where id=pid;
 perform 1 from launch_recovery.virtual_accounts where kind='author' and profile_id=p.author_id::text for update;
 select auth_user_id into u from public.authors where id=p.author_id and status::text='APPROVED' for update;
 perform 1 from launch_recovery.author_payout_details where author_id=p.author_id for update;
 perform 1 from launch_recovery.author_settlement_applications where author_id=p.author_id for update;
 f:=launch_recovery.op12_facts(p.author_id);
 return coalesce(u=p.owner_id and f->>'binding'=p.binding and f->>'reviewId'=p.review_id::text and f->>'bankConfirmed'='true' and live_commerce.earnings(p.author_id,u)>=0
 and not exists(select 1 from live_commerce.corrections c join live_commerce.allocations a on a.lot_id=c.lot_id join live_commerce.purchases x on x.id=a.purchase_id where x.author_id=p.author_id and not exists(select 1 from live_commerce.correction_confirmations cc where cc.id=c.id) and not exists(select 1 from live_commerce.correction_rejections cc where cc.id=c.id)),false);
end$$;
create function live_commerce.payout_card(pid uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',p.id,'authorId',p.author_id::text,'penName',a.pen_name,'gross',p.gross,'deduction',ap.deduction,'net',coalesce(pc.net,p.gross-ap.deduction),'approvedBy',ap.actor_id,'documentId',pc.document_id,
 'status',case when ca.id is not null then 'CANCELLED' when pc.id is not null then 'PAID' when ap.id is not null then 'APPROVED' else 'REQUESTED' end,'createdAt',p.created_at)
 from live_commerce.payouts p join public.authors a on a.id=p.author_id left join live_commerce.payout_approvals ap on ap.id=p.id left join live_commerce.payout_completions pc on pc.id=p.id left join live_commerce.payout_cancellations ca on ca.id=p.id where p.id=pid
$$;
create function public.op13_purge_documents() returns jsonb language plpgsql security definer set search_path='' as $$declare n integer;begin
 with due as(select id from live_commerce.documents where expires_at<=now() and envelope is not null order by expires_at,id limit 100 for update skip locked),purged as(update live_commerce.documents d set envelope=null,purged_at=now() from due where d.id=due.id returning d.id)
 insert into live_commerce.audit(action,target_id) select 'PURGE',id from purged;get diagnostics n=row_count;return jsonb_build_object('purged',n);end$$;
-- New service-only lookup for the persistent HTTP guard; existing RPCs are unchanged.
create function public.op13_registered_episode(p_episode bigint) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.episodes e join live_commerce.catalog c on c.work_id=e.work_id where e.id=p_episode)$$;
do $$declare t record;f record;begin
 for t in select tablename from pg_tables where schemaname='live_commerce' loop
  execute format('alter table live_commerce.%I enable row level security',t.tablename);
  execute format('revoke all on live_commerce.%I from public,anon,authenticated,service_role',t.tablename);
  if t.tablename not in ('catalog','documents','limits') then execute format('create trigger op13_immutable before update or delete on live_commerce.%I for each row execute function live_commerce.immutable()',t.tablename);end if;
 end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='live_commerce' or n.nspname='public' and p.proname like 'op13_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end$$;
grant execute on function public.op13_commerce(uuid,text,text,jsonb),public.op13_purge_documents(),public.op13_registered_episode(bigint) to service_role;
commit;
