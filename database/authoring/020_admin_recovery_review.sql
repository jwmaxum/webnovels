-- Review dispositions are evidence for a later restore rehearsal, never publication approval.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
 or not exists(select 1 from authoring.migrations where version='authoring-014')
 or not exists(select 1 from authoring.migrations where version='authoring-019') then
  raise exception 'Reviewed authoring-014 and authoring-019 prerequisites required';
 end if;
end $$;
create index if not exists recovery_requests_queue on authoring.recovery_requests(created_at desc,id);
create index if not exists recovery_requests_owner on authoring.recovery_requests(user_id,work_id,draft_id,created_at desc,id);
create table if not exists authoring.recovery_review_events(
 id uuid primary key default gen_random_uuid(),request_id uuid not null references authoring.recovery_requests(id),
 revision bigint not null check(revision>0),actor_user_id uuid not null references auth.users(id),
 disposition text not null check(disposition in ('HOLD','REJECTED','READY_FOR_RESTORE_REVIEW')),
 reason text not null check(length(reason) between 3 and 500),evidence text not null check(length(evidence)<=2000),
 context_digest text not null,checks jsonb not null,created_at timestamptz not null default now(),unique(request_id,revision)
);
create table if not exists authoring.recovery_source_access(
 id uuid primary key default gen_random_uuid(),request_id uuid not null references authoring.recovery_requests(id),
 actor_user_id uuid not null references auth.users(id),kind text not null check(kind in ('manuscript','original')),
 context_digest text not null,created_at timestamptz not null default now()
);
create table if not exists authoring.recovery_review_receipts(
 user_id uuid not null references auth.users(id),request_key uuid not null,action text not null,
 payload jsonb not null,result jsonb not null,primary key(user_id,request_key)
);
do $$ declare t text;begin
 foreach t in array array['recovery_review_events','recovery_source_access','recovery_review_receipts'] loop
  execute format('alter table authoring.%I enable row level security',t);
  execute format('revoke all on authoring.%I from public,anon,authenticated,service_role',t);
  execute format('drop trigger if exists immutable_record on authoring.%I',t);
  execute format('create trigger immutable_record before update or delete on authoring.%I for each row execute function authoring.reject_mutation()',t);
 end loop;
end $$;

-- Lock in the existing author/work/state/draft/target/source order. Current draft edits
-- do not replace the immutable submitted revision. Full target changes require resubmission.
create or replace function authoring.recovery_review_context(r authoring.recovery_requests) returns jsonb
language plpgsql set search_path='' as $$
declare a public.authors;w public.works;s authoring.work_state;d authoring.drafts;f authoring.files;
 target jsonb;jobs jsonb;allowed boolean;token jsonb;
begin
 select * into a from public.authors where id=r.author_id for share;
 select * into w from public.works where id=r.work_id for share;
 select * into s from authoring.work_state where work_id=r.work_id for share;
 select * into d from authoring.drafts where id=r.draft_id for share;
 target=authoring.recovery_target(r.episode_id);
 select * into f from authoring.files where id=r.file_id for share;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into jobs from
  (select id,state,kind,user_id,work_id,file_id,payload from authoring.file_jobs where file_id=r.file_id
    and user_id=r.user_id and work_id=r.work_id and kind='IMPORT' and payload->>'draftId'=r.draft_id::text order by id for share) x;
 allowed=coalesce(a.auth_user_id=r.user_id and a.status::text='APPROVED' and w.author_id=r.author_id
  and w.content_type::text='NOVEL' and s.author_id=r.author_id and s.trashed_at is null and s.moderation_state='CLEAR'
  and d.work_id=r.work_id and d.author_id=r.author_id and d.lifecycle='ACTIVE' and d.episode_id is null
  and f.work_id=r.work_id and f.author_id=r.author_id and f.purpose='MANUSCRIPT_ORIGINAL'
  and f.bucket_id='authoring-originals' and f.trashed_at is null and f.sha256=r.file_sha256 and f.byte_size=r.file_size
  and target=r.target_snapshot
  and exists(select 1 from authoring.revision_files where draft_id=r.draft_id and revision=r.source_revision and file_id=r.file_id and work_id=r.work_id)
  and exists(select 1 from jsonb_array_elements(jobs) j where j->>'state'='COMMITTED')
  and exists(select 1 from auth.users where id=r.user_id and email_confirmed_at is not null and is_anonymous is not true and (banned_until is null or banned_until<=now()))
  and not exists(select 1 from public.readers where auth_user_id=r.user_id and status::text is distinct from 'ACTIVE')
  and not exists(select 1 from public.admin_users where auth_user_id=r.user_id and is_active is distinct from true),false);
 token=jsonb_build_object('allowed',allowed,'author',jsonb_build_array(a.id,a.auth_user_id,a.status),
  'work',jsonb_build_array(w.id,w.author_id,w.content_type),'state',jsonb_build_array(s.author_id,s.trashed_at,s.moderation_state),
  'draft',jsonb_build_array(d.id,d.work_id,d.author_id,d.lifecycle,d.episode_id),'file',to_jsonb(f),'jobs',jobs,'target',target);
 return jsonb_build_object('eligible',allowed,'digest',md5(token::text));
end $$;
revoke all on function authoring.recovery_review_context(authoring.recovery_requests) from public,anon,authenticated,service_role;

create or replace function public.stage29_admin_recovery(p_user uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.admin_users;r authoring.recovery_requests;c jsonb;out jsonb;latest jsonb;history jsonb;
 receipt authoring.recovery_review_receipts;access_id uuid;rev bigint;body authoring.draft_revisions;f authoring.files;
 key uuid;row record;items jsonb='[]';offset_n integer;
begin
 select * into a from public.admin_users where auth_user_id=p_user for share;
 if not found or a.is_active is distinct from true or a.role::text not in ('SUPER_ADMIN','ADMIN','SUB_ADMIN')
 or not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null and is_anonymous is not true and (banned_until is null or banned_until<=now()))
 then return jsonb_build_object('error','ADMIN_REQUIRED','status',403);end if;
 if p_action not in ('recovery-list','recovery-detail','recovery-source','recovery-decide') or p_action is null
 or jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text)>16000 then
  return jsonb_build_object('error','INVALID_FIELD','status',400);end if;
 if p_action in ('recovery-list','recovery-detail') and not (authoring.workflow_can(a,'CASE_READ') or authoring.workflow_can(a,'CONTENT_REVIEW'))
 or p_action='recovery-decide' and not (authoring.workflow_can(a,'CASE_RESOLVE') or authoring.workflow_can(a,'CONTENT_REVIEW'))
 or p_action='recovery-source' and a.role::text<>'SUPER_ADMIN' then return jsonb_build_object('error','PERMISSION_DENIED','status',403);end if;
 if p_action='recovery-list' then
  if (p_data-array['offset'])<>'{}'::jsonb or coalesce(p_data->>'offset','0') !~ '^[0-9]{1,6}$' or coalesce(p_data->>'offset','0')::integer>100000 then
   return jsonb_build_object('error','INVALID_FIELD','status',400);end if;
  offset_n=coalesce(p_data->>'offset','0')::integer;
  for row in select rr.id,rr.result,rr.created_at from authoring.recovery_requests rr order by rr.created_at desc,rr.id offset offset_n limit 51 loop
   if jsonb_array_length(items)=50 then exit;end if;
   select jsonb_build_object('revision',v.revision::text,'status',v.disposition,'reason',v.reason,'createdAt',v.created_at) into latest
    from authoring.recovery_review_events v where request_id=row.id order by revision desc limit 1;
   items=items||jsonb_build_array(row.result||jsonb_build_object('review',coalesce(latest,jsonb_build_object('revision','0','status','PENDING'))));
  end loop;
  return jsonb_build_object('requests',items,'offset',offset_n,'hasMore',exists(select 1 from authoring.recovery_requests offset offset_n+50 limit 1));
 end if;
 if coalesce(p_data->>'recoveryId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  return jsonb_build_object('error','INVALID_FIELD','status',400);end if;
 if p_action='recovery-detail' then
  if (p_data-array['recoveryId'])<>'{}'::jsonb then return jsonb_build_object('error','INVALID_FIELD','status',400);end if;
 else
  if coalesce(p_data->>'requestId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(p_data->'reason') is distinct from 'string' or length(trim(p_data->>'reason'))<3 or length(p_data->>'reason')>500
  or coalesce(p_data->>'contextDigest','') !~ '^[a-f0-9]{32}$' then return jsonb_build_object('error','INVALID_FIELD','status',400);end if;
  if p_action='recovery-source' and ((p_data-array['requestId','reason','recoveryId','contextDigest','kind'])<>'{}'::jsonb or coalesce(p_data->>'kind','') not in ('manuscript','original'))
  then return jsonb_build_object('error','INVALID_FIELD','status',400);end if;
  if p_action='recovery-decide' and ((p_data-array['requestId','reason','recoveryId','contextDigest','revision','decision','evidence','accessId','rightsChecked','ratingChecked','aiChecked'])<>'{}'::jsonb
   or coalesce(p_data->>'revision','') !~ '^(0|[1-9][0-9]{0,18})$' or (p_data->>'revision')::numeric>9223372036854775806
   or coalesce(p_data->>'decision','') not in ('HOLD','REJECTED','READY_FOR_RESTORE_REVIEW')
   or jsonb_typeof(p_data->'evidence') is distinct from 'string' or length(p_data->>'evidence')>2000
   or jsonb_typeof(p_data->'rightsChecked') is distinct from 'boolean' or jsonb_typeof(p_data->'ratingChecked') is distinct from 'boolean' or jsonb_typeof(p_data->'aiChecked') is distinct from 'boolean'
   or (p_data->>'accessId' is not null and p_data->>'accessId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
    return jsonb_build_object('error','INVALID_FIELD','status',400);end if;
  if p_action='recovery-decide' and p_data->>'decision'='READY_FOR_RESTORE_REVIEW' and a.role::text<>'SUPER_ADMIN' then
   return jsonb_build_object('error','PERMISSION_DENIED','status',403);end if;
  key=(p_data->>'requestId')::uuid;perform pg_advisory_xact_lock(hashtextextended(p_user::text||key::text,29));
  select * into receipt from authoring.recovery_review_receipts where user_id=p_user and request_key=key;
  if found then
   if receipt.action<>p_action or receipt.payload<>p_data then return jsonb_build_object('error','REQUEST_CONFLICT','status',409);end if;
   if p_action='recovery-decide' then return receipt.result;end if;
  end if;
 end if;
 select * into r from authoring.recovery_requests where id=(p_data->>'recoveryId')::uuid for update;
 if not found then return jsonb_build_object('error','RECOVERY_NOT_FOUND','status',404);end if;
 c=authoring.recovery_review_context(r);
 select coalesce(max(revision),0) into rev from authoring.recovery_review_events where request_id=r.id;
 if p_action='recovery-detail' then
  select coalesce(jsonb_agg(jsonb_build_object('revision',x.revision::text,'status',x.disposition,'reason',x.reason,'evidence',x.evidence,'createdAt',x.created_at) order by x.revision desc),'[]') into history
   from (select * from authoring.recovery_review_events where request_id=r.id order by revision desc limit 50) x;
  return jsonb_build_object('request',r.result,'note',r.payload->>'note','reviewRevision',rev::text,'contextDigest',c->>'digest','eligible',c->'eligible','history',history);
 end if;
 if c->>'digest'<>p_data->>'contextDigest' then return jsonb_build_object('error','RECOVERY_CONTEXT_CHANGED','status',409);end if;
 if p_action='recovery-source' then
  if c->'eligible'<>'true'::jsonb then return jsonb_build_object('error','RECOVERY_SOURCE_UNAVAILABLE','status',409);end if;
  if receipt.user_id is null then
   access_id=gen_random_uuid();out=jsonb_build_object('accessId',access_id,'requestId',r.id,'kind',p_data->>'kind','revision',r.revision::text,'sourceRevision',r.source_revision::text,'sha256',r.file_sha256);
   insert into authoring.recovery_source_access(id,request_id,actor_user_id,kind,context_digest) values(access_id,r.id,p_user,p_data->>'kind',c->>'digest');
   insert into authoring.workflow_events(actor_user_id,action,target,work_id,reason,detail) values(p_user,p_action,'RECOVERY:'||r.id,r.work_id,p_data->>'reason',out);
   insert into authoring.recovery_review_receipts values(p_user,key,p_action,p_data,out);
  else out=receipt.result;end if;
  if p_data->>'kind'='manuscript' then
   select * into body from authoring.draft_revisions where draft_id=r.draft_id and revision=r.revision;
   return out||jsonb_build_object('title',body.title,'content',body.content,'authorComment',body.author_comment);
  end if;
  select * into f from authoring.files where id=r.file_id;
  return out||jsonb_build_object('file',jsonb_build_object('bucket',f.bucket_id,'key',f.object_key,'sha256',r.file_sha256,'size',r.file_size::text));
 end if;
 if rev::text<>p_data->>'revision' then return jsonb_build_object('error','RECOVERY_REVIEW_CONFLICT','status',409);end if;
 if p_data->>'decision'='READY_FOR_RESTORE_REVIEW' then
  if a.role::text<>'SUPER_ADMIN' then return jsonb_build_object('error','PERMISSION_DENIED','status',403);end if;
  if c->'eligible'<>'true'::jsonb or length(trim(p_data->>'evidence'))<3
  or p_data->'rightsChecked'<>'true'::jsonb or p_data->'ratingChecked'<>'true'::jsonb or p_data->'aiChecked'<>'true'::jsonb
  or not exists(select 1 from authoring.recovery_source_access where id=(p_data->>'accessId')::uuid and request_id=r.id and actor_user_id=p_user and kind='manuscript' and context_digest=c->>'digest')
  or not exists(select 1 from authoring.draft_revisions where draft_id=r.draft_id and revision=r.revision and length(trim(content))>0) then
   return jsonb_build_object('error','RECOVERY_EVIDENCE_REQUIRED','status',409);end if;
 end if;
 out=jsonb_build_object('id',r.id,'revision',(rev+1)::text,'status',p_data->>'decision','reason',p_data->>'reason','createdAt',now());
 insert into authoring.recovery_review_events(request_id,revision,actor_user_id,disposition,reason,evidence,context_digest,checks)
  values(r.id,rev+1,p_user,p_data->>'decision',p_data->>'reason',p_data->>'evidence',c->>'digest',p_data-array['reason','evidence']);
 insert into authoring.workflow_events(actor_user_id,action,target,work_id,reason,detail) values(p_user,p_action,'RECOVERY:'||r.id,r.work_id,p_data->>'reason',out);
 insert into authoring.recovery_review_receipts values(p_user,key,p_action,p_data,out);
 return out;
end $$;
revoke all on function public.stage29_admin_recovery(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.stage29_admin_recovery(uuid,text,jsonb) to service_role;

-- Owner-only feedback is derived separately; the original submission receipt stays immutable.
create or replace function public.creator_recovery_review_status(p_user uuid,p_work bigint,p_draft uuid,p_request uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.authors;items jsonb;
begin
 select * into a from public.authors where auth_user_id=p_user for share;
 if not found or a.status::text<>'APPROVED'
 or not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null and is_anonymous is not true and (banned_until is null or banned_until<=now()))
 or exists(select 1 from public.readers where auth_user_id=p_user and status::text is distinct from 'ACTIVE')
 or exists(select 1 from public.admin_users where auth_user_id=p_user and is_active is distinct from true) then return jsonb_build_object('error','AUTHOR_REQUIRED','status',403);end if;
 if not exists(select 1 from public.works where id=p_work and author_id=a.id)
 or not exists(select 1 from authoring.drafts where id=p_draft and work_id=p_work and author_id=a.id) then return jsonb_build_object('error','DRAFT_NOT_FOUND','status',404);end if;
 select coalesce(jsonb_object_agg(x.id::text,x.review),'{}') into items from
  (select rr.id,(select jsonb_build_object('revision',v.revision::text,'status',v.disposition,'reason',v.reason,'createdAt',v.created_at)
    from authoring.recovery_review_events v where v.request_id=rr.id order by v.revision desc limit 1) review
   from authoring.recovery_requests rr where rr.user_id=p_user and rr.author_id=a.id and rr.work_id=p_work and rr.draft_id=p_draft
    and (p_request is null or rr.id=p_request) order by rr.created_at desc,rr.id limit 20) x;
 return jsonb_build_object('reviews',items);
end $$;
revoke all on function public.creator_recovery_review_status(uuid,bigint,uuid,uuid) from public,anon,authenticated;
grant execute on function public.creator_recovery_review_status(uuid,bigint,uuid,uuid) to service_role;
insert into authoring.migrations(version) values('authoring-020') on conflict do nothing;
commit;
