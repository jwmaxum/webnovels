-- Add home curation editing without activating publication or changing manuscript data.
begin;
set local lock_timeout='5s';
create table if not exists launch_recovery.work_curation_versions (
 work_id bigint primary key references public.works(id) on delete cascade,
 revision bigint not null default 0 check(revision>=0)
);
create table if not exists launch_recovery.work_curation_audit (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),
 work_id bigint not null,revision bigint not null,reason text not null,
 before_value jsonb not null,after_value jsonb not null,created_at timestamptz not null default now()
);
alter table launch_recovery.work_curation_versions enable row level security;
alter table launch_recovery.work_curation_audit enable row level security;
revoke all on launch_recovery.work_curation_versions,launch_recovery.work_curation_audit from public,anon,authenticated,service_role;
create or replace function launch_recovery.bump_work_curation_revision() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if row(new.is_top_recommended,new.is_popular_work,new.is_new_work) is distinct from row(old.is_top_recommended,old.is_popular_work,old.is_new_work) then
  insert into launch_recovery.work_curation_versions(work_id,revision) values(new.id,1)
   on conflict(work_id) do update set revision=launch_recovery.work_curation_versions.revision+1;
 end if;
 return new;
end $$;
revoke all on function launch_recovery.bump_work_curation_revision() from public,anon,authenticated,service_role;
drop trigger if exists work_curation_revision on public.works;
create trigger work_curation_revision after update of is_top_recommended,is_popular_work,is_new_work on public.works
 for each row execute function launch_recovery.bump_work_curation_revision();
drop trigger if exists work_curation_audit_immutable on launch_recovery.work_curation_audit;
create trigger work_curation_audit_immutable before update or delete on launch_recovery.work_curation_audit
 for each row execute function launch_recovery.account_audit_immutable();

create or replace function public.launch_admin_console(p_user uuid,p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare work_row public.works; work_revision bigint; flags jsonb; before_flags jsonb;
 who jsonb; perms jsonb; allowed boolean; rows jsonb; total bigint; target public.admin_users;
 old_value jsonb; new_value jsonb; expected text; selected jsonb; q text:=coalesce(p_data->>'q','');
 skip integer:=coalesce((p_data->>'offset')::integer,0);
 editable text[]:=array['OPERATIONS_READ','ACCOUNTS_READ','CONTENT_METADATA_READ','CASE_READ','CASE_RESOLVE',
 'CONTENT_REVIEW','COMMENT_REPORT','CONTENT_MODERATE','CURATION_WRITE','AUDIT_READ','ACCOUNT_MODERATE','SETTLEMENTS_READ'];
begin
 who:=public.launch_account_actor(p_user);
 if who ? 'error' then return who; end if;
 if who->'admin' is null or who->'admin'='null'::jsonb then return jsonb_build_object('error','ADMIN_FORBIDDEN','status',403); end if;
 perms:=coalesce(who->'admin'->'permissions','[]'::jsonb);
 allowed:=who->'admin'->>'role'='SUPER_ADMIN' or case p_action
  when 'dashboard' then perms ?| array['OPERATIONS_READ','DASHBOARD']
  when 'works' then perms ?| array['CONTENT_METADATA_READ','WORK_MGMT','CURATION_WRITE']
  when 'curation-update' then perms ? 'CURATION_WRITE'
  when 'episodes' then perms ?| array['CONTENT_METADATA_READ','EPISODE_MGMT']
  when 'accounts' then perms ? 'ACCOUNTS_READ' or (p_data->>'kind'='author' and perms ? 'CREATOR_MGMT') or (p_data->>'kind'='reader' and perms ? 'USER_MGMT')
  when 'cases' then perms ? 'CASE_READ' or (p_data->>'source'='CONTENT_REVIEW' and perms ? 'CONTENT_REVIEW') or (p_data->>'source'='REPORT' and perms ? 'COMMENT_REPORT')
  when 'settlements' then perms ?| array['SETTLEMENTS_READ','AUTHOR_SETTLEMENT']
  when 'audit' then perms ?| array['AUDIT_READ','SECURITY_MGMT'] else false end;
 if allowed is not true then return jsonb_build_object('error','ADMIN_FORBIDDEN','status',403); end if;
 if length(q)>100 or skip<0 or skip>100000 then return jsonb_build_object('error','INVALID_QUERY','status',400); end if;
 if p_action='dashboard' then
  return jsonb_build_object('works',(select count(*) from public.works),'episodes',(select count(*) from public.episodes),
   'authors',(select count(*) from public.authors),'readers',(select count(*) from public.readers),
   'emptyOriginals',(select count(*) from public.episodes where nullif(btrim(content),'') is null),
   'pendingReviews',(select count(*) from public.content_reviews where status='PENDING'),
   'pendingReports',(select count(*) from public.reports where status='PENDING'));
 elsif p_action='works' then
  select count(*) into total from public.works w where position(lower(q) in lower(w.title))>0;
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from (
   select w.id::text id,w.title,w.author_id::text author_id,a.pen_name author,w.status,w.content_type,w.rating,
    w.is_top_recommended,w.is_popular_work,w.is_new_work,
    coalesce((select v.revision from launch_recovery.work_curation_versions v where v.work_id=w.id),0)::text curation_revision,
    (select count(*) from public.episodes e where e.work_id=w.id) episodes,
    (select count(*) from public.episodes e where e.work_id=w.id and nullif(btrim(e.content),'') is null) empty_originals
   from public.works w left join public.authors a on a.id=w.author_id
   where position(lower(q) in lower(w.title))>0 order by w.id limit 100 offset skip) t;
 elsif p_action='curation-update' then
  if jsonb_typeof(p_data) is distinct from 'object' then return jsonb_build_object('error','INVALID_CURATION','status',400); end if;
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('workId','revision','flags','reason')) or
   jsonb_typeof(p_data->'workId') is distinct from 'string' or coalesce(p_data->>'workId','') !~ '^[1-9][0-9]{0,18}$' or
   jsonb_typeof(p_data->'revision') is distinct from 'string' or coalesce(p_data->>'revision','') !~ '^(0|[1-9][0-9]{0,18})$' or
   jsonb_typeof(p_data->'reason') is distinct from 'string' or length(btrim(coalesce(p_data->>'reason',''))) not between 3 and 500 or
   jsonb_typeof(p_data->'flags') is distinct from 'object' then return jsonb_build_object('error','INVALID_CURATION','status',400); end if;
  flags:=p_data->'flags';
  if exists(select 1 from jsonb_object_keys(flags) k where k not in ('is_top_recommended','is_popular_work','is_new_work')) or
   jsonb_typeof(flags->'is_top_recommended') is distinct from 'boolean' or
   jsonb_typeof(flags->'is_popular_work') is distinct from 'boolean' or
   jsonb_typeof(flags->'is_new_work') is distinct from 'boolean' then return jsonb_build_object('error','INVALID_CURATION','status',400); end if;
  select * into work_row from public.works where id::text=p_data->>'workId' for update;
  if not found then return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
  select coalesce((select revision from launch_recovery.work_curation_versions where work_id=work_row.id),0) into work_revision;
  if work_revision::text is distinct from p_data->>'revision' then return jsonb_build_object('error','CONFLICT','status',409); end if;
  before_flags:=jsonb_build_object('is_top_recommended',coalesce(work_row.is_top_recommended,false),
   'is_popular_work',coalesce(work_row.is_popular_work,false),'is_new_work',coalesce(work_row.is_new_work,false));
  if flags is distinct from before_flags then
   update public.works set is_top_recommended=(flags->>'is_top_recommended')::boolean,
    is_popular_work=(flags->>'is_popular_work')::boolean,is_new_work=(flags->>'is_new_work')::boolean where id=work_row.id;
   select revision into work_revision from launch_recovery.work_curation_versions where work_id=work_row.id;
   insert into launch_recovery.work_curation_audit(actor_id,work_id,revision,reason,before_value,after_value)
    values(p_user,work_row.id,work_revision,btrim(p_data->>'reason'),before_flags,flags);
  end if;
  return jsonb_build_object('saved',true,'changed',flags is distinct from before_flags,'work',
   flags||jsonb_build_object('id',work_row.id::text,'curation_revision',work_revision::text));
 elsif p_action='episodes' then
  select count(*) into total from public.episodes e join public.works w on w.id=e.work_id where position(lower(q) in lower(w.title||' '||coalesce(e.title,'')))>0;
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from (
   select e.id::text id,w.title work_title,e.episode_number,e.title,e.status,e.is_free,
    nullif(btrim(e.content),'') is not null has_original
   from public.episodes e join public.works w on w.id=e.work_id
   where position(lower(q) in lower(w.title||' '||coalesce(e.title,'')))>0 order by w.id,e.episode_number,e.id limit 100 offset skip) t;
 elsif p_action='accounts' then
  if p_data->>'kind' not in ('author','reader') or p_data->>'kind' is null then return jsonb_build_object('error','INVALID_KIND','status',400); end if;
  with profiles as (
   select a.id::text id,a.pen_name name,a.status,a.auth_user_id is not null linked from public.authors a where p_data->>'kind'='author'
   union all select r.id::text,r.nickname,r.status,r.auth_user_id is not null from public.readers r where p_data->>'kind'='reader'
  ) select count(*) into total from profiles where position(lower(q) in lower(coalesce(name,'')))>0;
  with profiles as (
   select a.id::text id,a.pen_name name,a.status,a.auth_user_id is not null linked from public.authors a where p_data->>'kind'='author'
   union all select r.id::text,r.nickname,r.status,r.auth_user_id is not null from public.readers r where p_data->>'kind'='reader'
  ) select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from (select * from profiles where position(lower(q) in lower(coalesce(name,'')))>0 order by id::bigint limit 100 offset skip) t;
 elsif p_action='cases' then
  if p_data->>'source' not in ('CONTENT_REVIEW','REPORT') or p_data->>'source' is null then return jsonb_build_object('error','INVALID_CASE_SOURCE','status',400); end if;
  with cases as (
   select id::text id,work_title label,status,created_at from public.content_reviews where p_data->>'source'='CONTENT_REVIEW'
   union all select id::text,target_type||' #'||target_id,status,created_at from public.reports where p_data->>'source'='REPORT'
  ) select count(*) into total from cases;
  with cases as (
   select id::text id,work_title label,status,created_at from public.content_reviews where p_data->>'source'='CONTENT_REVIEW'
   union all select id::text,target_type||' #'||target_id,status,created_at from public.reports where p_data->>'source'='REPORT'
  ) select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from (select * from cases order by created_at desc,id limit 100 offset skip) t;
 elsif p_action='settlements' then
  select count(*) into total from public.author_settlements;
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from (
   select s.id::text id,s.author_id::text author_id,a.pen_name author,s.amount::text recorded_amount,s.status recorded_status,s.requested_at,s.processed_at
   from public.author_settlements s left join public.authors a on a.id=s.author_id order by s.requested_at desc,s.id limit 100 offset skip) t;
 elsif p_action='roles' then
  select count(*) into total from public.admin_users;
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from (
   select x.id::text id,x.nickname,x.role,x.permissions,x.is_active,
    exists(select 1 from launch_recovery.account_links l join auth.users u on u.id=l.auth_user_id
     where l.kind='admin' and l.profile_id=x.id::text and l.auth_user_id=x.auth_user_id and u.email_confirmed_at is not null
     and u.deleted_at is null and not u.is_anonymous and (u.banned_until is null or u.banned_until<=now())) linked,
    md5(jsonb_build_array(x.permissions,x.role,x.is_active,x.auth_user_id,x.updated_at)::text) revision
   from public.admin_users x order by x.created_at,x.id limit 100 offset skip) t;
 elsif p_action='role-update' then
  if jsonb_typeof(p_data)<>'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('adminId','revision','permissions','reason'))
   or jsonb_typeof(p_data->'permissions') is distinct from 'array' or length(btrim(coalesce(p_data->>'reason',''))) not between 3 and 500 then
   return jsonb_build_object('error','INVALID_PERMISSIONS','status',400); end if;
  if jsonb_array_length(p_data->'permissions')>cardinality(editable) or exists(select 1 from jsonb_array_elements_text(p_data->'permissions') x where x is null or not x=any(editable)) then
   return jsonb_build_object('error','INVALID_PERMISSIONS','status',400); end if;
  select * into target from public.admin_users where id::text=p_data->>'adminId' for update;
  if not found then return jsonb_build_object('error','ADMIN_NOT_FOUND','status',404); end if;
  if target.role is distinct from 'SUB_ADMIN' or target.auth_user_id=p_user then return jsonb_build_object('error','PROTECTED_ACCOUNT','status',403); end if;
  expected:=md5(jsonb_build_array(target.permissions,target.role,target.is_active,target.auth_user_id,target.updated_at)::text);
  if expected is distinct from p_data->>'revision' then return jsonb_build_object('error','CONFLICT','status',409); end if;
  old_value:=jsonb_build_object('permissions',target.permissions);
  select coalesce(jsonb_agg(v order by v),'[]') into selected from (
   select jsonb_array_elements_text(p_data->'permissions') v union
   select value from jsonb_array_elements_text(coalesce(target.permissions,'[]'::jsonb)) where not value=any(editable)) preserved;
  update public.admin_users set permissions=selected,updated_at=clock_timestamp() where id=target.id;
  new_value:=jsonb_build_object('permissions',selected);
  insert into launch_recovery.admin_permission_audit(actor_id,target_id,reason,before_value,after_value)
   values(p_user,target.id,btrim(p_data->>'reason'),old_value,new_value);
  return jsonb_build_object('saved',true);
 elsif p_action='audit' then
  select count(*) into total from (select id from launch_recovery.account_audit union all select id from launch_recovery.admin_permission_audit union all select id from launch_recovery.work_curation_audit) a;
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from (
   select id::text id,kind,profile_id target,action,reason,created_at from launch_recovery.account_audit
   union all select id::text,'admin',target_id::text,'role-update',reason,created_at from launch_recovery.admin_permission_audit
   union all select id::text,'work',work_id::text,'curation-update',reason,created_at from launch_recovery.work_curation_audit
   order by created_at desc,id limit 100 offset skip) t;
 else return jsonb_build_object('error','INVALID_ACTION','status',400);
 end if;
 return jsonb_build_object('items',rows,'total',total,'offset',skip,'limit',100);
end $$;
revoke all on function public.launch_admin_console(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.launch_admin_console(uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
