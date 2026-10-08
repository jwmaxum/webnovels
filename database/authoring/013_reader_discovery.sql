-- Reviewed additive reader discovery. Never apply this to a live DB without schema/backup acceptance.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
   or not exists(select 1 from authoring.migrations where version='authoring-009')
   or not exists(select 1 from authoring.migrations where version='authoring-012') then
   raise exception 'Reviewed authoring-009 and authoring-012 prerequisites required';
 end if;
end $$;

alter table authoring.reader_progress add column if not exists position_version_id uuid;
alter table authoring.reader_progress add column if not exists position_paragraph integer;
alter table authoring.reader_progress add column if not exists position_offset numeric;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='authoring.reader_progress'::regclass
  and conname='stage16_position_version_fk') then
  alter table authoring.reader_progress add constraint stage16_position_version_fk
   foreign key(position_version_id,episode_id) references authoring.publication_versions(id,episode_id) on delete restrict;
 end if;
 if not exists(select 1 from pg_constraint where conrelid='authoring.reader_progress'::regclass
  and conname='stage16_position_complete') then
  alter table authoring.reader_progress add constraint stage16_position_complete check(
   (position_version_id is null and position_paragraph is null and position_offset is null) or
   (position_version_id is not null and position_paragraph is not null and position_offset is not null
    and position_paragraph between 0 and 999999 and position_offset between 0 and 1));
 end if;
end $$;
-- Public-page indexes do not confer table permissions.
create index if not exists stage16_episode_page on public.episodes(work_id,episode_number,id)
 where status='PUBLISHED' and is_free=true and access_policy='FREE';
create index if not exists stage16_reader_ranking on authoring.reader_events_v2(created_at,work_id,user_id);

create or replace function authoring.stage16_work_visible(p_work bigint)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.works w where w.id=p_work and authoring.stage8_visible(w.id)
  and w.content_type='NOVEL' and w.rating::text in ('ALL','AGE_15')
  and not exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(to_jsonb(w.genre))='array'
   then to_jsonb(w.genre) else jsonb_build_array(w.genre) end) g where g in ('성인','19세 이상')))
$$;
revoke all on function authoring.stage16_work_visible(bigint) from public,anon,authenticated,service_role;

-- Keep the established discover tag aliases while accepting literal tags from author metadata.
create or replace function authoring.stage16_tag(p_tag text)
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
revoke all on function authoring.stage16_tag(text) from public,anon,authenticated,service_role;

create or replace function authoring.stage16_episode_rows(p_work bigint,p_asof timestamptz)
returns table(episode_id bigint,episode_number integer,item jsonb)
language sql stable set search_path='' as $$
 select e.id,e.episode_number,jsonb_build_object(
  'id',e.id::text,'work_id',e.work_id::text,'episode_number',e.episode_number,'title',v.title,
  'status',e.status::text,'view_count',e.view_count,'is_free',e.is_free,'is_ad_free',e.is_ad_free,
  'access_policy',e.access_policy,'scheduled_at',e.scheduled_at,'published_at',h.published_at,'versionId',h.version_id)
 from public.episodes e join authoring.publication_heads h on h.episode_id=e.id
 join authoring.publication_versions v on v.id=h.version_id and v.episode_id=e.id and v.work_id=e.work_id
 where e.work_id=p_work and authoring.stage16_work_visible(e.work_id) and authoring.stage8_visible(e.work_id,e.id)
  and e.is_free=true and e.access_policy='FREE' and h.published_at<=p_asof
$$;
revoke all on function authoring.stage16_episode_rows(bigint,timestamptz) from public,anon,authenticated,service_role;

create or replace function authoring.stage16_work_rows(p_asof timestamptz)
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
  from authoring.stage16_episode_rows(w.id,p_asof) ep) eps
 cross join lateral(select count(distinct ev.user_id) n from authoring.reader_events_v2 ev
  join public.readers r on r.auth_user_id=ev.user_id and r.status::text='ACTIVE'
  join auth.users u on u.id=ev.user_id and u.email_confirmed_at is not null and u.is_anonymous is not true
   and (u.banned_until is null or u.banned_until<=p_asof)
  where ev.work_id=w.id and ev.created_at>p_asof-interval '7 days' and ev.created_at<=p_asof
   and ev.event_type in ('OPEN','COMPLETE')
   and not exists(select 1 from public.authors a where a.id=w.author_id and a.auth_user_id=ev.user_id)) ranking
 where authoring.stage16_work_visible(w.id) and (w.published_at is null or w.published_at<=p_asof)
$$;
revoke all on function authoring.stage16_work_rows(timestamptz) from public,anon,authenticated,service_role;

create or replace function public.stage16_catalog(p_action text,p_query jsonb default '{}')
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
  if not authoring.stage16_work_visible(v_work) then return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
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
  with catalog as materialized(select * from authoring.stage16_work_rows(v_asof))
  select jsonb_build_object('sections',jsonb_build_object(
   'recommended',coalesce((select jsonb_agg(x.item) from (select item from catalog
    where item->>'is_top_recommended'='true' order by last_published_at desc nulls last,work_id desc limit 8) x),'[]'::jsonb),
   'popular',coalesce((select jsonb_agg(x.item) from (select item from catalog where ranking_readers>=5
    order by ranking_readers desc,work_id desc limit 8) x),'[]'::jsonb),
   'new',coalesce((select jsonb_agg(x.item) from (select item from catalog
    order by first_published_at desc nulls last,work_id desc limit 8) x),'[]'::jsonb),
   'completed',coalesce((select jsonb_agg(x.item) from (select item from catalog
    where item->>'status'='COMPLETED' or item->>'is_completed'='true'
    order by last_published_at desc nulls last,work_id desc limit 8) x),'[]'::jsonb)), 'ranking',ranking) into result;
  return result;
 end if;
 if p_action='work' then
  select item into v_item from authoring.stage16_work_rows(v_asof) where work_id=v_work;
  if v_item is null then return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
  return jsonb_build_object('work',v_item);
 end if;
 if p_action='chapter' then
  if jsonb_typeof(p_query->'episodeNumber')<>'number' or coalesce(p_query->>'episodeNumber','') !~ '^[1-9][0-9]{0,9}$' then
   return jsonb_build_object('error','INVALID_EPISODE_NUMBER','status',400); end if;
  begin v_episode:=(p_query->>'episodeNumber')::integer; exception when numeric_value_out_of_range then
   return jsonb_build_object('error','INVALID_EPISODE_NUMBER','status',400); end;
  select item into v_item from authoring.stage16_episode_rows(v_work,v_asof) where episode_number=v_episode;
  if v_item is null then return jsonb_build_object('error','EPISODE_NOT_FOUND','status',404); end if;
  return jsonb_build_object('episode',v_item,
   'previous',(select item from authoring.stage16_episode_rows(v_work,v_asof) where episode_number<v_episode
    order by episode_number desc,episode_id desc limit 1),
   'next',(select item from authoring.stage16_episode_rows(v_work,v_asof) where episode_number>v_episode
    order by episode_number,episode_id limit 1));
 end if;
 if p_action='episodes' then
  select coalesce(jsonb_agg(x.item||jsonb_build_object('_key',x.episode_number::text,'_id',x.episode_id::text)
    order by x.episode_number,x.episode_id),'[]'::jsonb) into rows
   from(select * from authoring.stage16_episode_rows(v_work,v_asof)
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
   from authoring.stage16_work_rows(v_asof) c), filtered as(
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
      where authoring.stage16_tag(actual)=authoring.stage16_tag(wanted)))
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
revoke all on function public.stage16_catalog(text,jsonb) from public,anon,authenticated;
grant execute on function public.stage16_catalog(text,jsonb) to service_role;

create or replace function public.stage16_episode_content(p_episode_id bigint)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('episode',ep.item||jsonb_build_object(
  'content',v.content,'author_comment',v.author_comment,'image_urls',v.image_urls))
  from public.episodes e cross join lateral authoring.stage16_episode_rows(e.work_id,now()) ep
  join authoring.publication_versions v on v.id=(ep.item->>'versionId')::uuid
  where e.id=p_episode_id and ep.episode_id=e.id),jsonb_build_object('error','EPISODE_NOT_FOUND','status',404))
$$;
revoke all on function public.stage16_episode_content(bigint) from public,anon,authenticated;
grant execute on function public.stage16_episode_content(bigint) to service_role;

create or replace function public.stage16_reader(p_user uuid,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; position jsonb; v_work bigint; v_episode bigint; w public.works; e public.episodes;
 h authoring.publication_heads; v authoring.publication_versions; idx integer; part_count integer; v_offset numeric;
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
     'versionId',q.position_version_id,'paragraphIndex',q.position_paragraph,'offset',q.position_offset) else null end,
    'positionChanged',q.position_version_id is not null and q.position_version_id is distinct from current_head.version_id) item
   from authoring.reader_progress q join public.episodes ep on ep.id=q.episode_id
   join authoring.publication_heads current_head on current_head.episode_id=q.episode_id
   where q.user_id=p_user and authoring.stage16_work_visible(q.work_id)
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
 if w.id is null or not authoring.stage16_work_visible(v_work) then
  return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
 select * into e from public.episodes where id=v_episode and work_id=v_work for share;
 if e.id is null or not authoring.stage8_visible(v_work,v_episode) or e.is_free is distinct from true
  or e.access_policy is distinct from 'FREE' then return jsonb_build_object('error','EPISODE_NOT_FOUND','status',404); end if;
 select * into h from authoring.publication_heads where episode_id=v_episode for share;
 if not found then return jsonb_build_object('error','PUBLICATION_NOT_READY','status',409); end if;
 if p_data ? 'position' then
  position:=p_data->'position';
  if jsonb_typeof(position)<>'object' or (select count(*) from jsonb_object_keys(position))<>3
   or exists(select 1 from jsonb_object_keys(position) k where k not in ('versionId','paragraphIndex','offset'))
   or coalesce(position->>'versionId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(position->'paragraphIndex')<>'number' or coalesce(position->>'paragraphIndex','') !~ '^(0|[1-9][0-9]{0,5})$'
   or jsonb_typeof(position->'offset')<>'number' then
   return jsonb_build_object('error','INVALID_POSITION','status',400); end if;
  if h.version_id is distinct from (position->>'versionId')::uuid then
   return jsonb_build_object('error','POSITION_VERSION_CHANGED','status',409); end if;
  idx:=(position->>'paragraphIndex')::integer;v_offset:=(position->>'offset')::numeric;
  select * into v from authoring.publication_versions where id=h.version_id and episode_id=v_episode and work_id=v_work;
  part_count:=coalesce(array_length(string_to_array(replace(replace(v.content,E'\r\n',E'\n'),E'\r',E'\n'),E'\n\n'),1),1);
  if idx>=part_count or v_offset<0 or v_offset>1 then
   return jsonb_build_object('error','INVALID_POSITION','status',400); end if;
 end if;
 result:=public.stage8_reader(p_user,'progress',p_data-'position');
 if result ? 'error' then return result; end if;
 if position is not null then
  update authoring.reader_progress set position_version_id=h.version_id,position_paragraph=idx,position_offset=v_offset
   where user_id=p_user and episode_id=v_episode;
 end if;
 return result||jsonb_build_object('positionSaved',position is not null);
end $$;
revoke all on function public.stage16_reader(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.stage16_reader(uuid,text,jsonb) to service_role;

insert into authoring.migrations(version) values('authoring-013') on conflict do nothing;
notify pgrst,'reload schema';
commit;
