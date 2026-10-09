-- Reviewed additive migration. Never activates flags or backfills reading history.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
 or not exists(select 1 from authoring.migrations where version='authoring-017') then
  raise exception 'Verified authoring-017 application required';
 end if;
end $$;
alter table growth.preferences add column if not exists measurement_consent boolean not null default false;
alter table growth.preferences add column if not exists measurement_since timestamptz;
create table if not exists growth.delivery_receipts(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 work_id bigint not null references public.works(id),epoch timestamptz not null,kst_day date not null,
 experiment text not null,variant text not null check(variant in ('CONTROL','NEWCOMER')),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '24 hours',
 viewport_at timestamptz,unique(user_id,work_id,epoch,kst_day,experiment),check(expires_at=created_at+interval '24 hours')
);
create table if not exists growth.first_touches(
 user_id uuid not null references auth.users(id) on delete cascade,work_id bigint not null references public.works(id),
 epoch timestamptz not null,kind text not null check(kind in ('VIEWPORT','SHARE')),
 experiment text not null,variant text not null check(variant in ('CONTROL','NEWCOMER')),
 created_at timestamptz not null default now(),primary key(user_id,work_id,epoch,kind)
);
-- This minimal first marker lasts for the consent epoch; it is not a lifetime reading claim.
create table if not exists growth.first_deliveries(
 user_id uuid not null references auth.users(id) on delete cascade,work_id bigint not null references public.works(id),
 epoch timestamptz not null,episode_id bigint not null references public.episodes(id),
 version_id uuid not null references authoring.publication_versions(id),created_at timestamptz not null default now(),
 primary key(user_id,work_id,epoch)
);
create index if not exists growth_receipt_expiry_idx on growth.delivery_receipts(expires_at);
create index if not exists growth_touch_work_idx on growth.first_touches(work_id,created_at);
create index if not exists growth_delivery_work_idx on growth.first_deliveries(work_id,created_at);
do $$ declare t text; begin
 foreach t in array array['delivery_receipts','first_touches','first_deliveries'] loop
  execute format('alter table growth.%I enable row level security',t);
  execute format('revoke all on growth.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
-- Legacy preference clients must also revoke new data when the optional feature is off.
create or replace function growth.revoke_measurement() returns trigger language plpgsql set search_path='' as $$
begin
 if not new.consent then new.measurement_consent:=false; end if;
 if not new.measurement_consent then
  new.measurement_since:=null;
  delete from growth.delivery_receipts where user_id=new.user_id;
  delete from growth.first_touches where user_id=new.user_id;
  delete from growth.first_deliveries where user_id=new.user_id;
 end if;
 return new;
end $$;
drop trigger if exists growth_measurement_revoke on growth.preferences;
create trigger growth_measurement_revoke before update of consent,measurement_consent on growth.preferences
 for each row execute function growth.revoke_measurement();
create or replace function growth.measurement_eligible(p_user uuid,p_at timestamptz)
returns boolean language sql stable set search_path='' as $$
 select growth.eligible(p_user,p_at)
 and not exists(select 1 from public.authors where auth_user_id=p_user and status::text<>'APPROVED')
 and not exists(select 1 from public.admin_users where auth_user_id=p_user and not is_active)
 and exists(select 1 from growth.preferences where user_id=p_user and consent and measurement_consent
  and measurement_since is not null and measurement_since<=p_at)
$$;
create or replace function growth.measurement_work(p_work bigint,p_user uuid,p_at timestamptz)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from authoring.stage18_episode_rows(p_work,p_at))
 and not exists(select 1 from public.works w join public.authors a on a.id=w.author_id where w.id=p_work and a.auth_user_id=p_user)
$$;
create or replace function growth.funnel(p_work bigint,p_at timestamptz)
returns jsonb language plpgsql stable set search_path='' as $$
declare channels jsonb; first_count bigint;
begin
 with valid as (select t.*,d.created_at delivered from growth.first_touches t
  join growth.preferences p on p.user_id=t.user_id and p.measurement_since=t.epoch
  left join growth.first_deliveries d on d.user_id=t.user_id and d.work_id=t.work_id and d.epoch=t.epoch
  where t.work_id=p_work and t.created_at>=p_at-interval '28 days' and t.created_at<p_at
  and growth.measurement_eligible(t.user_id,p_at) and growth.measurement_work(p_work,t.user_id,p_at)),
 totals as (select k.kind,count(v.user_id) all_count,
  count(v.user_id) filter(where v.created_at+interval '24 hours'<=p_at) n,
  count(v.user_id) filter(where v.created_at+interval '24 hours'<=p_at and v.delivered>=v.created_at
   and v.delivered<v.created_at+interval '24 hours' and v.delivered<p_at) converted
  from (values('VIEWPORT'),('SHARE')) k(kind) left join valid v on v.kind=k.kind group by k.kind)
 select jsonb_object_agg(kind,jsonb_build_object('status',case when all_count=0 then 'EMPTY' when n=0 then 'PENDING' when n<5 then 'INSUFFICIENT' else 'READY' end,
  'denominator',case when n>=5 then n end,'converted',case when n>=5 then converted end,
  'rate',case when n>=5 then converted::numeric/n end,'windowHours',24)) into channels from totals;
 select count(*) into first_count from growth.first_deliveries d join growth.preferences p on p.user_id=d.user_id and p.measurement_since=d.epoch
  where d.work_id=p_work and d.created_at>=p_at-interval '28 days' and d.created_at<p_at
  and growth.measurement_eligible(d.user_id,p_at) and growth.measurement_work(p_work,d.user_id,p_at);
 return jsonb_build_object('measurement','FIRST_BODY_ISSUED_IN_CONSENT_EPOCH','firstBodies',case when first_count>=5 then first_count end,
  'firstBodyStatus',case when first_count=0 then 'EMPTY' when first_count<5 then 'INSUFFICIENT' else 'READY' end,'channels',channels);
end $$;

create or replace function growth.viewport_evidence(p_at timestamptz)
returns jsonb language sql stable set search_path='' as $$
 with valid as(select t.*,d.created_at delivered from growth.first_touches t
  join growth.preferences p on p.user_id=t.user_id and p.measurement_since=t.epoch
  left join growth.first_deliveries d on d.user_id=t.user_id and d.work_id=t.work_id and d.epoch=t.epoch
  where t.kind='VIEWPORT' and t.created_at>=p_at-interval '28 days' and t.created_at<p_at
  and growth.measurement_eligible(t.user_id,p_at) and growth.measurement_work(t.work_id,t.user_id,p_at)),
 selected as(select experiment from valid group by experiment order by max(created_at) desc,experiment limit 30),
 totals as(select experiment,variant,count(distinct user_id) filter(where created_at+interval '24 hours'<=p_at) users_n,
  count(*) filter(where created_at+interval '24 hours'<=p_at) n,
  count(*) filter(where created_at+interval '24 hours'<=p_at and delivered>=created_at and delivered<created_at+interval '24 hours' and delivered<p_at) converted
  from valid where experiment in(select experiment from selected) group by experiment,variant)
 select coalesce(jsonb_agg(jsonb_build_object('version',experiment,'variant',variant,
  'status',case when n=0 then 'PENDING' when users_n<5 then 'INSUFFICIENT' else 'READY' end,
  'readerWorkPairs',case when users_n>=5 then n end,'firstBodyPairs',case when users_n>=5 then converted end,
  'windowHours',24) order by experiment,variant),'[]') from totals
$$;

create or replace function public.stage22_episode_content(p_user uuid,p_episode_id bigint,p_webtoon boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; pref growth.preferences; w bigint;
begin
 if p_user is not null then perform pg_advisory_xact_lock(hashtextextended('growth-preferences:'||p_user,0)); end if;
 -- The returned version and marker use the same public-head query in this transaction.
 result:=case when p_webtoon then public.stage18_episode_content(p_episode_id) else public.stage16_episode_content(p_episode_id) end;
 if result ? 'error' or p_user is null or not growth.measurement_eligible(p_user,now()) then return result; end if;
 w:=(result->'episode'->>'work_id')::bigint;
 if not growth.measurement_work(w,p_user,now()) then return result; end if;
 select * into pref from growth.preferences where user_id=p_user;
 insert into growth.first_deliveries(user_id,work_id,epoch,episode_id,version_id)
 values(p_user,w,pref.measurement_since,p_episode_id,(result->'episode'->>'versionId')::uuid) on conflict do nothing;
 return result;
end $$;

create or replace function public.stage22_growth(p_user uuid,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; pref growth.preferences; receipt growth.delivery_receipts; rows jsonb; w bigint; bucket bigint;
begin
 if jsonb_typeof(p_data)<>'object' then return jsonb_build_object('error','INVALID_INPUT','status',400); end if;
 if p_data ? 'measurementConsent' and p_action<>'save-preferences' then return jsonb_build_object('error','INVALID_INPUT','status',400); end if;
 if p_action='seo' then
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('webtoon','workId','bucket'))
   or jsonb_typeof(p_data->'webtoon') is distinct from 'boolean' or (p_data ? 'workId' and p_data ? 'bucket') then
   return jsonb_build_object('error','INVALID_INPUT','status',400); end if;
  if p_data ? 'workId' then
   if jsonb_typeof(p_data->'workId')<>'string' or coalesce(p_data->>'workId','')!~'^[1-9][0-9]{0,18}$'
    or (p_data->>'workId')::numeric>9223372036854775807 then return jsonb_build_object('error','INVALID_INPUT','status',400); end if;
   w:=(p_data->>'workId')::bigint;
  elsif p_data ? 'bucket' then
   if jsonb_typeof(p_data->'bucket')<>'string' or coalesce(p_data->>'bucket','')!~'^(0|[1-9][0-9]{0,15})$'
    or (p_data->>'bucket')::numeric>9223372036854775 then return jsonb_build_object('error','INVALID_INPUT','status',400); end if;
   bucket:=(p_data->>'bucket')::bigint;
  end if;
  if w is null and bucket is null then
   select coalesce(jsonb_agg(b::text order by b),'[]') into rows from
    (select distinct (r.work_id-1)/1000 b from authoring.stage18_work_rows(now()) r where r.episode_count>0
     and ((p_data->>'webtoon')::boolean or r.item->>'content_type'='NOVEL') order by b limit 50001) parts;
   return jsonb_build_object('partitions',rows);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.work_id::text,'title',r.item->>'title','description',left(r.item->>'description',200),
   'lastModified',r.last_published_at,'cover',r.item->>'cover_image') order by r.work_id),'[]') into rows
   from authoring.stage18_work_rows(now()) r where r.episode_count>0
   and ((p_data->>'webtoon')::boolean or r.item->>'content_type'='NOVEL')
   and (w is null or r.work_id=w) and (bucket is null or (r.work_id-1)/1000=bucket);
  return jsonb_build_object('items',rows);
 end if;
 if p_user is not null then perform pg_advisory_xact_lock(hashtextextended('growth-preferences:'||p_user,0)); end if;
 if p_action in ('viewport','referral') then
  if jsonb_typeof(p_data->'webtoon') is distinct from 'boolean' then return jsonb_build_object('error','INVALID_INPUT','status',400); end if;
  if not growth.measurement_eligible(p_user,now()) then return jsonb_build_object('error','MEASUREMENT_CONSENT_REQUIRED','status',403); end if;
  select * into pref from growth.preferences where user_id=p_user;
  if p_action='viewport' then
   if (select count(*) from jsonb_object_keys(p_data))<>2 or not p_data ? 'receiptId' or jsonb_typeof(p_data->'receiptId') is distinct from 'string'
    or coalesce(p_data->>'receiptId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('error','INVALID_INPUT','status',400); end if;
   select * into receipt from growth.delivery_receipts where id=(p_data->>'receiptId')::uuid and user_id=p_user
    and epoch=pref.measurement_since and expires_at>now() for update;
   if not found or not growth.measurement_work(receipt.work_id,p_user,now()) then return jsonb_build_object('error','RECEIPT_UNAVAILABLE','status',404); end if;
   w:=receipt.work_id;
   if p_data->>'webtoon'<>'true' and exists(select 1 from public.works where id=w and content_type='WEBTOON') then
    return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
   update growth.delivery_receipts set viewport_at=coalesce(viewport_at,now()) where id=receipt.id;
  else
   if (select count(*) from jsonb_object_keys(p_data))<>3 or not p_data ?& array['workId','source','webtoon'] or p_data->>'source' is distinct from 'SHARE'
    or jsonb_typeof(p_data->'workId') is distinct from 'string' or coalesce(p_data->>'workId','')!~'^[1-9][0-9]{0,18}$'
    or (p_data->>'workId')::numeric>9223372036854775807 then return jsonb_build_object('error','INVALID_INPUT','status',400); end if;
   w:=(p_data->>'workId')::bigint;
   if not growth.measurement_work(w,p_user,now()) then return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
   if not exists(select 1 from growth.first_touches where user_id=p_user and work_id=w and epoch=pref.measurement_since and kind='SHARE')
    and (select count(*) from growth.first_touches where user_id=p_user and kind='SHARE' and created_at>=date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')>=30 then
    return jsonb_build_object('error','RATE_LIMITED','status',429); end if;
  end if;
  if p_data->>'webtoon'<>'true' and exists(select 1 from public.works where id=w and content_type='WEBTOON') then
   return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
  if not exists(select 1 from growth.first_deliveries where user_id=p_user and work_id=w and epoch=pref.measurement_since) then
   insert into growth.first_touches(user_id,work_id,epoch,kind,experiment,variant)
   values(p_user,w,pref.measurement_since,case when p_action='viewport' then 'VIEWPORT' else 'SHARE' end,
    coalesce(receipt.experiment,'SHARE'),coalesce(receipt.variant,'NEWCOMER')) on conflict do nothing;
  end if;
  return jsonb_build_object('recorded',true,'measurement',case when p_action='viewport' then 'CLIENT_REPORTED_VIEWPORT' else 'CLIENT_REPORTED_SHARE_MARKER' end);
 end if;
 if p_action='save-preferences' and p_data ? 'measurementConsent' and
  (jsonb_typeof(p_data->'measurementConsent') is distinct from 'boolean' or
   (p_data->>'measurementConsent'='true' and p_data->>'analyticsConsent' is distinct from 'true')) then
  return jsonb_build_object('error','INVALID_PREFERENCES','status',400); end if;
 result:=public.stage21_growth(p_user,p_action,p_data-'measurementConsent');
 if result ? 'error' then return result; end if;
 if p_action in ('preferences','save-preferences','reset') then
  if p_action='save-preferences' then
   update growth.preferences set measurement_consent=case when not consent then false when p_data ? 'measurementConsent' then (p_data->>'measurementConsent')::boolean else measurement_consent end,
    measurement_since=case when not consent or p_data->>'measurementConsent'='false' then null
     when p_data->>'measurementConsent'='true' and not measurement_consent then now() else measurement_since end where user_id=p_user;
   if not exists(select 1 from growth.preferences where user_id=p_user and measurement_consent) then
    delete from growth.delivery_receipts where user_id=p_user;delete from growth.first_touches where user_id=p_user;delete from growth.first_deliveries where user_id=p_user;
   end if;
  end if;
  select * into pref from growth.preferences where user_id=p_user;
  return result||jsonb_build_object('measurementConsent',pref.measurement_consent,'measurementSince',pref.measurement_since);
 end if;
 if p_action='feed' and growth.measurement_eligible(p_user,now()) then
  select * into pref from growth.preferences where user_id=p_user;
  insert into growth.delivery_receipts(user_id,work_id,epoch,kst_day,experiment,variant)
   select p_user,(x->>'id')::bigint,pref.measurement_since,(now() at time zone 'Asia/Seoul')::date,
    coalesce(result->>'experiment','RULES'),result->>'variant' from jsonb_array_elements(result->'works') with ordinality x(x,ord)
   where growth.measurement_work((x->>'id')::bigint,p_user,now())
    and not exists(select 1 from growth.delivery_receipts r where r.user_id=p_user and r.work_id=(x->>'id')::bigint
     and r.epoch=pref.measurement_since and r.kst_day=(now() at time zone 'Asia/Seoul')::date and r.experiment=coalesce(result->>'experiment','RULES'))
   order by ord limit greatest(0,200-(select count(*) from growth.delivery_receipts where user_id=p_user)) on conflict do nothing;
  select coalesce(jsonb_agg(x||jsonb_build_object('receiptId',r.id) order by ord),'[]') into rows
   from jsonb_array_elements(result->'works') with ordinality x(x,ord) left join growth.delivery_receipts r on r.user_id=p_user
    and r.work_id=(x->>'id')::bigint and r.epoch=pref.measurement_since and r.kst_day=(now() at time zone 'Asia/Seoul')::date
    and r.experiment=coalesce(result->>'experiment','RULES') and r.expires_at>now();
  return result||jsonb_build_object('works',rows,'measurementConsent',true);
 elsif p_action='report' then return result||jsonb_build_object('funnel',growth.funnel((p_data->>'workId')::bigint,now()));
 elsif p_action='admin' then
  select coalesce(jsonb_agg(x||jsonb_build_object('metrics',(x->'metrics')||jsonb_build_object('funnel',growth.funnel((x->>'workId')::bigint,now()))) order by ord),'[]') into rows
   from jsonb_array_elements(result->'works') with ordinality x(x,ord);
  return result||jsonb_build_object('works',rows,'viewportEvidence',growth.viewport_evidence(now()),
   'viewportEvidenceScope',jsonb_build_object('maxExperiments',30,'periodDays',28,'windowHours',24));
 end if;
 return result;
end $$;

create or replace function public.prune_growth_measurements(p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipts integer; touches integer;
begin
 if p_limit not between 1 and 1000 then raise exception 'Invalid cleanup batch'; end if;
 with expired as(select ctid from growth.delivery_receipts where expires_at<=now() order by expires_at limit p_limit for update skip locked)
 delete from growth.delivery_receipts where ctid in(select ctid from expired);get diagnostics receipts=row_count;
 with expired as(select ctid from growth.first_touches where created_at<now()-interval '90 days' order by created_at limit p_limit for update skip locked)
 delete from growth.first_touches where ctid in(select ctid from expired);get diagnostics touches=row_count;
 return jsonb_build_object('receiptsDeleted',receipts,'touchesDeleted',touches,'firstMarkersDeleted',0);
end $$;
revoke all on all functions in schema growth from public,anon,authenticated,service_role;
revoke all on function public.stage22_growth(uuid,text,jsonb),public.stage22_episode_content(uuid,bigint,boolean),public.prune_growth_measurements(integer) from public,anon,authenticated;
grant execute on function public.stage22_growth(uuid,text,jsonb),public.stage22_episode_content(uuid,bigint,boolean),public.prune_growth_measurements(integer) to service_role;
insert into authoring.migrations(version) values('authoring-018') on conflict do nothing;
notify pgrst,'reload schema';
commit;
