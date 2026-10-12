-- Reviewed additive migration: formatted snapshots, never raw author HTML.
begin;
set local lock_timeout='5s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true' or not exists(select 1 from authoring.migrations where version='authoring-015') then raise exception 'Reviewed authoring-015 prerequisite required'; end if;
end $$;
alter table authoring.draft_revisions add column if not exists content_document jsonb;
alter table authoring.publication_versions add column if not exists content_document jsonb;
create or replace function authoring.document_valid(doc jsonb,plain text) returns boolean language plpgsql immutable set search_path='' as $$
declare p jsonb;r jsonb;parts text[]:='{}';part text;count integer:=0;
begin
 if doc is null or jsonb_typeof(doc) is distinct from 'object' or doc-array['version','paragraphs']<>'{}'::jsonb or doc->'version' is distinct from '1'::jsonb or jsonb_typeof(doc->'paragraphs') is distinct from 'array' then return false; end if;
 if jsonb_array_length(doc->'paragraphs') not between 1 and 4096 then return false; end if;
 for p in select value from jsonb_array_elements(doc->'paragraphs') loop
  if jsonb_typeof(p) is distinct from 'object' or p-array['align','indent','runs']<>'{}'::jsonb or coalesce(p->>'align','') not in ('left','center','right','justify') or p->'indent' is null or p->'indent' not in ('0'::jsonb,'1'::jsonb) or jsonb_typeof(p->'runs') is distinct from 'array' then return false;end if;
  if jsonb_array_length(p->'runs')=0 then return false;end if;part:='';
  for r in select value from jsonb_array_elements(p->'runs') loop
   count:=count+1;
   if count>10000 or jsonb_typeof(r) is distinct from 'object' or r-array['text','bold','italic','underline']<>'{}'::jsonb or jsonb_typeof(r->'text') is distinct from 'string' or position(E'\r' in r->>'text')>0 or position(E'\n\n' in r->>'text')>0 then return false;end if;
   if exists(select 1 from jsonb_each(r) x where x.key<>'text' and jsonb_typeof(x.value)<>'boolean') then return false;end if;
   part:=part||(r->>'text');
  end loop;
  if position(E'\n\n' in part)>0 then return false;end if;
  parts:=array_append(parts,part);
 end loop;
 return length(plain)<=200000 and array_to_string(parts,E'\n\n')=plain;
end $$;
revoke all on function authoring.document_valid(jsonb,text) from public,anon,authenticated,service_role;
do $$ begin if not exists(select 1 from pg_constraint where conrelid='authoring.draft_revisions'::regclass and conname='draft_document_valid') then alter table authoring.draft_revisions add constraint draft_document_valid check(content_document is null or authoring.document_valid(content_document,content));end if;end $$;
do $$ begin if not exists(select 1 from pg_constraint where conrelid='authoring.publication_versions'::regclass and conname='publication_document_valid') then alter table authoring.publication_versions add constraint publication_document_valid check(content_document is null or authoring.document_valid(content_document,content));end if;end $$;
create or replace function authoring.copy_publication_document() returns trigger language plpgsql set search_path='' as $$
begin
 select r.content_document into new.content_document from authoring.draft_revisions r where r.draft_id=new.source_draft_id and r.revision=new.source_revision and r.content=new.content;
 return new;
end $$;
drop trigger if exists copy_publication_document on authoring.publication_versions;
create trigger copy_publication_document before insert on authoring.publication_versions for each row execute function authoring.copy_publication_document();
create or replace function authoring.copy_edit_document() returns trigger language plpgsql set search_path='' as $$
begin
 if new.revision=1 and new.content_document is null then
  select v.content_document into new.content_document from authoring.drafts d join authoring.publication_heads h on h.episode_id=d.episode_id join authoring.publication_versions v on v.id=h.version_id where d.id=new.draft_id and v.content=new.content;
 end if;return new;
end $$;
drop trigger if exists copy_edit_document on authoring.draft_revisions;
create trigger copy_edit_document before insert on authoring.draft_revisions for each row execute function authoring.copy_edit_document();
revoke all on function authoring.copy_publication_document(),authoring.copy_edit_document() from public,anon,authenticated,service_role;
create or replace function authoring.draft_json(p_id uuid,p_revision bigint) returns jsonb
language sql stable set search_path='' as $$
select jsonb_build_object('id',d.id,'workId',d.work_id::text,'episodeId',d.episode_id::text,
 'revision',r.revision::text,'lifecycle',d.lifecycle,'title',r.title,'content',r.content,'authorComment',r.author_comment)||case when r.content_document is null then '{}'::jsonb else jsonb_build_object('contentDocument',r.content_document) end||case when r.webtoon is null then '{}'::jsonb else jsonb_build_object('webtoon',r.webtoon) end
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
 or (p_data - array['expectedRevision','title','content','authorComment','webtoon','contentDocument'])<>'{}'::jsonb
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
 if (select content_type from public.works where id=p_work_id)='WEBTOON' then
   if not authoring.webtoon_manifest_valid(p_work_id,p_data->'webtoon') or p_data->>'content'<>'' then return jsonb_build_object('error','INVALID_WEBTOON_MANIFEST','status',400); end if;
 elsif p_data?'webtoon' then return jsonb_build_object('error','INVALID_WEBTOON_MANIFEST','status',400); end if;
 if p_data ? 'contentDocument' and ((select content_type from public.works where id=p_work_id)<>'NOVEL' or not authoring.document_valid(p_data->'contentDocument',p_data->>'content')) then
 return jsonb_build_object('error','INVALID_CONTENT_DOCUMENT','status',400); end if;
 expected=(p_data->>'expectedRevision')::bigint;
 if (d.id is null and expected<>0) or (d.id is not null and d.current_revision<>expected) then
 return jsonb_build_object('error','DRAFT_CONFLICT','status',409); end if;
 if d.id is null then
   insert into authoring.drafts(id,work_id,author_id) values(p_id,p_work_id,a.id);
   insert into authoring.draft_revisions(draft_id,revision,title,content,author_comment,webtoon,content_document)
     values(p_id,1,p_data->>'title',p_data->>'content',p_data->>'authorComment',p_data->'webtoon',p_data->'contentDocument');
   rev=1;
 else
   rev=expected+1;
   insert into authoring.draft_revisions(draft_id,revision,title,content,author_comment,image_urls,webtoon,content_document)
    select p_id,rev,p_data->>'title',p_data->>'content',p_data->>'authorComment',r.image_urls,p_data->'webtoon',p_data->'contentDocument'
    from authoring.draft_revisions r where r.draft_id=p_id and r.revision=expected;
   update authoring.drafts set current_revision=rev,updated_at=now() where id=p_id;
 end if;
 insert into authoring.draft_save_requests(user_id,request_key,draft_id,payload,revision) values(p_user_id,p_key,p_id,p_data,rev);
 return jsonb_build_object('draft',authoring.draft_json(p_id,rev));
end $$;
revoke all on function public.creator_drafts(uuid,text,bigint,uuid,jsonb,uuid,bigint) from public,anon,authenticated;
grant execute on function public.creator_drafts(uuid,text,bigint,uuid,jsonb,uuid,bigint) to service_role;

create or replace function public.stage16_episode_content(p_episode_id bigint)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('episode',ep.item||jsonb_build_object(
  'content',v.content,'contentDocument',v.content_document,'author_comment',v.author_comment,'image_urls',v.image_urls))
  from public.episodes e cross join lateral authoring.stage16_episode_rows(e.work_id,now()) ep
  join authoring.publication_versions v on v.id=(ep.item->>'versionId')::uuid
  where e.id=p_episode_id and ep.episode_id=e.id),jsonb_build_object('error','EPISODE_NOT_FOUND','status',404))
$$;
revoke all on function public.stage16_episode_content(bigint) from public,anon,authenticated;
grant execute on function public.stage16_episode_content(bigint) to service_role;
create or replace function public.stage18_episode_content(p_episode_id bigint)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('episode',ep.item||jsonb_build_object(
  'content',v.content,'contentDocument',v.content_document,'author_comment',v.author_comment,'image_urls',v.image_urls,'contentType',(select content_type from public.works where id=e.work_id),'webtoon',case when v.webtoon is null then null else jsonb_build_object('schemaVersion',1,'credits',v.webtoon->'credits','thumbnailAssetId',v.webtoon->'thumbnailAssetId','panels',authoring.webtoon_panels_json(v.webtoon)) end))
  from public.episodes e cross join lateral authoring.stage18_episode_rows(e.work_id,now()) ep
  join authoring.publication_versions v on v.id=(ep.item->>'versionId')::uuid
  where e.id=p_episode_id and ep.episode_id=e.id),jsonb_build_object('error','EPISODE_NOT_FOUND','status',404))
$$;
revoke all on function public.stage18_episode_content(bigint) from public,anon,authenticated;
grant execute on function public.stage18_episode_content(bigint) to service_role;
insert into authoring.migrations(version) values('authoring-021') on conflict do nothing;
commit;
