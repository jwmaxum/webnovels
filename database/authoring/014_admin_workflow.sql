-- Additive, reviewed deployment only. Original cases, manuscripts and legacy audit remain intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
  or not exists(select 1 from authoring.migrations where version='authoring-010')
  or not exists(select 1 from authoring.migrations where version='authoring-013') then
  raise exception 'Reviewed authoring-010 and authoring-013 prerequisites required';
 end if;
end $$;
create table if not exists authoring.case_workflow(
 source text not null check(source in ('CONTENT_REVIEW','COMMENT_REPORT','REPORT')),source_id uuid not null,
 revision bigint not null default 0 check(revision>=0),assignee_id uuid references public.admin_users(id),
 priority text not null default 'NORMAL' check(priority in ('NORMAL','HIGH','URGENT')),due_at timestamptz,
 evidence text not null default '' check(length(evidence)<=2000),duplicate_id uuid,reviewed_target_version text,
 updated_at timestamptz not null default now(),primary key(source,source_id),check(duplicate_id is distinct from source_id)
);
create table if not exists authoring.workflow_events(
 id uuid primary key default gen_random_uuid(),actor_user_id uuid not null references auth.users(id),
 action text not null,target text not null,work_id bigint references public.works(id),reason text not null,
 detail jsonb not null default '{}',created_at timestamptz not null default now()
);
create index if not exists workflow_events_target on authoring.workflow_events(target,created_at desc,id);
create table if not exists authoring.workflow_receipts(
 user_id uuid not null references auth.users(id),request_id uuid not null,action text not null,payload jsonb not null,
 result jsonb not null,created_at timestamptz not null default now(),primary key(user_id,request_id)
);
create table if not exists authoring.appeal_followups(
 appeal_id uuid primary key references authoring.admin_case_appeals(id),actor_user_id uuid not null references auth.users(id),
 decision text not null check(decision in ('MAINTAIN','UNRESTRICT','UNBLOCK')),reason text not null,
 created_at timestamptz not null default now()
);
create table if not exists authoring.editorial_placements(
 id uuid primary key,work_id bigint not null references public.works(id),
 slot text not null check(slot in ('HOME_RECOMMENDED','HOME_SPOTLIGHT')),
 position integer not null check(position between 1 and 8),starts_at timestamptz not null,ends_at timestamptz not null,
 enabled boolean not null,revision bigint not null check(revision>0),check(ends_at>starts_at),
 check(isfinite(starts_at) and isfinite(ends_at)),updated_at timestamptz not null default now()
);
create or replace function authoring.workflow_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Workflow history is append-only'; end $$;
revoke all on function authoring.workflow_immutable() from public,anon,authenticated,service_role;
do $$ declare t text; begin
 foreach t in array array['case_workflow','workflow_events','workflow_receipts','appeal_followups','editorial_placements'] loop
  execute format('alter table authoring.%I enable row level security',t);
  execute format('revoke all on authoring.%I from public,anon,authenticated,service_role',t);
 end loop;
 foreach t in array array['workflow_events','workflow_receipts','appeal_followups'] loop
  execute format('drop trigger if exists workflow_immutable on authoring.%I',t);
  execute format('create trigger workflow_immutable before update or delete on authoring.%I for each row execute function authoring.workflow_immutable()',t);
 end loop;
end $$;
create or replace function authoring.workflow_can(a public.admin_users,permission text)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(a.role::text='SUPER_ADMIN' or a.permissions ? permission,false)
$$;
create or replace function authoring.workflow_case(p_source text,p_id uuid)
returns jsonb language sql stable set search_path='' as $$
 select x.item from (
  select jsonb_build_object('source','CONTENT_REVIEW','id',r.id,'workId',r.work_id::text,
   'target',case when r.episode_id is null then 'WORK:'||r.work_id else 'EPISODE:'||r.episode_id end,
   'episodeId',r.episode_id::text,'status',r.status,'label',r.work_title_snapshot,'createdAt',r.created_at) item
   from public.content_reviews r where p_source='CONTENT_REVIEW' and r.id=p_id
  union all select jsonb_build_object('source','COMMENT_REPORT','id',r.id,'workId',r.work_id::text,
   'target','COMMENT:'||r.comment_id,'status',r.status,'label',r.reason,'createdAt',r.created_at,
   'subject',jsonb_build_object('content',left(c.content,4000),'nickname',c.nickname_snapshot,'blocked',c.is_blocked,'deleted',c.is_deleted))
   from authoring.comment_reports r join public.comments c on c.id=r.comment_id where p_source='COMMENT_REPORT' and r.id=p_id
  union all select jsonb_build_object('source','REPORT','id',r.id,'workId',c.work_id::text,
   'target',r.target_type||':'||r.target_id,'status',r.status,'label',r.reason,'createdAt',r.created_at,
   'subject',case when c.id is not null then jsonb_build_object('content',left(c.content,4000),'nickname',c.nickname_snapshot,'blocked',c.is_blocked,'deleted',c.is_deleted) end)
   from public.reports r left join public.comments c on r.target_type='COMMENT' and c.id::text=r.target_id
   where p_source='REPORT' and r.id=p_id
  union all select jsonb_build_object('source','WORK_MODERATION','id',r.id,'workId',r.work_id::text,
   'target','WORK:'||r.work_id,'status',r.action,'label',r.reason,'createdAt',r.created_at)
   from authoring.admin_work_actions r where p_source='WORK_MODERATION' and r.id=p_id
 ) x limit 1
$$;
create or replace function authoring.workflow_target_version(p_source text,p_id uuid)
returns text language sql stable set search_path='' as $$
 select case when p_source='WORK_MODERATION' then
  (select s.version::text from authoring.work_state s where s.work_id=(c->>'workId')::bigint)
 else (select md5(concat(x.id,':',x.is_blocked,':',x.updated_at,':',x.content,':',x.is_deleted)) from public.comments x where 'COMMENT:'||x.id=c->>'target') end
 from (select authoring.workflow_case(p_source,p_id) c) q
$$;
revoke all on function authoring.workflow_can(public.admin_users,text),authoring.workflow_case(text,uuid),
 authoring.workflow_target_version(text,uuid) from public,anon,authenticated,service_role;

-- One public projection is shared by the administrator preview and public home, with live visibility rechecked.
create or replace function authoring.editorial_rows(p_at timestamptz) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('slot',p.slot,'position',p.position,'work',w.item)
  order by p.slot,p.position,p.id),'[]'::jsonb)
 from authoring.editorial_placements p join authoring.stage16_work_rows(now()) w on w.work_id=p.work_id
 where p.enabled and p.starts_at<=p_at and p.ends_at>p_at and w.episode_count>0
$$;
revoke all on function authoring.editorial_rows(timestamptz) from public,anon,authenticated,service_role;
create or replace function public.stage17_editorial() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('placements',authoring.editorial_rows(now()))
$$;
revoke all on function public.stage17_editorial() from public,anon,authenticated;
grant execute on function public.stage17_editorial() to service_role;

create or replace function public.stage17_admin(p_user uuid,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare a public.admin_users; c jsonb; other_case jsonb; r jsonb; items jsonb; missing jsonb:='[]';
 meta authoring.case_workflow; receipt authoring.workflow_receipts; placement authoring.editorial_placements;
 ap authoring.admin_case_appeals; draft authoring.drafts; selected_revision bigint;
 source text:=p_data->>'source'; case_id uuid; req uuid; target_work bigint; target text; action_reason text;
 permission text; legacy text; allowed boolean; is_write boolean; target_user uuid; old_status text;
 event_detail jsonb:='{}'; counter integer; linked uuid; due timestamptz; start_at timestamptz; end_at timestamptz;
 tbl text; row_data jsonb; legacy_rows jsonb; off integer:=0; cutoff timestamptz;
begin
 select * into a from public.admin_users where auth_user_id=p_user for share;
 if not found or not a.is_active or a.role::text not in ('SUPER_ADMIN','ADMIN','SUB_ADMIN') or not exists(
  select 1 from auth.users where id=p_user and email_confirmed_at is not null and is_anonymous is not true
   and (banned_until is null or banned_until<=now())) then return jsonb_build_object('error','ADMIN_REQUIRED','status',403); end if;
 if p_action is null or p_action not in ('cases','assignees','appeals','accounts','account-support','work-list','curation','preview','audit',
  'case-update','case-resolve','appeal-resolve','appeal-followup','moderate','account-moderate','curation-save','draft-read')
  or jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text)>16000 then
  return jsonb_build_object('error','INVALID_ACTION','status',400); end if;
 is_write:=p_action in ('case-update','case-resolve','appeal-resolve','appeal-followup','moderate','account-moderate','curation-save','draft-read');
 permission:=case when p_action in ('cases','assignees','appeals') then 'CASE_READ'
  when p_action in ('case-update','case-resolve','appeal-resolve') then 'CASE_RESOLVE'
  when p_action in ('moderate','appeal-followup') then 'CONTENT_MODERATE'
  when p_action in ('accounts','account-support') then 'ACCOUNTS_READ'
  when p_action='account-moderate' then 'ACCOUNT_MODERATE'
  when p_action='work-list' then 'CONTENT_METADATA_READ'
  when p_action in ('curation','preview','curation-save') then 'CURATION_WRITE' else 'AUDIT_READ' end;
 allowed:=authoring.workflow_can(a,permission);
 if p_action in ('cases','assignees','case-update','case-resolve') then
  if source is null or source not in ('CONTENT_REVIEW','COMMENT_REPORT','REPORT') then return jsonb_build_object('error','INVALID_SOURCE','status',400); end if;
  legacy:=case when source='CONTENT_REVIEW' then 'CONTENT_REVIEW' else 'COMMENT_REPORT' end;
  allowed:=allowed or authoring.workflow_can(a,legacy);
 end if;
 if p_action in ('accounts','account-support') then
  if p_data->>'kind' is null or p_data->>'kind' not in ('reader','author') then return jsonb_build_object('error','INVALID_KIND','status',400); end if;
  allowed:=allowed or authoring.workflow_can(a,case when p_data->>'kind'='reader' then 'USER_MGMT' else 'CREATOR_MGMT' end);
 end if;
 if p_action='work-list' then allowed:=allowed or authoring.workflow_can(a,'WORK_MGMT') or authoring.workflow_can(a,'CURATION_WRITE'); end if;
 if p_action='audit' then allowed:=allowed or authoring.workflow_can(a,'SECURITY_MGMT'); end if;
 if p_action='draft-read' then allowed:=a.role::text='SUPER_ADMIN'; end if;
 if not allowed then return jsonb_build_object('error','PERMISSION_REQUIRED','status',403); end if;
 if p_data ? 'offset' then
  if coalesce(p_data->>'offset','') !~ '^[0-9]{1,6}$' then return jsonb_build_object('error','INVALID_OFFSET','status',400); end if;
  off:=(p_data->>'offset')::integer;
  if off>100000 then return jsonb_build_object('error','INVALID_OFFSET','status',400); end if;
 end if;
 if not is_write then
  if p_action='cases' then
   select coalesce(jsonb_agg(x.item order by x.created_at desc,x.id),'[]') into items from (
    select id,created_at,authoring.workflow_case(source,id)||jsonb_build_object('targetVersion',coalesce(authoring.workflow_target_version(source,id),''),'workflow',jsonb_build_object(
     'revision',coalesce(m.revision,0)::text,'assigneeId',m.assignee_id,'priority',coalesce(m.priority,'NORMAL'),
     'dueAt',m.due_at,'evidence',coalesce(m.evidence,''),'duplicateId',m.duplicate_id)) item
    from (select cr.id,cr.created_at from public.content_reviews cr where source='CONTENT_REVIEW'
     union all select cr.id,cr.created_at from authoring.comment_reports cr where source='COMMENT_REPORT'
     union all select cr.id,cr.created_at from public.reports cr where source='REPORT') originals
    left join authoring.case_workflow m on m.source=source and m.source_id=originals.id
    order by created_at desc,id limit 50 offset off) x;
   return jsonb_build_object('cases',items,'offset',off,'nextOffset',case when jsonb_array_length(items)=50 then off+50 end);
  elsif p_action='assignees' then
   return jsonb_build_object('assignees',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.nickname))
    from public.admin_users u join auth.users au on au.id=u.auth_user_id where u.is_active and au.email_confirmed_at is not null
     and au.is_anonymous is not true and (au.banned_until is null or au.banned_until<=now())
     and (authoring.workflow_can(u,'CASE_RESOLVE') or authoring.workflow_can(u,legacy))),'[]'::jsonb));
  elsif p_action='appeals' then
   select coalesce(jsonb_agg(x.item order by x.created_at desc),'[]') into items from (
    select z.created_at,jsonb_build_object('id',z.id,'source',z.source,'sourceId',z.source_id,'status',z.status,
     'reason',z.reason,'resolutionReason',z.resolution_reason,'createdAt',z.created_at,
     'targetVersion',coalesce(authoring.workflow_target_version(z.source,z.source_id),''),
     'case',authoring.workflow_case(z.source,z.source_id),'followup',
     (select jsonb_build_object('decision',f.decision,'reason',f.reason,'createdAt',f.created_at) from authoring.appeal_followups f where f.appeal_id=z.id)) item
    from authoring.admin_case_appeals z order by z.created_at desc,z.id limit 50 offset off) x;
   return jsonb_build_object('appeals',items,'nextOffset',case when jsonb_array_length(items)=50 then off+50 end);
  elsif p_action='accounts' then
   select coalesce(jsonb_agg(x.item),'[]') into items from (
    select jsonb_build_object('id',rr.id::text,'name',rr.nickname,'status',rr.status) item,rr.created_at from public.readers rr where p_data->>'kind'='reader'
    union all select jsonb_build_object('id',au.id::text,'name',au.pen_name,'status',au.status),au.created_at from public.authors au where p_data->>'kind'='author'
    order by created_at desc limit 50 offset off) x;
   return jsonb_build_object('accounts',items,'nextOffset',case when jsonb_array_length(items)=50 then off+50 end);
  elsif p_action='account-support' then
   if p_data->>'kind'='reader' then select auth_user_id,status::text into target_user,old_status from public.readers where id::text=p_data->>'accountId';
   else select auth_user_id,status::text into target_user,old_status from public.authors where id::text=p_data->>'accountId'; end if;
   if not found then return jsonb_build_object('error','ACCOUNT_NOT_FOUND','status',404); end if;
   return jsonb_build_object('accountId',p_data->>'accountId','kind',p_data->>'kind','status',old_status,
    'linked',target_user is not null,'emailConfirmed',exists(select 1 from auth.users where id=target_user and email_confirmed_at is not null),
    'authBlocked',exists(select 1 from auth.users where id=target_user and (is_anonymous is true or banned_until>now())),
    'recovery','SELF_SERVICE_EMAIL','sessionPolicy','EVERY_REQUEST_RECHECK');
  elsif p_action='work-list' then
   return jsonb_build_object('works',coalesce((select jsonb_agg(jsonb_build_object('id',w.id::text,'title',w.title,'status',w.status,
    'version',s.version::text,'moderation',s.moderation_state)) from (select * from public.works order by id desc limit 100) w
     join authoring.work_state s on s.work_id=w.id),'[]'::jsonb));
  elsif p_action='curation' then
   return jsonb_build_object('placements',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('workId',p.work_id::text,
    'revision',p.revision::text,'title',w.title,'eligible',exists(select 1 from authoring.stage16_work_rows(now()) v where v.work_id=p.work_id and v.episode_count>0))
     order by p.slot,p.position,p.starts_at) from authoring.editorial_placements p join public.works w on w.id=p.work_id),'[]'::jsonb));
  elsif p_action='preview' then
   start_at:=coalesce((p_data->>'at')::timestamptz,now());
   if not isfinite(start_at) then return jsonb_build_object('error','INVALID_DATE','status',400); end if;
   return jsonb_build_object('placements',authoring.editorial_rows(start_at),'at',start_at,'visibilityAt',now());
  elsif p_action='audit' then
   select coalesce(jsonb_agg(to_jsonb(x)),'[]') into items from (select * from (
    select e.id::text,e.created_at,'WORKFLOW' origin,e.action,e.target,e.actor_user_id::text actor,e.reason,e.detail from authoring.workflow_events e
    union all select e.id::text,e.created_at,'CASE',e.action,e.source||':'||e.source_id,e.actor_user_id::text,e.reason,'{}'::jsonb from authoring.admin_case_events e
    union all select e.id::text,e.created_at,'WORK',e.action,'WORK:'||e.work_id,e.actor_user_id::text,e.reason,'{}'::jsonb from authoring.admin_work_actions e
    union all select e.id::text,e.created_at,'ACCOUNT',e.action,e.account_kind||':'||e.account_id,e.actor_user_id::text,e.reason,'{}'::jsonb from authoring.admin_account_actions e
    union all select e.id::text,e.created_at,'ROLE','ROLE_UPDATE','ADMIN:'||e.target_admin_id,e.actor_user_id::text,e.reason,'{}'::jsonb from authoring.admin_role_events e
    union all select e.id::text,e.created_at,'LEGACY',e.action,'LEGACY:'||e.id,e.admin_id::text,null,'{}'::jsonb from public.audit_logs e
   ) events where coalesce(p_data->>'target','')='' or events.target=p_data->>'target'
    order by events.created_at desc,events.id desc limit off+50) x;
   -- Optional account-only rollout sources: report absence, never fabricate a complete audit.
   foreach tbl in array array['account_audit','admin_permission_audit','work_curation_audit'] loop
    if to_regclass('launch_recovery.'||tbl) is null then missing:=missing||to_jsonb('launch_recovery.'||tbl); continue; end if;
    execute format($q$select coalesce(jsonb_agg(x.item),'[]'::jsonb) from (
     select jsonb_build_object('id',j->>'id','created_at',j->>'created_at','actor_id',j->>'actor_id','reason',j->>'reason',
      'action',j->>'action','target_id',j->>'target_id','work_id',j->>'work_id','kind',j->>'kind','profile_id',j->>'profile_id') item
     from (select to_jsonb(t) j from launch_recovery.%I t) rows
     where coalesce($1,'')='' or case $2 when 'work_curation_audit' then 'WORK:'||coalesce(j->>'work_id','')
      when 'admin_permission_audit' then 'ADMIN:'||coalesce(j->>'target_id','')
      else coalesce(j->>'kind','ACCOUNT')||':'||coalesce(j->>'profile_id','') end=$1
     order by j->>'created_at' desc,j->>'id' desc limit $3) x$q$,tbl)
     into legacy_rows using p_data->>'target',tbl,off+50;
    for row_data in select value from jsonb_array_elements(legacy_rows) loop
     target:=case tbl when 'work_curation_audit' then 'WORK:'||coalesce(row_data->>'work_id','')
      when 'admin_permission_audit' then 'ADMIN:'||coalesce(row_data->>'target_id','')
      else coalesce(row_data->>'kind','ACCOUNT')||':'||coalesce(row_data->>'profile_id','') end;
     items:=items||jsonb_build_array(jsonb_build_object('id',row_data->>'id','created_at',row_data->>'created_at','origin',tbl,
      'action',coalesce(row_data->>'action',tbl),'target',target,'actor',row_data->>'actor_id','reason',row_data->>'reason','detail','{}'::jsonb));
    end loop;
   end loop;
   select coalesce(jsonb_agg(x.value),'[]') into r from (
    select value from jsonb_array_elements(items) where coalesce(p_data->>'target','')='' or value->>'target'=p_data->>'target'
    order by value->>'created_at' desc,value->>'id' desc limit 50 offset off) x;
   return jsonb_build_object('events',r,'missingSources',missing,'nextOffset',case when jsonb_array_length(r)=50 then off+50 end);
  end if;
 end if;

 action_reason:=btrim(p_data->>'reason');
 if action_reason is null or length(action_reason) not between 3 and 500 then return jsonb_build_object('error','REASON_REQUIRED','status',400); end if;
 req:=(p_data->>'requestId')::uuid;
 if req is null then return jsonb_build_object('error','INVALID_REQUEST_ID','status',400); end if;
 -- Serialize retries before inspecting the receipt; authorization above is never bypassed by a retry.
 perform pg_advisory_xact_lock(hashtextextended('workflow-request:'||p_user||':'||req,0));
 select * into receipt from authoring.workflow_receipts where user_id=p_user and request_id=req;
 if found then
  if receipt.action<>p_action or receipt.payload<>p_data then return jsonb_build_object('error','REQUEST_CONFLICT','status',409); end if;
  if p_action='draft-read' then
   c:=authoring.workflow_case(p_data->>'source',(p_data->>'caseId')::uuid);
   if c is null or c->>'status'<>'PENDING' or not exists(select 1 from authoring.drafts d
    where d.id=(receipt.result->>'draftId')::uuid and d.work_id=(c->>'workId')::bigint and d.current_revision::text=receipt.result->>'revision') then
    return jsonb_build_object('error','DRAFT_REVIEW_CHANGED','status',409); end if;
   return jsonb_build_object('draft',authoring.draft_json((receipt.result->>'draftId')::uuid,(receipt.result->>'revision')::bigint),'replayed',true);
  end if;
  return receipt.result;
 end if;
 if p_action in ('case-update','case-resolve','draft-read') then
  case_id:=(p_data->>'caseId')::uuid;c:=authoring.workflow_case(source,case_id);
  if c is null then return jsonb_build_object('error','CASE_NOT_FOUND','status',404); end if;
  target_work:=(c->>'workId')::bigint;target:=source||':'||case_id;
  -- All metadata graph updates use this lock: opposite duplicate links cannot create a cycle.
  perform pg_advisory_xact_lock(hashtextextended('workflow-case-graph',0));
  insert into authoring.case_workflow(source,source_id) values(source,case_id) on conflict do nothing;
  select * into meta from authoring.case_workflow m where m.source=source and m.source_id=case_id for update;
  if p_action<>'draft-read' and meta.revision::text is distinct from p_data->>'revision' then return jsonb_build_object('error','CASE_CONFLICT','status',409); end if;
  if p_action='case-update' then
   if c->>'status'<>'PENDING' then return jsonb_build_object('error','CASE_CLOSED','status',409); end if;
   if c->>'target' like 'COMMENT:%' then
    perform 1 from public.comments where 'COMMENT:'||id=c->>'target' for update;
    if authoring.workflow_target_version(source,case_id) is distinct from p_data->>'targetVersion' then
     return jsonb_build_object('error','REVIEW_TARGET_CHANGED','status',409); end if;
   end if;
   if coalesce(p_data->>'priority','') not in ('NORMAL','HIGH','URGENT') or length(btrim(coalesce(p_data->>'evidence',''))) not between 3 and 2000 then return jsonb_build_object('error','INVALID_FIELD','status',400); end if;
   if p_data->>'assigneeId' is not null and not exists(select 1 from public.admin_users u join auth.users au on au.id=u.auth_user_id
    where u.id=(p_data->>'assigneeId')::uuid and u.is_active and au.email_confirmed_at is not null and au.is_anonymous is not true
     and (au.banned_until is null or au.banned_until<=now()) and (authoring.workflow_can(u,'CASE_RESOLVE') or authoring.workflow_can(u,legacy)))
    then return jsonb_build_object('error','INVALID_ASSIGNEE','status',400); end if;
   due:=(p_data->>'dueAt')::timestamptz;
   if due is not null and not isfinite(due) then return jsonb_build_object('error','INVALID_DATE','status',400); end if;
   linked:=(p_data->>'duplicateId')::uuid;counter:=0;
   while linked is not null loop
    counter:=counter+1;other_case:=authoring.workflow_case(source,linked);
    if linked=case_id or counter>100 or other_case is null or other_case->>'target' is distinct from c->>'target' then
     return jsonb_build_object('error','INVALID_DUPLICATE','status',409); end if;
    select m.duplicate_id into linked from authoring.case_workflow m where m.source=source and m.source_id=linked;
   end loop;
   update authoring.case_workflow m set revision=revision+1,assignee_id=(p_data->>'assigneeId')::uuid,
    priority=p_data->>'priority',due_at=due,evidence=p_data->>'evidence',duplicate_id=(p_data->>'duplicateId')::uuid,
    reviewed_target_version=authoring.workflow_target_version(source,case_id),updated_at=now()
    where m.source=source and m.source_id=case_id;
   event_detail:=jsonb_build_object('revision',(meta.revision+1)::text,'assigneeId',p_data->>'assigneeId',
    'priority',p_data->>'priority','dueAt',due,'evidence',p_data->>'evidence','duplicateId',p_data->>'duplicateId');
   r:=jsonb_build_object('saved',true,'revision',(meta.revision+1)::text);
  elsif p_action='case-resolve' then
   if length(btrim(meta.evidence))<3 then return jsonb_build_object('error','EVIDENCE_REQUIRED','status',409); end if;
   if c->>'target' like 'COMMENT:%' then
    perform 1 from public.comments where 'COMMENT:'||id=c->>'target' for update;
    if meta.reviewed_target_version is distinct from authoring.workflow_target_version(source,case_id) then
     return jsonb_build_object('error','REVIEW_TARGET_CHANGED','status',409); end if;
   end if;
   r:=public.stage9_admin(p_user,'case-resolve',p_data);
   if r ? 'error' then return r; end if;
   update authoring.case_workflow m set revision=revision+1,updated_at=now() where m.source=source and m.source_id=case_id;
   r:=r||jsonb_build_object('revision',(meta.revision+1)::text);
  else
   if source is distinct from 'CONTENT_REVIEW' or c->>'status'<>'PENDING' then return jsonb_build_object('error','DRAFT_CASE_REQUIRED','status',403); end if;
   select * into draft from authoring.drafts where id=(p_data->>'draftId')::uuid and work_id=target_work
    and (c->>'episodeId' is null or episode_id::text=c->>'episodeId');
   if not found then return jsonb_build_object('error','DRAFT_NOT_FOUND','status',404); end if;
   selected_revision:=draft.current_revision;
   r:=jsonb_build_object('draftId',draft.id,'revision',selected_revision::text);
   event_detail:=r;
  end if;
 elsif p_action in ('appeal-resolve','appeal-followup') then
  select * into ap from authoring.admin_case_appeals where id=(p_data->>'appealId')::uuid for update;
  if not found then return jsonb_build_object('error','APPEAL_NOT_FOUND','status',404); end if;
  c:=authoring.workflow_case(ap.source,ap.source_id);target_work:=(c->>'workId')::bigint;target:='APPEAL:'||ap.id;
  if p_action='appeal-resolve' then
   r:=public.stage9_admin(p_user,'appeal-resolve',p_data);
   if r ? 'error' then return r; end if;
  else
   if ap.status='PENDING' or exists(select 1 from authoring.appeal_followups where appeal_id=ap.id) then return jsonb_build_object('error','APPEAL_CONFLICT','status',409); end if;
   if coalesce(p_data->>'decision','') not in ('MAINTAIN','UNRESTRICT','UNBLOCK') then return jsonb_build_object('error','INVALID_DECISION','status',400); end if;
   if p_data->>'decision'<>'MAINTAIN' then
    if ap.status<>'ACCEPTED' then return jsonb_build_object('error','APPEAL_NOT_ACCEPTED','status',409); end if;
    -- Respect publishing's works -> work_state lock order.
    perform 1 from public.works where id=target_work for update;
    if p_data->>'decision'='UNRESTRICT' and ap.source='WORK_MODERATION' then
     perform 1 from authoring.work_state where work_id=target_work for update;
     if ap.source_id is distinct from (select id from authoring.admin_work_actions where work_id=target_work and action in ('RESTRICT','UNRESTRICT') order by created_at desc,id desc limit 1)
      then return jsonb_build_object('error','NEWER_MODERATION','status',409); end if;
     r:=public.stage9_admin(p_user,'moderate',jsonb_build_object('workId',target_work::text,'version',p_data->>'targetVersion','decision','UNRESTRICT','reason',action_reason));
     if r ? 'error' then return r; end if;
    elsif p_data->>'decision'='UNBLOCK' and ap.source in ('COMMENT_REPORT','REPORT') and c->>'target' like 'COMMENT:%' then
     perform 1 from public.comments where 'COMMENT:'||id=c->>'target' for update;
     if authoring.workflow_target_version(ap.source,ap.source_id) is distinct from p_data->>'targetVersion' then return jsonb_build_object('error','COMMENT_CONFLICT','status',409); end if;
     if exists(select 1 from authoring.admin_case_events ev where ev.action='RESOLVE' and (ev.source,ev.source_id)<>(ap.source,ap.source_id)
      and authoring.workflow_case(ev.source,ev.source_id)->>'target'=c->>'target'
      and not exists(select 1 from authoring.admin_case_appeals z join authoring.appeal_followups f on f.appeal_id=z.id and f.decision='UNBLOCK' where z.source=ev.source and z.source_id=ev.source_id))
      then return jsonb_build_object('error','OTHER_COMMENT_RESTRICTION','status',409); end if;
     update public.comments set is_blocked=false,updated_at=now() where 'COMMENT:'||id=c->>'target' and is_blocked;
     if not found then return jsonb_build_object('error','COMMENT_CONFLICT','status',409); end if;
    else return jsonb_build_object('error','UNSUPPORTED_FOLLOWUP','status',409); end if;
   end if;
   insert into authoring.appeal_followups(appeal_id,actor_user_id,decision,reason) values(ap.id,p_user,p_data->>'decision',action_reason);
   r:=jsonb_build_object('saved',true,'decision',p_data->>'decision');
  end if;
  event_detail:=jsonb_build_object('source',ap.source,'sourceId',ap.source_id,'decision',p_data->>'decision');
 elsif p_action='moderate' then
  target_work:=(p_data->>'workId')::bigint;target:='WORK:'||target_work;
  perform 1 from public.works where id=target_work for update;
  r:=public.stage9_admin(p_user,'moderate',p_data);if r ? 'error' then return r; end if;
 elsif p_action='account-moderate' then
  if p_data->>'kind'='reader' then select status::text into old_status from public.readers where id::text=p_data->>'accountId' for update;
  elsif p_data->>'kind'='author' then select status::text into old_status from public.authors where id::text=p_data->>'accountId' for update;
  else return jsonb_build_object('error','INVALID_KIND','status',400); end if;
  if not found then return jsonb_build_object('error','ACCOUNT_NOT_FOUND','status',404); end if;
  if old_status is distinct from p_data->>'expectedStatus' then return jsonb_build_object('error','ACCOUNT_CONFLICT','status',409); end if;
  r:=public.stage9_admin(p_user,'account-moderate',p_data);if r ? 'error' then return r; end if;
  target:=(p_data->>'kind')||':'||(p_data->>'accountId');
 elsif p_action='curation-save' then
  perform pg_advisory_xact_lock(hashtextextended('workflow-editorial',0));
  select * into placement from authoring.editorial_placements where id=(p_data->>'placementId')::uuid for update;
  if coalesce(placement.revision,0)::text is distinct from p_data->>'revision' then return jsonb_build_object('error','CURATION_CONFLICT','status',409); end if;
  target_work:=(p_data->>'workId')::bigint;start_at:=(p_data->>'startsAt')::timestamptz;end_at:=(p_data->>'endsAt')::timestamptz;
  if not exists(select 1 from public.works where id=target_work) then return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
  if coalesce(p_data->>'slot','') not in ('HOME_RECOMMENDED','HOME_SPOTLIGHT') or coalesce((p_data->>'position')::integer,0) not between 1 and 8
   or jsonb_typeof(p_data->'enabled') is distinct from 'boolean' or start_at is null or end_at is null or not isfinite(start_at) or not isfinite(end_at) or end_at<=start_at then
   return jsonb_build_object('error','INVALID_CURATION','status',400); end if;
  if (p_data->>'enabled')::boolean and not exists(select 1 from authoring.stage16_work_rows(now()) w where w.work_id=target_work and w.episode_count>0) then
   return jsonb_build_object('error','PUBLIC_WORK_REQUIRED','status',409); end if;
  if (p_data->>'enabled')::boolean and exists(select 1 from authoring.editorial_placements p where p.id<>(p_data->>'placementId')::uuid and p.enabled
   and p.slot=p_data->>'slot' and (p.position=(p_data->>'position')::integer or p.work_id=target_work) and p.starts_at<end_at and p.ends_at>start_at) then
   return jsonb_build_object('error','PLACEMENT_OVERLAP','status',409); end if;
  insert into authoring.editorial_placements(id,work_id,slot,position,starts_at,ends_at,enabled,revision)
   values((p_data->>'placementId')::uuid,target_work,p_data->>'slot',(p_data->>'position')::integer,start_at,end_at,(p_data->>'enabled')::boolean,1)
   on conflict(id) do update set work_id=excluded.work_id,slot=excluded.slot,position=excluded.position,starts_at=excluded.starts_at,
    ends_at=excluded.ends_at,enabled=excluded.enabled,revision=editorial_placements.revision+1,updated_at=now();
  target:='WORK:'||target_work;event_detail:=jsonb_build_object('before',to_jsonb(placement),'after',p_data-'reason'-'requestId');
  r:=jsonb_build_object('saved',true,'revision',(coalesce(placement.revision,0)+1)::text);
 end if;
 if r is null then return jsonb_build_object('error','INVALID_ACTION','status',400); end if;
 if p_action in ('case-resolve','appeal-resolve','appeal-followup') and target_work is not null then
  insert into authoring.creator_notices(work_id,kind,title,detail) values(target_work,'MODERATION',
   case p_action when 'case-resolve' then '사건 처리 결과' when 'appeal-resolve' then '이의제기 심사 결과' else '이의제기 후속 조치' end,
   target||' · '||(p_data->>'decision')||' · '||action_reason);
 end if;
 insert into authoring.workflow_events(actor_user_id,action,target,work_id,reason,detail)
  values(p_user,p_action,target,target_work,action_reason,event_detail||jsonb_build_object('decision',p_data->>'decision'));
 insert into authoring.workflow_receipts(user_id,request_id,action,payload,result) values(p_user,req,p_action,p_data,r);
 if p_action='draft-read' then return jsonb_build_object('draft',authoring.draft_json(draft.id,selected_revision)); end if;
 return r;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
 return jsonb_build_object('error','INVALID_FIELD','status',400);
end $$;
revoke all on function public.stage17_admin(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.stage17_admin(uuid,text,jsonb) to service_role;

create or replace function public.stage17_my_appeals(p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 r:=public.stage9_appeal(p_user,'my','{}');if r ? 'error' then return r; end if;
 return jsonb_build_object('appeals',coalesce((select jsonb_agg(x.value||jsonb_build_object('followup',
  (select jsonb_build_object('decision',f.decision,'reason',f.reason,'createdAt',f.created_at) from authoring.appeal_followups f where f.appeal_id=(x.value->>'id')::uuid)))
  from jsonb_array_elements(r->'appeals') x),'[]'::jsonb));
end $$;
revoke all on function public.stage17_my_appeals(uuid) from public,anon,authenticated;
grant execute on function public.stage17_my_appeals(uuid) to service_role;
insert into authoring.migrations(version) values('authoring-014') on conflict do nothing;
commit;
