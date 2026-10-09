-- Reviewed additive migration. No policy seed, automatic tier change, or notification sender.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
 or not exists(select 1 from authoring.migrations where version='authoring-015') then
  raise exception 'Reviewed authoring-015 prerequisite required'; end if;
end $$;
create schema if not exists growth;
revoke all on schema growth from public,anon,authenticated,service_role;
create table if not exists growth.preferences(
 user_id uuid primary key references auth.users(id) on delete cascade,
 excluded_genres text[] not null default '{}', frequency text not null default 'OFF'
 check(frequency in ('OFF','WEEKLY','DAILY')), consent boolean not null default false,
 metrics_since timestamptz, updated_at timestamptz not null default now()
);
create table if not exists growth.experiments(
 version text primary key, config jsonb not null check(jsonb_typeof(config)='object'),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists growth.decisions(
 version text primary key references growth.experiments(version),
 decision text not null check(decision in ('KEEP','CHANGE','STOP')),
 reason text not null, evidence jsonb not null, decided_by uuid not null references auth.users(id),
 decided_at timestamptz not null default now()
);
create table if not exists growth.served_cards(
 user_id uuid not null references auth.users(id) on delete cascade,
 work_id bigint not null references public.works(id), kst_day date not null,
 experiment text not null default 'RULES', variant text not null check(variant in ('CONTROL','NEWCOMER')),
 created_at timestamptz not null default now(), primary key(user_id,work_id,kst_day,experiment)
);
create index if not exists growth_served_date_idx on growth.served_cards(created_at);
create index if not exists growth_served_work_idx on growth.served_cards(work_id,created_at);
create index if not exists growth_reading_work_idx on authoring.reader_events_v2(work_id,user_id,created_at);
create table if not exists growth.evaluations(
 work_id bigint not null references public.works(id), kst_day date not null,
 version text not null references growth.experiments(version), cutoff timestamptz not null,
 previous_tier text not null check(previous_tier='UNCLASSIFIED'), tier_revision bigint not null check(tier_revision=0),
 evidence jsonb not null, primary key(work_id,kst_day,version)
);
create table if not exists growth.outbox(
 work_id bigint not null, kst_day date not null, version text not null,
 state text not null default 'DRY_RUN' check(state='DRY_RUN'),
 primary key(work_id,kst_day,version),
 foreign key(work_id,kst_day,version) references growth.evaluations(work_id,kst_day,version)
);
create table if not exists growth.publication_activity(
 version_id uuid primary key references authoring.publication_versions(id),
 work_id bigint not null references public.works(id), episode_id bigint not null references public.episodes(id),
 kind text not null check(kind in ('BASELINE','NEW_EPISODE','REPLACED_HEAD')),
 created_at timestamptz not null default now()
);
create index if not exists growth_publication_work_idx on growth.publication_activity(work_id,created_at);
-- Existing heads are a baseline, never fabricated new serial activity.
insert into growth.publication_activity(version_id,work_id,episode_id,kind,created_at)
 select h.version_id,e.work_id,e.id,'BASELINE',h.published_at from authoring.publication_heads h
 join public.episodes e on e.id=h.episode_id on conflict do nothing;
create or replace function growth.record_publication() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.version_id=old.version_id then return new; end if;
 insert into growth.publication_activity(version_id,work_id,episode_id,kind,created_at)
 select new.version_id,e.work_id,e.id,case when tg_op='INSERT' and not exists(
  select 1 from growth.publication_activity p where p.episode_id=e.id) then 'NEW_EPISODE' else 'REPLACED_HEAD' end,
  new.published_at from public.episodes e where e.id=new.episode_id on conflict do nothing;
 return new;
end $$;
drop trigger if exists growth_publication_activity on authoring.publication_heads;
create trigger growth_publication_activity after insert or update on authoring.publication_heads
 for each row execute function growth.record_publication();
-- RPCs own all access; neither direct REST nor browser roles can query these tables.
do $$ declare t text; begin
 foreach t in array array['preferences','experiments','decisions','served_cards','evaluations','outbox','publication_activity'] loop
  execute format('alter table growth.%I enable row level security',t);
  execute format('revoke all on growth.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
create or replace function growth.eligible(p_user uuid,p_asof timestamptz)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from auth.users u join public.readers r on r.auth_user_id=u.id
  where u.id=p_user and r.status::text='ACTIVE' and u.email_confirmed_at is not null
  and u.is_anonymous is not true and (u.banned_until is null or u.banned_until<=p_asof))
$$;
create or replace function growth.events(p_work bigint,p_asof timestamptz)
returns table(user_id uuid,episode_id bigint,event_type text,event_day date,occurred_at timestamptz)
language sql stable set search_path='' as $$
 select ev.user_id,ev.episode_id,ev.event_type,(ev.created_at at time zone 'Asia/Seoul')::date,ev.created_at
 from authoring.reader_events_v2 ev
 join growth.preferences pref on pref.user_id=ev.user_id and pref.consent
 join authoring.stage18_episode_rows(p_work,p_asof) ep on ep.episode_id=ev.episode_id
 where ev.work_id=p_work and ev.created_at>=pref.metrics_since
  and ev.created_at<p_asof
  and growth.eligible(ev.user_id,p_asof)
  and not exists(select 1 from public.works w join public.authors a on a.id=w.author_id
   where w.id=p_work and a.auth_user_id=ev.user_id)
$$;
create or replace function growth.retention(p_work bigint,p_asof timestamptz,p_days integer)
returns jsonb language sql stable set search_path='' as $$
 with events as (select distinct user_id,event_day from growth.events(p_work,p_asof)),
 cohorts as (select user_id,min(event_day) d0 from events group by user_id),
 mature as (select c.* from cohorts c
  where ((c.d0+p_days+1)::timestamp at time zone 'Asia/Seoul')<=p_asof),
 counts as (select (select count(*) from cohorts) all_n,count(*) n,
  count(*) filter(where exists(select 1 from events e where e.user_id=m.user_id and e.event_day=m.d0+p_days)) returned
  from mature m)
 select jsonb_build_object('definition','KST_RETURN_ON','days',p_days,
  'status',case when all_n=0 then 'EMPTY' when n=0 then 'PENDING' when n<5 then 'INSUFFICIENT' else 'READY' end,
  'denominator',case when n>=5 then n end,'returned',case when n>=5 then returned end,
  'rate',case when n>=5 then round(returned::numeric/n,4) end) from counts
$$;
create or replace function growth.metrics(p_work bigint,p_asof timestamptz)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb; readers_n bigint; pairs_n bigint; completed_n bigint; favorites_n bigint;
 served_n bigint; first_n bigint; chars_n bigint; episodes_n bigint; panels_n bigint; heads jsonb;
begin
 select count(distinct user_id),count(*),count(*) filter(where completed) into readers_n,pairs_n,completed_n
 from (select user_id,episode_id,bool_or(event_type='COMPLETE') completed from growth.events(p_work,p_asof)
  where occurred_at>=p_asof-interval '14 days' group by user_id,episode_id) x;
 select count(*) into favorites_n from authoring.reader_favorites f
 join growth.preferences p on p.user_id=f.user_id and p.consent
 where f.work_id=p_work and f.created_at>=p.metrics_since and f.created_at<p_asof
  and growth.eligible(f.user_id,p_asof) and not exists(select 1 from public.works w
   join public.authors a on a.id=w.author_id where w.id=p_work and a.auth_user_id=f.user_id)
  and exists(select 1 from authoring.stage18_episode_rows(p_work,p_asof));
 select count(distinct s.user_id),count(distinct s.user_id) filter(where exists(
  select 1 from growth.events(p_work,p_asof) ev where ev.user_id=s.user_id
  and ev.occurred_at>=s.created_at and ev.occurred_at<s.created_at+interval '7 days')) into served_n,first_n
 from growth.served_cards s join growth.preferences p on p.user_id=s.user_id and p.consent
 where s.work_id=p_work and s.created_at>=p.metrics_since and s.created_at<p_asof-interval '7 days'
  and s.created_at>=p_asof-interval '21 days' and growth.eligible(s.user_id,p_asof)
  and not exists(select 1 from public.works w join public.authors a on a.id=w.author_id
   where w.id=p_work and a.auth_user_id=s.user_id)
  and exists(select 1 from authoring.stage18_episode_rows(p_work,p_asof));
 select count(*),coalesce(sum(case when w.content_type='NOVEL' then char_length(v.content) else 0 end),0),
  coalesce(sum(case when w.content_type='WEBTOON' then jsonb_array_length(v.webtoon->'assetIds') else 0 end),0),
  coalesce(jsonb_agg(jsonb_build_object('episodeId',ep.episode_id::text,'versionId',v.id) order by ep.episode_id),'[]')
 into episodes_n,chars_n,panels_n,heads
 from authoring.stage18_episode_rows(p_work,p_asof) ep
 join authoring.publication_versions v on v.id=(ep.item->>'versionId')::uuid
 join public.works w on w.id=p_work;
 result:=jsonb_build_object('asOf',p_asof,'scope','CONSENTED_CURRENT_PUBLIC_FREE_HEADS',
  'readingMetric','AUTHENTICATED_PROGRESS_PROXY','windowDays',14,'minSample',5,
  'episodes',episodes_n,'novelCharactersWithSpaces',chars_n,'webtoonAssets',panels_n,'heads',heads,
  'reading',jsonb_build_object('status',case when readers_n=0 then 'EMPTY' when readers_n<5 then 'INSUFFICIENT' else 'READY' end,
   'uniqueReaders',case when readers_n>=5 then readers_n end,'readerEpisodePairs',case when readers_n>=5 then pairs_n end,
   'completionProxy',case when readers_n>=5 and pairs_n>=5 then round(completed_n::numeric/pairs_n,4) end),
  'favoritesCurrent',case when favorites_n>=5 then favorites_n end,
  'providedCards',jsonb_build_object('definition','SERVER_PROVIDED_NOT_VIEWPORT','windowDays',21,'followupDays',7,
   'denominator',case when served_n>=5 then served_n end,'subsequentReaders',case when served_n>=5 then first_n end,
   'rate',case when served_n>=5 then round(first_n::numeric/served_n,4) end),
  'd7',growth.retention(p_work,p_asof,7),'d28',growth.retention(p_work,p_asof,28),
  'serialSupply',(select jsonb_build_object('definition','POST_017_PUBLIC_NEW_EPISODES','windowDays',14,
   'newEpisodes',count(*) filter(where p.kind='NEW_EPISODE'),'replacedHeads',count(*) filter(where p.kind='REPLACED_HEAD'),
   'activeKstDays',count(distinct (p.created_at at time zone 'Asia/Seoul')::date) filter(where p.kind='NEW_EPISODE'))
   from growth.publication_activity p join authoring.stage18_episode_rows(p_work,p_asof) ep on ep.episode_id=p.episode_id
   where p.work_id=p_work and p.created_at>=p_asof-interval '14 days' and p.created_at<p_asof and p.kind<>'BASELINE'));
 return result;
end $$;
create or replace function growth.evaluate(p_work bigint,p_version text,p_day date)
returns jsonb language plpgsql set search_path='' as $$
declare config jsonb; evidence jsonb; cutoff timestamptz:=p_day::timestamp at time zone 'Asia/Seoul';
 matched boolean; kind text; existing jsonb; status text;
begin
 perform pg_advisory_xact_lock(hashtextextended('growth:'||p_work||':'||p_version||':'||p_day,0));
 select e.evidence into existing from growth.evaluations e where work_id=p_work and version=p_version and kst_day=p_day;
 if found then return existing; end if;
 select x.config into config from growth.experiments x where version=p_version;
 if not found then return jsonb_build_object('error','POLICY_NOT_FOUND','status',404); end if;
 select w.content_type::text into kind from public.works w where w.id=p_work;
 if kind is distinct from config->>'type' then return jsonb_build_object('error','TYPE_POLICY_REQUIRED','status',409); end if;
 if not exists(select 1 from authoring.stage18_episode_rows(p_work,cutoff)) then
  return jsonb_build_object('error','WORK_NOT_ELIGIBLE_AT_CUTOFF','status',409); end if;
 evidence:=growth.metrics(p_work,cutoff);
 if evidence->'reading'->>'status'<>'READY' or evidence->>'favoritesCurrent' is null then status:='INSUFFICIENT_SAMPLE';
 else
  matched:=(evidence->>'episodes')::bigint >= (config->>'minEpisodes')::integer
   and (kind='WEBTOON' or (evidence->>'novelCharactersWithSpaces')::bigint >= (config->>'minCharacters')::integer)
   and (evidence->'reading'->>'uniqueReaders')::bigint >= (config->>'minReaders')::integer
   and (evidence->>'favoritesCurrent')::bigint >= (config->>'minFavorites')::integer
   and (evidence->'reading'->>'readerEpisodePairs')::bigint >= (config->>'minCompletionSample')::integer
   and (evidence->'reading'->>'completionProxy')::numeric >= (config->>'minCompletionRate')::numeric;
  status:=case when matched then 'HYPOTHESIS_MATCH_MAPPING_REQUIRED' else 'BELOW_HYPOTHESIS' end;
 end if;
 evidence:=evidence||jsonb_build_object('workId',p_work::text,'kstDay',p_day,'policyVersion',p_version,
  'policyKind','HYPOTHESIS','policy',config,'decision',status,'previousTier','UNCLASSIFIED','tierRevision',0,
  'actualPromotion',false,'notificationSent',false);
 insert into growth.evaluations values(p_work,p_day,p_version,cutoff,'UNCLASSIFIED',0,evidence);
 insert into growth.outbox(work_id,kst_day,version) values(p_work,p_day,p_version);
 return evidence;
end $$;
create or replace function public.stage21_growth(p_user uuid,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare now_at timestamptz:=now(); pref growth.preferences; cfg jsonb; rows jsonb; version_id text;
 variant text:='NEWCOMER'; v_work bigint; is_admin boolean; current_day date; existing jsonb; excluded text[]; variants jsonb; supply jsonb;
begin
 if p_action not in ('feed','preferences','save-preferences','reset','report','admin','configure','decide','evaluate','seo')
 or jsonb_typeof(p_data)<>'object' then return jsonb_build_object('error','INVALID_ACTION','status',400); end if;
 if p_action not in ('feed','seo') and (p_user is null or not exists(select 1 from auth.users u where u.id=p_user
  and u.email_confirmed_at is not null and u.is_anonymous is not true and (u.banned_until is null or u.banned_until<=now_at))
  or exists(select 1 from public.readers r where r.auth_user_id=p_user and r.status::text<>'ACTIVE')
  or exists(select 1 from public.authors a where a.auth_user_id=p_user and a.status::text<>'APPROVED')
  or exists(select 1 from public.admin_users a where a.auth_user_id=p_user and not a.is_active)) then
  return jsonb_build_object('error','ACCOUNT_INACTIVE','status',403); end if;
 is_admin:=exists(select 1 from public.admin_users a where a.auth_user_id=p_user and a.is_active and a.role::text='SUPER_ADMIN');
 if p_action in ('preferences','save-preferences','reset') then
  if not growth.eligible(p_user,now_at) then return jsonb_build_object('error','READER_REQUIRED','status',403); end if;
  perform pg_advisory_xact_lock(hashtextextended('growth-preferences:'||p_user,0));
  insert into growth.preferences(user_id) values(p_user) on conflict do nothing;
  if p_action='save-preferences' then
   if (select count(*) from jsonb_object_keys(p_data))<>3 or not p_data ?& array['excludedGenres','frequency','analyticsConsent']
   or exists(select 1 from jsonb_each(p_data) where value='null'::jsonb)
   or jsonb_typeof(p_data->'excludedGenres')<>'array' or jsonb_array_length(p_data->'excludedGenres')>8
   or exists(select 1 from jsonb_array_elements(p_data->'excludedGenres') g where jsonb_typeof(g)<>'string' or char_length(g#>>'{}') not between 1 and 40 or (g#>>'{}')~'[[:cntrl:]<>]')
   or p_data->>'frequency' not in ('OFF','WEEKLY','DAILY') or jsonb_typeof(p_data->'analyticsConsent')<>'boolean'
   then return jsonb_build_object('error','INVALID_PREFERENCES','status',400); end if;
   select coalesce(array_agg(distinct value),'{}') into excluded from jsonb_array_elements_text(p_data->'excludedGenres');
   update growth.preferences set excluded_genres=excluded,frequency=p_data->>'frequency',
    metrics_since=case when (p_data->>'analyticsConsent')::boolean and not consent then now_at
     when not (p_data->>'analyticsConsent')::boolean then null else metrics_since end,
    consent=(p_data->>'analyticsConsent')::boolean,updated_at=now_at where user_id=p_user;
   if not (p_data->>'analyticsConsent')::boolean then delete from growth.served_cards where user_id=p_user; end if;
  elsif p_action='reset' then update growth.preferences set excluded_genres='{}',frequency='OFF',updated_at=now_at where user_id=p_user; end if;
  select * into pref from growth.preferences where user_id=p_user;
  return jsonb_build_object('excludedGenres',pref.excluded_genres,'frequency',pref.frequency,'analyticsConsent',pref.consent,'metricsSince',pref.metrics_since);
 end if;
 if p_action='feed' then
  if p_user is not null and not growth.eligible(p_user,now_at) then return jsonb_build_object('error','READER_REQUIRED','status',403); end if;
  select * into pref from growth.preferences where user_id=p_user;
  select x.version,x.config into version_id,cfg from growth.experiments x
   where (x.config->>'startsAt')::timestamptz<=now_at and (x.config->>'endsAt')::timestamptz>now_at
   and (p_data->>'webtoon'='true' or x.config->>'type'='NOVEL')
   and not exists(select 1 from growth.decisions d where d.version=x.version)
   order by x.created_at desc,x.version limit 1;
  if version_id is not null and pref.consent and (get_byte(decode(md5(p_user::text||version_id),'hex'),0)%2)=0 then variant:='CONTROL'; end if;
  with candidates as (select r.item,row_number() over(partition by r.item->>'author_id' order by r.first_published_at desc,r.work_id desc) author_rank,
   r.first_published_at,r.work_id from authoring.stage18_work_rows(now_at) r
   where r.episode_count>0 and r.first_published_at>=now_at-interval '30 days'
   and (p_data->>'webtoon'='true' or r.item->>'content_type'='NOVEL')
   and (not coalesce(pref.consent,false) or version_id is null or r.item->>'content_type'=cfg->>'type')
   and not exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(r.item->'genre')='array' then r.item->'genre' else jsonb_build_array(r.item->'genre') end) g
    where g=any(coalesce(pref.excluded_genres,'{}')))),
  authors_capped as (select *,row_number() over(partition by coalesce(item->'genre'->>0,item->>'genre')
   order by first_published_at desc,work_id desc) genre_rank from candidates where author_rank<=1),
  selected as (select * from authors_capped where genre_rank<=3
   order by case when variant='CONTROL' then work_id end desc,first_published_at desc,work_id desc limit 8)
  select coalesce(jsonb_agg(item||jsonb_build_object('reason',case when variant='CONTROL' then 'GENRE_ROTATION' else 'RECENT_PUBLIC_SERIAL' end)
   order by case when variant='CONTROL' then work_id end desc,first_published_at desc,work_id desc),'[]') into rows from selected;
  if pref.consent then
   insert into growth.served_cards(user_id,work_id,kst_day,experiment,variant)
   select p_user,(value->>'id')::bigint,(now_at at time zone 'Asia/Seoul')::date,coalesce(version_id,'RULES'),variant from jsonb_array_elements(rows)
    where not exists(select 1 from public.works w join public.authors a on a.id=w.author_id where w.id=(value->>'id')::bigint and a.auth_user_id=p_user)
   on conflict do nothing;
  end if;
  return jsonb_build_object('works',rows,'experiment',case when pref.consent then version_id end,'variant',variant,
   'measurement','SERVER_PROVIDED_NOT_VIEWPORT','analyticsConsent',coalesce(pref.consent,false));
 end if;
 if p_action='seo' then
  select coalesce(jsonb_agg(jsonb_build_object('id',r.work_id::text,'title',r.item->>'title',
   'description',left(r.item->>'description',200),'lastModified',r.last_published_at,'cover',r.item->>'cover_image') order by r.work_id),'[]') into rows
  from (select * from authoring.stage18_work_rows(now_at) r where r.episode_count>0
   and (p_data->>'webtoon'='true' or r.item->>'content_type'='NOVEL')
   and (not (p_data ? 'workId') or r.work_id=(p_data->>'workId')::bigint) order by r.work_id limit 1001) r;
  return jsonb_build_object('items',rows);
 end if;
 if p_action='report' then
  v_work:=(p_data->>'workId')::bigint;
  if not exists(select 1 from public.works w join public.authors a on a.id=w.author_id
   where w.id=v_work and a.auth_user_id=p_user and a.status::text='APPROVED') then
   return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
  return growth.metrics(v_work,now_at)||jsonb_build_object('workId',v_work::text);
 end if;
 if not is_admin then return jsonb_build_object('error','ADMIN_FORBIDDEN','status',403); end if;
 if p_action='configure' then
  cfg:=p_data->'config'; version_id:=p_data->>'version';
  if version_id is null or version_id!~'^[A-Za-z0-9_-]{1,60}$' or jsonb_typeof(cfg)<>'object'
  or (select count(*) from jsonb_object_keys(cfg))<>12
  or not cfg ?& array['hypothesis','control','type','startsAt','endsAt','minEpisodes','minCharacters','minReaders','minFavorites','minCompletionSample','minCompletionRate','costBudgetKrw']
  or exists(select 1 from jsonb_each(cfg) where value='null'::jsonb)
  or exists(select 1 from jsonb_each(cfg) where key in ('minEpisodes','minCharacters','minReaders','minFavorites','minCompletionSample','minCompletionRate','costBudgetKrw') and jsonb_typeof(value)<>'number')
  or char_length(cfg->>'hypothesis') not between 10 and 1000 or char_length(cfg->>'control') not between 10 and 1000
  or cfg->>'type' not in ('NOVEL','WEBTOON') or (cfg->>'minEpisodes')::integer not between 1 and 1000
  or (cfg->>'minCharacters')::integer not between 0 and 10000000 or (cfg->>'minReaders')::integer not between 5 and 10000000
  or (cfg->>'minFavorites')::integer not between 5 and 10000000 or (cfg->>'minCompletionSample')::integer not between 5 and 10000000
  or (cfg->>'minCompletionRate')::numeric not between 0 and 1 or (cfg->>'costBudgetKrw')::numeric not between 0 and 1000000000
  or (cfg->>'endsAt')::timestamptz<=(cfg->>'startsAt')::timestamptz
  or (cfg->>'endsAt')::timestamptz>(cfg->>'startsAt')::timestamptz+interval '90 days'
  or not isfinite((cfg->>'startsAt')::timestamptz) or not isfinite((cfg->>'endsAt')::timestamptz)
  or (cfg->>'type'='WEBTOON' and (cfg->>'minCharacters')::integer<>0)
  then return jsonb_build_object('error','INVALID_POLICY','status',400); end if;
  perform pg_advisory_xact_lock(hashtextextended('growth-policy-configure',0));
  select config into existing from growth.experiments where version=version_id;
  if found and existing is distinct from cfg then return jsonb_build_object('error','POLICY_VERSION_CONFLICT','status',409); end if;
  if exists(select 1 from growth.experiments x where x.version<>version_id and x.config->>'type'=cfg->>'type'
   and (x.config->>'startsAt')::timestamptz<(cfg->>'endsAt')::timestamptz
   and (x.config->>'endsAt')::timestamptz>(cfg->>'startsAt')::timestamptz
   and not exists(select 1 from growth.decisions d where d.version=x.version)) then
   return jsonb_build_object('error','POLICY_WINDOW_CONFLICT','status',409); end if;
  insert into growth.experiments(version,config,created_by) values(version_id,cfg,p_user) on conflict do nothing;
  return jsonb_build_object('version',version_id,'kind','HYPOTHESIS');
 end if;
 if p_action='decide' then
  version_id:=p_data->>'version';
  if p_data->>'decision' not in ('KEEP','CHANGE','STOP') or char_length(p_data->>'reason') not between 10 and 2000
  or jsonb_typeof(p_data->'evidence')<>'object' then return jsonb_build_object('error','INVALID_DECISION','status',400); end if;
  perform pg_advisory_xact_lock(hashtextextended('growth-policy:'||version_id,0));
  if not exists(select 1 from growth.experiments where version=version_id) then return jsonb_build_object('error','POLICY_NOT_FOUND','status',404); end if;
  existing:=p_data-'version';
  if exists(select 1 from growth.decisions d where d.version=version_id and
   jsonb_build_object('decision',d.decision,'reason',d.reason,'evidence',d.evidence) is distinct from existing)
   then return jsonb_build_object('error','DECISION_CONFLICT','status',409); end if;
  insert into growth.decisions(version,decision,reason,evidence,decided_by)
   values(version_id,p_data->>'decision',p_data->>'reason',p_data->'evidence',p_user) on conflict do nothing;
  return jsonb_build_object('version',version_id,'decision',p_data->>'decision');
 end if;
 if p_action='evaluate' then
  current_day:=(now_at at time zone 'Asia/Seoul')::date;
  return growth.evaluate((p_data->>'workId')::bigint,p_data->>'version',current_day);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('version',x.version,'config',x.config,'decision',d.decision,
  'reason',d.reason,'evidence',d.evidence) order by x.created_at desc),'[]') into rows
 from (select * from growth.experiments order by created_at desc limit 30) x left join growth.decisions d on d.version=x.version;
 select coalesce(jsonb_agg(jsonb_build_object('workId',r.work_id::text,'title',r.item->>'title','genre',r.item->'genre',
  'type',r.item->>'content_type','metrics',growth.metrics(r.work_id,now_at))),'[]') into existing
 from (select * from authoring.stage18_work_rows(now_at) where episode_count>0 order by work_id desc limit 50) r;
 with cards as (select s.experiment,s.variant,s.user_id,s.work_id,min(s.created_at) first_card
  from growth.served_cards s join growth.preferences p on p.user_id=s.user_id and p.consent
  join authoring.stage18_work_rows(now_at) w on w.work_id=s.work_id and w.episode_count>0
  where s.created_at>=p.metrics_since and s.created_at>=now_at-interval '21 days' and s.created_at<=now_at-interval '7 days'
   and growth.eligible(s.user_id,now_at) and not exists(select 1 from public.authors a
    where a.id=(w.item->>'author_id')::bigint and a.auth_user_id=s.user_id)
  group by s.experiment,s.variant,s.user_id,s.work_id),
 summary as (select c.experiment,c.variant,count(distinct c.user_id) users_n,count(*) pairs_n,
  count(*) filter(where exists(select 1 from growth.events(c.work_id,now_at) ev where ev.user_id=c.user_id
   and ev.occurred_at>=c.first_card and ev.occurred_at<c.first_card+interval '7 days')) reading_n
  from cards c group by c.experiment,c.variant)
 select coalesce(jsonb_agg(jsonb_build_object('version',s.experiment,'variant',s.variant,
  'status',case when s.users_n>=5 then 'READY' else 'INSUFFICIENT' end,
  'providedReaderWorkPairs',case when s.users_n>=5 then s.pairs_n end,
  'subsequentReadingPairs',case when s.users_n>=5 then s.reading_n end)),'[]') into variants from summary s;
 with boundary as (select (now_at at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul' cutoff),
 active as (select w.author_id,bool_or(p.created_at<b.cutoff-interval '7 days') prior_week,
  bool_or(p.created_at>=b.cutoff-interval '7 days') next_week
  from growth.publication_activity p join public.works w on w.id=p.work_id
  join public.authors a on a.id=w.author_id and a.status::text='APPROVED'
  cross join boundary b where p.kind='NEW_EPISODE' and p.created_at>=b.cutoff-interval '14 days' and p.created_at<b.cutoff
   and exists(select 1 from authoring.stage18_episode_rows(w.id,now_at) ep where ep.episode_id=p.episode_id)
  group by w.author_id),
 counts as (select count(*) filter(where prior_week) n,count(*) filter(where prior_week and next_week) continued from active)
 select jsonb_build_object('definition','POST_017_TWO_COMPLETED_KST_7_DAY_WINDOWS',
  'status',case when not exists(select 1 from authoring.migrations where version='authoring-017' and applied_at<=now_at-interval '14 days') then 'PENDING'
   when n=0 then 'EMPTY' when n<5 then 'INSUFFICIENT' else 'READY' end,
  'denominator',case when n>=5 and exists(select 1 from authoring.migrations where version='authoring-017' and applied_at<=now_at-interval '14 days') then n end,
  'continuedAuthors',case when n>=5 and exists(select 1 from authoring.migrations where version='authoring-017' and applied_at<=now_at-interval '14 days') then continued end)
 into supply from counts;
 return jsonb_build_object('experiments',rows,'works',existing,'scope','LATEST_50_PUBLIC_FREE_WORKS','automaticPromotion',false,
  'serialContinuity',supply,
  'variantEvidence',variants,'comparison','FIXED_AUTHOR_GENRE_CAPS:CONTROL_ID_DESC:NEWCOMER_FIRST_PUBLIC_DESC',
  'evaluations',(select coalesce(jsonb_agg(e.evidence),'[]') from (select evidence from growth.evaluations order by kst_day desc,work_id desc limit 50) e));
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
 return jsonb_build_object('error','INVALID_INPUT','status',400);
end $$;
create or replace function public.run_growth_evaluations(p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare entry record; policy record; n integer:=0; day_at date:=(now() at time zone 'Asia/Seoul')::date;
 cutoff timestamptz; result jsonb; removed integer;
begin
 if p_limit not between 1 and 20 then raise exception 'Invalid batch limit'; end if;
 cutoff:=day_at::timestamp at time zone 'Asia/Seoul';
 -- Bounded privacy cleanup. No existing reading/favorite/manuscript rows are changed.
 with expired as (select ctid from growth.served_cards where created_at<now()-interval '90 days' order by created_at limit 1000)
 delete from growth.served_cards where ctid in (select ctid from expired);
 get diagnostics removed=row_count;
 perform pg_advisory_xact_lock(hashtextextended('growth-batch:'||day_at,0));
 for policy in select * from growth.experiments x where (x.config->>'startsAt')::timestamptz<=cutoff
  and (x.config->>'endsAt')::timestamptz>cutoff and not exists(select 1 from growth.decisions d where d.version=x.version)
  order by x.created_at,x.version loop
  for entry in select r.work_id from authoring.stage18_work_rows(cutoff) r where r.episode_count>0
   and r.item->>'content_type'=policy.config->>'type'
   and not exists(select 1 from growth.evaluations e where e.work_id=r.work_id and e.kst_day=day_at and e.version=policy.version)
   order by r.work_id limit p_limit-n loop
   result:=growth.evaluate(entry.work_id,policy.version,day_at); n:=n+1;
  end loop;
  exit when n>=p_limit;
 end loop;
 return jsonb_build_object('evaluated',n,'kstDay',day_at,'removedExpiredCards',removed,'dryRun',true);
end $$;
revoke all on all functions in schema growth from public,anon,authenticated,service_role;
do $$ declare t text; begin
 foreach t in array array['experiments','decisions','evaluations','outbox','publication_activity'] loop
  execute format('drop trigger if exists growth_immutable on growth.%I',t);
  execute format('create trigger growth_immutable before update or delete on growth.%I for each row execute function authoring.reject_mutation()',t);
 end loop;
end $$;
revoke all on function public.stage21_growth(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.run_growth_evaluations(integer) from public,anon,authenticated;
grant execute on function public.stage21_growth(uuid,text,jsonb),public.run_growth_evaluations(integer) to service_role;
insert into authoring.migrations(version) values('authoring-017') on conflict do nothing;
commit;
