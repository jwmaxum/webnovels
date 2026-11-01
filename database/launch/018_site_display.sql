-- OP-03: one manually selected display source; no financial or publication flag activation.
begin;
set local lock_timeout='5s';
do $$ begin
 if current_setting('webnovels.site_display_apply_verified',true) is distinct from 'true'
 or not public.launch_accounts_ready()
 or to_regprocedure('authoring.stage18_work_rows(timestamp with time zone)') is null then
  raise exception 'Reviewed display prerequisites required';end if;
end $$;

create or replace function launch_recovery.site_display_default() returns jsonb
language sql immutable set search_path='' as $$
 select '{"selections":[],"blocks":[{"key":"hero","enabled":true,"title":"대표 추천"},{"key":"recommendations","enabled":true,"title":"추천 작품"},{"key":"latest","enabled":true,"title":"최신 연재"},{"key":"ranking","enabled":true,"title":"인기 랭킹"},{"key":"notice","enabled":true,"title":"공지"}],"notices":[],"menus":[{"key":"home","label":"홈","visible":true},{"key":"novel","label":"웹소설","visible":true},{"key":"webtoon","label":"웹툰","visible":true},{"key":"recommendations","label":"추천","visible":true},{"key":"ranking","label":"랭킹","visible":true}],"footerNote":""}'::jsonb
$$;
create table if not exists launch_recovery.site_display_draft(
 singleton boolean primary key default true check(singleton),revision bigint not null default 0 check(revision>=0),
 document jsonb not null,updated_by uuid references auth.users(id),updated_at timestamptz not null default now()
);
create table if not exists launch_recovery.site_display_releases(
 id uuid primary key default gen_random_uuid(),number bigint not null unique,document jsonb not null,
 draft_revision bigint not null,starts_at timestamptz not null,ends_at timestamptz,
 actor_id uuid not null references auth.users(id),reason text not null,created_at timestamptz not null default now(),
 check(ends_at is null or ends_at>starts_at)
);
create index if not exists site_display_release_start on launch_recovery.site_display_releases(starts_at desc,number desc);
create table if not exists launch_recovery.site_display_actions(
 release_id uuid primary key references launch_recovery.site_display_releases(id),
 action text not null check(action in ('STOP','CANCEL')),actor_id uuid not null references auth.users(id),
 reason text not null,created_at timestamptz not null default now()
);
create table if not exists launch_recovery.site_display_receipts(
 actor_id uuid not null references auth.users(id),request_id uuid not null,action text not null,
 fingerprint text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(actor_id,request_id)
);
create index if not exists site_display_receipt_recent on launch_recovery.site_display_receipts(actor_id,created_at desc);
create table if not exists launch_recovery.site_display_audit(
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),
 action text not null,reason text not null,draft_revision bigint not null,release_id uuid,
 created_at timestamptz not null default now()
);
insert into launch_recovery.site_display_draft(singleton,document) values(true,launch_recovery.site_display_default()) on conflict do nothing;
do $$ declare t text;begin
 foreach t in array array['site_display_draft','site_display_releases','site_display_actions','site_display_receipts','site_display_audit'] loop
  execute format('alter table launch_recovery.%I enable row level security',t);
  execute format('revoke all on launch_recovery.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

create or replace function launch_recovery.site_display_immutable() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'SITE_DISPLAY_IMMUTABLE';end $$;
do $$ declare t text;begin
 foreach t in array array['site_display_releases','site_display_actions','site_display_receipts','site_display_audit'] loop
  execute format('drop trigger if exists site_display_immutable on launch_recovery.%I',t);
  execute format('create trigger site_display_immutable before update or delete on launch_recovery.%I for each row execute function launch_recovery.site_display_immutable()',t);
 end loop;
end $$;

create or replace function launch_recovery.site_display_document_valid(d jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare x jsonb;y jsonb;keys text[];start_at timestamptz;end_at timestamptz;
begin
 if jsonb_typeof(d) is distinct from 'object' or exists(select 1 from jsonb_object_keys(d) k where k not in ('selections','blocks','notices','menus','footerNote'))
 or jsonb_typeof(d->'selections') is distinct from 'array' or jsonb_array_length(d->'selections')>200
 or jsonb_typeof(d->'blocks') is distinct from 'array' or jsonb_array_length(d->'blocks')<>5
 or jsonb_typeof(d->'menus') is distinct from 'array' or jsonb_array_length(d->'menus')<>5
 or jsonb_typeof(d->'notices') is distinct from 'array' or jsonb_array_length(d->'notices')>10
 or jsonb_typeof(d->'footerNote') is distinct from 'string' or length(d->>'footerNote')>300 or d->>'footerNote' ~ '[<>[:cntrl:]]' then return false;end if;
 if (select count(distinct s->>'id') from jsonb_array_elements(d->'selections') s)<>jsonb_array_length(d->'selections')
 or (select count(distinct s->>'workId') from jsonb_array_elements(d->'selections') s)<>jsonb_array_length(d->'selections') then return false;end if;
 for x in select value from jsonb_array_elements(d->'selections') loop
  if jsonb_typeof(x) is distinct from 'object' or exists(select 1 from jsonb_object_keys(x) k where k not in ('id','workId','home','startsAt','endsAt','enabled','caption'))
  or not(x ?& array['id','workId','home','startsAt','endsAt','enabled','caption'])
  or jsonb_typeof(x->'id') is distinct from 'string' or coalesce(x->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(x->'workId') is distinct from 'string' or coalesce(x->>'workId','') !~ '^[1-9][0-9]{0,18}$' or (x->>'workId')::numeric>9223372036854775807
  or coalesce(x->>'home','') not in ('NONE','HERO','FEATURED') or jsonb_typeof(x->'enabled') is distinct from 'boolean'
  or jsonb_typeof(x->'caption') is distinct from 'string' or length(x->>'caption')>120 or x->>'caption' ~ '[<>[:cntrl:]]' then return false;end if;
  if x->'startsAt'<>'null'::jsonb and (jsonb_typeof(x->'startsAt')<>'string' or x->>'startsAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$') then return false;end if;
  if x->'endsAt'<>'null'::jsonb and (jsonb_typeof(x->'endsAt')<>'string' or x->>'endsAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$') then return false;end if;
  start_at:=(x->>'startsAt')::timestamptz;end_at:=(x->>'endsAt')::timestamptz;
  if start_at is not null and end_at is not null and end_at<=start_at then return false;end if;
 end loop;
 if (select count(*) from jsonb_array_elements(d->'selections') s where s->>'home'='FEATURED' and (s->>'enabled')::boolean)>8 then return false;end if;
 if exists(select 1 from jsonb_array_elements(d->'selections') a cross join jsonb_array_elements(d->'selections') b
  where a->>'id'<b->>'id' and a->>'home'='HERO' and b->>'home'='HERO' and (a->>'enabled')::boolean and (b->>'enabled')::boolean
  and tstzrange((a->>'startsAt')::timestamptz,(a->>'endsAt')::timestamptz,'[)') && tstzrange((b->>'startsAt')::timestamptz,(b->>'endsAt')::timestamptz,'[)')) then return false;end if;
 select array_agg(k order by k) into keys from (select entry.value->>'key' k from jsonb_array_elements(d->'blocks') entry(value)) entries;
 if keys is distinct from array['hero','latest','notice','ranking','recommendations'] then return false;end if;
 for x in select value from jsonb_array_elements(d->'blocks') loop
  if jsonb_typeof(x) is distinct from 'object' or exists(select 1 from jsonb_object_keys(x) k where k not in ('key','enabled','title'))
  or jsonb_typeof(x->'enabled') is distinct from 'boolean' or jsonb_typeof(x->'title') is distinct from 'string'
  or length(btrim(x->>'title')) not between 1 and 60 or x->>'title' ~ '[<>[:cntrl:]]' then return false;end if;
 end loop;
 select array_agg(k order by k) into keys from (select entry.value->>'key' k from jsonb_array_elements(d->'menus') entry(value)) entries;
 if keys is distinct from array['home','novel','ranking','recommendations','webtoon'] then return false;end if;
 for x in select value from jsonb_array_elements(d->'menus') loop
  if jsonb_typeof(x) is distinct from 'object' or exists(select 1 from jsonb_object_keys(x) k where k not in ('key','label','visible'))
  or jsonb_typeof(x->'visible') is distinct from 'boolean' or jsonb_typeof(x->'label') is distinct from 'string'
  or length(btrim(x->>'label')) not between 1 and 20 or x->>'label' ~ '[<>[:cntrl:]]' or (x->>'key'='home' and (x->>'visible')::boolean is not true) then return false;end if;
 end loop;
 if (select count(distinct entry.value->>'id') from jsonb_array_elements(d->'notices') entry(value))<>jsonb_array_length(d->'notices') then return false;end if;
 for x in select value from jsonb_array_elements(d->'notices') loop
  if jsonb_typeof(x) is distinct from 'object' or exists(select 1 from jsonb_object_keys(x) k where k not in ('id','title','body','href','startsAt','endsAt','enabled'))
  or not(x ?& array['id','title','body','href','startsAt','endsAt','enabled']) or coalesce(x->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(x->'enabled') is distinct from 'boolean' or jsonb_typeof(x->'title') is distinct from 'string' or length(btrim(x->>'title')) not between 1 and 80 or x->>'title' ~ '[<>[:cntrl:]]'
  or jsonb_typeof(x->'body') is distinct from 'string' or length(x->>'body')>2000 or translate(x->>'body',chr(10)||chr(13)||chr(9),'') ~ '[<>[:cntrl:]]'
  or jsonb_typeof(x->'href') is distinct from 'string' or x->>'href' !~ '^$|^/(home|discover|recommendations)/?$|^/works/[1-9][0-9]{0,18}$|^/company/$|^/policies/(terms|privacy|refund|settlement)/$' then return false;end if;
  if x->>'href' like '/works/%' and substring(x->>'href' from 8)::numeric>9223372036854775807 then return false;end if;
  if x->'startsAt'<>'null'::jsonb and (jsonb_typeof(x->'startsAt')<>'string' or x->>'startsAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$') then return false;end if;
  if x->'endsAt'<>'null'::jsonb and (jsonb_typeof(x->'endsAt')<>'string' or x->>'endsAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$') then return false;end if;
  if (x->>'endsAt')::timestamptz<=(x->>'startsAt')::timestamptz then return false;end if;
 end loop;
 return true;
exception when others then return false;
end $$;

create or replace function launch_recovery.site_display_projection(d jsonb,p_at timestamptz,p_offset integer,p_type text,p_publication jsonb default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare catalog jsonb;s jsonb;card jsonb;items jsonb:='[]';featured jsonb:='[]';hero jsonb:='null';excluded jsonb:='[]';notices jsonb:='[]';reason text;total_no integer;page jsonb;
begin
 select coalesce(jsonb_object_agg(w.work_id::text,(w.item-array['is_top_recommended','is_popular_work','is_new_work'])||jsonb_build_object('author',coalesce(a.pen_name,w.item->>'author',''))),'{}')
 into catalog from authoring.stage18_work_rows(now()) w join public.works pw on pw.id=w.work_id left join public.authors a on a.id=pw.author_id where w.episode_count>0;
 for s in select value from jsonb_array_elements(d->'selections') loop
  reason:=null;
  if not(s->>'enabled')::boolean then reason:='DISABLED';
  elsif (s->>'startsAt')::timestamptz>p_at or (s->>'endsAt')::timestamptz<=p_at then reason:='OUTSIDE_WINDOW';
  elsif not(catalog ? (s->>'workId')) then reason:='NOT_PUBLICLY_ELIGIBLE';end if;
  if reason is not null then excluded:=excluded||jsonb_build_array(jsonb_build_object('selectionId',s->>'id','workId',s->>'workId','reason',reason));continue;end if;
  card:=catalog->(s->>'workId')||jsonb_build_object('selectionId',s->>'id','caption',s->>'caption');
  if s->>'home'='HERO' then hero:=card;elsif s->>'home'='FEATURED' then featured:=featured||jsonb_build_array(card);end if;
  if p_type='ALL' or card->>'content_type'=p_type then items:=items||jsonb_build_array(card);end if;
 end loop;
 for s in select value from jsonb_array_elements(d->'notices') loop
  if (s->>'enabled')::boolean and coalesce((s->>'startsAt')::timestamptz,'-infinity')<=p_at and coalesce((s->>'endsAt')::timestamptz,'infinity')>p_at then notices:=notices||jsonb_build_array(s);end if;
 end loop;
 total_no:=jsonb_array_length(items);
 select coalesce(jsonb_agg(value order by ord),'[]') into page from jsonb_array_elements(items) with ordinality t(value,ord) where ord>p_offset and ord<=p_offset+24;
 return jsonb_build_object('ready',true,'revision',coalesce(p_publication->>'id','0'),'publication',p_publication,'items',page,'offset',p_offset,'limit',24,'total',total_no,
  'hasMore',total_no>p_offset+24,'nextOffset',case when total_no>p_offset+24 then p_offset+24 else null end,
  'home',jsonb_build_object('hero',hero,'featured',featured),'blocks',d->'blocks','notices',notices,'menus',d->'menus','footerNote',d->>'footerNote','excluded',excluded);
end $$;

create or replace function launch_recovery.site_display_admin_state() returns jsonb
language sql stable security definer set search_path='' set timezone='UTC' as $$
 with eligible as materialized(select work_id,item from authoring.stage18_work_rows(now()) where episode_count>0)
 select jsonb_build_object('ready',true,'draft',jsonb_build_object('revision',d.revision::text,'document',d.document),
  'selectionCards',coalesce((select jsonb_agg(coalesce(e.item,jsonb_build_object('id',s.value->>'workId','title',coalesce(w.title,'작품 없음'),'cover_image',to_jsonb(w)->>'cover_image','description',coalesce(to_jsonb(w)->>'description',''),'content_type',case when coalesce(to_jsonb(w)->>'content_type',to_jsonb(w)->>'type')='WEBTOON' then 'WEBTOON' else 'NOVEL' end,'status',to_jsonb(w)->>'status','rating',to_jsonb(w)->>'rating'))
   ||jsonb_build_object('author',coalesce(a.pen_name,e.item->>'author',''),'eligible',e.work_id is not null,'exclusionReason',case when e.work_id is not null then null when w.id is null then 'WORK_NOT_FOUND' else 'NOT_PUBLICLY_ELIGIBLE' end) order by s.ord)
   from jsonb_array_elements(d.document->'selections') with ordinality s(value,ord) left join public.works w on w.id::text=s.value->>'workId' left join public.authors a on a.id=w.author_id left join eligible e on e.work_id=w.id),'[]'),
  'releases',coalesce((select jsonb_agg(x.item order by x.number desc) from (select r.number,jsonb_build_object('id',r.id,'startsAt',r.starts_at,'endsAt',r.ends_at,'createdAt',r.created_at,'reason',r.reason,
   'stopped',coalesce(a.action='STOP',false),'cancelled',coalesce(a.action='CANCEL',false)) item from launch_recovery.site_display_releases r left join launch_recovery.site_display_actions a on a.release_id=r.id order by r.number desc limit 50) x),'[]'),
  'capabilities',jsonb_build_object('canEdit',true),'legacyAvailable',true) from launch_recovery.site_display_draft d where singleton
$$;

create or replace function public.site_display_ready() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from launch_recovery.site_display_draft where singleton)
$$;
create or replace function public.site_display_public(p_data jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare r launch_recovery.site_display_releases;d jsonb;publication jsonb;offset_no integer:=0;typ text:=coalesce(p_data->>'type','ALL');
begin
 if jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('offset','type'))
 or (p_data?'offset' and jsonb_typeof(p_data->'offset') is distinct from 'number') or (p_data?'type' and jsonb_typeof(p_data->'type') is distinct from 'string')
 or coalesce(p_data->>'offset','0') !~ '^(0|[1-9][0-9]{0,5})$' or coalesce(p_data->>'offset','0')::numeric>100000 or typ not in ('ALL','NOVEL','WEBTOON') then return jsonb_build_object('error','INVALID_DISPLAY_QUERY','status',400);end if;
 offset_no:=coalesce(p_data->>'offset','0')::integer;
 select v.* into r from launch_recovery.site_display_releases v where v.starts_at<=now() and not exists(select 1 from launch_recovery.site_display_actions a where a.release_id=v.id and a.action='CANCEL') order by v.starts_at desc,v.number desc limit 1;
 if r.id is not null and (r.ends_at is null or r.ends_at>now()) and not exists(select 1 from launch_recovery.site_display_actions where release_id=r.id and action='STOP') then
  d:=r.document;publication:=jsonb_build_object('id',r.id,'startsAt',r.starts_at,'endsAt',r.ends_at);
 else d:=launch_recovery.site_display_default();publication:=null;end if;
 return launch_recovery.site_display_projection(d,now(),offset_no,typ,publication)-'excluded';
end $$;

create or replace function public.admin_site_display(p_user uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare who jsonb;admin jsonb;draft launch_recovery.site_display_draft;release launch_recovery.site_display_releases;receipt launch_recovery.site_display_receipts;
 request_key uuid;fingerprint text;write_op boolean:=p_action in ('save','publish','stop','restore');result jsonb;doc jsonb;revision_no bigint;offset_no integer:=0;typ text;query_text text;items jsonb;total_no bigint;catalog jsonb;legacy jsonb:='{}';
 starts timestamptz;ends timestamptz;release_key uuid;action_name text;data_fields text[];
begin
 if jsonb_typeof(p_data) is distinct from 'object' or p_action not in ('get','search','legacy','save','preview','publish','stop','restore') or p_action is null then return jsonb_build_object('error','INVALID_DISPLAY_REQUEST','status',400);end if;
 if write_op then perform 1 from auth.users where id=p_user for share;perform 1 from public.admin_users where auth_user_id=p_user for share;end if;
 who:=public.launch_account_actor(p_user);if who?'error' then return who;end if;admin:=who->'admin';
 if coalesce((admin->>'is_active')::boolean,false) is not true or not(admin->>'role'='SUPER_ADMIN' or coalesce(admin->'permissions','[]')?'CURATION_WRITE') then return jsonb_build_object('error','ADMIN_FORBIDDEN','status',403);end if;
 data_fields:=case p_action when 'get' then array[]::text[] when 'search' then array['q','type','offset'] when 'legacy' then array['offset'] when 'save' then array['revision','document','reason','requestId'] when 'preview' then array['revision','at','offset'] when 'publish' then array['revision','startsAt','endsAt','reason','requestId'] when 'stop' then array['releaseId','reason','requestId'] when 'restore' then array['releaseId','revision','reason','requestId'] end;
 if exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(data_fields))) then return jsonb_build_object('error','INVALID_DISPLAY_REQUEST','status',400);end if;
 if p_action in ('search','legacy','preview') then
  if (p_data?'offset' and jsonb_typeof(p_data->'offset') is distinct from 'number') or coalesce(p_data->>'offset','0') !~ '^(0|[1-9][0-9]{0,5})$' or coalesce(p_data->>'offset','0')::numeric>100000 then return jsonb_build_object('error','INVALID_DISPLAY_REQUEST','status',400);end if;offset_no:=coalesce(p_data->>'offset','0')::integer;
 end if;
 if write_op then
  if jsonb_typeof(p_data->'reason') is distinct from 'string' or length(btrim(p_data->>'reason')) not between 3 and 500 or coalesce(p_data->>'requestId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return jsonb_build_object('error','INVALID_DISPLAY_REQUEST','status',400);end if;
  request_key:=(p_data->>'requestId')::uuid;fingerprint:=encode(sha256(convert_to(jsonb_build_object('action',p_action,'data',p_data)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('site-display:'||p_user::text,0));
  select * into receipt from launch_recovery.site_display_receipts where actor_id=p_user and request_id=request_key;
  if found then if receipt.fingerprint<>fingerprint then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT','status',409);end if;return receipt.result;end if;
  if (select count(*) from launch_recovery.site_display_receipts where actor_id=p_user and created_at>=now()-interval '15 minutes')>=30 then return jsonb_build_object('error','RATE_LIMITED','status',429);end if;
 end if;
 select * into draft from launch_recovery.site_display_draft where singleton for update;
 if p_action='get' then return launch_recovery.site_display_admin_state();end if;
 if p_action in ('search','legacy') then
  query_text:=coalesce(p_data->>'q','');typ:=coalesce(p_data->>'type','ALL');
  if (p_data?'q' and jsonb_typeof(p_data->'q') is distinct from 'string') or (p_data?'type' and jsonb_typeof(p_data->'type') is distinct from 'string') or length(query_text)>100 or query_text ~ '[[:cntrl:]]' or typ not in ('ALL','NOVEL','WEBTOON') then return jsonb_build_object('error','INVALID_DISPLAY_REQUEST','status',400);end if;
  select coalesce(jsonb_object_agg(w.work_id::text,w.item),'{}') into catalog from authoring.stage18_work_rows(now()) w where w.episode_count>0;
  if p_action='legacy' and to_regclass('authoring.editorial_placements') is not null then
   execute 'select coalesce(jsonb_object_agg(x.work_id,x.origins),''{}'') from (select work_id,jsonb_agg(origin order by ordinal) origins from (select work_id::text work_id,left(format(''PLACEMENT %s #%s [%s, %s) %s'',slot,position,starts_at,ends_at,case when enabled then ''ENABLED'' else ''DISABLED'' end),240) origin,row_number() over(partition by work_id order by starts_at desc,slot,position,id) ordinal from authoring.editorial_placements) p where ordinal<=17 group by work_id) x' into legacy;
  end if;
  with candidates as (
   select w.id,w.title,coalesce(a.pen_name,to_jsonb(w)->>'author','') author,
    case when coalesce(to_jsonb(w)->>'content_type',to_jsonb(w)->>'type')='WEBTOON' then 'WEBTOON' else 'NOVEL' end kind,to_jsonb(w) raw,catalog?(w.id::text) eligible,
    coalesce(legacy->(w.id::text),'[]')||case when to_jsonb(w)->>'is_top_recommended'='true' then '["FLAG is_top_recommended"]'::jsonb else '[]'::jsonb end
    ||case when to_jsonb(w)->>'is_popular_work'='true' then '["FLAG is_popular_work"]'::jsonb else '[]'::jsonb end
    ||case when to_jsonb(w)->>'is_new_work'='true' then '["FLAG is_new_work"]'::jsonb else '[]'::jsonb end origins
   from public.works w left join public.authors a on a.id=w.author_id
  ),filtered as (
   select *,jsonb_build_object('id',id::text,'title',title,'author',author,'content_type',kind,'status',raw->>'status','rating',raw->>'rating','description',coalesce(raw->>'description',''),'cover_image',raw->>'cover_image','genre',coalesce(raw->'genre','[]'),'eligible',eligible,'exclusionReason',case when eligible then null else 'NOT_PUBLICLY_ELIGIBLE' end) card
   from candidates where (typ='ALL' or kind=typ) and (p_action<>'legacy' or jsonb_array_length(origins)>0)
    and (query_text='' or strpos(lower(title),lower(query_text))>0 or strpos(lower(author),lower(query_text))>0 or id::text=query_text)
  ) select (select count(*) from filtered),coalesce((select jsonb_agg(case when p_action='legacy' then jsonb_build_object('work',card,'origins',origins) else card end order by id) from (select * from filtered order by id limit 50 offset offset_no) paged),'[]') into total_no,items;
  return jsonb_build_object('items',items,'offset',offset_no,'limit',50,'total',total_no,'hasMore',total_no>offset_no+50,'nextOffset',case when total_no>offset_no+50 then offset_no+50 else null end);
 end if;
 if p_action in ('save','preview','publish','restore') then
  if jsonb_typeof(p_data->'revision') is distinct from 'string' or coalesce(p_data->>'revision','') !~ '^(0|[1-9][0-9]{0,18})$' or (p_data->>'revision')::numeric>9223372036854775807 then return jsonb_build_object('error','INVALID_DISPLAY_REQUEST','status',400);end if;
  if p_data->>'revision'<>draft.revision::text then return jsonb_build_object('error','DISPLAY_CONFLICT','status',409);end if;
 end if;
 if p_action='preview' then
  if coalesce(p_data->>'at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$' then return jsonb_build_object('error','INVALID_DISPLAY_REQUEST','status',400);end if;
  begin starts:=(p_data->>'at')::timestamptz;exception when others then return jsonb_build_object('error','INVALID_DISPLAY_REQUEST','status',400);end;
  result:=launch_recovery.site_display_projection(draft.document,starts,offset_no,'ALL');
  return jsonb_build_object('revision',draft.revision::text,'at',starts,'public',result-'excluded','excluded',result->'excluded');
 end if;
 if p_action in ('restore','stop') then
  if coalesce(p_data->>'releaseId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return jsonb_build_object('error','INVALID_DISPLAY_REQUEST','status',400);end if;
  release_key:=(p_data->>'releaseId')::uuid;select * into release from launch_recovery.site_display_releases where id=release_key for update;
  if not found then return jsonb_build_object('error','DISPLAY_RELEASE_NOT_FOUND','status',404);end if;
 end if;
 if p_action='save' then
  doc:=p_data->'document';if not launch_recovery.site_display_document_valid(doc) then return jsonb_build_object('error','INVALID_DISPLAY_DOCUMENT','status',400);end if;
  if exists(select 1 from jsonb_array_elements(doc->'selections') s where not exists(select 1 from public.works where id::text=s->>'workId')) then return jsonb_build_object('error','WORK_NOT_FOUND','status',404);end if;
  update launch_recovery.site_display_draft set document=doc,revision=revision+1,updated_by=p_user,updated_at=now() where singleton returning revision into revision_no;
 elsif p_action='restore' then
  update launch_recovery.site_display_draft set document=release.document,revision=revision+1,updated_by=p_user,updated_at=now() where singleton returning revision into revision_no;
 elsif p_action='publish' then
  if not launch_recovery.site_display_document_valid(draft.document) or coalesce(p_data->>'startsAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$'
   or not(p_data?'endsAt') or p_data->'endsAt'<>'null'::jsonb and (jsonb_typeof(p_data->'endsAt')<>'string' or p_data->>'endsAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$') then return jsonb_build_object('error','INVALID_DISPLAY_REQUEST','status',400);end if;
  begin starts:=(p_data->>'startsAt')::timestamptz;ends:=(p_data->>'endsAt')::timestamptz;exception when others then return jsonb_build_object('error','INVALID_DISPLAY_REQUEST','status',400);end;
  if starts<now()-interval '5 minutes' then return jsonb_build_object('error','INVALID_DISPLAY_REQUEST','status',400);end if;
  if starts<=now() then starts:=now();end if;
  if ends is not null and ends<=starts then return jsonb_build_object('error','INVALID_DISPLAY_REQUEST','status',400);end if;
  release_key:=gen_random_uuid();insert into launch_recovery.site_display_releases(id,number,document,draft_revision,starts_at,ends_at,actor_id,reason)
   select release_key,coalesce(max(number),0)+1,draft.document,draft.revision,starts,ends,p_user,btrim(p_data->>'reason') from launch_recovery.site_display_releases;
  update launch_recovery.site_display_draft set revision=revision+1,updated_by=p_user,updated_at=now() where singleton returning revision into revision_no;
 elsif p_action='stop' then
  if exists(select 1 from launch_recovery.site_display_actions where release_id=release_key) then return jsonb_build_object('error','DISPLAY_RELEASE_STOPPED','status',409);end if;
  action_name:=case when release.starts_at>now() then 'CANCEL' else 'STOP' end;
  insert into launch_recovery.site_display_actions(release_id,action,actor_id,reason) values(release_key,action_name,p_user,btrim(p_data->>'reason'));
  update launch_recovery.site_display_draft set revision=revision+1,updated_by=p_user,updated_at=now() where singleton returning revision into revision_no;
 end if;
 insert into launch_recovery.site_display_audit(actor_id,action,reason,draft_revision,release_id) values(p_user,p_action,btrim(p_data->>'reason'),revision_no,release_key);
 result:=launch_recovery.site_display_admin_state()||jsonb_build_object('saved',true);
 insert into launch_recovery.site_display_receipts(actor_id,request_id,action,fingerprint,result) values(p_user,request_key,p_action,fingerprint,result);
 return result;
end $$;

-- Close both old write origins without overwriting historical selections or routines.
create or replace function launch_recovery.site_display_legacy_guard() returns trigger
language plpgsql set search_path='' as $$ declare field text;begin
 if tg_table_schema='public' and tg_table_name='works' then
  foreach field in array array['is_top_recommended','is_popular_work','is_new_work'] loop
   if tg_op='INSERT' and to_jsonb(new)->>field='true' or tg_op='UPDATE' and to_jsonb(new)->field is distinct from to_jsonb(old)->field then raise exception 'SITE_DISPLAY_REQUIRED';end if;
  end loop;return new;
 end if;
 raise exception 'SITE_DISPLAY_REQUIRED';
end $$;
drop trigger if exists site_display_legacy_guard on public.works;
create trigger site_display_legacy_guard before insert or update on public.works for each row execute function launch_recovery.site_display_legacy_guard();
do $$ begin
 if to_regclass('authoring.editorial_placements') is not null then
  execute 'drop trigger if exists site_display_legacy_guard on authoring.editorial_placements';
  execute 'create trigger site_display_legacy_guard before insert or update or delete on authoring.editorial_placements for each row execute function launch_recovery.site_display_legacy_guard()';
 end if;
end $$;

revoke all on function launch_recovery.site_display_default(),launch_recovery.site_display_immutable(),launch_recovery.site_display_document_valid(jsonb),launch_recovery.site_display_projection(jsonb,timestamptz,integer,text,jsonb),launch_recovery.site_display_admin_state(),launch_recovery.site_display_legacy_guard() from public,anon,authenticated,service_role;
revoke all on function public.site_display_ready(),public.site_display_public(jsonb),public.admin_site_display(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.site_display_ready(),public.site_display_public(jsonb),public.admin_site_display(uuid,text,jsonb) to service_role;
insert into authoring.migrations(version) values('launch-018-site-display') on conflict do nothing;
notify pgrst,'reload schema';
commit;
