begin;
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
 or not exists(select 1 from authoring.migrations where version='authoring-006')
 or not exists(select 1 from authoring.migrations where version='authoring-002') then
 raise exception 'Reviewed authoring-006 and private storage prerequisite required'; end if;
end $$;
alter table authoring.work_state add column if not exists cover_file_id uuid;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='work_cover_file_fk' and conrelid='authoring.work_state'::regclass) then
 alter table authoring.work_state add constraint work_cover_file_fk foreign key(cover_file_id,work_id) references authoring.files(id,work_id) on delete restrict;
 end if;
end $$;
create table if not exists authoring.file_jobs(
 user_id uuid not null references auth.users(id), id uuid not null,
 work_id bigint not null references authoring.work_state(work_id), kind text not null check(kind in ('IMPORT','COVER')),
 payload jsonb not null, file_id uuid not null references authoring.files(id), derivative_id uuid references authoring.files(id),
 state text not null default 'PREPARED' check(state in ('PREPARED','COMMITTED','ABANDONED')),
 result jsonb, created_at timestamptz not null default now(), primary key(user_id,id)
);
alter table authoring.file_jobs enable row level security;
revoke all on authoring.file_jobs from public,anon,authenticated,service_role;
create table if not exists authoring.file_cancellations(user_id uuid not null references auth.users(id),id uuid not null,
 work_id bigint not null references authoring.work_state(work_id),primary key(user_id,id));
alter table authoring.file_cancellations enable row level security;
revoke all on authoring.file_cancellations from public,anon,authenticated,service_role;
-- Inventory only: no physical purge before retention/backup approval. Uncertain PREPARED uploads stay intact.
create or replace view authoring.file_cleanup_candidates as
 select f.id,f.work_id,f.bucket_id,f.object_key,j.created_at
 from authoring.files f join authoring.file_jobs j on f.id=j.file_id or f.id=j.derivative_id
 where j.state='ABANDONED' and not exists(select 1 from authoring.revision_files r where r.file_id=f.id)
 and not exists(select 1 from authoring.work_state s where s.cover_file_id=f.id);
revoke all on authoring.file_cleanup_candidates from public,anon,authenticated;
grant select on authoring.file_cleanup_candidates to service_role;
create or replace function public.creator_files(p_user_id uuid,p_action text,p_work_id bigint default null,
 p_id uuid default null,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.authors; s authoring.work_state; j authoring.file_jobs; f authoring.files; d authoring.files;
 saved_result jsonb; items jsonb; new_id uuid; total bigint;
begin
 -- Public delivery exposes only the currently referenced derivative of a visible work.
 if p_action='public-cover' then
   select af.* into f from authoring.files af join authoring.work_state ws on ws.cover_file_id=af.id
   join public.works w on w.id=ws.work_id
   where af.id=p_id and af.purpose='COVER_DERIVATIVE' and af.trashed_at is null
    and ws.visibility='PUBLIC' and ws.trashed_at is null and ws.moderation_state='CLEAR'
    and w.status::text in ('PUBLISHED','ONGOING','PAUSED','COMPLETED');
   if not found then return jsonb_build_object('error','FILE_NOT_FOUND','status',404); end if;
   return jsonb_build_object('bucket',f.bucket_id,'key',f.object_key);
 end if;
 select * into a from public.authors where auth_user_id=p_user_id for update;
 if not found or a.status::text is distinct from 'APPROVED' then return jsonb_build_object('error','AUTHOR_REQUIRED','status',403); end if;
 if not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null and is_anonymous is not true and (banned_until is null or banned_until<=now()))
 or exists(select 1 from public.readers where auth_user_id=p_user_id and status::text is distinct from 'ACTIVE')
 or exists(select 1 from public.admin_users where auth_user_id=p_user_id and is_active is distinct from true) then return jsonb_build_object('error','ACCOUNT_INACTIVE','status',403);end if;
 select ws.* into s from authoring.work_state ws join public.works w on w.id=ws.work_id and w.author_id=ws.author_id
 where ws.work_id=p_work_id and ws.author_id=a.id for update of ws;
 if not found then return jsonb_build_object('error','WORK_NOT_FOUND','status',404);end if;
 if p_action='list' then
   select coalesce(jsonb_agg(jsonb_build_object('id',fj.id,'kind',fj.kind,'state',fj.state,'fileId',fj.file_id,
    'derivativeId',fj.derivative_id,'filename',fj.payload->>'filename','draftId',fj.result#>>'{draft,id}') order by fj.created_at),'[]') into items
   from authoring.file_jobs fj where fj.work_id=p_work_id and fj.user_id=p_user_id;
   return jsonb_build_object('files',items,'coverFileId',s.cover_file_id);
 end if;
 if p_action='read' then
   select af.* into f from authoring.files af where af.id=p_id and af.work_id=p_work_id and af.author_id=a.id
    and af.trashed_at is null and exists(select 1 from authoring.file_jobs fj where fj.state='COMMITTED' and (fj.file_id=af.id or fj.derivative_id=af.id));
   if not found then return jsonb_build_object('error','FILE_NOT_FOUND','status',404);end if;
   return jsonb_build_object('bucket',f.bucket_id,'key',f.object_key);
 end if;
 if p_action='export' then
   if (select count(*) from public.episodes where work_id=p_work_id)+(select count(*) from authoring.drafts where work_id=p_work_id)>2000 then
     return jsonb_build_object('error','EXPORT_TOO_LARGE','status',400);end if;
   -- Single transaction snapshot: immutable draft revisions and authoritative episode bodies.
   select coalesce(sum(length(r.content)),0) into total from authoring.drafts dd join authoring.draft_revisions r
    on r.draft_id=dd.id and r.revision=dd.current_revision where dd.work_id=p_work_id;
   select total+coalesce(sum(length(c.content)),0) into total from public.episodes e join public.secure_episode_contents c on c.episode_id=e.id where e.work_id=p_work_id;
   if total>5000000 then return jsonb_build_object('error','EXPORT_TOO_LARGE','status',400);end if;
   if exists(select 1 from public.episodes e left join public.secure_episode_contents c on c.episode_id=e.id where e.work_id=p_work_id and c.episode_id is null) then
    return jsonb_build_object('error','EPISODE_BODY_MISSING','status',409);end if;
   select coalesce(jsonb_agg(x.item order by x.group_no,x.number,x.id),'[]') into items from (
     select 0 group_no,e.episode_number::bigint number,e.id::text id,jsonb_build_object('kind','episode','id',e.id::text,'number',e.episode_number,
       'title',e.title,'content',c.content,'authorComment',coalesce(e.author_comment,''),'imageUrls',c.image_urls,'state',e.status::text) item
     from public.episodes e join public.secure_episode_contents c on c.episode_id=e.id where e.work_id=p_work_id
     union all
     select 1,coalesce((select (fj.payload->>'order')::bigint from authoring.file_jobs fj where fj.work_id=p_work_id and fj.kind='IMPORT'
       and fj.payload->>'draftId'=dd.id::text and fj.state='COMMITTED' limit 1),0),dd.id::text,
       authoring.draft_json(dd.id,dd.current_revision)||jsonb_build_object('kind','draft','state',dd.lifecycle,
        'import',(select jsonb_build_object('batchId',fj.payload->>'batchId','order',fj.payload->'order','filename',fj.payload->>'filename')
          from authoring.file_jobs fj where fj.work_id=p_work_id and fj.kind='IMPORT' and fj.payload->>'draftId'=dd.id::text and fj.state='COMMITTED' limit 1))
     from authoring.drafts dd where dd.work_id=p_work_id) x;
   return jsonb_build_object('formatVersion',1,'workId',p_work_id::text,'workTitle',(select title from public.works where id=p_work_id),'items',items);
 end if;
 if s.trashed_at is not null or s.moderation_state<>'CLEAR' then return jsonb_build_object('error','WORK_READ_ONLY','status',409);end if;
 if p_action='authorize' then return jsonb_build_object('version',s.version::text);end if;
 select * into j from authoring.file_jobs where user_id=p_user_id and id=p_id for update;
 if found and j.work_id<>p_work_id then return jsonb_build_object('error','REQUEST_CONFLICT','status',409);end if;
 if p_action='cancel' then
   if j.state='COMMITTED' then return jsonb_build_object('error','ALREADY_COMMITTED','status',409);end if;
   insert into authoring.file_cancellations values(p_user_id,p_id,p_work_id) on conflict do nothing;
   update authoring.file_jobs set state='ABANDONED' where user_id=p_user_id and id=p_id;
   return jsonb_build_object('state','ABANDONED');
 end if;
 if p_action='prepare' then
   if exists(select 1 from authoring.file_cancellations where user_id=p_user_id and id=p_id) then return jsonb_build_object('error','IMPORT_CANCELLED','status',409);end if;
   if p_id is null or p_data->>'kind' not in ('IMPORT','COVER') or p_data->>'kind' is null
    or coalesce(p_data->>'sha256','') !~ '^[a-f0-9]{64}$' or coalesce(p_data->>'size','') !~ '^[1-9][0-9]{0,7}$'
    or (p_data->>'size')::bigint>4194304 then return jsonb_build_object('error','INVALID_FILE','status',400);end if;
   if j.id is not null then
     if j.payload<>p_data then return jsonb_build_object('error','REQUEST_CONFLICT','status',409);end if;
   else
     if p_data->>'kind'='COVER' and (coalesce(p_data->>'derivativeSha','') !~ '^[a-f0-9]{64}$'
       or coalesce(p_data->>'derivativeSize','') !~ '^[1-9][0-9]{0,6}$') then return jsonb_build_object('error','INVALID_FILE','status',400);end if;
     insert into authoring.files(work_id,author_id,bucket_id,object_key,purpose,sha256,byte_size)
      values(p_work_id,a.id,'authoring-originals',p_user_id::text||'/'||p_id::text||'/original',
       case p_data->>'kind' when 'IMPORT' then 'MANUSCRIPT_ORIGINAL' else 'COVER_ORIGINAL' end,p_data->>'sha256',(p_data->>'size')::bigint) returning * into f;
     if p_data->>'kind'='COVER' then
       insert into authoring.files(work_id,author_id,bucket_id,object_key,purpose,sha256,byte_size)
       values(p_work_id,a.id,'authoring-covers',p_user_id::text||'/'||p_id::text||'/cover.jpg','COVER_DERIVATIVE',p_data->>'derivativeSha',(p_data->>'derivativeSize')::bigint) returning * into d;
     end if;
     insert into authoring.file_jobs(user_id,id,work_id,kind,payload,file_id,derivative_id)
      values(p_user_id,p_id,p_work_id,p_data->>'kind',p_data,f.id,d.id) returning * into j;
   end if;
 elsif p_action='commit' and j.id is not null then
   if j.state='ABANDONED' then return jsonb_build_object('error','IMPORT_CANCELLED','status',409);end if;
   if j.state<>'COMMITTED' then
     if j.kind='IMPORT' then
       saved_result=public.creator_drafts(p_user_id,'save',p_work_id,(j.payload->>'draftId')::uuid,
        jsonb_build_object('expectedRevision','0','title',j.payload->>'title','content',j.payload->>'content','authorComment',''),p_id,0);
       if saved_result ? 'error' then return saved_result;end if;
       insert into authoring.revision_files(draft_id,revision,file_id,work_id) values((j.payload->>'draftId')::uuid,1,j.file_id,p_work_id);
     else
       if j.payload->>'version' is distinct from s.version::text then return jsonb_build_object('error','WORK_CONFLICT','status',409);end if;
       update authoring.work_state set cover_file_id=j.derivative_id,version=version+1,updated_at=now() where work_id=p_work_id;
       update public.works set cover_image='/api/v2/creator/files/public-cover/'||j.derivative_id::text where id=p_work_id;
       saved_result=jsonb_build_object('coverFileId',j.derivative_id,'version',(s.version+1)::text);
     end if;
     update authoring.file_jobs set state='COMMITTED',result=saved_result where user_id=p_user_id and id=p_id returning * into j;
   end if;
 elsif p_action='cancel' and j.id is not null then
   -- Never delete an ambiguous upload. Cleanup can inspect ABANDONED jobs after reference checks.
   if j.state='COMMITTED' then return jsonb_build_object('error','ALREADY_COMMITTED','status',409);end if;
   update authoring.file_jobs set state='ABANDONED' where user_id=p_user_id and id=p_id returning * into j;
 else return jsonb_build_object('error','FILE_NOT_FOUND','status',404);end if;
 select * into f from authoring.files where id=j.file_id;
 select * into d from authoring.files where id=j.derivative_id;
 return jsonb_build_object('id',j.id,'state',j.state,'result',j.result,'original',jsonb_build_object('id',f.id,'bucket',f.bucket_id,'key',f.object_key),
  'derivative',case when d.id is null then null else jsonb_build_object('id',d.id,'bucket',d.bucket_id,'key',d.object_key) end);
end $$;
revoke all on function public.creator_files(uuid,text,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.creator_files(uuid,text,bigint,uuid,jsonb) to service_role;
insert into authoring.migrations(version) values('authoring-007') on conflict do nothing;
commit;
