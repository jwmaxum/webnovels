-- Public-catalog translations are reviewed records. Apply only after DB and backup review.
begin;
set local lock_timeout='5s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
  or not exists(select 1 from authoring.migrations where version='authoring-015') then
  raise exception 'Reviewed authoring-015 prerequisite required';
 end if;
end $$;

create table if not exists authoring.reader_work_translations (
 work_id bigint not null references public.works(id) on delete cascade,
 locale text not null check (locale in ('en','ja','zh-Hans')),
 source_locale text not null check (source_locale in ('ko','en','ja','zh-Hans') and source_locale<>locale),
 source_title text not null,
 source_description text,
 title text not null check (char_length(title)<=500 and btrim(title)<>'' and title !~ '[[:cntrl:]<>]'),
 description text check (char_length(description)<=8000 and btrim(description)<>'' and description !~ '[<>]'),
 keywords text[] not null default '{}' check (cardinality(keywords)<=20 and length(keywords::text)<=2200),
 approval_ref text not null check (char_length(btrim(approval_ref)) between 1 and 200),
 approved_at timestamptz not null default now(),
 primary key(work_id,locale)
);
create table if not exists authoring.reader_episode_translations (
 episode_id bigint not null,
 version_id uuid not null,
 locale text not null check (locale in ('en','ja','zh-Hans')),
 source_locale text not null check (source_locale in ('ko','en','ja','zh-Hans') and source_locale<>locale),
 title text not null check (char_length(title)<=500 and btrim(title)<>'' and title !~ '[[:cntrl:]<>]'),
 approval_ref text not null check (char_length(btrim(approval_ref)) between 1 and 200),
 approved_at timestamptz not null default now(),
 primary key(episode_id,version_id,locale),
 foreign key(version_id,episode_id) references authoring.publication_versions(id,episode_id) on delete cascade
);
alter table authoring.reader_work_translations enable row level security;
alter table authoring.reader_episode_translations enable row level security;
-- Table owner alone records approval. API roles access public metadata through filtered RPCs.
revoke all on authoring.reader_work_translations,authoring.reader_episode_translations from public,anon,authenticated,service_role;

create or replace function public.reader_catalog_translations(
 p_locale text,p_work_ids bigint[],p_episode_ids bigint[],p_webtoon boolean)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'works',coalesce((select jsonb_agg(jsonb_build_object(
   'id',w.id::text,'sourceTitle',w.title,'sourceDescription',w.description,
   'sourceLocale',t.source_locale,'locale',t.locale,'title',t.title,'description',t.description))
   from authoring.reader_work_translations t join public.works w on w.id=t.work_id
   where t.locale=p_locale and t.work_id=any(p_work_ids) and t.source_title=w.title
    and t.source_description is not distinct from w.description
    and t.approved_at<=now() and (w.published_at is null or w.published_at<=now())
    and case when p_webtoon then authoring.stage18_work_visible(w.id) else authoring.stage16_work_visible(w.id) end),'[]'::jsonb),
  'episodes',coalesce((select jsonb_agg(jsonb_build_object(
   'id',t.episode_id::text,'workId',e.work_id::text,'versionId',t.version_id,
   'sourceLocale',t.source_locale,'locale',t.locale,'title',t.title))
   from authoring.reader_episode_translations t join public.episodes e on e.id=t.episode_id
   join public.works w on w.id=e.work_id and (w.published_at is null or w.published_at<=now())
   where t.locale=p_locale and t.episode_id=any(p_episode_ids) and t.approved_at<=now()
    and exists(select 1 from (
     select * from authoring.stage18_episode_rows(e.work_id,now()) where p_webtoon is true
     union all
     select * from authoring.stage16_episode_rows(e.work_id,now()) where p_webtoon is not true
    ) visible where visible.episode_id=e.id and visible.item->>'versionId'=t.version_id::text)),'[]'::jsonb))
 where p_locale in ('en','ja','zh-Hans') and cardinality(p_work_ids)<=50 and cardinality(p_episode_ids)<=50
$$;
revoke all on function public.reader_catalog_translations(text,bigint[],bigint[],boolean) from public,anon,authenticated;
grant execute on function public.reader_catalog_translations(text,bigint[],bigint[],boolean) to service_role;

-- Extend the existing discovery search set before the keyset boundary is applied.
-- The original row providers still own all work/episode visibility and ranking rules.
create or replace function public.reader_catalog_localized_search(p_locale text,p_query jsonb,p_webtoon boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 as_of timestamptz;
 page_limit integer;
 sort_name text;
 search_text text;
 boundary_key numeric;
 boundary_id bigint;
 rows jsonb;
begin
 if p_locale is null or p_locale not in ('en','ja','zh-Hans') or p_query is null
  or jsonb_typeof(p_query)<>'object' or length(p_query::text)>10000 then
  return jsonb_build_object('error','INVALID_QUERY','status',400);
 end if;
 if coalesce(p_query->>'q','')='' or length(p_query->>'q')>100
  or coalesce(p_query->>'sort','') not in ('latest','new','popular','episodes')
  or coalesce(p_query->>'type','') not in ('NOVEL','WEBTOON')
  or coalesce(p_query->>'status','') not in ('ALL','ONGOING','COMPLETED')
  or coalesce(p_query->>'rating','') not in ('ALL','ALL_AGES','AGE_15','AGE_19')
  or coalesce(p_query->>'epRange','') not in ('ALL','1-25','26-100','101+')
  or length(coalesce(p_query->>'genre',''))>40
  or jsonb_typeof(p_query->'tags') is distinct from 'array'
  or coalesce(p_query->>'limit','') !~ '^[1-9][0-9]?$' then
  return jsonb_build_object('error','INVALID_QUERY','status',400);
 end if;
 if jsonb_array_length(p_query->'tags')>10
  or exists(select 1 from jsonb_array_elements(p_query->'tags') tag
   where jsonb_typeof(tag)<>'string' or length(tag#>>'{}') not between 1 and 40) then
  return jsonb_build_object('error','INVALID_QUERY','status',400);
 end if;
 page_limit:=(p_query->>'limit')::integer;
 if page_limit>50 then return jsonb_build_object('error','INVALID_LIMIT','status',400); end if;
 sort_name:=p_query->>'sort';
 search_text:=lower(normalize(p_query->>'q',NFKC));
 begin
  as_of:=coalesce((p_query->>'asOf')::timestamptz,now());
  if not isfinite(as_of) or as_of>now()+interval '1 minute' then raise invalid_parameter_value; end if;
  if p_query ? 'cursor' then
   if not (p_query ? 'asOf') or coalesce(p_query->'cursor'->>'key','') !~ '^-?[0-9]{1,20}(\.[0-9]{1,6})?$'
    or coalesce(p_query->'cursor'->>'id','') !~ '^[1-9][0-9]{0,18}$' then raise invalid_parameter_value; end if;
   boundary_key:=(p_query->'cursor'->>'key')::numeric;
   boundary_id:=(p_query->'cursor'->>'id')::bigint;
  end if;
 exception when invalid_parameter_value or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  return jsonb_build_object('error','INVALID_CURSOR','status',400);
 end;

 with catalog as materialized (
  select c.*,case sort_name when 'latest' then coalesce(extract(epoch from c.last_published_at),0)
   when 'new' then coalesce(extract(epoch from c.first_published_at),0)
   when 'popular' then c.ranking_readers::numeric else c.episode_count::numeric end sort_key
  from (
   select * from authoring.stage18_work_rows(as_of) where p_webtoon is true
   union all
   select * from authoring.stage16_work_rows(as_of) where p_webtoon is not true
  ) c
 ), page as (
  select c.* from catalog c left join authoring.reader_work_translations t
   on t.work_id=c.work_id and t.locale=p_locale and t.approved_at<=as_of
    and t.source_title=c.item->>'title' and t.source_description is not distinct from c.item->>'description'
  where c.item->>'content_type'=p_query->>'type'
   and (
    exists(select 1 from unnest(array[c.item->>'title',c.item->>'author',c.item->>'description',t.title,t.description]
     || coalesce(t.keywords,'{}'::text[])) candidate where strpos(lower(normalize(candidate,NFKC)),search_text)>0)
    or exists(select 1 from public.episodes e
     join authoring.publication_heads h on h.episode_id=e.id
     join authoring.reader_episode_translations et on et.episode_id=e.id and et.version_id=h.version_id
     where e.work_id=c.work_id and e.status='PUBLISHED' and e.is_free=true and e.access_policy='FREE'
      and et.locale=p_locale and et.approved_at<=as_of
      and strpos(lower(normalize(et.title,NFKC)),search_text)>0
      and exists(select 1 from (
       select episode_id from authoring.stage18_episode_rows(c.work_id,as_of) where p_webtoon is true
       union all
       select episode_id from authoring.stage16_episode_rows(c.work_id,as_of) where p_webtoon is not true
      ) visible where visible.episode_id=e.id))
   )
   and (coalesce(p_query->>'genre','ALL') in ('ALL','전체') or exists(select 1 from
    jsonb_array_elements_text(case when jsonb_typeof(c.item->'genre')='array' then c.item->'genre'
     else jsonb_build_array(c.item->'genre') end) g where g=p_query->>'genre'))
   and (p_query->>'status'='ALL'
    or (p_query->>'status'='COMPLETED' and (c.item->>'status'='COMPLETED' or c.item->>'is_completed'='true'))
    or (p_query->>'status'='ONGOING' and c.item->>'status'<>'COMPLETED' and c.item->>'is_completed'<>'true'))
   and (p_query->>'rating'='ALL' or (p_query->>'rating'='ALL_AGES' and c.item->>'rating'='ALL')
    or c.item->>'rating'=p_query->>'rating')
   and (p_query->>'epRange'='ALL' or (p_query->>'epRange'='1-25' and c.episode_count between 1 and 25)
    or (p_query->>'epRange'='26-100' and c.episode_count between 26 and 100)
    or (p_query->>'epRange'='101+' and c.episode_count>=101))
   and not exists(select 1 from jsonb_array_elements_text(p_query->'tags') wanted where
    not exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(c.item->'tags')='array' then c.item->'tags'
     else to_jsonb(string_to_array(coalesce(c.item->>'tags',''),',')) end) actual
     where authoring.stage18_tag(actual)=authoring.stage18_tag(wanted)))
   and (sort_name<>'popular' or c.ranking_readers>=5)
   and (boundary_id is null or (c.sort_key,c.work_id)<(boundary_key,boundary_id))
  order by c.sort_key desc,c.work_id desc limit page_limit+1
 )
 select coalesce(jsonb_agg(jsonb_build_object('item',item,'key',sort_key::text,'id',work_id::text)
  order by sort_key desc,work_id desc),'[]') into rows from page;

 return jsonb_build_object(
  'works',(select coalesce(jsonb_agg(value->'item' order by ord),'[]')
   from jsonb_array_elements(rows) with ordinality r(value,ord) where ord<=page_limit),
  'nextCursor',case when jsonb_array_length(rows)>page_limit then (rows->(page_limit-1))-'item' else null end,
  'ranking',jsonb_build_object('periodDays',7,'minSample',5,'asOf',as_of,'metric','uniqueReaders'),
  'asOf',as_of);
end $$;
revoke all on function public.reader_catalog_localized_search(text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.reader_catalog_localized_search(text,jsonb,boolean) to service_role;

insert into authoring.migrations(version) values('authoring-032') on conflict do nothing;
notify pgrst,'reload schema';
commit;
