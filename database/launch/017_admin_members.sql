-- OP-02: separate author/reader directory. No Auth, status, finance or identity edits.
begin;
set local lock_timeout='5s';
do $$ begin
 if current_setting('webnovels.admin_members_apply_verified',true) is distinct from 'true'
 or to_regprocedure('public.launch_account_actor(uuid)') is null
 or not public.launch_accounts_ready()
 or to_regclass('launch_recovery.account_audit') is null then
  raise exception 'Reviewed account service prerequisites required';
 end if;
end $$;

create table if not exists launch_recovery.member_profile_revisions (
 kind text not null check(kind in ('author','reader')),profile_id text not null,
 revision bigint not null check(revision>0),primary key(kind,profile_id)
);
create table if not exists launch_recovery.member_profile_receipts (
 actor_id uuid not null references auth.users(id),request_id uuid not null,
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),result jsonb not null,
 created_at timestamptz not null default now(),primary key(actor_id,request_id)
);
create index if not exists member_profile_receipts_recent on launch_recovery.member_profile_receipts(actor_id,created_at desc);
alter table launch_recovery.member_profile_revisions enable row level security;
alter table launch_recovery.member_profile_receipts enable row level security;
-- Private tables intentionally have no direct API access, including service_role.
-- The authenticated server calls only the public SECURITY DEFINER directory RPC.
revoke all on launch_recovery.member_profile_revisions,launch_recovery.member_profile_receipts from public,anon,authenticated,service_role;

create or replace function launch_recovery.member_profile_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare k text:=tg_argv[0];changed boolean;
begin
 if tg_op='INSERT' then changed:=true;
 elsif k='author' then changed:=new.pen_name is distinct from old.pen_name or new.bio is distinct from old.bio;
 else changed:=new.nickname is distinct from old.nickname;end if;
 if changed then
  insert into launch_recovery.member_profile_revisions(kind,profile_id,revision) values(k,new.id::text,1)
  on conflict(kind,profile_id) do update set revision=member_profile_revisions.revision+1;
 end if;
 return new;
end $$;
drop trigger if exists member_public_profile_changed on public.authors;
create trigger member_public_profile_changed after insert or update of pen_name,bio on public.authors
 for each row execute function launch_recovery.member_profile_changed('author');
drop trigger if exists member_public_profile_changed on public.readers;
create trigger member_public_profile_changed after insert or update of nickname on public.readers
 for each row execute function launch_recovery.member_profile_changed('reader');

create or replace function launch_recovery.member_directory_meta(
 k text,p jsonb,u jsonb,email_access boolean,settlement_access boolean,support_access boolean,change_access boolean
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare pid text:=p->>'id';uid uuid:=nullif(p->>'auth_user_id','')::uuid;name text;rev bigint;
 works_no bigint;published timestamptz;activity_at timestamptz;read_at timestamptz;pending_no bigint;
 bank boolean;application text;settlement_state text;email text;masked text;works_query text;
begin
 name:=case when k='author' then p->>'pen_name' else p->>'nickname' end;
 select revision into rev from launch_recovery.member_profile_revisions where kind=k and profile_id=pid;
 if k='author' and to_regclass('public.works') is not null then
  works_query:='select count(*) from public.works w '||case when to_regclass('authoring.work_state') is not null then 'left join authoring.work_state s on s.work_id=w.id ' else '' end||'where w.author_id::text=$1'
   ||case when to_regclass('authoring.work_state') is not null then ' and nullif(to_jsonb(s)->>''trashed_at'','''') is null' else '' end;
  execute works_query into works_no using pid;
  if to_regclass('public.episodes') is not null and to_regclass('authoring.publication_heads') is not null then
   execute 'select max(h.published_at) from authoring.publication_heads h join public.episodes e on e.id=h.episode_id join public.works w on w.id=e.work_id where w.author_id::text=$1'
    into published using pid;
  end if;
 end if;
 activity_at:=nullif(u->>'last_sign_in_at','')::timestamptz;
 if k='reader' and uid is not null and to_regclass('authoring.reader_progress') is not null then
  execute 'select max(last_read_at) from authoring.reader_progress where user_id=$1' into read_at using uid;
  activity_at:=greatest(activity_at,read_at);
 elsif k='author' then activity_at:=greatest(activity_at,published);end if;
 if uid is not null then
  if support_access and to_regclass('authoring.support_cases') is not null then
   execute 'select count(*) from authoring.support_cases where owner_id=$1 and status in (''OPEN'',''IN_REVIEW'',''WAITING_USER'')' into pending_no using uid;
  end if;
  if k='author' and change_access and to_regclass('authoring.publication_changes') is not null and to_regclass('authoring.publication_change_decisions') is not null then
   execute 'select coalesce($2,0)+count(*) from authoring.publication_changes c where c.user_id=$1 and not exists(select 1 from authoring.publication_change_decisions d where d.change_id=c.id)'
    into pending_no using uid,pending_no;
  end if;
 end if;
 if k='author' and settlement_access then
  if to_regclass('launch_recovery.author_payout_details') is not null then
   execute 'select exists(select 1 from launch_recovery.author_payout_details where author_id::text=$1)' into bank using pid;
   settlement_state:=case when bank then 'REGISTERED' else 'UNREGISTERED' end;
  end if;
  if to_regclass('launch_recovery.author_settlement_applications') is not null then
   execute 'select status from launch_recovery.author_settlement_applications where author_id::text=$1' into application using pid;
   settlement_state:=coalesce(application,settlement_state);
  end if;
 end if;
 if email_access then
  email:=u->>'email';
  if position('@' in email)>1 then masked:=left(split_part(email,'@',1),1)||'***@'||split_part(email,'@',2);end if;
 end if;
 return jsonb_build_object('id',pid,'displayName',coalesce(name,''),'bio',case when k='author' then coalesce(p->>'bio','') else '' end,
  'status',p->>'status','createdAt',p->>'created_at','lastActivityAt',activity_at,
  'authLinked',u->>'id' is not null,'emailConfirmed',nullif(u->>'email_confirmed_at','') is not null,'maskedEmail',masked,
  'revision',coalesce(rev,0)::text||':'||md5(jsonb_build_array(name,case when k='author' then p->>'bio' else null end,p->>'status',p->>'auth_user_id')::text),
  'workCount',works_no,'lastPublishedAt',published,'pendingRequests',pending_no,'settlementState',settlement_state,'bankRegistered',bank);
end $$;

create or replace function public.admin_member_directory(p_user uuid,p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare who jsonb;admin jsonb;k text:=p_data->>'kind';pid text:=p_data->>'accountId';row_data record;p jsonb;u jsonb;item jsonb;
 permissions jsonb;super boolean;email_access boolean;settlement_access boolean;support_access boolean;change_access boolean;audit_access boolean;
 source_works boolean:=to_regclass('public.works') is not null;
 source_support boolean:=to_regclass('authoring.support_cases') is not null;
 source_changes boolean:=to_regclass('authoring.publication_changes') is not null and to_regclass('authoring.publication_change_decisions') is not null;
 source_settlement boolean:=to_regclass('launch_recovery.author_payout_details') is not null or to_regclass('launch_recovery.author_settlement_applications') is not null;
 source_activity boolean;caps jsonb;query_text text;table_name text;name_key text;
 q text:=coalesce(p_data->>'q','');offset_no integer:=0;total_no bigint:=0;items jsonb:='[]';has_more boolean:=false;
 status_filter text:=coalesce(p_data->>'status','ALL');linked_filter text:=coalesce(p_data->>'linked','ALL');activity_filter text:=coalesce(p_data->>'activity','ALL');
 work_filter text:=coalesce(p_data->>'hasWorks','ALL');settlement_filter text:=coalesce(p_data->>'settlement','ALL');pending_filter text:=coalesce(p_data->>'pending','ALL');
 from_date date;to_date date;days integer;request_key uuid;fingerprint text;receipt launch_recovery.member_profile_receipts;
 before_public jsonb;after_public jsonb;result jsonb;revision_no bigint;work_items jsonb:='[]';request_items jsonb:='[]';extra jsonb:='[]';history_items jsonb:='[]';application text;
begin
 if not public.launch_accounts_ready() then return jsonb_build_object('error','ACCOUNT_SERVICE_NOT_ACTIVATED','status',503);end if;
 if jsonb_typeof(p_data) is distinct from 'object' or k not in ('author','reader') or k is null then return jsonb_build_object('error','INVALID_KIND','status',400);end if;
 if p_action not in ('list','detail','update-profile') or p_action is null then return jsonb_build_object('error','INVALID_ACTION','status',400);end if;
 if p_action='update-profile' then perform 1 from public.admin_users where auth_user_id=p_user for share;end if;
 who:=public.launch_account_actor(p_user);if who?'error' then return who;end if;
 admin:=who->'admin';permissions:=coalesce(admin->'permissions','[]');super:=coalesce(admin->>'role','')='SUPER_ADMIN';
 if coalesce((admin->>'is_active')::boolean,false) is not true or not(super or permissions?'ACCOUNTS_READ' or permissions?(case when k='author' then 'CREATOR_MGMT' else 'USER_MGMT' end)) then
  return jsonb_build_object('error','ADMIN_FORBIDDEN','status',403);end if;
 email_access:=super or permissions?'ACCOUNTS_READ';settlement_access:=super or permissions?'SETTLEMENTS_READ' or permissions?'AUTHOR_SETTLEMENT';
 support_access:=super or permissions?'CASE_READ';change_access:=super or permissions?'CONTENT_REVIEW';
 audit_access:=super or permissions?'AUDIT_READ' or permissions?'SECURITY_MGMT';
 source_activity:=exists(select 1 from information_schema.columns c where c.table_schema='auth' and c.table_name='users' and c.column_name='last_sign_in_at')
  or case when k='reader' then to_regclass('authoring.reader_progress') is not null else to_regclass('authoring.publication_heads') is not null and to_regclass('public.episodes') is not null and source_works end;
 caps:=jsonb_build_object('canEditPublic',super,'canSearchEmail',email_access,'canReadSettlement',k='author' and settlement_access,
  'filters',jsonb_build_object('work',k='author' and source_works,'settlement',k='author' and settlement_access and source_settlement,
   'requests',support_access and source_support or k='author' and change_access and source_changes,'activity',source_activity,'payments',false,'balance',false,'orderSearch',false),
  'sources',jsonb_build_object('works',k='author' and source_works,'activity',source_activity,'support',source_support and support_access,
   'publicationChanges',k='author' and source_changes and change_access,'settlement',k='author' and source_settlement and settlement_access,'history',audit_access,'rights',false));
 table_name:=case when k='author' then 'public.authors' else 'public.readers' end;name_key:=case when k='author' then 'pen_name' else 'nickname' end;
 if p_action='list' then
  if exists(select 1 from jsonb_object_keys(p_data) x where x not in ('kind','q','status','linked','createdFrom','createdTo','activity','hasWorks','settlement','pending','offset'))
   or jsonb_typeof(coalesce(p_data->'q','""')) is distinct from 'string' or length(q)>100 or q ~ '[[:cntrl:]]'
   or coalesce(p_data->>'offset','0') !~ '^(0|[1-9][0-9]{0,5})$'
   or status_filter not in ('ALL','ACTIVE','APPROVED','PENDING','SUSPENDED','REJECTED','DELETED')
   or linked_filter not in ('ALL','LINKED','UNLINKED') or activity_filter not in ('ALL','7D','30D','90D')
   or work_filter not in ('ALL','YES','NO') or settlement_filter not in ('ALL','REGISTERED','UNREGISTERED','PENDING','APPROVED') or pending_filter not in ('ALL','YES','NO') then
   return jsonb_build_object('error','INVALID_QUERY','status',400);end if;
  offset_no:=coalesce(p_data->>'offset','0')::integer;
  if offset_no>100000 then return jsonb_build_object('error','INVALID_QUERY','status',400);end if;
  if position('@' in q)>0 and not email_access then return jsonb_build_object('error','EMAIL_SEARCH_FORBIDDEN','status',403);end if;
  begin
   if coalesce(p_data->>'createdFrom','')<>'' then
    if p_data->>'createdFrom' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise invalid_datetime_format;end if;from_date:=(p_data->>'createdFrom')::date;
   end if;
   if coalesce(p_data->>'createdTo','')<>'' then
    if p_data->>'createdTo' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise invalid_datetime_format;end if;to_date:=(p_data->>'createdTo')::date;
   end if;
  exception when invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('error','INVALID_QUERY','status',400);end;
  if from_date>to_date then return jsonb_build_object('error','INVALID_QUERY','status',400);end if;
  if (work_filter<>'ALL' and not (caps->'filters'->>'work')::boolean) or (settlement_filter<>'ALL' and not (caps->'filters'->>'settlement')::boolean)
   or (pending_filter<>'ALL' and not (caps->'filters'->>'requests')::boolean) or (activity_filter<>'ALL' and not source_activity) then
   return jsonb_build_object('error','FILTER_NOT_AVAILABLE','status',409);end if;
  days:=case activity_filter when '7D' then 7 when '30D' then 30 when '90D' then 90 else null end;
  -- Only trusted table/name literals are interpolated. All search values are bound parameters.
  query_text:='select to_jsonb(p) profile,to_jsonb(u) auth from '||table_name||' p left join auth.users u on u.id=p.auth_user_id '
   ||'where ($1='''' or strpos(lower(coalesce(to_jsonb(p)->>$2,'''')),lower($1))>0 or lower(p.id::text)=lower($1) or ($3 and lower(u.email)=lower($1))) '
   ||'and ($4=''ALL'' or to_jsonb(p)->>''status''=$4) and ($5=''ALL'' or ($5=''LINKED'')=(u.id is not null)) '
   ||'and ($6::date is null or nullif(to_jsonb(p)->>''created_at'','''')::timestamptz >= ($6::date::timestamp at time zone ''Asia/Seoul'')) '
   ||'and ($7::date is null or nullif(to_jsonb(p)->>''created_at'','''')::timestamptz < (($7::date+1)::timestamp at time zone ''Asia/Seoul'')) '
   ||'order by nullif(to_jsonb(p)->>''created_at'','''')::timestamptz desc nulls last,p.id::text';
  for row_data in execute query_text using q,name_key,email_access,status_filter,linked_filter,from_date,to_date loop
   item:=null;
   if work_filter<>'ALL' or settlement_filter<>'ALL' or pending_filter<>'ALL' or days is not null then
    item:=launch_recovery.member_directory_meta(k,row_data.profile,row_data.auth,email_access,settlement_access,support_access,change_access);
    if work_filter='YES' and coalesce((item->>'workCount')::bigint,0)=0 or work_filter='NO' and (item->>'workCount')::bigint<>0 then continue;end if;
    if settlement_filter='REGISTERED' and (item->>'bankRegistered')::boolean is distinct from true
     or settlement_filter='UNREGISTERED' and (item->>'bankRegistered')::boolean is distinct from false
     or settlement_filter in ('PENDING','APPROVED') and item->>'settlementState' is distinct from settlement_filter then continue;end if;
    if pending_filter='YES' and coalesce((item->>'pendingRequests')::bigint,0)=0
     or pending_filter='NO' and ((item->>'pendingRequests') is null or (item->>'pendingRequests')::bigint<>0) then continue;end if;
    if days is not null and (item->>'lastActivityAt' is null or (item->>'lastActivityAt')::timestamptz<now()-make_interval(days=>days)) then continue;end if;
   end if;
   if total_no>=offset_no and total_no<offset_no+50 then
    item:=coalesce(item,launch_recovery.member_directory_meta(k,row_data.profile,row_data.auth,email_access,settlement_access,support_access,change_access));
    items:=items||jsonb_build_array(item);
   end if;
   total_no:=total_no+1;
  end loop;
  has_more:=total_no>offset_no+50;
  return jsonb_build_object('kind',k,'items',items,'offset',offset_no,'limit',50,'hasMore',has_more,'nextOffset',case when has_more then offset_no+50 else null end,'total',total_no,'capabilities',caps);
 end if;
 if pid is null or (k='author' and (pid !~ '^[1-9][0-9]{0,18}$' or length(pid)=19 and pid>'9223372036854775807'))
  or (k='reader' and not(pid ~ '^[1-9][0-9]{0,18}$' and (length(pid)<19 or pid<='9223372036854775807') or pid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
  return jsonb_build_object('error','INVALID_ACCOUNT_ID','status',400);end if;
 if p_action='detail' then
  if exists(select 1 from jsonb_object_keys(p_data) x where x not in ('kind','accountId')) then return jsonb_build_object('error','INVALID_QUERY','status',400);end if;
 else
  if not super then return jsonb_build_object('error','ADMIN_FORBIDDEN','status',403);end if;
  if exists(select 1 from jsonb_object_keys(p_data) x where x not in ('kind','accountId','revision','displayName','bio','reason','requestId'))
   or jsonb_typeof(p_data->'displayName') is distinct from 'string' or length(btrim(p_data->>'displayName')) not between 2 and 40 or p_data->>'displayName' ~ '[<>[:cntrl:]]'
   or jsonb_typeof(p_data->'reason') is distinct from 'string' or length(btrim(p_data->>'reason')) not between 3 and 500
   or (k='author' and (jsonb_typeof(p_data->'bio') is distinct from 'string' or length(p_data->>'bio')>2000)) or (k='reader' and p_data?'bio')
   or coalesce(p_data->>'revision','') !~ '^(0|[1-9][0-9]{0,18}):[a-f0-9]{32}$'
   or coalesce(p_data->>'requestId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   return jsonb_build_object('error','INVALID_PROFILE','status',400);end if;
  request_key:=(p_data->>'requestId')::uuid;fingerprint:=encode(sha256(convert_to(p_data::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('admin-members:'||p_user::text,0));
  select * into receipt from launch_recovery.member_profile_receipts where actor_id=p_user and request_id=request_key;
  if found then
   if receipt.fingerprint<>fingerprint then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT','status',409);end if;
   return receipt.result;
  end if;
  if (select count(*) from launch_recovery.member_profile_receipts where actor_id=p_user and created_at>=now()-interval '15 minutes')>=30 then
   return jsonb_build_object('error','RATE_LIMITED','status',429);end if;
  perform 1 from launch_recovery.virtual_accounts where kind=k and lower(profile_id)=lower(pid) for update;
 end if;
 execute 'select to_jsonb(p),to_jsonb(u) from '||table_name||' p left join auth.users u on u.id=p.auth_user_id where lower(p.id::text)=lower($1)'||case when p_action='update-profile' then ' for update of p' else '' end
  into p,u using pid;
 if p is null then return jsonb_build_object('error','ACCOUNT_NOT_FOUND','status',404);end if;
 pid:=p->>'id';
 item:=launch_recovery.member_directory_meta(k,p,u,email_access,settlement_access,support_access,change_access);
 if p_action='update-profile' then
  perform 1 from launch_recovery.member_profile_revisions where kind=k and profile_id=pid for update;
  who:=public.launch_account_actor(p_user);
  if who?'error' then return who;end if;
  if who->'admin'->>'role' is distinct from 'SUPER_ADMIN' or coalesce((who->'admin'->>'is_active')::boolean,false) is not true then return jsonb_build_object('error','ADMIN_FORBIDDEN','status',403);end if;
  if p_data->>'revision' is distinct from item->>'revision' then return jsonb_build_object('error','PROFILE_CONFLICT','status',409);end if;
  before_public:=jsonb_build_object('displayName',item->>'displayName');
  if k='author' then
   before_public:=before_public||jsonb_build_object('bio',item->>'bio');
   update public.authors set pen_name=btrim(p_data->>'displayName'),bio=p_data->>'bio' where id::text=pid;
  else update public.readers set nickname=btrim(p_data->>'displayName') where id::text=pid;end if;
  execute 'select to_jsonb(p) from '||table_name||' p where p.id::text=$1' into p using pid;
  item:=launch_recovery.member_directory_meta(k,p,u,email_access,settlement_access,support_access,change_access);
  after_public:=jsonb_build_object('displayName',item->>'displayName');if k='author' then after_public:=after_public||jsonb_build_object('bio',item->>'bio');end if;
  insert into launch_recovery.account_audit(actor_id,kind,profile_id,action,reason,before_value,after_value)
   values(p_user,k,pid,'PUBLIC_PROFILE_UPDATE',btrim(p_data->>'reason'),before_public,after_public);
  result:=jsonb_build_object('saved',true,'kind',k,'member',item);
  insert into launch_recovery.member_profile_receipts(actor_id,request_id,fingerprint,result) values(p_user,request_key,fingerprint,result);
  return result;
 end if;
 if k='author' and source_works then
  query_text:='select coalesce(jsonb_agg(x.item order by x.id),''[]'') from (select w.id,jsonb_build_object(''id'',w.id::text,''title'',coalesce(to_jsonb(w)->>''title'',''''),''type'',to_jsonb(w)->>''type'',''status'','
   ||case when to_regclass('authoring.work_state') is not null then 'coalesce(to_jsonb(s)->>''serial_state'',to_jsonb(w)->>''status'')' else 'to_jsonb(w)->>''status''' end
   ||',''episodeCount'',null,''lastPublishedAt'',null) item from public.works w '
   ||case when to_regclass('authoring.work_state') is not null then 'left join authoring.work_state s on s.work_id=w.id ' else '' end
   ||'where w.author_id::text=$1 '||case when to_regclass('authoring.work_state') is not null then 'and nullif(to_jsonb(s)->>''trashed_at'','''') is null ' else '' end||'order by w.id desc limit 50) x';
  execute query_text into work_items using pid;
  if to_regclass('public.episodes') is not null then
   select coalesce(jsonb_agg(x.value||jsonb_build_object('episodeCount',(select count(*) from public.episodes e where e.work_id::text=x.value->>'id'))),'[]') into work_items from jsonb_array_elements(work_items) x;
   if to_regclass('authoring.publication_heads') is not null then
    select coalesce(jsonb_agg(x.value||jsonb_build_object('lastPublishedAt',(select max(h.published_at) from authoring.publication_heads h join public.episodes e on e.id=h.episode_id where e.work_id::text=x.value->>'id'))),'[]') into work_items from jsonb_array_elements(work_items) x;
   end if;
  end if;
 end if;
 if p->>'auth_user_id' is not null then
  if support_access and source_support then
   execute 'select coalesce(jsonb_agg(x.item order by x.created_at desc),''[]'') from (select created_at,jsonb_build_object(''id'',id::text,''kind'',''SUPPORT'',''label'',title,''status'',status,''createdAt'',created_at) item from authoring.support_cases where owner_id=$1 order by created_at desc,id limit 25) x'
    into request_items using (p->>'auth_user_id')::uuid;
  end if;
  if k='author' and change_access and source_changes then
   execute 'select coalesce(jsonb_agg(x.item order by x.created_at desc),''[]'') from (select c.created_at,jsonb_build_object(''id'',c.id::text,''kind'',''PUBLICATION_CHANGE'',''label'',coalesce(to_jsonb(w)->>''title'',''공개본 변경''),''status'',case when d.change_id is null then ''PENDING'' else d.decision end,''createdAt'',c.created_at) item from authoring.publication_changes c left join authoring.publication_change_decisions d on d.change_id=c.id left join public.works w on w.id=c.work_id where c.user_id=$1 order by c.created_at desc,c.id limit 25) x'
    into extra using (p->>'auth_user_id')::uuid;
   request_items:=request_items||extra;
  end if;
 end if;
 if audit_access then
  select coalesce(jsonb_agg(x.item order by x.created_at desc),'[]') into history_items from (
   select created_at,jsonb_build_object('id',id::text,'action',action,'reason',reason,'createdAt',created_at,
    'before',before_value,'after',after_value) item from launch_recovery.account_audit
   where kind=k and profile_id=pid and action='PUBLIC_PROFILE_UPDATE' order by created_at desc,id limit 20) x;
 end if;
 application:=case when item->>'settlementState' in ('PENDING','APPROVED','NEEDS_CHANGES','WITHDRAWN','EXPIRED') then item->>'settlementState' else null end;
 return jsonb_build_object('kind',k,'member',item,'works',work_items,'requests',request_items,'history',history_items,'rights','[]'::jsonb,
  'finance',jsonb_build_object('state','NOT_CONNECTED','paidTotal',null,'netPaidTotal',null,'paidPoints',null,'bonusPoints',null,'latestPayment',null),
  'settlement',jsonb_build_object('state',case when k='reader' then 'NOT_APPLICABLE' when not settlement_access then 'NO_ACCESS' else coalesce(item->>'settlementState','NOT_CONNECTED') end,
   'bankRegistered',item->'bankRegistered','applicationStatus',application,'verification','MANUAL_REVIEW_NOT_PASS_OR_BANK'),'capabilities',caps);
exception when unique_violation then return jsonb_build_object('error','DISPLAY_NAME_UNAVAILABLE','status',409);
end $$;

revoke all on function launch_recovery.member_profile_changed(),launch_recovery.member_directory_meta(text,jsonb,jsonb,boolean,boolean,boolean,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_member_directory(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_member_directory(uuid,text,jsonb) to service_role;
do $$ begin
 if to_regclass('authoring.migrations') is not null then insert into authoring.migrations(version) values('launch-017-admin-members') on conflict do nothing;end if;
end $$;
notify pgrst,'reload schema';
commit;
