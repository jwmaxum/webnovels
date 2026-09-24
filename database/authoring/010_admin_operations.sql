-- Step 9: server-only operational cases. Apply only after reviewing 009 and live legacy tables.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
   or not exists(select 1 from authoring.migrations where version='authoring-009') then
   raise exception 'Reviewed authoring-009 prerequisite required'; end if;
 if to_regclass('public.content_reviews') is null or to_regclass('public.reports') is null
   or to_regclass('public.audit_logs') is null then
   raise exception 'Legacy review, report and audit schemas require review'; end if;
end $$;

create table if not exists authoring.admin_case_events(
 id uuid primary key default gen_random_uuid(),
 source text not null check(source in ('CONTENT_REVIEW','REPORT','COMMENT_REPORT')),
 source_id uuid not null,
 work_id bigint references public.works(id) on delete restrict,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 action text not null check(action in ('RESOLVE','REJECT')),
 previous_status text not null,
 next_status text not null,
 reason text not null check(length(btrim(reason)) between 3 and 500),
 created_at timestamptz not null default now(),
 unique(source,source_id)
);
create table if not exists authoring.admin_work_actions(
 id uuid primary key default gen_random_uuid(),
 work_id bigint not null references public.works(id) on delete restrict,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 action text not null check(action in ('RESTRICT','UNRESTRICT','CURATION')),
 previous_state jsonb not null,
 next_state jsonb not null,
 reason text not null check(length(btrim(reason)) between 3 and 500),
 created_at timestamptz not null default now()
);
create table if not exists authoring.admin_case_appeals(
 id uuid primary key default gen_random_uuid(),
 source text not null check(source in ('CONTENT_REVIEW','REPORT','COMMENT_REPORT','WORK_MODERATION')),
 source_id uuid not null,
 requester_user_id uuid not null references auth.users(id) on delete restrict,
 status text not null default 'PENDING' check(status in ('PENDING','ACCEPTED','REJECTED')),
 reason text not null check(length(btrim(reason)) between 3 and 500),
 resolution_reason text,
 created_at timestamptz not null default now(),
 resolved_at timestamptz,
 resolved_by uuid references auth.users(id) on delete restrict
);
create unique index if not exists admin_case_appeals_one_pending
 on authoring.admin_case_appeals(source,source_id,requester_user_id) where status='PENDING';
create table if not exists authoring.admin_role_events(
 id uuid primary key default gen_random_uuid(),
 target_admin_id uuid not null references public.admin_users(id) on delete restrict,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 previous_permissions jsonb not null,
 next_permissions jsonb not null,
 reason text not null check(length(btrim(reason)) between 3 and 500),
 created_at timestamptz not null default now()
);
create table if not exists authoring.admin_account_actions(
 id uuid primary key default gen_random_uuid(),
 account_kind text not null check(account_kind in ('reader','author')),
 account_id text not null,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 action text not null check(action in ('SUSPEND','RESTORE')),
 previous_status text not null,
 next_status text not null,
 reason text not null check(length(btrim(reason)) between 3 and 500),
 created_at timestamptz not null default now()
);
do $$ declare t text; begin
 foreach t in array array['admin_case_events','admin_work_actions','admin_case_appeals',
   'admin_role_events','admin_account_actions'] loop
   execute format('alter table authoring.%I enable row level security',t);
   execute format('revoke all on authoring.%I from public,anon,authenticated',t);
   execute format('grant select,insert on authoring.%I to service_role',t);
 end loop;
end $$;

alter table authoring.creator_notices drop constraint if exists creator_notices_kind_check;
alter table authoring.creator_notices add constraint creator_notices_kind_check
 check(kind in ('INQUIRY','REPORT_RESULT','SCHEDULE_FAILED','MODERATION'));

create or replace function public.stage9_admin(
 p_user uuid,p_action text,p_data jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.admin_users; permission text; source text; case_id uuid; decision text;
 action_reason text; target_work bigint; old_status text; new_status text; previous_value boolean;
 review public.content_reviews; report public.reports; community authoring.comment_reports;
 ws authoring.work_state; flag text; enabled boolean; expected_version text;
 target_admin public.admin_users; requested_permissions jsonb; merged_permissions jsonb;
 account_kind text; account_id text; appeal authoring.admin_case_appeals;
begin
 select * into a from public.admin_users where auth_user_id=p_user and is_active
   and role in ('SUPER_ADMIN','ADMIN','SUB_ADMIN');
 if not found or not exists(select 1 from auth.users where id=p_user
   and email_confirmed_at is not null and is_anonymous is not true
   and (banned_until is null or banned_until<=now())) then
   return jsonb_build_object('error','ADMIN_REQUIRED','status',403); end if;
 if p_action in ('dashboard','cases') then
   permission:=case when p_action='dashboard' then 'OPERATIONS_READ' else
     case p_data->>'source' when 'CONTENT_REVIEW' then 'CONTENT_REVIEW'
       when 'REPORT' then 'COMMENT_REPORT' when 'COMMENT_REPORT' then 'COMMENT_REPORT'
       else 'CASE_READ' end end;
 elsif p_action in ('case-resolve','appeal-resolve') then permission:='CASE_RESOLVE';
 elsif p_action='appeals' then permission:='CASE_READ';
 elsif p_action in ('accounts','roles') then permission:='ACCOUNTS_READ';
 elsif p_action='role-update' then permission:='ROLE_MANAGE';
 elsif p_action='account-moderate' then permission:='ACCOUNT_MODERATE';
 elsif p_action='work-list' then permission:='CONTENT_METADATA_READ';
 elsif p_action='moderate' then permission:='CONTENT_MODERATE';
 elsif p_action='curate' then permission:='CURATION_WRITE';
 elsif p_action='audit' then permission:='AUDIT_READ';
 else return jsonb_build_object('error','INVALID_ACTION','status',400); end if;
 if a.role<>'SUPER_ADMIN' and not (coalesce(a.permissions,'[]'::jsonb) ? permission)
   and not (p_action='dashboard' and coalesce(a.permissions,'[]'::jsonb) ? 'DASHBOARD')
   and not (p_action='accounts' and p_data->>'kind'='reader' and coalesce(a.permissions,'[]'::jsonb) ? 'USER_MGMT')
   and not (p_action='accounts' and p_data->>'kind'='author' and coalesce(a.permissions,'[]'::jsonb) ? 'CREATOR_MGMT')
   and not (p_action='work-list' and coalesce(a.permissions,'[]'::jsonb) ? 'WORK_MGMT')
   and not (p_action='cases' and coalesce(a.permissions,'[]'::jsonb) ? 'CASE_READ')
   and not (p_action='case-resolve' and p_data->>'source'='CONTENT_REVIEW'
     and coalesce(a.permissions,'[]'::jsonb) ? 'CONTENT_REVIEW')
   and not (p_action='case-resolve' and p_data->>'source' in ('REPORT','COMMENT_REPORT')
     and coalesce(a.permissions,'[]'::jsonb) ? 'COMMENT_REPORT')
   and not (p_action='audit' and coalesce(a.permissions,'[]'::jsonb) ? 'SECURITY_MGMT') then
   return jsonb_build_object('error','ADMIN_FORBIDDEN','status',403); end if;
 if p_action='dashboard' then
   return jsonb_build_object('works',(select count(*) from public.works),
     'readers',(select count(*) from public.readers),
     'authors',(select count(*) from public.authors),
     'pendingReviews',(select count(*) from public.content_reviews where status::text='PENDING'),
     'pendingReports',(select count(*) from public.reports where status::text='PENDING')+
       (select count(*) from authoring.comment_reports where status='PENDING'),
     'failedSchedules',(select count(*) from authoring.schedules where status='FAILED'));
 end if;
 if p_action='accounts' then
   if p_data->>'kind'='reader' then
     return jsonb_build_object('accounts',coalesce((select jsonb_agg(row_to_json(x)) from
       (select id::text id,nickname,status::text status,created_at from public.readers
        order by id desc limit 100) x),'[]'::jsonb));
   elsif p_data->>'kind'='author' then
     return jsonb_build_object('accounts',coalesce((select jsonb_agg(row_to_json(x)) from
       (select id::text id,pen_name,status::text status from public.authors
        order by id desc limit 100) x),'[]'::jsonb));
   end if;
   return jsonb_build_object('error','INVALID_KIND','status',400);
 end if;
 if p_action='roles' then
   if a.role<>'SUPER_ADMIN' then return jsonb_build_object('error','ADMIN_FORBIDDEN','status',403); end if;
   return jsonb_build_object('roles',coalesce((select jsonb_agg(row_to_json(x)) from
     (select id::text id,nickname,role,is_active,permissions from public.admin_users
      order by created_at desc limit 100) x),'[]'::jsonb));
 end if;
 if p_action='work-list' then
   return jsonb_build_object('works',coalesce((select jsonb_agg(row_to_json(x)) from
     (select w.id::text id,w.title,s.moderation_state,s.moderation_reason,s.version::text version,
       w.is_top_recommended,w.is_popular_work,w.is_new_work
       from public.works w join authoring.work_state s on s.work_id=w.id
       order by w.id desc limit 100) x),'[]'::jsonb));
 end if;
 if p_action='cases' then
   if p_data->>'source' is null or p_data->>'source' not in ('CONTENT_REVIEW','REPORT','COMMENT_REPORT') then
     return jsonb_build_object('error','INVALID_CASE_SOURCE','status',400); end if;
   return jsonb_build_object('cases',coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc) from
     (select 'CONTENT_REVIEW' source,id,work_id::text "workId",status::text status,
       work_title_snapshot label,created_at from public.content_reviews
       where status::text='PENDING' and p_data->>'source'='CONTENT_REVIEW'
      union all select 'REPORT',r.id,null,r.status::text,r.reason,r.created_at
        from public.reports r where r.status::text='PENDING' and p_data->>'source'='REPORT'
      union all select 'COMMENT_REPORT',cr.id,cr.work_id::text,cr.status,cr.reason,cr.created_at
        from authoring.comment_reports cr where cr.status='PENDING' and p_data->>'source'='COMMENT_REPORT'
      order by created_at desc limit 200) x),'[]'::jsonb));
 end if;
 if p_action='appeals' then
   return jsonb_build_object('appeals',coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc)
     from (select ap.id,ap.source,ap.source_id::text "sourceId",ap.requester_user_id::text "requesterUserId",
       ap.reason,ap.created_at from authoring.admin_case_appeals ap
       where ap.status='PENDING' order by ap.created_at desc limit 100) x),'[]'::jsonb));
 end if;
 if p_action='audit' then
   return jsonb_build_object('events',coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc) from
     (select 'CASE' kind,e.source || ':' || e.source_id::text target,e.action,e.reason,e.created_at
       from authoring.admin_case_events e
      union all select 'WORK',wa.work_id::text,wa.action,wa.reason,wa.created_at
       from authoring.admin_work_actions wa
      union all select 'ROLE',re.target_admin_id::text,'PERMISSIONS',re.reason,re.created_at
       from authoring.admin_role_events re
      union all select 'ACCOUNT',aa.account_kind || ':' || aa.account_id,aa.action,aa.reason,aa.created_at
       from authoring.admin_account_actions aa
      union all select 'APPEAL',ap.source || ':' || ap.source_id::text,ap.status,ap.resolution_reason,ap.resolved_at
       from authoring.admin_case_appeals ap where ap.status<>'PENDING'
      order by created_at desc limit 100) x),'[]'::jsonb));
 end if;
 action_reason:=btrim(p_data->>'reason');
 if action_reason is null or length(action_reason) not between 3 and 500 then
   return jsonb_build_object('error','REASON_REQUIRED','status',400); end if;
 if p_action='appeal-resolve' then
   decision:=p_data->>'decision';
   if decision is null or decision not in ('ACCEPT','REJECT') then
     return jsonb_build_object('error','INVALID_DECISION','status',400); end if;
   begin case_id:=(p_data->>'appealId')::uuid; exception when others then
     return jsonb_build_object('error','INVALID_APPEAL_ID','status',400); end;
   select * into appeal from authoring.admin_case_appeals where id=case_id for update;
   if not found then return jsonb_build_object('error','APPEAL_NOT_FOUND','status',404); end if;
   if appeal.status<>'PENDING' then return jsonb_build_object('error','APPEAL_CONFLICT','status',409); end if;
   new_status:=case when decision='ACCEPT' then 'ACCEPTED' else 'REJECTED' end;
   update authoring.admin_case_appeals set status=new_status,resolution_reason=action_reason,
     resolved_by=p_user,resolved_at=now() where id=case_id;
   return jsonb_build_object('saved',true,'status',new_status);
 end if;
 if p_action='account-moderate' then
   account_kind:=p_data->>'kind';account_id:=p_data->>'accountId';
   decision:=p_data->>'decision';
   if account_kind is null or decision is null or account_kind not in ('reader','author')
     or decision not in ('SUSPEND','RESTORE')
     or account_id is null or length(account_id)>36 then
     return jsonb_build_object('error','INVALID_ACCOUNT','status',400); end if;
   if account_kind='reader' then
     select status into old_status from public.readers where id::text=account_id for update;
     if not found then return jsonb_build_object('error','ACCOUNT_NOT_FOUND','status',404); end if;
     if exists(select 1 from public.readers where id::text=account_id and auth_user_id=p_user) then
       return jsonb_build_object('error','SELF_ACTION_FORBIDDEN','status',403); end if;
     new_status:=case when decision='SUSPEND' then 'SUSPENDED' else 'ACTIVE' end;
     if old_status not in ('ACTIVE','SUSPENDED') or old_status=new_status then
       return jsonb_build_object('error','ACCOUNT_CONFLICT','status',409); end if;
     update public.readers set status=new_status where id::text=account_id;
   else
     select status into old_status from public.authors where id::text=account_id for update;
     if not found then return jsonb_build_object('error','ACCOUNT_NOT_FOUND','status',404); end if;
     if exists(select 1 from public.authors where id::text=account_id and auth_user_id=p_user) then
       return jsonb_build_object('error','SELF_ACTION_FORBIDDEN','status',403); end if;
     new_status:=case when decision='SUSPEND' then 'SUSPENDED' else 'APPROVED' end;
     if old_status not in ('APPROVED','SUSPENDED') or old_status=new_status then
       return jsonb_build_object('error','ACCOUNT_CONFLICT','status',409); end if;
     update public.authors set status=new_status where id::text=account_id;
   end if;
   insert into authoring.admin_account_actions(account_kind,account_id,actor_user_id,
     action,previous_status,next_status,reason)
     values(account_kind,account_id,p_user,decision,old_status,new_status,action_reason);
   return jsonb_build_object('saved',true,'status',new_status);
 end if;
 if p_action='role-update' then
   if a.role<>'SUPER_ADMIN' then return jsonb_build_object('error','ADMIN_FORBIDDEN','status',403); end if;
   begin case_id:=(p_data->>'adminId')::uuid; exception when others then
     return jsonb_build_object('error','INVALID_ADMIN_ID','status',400); end;
   requested_permissions:=p_data->'permissions';
   if jsonb_typeof(requested_permissions) is distinct from 'array'
     or jsonb_array_length(requested_permissions)>20
     or exists(select 1 from jsonb_array_elements(requested_permissions) item
       where jsonb_typeof(item) <> 'string'
         or item#>>'{}' not in ('OPERATIONS_READ','ACCOUNTS_READ','CONTENT_METADATA_READ',
           'CASE_READ','CASE_RESOLVE','CONTENT_REVIEW','COMMENT_REPORT',
           'CONTENT_MODERATE','CURATION_WRITE','AUDIT_READ','ACCOUNT_MODERATE')) then
     return jsonb_build_object('error','INVALID_PERMISSIONS','status',400); end if;
   select * into target_admin from public.admin_users where id=case_id for update;
   if not found then return jsonb_build_object('error','ADMIN_NOT_FOUND','status',404); end if;
   if target_admin.role<>'SUB_ADMIN' or target_admin.auth_user_id=p_user then
     return jsonb_build_object('error','PROTECTED_ADMIN','status',403); end if;
   select coalesce(jsonb_agg(distinct value),'[]'::jsonb) into merged_permissions from (
     select value from jsonb_array_elements_text(coalesce(target_admin.permissions,'[]'::jsonb)) value
       where value not in ('OPERATIONS_READ','ACCOUNTS_READ','CONTENT_METADATA_READ',
         'CASE_READ','CASE_RESOLVE','CONTENT_REVIEW','COMMENT_REPORT',
         'CONTENT_MODERATE','CURATION_WRITE','AUDIT_READ','ACCOUNT_MODERATE')
     union all select value from jsonb_array_elements_text(requested_permissions) value
   ) merged;
   if merged_permissions=target_admin.permissions then
     return jsonb_build_object('saved',false,'permissions',merged_permissions); end if;
   update public.admin_users set permissions=merged_permissions,updated_at=now() where id=case_id;
   insert into authoring.admin_role_events(target_admin_id,actor_user_id,
     previous_permissions,next_permissions,reason)
     values(case_id,p_user,target_admin.permissions,merged_permissions,action_reason);
   return jsonb_build_object('saved',true,'permissions',merged_permissions);
 end if;
 if p_action='case-resolve' then
   source:=p_data->>'source'; decision:=p_data->>'decision';
   if source is null or decision is null or source not in ('CONTENT_REVIEW','REPORT','COMMENT_REPORT')
     or decision not in ('RESOLVE','REJECT') then
     return jsonb_build_object('error','INVALID_CASE','status',400); end if;
   begin case_id:=(p_data->>'caseId')::uuid; exception when others then
     return jsonb_build_object('error','INVALID_CASE_ID','status',400); end;
   if source='CONTENT_REVIEW' then
     select * into review from public.content_reviews where id=case_id for update;
     if not found then return jsonb_build_object('error','CASE_NOT_FOUND','status',404); end if;
     old_status:=review.status::text; target_work:=review.work_id;
     if old_status<>'PENDING' then return jsonb_build_object('error','CASE_CONFLICT','status',409); end if;
     new_status:=case when decision='RESOLVE' then 'APPROVED' else 'REJECTED' end;
     update public.content_reviews set status=new_status::public.review_status,
       reject_reason=case when decision='REJECT' then action_reason else null end,
       reviewer_id=p_user,reviewed_at=now() where id=case_id;
   elsif source='COMMENT_REPORT' then
     select * into community from authoring.comment_reports where id=case_id for update;
     if not found then return jsonb_build_object('error','CASE_NOT_FOUND','status',404); end if;
     old_status:=community.status;target_work:=community.work_id;
     if old_status<>'PENDING' then return jsonb_build_object('error','CASE_CONFLICT','status',409); end if;
     new_status:='REVIEWED';
     if decision='RESOLVE' then update public.comments set is_blocked=true,updated_at=now()
       where id=community.comment_id; end if;
     update authoring.comment_reports set status='REVIEWED' where id=case_id;
   else
     select * into report from public.reports where id=case_id for update;
     if not found then return jsonb_build_object('error','CASE_NOT_FOUND','status',404); end if;
     old_status:=report.status::text;
     if old_status<>'PENDING' then return jsonb_build_object('error','CASE_CONFLICT','status',409); end if;
     if decision='RESOLVE' then
       if report.target_type='COMMENT' then
         begin case_id:=report.target_id::uuid; exception when others then
           return jsonb_build_object('error','UNSUPPORTED_TARGET','status',409); end;
         update public.comments set is_blocked=true,updated_at=now() where id=case_id;
         if not found then return jsonb_build_object('error','UNSUPPORTED_TARGET','status',409); end if;
         case_id:=report.id;
       else return jsonb_build_object('error','UNSUPPORTED_TARGET','status',409); end if;
     end if;
     new_status:=case when decision='RESOLVE' then 'RESOLVED' else 'REJECTED' end;
     update public.reports set status=new_status::public.report_status,resolved_action=decision || ': ' || action_reason,
       resolved_by=p_user,resolved_at=now() where id=report.id;
   end if;
   insert into authoring.admin_case_events(source,source_id,work_id,actor_user_id,action,
     previous_status,next_status,reason)
     values(source,case_id,target_work,p_user,decision,old_status,new_status,action_reason);
   if source='COMMENT_REPORT' then
     update authoring.creator_notices set detail=decision || ': ' || action_reason
       where comment_report_id=case_id; end if;
   return jsonb_build_object('saved',true,'status',new_status);
 end if;
 if coalesce(p_data->>'workId','') !~ '^[1-9][0-9]{0,18}$' then
   return jsonb_build_object('error','INVALID_WORK_ID','status',400); end if;
 target_work:=(p_data->>'workId')::bigint;
 select * into ws from authoring.work_state s where s.work_id=target_work for update;
 if not found then return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
 expected_version:=p_data->>'version';
 if ws.version::text is distinct from expected_version then
   return jsonb_build_object('error','WORK_CONFLICT','status',409); end if;
 if p_action='moderate' then
   if p_data->>'decision' is null or p_data->>'decision' not in ('RESTRICT','UNRESTRICT') then
     return jsonb_build_object('error','INVALID_DECISION','status',400); end if;
   old_status:=ws.moderation_state;
   new_status:=case when p_data->>'decision'='RESTRICT' then 'RESTRICTED' else 'CLEAR' end;
   if old_status=new_status then return jsonb_build_object('error','WORK_CONFLICT','status',409); end if;
   update authoring.work_state set moderation_state=new_status,
     moderation_reason=case when new_status='RESTRICTED' then action_reason else null end,
     version=version+1,updated_at=now() where work_id=ws.work_id;
   insert into authoring.admin_work_actions(work_id,actor_user_id,action,previous_state,next_state,reason)
     values(target_work,p_user,p_data->>'decision',jsonb_build_object('moderation',old_status),
       jsonb_build_object('moderation',new_status),action_reason);
   insert into authoring.creator_notices(work_id,kind,title,detail)
     values(target_work,'MODERATION',case when new_status='RESTRICTED' then '작품 노출 제한' else '작품 제한 해제' end,action_reason);
 else
   flag:=p_data->>'flag';
   if flag is null or flag not in ('is_top_recommended','is_popular_work','is_new_work')
     or jsonb_typeof(p_data->'enabled') is distinct from 'boolean' then
     return jsonb_build_object('error','INVALID_CURATION','status',400); end if;
   enabled:=(p_data->>'enabled')::boolean;
   previous_value:=case flag when 'is_top_recommended' then
     (select is_top_recommended from public.works where id=target_work)
     when 'is_popular_work' then (select is_popular_work from public.works where id=target_work)
     else (select is_new_work from public.works where id=target_work) end;
   execute format('update public.works set %I=$1 where id=$2',flag) using enabled,target_work;
   update authoring.work_state set version=version+1,updated_at=now() where work_id=ws.work_id;
   insert into authoring.admin_work_actions(work_id,actor_user_id,action,previous_state,next_state,reason)
     values(target_work,p_user,'CURATION',jsonb_build_object(flag,previous_value),
       jsonb_build_object(flag,enabled),action_reason);
 end if;
 return jsonb_build_object('saved',true,'version',(ws.version+1)::text);
end $$;
revoke all on function public.stage9_admin(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.stage9_admin(uuid,text,jsonb) to service_role;
create or replace function public.stage9_appeal(
 p_user uuid,p_action text,p_data jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare appeal_source text; appeal_source_id uuid; action_reason text; eligible boolean;
begin
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null
   and is_anonymous is not true and (banned_until is null or banned_until<=now())) then
   return jsonb_build_object('error','ACCOUNT_INACTIVE','status',403); end if;
 if p_action='my' then
   return jsonb_build_object('appeals',coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc)
     from (select id,source,source_id::text "sourceId",status,reason,resolution_reason,created_at,resolved_at
       from authoring.admin_case_appeals where requester_user_id=p_user
       order by created_at desc limit 100) x),'[]'::jsonb));
 end if;
 if p_action='eligible' then
   return jsonb_build_object('cases',coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc)
    from (
      select 'CONTENT_REVIEW' source,cr.id::text "sourceId",cr.work_title_snapshot label,cr.created_at
        from public.content_reviews cr join public.works w on w.id=cr.work_id
        join public.authors au on au.id=w.author_id
        where cr.status::text<>'PENDING' and au.auth_user_id=p_user
      union all
      select 'COMMENT_REPORT',r.id::text,'댓글 신고',r.created_at
        from authoring.comment_reports r join public.comments c on c.id=r.comment_id
        where r.status='REVIEWED' and (r.reporter_user_id=p_user or c.user_id=p_user)
      union all
      select 'REPORT',r.id::text,'신고',r.created_at from public.reports r
        where r.status::text<>'PENDING' and (r.reporter_id=p_user or
          exists(select 1 from public.comments c where r.target_type='COMMENT'
            and c.id::text=r.target_id and c.user_id=p_user))
      union all
      select 'WORK_MODERATION',wa.id::text,'작품 노출 제한',wa.created_at
        from authoring.admin_work_actions wa join authoring.work_state ws on ws.work_id=wa.work_id
        join public.works w on w.id=wa.work_id join public.authors au on au.id=w.author_id
        where wa.action='RESTRICT' and ws.moderation_state='RESTRICTED'
          and au.auth_user_id=p_user and wa.id=(select last.id from authoring.admin_work_actions last
            where last.work_id=wa.work_id and last.action in ('RESTRICT','UNRESTRICT')
            order by last.created_at desc,last.id desc limit 1)
      order by created_at desc limit 100
    ) x where not exists(select 1 from authoring.admin_case_appeals ap
      where ap.source=x.source and ap.source_id::text=x."sourceId"
        and ap.requester_user_id=p_user and ap.status='PENDING')),'[]'::jsonb));
 end if;
 if p_action<>'submit' then return jsonb_build_object('error','INVALID_ACTION','status',400); end if;
 appeal_source:=p_data->>'source';action_reason:=btrim(p_data->>'reason');
 if appeal_source is null or appeal_source not in ('CONTENT_REVIEW','REPORT','COMMENT_REPORT','WORK_MODERATION') then
   return jsonb_build_object('error','INVALID_SOURCE','status',400); end if;
 if action_reason is null or length(action_reason) not between 3 and 500 then
   return jsonb_build_object('error','REASON_REQUIRED','status',400); end if;
 begin appeal_source_id:=(p_data->>'sourceId')::uuid; exception when others then
   return jsonb_build_object('error','INVALID_SOURCE_ID','status',400); end;
 eligible:=case appeal_source
   when 'CONTENT_REVIEW' then exists(select 1 from public.content_reviews cr
     join public.works w on w.id=cr.work_id join public.authors au on au.id=w.author_id
     where cr.id=appeal_source_id and cr.status::text<>'PENDING' and au.auth_user_id=p_user)
   when 'COMMENT_REPORT' then exists(select 1 from authoring.comment_reports r
     join public.comments c on c.id=r.comment_id where r.id=appeal_source_id and r.status='REVIEWED'
       and (r.reporter_user_id=p_user or c.user_id=p_user))
   when 'REPORT' then exists(select 1 from public.reports r where r.id=appeal_source_id
     and r.status::text<>'PENDING' and (r.reporter_id=p_user or exists(select 1
       from public.comments c where r.target_type='COMMENT' and c.id::text=r.target_id
         and c.user_id=p_user)))
   else exists(select 1 from authoring.admin_work_actions wa
     join authoring.work_state ws on ws.work_id=wa.work_id
     join public.works w on w.id=wa.work_id join public.authors au on au.id=w.author_id
     where wa.id=appeal_source_id and wa.action='RESTRICT' and ws.moderation_state='RESTRICTED'
       and au.auth_user_id=p_user and wa.id=(select last.id from authoring.admin_work_actions last
         where last.work_id=wa.work_id and last.action in ('RESTRICT','UNRESTRICT')
         order by last.created_at desc,last.id desc limit 1)) end;
 if not eligible then return jsonb_build_object('error','CASE_NOT_ELIGIBLE','status',403); end if;
 if exists(select 1 from authoring.admin_case_appeals ap where ap.source=appeal_source
   and ap.source_id=appeal_source_id and ap.requester_user_id=p_user and ap.status='PENDING') then
   return jsonb_build_object('error','APPEAL_PENDING','status',409); end if;
 if (select count(*) from authoring.admin_case_appeals ap where ap.source=appeal_source
   and ap.source_id=appeal_source_id and ap.requester_user_id=p_user)>=2 then
   return jsonb_build_object('error','APPEAL_LIMIT','status',409); end if;
 begin
   insert into authoring.admin_case_appeals(source,source_id,requester_user_id,reason)
     values(appeal_source,appeal_source_id,p_user,action_reason);
 exception when unique_violation then
   return jsonb_build_object('error','APPEAL_PENDING','status',409); end;
 return jsonb_build_object('saved',true);
end $$;
revoke all on function public.stage9_appeal(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.stage9_appeal(uuid,text,jsonb) to service_role;
insert into authoring.migrations(version) values('authoring-010') on conflict do nothing;
commit;
