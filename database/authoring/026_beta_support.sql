-- Stage 36: private member support, separate from content moderation and deletion.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
 or not exists(select 1 from authoring.migrations where version='authoring-014') then
  raise exception 'Reviewed authoring-014 prerequisite required';
 end if;
end $$;

create table if not exists authoring.support_cases (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete restrict,
 category text not null check(category in ('QUESTION','BUG','IDEA','COPYRIGHT','WITHDRAWAL')),
 title text not null check(length(btrim(title)) between 3 and 120), work_id bigint references public.works(id) on delete restrict,
 status text not null default 'OPEN' check(status in ('OPEN','IN_REVIEW','WAITING_USER','RESOLVED','CLOSED','CANCELLED')),
 revision bigint not null default 1 check(revision>0), reopen_count integer not null default 0 check(reopen_count between 0 and 2),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists support_cases_owner on authoring.support_cases(owner_id,updated_at desc,id);
create index if not exists support_cases_queue on authoring.support_cases(status,updated_at desc,id);
create table if not exists authoring.support_messages (
 id uuid primary key default gen_random_uuid(), case_id uuid not null references authoring.support_cases(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 author_kind text not null check(author_kind in ('USER','ADMIN')),
 kind text not null check(kind in ('CREATE','USER_REPLY','ADMIN_REPLY','STATUS','REOPEN','CANCEL')),
 message text not null check(length(btrim(message)) between 3 and 4000), revision bigint not null check(revision>0),
 previous_status text, status text not null, created_at timestamptz not null default now(), unique(case_id,revision)
);
create table if not exists authoring.support_receipts (
 actor_id uuid not null references auth.users(id) on delete restrict, request_id uuid not null,
 admin_scope boolean not null, action text not null, payload jsonb not null,
 case_id uuid not null references authoring.support_cases(id) on delete restrict,
 created_at timestamptz not null default now(), primary key(actor_id,request_id)
);
create table if not exists authoring.support_limits (
 actor_id uuid primary key references auth.users(id) on delete restrict,
 window_start timestamptz not null, writes integer not null check(writes between 1 and 30)
);
-- Intentionally no direct table access, even for service_role. Only the reviewed
-- SECURITY DEFINER entry point below may read or mutate these private records.
do $$ declare t text; begin
 foreach t in array array['support_cases','support_messages','support_receipts','support_limits'] loop
  execute format('alter table authoring.%I enable row level security',t);
  execute format('revoke all on authoring.%I from public,anon,authenticated,service_role',t);
 end loop;
 foreach t in array array['support_messages','support_receipts'] loop
  execute format('drop trigger if exists support_immutable on authoring.%I',t);
  execute format('create trigger support_immutable before update or delete on authoring.%I for each row execute function authoring.workflow_immutable()',t);
 end loop;
end $$;

create or replace function authoring.support_summary(p_case authoring.support_cases)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',p_case.id,'category',p_case.category,'title',p_case.title,'workId',p_case.work_id::text,
  'status',p_case.status,'revision',p_case.revision::text,'createdAt',p_case.created_at,'updatedAt',p_case.updated_at,
  'reopenCount',p_case.reopen_count,'replyCount',(select count(*) from authoring.support_messages m
   where m.case_id=p_case.id and m.kind in ('USER_REPLY','ADMIN_REPLY')));
$$;
create or replace function authoring.support_detail(p_id uuid)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('case',authoring.support_summary(c),'messages',coalesce((select jsonb_agg(jsonb_build_object(
  'id',m.id,'kind',m.kind,'authorKind',m.author_kind,'message',m.message,'createdAt',m.created_at,
  'previousStatus',m.previous_status,'status',m.status) order by m.revision)
  from authoring.support_messages m where m.case_id=c.id),'[]'::jsonb)) from authoring.support_cases c where c.id=p_id;
$$;
revoke all on function authoring.support_summary(authoring.support_cases),authoring.support_detail(uuid) from public,anon,authenticated,service_role;

create or replace function public.beta_support(p_user uuid,p_admin boolean,p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.admin_users; target authoring.support_cases; receipt authoring.support_receipts;
 req uuid; target_id uuid; work bigint; expected text; note text; heading text; next_status text; old_status text; event_kind text;
 allowed text[]; rows jsonb; result jsonb; page_offset integer; total integer; hits integer;
 uuid_pattern text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
begin
 if p_admin is null or p_action is null or jsonb_typeof(p_data) is distinct from 'object' then
  return jsonb_build_object('error','INVALID_SUPPORT_REQUEST','status',400);
 end if;
 if p_action not in ('list','detail') then
  -- Keep a concurrent account suspension/role update from changing the identity
  -- contract between the live checks below and the recorded mutation.
  perform 1 from auth.users where id=p_user for share;
  perform 1 from public.authors where auth_user_id=p_user for share;
  perform 1 from public.readers where auth_user_id=p_user for share;
  perform 1 from public.admin_users where auth_user_id=p_user for share;
 end if;
 -- Recheck real Auth state and all linked profiles, never infer ownership from a
 -- nickname, public profile ID, email address or the caller's cached actor.
 if not exists(select 1 from auth.users u where u.id=p_user and u.email_confirmed_at is not null
  and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())
  and nullif(to_jsonb(u)->>'deleted_at','') is null)
 or exists(select 1 from public.authors where auth_user_id=p_user and status::text is distinct from 'APPROVED')
 or exists(select 1 from public.readers where auth_user_id=p_user and status::text is distinct from 'ACTIVE')
 or exists(select 1 from public.admin_users where auth_user_id=p_user and is_active is distinct from true)
 or not (exists(select 1 from public.authors where auth_user_id=p_user and status::text='APPROVED')
  or exists(select 1 from public.readers where auth_user_id=p_user and status::text='ACTIVE')
  or exists(select 1 from public.admin_users where auth_user_id=p_user and is_active)) then
  return jsonb_build_object('error','ACCOUNT_REQUIRED','status',403);
 end if;
 if p_admin then
  if (select count(*) from public.admin_users where auth_user_id=p_user and is_active)<>1 then
   return jsonb_build_object('error','ADMIN_FORBIDDEN','status',403);end if;
  select * into a from public.admin_users where auth_user_id=p_user and is_active for share;
  if not authoring.workflow_can(a,'CASE_READ') or p_action not in ('list','detail') and not authoring.workflow_can(a,'CASE_RESOLVE') then
   return jsonb_build_object('error','ADMIN_FORBIDDEN','status',403);end if;
 end if;
 if p_action='list' then
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('offset','status','category'))
   or not p_admin and p_data ? 'category'
   or coalesce(p_data->>'offset','0')!~'^(0|[1-9][0-9]{0,5})$'
   or p_data ? 'offset' and jsonb_typeof(p_data->'offset') is distinct from 'number'
   or p_data ? 'status' and coalesce(p_data->>'status','') not in ('OPEN','IN_REVIEW','WAITING_USER','RESOLVED','CLOSED','CANCELLED')
   or p_data ? 'category' and coalesce(p_data->>'category','') not in ('QUESTION','BUG','IDEA','COPYRIGHT','WITHDRAWAL') then
   return jsonb_build_object('error','INVALID_SUPPORT_REQUEST','status',400);end if;
  page_offset:=coalesce((p_data->>'offset')::integer,0);
  select coalesce(jsonb_agg(x.item order by x.updated_at desc,x.id),'[]'::jsonb),count(*) into rows,total from (
   select authoring.support_summary(c) item,c.updated_at,c.id from authoring.support_cases c
   where (p_admin or c.owner_id=p_user) and (not p_data ? 'status' or c.status=p_data->>'status')
    and (not p_data ? 'category' or c.category=p_data->>'category')
   order by c.updated_at desc,c.id offset page_offset limit 21) x;
  return jsonb_build_object('items',case when total>20 then rows-20 else rows end,
   'nextOffset',case when total>20 then page_offset+20 end);
 end if;
 if p_action='detail' then
  if exists(select 1 from jsonb_object_keys(p_data) k where k<>'id') or coalesce(p_data->>'id','')!~uuid_pattern then
   return jsonb_build_object('error','INVALID_SUPPORT_REQUEST','status',400);end if;
  target_id:=(p_data->>'id')::uuid;
  if not exists(select 1 from authoring.support_cases where id=target_id and (p_admin or owner_id=p_user)) then
   return jsonb_build_object('error','CASE_NOT_FOUND','status',404);end if;
  return authoring.support_detail(target_id);
 end if;
 if (p_admin and p_action not in ('reply','transition')) or (not p_admin and p_action not in ('create','reply','reopen','cancel')) then
  return jsonb_build_object('error','INVALID_SUPPORT_REQUEST','status',400);end if;
 allowed:=case when p_action='create' then array['requestId','category','title','message','workId','withdrawalConfirmed']
  when p_action='transition' then array['requestId','id','revision','message','status'] else array['requestId','id','revision','message'] end;
 note:=btrim(p_data->>'message');
 if exists(select 1 from jsonb_object_keys(p_data) k where not k=any(allowed))
  or coalesce(p_data->>'requestId','')!~uuid_pattern or jsonb_typeof(p_data->'message') is distinct from 'string'
  or length(coalesce(note,'')) not between 3 and 4000 or translate(note,E'\n\r\t','') ~ '[[:cntrl:]]' then
  return jsonb_build_object('error','INVALID_SUPPORT_REQUEST','status',400);end if;
 req:=(p_data->>'requestId')::uuid;
 -- Serialize both quota accounting and request receipts per Auth user. Different
 -- users additionally serialize edits on the case row via FOR UPDATE below.
 perform pg_advisory_xact_lock(hashtextextended('beta-support:'||p_user,0));
 select * into receipt from authoring.support_receipts where actor_id=p_user and request_id=req;
 if found then
  if receipt.action<>p_action or receipt.admin_scope<>p_admin or receipt.payload<>p_data then
   return jsonb_build_object('error','CONFLICT','status',409);end if;
  return authoring.support_detail(receipt.case_id)||jsonb_build_object('saved',true,'replayed',true);
 end if;
 if p_action='create' then
  heading:=btrim(p_data->>'title');
  if coalesce(p_data->>'category','') not in ('QUESTION','BUG','IDEA','COPYRIGHT','WITHDRAWAL')
   or jsonb_typeof(p_data->'title') is distinct from 'string' or length(coalesce(heading,'')) not between 3 and 120
   or translate(heading,E'\n\r\t','') ~ '[[:cntrl:]]'
   or p_data ? 'withdrawalConfirmed' and p_data->'withdrawalConfirmed'<>'true'::jsonb
   or p_data->>'category'='WITHDRAWAL' and p_data->'withdrawalConfirmed' is distinct from 'true'::jsonb then
   return jsonb_build_object('error','INVALID_SUPPORT_REQUEST','status',400);end if;
  if p_data->>'workId' is not null then
   if jsonb_typeof(p_data->'workId') is distinct from 'string' or (p_data->>'workId')!~'^[1-9][0-9]{0,17}$' then
    return jsonb_build_object('error','INVALID_SUPPORT_REQUEST','status',400);end if;
   work:=(p_data->>'workId')::bigint;
   -- Use the shared visibility foundation; allow both novel and webtoon references.
   if not exists(select 1 from public.works w where w.id=work and (
    exists(select 1 from public.authors au where au.id=w.author_id and au.auth_user_id=p_user)
    or (authoring.stage8_visible(w.id) and w.content_type in ('NOVEL','WEBTOON') and w.rating::text in ('ALL','AGE_15')
     and (w.published_at is null or w.published_at<=now())
     and not exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(to_jsonb(w.genre))='array'
      then to_jsonb(w.genre) else jsonb_build_array(w.genre) end) g where g in ('성인','19세 이상'))))) then
    return jsonb_build_object('error','WORK_NOT_FOUND','status',404);end if;
  end if;
  if (select count(*) from authoring.support_cases where owner_id=p_user and status in ('OPEN','IN_REVIEW','WAITING_USER'))>=10 then
   return jsonb_build_object('error','OPEN_CASE_LIMIT','status',429);end if;
  next_status:='OPEN';event_kind:='CREATE';
 else
  expected:=p_data->>'revision';
  if coalesce(p_data->>'id','')!~uuid_pattern or jsonb_typeof(p_data->'revision') is distinct from 'string'
   or coalesce(expected,'')!~'^(0|[1-9][0-9]{0,17})$' then
   return jsonb_build_object('error','INVALID_SUPPORT_REQUEST','status',400);end if;
  target_id:=(p_data->>'id')::uuid;
  select * into target from authoring.support_cases where id=target_id and (p_admin or owner_id=p_user) for update;
  if not found then return jsonb_build_object('error','CASE_NOT_FOUND','status',404);end if;
  if target.revision<>expected::bigint then return jsonb_build_object('error','CONFLICT','status',409);end if;
  if target.revision>=200 then return jsonb_build_object('error','CASE_MESSAGE_LIMIT','status',409);end if;
  old_status:=target.status;next_status:=target.status;
  if p_action='reopen' then
   if target.status not in ('RESOLVED','CLOSED') then return jsonb_build_object('error','CASE_CLOSED','status',409);end if;
   if target.reopen_count>=2 then return jsonb_build_object('error','REOPEN_LIMIT','status',409);end if;
   if (select count(*) from authoring.support_cases where owner_id=p_user and status in ('OPEN','IN_REVIEW','WAITING_USER'))>=10 then
    return jsonb_build_object('error','OPEN_CASE_LIMIT','status',429);end if;
   next_status:='OPEN';event_kind:='REOPEN';
  elsif p_action='transition' then
   next_status:=p_data->>'status';event_kind:='STATUS';
   if coalesce(next_status,'') not in ('OPEN','IN_REVIEW','WAITING_USER','RESOLVED','CLOSED') or next_status=target.status then
    return jsonb_build_object('error','INVALID_SUPPORT_REQUEST','status',400);end if;
   if target.status in ('CLOSED','CANCELLED') or target.status='RESOLVED' and next_status<>'CLOSED' then
    return jsonb_build_object('error','CASE_CLOSED','status',409);end if;
  else
   if target.status not in ('OPEN','IN_REVIEW','WAITING_USER') then return jsonb_build_object('error','CASE_CLOSED','status',409);end if;
   if p_action='cancel' then next_status:='CANCELLED';event_kind:='CANCEL';
   else event_kind:=case when p_admin then 'ADMIN_REPLY' else 'USER_REPLY' end;
    if not p_admin and target.status='WAITING_USER' then next_status:='OPEN';end if;
   end if;
  end if;
 end if;
 insert into authoring.support_limits(actor_id,window_start,writes) values(p_user,now(),1)
 on conflict(actor_id) do update set
  window_start=case when authoring.support_limits.window_start<=now()-interval '1 hour' then now() else authoring.support_limits.window_start end,
  writes=case when authoring.support_limits.window_start<=now()-interval '1 hour' then 1 else authoring.support_limits.writes+1 end
 where authoring.support_limits.window_start<=now()-interval '1 hour' or authoring.support_limits.writes<30 returning writes into hits;
 if hits is null then return jsonb_build_object('error','RATE_LIMITED','status',429);end if;
 if p_action='create' then
  insert into authoring.support_cases(owner_id,category,title,work_id) values(p_user,p_data->>'category',heading,work) returning * into target;
 else
  update authoring.support_cases set status=next_status,revision=revision+1,updated_at=now(),
   reopen_count=reopen_count+case when p_action='reopen' then 1 else 0 end where id=target_id returning * into target;
 end if;
 insert into authoring.support_messages(case_id,actor_id,author_kind,kind,message,revision,previous_status,status)
 values(target.id,p_user,case when p_admin then 'ADMIN' else 'USER' end,event_kind,note,target.revision,old_status,target.status);
 insert into authoring.support_receipts(actor_id,request_id,admin_scope,action,payload,case_id)
 values(p_user,req,p_admin,p_action,p_data,target.id);
 return authoring.support_detail(target.id)||jsonb_build_object('saved',true,'replayed',false);
end $$;
revoke all on function public.beta_support(uuid,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.beta_support(uuid,boolean,text,jsonb) to service_role;
insert into authoring.migrations(version) values('authoring-026') on conflict do nothing;
notify pgrst,'reload schema';
commit;
