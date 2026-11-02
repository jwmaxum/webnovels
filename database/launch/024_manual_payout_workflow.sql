-- Manual-first settlement workflow over explicitly simulated OP07 earnings.
-- No actual bank transfer, no conversion of simulated earnings into real money.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$begin
 if current_setting('webnovels.manual_payout_workflow_apply_verified',true) is distinct from 'true'
 or to_regprocedure('public.op10_payout_runtime(text,jsonb)') is null
 or to_regclass('commerce.op11_cases') is not null then raise exception 'Reviewed OP11 prerequisites required';end if;
end$$;
create table commerce.op11_cases(payout_id uuid primary key references commerce.op07_payouts(id),method text not null check(method in ('MANUAL','TOSS_TEST','LEGACY_REVIEW')),actor_id uuid not null references auth.users(id),started_at timestamptz not null default now());
create table commerce.op11_proofs(payout_id uuid primary key references commerce.op11_cases(payout_id),outcome text not null check(outcome in ('PAID','FAILED')),transaction_ref text not null unique check(transaction_ref~'^TEST-[A-Za-z0-9_-]{1,72}$'),document_ref text not null check(document_ref~'^TEST-[A-Za-z0-9_-]{1,72}$'),amount_krw integer not null check(amount_krw>0),payee_ref text not null,occurred_at timestamptz not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),provenance text not null default 'MANUAL_ATTESTED_TEST' check(provenance='MANUAL_ATTESTED_TEST'));
create table commerce.op11_events(id uuid primary key default gen_random_uuid(),payout_id uuid not null references commerce.op07_payouts(id),actor_id uuid not null references auth.users(id),kind text not null check(kind in ('START','ADOPT','COMPLETE','FAILURE','NOTE','HOLD')),note text not null check(length(btrim(note)) between 3 and 300 and note!~'[<>[:cntrl:]]'),created_at timestamptz not null default now());
create index op11_events_payout on commerce.op11_events(payout_id,created_at desc,id);
create table commerce.op11_receipts(actor_id uuid not null references auth.users(id),request_id uuid not null,fingerprint text not null,result jsonb not null,primary key(actor_id,request_id));
create table commerce.op11_limits(actor_id uuid primary key references auth.users(id),window_at timestamptz not null,writes integer not null check(writes between 1 and 30));

-- Existing external TEST records retain their path. Mixed old histories require
-- review; migration never changes the OP07/OP10 rows or claims a bank payment.
insert into commerce.op11_cases(payout_id,method,actor_id,started_at)
 select j.source_id,case when p.status='APPROVED' then 'TOSS_TEST' else 'LEGACY_REVIEW' end,j.actor_id,j.created_at
 from commerce.op10_jobs j join commerce.op07_payouts p on p.id=j.source_id;

create function commerce.op11_method_guard() returns trigger language plpgsql set search_path='' as $$
declare method_value text;source_status text;
begin
 if tg_table_name='op10_jobs' then
  if tg_op='UPDATE' and old.dispatched_at is not null then return new;end if;
  -- OP10 prepare already holds a share lock on this same source row. OP07 status
  -- updates require an exclusive row lock: both paths serialize before selection.
  select status into source_status from commerce.op07_payouts where id=new.source_id for share;
  if tg_op='INSERT' then
   if source_status<>'APPROVED' then raise exception 'PAYOUT_METHOD_CONFLICT';end if;
   insert into commerce.op11_cases(payout_id,method,actor_id) values(new.source_id,'TOSS_TEST',new.actor_id) on conflict do nothing;
  end if;
  select method into method_value from commerce.op11_cases where payout_id=new.source_id;
  if method_value is distinct from 'TOSS_TEST' then raise exception 'PAYOUT_METHOD_CONFLICT';end if;
  return new;
 end if;
 if new.status is not distinct from old.status then return new;end if;
 select method into method_value from commerce.op11_cases where payout_id=new.id;
 if method_value in ('TOSS_TEST','LEGACY_REVIEW') then raise exception 'PAYOUT_METHOD_CONFLICT';end if;
 if new.status='UNKNOWN' and method_value is distinct from 'MANUAL' then raise exception 'MANUAL_WORKFLOW_REQUIRED';end if;
 if new.status in ('PAID','FAILED') and not exists(select 1 from commerce.op11_proofs where payout_id=new.id and outcome=new.status) then raise exception 'MANUAL_PROOF_REQUIRED';end if;
 return new;
end$$;
create trigger op11_manual_guard before update of status on commerce.op07_payouts for each row execute function commerce.op11_method_guard();
create trigger op11_provider_guard before insert or update of dispatched_at on commerce.op10_jobs for each row execute function commerce.op11_method_guard();

create function commerce.op11_view(p_id uuid,p_admin boolean) returns jsonb language sql stable set search_path='' set timezone='UTC' as $$
 select jsonb_build_object('payoutId',p.id,'method',coalesce(c.method,case when p.status in ('UNKNOWN','PAID','FAILED') then 'LEGACY_REVIEW' else 'MANUAL' end),'selected',c.payout_id is not null,'status',p.status,'revision',p.revision::text,'amountKrw',p.amount_krw,'payeeReference',p.test_reference,'startedAt',p.dispatched_at,'completedAt',p.completed_at,
 'proof',case when r.payout_id is null then null else jsonb_build_object('outcome',r.outcome,'amountKrw',r.amount_krw,'occurredAt',r.occurred_at,'provenance',r.provenance)||case when p_admin then jsonb_build_object('transactionReference',r.transaction_ref,'documentReference',r.document_ref) else '{}' end end,
 'provider',case when j.id is null then null else jsonb_build_object('state',j.state,'dispatchedAt',j.dispatched_at,'nextQueryAt',j.next_query_at,'lastObservedAt',(select max(created_at) from commerce.op10_evidence where job_id=j.id),'ledgerApplied',false) end,
 'history',case when p_admin then coalesce((select jsonb_agg(jsonb_build_object('kind',e.kind,'note',e.note,'createdAt',e.created_at) order by e.created_at desc,e.id) from (select * from commerce.op11_events where payout_id=p.id order by created_at desc,id limit 30)e),'[]') else '[]' end)
 from commerce.op07_payouts p left join commerce.op11_cases c on c.payout_id=p.id left join commerce.op11_proofs r on r.payout_id=p.id left join commerce.op10_jobs j on j.source_id=p.id where p.id=p_id
$$;

create function public.op11_manual_payout(p_user uuid,p_action text,p_data jsonb default '{}',p_admin boolean default false) returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare fields text[];pid uuid;req uuid;fp text;cached commerce.op11_receipts;p commerce.op07_payouts;method_value text;result jsonb;inner_result jsonb;event_kind text;at_time timestamptz;writes_no integer;
begin
 if jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text)>8192 then return '{"error":"INVALID_PAYOUT_REQUEST","status":400}';end if;
 fields:=case p_action when 'detail' then array['payoutId'] when 'start' then array['payoutId','revision','requestId','reason'] when 'note' then array['payoutId','revision','requestId','reason'] when 'hold' then array['payoutId','revision','requestId','reason'] when 'complete' then array['payoutId','revision','requestId','reason','reference','documentReference','testReference','amountKrw','paidAt'] when 'failure' then array['payoutId','revision','requestId','reason','reference','documentReference','testReference'] end;
 if fields is null or exists(select 1 from jsonb_object_keys(p_data) k where not k=any(fields)) or jsonb_typeof(p_data->'payoutId') is distinct from 'string' or coalesce(p_data->>'payoutId','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return '{"error":"INVALID_PAYOUT_REQUEST","status":400}';end if;
 pid:=(p_data->>'payoutId')::uuid;
 -- Reuse current Auth + administrator/author ownership validation, including reads.
 result:=public.op07_payouts(p_user,case when p_admin then 'admin-detail' else 'request-detail' end,jsonb_build_object('payoutId',pid));
 if result?'error' then return result;end if;
 if p_action='detail' then return jsonb_build_object('mode','TEST','livePayouts',false,'workflow',commerce.op11_view(pid,p_admin));end if;
 if not p_admin then return '{"error":"ADMIN_FORBIDDEN","status":403}';end if;
 if jsonb_typeof(p_data->'requestId') is distinct from 'string' or coalesce(p_data->>'requestId','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' or jsonb_typeof(p_data->'revision') is distinct from 'string' or coalesce(p_data->>'revision','')!~'^(0|[1-9][0-9]{0,17})$' or jsonb_typeof(p_data->'reason') is distinct from 'string' or length(btrim(p_data->>'reason')) not between 3 and 300 or (p_data->>'reason')~'[<>[:cntrl:]]' then return '{"error":"INVALID_PAYOUT_REQUEST","status":400}';end if;
 req:=(p_data->>'requestId')::uuid;fp:=encode(sha256(convert_to(p_action||':'||p_data::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('op11-actor:'||p_user,0));
 select * into cached from commerce.op11_receipts where actor_id=p_user and request_id=req;
 if found then
  if cached.fingerprint<>fp then return '{"error":"IDEMPOTENCY_CONFLICT","status":409}';end if;
  return cached.result||'{"replayed":true}';
 end if;
 if exists(select 1 from commerce.op11_limits where actor_id=p_user and window_at>now()-interval '1 minute' and writes>=30) then return '{"error":"RATE_LIMITED","status":429}';end if;
 insert into commerce.op11_limits values(p_user,now(),1) on conflict(actor_id) do update set writes=case when op11_limits.window_at>now()-interval '1 minute' then op11_limits.writes+1 else 1 end,window_at=case when op11_limits.window_at>now()-interval '1 minute' then op11_limits.window_at else now() end;
 select * into p from commerce.op07_payouts where id=pid;
 perform pg_advisory_xact_lock(hashtextextended('op07-write-user:'||p_user,0));
 perform pg_advisory_xact_lock(hashtextextended('op07-author:'||p.author_id,0));
 -- Same funding/payee ordering as OP07. Keep the selected source locked through
 -- route selection, proof insert and the original ledger transition.
 perform 1 from commerce.op05_orders o where o.id in(select l.order_id from commerce.op05_allocations x join commerce.op05_lots l on l.id=x.lot_id join commerce.op04_purchases t on t.id=x.purchase_id where t.author_id=p.author_id) order by o.id for share;
 perform 1 from commerce.op07_payees where author_id=p.author_id for update;
 select * into p from commerce.op07_payouts where id=pid for update;
 if p.revision::text<>p_data->>'revision' then return '{"error":"REVISION_CONFLICT","status":409}';end if;
 select method into method_value from commerce.op11_cases where payout_id=pid;
 if p_action not in ('note','hold') and method_value in ('TOSS_TEST','LEGACY_REVIEW') then return '{"error":"PAYOUT_METHOD_CONFLICT","status":409}';end if;
 if p_action in ('note','hold') and (select count(*) from commerce.op11_events where payout_id=pid)>=200 then return '{"error":"WORKFLOW_HISTORY_LIMIT","status":409}';end if;
 -- Any error from a reused RPC rolls back inserted proof/route, not just its own
 -- ledger statements. The outer rate attempt remains committed on rejection.
 begin
  if p_action='start' then
   if p.status not in ('APPROVED','UNKNOWN') or method_value is not null then return '{"error":"PAYOUT_STATE_CONFLICT","status":409}';end if;
   insert into commerce.op11_cases(payout_id,method,actor_id) values(pid,'MANUAL',p_user);
   if p.status='APPROVED' then
    inner_result:=public.op07_payouts(p_user,'admin-begin',p_data);event_kind:='START';
   else event_kind:='ADOPT';end if;
  elsif p_action in ('complete','failure') then
   if method_value is distinct from 'MANUAL' or p.status<>'UNKNOWN' then return '{"error":"PAYOUT_STATE_CONFLICT","status":409}';end if;
   if exists(select 1 from unnest(array['reference','documentReference','testReference']) k where jsonb_typeof(p_data->k) is distinct from 'string' or coalesce(p_data->>k,'')!~'^TEST-[A-Za-z0-9_-]{1,72}$') then return '{"error":"TEST_REFERENCE_REQUIRED","status":400}';end if;
   if p_data->>'testReference'<>p.test_reference then return '{"error":"PAYOUT_PROOF_MISMATCH","status":409}';end if;
   at_time:=now();
   if p_action='complete' then
    if jsonb_typeof(p_data->'amountKrw') is distinct from 'number' or p_data->>'amountKrw'<>p.amount_krw::text or jsonb_typeof(p_data->'paidAt') is distinct from 'string' or coalesce(p_data->>'paidAt','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$' then return '{"error":"PAYOUT_PROOF_MISMATCH","status":409}';end if;
    at_time:=(p_data->>'paidAt')::timestamptz;
    if at_time<p.dispatched_at or at_time>clock_timestamp()+interval '5 minutes' then return '{"error":"PAYOUT_PROOF_MISMATCH","status":409}';end if;
   end if;
   insert into commerce.op11_proofs(payout_id,outcome,transaction_ref,document_ref,amount_krw,payee_ref,occurred_at,actor_id) values(pid,case when p_action='complete' then 'PAID' else 'FAILED' end,p_data->>'reference',p_data->>'documentReference',p.amount_krw,p.test_reference,at_time,p_user);
   inner_result:=public.op07_payouts(p_user,case when p_action='complete' then 'admin-paid' else 'admin-fail' end,p_data-'documentReference');
   event_kind:=case when p_action='complete' then 'COMPLETE' else 'FAILURE' end;
  elsif p_action='hold' then
   if p.status not in ('APPROVED','UNKNOWN') then return '{"error":"PAYOUT_STATE_CONFLICT","status":409}';end if;event_kind:='HOLD';
  else event_kind:='NOTE';end if;
  if inner_result?'error' then raise exception using errcode='P0011',message=inner_result::text;end if;
  insert into commerce.op11_events(payout_id,actor_id,kind,note) values(pid,p_user,event_kind,p_data->>'reason');
  result:=jsonb_build_object('mode','TEST','livePayouts',false,'workflow',commerce.op11_view(pid,true),'replayed',false);
  insert into commerce.op11_receipts values(p_user,req,fp,result);
  return result;
 exception when sqlstate 'P0011' then return sqlerrm::jsonb;
  when unique_violation then return '{"error":"PAYOUT_EVIDENCE_CONFLICT","status":409}';
 end;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return '{"error":"INVALID_PAYOUT_REQUEST","status":400}';
end$$;

do $$declare t text;f record;begin
 foreach t in array array['cases','proofs','events','receipts','limits'] loop
  execute format('alter table commerce.op11_%I enable row level security',t);
  execute format('revoke all on commerce.op11_%I from public,anon,authenticated,service_role',t);
 end loop;
 foreach t in array array['cases','proofs','events','receipts'] loop
  execute format('create trigger op11_immutable before update or delete on commerce.op11_%I for each row execute function commerce.op07_immutable()',t);
 end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('commerce','public') and p.proname like 'op11_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end$$;
grant execute on function public.op11_manual_payout(uuid,text,jsonb,boolean) to service_role;
commit;
