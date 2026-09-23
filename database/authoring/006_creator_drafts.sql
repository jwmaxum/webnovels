-- Reviewed additive deployment only. Client publishing is deliberately not enabled.
begin;
do $$ begin
  if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
    or not exists(select 1 from authoring.migrations where version='authoring-005') then
    raise exception 'Reviewed authoring-005 prerequisite required';
  end if;
end $$;
create table if not exists authoring.draft_save_requests (
  user_id uuid not null references auth.users(id), request_key uuid not null,
  draft_id uuid not null references authoring.drafts(id), payload jsonb not null,
  revision bigint not null, primary key(user_id,request_key),
  foreign key(draft_id,revision) references authoring.draft_revisions(draft_id,revision)
);
alter table authoring.draft_save_requests enable row level security;
revoke all on authoring.draft_save_requests from public,anon,authenticated,service_role;
create or replace function authoring.draft_json(p_id uuid,p_revision bigint) returns jsonb
language sql stable set search_path='' as $$
select jsonb_build_object('id',d.id,'workId',d.work_id::text,'episodeId',d.episode_id::text,
 'revision',r.revision::text,'lifecycle',d.lifecycle,'title',r.title,'content',r.content,'authorComment',r.author_comment)
from authoring.drafts d join authoring.draft_revisions r on r.draft_id=d.id and r.revision=p_revision where d.id=p_id;
$$;
revoke all on function authoring.draft_json(uuid,bigint) from public,anon,authenticated,service_role;
create or replace function public.creator_drafts(p_user_id uuid,p_action text,p_work_id bigint,
 p_id uuid default null,p_data jsonb default '{}',p_key uuid default null,p_before bigint default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.authors; s authoring.work_state; d authoring.drafts; receipt authoring.draft_save_requests;
 expected bigint; rev bigint; items jsonb;
begin
 select * into a from public.authors where auth_user_id=p_user_id for update;
 if not found or a.status::text is distinct from 'APPROVED' then return jsonb_build_object('error','AUTHOR_REQUIRED','status',403); end if;
 if not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null and is_anonymous is not true and (banned_until is null or banned_until<=now()))
 or exists(select 1 from public.readers where auth_user_id=p_user_id and status::text is distinct from 'ACTIVE')
 or exists(select 1 from public.admin_users where auth_user_id=p_user_id and is_active is distinct from true) then
 return jsonb_build_object('error','ACCOUNT_INACTIVE','status',403); end if;
 select ws.* into s from authoring.work_state ws join public.works w on w.id=ws.work_id and w.author_id=ws.author_id
 where ws.work_id=p_work_id and ws.author_id=a.id for update of ws;
 if not found then return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
 if p_action='list' then
   select coalesce(jsonb_agg(x.item),'[]') into items from (
    select jsonb_build_object('id',dd.id,'title',r.title,'lifecycle',dd.lifecycle,'revision',dd.current_revision::text) item
    from authoring.drafts dd join authoring.draft_revisions r on r.draft_id=dd.id and r.revision=dd.current_revision
    where dd.work_id=p_work_id and dd.author_id=a.id order by dd.created_at,dd.id) x;
   return jsonb_build_object('drafts',items);
 end if;
 select * into d from authoring.drafts where id=p_id for update;
 if found and (d.author_id<>a.id or d.work_id<>p_work_id) then return jsonb_build_object('error','DRAFT_NOT_FOUND','status',404); end if;
 if p_action='get' and d.id is not null then return jsonb_build_object('draft',authoring.draft_json(d.id,d.current_revision)); end if;
 if p_action='history' and d.id is not null then
   select coalesce(jsonb_agg(x.item order by x.revision desc),'[]') into items from (
     select r.revision,authoring.draft_json(d.id,r.revision) item from authoring.draft_revisions r
     where r.draft_id=d.id and (p_before=0 or r.revision<p_before) order by r.revision desc limit 20) x;
   return jsonb_build_object('revisions',items);
 end if;
 if p_action<>'save' or p_action is null then return jsonb_build_object('error','DRAFT_NOT_FOUND','status',404); end if;
 if p_id is null or p_key is null or jsonb_typeof(p_data) is distinct from 'object'
 or (p_data - array['expectedRevision','title','content','authorComment'])<>'{}'::jsonb
 or coalesce(p_data->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,18})$'
 or jsonb_typeof(p_data->'title') is distinct from 'string' or length(p_data->>'title')>200
 or jsonb_typeof(p_data->'content') is distinct from 'string' or length(p_data->>'content')>200000
 or jsonb_typeof(p_data->'authorComment') is distinct from 'string' or length(p_data->>'authorComment')>5000 then
 return jsonb_build_object('error','INVALID_FIELD','status',400); end if;
 if (p_data->>'expectedRevision')::numeric>9223372036854775807 then return jsonb_build_object('error','INVALID_FIELD','status',400); end if;
 select * into receipt from authoring.draft_save_requests where user_id=p_user_id and request_key=p_key;
 if found then
   if receipt.draft_id<>p_id or receipt.payload<>p_data then return jsonb_build_object('error','REQUEST_CONFLICT','status',409); end if;
   return jsonb_build_object('draft',authoring.draft_json(p_id,receipt.revision));
 end if;
 if s.trashed_at is not null or s.moderation_state<>'CLEAR' or (d.id is not null and d.lifecycle<>'ACTIVE') then
 return jsonb_build_object('error','DRAFT_READ_ONLY','status',409); end if;
 expected=(p_data->>'expectedRevision')::bigint;
 if (d.id is null and expected<>0) or (d.id is not null and d.current_revision<>expected) then
 return jsonb_build_object('error','DRAFT_CONFLICT','status',409); end if;
 if d.id is null then
   insert into authoring.drafts(id,work_id,author_id) values(p_id,p_work_id,a.id);
   insert into authoring.draft_revisions(draft_id,revision,title,content,author_comment)
     values(p_id,1,p_data->>'title',p_data->>'content',p_data->>'authorComment');
   rev=1;
 else
   rev=authoring.save_draft(p_id,expected,p_data->>'title',p_data->>'content',p_data->>'authorComment');
 end if;
 insert into authoring.draft_save_requests(user_id,request_key,draft_id,payload,revision) values(p_user_id,p_key,p_id,p_data,rev);
 return jsonb_build_object('draft',authoring.draft_json(p_id,rev));
end $$;
revoke all on function public.creator_drafts(uuid,text,bigint,uuid,jsonb,uuid,bigint) from public,anon,authenticated;
grant execute on function public.creator_drafts(uuid,text,bigint,uuid,jsonb,uuid,bigint) to service_role;
insert into authoring.migrations(version) values('authoring-006') on conflict do nothing;
commit;
