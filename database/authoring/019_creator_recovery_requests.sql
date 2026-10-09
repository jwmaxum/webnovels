-- Reviewed additive migration. A request is evidence for review, never permission to publish.
begin;
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
 or not exists(select 1 from authoring.migrations where version='authoring-007') then
   raise exception 'Reviewed authoring-007 prerequisite required';
 end if;
end $$;
create table if not exists authoring.recovery_requests (
 user_id uuid not null references auth.users(id), request_key uuid not null,
 id uuid not null default gen_random_uuid() unique,
 work_id bigint not null, author_id bigint not null,
 draft_id uuid not null, revision bigint not null, source_revision bigint not null,
 file_id uuid not null, episode_id bigint not null,
 file_sha256 text not null check(file_sha256 ~ '^[a-f0-9]{64}$'), file_size bigint not null,
 target_snapshot jsonb not null, payload jsonb not null, result jsonb not null,
 status text not null default 'PENDING' check(status='PENDING'), created_at timestamptz not null default now(),
 primary key(user_id,request_key), check(source_revision<=revision),
 foreign key(work_id,author_id) references authoring.work_state(work_id,author_id) on delete restrict,
 foreign key(draft_id,work_id) references authoring.drafts(id,work_id) on delete restrict,
 foreign key(draft_id,revision) references authoring.draft_revisions(draft_id,revision) on delete restrict,
 foreign key(draft_id,source_revision,file_id) references authoring.revision_files(draft_id,revision,file_id) on delete restrict,
 foreign key(file_id,work_id) references authoring.files(id,work_id) on delete restrict,
 foreign key(episode_id,work_id) references public.episodes(id,work_id) on delete restrict
);
alter table authoring.recovery_requests enable row level security;
revoke all on authoring.recovery_requests from public,anon,authenticated,service_role;
drop trigger if exists immutable_record on authoring.recovery_requests;
create trigger immutable_record before update or delete on authoring.recovery_requests
 for each row execute function authoring.reject_mutation();

-- Lock existing body/head rows as well as the episode. The digest is an opaque change token,
-- not a source checksum or a rights decision. Keep the exact snapshot private for later review.
create or replace function authoring.recovery_target(p_episode_id bigint) returns jsonb
language plpgsql set search_path='' as $$
declare e jsonb; protected jsonb; head jsonb; alternate jsonb='[]';
begin
 select to_jsonb(x) into e from public.episodes x where id=p_episode_id for share;
 select to_jsonb(x) into protected from public.secure_episode_contents x where episode_id=p_episode_id for share;
 select to_jsonb(x) into head from authoring.publication_heads x where episode_id=p_episode_id for share;
 if to_regclass('public.episode_contents') is not null then
   execute 'select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb)
     from (select * from public.episode_contents where episode_id=$1 for share) x' into alternate using p_episode_id;
 end if;
 return jsonb_build_object('episode',e,'protected',protected,'head',head,'alternate',alternate);
end $$;
revoke all on function authoring.recovery_target(bigint) from public,anon,authenticated,service_role;

create or replace function public.creator_draft_recovery(p_user_id uuid,p_action text,p_work_id bigint,
 p_id uuid,p_data jsonb default '{}',p_key uuid default null,p_after bigint default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.authors; w public.works; s authoring.work_state; d authoring.drafts;
 receipt authoring.recovery_requests; f authoring.files; e public.episodes;
 expected bigint; source_rev bigint; target jsonb; result jsonb; files jsonb; episodes jsonb='[]';
 requests jsonb; more text; item record; request_id uuid;
begin
 select * into a from public.authors where auth_user_id=p_user_id for update;
 if not found or a.status::text is distinct from 'APPROVED' then return jsonb_build_object('error','AUTHOR_REQUIRED','status',403); end if;
 if not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null and is_anonymous is not true and (banned_until is null or banned_until<=now()))
 or exists(select 1 from public.readers where auth_user_id=p_user_id and status::text is distinct from 'ACTIVE')
 or exists(select 1 from public.admin_users where auth_user_id=p_user_id and is_active is distinct from true) then
   return jsonb_build_object('error','ACCOUNT_INACTIVE','status',403);
 end if;
 select * into w from public.works where id=p_work_id and author_id=a.id for update;
 if not found then return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
 select * into s from authoring.work_state where work_id=w.id and author_id=a.id for update;
 select * into d from authoring.drafts where id=p_id and work_id=w.id and author_id=a.id for update;
 if s.work_id is null or d.id is null then return jsonb_build_object('error','DRAFT_NOT_FOUND','status',404); end if;
 if p_action='submit' then
   if p_key is null or jsonb_typeof(p_data) is distinct from 'object'
   or (p_data-array['expectedRevision','episodeId','fileId','targetDigest','note','confirmed'])<>'{}'::jsonb
   or jsonb_typeof(p_data->'expectedRevision') is distinct from 'string' or coalesce(p_data->>'expectedRevision','') !~ '^[1-9][0-9]{0,18}$'
   or jsonb_typeof(p_data->'episodeId') is distinct from 'string' or coalesce(p_data->>'episodeId','') !~ '^[1-9][0-9]{0,18}$'
   or coalesce(p_data->>'fileId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   or coalesce(p_data->>'targetDigest','') !~ '^[a-f0-9]{32}$'
   or jsonb_typeof(p_data->'note') is distinct from 'string' or length(p_data->>'note')>2000
   or p_data->'confirmed' is distinct from 'true'::jsonb then return jsonb_build_object('error','INVALID_FIELD','status',400); end if;
   if (p_data->>'expectedRevision')::numeric>9223372036854775807 or (p_data->>'episodeId')::numeric>9223372036854775807 then
     return jsonb_build_object('error','INVALID_FIELD','status',400); end if;
   select * into receipt from authoring.recovery_requests where user_id=p_user_id and request_key=p_key;
   if found then
     if receipt.work_id<>w.id or receipt.draft_id<>d.id or receipt.payload<>p_data then return jsonb_build_object('error','REQUEST_CONFLICT','status',409); end if;
     return jsonb_build_object('request',receipt.result);
   end if;
 elsif p_action is distinct from 'options' then return jsonb_build_object('error','NOT_FOUND','status',404);
 end if;
 if w.content_type::text is distinct from 'NOVEL' then return jsonb_build_object('error','RECOVERY_NOVEL_REQUIRED','status',409); end if;
 if s.trashed_at is not null or s.moderation_state<>'CLEAR' or d.lifecycle<>'ACTIVE' or d.episode_id is not null then
   return jsonb_build_object('error','RECOVERY_READ_ONLY','status',409); end if;
 if p_action='options' then
   if p_after<0 then return jsonb_build_object('error','INVALID_ID','status',400); end if;
   select coalesce(jsonb_agg(x.item),'[]') into files from (
     select jsonb_build_object('id',ff.id,'sha256',ff.sha256,'size',ff.byte_size::text,'sourceRevision',min(rf.revision)::text,
       'filename',max(j.payload->>'filename')) item
     from authoring.files ff join authoring.revision_files rf on rf.file_id=ff.id and rf.work_id=w.id and rf.draft_id=d.id and rf.revision<=d.current_revision
     join authoring.file_jobs j on j.file_id=ff.id and j.user_id=p_user_id and j.work_id=w.id and j.kind='IMPORT'
       and j.state='COMMITTED' and j.payload->>'draftId'=d.id::text
     where ff.author_id=a.id and ff.work_id=w.id and ff.purpose='MANUSCRIPT_ORIGINAL' and ff.bucket_id='authoring-originals' and ff.trashed_at is null
     group by ff.id order by ff.created_at,ff.id) x;
   for item in select id,episode_number,title from public.episodes where work_id=w.id and id>p_after order by id limit 101 loop
     if jsonb_array_length(episodes)=100 then more=(episodes->99->>'id'); exit; end if;
     target=authoring.recovery_target(item.id);
     episodes=episodes||jsonb_build_array(jsonb_build_object('id',item.id::text,'number',item.episode_number,'title',item.title,'targetDigest',md5(target::text)));
   end loop;
   select coalesce(jsonb_agg(x.result),'[]') into requests from (
     select rr.result from authoring.recovery_requests rr where rr.user_id=p_user_id and rr.draft_id=d.id and rr.work_id=w.id order by rr.created_at desc,rr.id limit 20) x;
   return jsonb_build_object('draft',jsonb_build_object('id',d.id,'workId',w.id::text,'revision',d.current_revision::text),
     'files',files,'episodes',episodes,'nextCursor',more,'requests',requests);
 end if;
 expected=(p_data->>'expectedRevision')::bigint;
 if d.current_revision<>expected then return jsonb_build_object('error','DRAFT_REVISION_CONFLICT','status',409); end if;
 select * into e from public.episodes where id=(p_data->>'episodeId')::bigint and work_id=w.id for update;
 if not found then return jsonb_build_object('error','EPISODE_NOT_FOUND','status',404); end if;
 select * into f from authoring.files where id=(p_data->>'fileId')::uuid and work_id=w.id and author_id=a.id
   and purpose='MANUSCRIPT_ORIGINAL' and bucket_id='authoring-originals' and trashed_at is null for share;
 if not found then return jsonb_build_object('error','SOURCE_FILE_NOT_FOUND','status',404); end if;
 perform 1 from authoring.file_jobs j where j.file_id=f.id and j.user_id=p_user_id and j.work_id=w.id and j.kind='IMPORT'
   and j.state='COMMITTED' and j.payload->>'draftId'=d.id::text for share;
 if not found then return jsonb_build_object('error','SOURCE_FILE_NOT_FOUND','status',404); end if;
 select min(revision) into source_rev from authoring.revision_files where draft_id=d.id and file_id=f.id and work_id=w.id and revision<=expected;
 if source_rev is null then return jsonb_build_object('error','SOURCE_FILE_NOT_FOUND','status',404); end if;
 target=authoring.recovery_target(e.id);
 if md5(target::text)<>p_data->>'targetDigest' then return jsonb_build_object('error','RECOVERY_TARGET_CONFLICT','status',409); end if;
 request_id=gen_random_uuid();
 result=jsonb_build_object('id',request_id,'status','PENDING','workId',w.id::text,'draftId',d.id,'revision',expected::text,
   'sourceRevision',source_rev::text,'fileId',f.id,'fileSha256',f.sha256,'episodeId',e.id::text,'episodeNumber',e.episode_number,'createdAt',now());
 insert into authoring.recovery_requests(user_id,request_key,id,work_id,author_id,draft_id,revision,source_revision,file_id,episode_id,file_sha256,file_size,target_snapshot,payload,result)
   values(p_user_id,p_key,request_id,w.id,a.id,d.id,expected,source_rev,f.id,e.id,f.sha256,f.byte_size,target,p_data,result);
 return jsonb_build_object('request',result);
end $$;
revoke all on function public.creator_draft_recovery(uuid,text,bigint,uuid,jsonb,uuid,bigint) from public,anon,authenticated;
grant execute on function public.creator_draft_recovery(uuid,text,bigint,uuid,jsonb,uuid,bigint) to service_role;
insert into authoring.migrations(version) values('authoring-019') on conflict do nothing;
commit;
