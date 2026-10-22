-- Stage 36: bounded technical telemetry. Seven days is technical retention, not a legal retention policy.
begin;
set local lock_timeout='5s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
 or not exists(select 1 from authoring.migrations where version='authoring-015') then
  raise exception 'Reviewed webtoon/authoring foundation required';
 end if;
end $$;
create table if not exists authoring.beta_operation_minutes(
 minute timestamptz not null, area text not null check(area in ('DRAFT','UPLOAD','PUBLICATION','ONBOARDING','SCHEDULER')),
 requests bigint not null default 0,failures bigint not null default 0,conflicts bigint not null default 0,
 duration_total bigint not null default 0,error_count integer not null default 0 check(error_count between 0 and 100),
 primary key(minute,area)
);
create table if not exists authoring.beta_operation_errors(
 request_id uuid primary key,area text not null check(area in ('DRAFT','UPLOAD','PUBLICATION','ONBOARDING','SCHEDULER')),
 status integer not null check(status=409 or status between 500 and 599),duration_ms integer not null check(duration_ms between 0 and 60000),
 created_at timestamptz not null default now()
);
create index if not exists beta_operation_errors_time on authoring.beta_operation_errors(created_at desc);
create table if not exists authoring.beta_operation_maintenance(
 id boolean primary key default true check(id),heartbeat timestamptz,pruned_at timestamptz
);
insert into authoring.beta_operation_maintenance(id) values(true) on conflict do nothing;
alter table authoring.beta_operation_minutes enable row level security;
alter table authoring.beta_operation_errors enable row level security;
alter table authoring.beta_operation_maintenance enable row level security;
revoke all on authoring.beta_operation_minutes,authoring.beta_operation_errors,authoring.beta_operation_maintenance from public,anon,authenticated,service_role;

create or replace function public.record_beta_operation(p_request uuid,p_area text,p_status integer,p_duration integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare bucket timestamptz:=date_trunc('minute',now()); errors integer;
begin
 if p_request is null or p_area is null or p_area not in ('DRAFT','UPLOAD','PUBLICATION','ONBOARDING','SCHEDULER')
 or p_status is null or not(p_status between 200 and 299 or p_status=409 or p_status between 500 and 599)
 or p_duration is null or p_duration not between 0 and 60000 then return jsonb_build_object('error','INVALID_OBSERVATION','status',400);end if;
 -- Serialize a minute/area so the error sample cap is a hard bound under concurrency.
 insert into authoring.beta_operation_minutes(minute,area) values(bucket,p_area) on conflict do nothing;
 select error_count into errors from authoring.beta_operation_minutes where minute=bucket and area=p_area for update;
 if exists(select 1 from authoring.beta_operation_errors where request_id=p_request) then return jsonb_build_object('recorded',false);end if;
 if p_status>=400 and errors<100 then
  insert into authoring.beta_operation_errors(request_id,area,status,duration_ms) values(p_request,p_area,p_status,p_duration) on conflict do nothing;
  if not found then return jsonb_build_object('recorded',false);end if;
  errors:=errors+1;
 end if;
 update authoring.beta_operation_minutes set requests=requests+1,failures=failures+case when p_status>=500 then 1 else 0 end,
  conflicts=conflicts+case when p_status=409 then 1 else 0 end,duration_total=duration_total+p_duration,error_count=errors
  where minute=bucket and area=p_area;
 return jsonb_build_object('recorded',true);
end $$;

create or replace function public.maintain_beta_operations()
returns jsonb language plpgsql security definer set search_path='' as $$
declare last_prune timestamptz; count_minutes integer:=0; count_errors integer:=0;
begin
 select pruned_at into last_prune from authoring.beta_operation_maintenance where id for update;
 -- Once an hour, with a bounded batch; large backlogs drain over subsequent invocations.
 if last_prune is null or last_prune<now()-interval '1 hour' then
  delete from authoring.beta_operation_errors where request_id in
   (select request_id from authoring.beta_operation_errors where created_at<now()-interval '7 days' order by created_at limit 10000);
  get diagnostics count_errors=row_count;
  delete from authoring.beta_operation_minutes where (minute,area) in
   (select minute,area from authoring.beta_operation_minutes where minute<now()-interval '7 days' order by minute limit 10000);
  get diagnostics count_minutes=row_count;
  update authoring.beta_operation_maintenance set pruned_at=case when count_errors=10000 or count_minutes=10000 then last_prune else now() end where id;
 end if;
 update authoring.beta_operation_maintenance set heartbeat=now() where id;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.beta_operations_dashboard(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare summary jsonb;areas jsonb;errors jsonb;
begin
 if (select count(*) from public.admin_users a join auth.users u on u.id=a.auth_user_id
  where a.auth_user_id=p_user and a.is_active and (a.role='SUPER_ADMIN' or a.permissions ? 'OPERATIONS_READ')
  and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
  and (u.banned_until is null or u.banned_until<=now()) and nullif(to_jsonb(u)->>'deleted_at','') is null)<>1 then
  return jsonb_build_object('error','ADMIN_FORBIDDEN','status',403);end if;
 select jsonb_build_object('observedRequests',coalesce(sum(requests),0),'failures',coalesce(sum(failures),0),
  'conflicts',coalesce(sum(conflicts),0),'averageDurationMs',round(sum(duration_total)::numeric/nullif(sum(requests),0))) into summary
  from authoring.beta_operation_minutes where minute>=date_trunc('minute',now()-interval '24 hours');
 select coalesce(jsonb_agg(jsonb_build_object('area',area,'requests',requests,'failures',failures,'conflicts',conflicts,
  'averageDurationMs',round(duration_total::numeric/nullif(requests,0))) order by area),'[]') into areas from
  (select area,sum(requests) requests,sum(failures) failures,sum(conflicts) conflicts,sum(duration_total) duration_total
   from authoring.beta_operation_minutes where minute>=date_trunc('minute',now()-interval '24 hours') group by area) q;
 select coalesce(jsonb_agg(jsonb_build_object('requestId',request_id,'area',area,'code',case when status=409 then 'CONFLICT' else 'SERVICE_UNAVAILABLE' end,
  'status',status,'durationMs',duration_ms,'createdAt',created_at) order by created_at desc),'[]') into errors
  from (select * from authoring.beta_operation_errors where created_at>=now()-interval '24 hours' order by created_at desc limit 50) q;
 return jsonb_build_object('observedAt',now(),'windowHours',24,'summary',summary,'areas',areas,'recentErrors',errors,
  'queue',jsonb_build_object('pendingSchedules',(select count(*) from authoring.schedules where status in ('PENDING','RUNNING')),
    'failedSchedules',(select count(*) from authoring.schedules where status='FAILED'),
    'failedWebtoonAssets',(select count(*) from authoring.webtoon_assets where state='FAILED')),
  'lastSchedulerHeartbeat',(select heartbeat from authoring.beta_operation_maintenance where id),'retentionDays',7);
end $$;
revoke all on function public.record_beta_operation(uuid,text,integer,integer),public.maintain_beta_operations(),public.beta_operations_dashboard(uuid) from public,anon,authenticated;
grant execute on function public.record_beta_operation(uuid,text,integer,integer),public.maintain_beta_operations(),public.beta_operations_dashboard(uuid) to service_role;
insert into authoring.migrations(version) values('authoring-027') on conflict do nothing;
notify pgrst,'reload schema';
commit;
