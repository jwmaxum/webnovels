-- Reviewed additive deployment. Does not activate WEBTOON_SERVICE_ENABLED.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
 or not exists(select 1 from authoring.migrations where version='authoring-014') then
  raise exception 'Reviewed authoring-014 prerequisite required'; end if;
 if exists(select 1 from storage.buckets where id in ('authoring-originals','authoring-webtoons') and public) then
  raise exception 'Private webtoon buckets required'; end if;
end $$;
insert into storage.buckets(id,name,public) values('authoring-webtoons','authoring-webtoons',false) on conflict do nothing;
drop policy if exists webtoon_private_deny on storage.objects;
create policy webtoon_private_deny on storage.objects as restrictive for all to anon,authenticated
 using(bucket_id not in ('authoring-originals','authoring-webtoons')) with check(bucket_id not in ('authoring-originals','authoring-webtoons'));

create table if not exists authoring.webtoon_assets(
 id uuid primary key,work_id bigint not null references public.works(id) on delete restrict,
 author_id bigint not null references public.authors(id) on delete restrict,
 name text not null check(length(name) between 1 and 200),sha text not null check(sha ~ '^[a-f0-9]{64}$'),
 bytes integer not null check(bytes between 1 and 8388608),mime text not null check(mime in ('image/jpeg','image/png')),
 width integer not null check(width between 1 and 12000),height integer not null check(height between 1 and 12000),
 part_count integer not null check(part_count between 1 and 3),cursor integer not null default 0,
 state text not null default 'PREPARED' check(state in ('PREPARED','UPLOADED','PROCESSING','FAILED','READY','CANCELLED')),
 lease uuid,lease_until timestamptz,failures integer not null default 0,error text,
 created_at timestamptz not null default now(),check(width::bigint*height<=12000000)
);
create table if not exists authoring.webtoon_panels(
 id uuid primary key default gen_random_uuid(),asset_id uuid not null references authoring.webtoon_assets(id) on delete restrict,
 part integer not null check(part between 0 and 2),width integer not null check(width between 1 and 800),
 height integer not null check(height between 1 and 4096),
 webp_sha text not null check(webp_sha ~ '^[a-f0-9]{64}$'),png_sha text not null check(png_sha ~ '^[a-f0-9]{64}$'),
 unique(asset_id,part)
);
create table if not exists authoring.webtoon_cancellations(
 id uuid primary key,work_id bigint not null references public.works(id) on delete restrict,
 author_id bigint not null references public.authors(id) on delete restrict,created_at timestamptz not null default now()
);
alter table authoring.webtoon_cancellations enable row level security;
revoke all on authoring.webtoon_cancellations from public,anon,authenticated,service_role;
alter table authoring.draft_revisions add column if not exists webtoon jsonb;
alter table authoring.publication_versions add column if not exists webtoon jsonb;
alter table authoring.work_create_requests add column if not exists content_type text not null default 'NOVEL';
create table if not exists authoring.webtoon_revision_assets(
 draft_id uuid not null,revision bigint not null,asset_id uuid not null references authoring.webtoon_assets(id) on delete restrict,
 primary key(draft_id,revision,asset_id),
 foreign key(draft_id,revision) references authoring.draft_revisions(draft_id,revision) on delete restrict
);
alter table authoring.webtoon_assets enable row level security;
alter table authoring.webtoon_panels enable row level security;
alter table authoring.webtoon_revision_assets enable row level security;
revoke all on authoring.webtoon_assets,authoring.webtoon_panels,authoring.webtoon_revision_assets from public,anon,authenticated,service_role;

create or replace function authoring.webtoon_manifest_valid(p_work bigint,m jsonb,p_publish boolean default false)
returns boolean language plpgsql stable set search_path='' as $$
declare n integer; bytes bigint; good integer;
begin
 if m is null or jsonb_typeof(m)<>'object' or (m-array['schemaVersion','assetIds','thumbnailAssetId','credits'])<>'{}'
 or m->'schemaVersion' is distinct from '1'::jsonb or jsonb_typeof(m->'assetIds') is distinct from 'array'
 or jsonb_typeof(m->'credits') is distinct from 'object' then return false; end if;
 n:=jsonb_array_length(m->'assetIds');
 if n>100 or (p_publish and n=0) or ((m->'credits')-array['writer','artist','original'])<>'{}'
 or exists(select 1 from jsonb_each(m->'credits') v where jsonb_typeof(v.value)<>'string' or length(v.value#>>'{}')>100)
 or exists(select 1 from jsonb_array_elements(m->'assetIds') v where jsonb_typeof(v)<>'string' or v#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then return false; end if;
 if (select count(distinct v) from jsonb_array_elements_text(m->'assetIds') v)<>n then return false; end if;
 if (n=0 and m->'thumbnailAssetId' is distinct from 'null'::jsonb)
 or (n>0 and (jsonb_typeof(m->'thumbnailAssetId') is distinct from 'string' or not (m->'assetIds') ? (m->>'thumbnailAssetId'))) then return false; end if;
 select count(*),coalesce(sum(a.bytes),0) into good,bytes from authoring.webtoon_assets a
 where a.id in(select v::uuid from jsonb_array_elements_text(m->'assetIds') v) and a.work_id=p_work and a.state='READY';
 return good=n and bytes<=134217728;
end $$;
revoke all on function authoring.webtoon_manifest_valid(bigint,jsonb,boolean) from public,anon,authenticated,service_role;

create or replace function authoring.webtoon_panels_json(m jsonb) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'assetId',a.id,'width',p.width,'height',p.height) order by ids.ord,p.part),'[]')
 from jsonb_array_elements_text(m->'assetIds') with ordinality ids(id,ord)
 join authoring.webtoon_assets a on a.id=ids.id::uuid and a.state='READY'
 join authoring.webtoon_panels p on p.asset_id=a.id
$$;
revoke all on function authoring.webtoon_panels_json(jsonb) from public,anon,authenticated,service_role;
create or replace function authoring.webtoon_asset_json(p_id uuid) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',a.id,'name',a.name,'state',a.state,'bytes',a.bytes,'width',a.width,'height',a.height,
  'cursor',a.cursor,'partCount',a.part_count,'error',a.error,
  'panels',authoring.webtoon_panels_json(jsonb_build_object('assetIds',jsonb_build_array(a.id))))
 from authoring.webtoon_assets a where a.id=p_id
$$;
revoke all on function authoring.webtoon_asset_json(uuid) from public,anon,authenticated,service_role;

-- Only these service RPCs can mutate the journal. Lock author then work then asset.
create or replace function public.creator_webtoon(p_user uuid,p_action text,p_work bigint,p_id uuid default null,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.authors;w public.works;s authoring.work_state;x authoring.webtoon_assets;lease_id uuid;panel authoring.webtoon_panels;
begin
 select * into a from public.authors where auth_user_id=p_user for update;
 if not found or a.status::text<>'APPROVED' then return jsonb_build_object('error','AUTHOR_REQUIRED','status',403); end if;
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null and is_anonymous is not true and (banned_until is null or banned_until<=now()))
 or exists(select 1 from public.readers where auth_user_id=p_user and status::text<>'ACTIVE')
 or exists(select 1 from public.admin_users where auth_user_id=p_user and is_active is distinct from true) then return jsonb_build_object('error','ACCOUNT_INACTIVE','status',403); end if;
 select * into w from public.works where id=p_work and author_id=a.id for update;
 if not found or w.content_type<>'WEBTOON' then return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
 select * into s from authoring.work_state where work_id=p_work and author_id=a.id for update;
 if not found then return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
 if p_action='list' then return jsonb_build_object('assets',coalesce((select jsonb_agg(authoring.webtoon_asset_json(t.id) order by t.created_at,t.id) from authoring.webtoon_assets t where t.work_id=p_work),'[]')); end if;
 if p_action='authorize' then return jsonb_build_object('authorized',true); end if;
 select * into x from authoring.webtoon_assets where id=p_id for update;
 if found and (x.work_id<>p_work or x.author_id<>a.id) then return jsonb_build_object('error','ASSET_NOT_FOUND','status',404); end if;
 if exists(select 1 from authoring.webtoon_cancellations where id=p_id and (work_id<>p_work or author_id<>a.id)) then return jsonb_build_object('error','ASSET_NOT_FOUND','status',404); end if;
 if exists(select 1 from authoring.webtoon_cancellations where id=p_id) then
  if p_action='cancel' then return jsonb_build_object('asset',jsonb_build_object('id',p_id,'state','CANCELLED')); end if;
  return jsonb_build_object('error','ASSET_CANCELLED','status',409); end if;
 if p_action='cancel' and x.id is null then
  if (select count(*) from authoring.webtoon_cancellations where work_id=p_work)>=512 then return jsonb_build_object('error','WORK_UPLOAD_LIMIT','status',409); end if;
  insert into authoring.webtoon_cancellations(id,work_id,author_id) values(p_id,p_work,a.id);
  return jsonb_build_object('asset',jsonb_build_object('id',p_id,'state','CANCELLED'));
 end if;
 if p_action='prepare' then
  if x.id is not null then
   if x.sha is distinct from p_data->>'sha' or x.name is distinct from p_data->>'name' or x.bytes is distinct from (p_data->>'bytes')::integer
    or x.width is distinct from (p_data->>'width')::integer or x.height is distinct from (p_data->>'height')::integer
    or x.mime is distinct from p_data->>'mime' then return jsonb_build_object('error','REQUEST_CONFLICT','status',409); end if;
  else
   if s.trashed_at is not null or s.moderation_state<>'CLEAR' then return jsonb_build_object('error','WORK_READ_ONLY','status',409); end if;
   if (select count(*)>=512 or coalesce(sum(bytes),0)+(p_data->>'bytes')::bigint>1073741824 from authoring.webtoon_assets where work_id=p_work) then
    return jsonb_build_object('error','WORK_UPLOAD_LIMIT','status',409); end if;
   insert into authoring.webtoon_assets(id,work_id,author_id,name,sha,bytes,mime,width,height,part_count)
    values(p_id,p_work,a.id,p_data->>'name',p_data->>'sha',(p_data->>'bytes')::integer,p_data->>'mime',
     (p_data->>'width')::integer,(p_data->>'height')::integer,
     ceil((p_data->>'height')::numeric / floor(4096::numeric*(p_data->>'width')::integer/least(800,(p_data->>'width')::integer)))::integer)
    returning * into x;
  end if;
 end if;
 if x.id is null then return jsonb_build_object('error','ASSET_NOT_FOUND','status',404); end if;
 if p_action='read-original' then return jsonb_build_object('bucket','authoring-originals','path','webtoon/'||p_work||'/'||x.id||'/source','name',x.name); end if;
 if p_action='read-panel' then
  select * into panel from authoring.webtoon_panels where id=(p_data->>'panelId')::uuid and asset_id=x.id;
  if not found or x.state<>'READY' then return jsonb_build_object('error','PANEL_NOT_FOUND','status',404); end if;
  return jsonb_build_object('bucket','authoring-webtoons','path','webtoon/'||p_work||'/'||x.id||'/'||panel.part||'/'||
   case when p_data->>'format'='webp' then panel.webp_sha||'.webp' else panel.png_sha||'.png' end);
 end if;
 if p_action='get' then return jsonb_build_object('asset',authoring.webtoon_asset_json(x.id)); end if;
 if p_action='cancel' then
  if exists(select 1 from authoring.webtoon_revision_assets where asset_id=x.id) then return jsonb_build_object('error','ASSET_REFERENCED','status',409); end if;
  -- READY assets may belong to a local revision whose response was lost; preserve them too.
  if x.state='READY' then return jsonb_build_object('error','ASSET_READY','status',409); end if;
  update authoring.webtoon_assets set state='CANCELLED',lease=null,lease_until=null where id=x.id;
 elsif x.state='CANCELLED' then return jsonb_build_object('error','ASSET_CANCELLED','status',409);
 elsif p_action='uploaded' and x.state='PREPARED' then
  update authoring.webtoon_assets set state='UPLOADED' where id=x.id;
 elsif p_action='claim' then
  if x.state='READY' then return jsonb_build_object('asset',authoring.webtoon_asset_json(x.id)); end if;
  if s.trashed_at is not null or s.moderation_state<>'CLEAR' then return jsonb_build_object('error','WORK_READ_ONLY','status',409); end if;
  if x.state='PREPARED' then return jsonb_build_object('error','UPLOAD_REQUIRED','status',409); end if;
  if x.failures>=5 then return jsonb_build_object('error','PROCESSING_LIMIT','status',409); end if;
  if x.state='PROCESSING' and x.lease_until>now() then return jsonb_build_object('error','PROCESSING_BUSY','status',409); end if;
  lease_id:=gen_random_uuid();
  update authoring.webtoon_assets set state='PROCESSING',lease=lease_id,lease_until=now()+interval '2 minutes',error=null where id=x.id;
  return jsonb_build_object('asset',authoring.webtoon_asset_json(x.id),'lease',lease_id,'sha',x.sha,'mime',x.mime,
   'source','webtoon/'||p_work||'/'||x.id||'/source');
 elsif p_action in ('part','fail') then
  if x.state<>'PROCESSING' or x.lease is distinct from (p_data->>'lease')::uuid then return jsonb_build_object('error','PROCESSING_STALE','status',409); end if;
  if p_action='fail' then update authoring.webtoon_assets set state='FAILED',failures=failures+1,error='IMAGE_PROCESSING_FAILED',lease=null,lease_until=null where id=x.id;
  else
   if x.cursor is distinct from (p_data->>'part')::integer then return jsonb_build_object('error','PROCESSING_STALE','status',409); end if;
   insert into authoring.webtoon_panels(asset_id,part,width,height,webp_sha,png_sha)
    values(x.id,x.cursor,(p_data->>'width')::integer,(p_data->>'height')::integer,p_data->>'webpSha',p_data->>'pngSha');
   update authoring.webtoon_assets set cursor=cursor+1,state=case when cursor+1=part_count then 'READY' else 'UPLOADED' end,
    lease=null,lease_until=null,error=null where id=x.id;
  end if;
 elsif p_action not in ('prepare','uploaded') then return jsonb_build_object('error','INVALID_ACTION','status',400);
 end if;
 return jsonb_build_object('asset',authoring.webtoon_asset_json(x.id));
end $$;
revoke all on function public.creator_webtoon(uuid,text,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.creator_webtoon(uuid,text,bigint,uuid,jsonb) to service_role;

create or replace function authoring.webtoon_revision_guard() returns trigger
language plpgsql set search_path='' as $$
declare wid bigint;kind text;
begin
 select d.work_id,w.content_type into wid,kind from authoring.drafts d join public.works w on w.id=d.work_id where d.id=new.draft_id;
 if new.webtoon is not null then
  if kind<>'WEBTOON' or not authoring.webtoon_manifest_valid(wid,new.webtoon) then raise exception 'INVALID_WEBTOON_MANIFEST'; end if;
  insert into authoring.webtoon_revision_assets(draft_id,revision,asset_id)
   select new.draft_id,new.revision,v::uuid from jsonb_array_elements_text(new.webtoon->'assetIds') v;
 end if;
 return new;
end $$;
drop trigger if exists webtoon_revision_guard on authoring.draft_revisions;
create trigger webtoon_revision_guard after insert on authoring.draft_revisions for each row execute function authoring.webtoon_revision_guard();
revoke all on function authoring.webtoon_revision_guard() from public,anon,authenticated,service_role;
create or replace function authoring.webtoon_publication_guard() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.source_draft_id is not null then
  select r.webtoon into new.webtoon from authoring.draft_revisions r where r.draft_id=new.source_draft_id and r.revision=new.source_revision;
 end if;
 return new;
end $$;
drop trigger if exists webtoon_publication_guard on authoring.publication_versions;
create trigger webtoon_publication_guard before insert on authoring.publication_versions for each row execute function authoring.webtoon_publication_guard();
revoke all on function authoring.webtoon_publication_guard() from public,anon,authenticated,service_role;
drop trigger if exists immutable_webtoon_panel on authoring.webtoon_panels;
create or replace function authoring.webtoon_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Webtoon evidence is immutable' using errcode='55000'; end $$;
revoke all on function authoring.webtoon_immutable() from public,anon,authenticated,service_role;
create trigger immutable_webtoon_panel before update or delete on authoring.webtoon_panels for each row execute function authoring.webtoon_immutable();

-- Expanded core functions follow. Existing IDs, original URL arrays and revisions are retained.

create or replace function authoring.creator_work_json(p_work_id bigint) returns jsonb
language sql stable set search_path='' as $$
select jsonb_build_object(
  'id',w.id::text,'content_type',w.content_type,'title',w.title,'description',coalesce(w.description,''),'genre',w.genre,'tags',w.tags,
  'rating',w.rating,'ai_usage_type',w.ai_usage_type,'cover_image',w.cover_image,
  'visibility',s.visibility,'serial_state',s.serial_state,'moderation_state',s.moderation_state,
  'moderation_reason',s.moderation_reason,'trashed_at',s.trashed_at,'version',s.version::text,
  'rating_confirmed',s.rating_confirmed,'ai_confirmed',s.ai_confirmed,
  'episode_count',(select count(*) from public.episodes e where e.work_id=w.id),
  'pending_schedule_count',(select count(*) from authoring.schedules q join public.episodes e on e.id=q.episode_id where e.work_id=w.id and q.status in ('PENDING','RUNNING')),
  'publication_missing',to_jsonb(array_remove(array[
    case when length(btrim(coalesce(w.description,'')))=0 then '소개' end,
    case when coalesce(cardinality(w.genre),0)=0 then '장르' end,
    case when not s.rating_confirmed then '이용등급' end,
    case when not s.ai_confirmed then 'AI 사용 표기' end
  ],null))
) from public.works w join authoring.work_state s on s.work_id=w.id where w.id=p_work_id;
$$;
revoke all on function authoring.creator_work_json(bigint) from public,anon,authenticated,service_role;

create or replace function public.creator_works(
  p_user_id uuid, p_action text, p_work_id bigint default null, p_data jsonb default '{}',
  p_key uuid default null, p_filter text default 'all', p_after bigint default 0
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.authors; w public.works; s authoring.work_state; prior authoring.work_create_requests;
  result jsonb; ids bigint[]; new_title text;
begin
  select * into a from public.authors where auth_user_id=p_user_id for update;
  if not found or a.status::text <> 'APPROVED' then return jsonb_build_object('error','AUTHOR_REQUIRED','status',403); end if;
  if not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null and is_anonymous is not true and (banned_until is null or banned_until<=now()))
    or exists(select 1 from public.readers where auth_user_id=p_user_id and status::text is distinct from 'ACTIVE')
    or exists(select 1 from public.admin_users where auth_user_id=p_user_id and is_active is distinct from true) then
    return jsonb_build_object('error','ACCOUNT_INACTIVE','status',403);
  end if;
  if p_action not in ('list','get','create','update','trash','restore') or p_action is null or jsonb_typeof(p_data) is distinct from 'object' then
    return jsonb_build_object('error','INVALID_REQUEST','status',400);
  end if;
  if p_action='list' then
    if exists(select 1 from public.works lw left join authoring.work_state ls on ls.work_id=lw.id where lw.author_id=a.id and ls.work_id is null) then
      return jsonb_build_object('error','WORK_STATE_MIGRATION_REQUIRED','status',503);
    end if;
    if exists(select 1 from public.works lw join authoring.work_state ls on ls.work_id=lw.id where lw.author_id=a.id and
      (ls.visibility='PUBLIC') is distinct from (coalesce(lw.status::text,'') in ('PUBLISHED','ONGOING','PAUSED','COMPLETED'))) then
      return jsonb_build_object('error','WORK_STATE_MIGRATION_REQUIRED','status',503);
    end if;
    if p_filter not in ('all','draft','public','trash') or p_filter is null or p_after<0 then return jsonb_build_object('error','INVALID_FILTER','status',400); end if;
    select array_agg(id order by id) into ids from (
      select lw.id from public.works lw join authoring.work_state ls on ls.work_id=lw.id
      where lw.author_id=a.id and lw.id>p_after and
        case p_filter when 'trash' then ls.trashed_at is not null
          when 'draft' then ls.trashed_at is null and ls.visibility='PRIVATE'
          when 'public' then ls.trashed_at is null and ls.visibility='PUBLIC'
          else ls.trashed_at is null end
      order by lw.id limit 51
    ) page;
    select coalesce(jsonb_agg(authoring.creator_work_json(id) order by id),'[]') into result from unnest(ids[1:50]) id;
    return jsonb_build_object('works',result,'nextCursor',case when cardinality(ids)>50 then ids[50]::text else null end);
  end if;
  if p_action in ('create','update') then
    if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('title','description','genre','tags','rating','ai_usage_type','serial_state','visibility','version','contentType'))
      or (p_action='create' and (p_key is null or (p_data-array['title','contentType'])<>'{}')) then
      return jsonb_build_object('error','FIELD_NOT_ALLOWED','status',400);
    end if;
    if (p_data?'contentType' and (p_action<>'create' or coalesce(p_data->>'contentType','') not in ('NOVEL','WEBTOON'))) or (p_action='create' and not p_data?'title') or (p_data?'title' and (jsonb_typeof(p_data->'title')<>'string' or length(btrim(p_data->>'title')) not between 1 and 200))
      or (p_data?'description' and (jsonb_typeof(p_data->'description')<>'string' or length(p_data->>'description')>5000)) then
      return jsonb_build_object('error','INVALID_FIELD','status',400);
    end if;
    foreach new_title in array array['genre','tags'] loop
      if p_data?new_title then
        if jsonb_typeof(p_data->new_title)<>'array' then return jsonb_build_object('error','INVALID_FIELD','status',400); end if;
        if jsonb_array_length(p_data->new_title)>10 or exists(select 1 from jsonb_array_elements(p_data->new_title) v where jsonb_typeof(v)<>'string' or length(btrim(v#>>'{}')) not between 1 and 30) then
          return jsonb_build_object('error','INVALID_FIELD','status',400);
        end if;
      end if;
    end loop;
    if (p_data?'rating' and coalesce(p_data->>'rating','') not in ('ALL','AGE_15','AGE_19'))
      or (p_data?'ai_usage_type' and coalesce(p_data->>'ai_usage_type','') not in ('NONE','ASSISTED','GENERATED'))
      or (p_data?'serial_state' and coalesce(p_data->>'serial_state','') not in ('ONGOING','HIATUS','COMPLETED'))
      or (p_data?'visibility' and coalesce(p_data->>'visibility','')<>'PRIVATE') then
      return jsonb_build_object('error','INVALID_FIELD','status',400);
    end if;
  end if;
  if p_action='create' then
    new_title:=btrim(p_data->>'title');
    select * into prior from authoring.work_create_requests where user_id=p_user_id and request_key=p_key;
    if found then
      if prior.title<>new_title or prior.content_type<>coalesce(p_data->>'contentType','NOVEL') then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT','status',409); end if;
      return jsonb_build_object('work',authoring.creator_work_json(prior.work_id),'created',false);
    end if;
    -- Literal DRAFT works with both legacy text checks and the normalized enum.
    insert into public.works(author_id,title,author,genre,tags,description,rating,ai_usage_type,status,content_type,is_completed,is_top_recommended,is_popular_work,is_new_work)
      values(a.id,new_title,a.pen_name,'{}','{}','','ALL','NONE','DRAFT',(jsonb_populate_record(null::public.works,jsonb_build_object('content_type',coalesce(p_data->>'contentType','NOVEL')))).content_type,false,false,false,false) returning * into w;
    insert into authoring.work_state(work_id,author_id) values(w.id,a.id);
    insert into authoring.work_create_requests(user_id,request_key,title,work_id,content_type) values(p_user_id,p_key,new_title,w.id,coalesce(p_data->>'contentType','NOVEL'));
    return jsonb_build_object('work',authoring.creator_work_json(w.id),'created',true);
  end if;
  select * into w from public.works where id=p_work_id and author_id=a.id for update;
  if not found then return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
  select * into s from authoring.work_state where work_id=w.id for update;
  if not found then return jsonb_build_object('error','WORK_STATE_MIGRATION_REQUIRED','status',503); end if;
  if (s.visibility='PUBLIC') is distinct from (coalesce(w.status::text,'') in ('PUBLISHED','ONGOING','PAUSED','COMPLETED')) then
    return jsonb_build_object('error','WORK_STATE_MIGRATION_REQUIRED','status',503);
  end if;
  if p_action='get' then
    select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text,'episode_number',e.episode_number,'title',e.title,'status',e.status,'scheduled_at',e.scheduled_at) order by e.episode_number),'[]') into result
      from public.episodes e where work_id=w.id;
    return jsonb_build_object('work',authoring.creator_work_json(w.id),'episodes',result);
  end if;
  if coalesce(p_data->>'version','') !~ '^[1-9][0-9]{0,17}$' then return jsonb_build_object('error','VERSION_REQUIRED','status',400); end if;
  if (p_data->>'version')::bigint<>s.version then return jsonb_build_object('error','WORK_CONFLICT','status',409); end if;
  if p_action in ('trash','restore') and (p_data-'version')<>'{}' then return jsonb_build_object('error','FIELD_NOT_ALLOWED','status',400); end if;
  if p_action='update' and s.trashed_at is not null then return jsonb_build_object('error','WORK_TRASHED','status',409); end if;
  if p_action='restore' and s.trashed_at is null then return jsonb_build_object('work',authoring.creator_work_json(w.id)); end if;
  if p_action='trash' and s.trashed_at is not null then return jsonb_build_object('work',authoring.creator_work_json(w.id)); end if;
  if p_action='update' and s.moderation_state<>'CLEAR' then return jsonb_build_object('error','WORK_RESTRICTED','status',403); end if;
  if p_action='update' and s.visibility='PUBLIC' and p_data?'rating' and p_data->>'rating'<>w.rating then
    return jsonb_build_object('error','RATING_REVIEW_REQUIRED','status',409);
  end if;
  if p_action in ('trash','restore') or p_data?'visibility' then
    perform 1 from authoring.schedules q join public.episodes e on e.id=q.episode_id where e.work_id=w.id for update of q;
    if exists(select 1 from authoring.schedules q join public.episodes e on e.id=q.episode_id where e.work_id=w.id and q.status='RUNNING') then
      return jsonb_build_object('error','SCHEDULE_RUNNING','status',409);
    end if;
    update authoring.schedules q set status='CANCELLED',updated_at=now() from public.episodes e where e.id=q.episode_id and e.work_id=w.id and q.status='PENDING';
    -- Preserve legacy schedule metadata as evidence; never silently reactivate it on restore.
    perform 1 from public.episodes where work_id=w.id for update;
    insert into authoring.cancelled_episode_schedules(work_id,episode_id,previous_status,scheduled_at)
      select work_id,id,status::text,scheduled_at from public.episodes where work_id=w.id and (status::text='SCHEDULED' or (status::text in ('DRAFT','PUBLISHED') and scheduled_at>now()));
    update public.episodes set status='DRAFT',scheduled_at=null where work_id=w.id and (status::text='SCHEDULED' or (status::text in ('DRAFT','PUBLISHED') and scheduled_at>now()));
    update public.works set status='DRAFT' where id=w.id;
    update authoring.work_state set visibility='PRIVATE',trashed_at=case when p_action='trash' then now() else null end where work_id=w.id;
  end if;
  if p_action='update' then
    update public.works set
      title=case when p_data?'title' then btrim(p_data->>'title') else title end,
      description=case when p_data?'description' then p_data->>'description' else description end,
      genre=case when p_data?'genre' then array(select jsonb_array_elements_text(p_data->'genre')) else genre end,
      tags=case when p_data?'tags' then array(select jsonb_array_elements_text(p_data->'tags')) else tags end,
      rating=coalesce(p_data->>'rating',rating),ai_usage_type=coalesce(p_data->>'ai_usage_type',ai_usage_type),
      is_completed=case when p_data?'serial_state' then p_data->>'serial_state'='COMPLETED' else is_completed end
      where id=w.id;
    update authoring.work_state set serial_state=coalesce(p_data->>'serial_state',serial_state),
      rating_confirmed=rating_confirmed or p_data?'rating',ai_confirmed=ai_confirmed or p_data?'ai_usage_type' where work_id=w.id;
    if s.visibility='PUBLIC' and not p_data?'visibility' and p_data?'serial_state' then
      if p_data->>'serial_state'='HIATUS' then update public.works set status='PAUSED' where id=w.id;
      elsif p_data->>'serial_state'='COMPLETED' then update public.works set status='COMPLETED' where id=w.id;
      else update public.works set status='PUBLISHED' where id=w.id; end if;
    end if;
  end if;
  update authoring.work_state set version=version+1,updated_at=now() where work_id=w.id;
  return jsonb_build_object('work',authoring.creator_work_json(w.id));
end $$;
revoke all on function public.creator_works(uuid,text,bigint,jsonb,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.creator_works(uuid,text,bigint,jsonb,uuid,text,bigint) to service_role;

create or replace function authoring.draft_json(p_id uuid,p_revision bigint) returns jsonb
language sql stable set search_path='' as $$
select jsonb_build_object('id',d.id,'workId',d.work_id::text,'episodeId',d.episode_id::text,
 'revision',r.revision::text,'lifecycle',d.lifecycle,'title',r.title,'content',r.content,'authorComment',r.author_comment)||case when r.webtoon is null then '{}'::jsonb else jsonb_build_object('webtoon',r.webtoon) end
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
 or (p_data - array['expectedRevision','title','content','authorComment','webtoon'])<>'{}'::jsonb
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
 expected=(p_data->>'expectedRevision')::bigint;
 if (d.id is null and expected<>0) or (d.id is not null and d.current_revision<>expected) then
 return jsonb_build_object('error','DRAFT_CONFLICT','status',409); end if;
 if d.id is null then
   insert into authoring.drafts(id,work_id,author_id) values(p_id,p_work_id,a.id);
   insert into authoring.draft_revisions(draft_id,revision,title,content,author_comment,webtoon)
     values(p_id,1,p_data->>'title',p_data->>'content',p_data->>'authorComment',p_data->'webtoon');
   rev=1;
 else
   rev=expected+1;
   insert into authoring.draft_revisions(draft_id,revision,title,content,author_comment,image_urls,webtoon)
    select p_id,rev,p_data->>'title',p_data->>'content',p_data->>'authorComment',r.image_urls,p_data->'webtoon'
    from authoring.draft_revisions r where r.draft_id=p_id and r.revision=expected;
   update authoring.drafts set current_revision=rev,updated_at=now() where id=p_id;
 end if;
 insert into authoring.draft_save_requests(user_id,request_key,draft_id,payload,revision) values(p_user_id,p_key,p_id,p_data,rev);
 return jsonb_build_object('draft',authoring.draft_json(p_id,rev));
end $$;
revoke all on function public.creator_drafts(uuid,text,bigint,uuid,jsonb,uuid,bigint) from public,anon,authenticated;
grant execute on function public.creator_drafts(uuid,text,bigint,uuid,jsonb,uuid,bigint) to service_role;

create or replace function public.creator_publications_v18(
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
     if w.content_type='WEBTOON' then return jsonb_build_object('error','LEGACY_WEBTOON_REVIEW_REQUIRED','status',409); end if;
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
   if w.content_type='WEBTOON' and v.webtoon is null then return jsonb_build_object('error','LEGACY_WEBTOON_REVIEW_REQUIRED','status',409); end if;
   insert into authoring.drafts(id,work_id,author_id,episode_id)
     values(p_draft_id,w.id,a.id,e.id);
   insert into authoring.draft_revisions(draft_id,revision,title,content,author_comment,image_urls,webtoon)
     values(p_draft_id,1,v.title,v.content,v.author_comment,v.image_urls,v.webtoon);
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
 if s.trashed_at is not null or s.moderation_state<>'CLEAR' or w.content_type not in ('NOVEL','WEBTOON') or
   length(btrim(coalesce(w.description,'')))=0 or coalesce(cardinality(w.genre),0)=0 or
   not s.rating_confirmed or not s.ai_confirmed or w.rating not in ('ALL','AGE_15') then
   return jsonb_build_object('error','PUBLICATION_NOT_READY','status',409); end if;
 select * into d from authoring.drafts where id=p_draft_id and work_id=w.id and author_id=a.id for update;
 if not found then return jsonb_build_object('error','DRAFT_NOT_FOUND','status',404); end if;
 if d.lifecycle<>'ACTIVE' or d.current_revision::text<>p_data->>'revision' then
   return jsonb_build_object('error','DRAFT_REVISION_CONFLICT','status',409); end if;
 select * into r from authoring.draft_revisions where draft_id=d.id and revision=d.current_revision;
 if length(btrim(r.title))=0 or (w.content_type='NOVEL' and length(btrim(r.content))=0) or (w.content_type='WEBTOON' and not authoring.webtoon_manifest_valid(w.id,r.webtoon,true)) then
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
revoke all on function public.creator_publications_v18(uuid,text,bigint,uuid,bigint,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.creator_publications_v18(uuid,text,bigint,uuid,bigint,jsonb,uuid)
  to service_role;

-- One invocation is a single DB transaction. A crash rolls it back, leaving due work pending.
-- Every item locks work -> state -> episode -> schedule, matching author controls.
create or replace function public.run_creator_schedules_v18(p_limit integer default 20)
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
       w.content_type not in ('NOVEL','WEBTOON') or w.rating not in ('ALL','AGE_15') or
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
     if w.content_type='WEBTOON' and not authoring.webtoon_manifest_valid(w.id,v.webtoon,true) then raise exception 'Webtoon manifest missing'; end if;
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
revoke all on function public.run_creator_schedules_v18(integer) from public,anon,authenticated;
grant execute on function public.run_creator_schedules_v18(integer) to service_role;

-- Flag-off scheduler leaves webtoon reservations pending.
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
   where q.status='PENDING' and q.due_at<=now() and exists(select 1 from public.works cw where cw.id=e.work_id and cw.content_type<>'WEBTOON')
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

alter table authoring.reader_progress add column if not exists position_kind text not null default 'PARAGRAPH' check(position_kind in ('PARAGRAPH','PANEL'));
create or replace function authoring.stage18_work_visible(p_work bigint)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.works w where w.id=p_work and authoring.stage8_visible(w.id)
  and w.content_type in ('NOVEL','WEBTOON') and w.rating::text in ('ALL','AGE_15')
  and not exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(to_jsonb(w.genre))='array'
   then to_jsonb(w.genre) else jsonb_build_array(w.genre) end) g where g in ('성인','19세 이상')))
$$;
revoke all on function authoring.stage18_work_visible(bigint) from public,anon,authenticated,service_role;

-- Keep the established discover tag aliases while accepting literal tags from author metadata.
create or replace function authoring.stage18_tag(p_tag text)
returns text language sql immutable set search_path='' as $$
 select coalesce('{"회귀":"regression","회귀물":"regression","빙의":"possession","빙의물":"possession",
  "환생":"reincarnation","환생물":"reincarnation","착각계":"misunderstanding","사이다":"catharsis",
  "아카데미":"academy","전문직":"professional","시스템":"system","게임":"game","게임빙의":"game",
  "헌터":"hunter","던전":"dungeon","성장":"growth","생존":"survival","정치":"politics","전쟁":"war",
  "로맨스":"romance","로맨스판타지":"romance-fantasy","로판":"romance-fantasy","무협":"martial-arts",
  "현대판타지":"modern-fantasy","현판":"modern-fantasy","힐링":"healing","미스터리":"mystery",
  "공포":"horror","sf":"sf","일상":"slice-of-life","코미디":"comedy","복수":"revenge","육아":"family",
  "요리":"chef","스포츠":"sports","의학":"medical","경영":"business","대체역사":"historical"}'::jsonb
  ->>lower(btrim(p_tag)),lower(btrim(p_tag)))
$$;
revoke all on function authoring.stage18_tag(text) from public,anon,authenticated,service_role;

create or replace function authoring.stage18_episode_rows(p_work bigint,p_asof timestamptz)
returns table(episode_id bigint,episode_number integer,item jsonb)
language sql stable set search_path='' as $$
 select e.id,e.episode_number,jsonb_build_object(
  'id',e.id::text,'work_id',e.work_id::text,'episode_number',e.episode_number,'title',v.title,
  'status',e.status::text,'view_count',e.view_count,'is_free',e.is_free,'is_ad_free',e.is_ad_free,
  'access_policy',e.access_policy,'scheduled_at',e.scheduled_at,'published_at',h.published_at,'versionId',h.version_id)
 from public.episodes e join authoring.publication_heads h on h.episode_id=e.id
 join authoring.publication_versions v on v.id=h.version_id and v.episode_id=e.id and v.work_id=e.work_id
 where e.work_id=p_work and authoring.stage18_work_visible(e.work_id) and authoring.stage8_visible(e.work_id,e.id)
  and e.is_free=true and e.access_policy='FREE' and h.published_at<=p_asof
  and ((select content_type from public.works where id=e.work_id)='NOVEL' or authoring.webtoon_manifest_valid(e.work_id,v.webtoon,true))
$$;
revoke all on function authoring.stage18_episode_rows(bigint,timestamptz) from public,anon,authenticated,service_role;

create or replace function authoring.stage18_work_rows(p_asof timestamptz)
returns table(work_id bigint,item jsonb,episode_count bigint,first_published_at timestamptz,
 last_published_at timestamptz,ranking_readers bigint)
language sql stable set search_path='' as $$
 select w.id,jsonb_build_object(
  'id',w.id::text,'title',w.title,'author',w.author,'author_id',w.author_id::text,'genre',w.genre,'tags',w.tags,
  'description',w.description,'cover_image',w.cover_image,'view_count',w.view_count,'like_count',w.like_count,
  'created_at',w.created_at,'status',w.status::text,'content_type',w.content_type,'is_completed',w.is_completed,
  'is_top_recommended',w.is_top_recommended,'is_popular_work',w.is_popular_work,'is_new_work',w.is_new_work,
  'rating',w.rating,'ai_usage_type',w.ai_usage_type,'published_at',w.published_at,
  'episode_count',eps.n,'first_published_at',coalesce(w.published_at,eps.first_at),
  'last_published_at',eps.last_at,'ranking_readers',case when ranking.n>=5 then ranking.n else null end,
  'firstEpisodeNumber',eps.first_number,
  'distribution',case when d.mode='NON_EXCLUSIVE' and eps.n>0 then
    jsonb_build_object('mode','NON_EXCLUSIVE','externalLinks',d.external_links) else null end),
  eps.n,coalesce(w.published_at,eps.first_at),eps.last_at,case when ranking.n>=5 then ranking.n else null end
 from public.works w
 left join authoring.work_distribution d on d.work_id=w.id
 cross join lateral(select count(*) n,min((ep.item->>'published_at')::timestamptz) first_at,
  max((ep.item->>'published_at')::timestamptz) last_at,min(ep.episode_number) first_number
  from authoring.stage18_episode_rows(w.id,p_asof) ep) eps
 cross join lateral(select count(distinct ev.user_id) n from authoring.reader_events_v2 ev
  join public.readers r on r.auth_user_id=ev.user_id and r.status::text='ACTIVE'
  join auth.users u on u.id=ev.user_id and u.email_confirmed_at is not null and u.is_anonymous is not true
   and (u.banned_until is null or u.banned_until<=p_asof)
  where ev.work_id=w.id and ev.created_at>p_asof-interval '7 days' and ev.created_at<=p_asof
   and ev.event_type in ('OPEN','COMPLETE')
   and not exists(select 1 from public.authors a where a.id=w.author_id and a.auth_user_id=ev.user_id)) ranking
 where authoring.stage18_work_visible(w.id) and (w.published_at is null or w.published_at<=p_asof)
$$;
revoke all on function authoring.stage18_work_rows(timestamptz) from public,anon,authenticated,service_role;

create or replace function public.stage18_catalog(p_action text,p_query jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_asof timestamptz:=now(); v_limit integer:=24; v_work bigint; v_episode integer;
 v_cursor jsonb; v_key numeric; v_id bigint; v_sort text; v_pattern text; rows jsonb; selected jsonb;
 ranking jsonb; result jsonb; v_item jsonb; next_cursor jsonb;
begin
 if p_action not in ('home','list','work','episodes','chapter') or p_query is null
  or jsonb_typeof(p_query)<>'object' or length(p_query::text)>10000
  or exists(select 1 from jsonb_object_keys(p_query) k where k not in
   ('workId','episodeNumber','q','genre','status','epRange','rating','tags','sort','type','limit','cursor','asOf')) then
  return jsonb_build_object('error','INVALID_QUERY','status',400); end if;
 if p_query ? 'asOf' then
  begin v_asof:=(p_query->>'asOf')::timestamptz; exception when others then
   return jsonb_build_object('error','INVALID_CURSOR','status',400); end;
  if not isfinite(v_asof) or v_asof>now()+interval '1 minute' then
   return jsonb_build_object('error','INVALID_CURSOR','status',400); end if;
 end if;
 if p_query ? 'limit' then
  if jsonb_typeof(p_query->'limit')<>'number' or (p_query->>'limit') !~ '^[1-9][0-9]?$'
   or (p_query->>'limit')::integer>50 then return jsonb_build_object('error','INVALID_LIMIT','status',400); end if;
  v_limit:=(p_query->>'limit')::integer;
 end if;
 if p_action in ('work','episodes','chapter') then
  if coalesce(p_query->>'workId','') !~ '^[1-9][0-9]{0,18}$' then
   return jsonb_build_object('error','INVALID_WORK_ID','status',400); end if;
  begin v_work:=(p_query->>'workId')::bigint; exception when numeric_value_out_of_range then
   return jsonb_build_object('error','INVALID_WORK_ID','status',400); end;
  if not authoring.stage18_work_visible(v_work) then return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
 end if;
 if p_query ? 'cursor' then
  v_cursor:=p_query->'cursor';
  if p_action not in ('list','episodes') or jsonb_typeof(v_cursor)<>'object'
   or (select count(*) from jsonb_object_keys(v_cursor))<>2
   or coalesce(v_cursor->>'key','') !~ '^-?[0-9]{1,20}(\.[0-9]{1,6})?$'
   or coalesce(v_cursor->>'id','') !~ '^[1-9][0-9]{0,18}$' or not (p_query ? 'asOf') then
   return jsonb_build_object('error','INVALID_CURSOR','status',400); end if;
  begin v_key:=(v_cursor->>'key')::numeric;v_id:=(v_cursor->>'id')::bigint; exception when others then
   return jsonb_build_object('error','INVALID_CURSOR','status',400); end;
 end if;
 ranking:=jsonb_build_object('periodDays',7,'minSample',5,'asOf',v_asof,'metric','uniqueReaders');
 if p_action='home' then
  with catalog as materialized(select * from authoring.stage18_work_rows(v_asof))
  select jsonb_build_object('sections',jsonb_build_object(
   'recommended',coalesce((select jsonb_agg(x.item) from (select item from catalog
    where item->>'is_top_recommended'='true' order by last_published_at desc nulls last,work_id desc limit 8) x),'[]'::jsonb),
   'popular',coalesce((select jsonb_agg(x.item) from (select item from catalog where ranking_readers>=5
    order by ranking_readers desc,work_id desc limit 8) x),'[]'::jsonb),
   'new',coalesce((select jsonb_agg(x.item) from (select item from catalog
    order by first_published_at desc nulls last,work_id desc limit 8) x),'[]'::jsonb),
   'webtoons',coalesce((select jsonb_agg(x.item) from (select item from catalog where item->>'content_type'='WEBTOON' order by last_published_at desc nulls last,work_id desc limit 8) x),'[]'::jsonb),
   'completed',coalesce((select jsonb_agg(x.item) from (select item from catalog
    where item->>'status'='COMPLETED' or item->>'is_completed'='true'
    order by last_published_at desc nulls last,work_id desc limit 8) x),'[]'::jsonb)), 'ranking',ranking) into result;
  return result;
 end if;
 if p_action='work' then
  select item into v_item from authoring.stage18_work_rows(v_asof) where work_id=v_work;
  if v_item is null then return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
  return jsonb_build_object('work',v_item);
 end if;
 if p_action='chapter' then
  if jsonb_typeof(p_query->'episodeNumber')<>'number' or coalesce(p_query->>'episodeNumber','') !~ '^[1-9][0-9]{0,9}$' then
   return jsonb_build_object('error','INVALID_EPISODE_NUMBER','status',400); end if;
  begin v_episode:=(p_query->>'episodeNumber')::integer; exception when numeric_value_out_of_range then
   return jsonb_build_object('error','INVALID_EPISODE_NUMBER','status',400); end;
  select item into v_item from authoring.stage18_episode_rows(v_work,v_asof) where episode_number=v_episode;
  if v_item is null then return jsonb_build_object('error','EPISODE_NOT_FOUND','status',404); end if;
  return jsonb_build_object('episode',v_item,
   'previous',(select item from authoring.stage18_episode_rows(v_work,v_asof) where episode_number<v_episode
    order by episode_number desc,episode_id desc limit 1),
   'next',(select item from authoring.stage18_episode_rows(v_work,v_asof) where episode_number>v_episode
    order by episode_number,episode_id limit 1));
 end if;
 if p_action='episodes' then
  select coalesce(jsonb_agg(x.item||jsonb_build_object('_key',x.episode_number::text,'_id',x.episode_id::text)
    order by x.episode_number,x.episode_id),'[]'::jsonb) into rows
   from(select * from authoring.stage18_episode_rows(v_work,v_asof)
    where v_id is null or (episode_number::numeric,episode_id)>(v_key,v_id)
    order by episode_number,episode_id limit v_limit+1) x;
 else
  v_sort:=coalesce(p_query->>'sort','latest');
  if v_sort not in ('latest','new','popular','episodes') or coalesce(p_query->>'type','NOVEL') not in ('NOVEL','WEBTOON')
   or coalesce(p_query->>'status','ALL') not in ('ALL','ONGOING','COMPLETED')
   or coalesce(p_query->>'epRange','ALL') not in ('ALL','1-25','26-100','101+')
   or coalesce(p_query->>'rating','ALL') not in ('ALL','ALL_AGES','AGE_15','AGE_19')
   or length(coalesce(p_query->>'q',''))>100 or length(coalesce(p_query->>'genre',''))>40
   or jsonb_typeof(coalesce(p_query->'tags','[]'))<>'array' or jsonb_array_length(coalesce(p_query->'tags','[]'))>10
   or exists(select 1 from jsonb_array_elements(coalesce(p_query->'tags','[]')) tag
     where jsonb_typeof(tag)<>'string' or length(tag#>>'{}') not between 1 and 40) then
   return jsonb_build_object('error','INVALID_QUERY','status',400); end if;
  -- Escape SQL wildcards so a reader's literal % or _ is not an unbounded pattern.
  v_pattern:='%'||replace(replace(replace(coalesce(p_query->>'q',''),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  with catalog as materialized(select c.*,case v_sort
    when 'latest' then coalesce(extract(epoch from c.last_published_at),0)
    when 'new' then coalesce(extract(epoch from c.first_published_at),0)
    when 'popular' then c.ranking_readers::numeric else c.episode_count::numeric end sort_key
   from authoring.stage18_work_rows(v_asof) c), filtered as(
   select * from catalog c where c.item->>'content_type'=coalesce(p_query->>'type','NOVEL')
    and (coalesce(p_query->>'q','')='' or c.item->>'title' ilike v_pattern escape E'\\'
     or c.item->>'author' ilike v_pattern escape E'\\' or c.item->>'description' ilike v_pattern escape E'\\')
    and (coalesce(p_query->>'genre','ALL') in ('ALL','전체') or exists(select 1 from
     jsonb_array_elements_text(case when jsonb_typeof(c.item->'genre')='array' then c.item->'genre'
      else jsonb_build_array(c.item->'genre') end) g where g=p_query->>'genre'))
    and (coalesce(p_query->>'status','ALL')='ALL' or
      (p_query->>'status'='COMPLETED' and (c.item->>'status'='COMPLETED' or c.item->>'is_completed'='true')) or
      (p_query->>'status'='ONGOING' and c.item->>'status'<>'COMPLETED' and c.item->>'is_completed'<>'true'))
    and (coalesce(p_query->>'rating','ALL')='ALL' or (p_query->>'rating'='ALL_AGES' and c.item->>'rating'='ALL')
     or c.item->>'rating'=p_query->>'rating')
    and (coalesce(p_query->>'epRange','ALL')='ALL' or (p_query->>'epRange'='1-25' and c.episode_count between 1 and 25)
     or (p_query->>'epRange'='26-100' and c.episode_count between 26 and 100)
     or (p_query->>'epRange'='101+' and c.episode_count>=101))
    and not exists(select 1 from jsonb_array_elements_text(coalesce(p_query->'tags','[]')) wanted where
     not exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(c.item->'tags')='array' then c.item->'tags'
      else to_jsonb(string_to_array(coalesce(c.item->>'tags',''),',')) end) actual
      where authoring.stage18_tag(actual)=authoring.stage18_tag(wanted)))
    and (v_sort<>'popular' or c.ranking_readers>=5)
    and (v_id is null or (c.sort_key,c.work_id)<(v_key,v_id)))
  select coalesce(jsonb_agg(x.item||jsonb_build_object('_key',x.sort_key::text,'_id',x.work_id::text)
    order by x.sort_key desc,x.work_id desc),'[]'::jsonb) into rows
   from(select * from filtered order by sort_key desc,work_id desc limit v_limit+1) x;
 end if;
 select coalesce(jsonb_agg(value-'_key'-'_id' order by ord),'[]'::jsonb) into selected
  from jsonb_array_elements(rows) with ordinality x(value,ord) where ord<=v_limit;
 if jsonb_array_length(rows)>v_limit then
  next_cursor:=jsonb_build_object('key',rows->(v_limit-1)->>'_key','id',rows->(v_limit-1)->>'_id');
 end if;
 return jsonb_build_object(case when p_action='list' then 'works' else 'episodes' end,selected,
  'nextCursor',next_cursor,'asOf',v_asof)||case when p_action='list' then jsonb_build_object('ranking',ranking) else '{}'::jsonb end;
end $$;
revoke all on function public.stage18_catalog(text,jsonb) from public,anon,authenticated;
grant execute on function public.stage18_catalog(text,jsonb) to service_role;

create or replace function public.stage18_episode_content(p_episode_id bigint)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('episode',ep.item||jsonb_build_object(
  'content',v.content,'author_comment',v.author_comment,'image_urls',v.image_urls,'contentType',(select content_type from public.works where id=e.work_id),'webtoon',case when v.webtoon is null then null else jsonb_build_object('schemaVersion',1,'credits',v.webtoon->'credits','thumbnailAssetId',v.webtoon->'thumbnailAssetId','panels',authoring.webtoon_panels_json(v.webtoon)) end))
  from public.episodes e cross join lateral authoring.stage18_episode_rows(e.work_id,now()) ep
  join authoring.publication_versions v on v.id=(ep.item->>'versionId')::uuid
  where e.id=p_episode_id and ep.episode_id=e.id),jsonb_build_object('error','EPISODE_NOT_FOUND','status',404))
$$;
revoke all on function public.stage18_episode_content(bigint) from public,anon,authenticated;
grant execute on function public.stage18_episode_content(bigint) to service_role;

create or replace function public.stage18_reader(p_user uuid,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; position jsonb; v_work bigint; v_episode bigint; w public.works; e public.episodes;
 h authoring.publication_heads; v authoring.publication_versions; idx integer; part_count integer; v_offset numeric; index_key text;
begin
 if p_action not in ('activity','progress') or p_data is null or jsonb_typeof(p_data)<>'object' then
  return jsonb_build_object('error','INVALID_ACTION','status',400); end if;
 if p_action='activity' then
  if p_data<>'{}'::jsonb then return jsonb_build_object('error','INVALID_QUERY','status',400); end if;
  result:=public.stage8_reader(p_user,'activity','{}');
  if result ? 'error' then return result; end if;
  return result||jsonb_build_object('readingHistory',coalesce((select jsonb_agg(x.item order by x.last_read_at desc) from(
   select q.last_read_at,jsonb_build_object('workId',q.work_id::text,'episodeId',q.episode_id::text,
    'episodeNumber',ep.episode_number,'progress',q.progress,'last_read_at',q.last_read_at,
    'position',case when q.position_version_id=current_head.version_id then jsonb_build_object(
     'versionId',q.position_version_id,case when q.position_kind='PANEL' then 'panelIndex' else 'paragraphIndex' end,q.position_paragraph,'offset',q.position_offset) else null end,
    'positionChanged',q.position_version_id is not null and q.position_version_id is distinct from current_head.version_id) item
   from authoring.reader_progress q join public.episodes ep on ep.id=q.episode_id
   join authoring.publication_heads current_head on current_head.episode_id=q.episode_id
   where q.user_id=p_user and authoring.stage18_work_visible(q.work_id)
    and authoring.stage8_visible(q.work_id,q.episode_id) and ep.is_free=true and ep.access_policy='FREE'
   order by q.last_read_at desc limit 100) x),'[]'::jsonb));
 end if;
 if not exists(select 1 from public.readers r join auth.users u on u.id=r.auth_user_id
  where u.id=p_user and r.status::text='ACTIVE' and u.email_confirmed_at is not null
   and u.is_anonymous is not true and (u.banned_until is null or u.banned_until<=now())) then
  return jsonb_build_object('error','READER_REQUIRED','status',403); end if;
 if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('workId','episodeId','progress','position'))
  or coalesce(p_data->>'workId','') !~ '^[1-9][0-9]{0,18}$'
  or coalesce(p_data->>'episodeId','') !~ '^[1-9][0-9]{0,18}$' then
  return jsonb_build_object('error','INVALID_QUERY','status',400); end if;
 begin v_work:=(p_data->>'workId')::bigint;v_episode:=(p_data->>'episodeId')::bigint; exception when others then
  return jsonb_build_object('error','INVALID_ID','status',400); end;
 -- Match publication lock order and hold the current head through the position write.
 select * into w from public.works where id=v_work for share;
 perform 1 from authoring.work_state where work_id=v_work for share;
 if w.id is null or not authoring.stage18_work_visible(v_work) then
  return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
 select * into e from public.episodes where id=v_episode and work_id=v_work for share;
 if e.id is null or not authoring.stage8_visible(v_work,v_episode) or e.is_free is distinct from true
  or e.access_policy is distinct from 'FREE' then return jsonb_build_object('error','EPISODE_NOT_FOUND','status',404); end if;
 select * into h from authoring.publication_heads where episode_id=v_episode for share;
 if not found then return jsonb_build_object('error','PUBLICATION_NOT_READY','status',409); end if;
 if p_data ? 'position' then
  position:=p_data->'position';
  index_key:=case when w.content_type='WEBTOON' then 'panelIndex' else 'paragraphIndex' end;
  if jsonb_typeof(position)<>'object' or (select count(*) from jsonb_object_keys(position))<>3
   or exists(select 1 from jsonb_object_keys(position) k where k not in ('versionId',index_key,'offset'))
   or coalesce(position->>'versionId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(position->index_key)<>'number' or coalesce(position->>index_key,'') !~ '^(0|[1-9][0-9]{0,5})$'
   or jsonb_typeof(position->'offset')<>'number' then
   return jsonb_build_object('error','INVALID_POSITION','status',400); end if;
  if h.version_id is distinct from (position->>'versionId')::uuid then
   return jsonb_build_object('error','POSITION_VERSION_CHANGED','status',409); end if;
  idx:=(position->>index_key)::integer;v_offset:=(position->>'offset')::numeric;
  select * into v from authoring.publication_versions where id=h.version_id and episode_id=v_episode and work_id=v_work;
  part_count:=coalesce(array_length(string_to_array(replace(replace(v.content,E'\r\n',E'\n'),E'\r',E'\n'),E'\n\n'),1),1);
  if w.content_type='WEBTOON' then part_count:=jsonb_array_length(authoring.webtoon_panels_json(v.webtoon)); end if;
  if idx>=part_count or v_offset<0 or v_offset>1 then
   return jsonb_build_object('error','INVALID_POSITION','status',400); end if;
 end if;
 result:=public.stage8_reader(p_user,'progress',p_data-'position');
 if result ? 'error' then return result; end if;
 if position is not null then
  update authoring.reader_progress set position_kind=case when w.content_type='WEBTOON' then 'PANEL' else 'PARAGRAPH' end,position_version_id=h.version_id,position_paragraph=idx,position_offset=v_offset
   where user_id=p_user and episode_id=v_episode;
 end if;
 return result||jsonb_build_object('positionSaved',position is not null);
end $$;
revoke all on function public.stage18_reader(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.stage18_reader(uuid,text,jsonb) to service_role;

-- Service-only path lookup. Never return object paths from a public JSON endpoint.
create or replace function public.stage18_image(p_episode bigint,p_version uuid,p_panel uuid,p_format text)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('bucket','authoring-webtoons','path',
  'webtoon/'||v.work_id||'/'||a.id||'/'||p.part||'/'||case when p_format='webp' then p.webp_sha||'.webp' else p.png_sha||'.png' end)
 from public.episodes e cross join lateral authoring.stage18_episode_rows(e.work_id,now()) ep
 join authoring.publication_versions v on v.id=(ep.item->>'versionId')::uuid
 join authoring.webtoon_assets a on a.work_id=e.work_id and a.state='READY' and a.id in(select value::uuid from jsonb_array_elements_text(v.webtoon->'assetIds'))
 join authoring.webtoon_panels p on p.asset_id=a.id
 where e.id=p_episode and ep.episode_id=e.id and v.id=p_version and p.id=p_panel and p_format in ('webp','png')),
 jsonb_build_object('error','PANEL_NOT_FOUND','status',404))
$$;
revoke all on function public.stage18_image(bigint,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.stage18_image(bigint,uuid,uuid,text) to service_role;

-- Flag-off publication entry point must not create a text-only edit from a webtoon head.
-- Keep the internal five-argument compatibility writer from dropping an existing manifest.
create or replace function authoring.save_draft(p_id uuid,p_expected bigint,p_title text,p_content text,p_comment text)
returns bigint language plpgsql set search_path='' as $$
declare d authoring.drafts;next_revision bigint;
begin
 select * into d from authoring.drafts where id=p_id for update;
 if not found then raise exception 'Draft not found' using errcode='P0002'; end if;
 if d.lifecycle<>'ACTIVE' then raise exception 'Draft not active' using errcode='55000'; end if;
 if p_expected is distinct from d.current_revision then raise exception 'DRAFT_CONFLICT' using errcode='40001'; end if;
 if (select content_type from public.works where id=d.work_id)='WEBTOON' and p_content<>'' then raise exception 'WEBTOON_IMAGE_EDITOR_REQUIRED'; end if;
 next_revision:=d.current_revision+1;
 insert into authoring.draft_revisions(draft_id,revision,title,content,author_comment,image_urls,webtoon)
  select p_id,next_revision,p_title,p_content,p_comment,image_urls,webtoon from authoring.draft_revisions where draft_id=p_id and revision=d.current_revision;
 update authoring.drafts set current_revision=next_revision,updated_at=now() where id=p_id;
 return next_revision;
end $$;
revoke all on function authoring.save_draft(uuid,bigint,text,text,text) from public,anon,authenticated;
grant execute on function authoring.save_draft(uuid,bigint,text,text,text) to service_role;

create or replace function public.creator_publications(p_user_id uuid,p_action text,p_work_id bigint,
 p_draft_id uuid default null,p_episode_id bigint default null,p_data jsonb default '{}',p_key uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.works w join public.authors a on a.id=w.author_id
  where w.id=p_work_id and a.auth_user_id=p_user_id and w.content_type='WEBTOON') then
  return jsonb_build_object('error','WEBTOON_NOT_ACTIVATED','status',503); end if;
 return public.creator_publications_v18(p_user_id,p_action,p_work_id,p_draft_id,p_episode_id,p_data,p_key);
end $$;
revoke all on function public.creator_publications(uuid,text,bigint,uuid,bigint,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.creator_publications(uuid,text,bigint,uuid,bigint,jsonb,uuid) to service_role;

insert into authoring.migrations(version) values('authoring-015') on conflict do nothing;
notify pgrst,'reload schema';
commit;
