-- Step 7: reviewed additive migration. Apply after 007 and a verified backup.
begin;
do $$ begin
  if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
    or not exists(select 1 from authoring.migrations where version='authoring-007') then
    raise exception 'Reviewed authoring-007 prerequisite required';
  end if;
  if not exists(select 1 from authoring.migrations where version='authoring-008')
    and exists(select 1 from authoring.schedules where status in ('PENDING','RUNNING')) then
    raise exception 'Reconcile active pre-008 schedules before migration';
  end if;
end $$;

alter table authoring.publish_requests add column if not exists action text;
alter table authoring.publish_requests add column if not exists payload jsonb;
alter table authoring.publish_requests add column if not exists result_schedule_id uuid;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='authoring.publish_requests'::regclass
    and conname='publish_request_schedule_fk') then
    alter table authoring.publish_requests add constraint publish_request_schedule_fk
      foreign key(result_schedule_id) references authoring.schedules(id) on delete restrict;
  end if;
end $$;
alter table authoring.schedules add column if not exists generation integer not null default 1;
alter table authoring.schedules add column if not exists next_attempt_at timestamptz;
create table if not exists authoring.schedule_events(
  id bigint generated always as identity primary key,
  schedule_id uuid not null references authoring.schedules(id) on delete restrict,
  event text not null check(event in ('CREATED','RESCHEDULED','CANCELLED','PUBLISHED','FAILED','RETRY')),
  reason_code text, created_at timestamptz not null default now()
);
create index if not exists authoring_schedule_retry_idx on authoring.schedules(next_attempt_at)
  where status='PENDING';
create unique index if not exists authoring_one_active_episode_edit
  on authoring.drafts(episode_id) where episode_id is not null and lifecycle='ACTIVE';
alter table authoring.schedule_events enable row level security;
revoke all on authoring.schedule_events from public,anon,authenticated;
grant select,insert on authoring.schedule_events to service_role;

create or replace function authoring.protect_request() returns trigger
language plpgsql set search_path='' as $$ begin
  if (new.work_id,new.idempotency_key,new.payload_sha256,new.action,new.payload) is distinct from
     (old.work_id,old.idempotency_key,old.payload_sha256,old.action,old.payload)
    or (old.result_version_id is not null and new.result_version_id is distinct from old.result_version_id)
    or (old.result_schedule_id is not null and new.result_schedule_id is distinct from old.result_schedule_id) then
    raise exception 'Idempotent request identity/result cannot change' using errcode='55000';
  end if;
  return new;
end $$;

create or replace function authoring.publication_json(p_version uuid) returns jsonb
language sql stable set search_path='' as $$
select jsonb_build_object(
  'versionId',v.id,'episodeId',v.episode_id::text,'workId',v.work_id::text,
  'draftId',v.source_draft_id,'revision',v.source_revision::text,
  'episodeNumber',e.episode_number,'title',v.title,
  'accessPolicy',e.access_policy,'isFree',e.is_free,
  'status',case when h.version_id=v.id then 'PUBLISHED'
                when q.status='PENDING' then 'SCHEDULED'
                when q.status='SUCCEEDED' then 'SUPERSEDED'
                when q.status is not null then q.status else 'SUPERSEDED' end,
  'scheduleId',q.id,'generation',q.generation,'dueAt',q.due_at,
  'displayTimezone',q.display_timezone,'lastErrorCode',q.last_error_code,
  'publishedAt',case when h.version_id=v.id then h.published_at else null end
) from authoring.publication_versions v
join public.episodes e on e.id=v.episode_id
left join authoring.publication_heads h on h.episode_id=e.id
left join authoring.schedules q on q.version_id=v.id
where v.id=p_version
$$;
revoke all on function authoring.publication_json(uuid) from public,anon,authenticated,service_role;

create or replace function public.creator_publications(
 p_user_id uuid,p_action text,p_work_id bigint,p_draft_id uuid default null,
 p_episode_id bigint default null,p_data jsonb default '{}',p_key uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.authors; w public.works; s authoring.work_state;
 d authoring.drafts; r authoring.draft_revisions; e public.episodes;
 h authoring.publication_heads; q authoring.schedules; v authoring.publication_versions;
 receipt authoring.publish_requests; result jsonb; next_number integer; due_time timestamptz;
 legacy_content text; legacy_images jsonb;
begin
 select * into a from public.authors where auth_user_id=p_user_id for update;
 if not found or a.status::text is distinct from 'APPROVED' then
   return jsonb_build_object('error','AUTHOR_REQUIRED','status',403); end if;
 if not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null
   and is_anonymous is not true and (banned_until is null or banned_until<=now()))
   or exists(select 1 from public.readers where auth_user_id=p_user_id and status::text is distinct from 'ACTIVE')
   or exists(select 1 from public.admin_users where auth_user_id=p_user_id and is_active is distinct from true) then
   return jsonb_build_object('error','ACCOUNT_INACTIVE','status',403); end if;
 -- Lock order matches creator_works: work, state, then episode/schedule.
 select * into w from public.works where id=p_work_id and author_id=a.id for update;
 if not found then return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
 select * into s from authoring.work_state where work_id=w.id for update;
 if not found then return jsonb_build_object('error','WORK_STATE_MIGRATION_REQUIRED','status',503); end if;
 if (s.visibility='PUBLIC') is distinct from
   (w.status::text in ('PUBLISHED','ONGOING','PAUSED','COMPLETED')) then
   return jsonb_build_object('error','WORK_STATE_MIGRATION_REQUIRED','status',503); end if;
 if p_action='list' then
   select coalesce(jsonb_agg(authoring.publication_json(x.id) order by x.episode_number,x.created_at),'[]')
     into result from (
       select v.id,e.episode_number,v.created_at from authoring.publication_versions v
       join public.episodes e on e.id=v.episode_id where v.work_id=w.id
       order by e.episode_number,v.created_at limit 200
     ) x;
   return jsonb_build_object('publications',result);
 end if;
 if p_action='suggest' then
   select coalesce(max(episode_number),0)+1 into next_number from public.episodes where work_id=w.id;
   return jsonb_build_object('episodeNumber',next_number);
 end if;
 if p_action='begin-edit' then
   if p_episode_id is null or p_draft_id is null or p_key is null then
     return jsonb_build_object('error','INVALID_REQUEST','status',400); end if;
   if s.trashed_at is not null or s.moderation_state<>'CLEAR' then
     return jsonb_build_object('error','WORK_UNAVAILABLE','status',403); end if;
   select * into e from public.episodes where id=p_episode_id and work_id=w.id for update;
   if not found or e.status::text<>'PUBLISHED' or
     (e.scheduled_at is not null and e.scheduled_at>now()) then
     return jsonb_build_object('error','EPISODE_NOT_FOUND','status',404); end if;
   select * into h from authoring.publication_heads where episode_id=e.id;
   if not found then
     select content,image_urls into legacy_content,legacy_images
       from public.secure_episode_contents where episode_id=e.id;
     if legacy_content is null or jsonb_typeof(legacy_images) is distinct from 'array' then
       return jsonb_build_object('error','LEGACY_PUBLICATION_REVIEW_REQUIRED','status',409); end if;
     insert into authoring.publication_versions(episode_id,work_id,title,content,author_comment,image_urls)
       values(e.id,w.id,e.title,legacy_content,coalesce(e.author_comment,''),legacy_images) returning * into v;
     insert into authoring.publication_heads(episode_id,version_id)
       values(e.id,v.id) returning * into h;
   end if;
   select * into d from authoring.drafts where episode_id=e.id and lifecycle='ACTIVE' for update;
   if found then return jsonb_build_object('draft',authoring.draft_json(d.id,d.current_revision)); end if;
   if exists(select 1 from authoring.drafts where id=p_draft_id) then
     return jsonb_build_object('error','DRAFT_ID_CONFLICT','status',409); end if;
   select * into v from authoring.publication_versions where id=h.version_id;
   insert into authoring.drafts(id,work_id,author_id,episode_id)
     values(p_draft_id,w.id,a.id,e.id);
   insert into authoring.draft_revisions(draft_id,revision,title,content,author_comment,image_urls)
     values(p_draft_id,1,v.title,v.content,v.author_comment,v.image_urls);
   return jsonb_build_object('draft',authoring.draft_json(p_draft_id,1));
 end if;
 if p_action in ('reschedule','cancel') then
   if p_episode_id is null or p_data is null or
      coalesce(p_data->>'generation','') !~ '^[1-9][0-9]{0,8}$' then
     return jsonb_build_object('error','INVALID_REQUEST','status',400); end if;
   select * into e from public.episodes where id=p_episode_id and work_id=w.id for update;
   if not found then return jsonb_build_object('error','EPISODE_NOT_FOUND','status',404); end if;
   select * into q from authoring.schedules where episode_id=e.id and status in ('PENDING','RUNNING','FAILED')
     order by updated_at desc limit 1 for update;
   if not found then return jsonb_build_object('error','SCHEDULE_NOT_PENDING','status',409); end if;
   if q.generation<>(p_data->>'generation')::integer or q.status='RUNNING' then
     return jsonb_build_object('error','SCHEDULE_CONFLICT','status',409); end if;
   if p_action='reschedule' then
     if q.status='FAILED' and exists(select 1 from authoring.schedules
       where episode_id=e.id and id<>q.id and status in ('PENDING','RUNNING')) then
       return jsonb_build_object('error','SCHEDULE_CONFLICT','status',409); end if;
     if s.trashed_at is not null or s.moderation_state<>'CLEAR' then
       return jsonb_build_object('error','WORK_UNAVAILABLE','status',403); end if;
     if (p_data-array['generation','dueAt','displayTimezone'])<>'{}'::jsonb
       or coalesce(p_data->>'dueAt','') !~ '^20[0-9]{2}-'
       or coalesce(p_data->>'displayTimezone','') not in ('Asia/Seoul','UTC')
       then return jsonb_build_object('error','INVALID_SCHEDULE','status',400); end if;
     begin due_time=(p_data->>'dueAt')::timestamptz;
       exception when others then return jsonb_build_object('error','INVALID_SCHEDULE','status',400); end;
     if due_time<=now()+interval '2 minutes' or due_time>now()+interval '1 year' then
       return jsonb_build_object('error','INVALID_SCHEDULE','status',400); end if;
     update authoring.schedules set due_at=due_time,display_timezone=p_data->>'displayTimezone',
       status='PENDING',attempts=0,last_error_code=null,
       generation=generation+1,next_attempt_at=null,updated_at=now() where id=q.id;
     if e.status::text<>'PUBLISHED' then
       update public.episodes set scheduled_at=due_time where id=e.id; end if;
     insert into authoring.schedule_events(schedule_id,event) values(q.id,'RESCHEDULED');
   else
     if (p_data-'generation')<>'{}'::jsonb then
       return jsonb_build_object('error','FIELD_NOT_ALLOWED','status',400); end if;
     update authoring.schedules set status='CANCELLED',generation=generation+1,
       updated_at=now() where id=q.id;
     if e.status::text<>'PUBLISHED' then
       update public.episodes set scheduled_at=null where id=e.id;
       update authoring.drafts set lifecycle='ACTIVE',updated_at=now()
         where id=(select source_draft_id from authoring.publication_versions where id=q.version_id)
           and lifecycle='PUBLISHED';
     else
       update authoring.drafts set lifecycle='ACTIVE',updated_at=now()
         where id=(select source_draft_id from authoring.publication_versions where id=q.version_id)
           and lifecycle='PUBLISHED';
     end if;
     insert into authoring.schedule_events(schedule_id,event) values(q.id,'CANCELLED');
   end if;
   return jsonb_build_object('publication',authoring.publication_json(q.version_id));
 end if;
 if p_action<>'publish' or p_key is null or p_draft_id is null or
   jsonb_typeof(p_data) is distinct from 'object' or
   (p_data-array['revision','episodeNumber','mode','dueAt','displayTimezone','rightsConfirmed'])<>'{}'::jsonb
   or coalesce(p_data->>'revision','') !~ '^[1-9][0-9]{0,18}$'
   or coalesce(p_data->>'episodeNumber','') !~ '^[1-9][0-9]{0,8}$'
   or coalesce(p_data->>'mode','') not in ('NOW','SCHEDULED')
   or p_data->'rightsConfirmed' is distinct from 'true'::jsonb then
   return jsonb_build_object('error','INVALID_PUBLICATION','status',400); end if;
 if p_data->>'mode'='SCHEDULED' then
   if coalesce(p_data->>'dueAt','') !~ '^20[0-9]{2}-'
     or coalesce(p_data->>'displayTimezone','') not in ('Asia/Seoul','UTC') then
     return jsonb_build_object('error','INVALID_SCHEDULE','status',400); end if;
   begin due_time=(p_data->>'dueAt')::timestamptz;
     exception when others then return jsonb_build_object('error','INVALID_SCHEDULE','status',400); end;
 end if;
 select * into receipt from authoring.publish_requests
   where work_id=w.id and idempotency_key=p_key for update;
 if found then
   if receipt.action<>'publish' or receipt.payload<>p_data or
     receipt.payload_sha256<>encode(sha256(convert_to(p_data::text,'UTF8')),'hex') or
     (select source_draft_id from authoring.publication_versions where id=receipt.result_version_id) is distinct from p_draft_id then
     return jsonb_build_object('error','REQUEST_CONFLICT','status',409); end if;
   return jsonb_build_object('publication',authoring.publication_json(receipt.result_version_id));
 end if;
 if p_data->>'mode'='SCHEDULED' and
   (due_time<=now()+interval '2 minutes' or due_time>now()+interval '1 year') then
   return jsonb_build_object('error','INVALID_SCHEDULE','status',400); end if;
 if s.trashed_at is not null or s.moderation_state<>'CLEAR' or w.content_type<>'NOVEL' or
   length(btrim(coalesce(w.description,'')))=0 or coalesce(cardinality(w.genre),0)=0 or
   not s.rating_confirmed or not s.ai_confirmed or w.rating not in ('ALL','AGE_15') then
   return jsonb_build_object('error','PUBLICATION_NOT_READY','status',409); end if;
 select * into d from authoring.drafts where id=p_draft_id and work_id=w.id and author_id=a.id for update;
 if not found then return jsonb_build_object('error','DRAFT_NOT_FOUND','status',404); end if;
 if d.lifecycle<>'ACTIVE' or d.current_revision::text<>p_data->>'revision' then
   return jsonb_build_object('error','DRAFT_REVISION_CONFLICT','status',409); end if;
 select * into r from authoring.draft_revisions where draft_id=d.id and revision=d.current_revision;
 if length(btrim(r.title))=0 or length(btrim(r.content))=0 then
   return jsonb_build_object('error','EMPTY_MANUSCRIPT','status',400); end if;
 if d.episode_id is null then
   select coalesce(max(episode_number),0)+1 into next_number from public.episodes where work_id=w.id;
   if next_number::text<>p_data->>'episodeNumber' then
     return jsonb_build_object('error','EPISODE_NUMBER_CONFLICT','status',409); end if;
   insert into public.episodes(work_id,episode_number,title,content,author_comment,image_urls,
     status,access_policy,is_free,is_ad_free,scheduled_at)
     values(w.id,next_number,r.title,case when p_data->>'mode'='NOW' then r.content else '' end,
       r.author_comment,r.image_urls,case when p_data->>'mode'='NOW' then 'PUBLISHED' else 'DRAFT' end,
       'FREE',true,true,null) returning * into e;
   update authoring.drafts set episode_id=e.id where id=d.id;
 else
   select * into e from public.episodes where id=d.episode_id and work_id=w.id for update;
   if not found or e.episode_number::text<>p_data->>'episodeNumber'
     or (e.scheduled_at is not null and e.scheduled_at>now() and e.status::text='PUBLISHED')
     or (e.status::text<>'PUBLISHED' and (e.status::text<>'DRAFT'
       or exists(select 1 from authoring.publication_heads where episode_id=e.id)))
     or (e.status::text='PUBLISHED' and not exists(select 1 from authoring.publication_heads where episode_id=e.id))
     or exists(select 1 from authoring.schedules where episode_id=e.id and status in ('PENDING','RUNNING')) then
     return jsonb_build_object('error','EPISODE_EDIT_CONFLICT','status',409); end if;
 end if;
 insert into authoring.publication_versions(episode_id,work_id,source_draft_id,source_revision,
   title,content,author_comment,image_urls)
   values(e.id,w.id,d.id,r.revision,r.title,r.content,r.author_comment,r.image_urls) returning * into v;
 if p_data->>'mode'='SCHEDULED' then
   insert into authoring.schedules(episode_id,version_id,due_at,display_timezone)
     values(e.id,v.id,due_time,p_data->>'displayTimezone') returning * into q;
   if e.status::text<>'PUBLISHED' then
     update public.episodes set scheduled_at=due_time where id=e.id; end if;
   insert into authoring.schedule_events(schedule_id,event) values(q.id,'CREATED');
 else
   update public.episodes set title=v.title,content=v.content,author_comment=v.author_comment,
     image_urls=v.image_urls,status='PUBLISHED',scheduled_at=null,updated_at=now() where id=e.id;
   insert into authoring.publication_heads(episode_id,version_id) values(e.id,v.id)
     on conflict(episode_id) do update set version_id=excluded.version_id,published_at=now();
   if s.visibility='PRIVATE' then
     update public.works set status=case s.serial_state when 'HIATUS' then 'PAUSED'
       when 'COMPLETED' then 'COMPLETED' else 'PUBLISHED' end,
       published_at=coalesce(published_at,now()) where id=w.id;
     update authoring.work_state set visibility='PUBLIC',version=version+1,updated_at=now() where work_id=w.id;
   end if;
 end if;
 update authoring.drafts set lifecycle='PUBLISHED',updated_at=now() where id=d.id;
 insert into authoring.publish_requests(work_id,idempotency_key,payload_sha256,action,payload,
   result_version_id,result_schedule_id)
   values(w.id,p_key,encode(sha256(convert_to(p_data::text,'UTF8')),'hex'),'publish',p_data,v.id,q.id);
 return jsonb_build_object('publication',authoring.publication_json(v.id));
end $$;
revoke all on function public.creator_publications(uuid,text,bigint,uuid,bigint,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.creator_publications(uuid,text,bigint,uuid,bigint,jsonb,uuid)
  to service_role;

-- One invocation is a single DB transaction. A crash rolls it back, leaving due work pending.
-- Every item locks work -> state -> episode -> schedule, matching author controls.
create or replace function public.run_creator_schedules(p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare candidate record; w public.works; s authoring.work_state; e public.episodes;
 q authoring.schedules; v authoring.publication_versions; completed integer:=0; failed integer:=0;
begin
 if p_limit<1 or p_limit>50 then raise exception 'Invalid scheduler batch'; end if;
 for candidate in
   select q.id,q.episode_id,e.work_id from authoring.schedules q
   join public.episodes e on e.id=q.episode_id
   where q.status='PENDING' and q.due_at<=now()
     and (q.next_attempt_at is null or q.next_attempt_at<=now())
   order by q.due_at,q.id limit p_limit
 loop
   begin
     select * into w from public.works where id=candidate.work_id for update;
     select * into s from authoring.work_state where work_id=w.id for update;
     select * into e from public.episodes where id=candidate.episode_id for update;
     select * into q from authoring.schedules where id=candidate.id for update;
     if q.status<>'PENDING' or q.due_at>now() or
       (q.next_attempt_at is not null and q.next_attempt_at>now()) then continue; end if;
     if s.trashed_at is not null or s.moderation_state<>'CLEAR' or
       w.content_type<>'NOVEL' or w.rating not in ('ALL','AGE_15') or
       length(btrim(coalesce(w.description,'')))=0 or coalesce(cardinality(w.genre),0)=0 or
       not s.rating_confirmed or not s.ai_confirmed or
       not exists(select 1 from public.authors a join auth.users u on u.id=a.auth_user_id
         where a.id=s.author_id and a.status::text='APPROVED'
           and u.email_confirmed_at is not null and u.is_anonymous is not true
           and (u.banned_until is null or u.banned_until<=now())
           and not exists(select 1 from public.readers rd where rd.auth_user_id=u.id and rd.status::text<>'ACTIVE')
           and not exists(select 1 from public.admin_users ad where ad.auth_user_id=u.id and ad.is_active is distinct from true)) or
       (s.visibility='PRIVATE' and w.status::text<>'DRAFT') or
       (s.visibility='PUBLIC' and w.status::text not in ('PUBLISHED','ONGOING','PAUSED','COMPLETED')) then
       update authoring.schedules set status='FAILED',last_error_code='WORK_UNAVAILABLE',
         attempts=attempts+1,updated_at=now() where id=q.id;
       insert into authoring.schedule_events(schedule_id,event,reason_code)
         values(q.id,'FAILED','WORK_UNAVAILABLE');
       failed:=failed+1; continue;
     end if;
     select * into v from authoring.publication_versions where id=q.version_id and episode_id=e.id;
     if not found then raise exception 'Publication version missing'; end if;
     update public.episodes set title=v.title,content=v.content,author_comment=v.author_comment,
       image_urls=v.image_urls,status='PUBLISHED',scheduled_at=null,updated_at=now() where id=e.id;
     insert into authoring.publication_heads(episode_id,version_id) values(e.id,v.id)
       on conflict(episode_id) do update set version_id=excluded.version_id,published_at=now();
     if s.visibility='PRIVATE' then
       update public.works set status=case s.serial_state when 'HIATUS' then 'PAUSED'
         when 'COMPLETED' then 'COMPLETED' else 'PUBLISHED' end,
         published_at=coalesce(published_at,now()) where id=w.id;
       update authoring.work_state set visibility='PUBLIC',version=version+1,updated_at=now() where work_id=w.id;
     end if;
     update authoring.schedules set status='SUCCEEDED',attempts=attempts+1,
       next_attempt_at=null,last_error_code=null,updated_at=now() where id=q.id;
     insert into authoring.schedule_events(schedule_id,event) values(q.id,'PUBLISHED');
     completed:=completed+1;
   exception when others then
     update authoring.schedules set attempts=attempts+1,
       status=case when attempts>=4 then 'FAILED' else 'PENDING' end,
       next_attempt_at=case when attempts>=4 then null else now()+make_interval(mins=>power(2,attempts)::integer) end,
       last_error_code='TRANSITION_FAILED',updated_at=now() where id=candidate.id and status='PENDING';
     insert into authoring.schedule_events(schedule_id,event,reason_code)
       select id,case when status='FAILED' then 'FAILED' else 'RETRY' end,'TRANSITION_FAILED'
       from authoring.schedules where id=candidate.id;
     failed:=failed+1;
   end;
 end loop;
 return jsonb_build_object('published',completed,'failedOrRetrying',failed);
end $$;
revoke all on function public.run_creator_schedules(integer) from public,anon,authenticated;
grant execute on function public.run_creator_schedules(integer) to service_role;
insert into authoring.migrations(version) values('authoring-008') on conflict do nothing;
notify pgrst, 'reload schema';
commit;
