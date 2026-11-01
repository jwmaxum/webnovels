-- UI-R13: optional settlement preparation; never enables payment, PASS or bank verification.
begin;
set local lock_timeout='5s';
do $$ begin
 if current_setting('webnovels.settlement_apply_verified',true) is distinct from 'true'
 or not public.launch_author_workspace_ready()
 or to_regprocedure('public.launch_author_dashboard(uuid,text,jsonb)') is null then
  raise exception 'Reviewed dashboard and settlement prerequisites required';
 end if;
end $$;

create table if not exists launch_recovery.author_settlement_applications (
 author_id bigint primary key references public.authors(id),user_id uuid not null references auth.users(id),
 revision bigint not null check(revision>0),status text not null check(status in ('PENDING','APPROVED','NEEDS_CHANGES','WITHDRAWN','EXPIRED')),
 applicant_type text not null check(applicant_type in ('INDIVIDUAL','SOLE_PROPRIETOR','CORPORATION')),
 document_type text not null check(document_type in ('RESIDENT_CARD','DRIVER_LICENSE','PASSPORT')),
 profile_envelope jsonb,identity_envelope jsonb,business_envelope jsonb,
 policy_version text not null,policy_hash text not null check(policy_hash ~ '^[a-f0-9]{64}$'),
 transfer_version text not null,transfer_hash text not null check(transfer_hash ~ '^[a-f0-9]{64}$'),
 submitted_at timestamptz not null,expires_at timestamptz not null,profile_expires_at timestamptz not null,
 reviewed_at timestamptz,review_note text not null default '',updated_at timestamptz not null default now(),
 check(status='PENDING' or (identity_envelope is null and business_envelope is null)),
 check(status not in ('WITHDRAWN','EXPIRED') or profile_envelope is null)
);
create index if not exists author_settlement_pending_expiry on launch_recovery.author_settlement_applications(expires_at) where status='PENDING';
create index if not exists author_settlement_profile_expiry on launch_recovery.author_settlement_applications(profile_expires_at) where profile_envelope is not null;
create table if not exists launch_recovery.author_settlement_audit (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),
 author_id bigint not null references public.authors(id),action text not null,revision bigint not null,
 policy_version text,policy_hash text,transfer_version text,transfer_hash text,reason_fingerprint text,created_at timestamptz not null default now()
);
create table if not exists launch_recovery.author_settlement_receipts (
 actor_id uuid not null references auth.users(id),request_key uuid not null,
 action text not null,author_id bigint not null references public.authors(id),
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),result jsonb not null,
 created_at timestamptz not null default now(),primary key(actor_id,request_key)
);
create table if not exists launch_recovery.author_settlement_attempts (
 actor_id uuid primary key references auth.users(id),window_start timestamptz not null,attempts integer not null check(attempts>0)
);
alter table launch_recovery.author_settlement_applications enable row level security;
alter table launch_recovery.author_settlement_audit enable row level security;
alter table launch_recovery.author_settlement_receipts enable row level security;
alter table launch_recovery.author_settlement_attempts enable row level security;
revoke all on launch_recovery.author_settlement_applications,launch_recovery.author_settlement_audit,
 launch_recovery.author_settlement_receipts,launch_recovery.author_settlement_attempts from public,anon,authenticated,service_role;
-- A deleted account must never cause its revision to be reused by a later account.
create sequence if not exists launch_recovery.author_settlement_bank_revision_seq
 minvalue 1 maxvalue 9999999999999999 start with 1;
revoke all on sequence launch_recovery.author_settlement_bank_revision_seq from public,anon,authenticated,service_role;
select setval('launch_recovery.author_settlement_bank_revision_seq',greatest(
 (select last_value from launch_recovery.author_settlement_bank_revision_seq),
 coalesce((select max(revision) from launch_recovery.author_payout_details),1)),true);

create or replace function launch_recovery.settlement_audit_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' and old.created_at<now()-interval '2 years' then return old; end if;
 raise exception 'Settlement audit is immutable';
end $$;
drop trigger if exists settlement_audit_immutable on launch_recovery.author_settlement_audit;
create trigger settlement_audit_immutable before update or delete on launch_recovery.author_settlement_audit
 for each row execute function launch_recovery.settlement_audit_immutable();

create or replace function launch_recovery.settlement_envelope_valid(value jsonb,maximum integer) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(value) is distinct from 'object' then return false;end if;
 return value->>'version'='1' and value->>'keyVersion'='v1'
 and value->>'iv' ~ '^[A-Za-z0-9+/]{16}$'
 and length(value->>'ciphertext') between 24 and maximum and value->>'ciphertext' ~ '^[A-Za-z0-9+/]+={0,2}$'
 and not exists(select 1 from jsonb_object_keys(value) k where k not in ('version','keyVersion','iv','ciphertext'));
end
$$;
create or replace function launch_recovery.settlement_metadata(value launch_recovery.author_settlement_applications) returns jsonb
language sql stable set search_path='' as $$
 select case when value.author_id is null then null else jsonb_build_object(
  'authorId',value.author_id::text,'revision',value.revision::text,'status',value.status,
  'applicantType',value.applicant_type,'documentType',value.document_type,
  'submittedAt',value.submitted_at,'expiresAt',value.expires_at,'profileExpiresAt',value.profile_expires_at,
  'reviewedAt',value.reviewed_at,'reviewNote',value.review_note,
  'documentAvailable',value.status='PENDING' and value.identity_envelope is not null and value.expires_at>now()) end
$$;
create or replace function public.author_settlement_registration_ready() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from authoring.migrations where version='launch-016-author-settlement')
$$;

create or replace function public.expire_author_settlement_registrations() returns jsonb
language plpgsql security definer set search_path='' as $$
declare purged integer; receipts integer; audits integer;
begin
 with due as (select author_id from launch_recovery.author_settlement_applications
  where (status='PENDING' and expires_at<=now()) or (profile_envelope is not null and profile_expires_at<=now())
  order by author_id limit 1000 for update skip locked)
 update launch_recovery.author_settlement_applications a set status='EXPIRED',profile_envelope=null,
  identity_envelope=null,business_envelope=null,review_note='',revision=revision+1,updated_at=now()
  from due where a.author_id=due.author_id;
 get diagnostics purged=row_count;
 delete from launch_recovery.author_settlement_receipts where created_at<now()-interval '30 days';get diagnostics receipts=row_count;
 delete from launch_recovery.author_settlement_audit where created_at<now()-interval '2 years';get diagnostics audits=row_count;
 delete from launch_recovery.author_settlement_attempts where window_start<now()-interval '1 day';
 return jsonb_build_object('expired',purged,'receiptsPurged',receipts,'auditPurged',audits);
end $$;

create or replace function public.author_settlement_registration(
 p_user uuid,p_action text,p_author bigint default null,p_data jsonb default '{}'::jsonb,p_key uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare who jsonb; aid bigint; row launch_recovery.author_settlement_applications;
 receipt launch_recovery.author_settlement_receipts;result jsonb;fingerprint text:=p_data->>'requestFingerprint';
 offset_no integer;maximum integer;items jsonb;count_no bigint;next_revision bigint;bank_revision bigint;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then return jsonb_build_object('error','INVALID_SETTLEMENT_DETAILS','status',400);end if;
 if not public.author_settlement_registration_ready() or not public.launch_author_workspace_ready() then
  return jsonb_build_object('error','SETTLEMENT_NOT_ACTIVATED','status',503);end if;
 who:=public.launch_account_actor(p_user);if who?'error' then return who;end if;
 if p_action in ('admin-list','reveal','review','admin-attempt') then
  if coalesce(who->'admin'->>'role','')<>'SUPER_ADMIN' or coalesce((who->'admin'->>'is_active')::boolean,false) is not true then
   return jsonb_build_object('error','ADMIN_FORBIDDEN','status',403);end if;
  aid:=p_author;
 else
  if coalesce(who->'author'->>'status','')<>'APPROVED' then return jsonb_build_object('error','AUTHOR_REQUIRED','status',403);end if;
  aid:=(who->'author'->>'id')::bigint;
  if p_author is not null and p_author<>aid then return jsonb_build_object('error','AUTHOR_REQUIRED','status',403);end if;
 end if;
 if p_action in ('attempt','admin-attempt') then
  maximum:=case when p_action='admin-attempt' then 30 else 5 end;
  insert into launch_recovery.author_settlement_attempts(actor_id,window_start,attempts) values(p_user,now(),1)
  on conflict(actor_id) do update set window_start=case when author_settlement_attempts.window_start<now()-interval '15 minutes' then now() else author_settlement_attempts.window_start end,
   attempts=case when author_settlement_attempts.window_start<now()-interval '15 minutes' then 1 else author_settlement_attempts.attempts+1 end
  where author_settlement_attempts.window_start<now()-interval '15 minutes' or author_settlement_attempts.attempts<maximum;
  if not found then return jsonb_build_object('error','RATE_LIMITED','status',429);end if;
  return jsonb_build_object('ok',true);
 end if;
 if p_action='admin-list' then
  if coalesce(p_data->>'offset','0') !~ '^(0|[1-9][0-9]{0,5})$' then return jsonb_build_object('error','INVALID_QUERY','status',400);end if;
  offset_no:=coalesce(p_data->>'offset','0')::integer;
  select count(*) into count_no from launch_recovery.author_settlement_applications;
  select coalesce(jsonb_agg(x.item order by x.submitted_at desc,x.author_id),'[]'::jsonb) into items from (
   select a.author_id,a.submitted_at,launch_recovery.settlement_metadata(a)||jsonb_build_object('penName',b.pen_name) item
   from launch_recovery.author_settlement_applications a join public.authors b on b.id=a.author_id
   order by a.submitted_at desc,a.author_id offset offset_no limit 30) x;
  return jsonb_build_object('applications',items,'total',count_no,'offset',offset_no,'pageSize',30);
 end if;
 if p_action not in ('get','submit','withdraw','bank-delete','reveal','review') or aid is null then return jsonb_build_object('error','INVALID_ACTION','status',400);end if;
 if p_action='bank-delete' then perform pg_advisory_xact_lock(74122016001);end if;
 -- Same author/account lock order as bank changes; account authorization is rechecked.
 perform 1 from launch_recovery.virtual_accounts where kind='author' and profile_id=aid::text for update;
 perform 1 from public.authors where id=aid for update;
 if not found then return jsonb_build_object('error','AUTHOR_NOT_FOUND','status',404);end if;
 who:=public.launch_account_actor(p_user);if who?'error' then return who;end if;
 if p_action in ('reveal','review') then
  if who->'admin'->>'role' is distinct from 'SUPER_ADMIN' or coalesce((who->'admin'->>'is_active')::boolean,false) is not true then return jsonb_build_object('error','ADMIN_FORBIDDEN','status',403);end if;
 elsif who->'author'->>'id' is distinct from aid::text or who->'author'->>'status' is distinct from 'APPROVED' then
  return jsonb_build_object('error','AUTHOR_REQUIRED','status',403);
 end if;
 if p_action='bank-delete' then
  if p_key is null or coalesce(fingerprint,'') !~ '^[a-f0-9]{64}$' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('revision','requestFingerprint')) then return jsonb_build_object('error','INVALID_IDEMPOTENCY_KEY','status',400);end if;
  select * into receipt from launch_recovery.author_settlement_receipts where actor_id=p_user and request_key=p_key;
  if found then
   if receipt.action<>p_action or receipt.author_id<>aid or receipt.fingerprint<>fingerprint then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT','status',409);end if;
   return receipt.result;
  end if;
  select revision into bank_revision from launch_recovery.author_payout_details where author_id=aid for update;
  if bank_revision is null or p_data->>'revision' is distinct from bank_revision::text then return jsonb_build_object('error','SETTLEMENT_CONFLICT','status',409);end if;
  perform setval('launch_recovery.author_settlement_bank_revision_seq',greatest((select last_value from launch_recovery.author_settlement_bank_revision_seq),bank_revision),true);
  delete from launch_recovery.author_payout_details where author_id=aid;
  insert into launch_recovery.author_settlement_audit(actor_id,author_id,action,revision) values(p_user,aid,'BANK_DELETE',bank_revision);
  result:=jsonb_build_object('ok',true,'bank',null);
  insert into launch_recovery.author_settlement_receipts(actor_id,request_key,action,author_id,fingerprint,result) values(p_user,p_key,p_action,aid,fingerprint,result);
  return result;
 end if;
 select * into row from launch_recovery.author_settlement_applications where author_id=aid for update;
 if row.author_id is not null and ((row.status='PENDING' and row.expires_at<=now()) or (row.profile_envelope is not null and row.profile_expires_at<=now())) then
  update launch_recovery.author_settlement_applications set status='EXPIRED',profile_envelope=null,identity_envelope=null,business_envelope=null,
   review_note='',revision=revision+1,updated_at=now() where author_id=aid returning * into row;
 end if;
 if p_action='get' then return jsonb_build_object('application',launch_recovery.settlement_metadata(row));end if;
 if p_action in ('submit','withdraw','review') then
  if p_key is null or coalesce(fingerprint,'') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','INVALID_IDEMPOTENCY_KEY','status',400);end if;
  select * into receipt from launch_recovery.author_settlement_receipts where actor_id=p_user and request_key=p_key;
  if found then
   if receipt.action<>p_action or receipt.author_id<>aid or receipt.fingerprint<>fingerprint then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT','status',409);end if;
   return receipt.result;
  end if;
 end if;
 if p_data->>'revision' is distinct from coalesce(row.revision,0)::text then return jsonb_build_object('error','SETTLEMENT_CONFLICT','status',409);end if;
 if p_action='submit' then
  if coalesce(p_data->>'applicantType','') not in ('INDIVIDUAL','SOLE_PROPRIETOR','CORPORATION') or coalesce(p_data->>'documentType','') not in ('RESIDENT_CARD','DRIVER_LICENSE','PASSPORT')
   or coalesce(p_data->>'policyVersion','')<>'2026-11-01-settlement-v1' or coalesce(p_data->>'policyHash','')<>'e8d99460efd7c5316126a9932143dd02db82e46b0e6957d899fa39f3bbb344ac'
   or coalesce(p_data->>'transferNoticeVersion','') !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$' or p_data->>'transferNoticeVersion' ~* 'draft'
   or coalesce(p_data->>'transferNoticeHash','') !~ '^[a-f0-9]{64}$'
   or launch_recovery.settlement_envelope_valid(p_data->'profileEnvelope',20000) is not true
   or launch_recovery.settlement_envelope_valid(p_data->'identityEnvelope',290000) is not true
   or (p_data->>'applicantType'<>'INDIVIDUAL' and launch_recovery.settlement_envelope_valid(p_data->'businessEnvelope',290000) is not true)
   or (p_data->>'applicantType'='INDIVIDUAL' and p_data->'businessEnvelope' is not null and p_data->'businessEnvelope'<>'null'::jsonb)
   or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('revision','applicantType','documentType','policyVersion','policyHash','transferNoticeVersion','transferNoticeHash','profileEnvelope','identityEnvelope','businessEnvelope','requestFingerprint')) then
   return jsonb_build_object('error','INVALID_SETTLEMENT_DETAILS','status',400);end if;
  next_revision:=coalesce(row.revision,0)+1;
  insert into launch_recovery.author_settlement_applications(author_id,user_id,revision,status,applicant_type,document_type,profile_envelope,identity_envelope,business_envelope,policy_version,policy_hash,transfer_version,transfer_hash,submitted_at,expires_at,profile_expires_at)
   values(aid,p_user,next_revision,'PENDING',p_data->>'applicantType',p_data->>'documentType',p_data->'profileEnvelope',p_data->'identityEnvelope',nullif(p_data->'businessEnvelope','null'::jsonb),p_data->>'policyVersion',p_data->>'policyHash',p_data->>'transferNoticeVersion',p_data->>'transferNoticeHash',now(),now()+interval '7 days',now()+interval '90 days')
  on conflict(author_id) do update set user_id=excluded.user_id,revision=excluded.revision,status='PENDING',applicant_type=excluded.applicant_type,document_type=excluded.document_type,
   profile_envelope=excluded.profile_envelope,identity_envelope=excluded.identity_envelope,business_envelope=excluded.business_envelope,
   policy_version=excluded.policy_version,policy_hash=excluded.policy_hash,transfer_version=excluded.transfer_version,transfer_hash=excluded.transfer_hash,submitted_at=excluded.submitted_at,expires_at=excluded.expires_at,profile_expires_at=excluded.profile_expires_at,
   reviewed_at=null,review_note='',updated_at=now() returning * into row;
 elsif p_action='withdraw' then
  if row.author_id is null then return jsonb_build_object('error','SETTLEMENT_APPLICATION_NOT_FOUND','status',404);end if;
  update launch_recovery.author_settlement_applications set status='WITHDRAWN',profile_envelope=null,identity_envelope=null,business_envelope=null,review_note='',revision=revision+1,updated_at=now() where author_id=aid returning * into row;
 elsif p_action='reveal' then
  if row.status is distinct from 'PENDING' or row.identity_envelope is null then return jsonb_build_object('error','SETTLEMENT_DOCUMENT_UNAVAILABLE','status',409);end if;
  if coalesce(p_data->>'reasonFingerprint','') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','REASON_REQUIRED','status',400);end if;
  insert into launch_recovery.author_settlement_audit(actor_id,author_id,action,revision,reason_fingerprint) values(p_user,aid,'REVEAL',row.revision,p_data->>'reasonFingerprint');
  return jsonb_build_object('application',launch_recovery.settlement_metadata(row),'encrypted',jsonb_build_object('userId',row.user_id,'authorId',aid::text,'revision',row.revision::text,
   'profileEnvelope',row.profile_envelope,'identityEnvelope',row.identity_envelope,'businessEnvelope',row.business_envelope));
 else
  if row.status is distinct from 'PENDING' or row.identity_envelope is null then return jsonb_build_object('error','SETTLEMENT_DOCUMENT_UNAVAILABLE','status',409);end if;
  if coalesce(p_data->>'decision','') not in ('APPROVED','NEEDS_CHANGES') or length(coalesce(p_data->>'note','')) not between 3 and 500 or p_data->>'note' ~ '[<>[:cntrl:]]'
   or p_data->>'note' ~ '[0-9]{6}[ -]?[0-9]{7}' then return jsonb_build_object('error','INVALID_SETTLEMENT_REVIEW','status',400);end if;
  update launch_recovery.author_settlement_applications set status=p_data->>'decision',review_note=p_data->>'note',reviewed_at=now(),identity_envelope=null,business_envelope=null,
   revision=revision+1,updated_at=now() where author_id=aid returning * into row;
 end if;
 insert into launch_recovery.author_settlement_audit(actor_id,author_id,action,revision,policy_version,policy_hash,transfer_version,transfer_hash) values(p_user,aid,upper(p_action),row.revision,row.policy_version,row.policy_hash,row.transfer_version,row.transfer_hash);
 -- Review notes remain in the private current application, never in retry receipts.
 result:=jsonb_build_object('ok',true,'application',launch_recovery.settlement_metadata(row)-'reviewNote');
 insert into launch_recovery.author_settlement_receipts(actor_id,request_key,action,author_id,fingerprint,result) values(p_user,p_key,p_action,aid,fingerprint,result);
 return result;
end $$;

-- New opt-in registrations record the exact consent versions in the same transaction
-- as the existing owner/CAS/password-checked bank operation. Legacy callers are unchanged.
create or replace function public.author_settlement_bank(p_user uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare who jsonb;result jsonb;aid bigint;bank_revision bigint;
begin
 if not public.author_settlement_registration_ready() then return jsonb_build_object('error','SETTLEMENT_NOT_ACTIVATED','status',503);end if;
 who:=public.launch_account_actor(p_user);if who?'error' then return who;end if;
 if who->'author'->>'status' is distinct from 'APPROVED' then return jsonb_build_object('error','AUTHOR_REQUIRED','status',403);end if;
 aid:=(who->'author'->>'id')::bigint;
 if jsonb_typeof(p_data) is distinct from 'object' or p_data->>'policyVersion' is distinct from '2026-11-01-settlement-v1'
  or p_data->>'policyHash' is distinct from 'e8d99460efd7c5316126a9932143dd02db82e46b0e6957d899fa39f3bbb344ac'
  or coalesce(p_data->>'transferNoticeVersion','') !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$' or p_data->>'transferNoticeVersion' ~* 'draft'
  or coalesce(p_data->>'transferNoticeHash','') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','POLICY_CONFIRMATION_REQUIRED','status',400);end if;
 perform pg_advisory_xact_lock(74122016001);
 result:=public.launch_author_dashboard(p_user,'save-bank',p_data-array['policyVersion','policyHash','transferNoticeVersion','transferNoticeHash']);
 if result?'error' then return result;end if;
 perform setval('launch_recovery.author_settlement_bank_revision_seq',greatest((select last_value from launch_recovery.author_settlement_bank_revision_seq),(result->'bank'->>'revision')::bigint),true);
 bank_revision:=nextval('launch_recovery.author_settlement_bank_revision_seq');
 update launch_recovery.author_payout_details set revision=bank_revision where author_id=aid;
 result:=launch_recovery.author_dashboard_profile(aid);
 insert into launch_recovery.author_settlement_audit(actor_id,author_id,action,revision,policy_version,policy_hash,transfer_version,transfer_hash)
  values(p_user,aid,'BANK_REGISTER',(result->'bank'->>'revision')::bigint,p_data->>'policyVersion',p_data->>'policyHash',p_data->>'transferNoticeVersion',p_data->>'transferNoticeHash');
 return result;
end $$;

revoke all on function launch_recovery.settlement_audit_immutable(),launch_recovery.settlement_envelope_valid(jsonb,integer),launch_recovery.settlement_metadata(launch_recovery.author_settlement_applications) from public,anon,authenticated,service_role;
revoke all on function public.author_settlement_registration_ready(),public.expire_author_settlement_registrations(),public.author_settlement_registration(uuid,text,bigint,jsonb,uuid),public.author_settlement_bank(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.author_settlement_registration_ready(),public.expire_author_settlement_registrations(),public.author_settlement_registration(uuid,text,bigint,jsonb,uuid),public.author_settlement_bank(uuid,jsonb) to service_role;
insert into authoring.migrations(version) values('launch-016-author-settlement') on conflict do nothing;
notify pgrst,'reload schema';
commit;
