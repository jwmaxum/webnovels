-- Reviewed LOCAL_SIMULATED TEST preparation only. No operational apply or LIVE migration.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if current_setting('webnovels.points_test_apply_verified',true) is distinct from 'true'
 or not exists(select 1 from authoring.migrations where version='authoring-021') then
  raise exception 'Reviewed OP-04 TEST-only scope and authoring-021 prerequisites required';
 end if;
end $$;
create schema if not exists commerce;
-- Preserve an existing commerce schema's ACL; only the new objects are locked down.

create table if not exists commerce.op04_config(
 singleton boolean primary key default true check(singleton),revision bigint not null default 0 check(revision>=0),
 mode text not null default 'TEST' check(mode='TEST'),provenance text not null default 'LOCAL_SIMULATED' check(provenance='LOCAL_SIMULATED')
);
create table if not exists commerce.op04_works(
 work_id bigint primary key references public.works(id) on delete restrict,enabled boolean not null,
 actor_id uuid not null references auth.users(id),reason text not null check(length(btrim(reason)) between 3 and 500),updated_at timestamptz not null default now()
);
create table if not exists commerce.op04_policies(
 id uuid primary key default gen_random_uuid(),sequence bigint not null unique,
 scope text not null check(scope in ('DEFAULT','WORK','EPISODE')),target_id bigint,
 points integer not null check(points between 0 and 1000000),starts_at timestamptz not null,
 actor_id uuid references auth.users(id),reason text not null check(length(btrim(reason)) between 3 and 500),created_at timestamptz not null default now(),
 check((scope='DEFAULT' and target_id is null) or (scope<>'DEFAULT' and target_id>0))
);
create table if not exists commerce.op04_wallets(
 user_id uuid primary key references auth.users(id) on delete restrict,balance_points bigint not null default 0 check(balance_points between 0 and 1000000000)
);
create table if not exists commerce.op04_quotes(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),episode_id bigint not null references public.episodes(id),
 work_id bigint not null references public.works(id),publication_id uuid not null references authoring.publication_versions(id),
 price_id uuid not null references commerce.op04_policies(id),points integer not null check(points between 0 and 1000000),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '5 minutes',check(expires_at>created_at and expires_at<=created_at+interval '5 minutes')
);
create index if not exists op04_quote_user_recent on commerce.op04_quotes(user_id,created_at desc);
create table if not exists commerce.op04_purchases(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),episode_id bigint not null references public.episodes(id),
 work_id bigint not null references public.works(id),author_id bigint not null references public.authors(id),
 publication_id uuid not null references authoring.publication_versions(id),price_id uuid not null references commerce.op04_policies(id),
 quote_id uuid not null references commerce.op04_quotes(id),request_id uuid not null,points integer not null check(points between 1 and 1000000),
 mode text not null default 'TEST' check(mode='TEST'),provenance text not null default 'LOCAL_SIMULATED' check(provenance='LOCAL_SIMULATED'),
 created_at timestamptz not null default now(),unique(user_id,request_id)
);
create table if not exists commerce.op04_entitlements(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),episode_id bigint not null references public.episodes(id),
 purchase_id uuid not null references commerce.op04_purchases(id),granted_at timestamptz not null default now(),expires_at timestamptz,revoked_at timestamptz,
 unique(user_id,episode_id),check(expires_at is null or expires_at>granted_at)
);
create table if not exists commerce.op04_ledger(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),actor_id uuid not null references auth.users(id),
 request_id uuid not null,kind text not null check(kind in ('CREDIT','DEBIT')),delta_points integer not null,
 purchase_id uuid references commerce.op04_purchases(id),reason text not null check(length(btrim(reason)) between 3 and 500),created_at timestamptz not null default now(),
 unique(actor_id,request_id),unique(purchase_id),check((kind='CREDIT' and delta_points between 1 and 1000000 and purchase_id is null) or (kind='DEBIT' and delta_points between -1000000 and -1 and purchase_id is not null))
);
create index if not exists op04_ledger_user_recent on commerce.op04_ledger(user_id,created_at desc,id);
create table if not exists commerce.op04_receipts(
 actor_id uuid not null references auth.users(id),request_id uuid not null,action text not null,fingerprint text not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(actor_id,request_id)
);
create table if not exists commerce.op04_audit(
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),action text not null,reason text not null,
 revision bigint,detail jsonb not null,created_at timestamptz not null default now()
);
insert into commerce.op04_config(singleton) values(true) on conflict do nothing;
insert into commerce.op04_policies(id,sequence,scope,points,starts_at,reason)
 values('00000000-0000-4000-8000-000000000004',0,'DEFAULT',100,'2000-01-01T00:00:00Z','사용자 지정 TEST 기본 100P') on conflict do nothing;

create or replace function commerce.op04_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'OP04_TEST_EVIDENCE_IMMUTABLE';end $$;
do $$ declare t text;begin
 foreach t in array array['op04_config','op04_works','op04_policies','op04_wallets','op04_quotes','op04_purchases','op04_entitlements','op04_ledger','op04_receipts','op04_audit'] loop
  execute format('alter table commerce.%I enable row level security',t);
  execute format('revoke all on commerce.%I from public,anon,authenticated,service_role',t);
 end loop;
 foreach t in array array['op04_policies','op04_quotes','op04_purchases','op04_ledger','op04_receipts','op04_audit'] loop
  execute format('drop trigger if exists op04_immutable on commerce.%I',t);
  execute format('create trigger op04_immutable before update or delete on commerce.%I for each row execute function commerce.op04_immutable()',t);
 end loop;
end $$;

create or replace function commerce.op04_work_visible(p_work bigint) returns boolean language sql stable set search_path='' as $$
 select authoring.stage18_work_visible(p_work) and exists(select 1 from public.works w join public.authors a on a.id=w.author_id
 join auth.users u on u.id=a.auth_user_id where w.id=p_work and a.status::text='APPROVED' and u.email_confirmed_at is not null
 and u.is_anonymous is not true and (u.banned_until is null or u.banned_until<=now()) and coalesce(to_jsonb(u)->>'deleted_at','')='')
$$;
create or replace function commerce.op04_episode_rows(p_work bigint default null)
returns table(episode_id bigint,work_id bigint,author_id bigint,episode_number integer,title text,version_id uuid,content_type text,content text,document jsonb,manifest jsonb)
language sql stable set search_path='' as $$
 select e.id,e.work_id,w.author_id,e.episode_number,v.title,h.version_id,w.content_type::text,v.content,v.content_document,v.webtoon
 from public.episodes e join public.works w on w.id=e.work_id
 join authoring.publication_heads h on h.episode_id=e.id
 join authoring.publication_versions v on v.id=h.version_id and v.episode_id=e.id and v.work_id=e.work_id
 where (p_work is null or e.work_id=p_work) and commerce.op04_work_visible(e.work_id)
 and e.status::text='PUBLISHED' and (e.scheduled_at is null or e.scheduled_at<=now()) and h.published_at<=now()
 and (w.published_at is null or w.published_at<=now())
 and (w.content_type::text='NOVEL' and v.webtoon is null or w.content_type::text='WEBTOON' and authoring.webtoon_manifest_valid(e.work_id,v.webtoon,true))
$$;
create or replace function commerce.op04_work_card(p_work bigint,p_admin boolean default false) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',w.id::text,'title',w.title,'author',coalesce(a.pen_name,''),'contentType',w.content_type::text)
 ||case when p_admin then jsonb_build_object('enabled',x.enabled) else '{}'::jsonb end
 from public.works w join public.authors a on a.id=w.author_id left join commerce.op04_works x on x.work_id=w.id where w.id=p_work
$$;
create or replace function commerce.op04_price(p_episode bigint) returns commerce.op04_policies language sql stable set search_path='' as $$
 select p from commerce.op04_policies p join public.episodes e on e.id=p_episode
 where p.starts_at<=now() and (p.scope='DEFAULT' or p.scope='WORK' and p.target_id=e.work_id or p.scope='EPISODE' and p.target_id=e.id)
 order by case p.scope when 'EPISODE' then 3 when 'WORK' then 2 else 1 end desc,p.starts_at desc,p.sequence desc limit 1
$$;
create or replace function commerce.op04_access(p_user uuid,p_episode bigint,p_number integer,p_points integer) returns text language sql stable set search_path='' as $$
 select case when p_number<=2 then 'MEMBER_FREE' when exists(select 1 from commerce.op04_entitlements r where r.user_id=p_user and r.episode_id=p_episode and r.revoked_at is null and (r.expires_at is null or r.expires_at>now())) then 'OWNED' when p_points=0 then 'MEMBER_FREE' else 'LOCKED' end
$$;
create or replace function commerce.op04_admin_state() returns jsonb language sql stable set search_path='' set timezone='UTC' as $$
 select jsonb_build_object('revision',(select revision::text from commerce.op04_config where singleton),
 'defaults',jsonb_build_object('freeEpisodes',2,'pricePoints',(select points from commerce.op04_policies where scope='DEFAULT' and starts_at<=now() order by starts_at desc,sequence desc limit 1)),
 'works',coalesce((select jsonb_agg(commerce.op04_work_card(work_id,true) order by work_id) from commerce.op04_works),'[]'::jsonb),
 'policies',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'scope',p.scope,'targetId',p.target_id::text,'points',p.points,'startsAt',p.starts_at,'reason',p.reason) order by p.sequence desc) from (select * from commerce.op04_policies order by sequence desc limit 100) p),'[]'::jsonb))
$$;

create or replace function public.op04_points_test(p_user uuid,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
#variable_conflict use_variable
declare base jsonb:='{"mode":"TEST","provenance":"LOCAL_SIMULATED"}';fields text[];admin_action boolean:=left(p_action,6)='admin-';
 write_action boolean:=p_action in ('purchase','admin-enroll','admin-policy','admin-credit');request_key uuid;fp text;receipt commerce.op04_receipts;
 cfg commerce.op04_config;revision_no bigint;id_no bigint;work_no bigint;off integer:=0;typ text;term text;total_no bigint;items jsonb;result jsonb;
 ep record;pr commerce.op04_policies;qt commerce.op04_quotes;ent commerce.op04_entitlements;balance bigint:=0;access_kind text;quote_key uuid;purchase_key uuid;target uuid;points_no integer;starts timestamptz;panel record;
begin
 perform 1 from auth.users u where u.id=p_user and u.email_confirmed_at is not null and u.is_anonymous is not true
 and (u.banned_until is null or u.banned_until<=now()) and coalesce(to_jsonb(u)->>'deleted_at','')='' for share;
 if not found then return jsonb_build_object('error','INVALID_SESSION','status',401);end if;
 if admin_action then
  perform 1 from public.admin_users where auth_user_id=p_user and is_active and role::text='SUPER_ADMIN'
   and (select count(*) from public.admin_users where auth_user_id=p_user)=1 for share;
  if not found then return jsonb_build_object('error','ADMIN_FORBIDDEN','status',403);end if;
 else
  perform 1 from public.readers where auth_user_id=p_user and status::text='ACTIVE'
   and (select count(*) from public.readers where auth_user_id=p_user)=1 for share;
  if not found then return jsonb_build_object('error','READER_REQUIRED','status',403);end if;
 end if;
 fields:=case p_action when 'works' then array['offset'] when 'episodes' then array['workId','offset'] when 'wallet' then array[]::text[] when 'quote' then array['episodeId'] when 'purchase' then array['quoteId','requestId'] when 'content' then array['episodeId'] when 'panel' then array['episodeId','versionId','panelId','format'] when 'admin-state' then array[]::text[] when 'admin-search' then array['q','type','offset'] when 'admin-enroll' then array['workId','enabled','revision','reason','requestId'] when 'admin-policy' then array['scope','targetId','points','startsAt','revision','reason','requestId'] when 'admin-credit' then array['targetUserId','points','reason','requestId'] end;
 if fields is null or jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text)>65536 or exists(select 1 from jsonb_object_keys(p_data) k where not k=any(fields)) then return jsonb_build_object('error','INVALID_TEST_REQUEST','status',400);end if;
 if write_action then
  if coalesce(p_data->>'requestId','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return jsonb_build_object('error','INVALID_TEST_REQUEST','status',400);end if;
  if admin_action and (jsonb_typeof(p_data->'reason') is distinct from 'string' or length(btrim(p_data->>'reason')) not between 3 and 500) then return jsonb_build_object('error','REASON_REQUIRED','status',400);end if;
  request_key:=(p_data->>'requestId')::uuid;fp:=md5(p_action||':'||p_data::text);
  perform pg_advisory_xact_lock(hashtextextended('op04-request:'||p_user||':'||request_key,0));
  select * into receipt from commerce.op04_receipts where actor_id=p_user and request_id=request_key;
  if found then if receipt.action<>p_action or receipt.fingerprint<>fp then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT','status',409);end if;return receipt.result||jsonb_build_object('replayed',true);end if;
 end if;
 if p_action in ('admin-enroll','admin-policy') then
  if jsonb_typeof(p_data->'revision') is distinct from 'string' or coalesce(p_data->>'revision','')!~'^(0|[1-9][0-9]{0,18})$' or (p_data->>'revision')::numeric>9223372036854775807 then return jsonb_build_object('error','INVALID_TEST_REQUEST','status',400);end if;
  select * into cfg from commerce.op04_config where singleton for update;
  if cfg.revision::text<>p_data->>'revision' then return jsonb_build_object('error','REVISION_CONFLICT','status',409);end if;
 else select * into cfg from commerce.op04_config where singleton for share;end if;
 if p_data?'offset' then if jsonb_typeof(p_data->'offset') is distinct from 'number' or p_data->>'offset'!~'^(0|[1-9][0-9]{0,5})$' or (p_data->>'offset')::numeric>100000 then return jsonb_build_object('error','INVALID_TEST_REQUEST','status',400);end if;off:=(p_data->>'offset')::integer;end if;
 if p_action in ('episodes','admin-enroll') then
  if jsonb_typeof(p_data->'workId') is distinct from 'string' or coalesce(p_data->>'workId','')!~'^[1-9][0-9]{0,18}$' or (p_data->>'workId')::numeric>9223372036854775807 then return jsonb_build_object('error','INVALID_TEST_REQUEST','status',400);end if;work_no:=(p_data->>'workId')::bigint;
 end if;
 if p_action in ('quote','content','panel') then
  if jsonb_typeof(p_data->'episodeId') is distinct from 'string' or coalesce(p_data->>'episodeId','')!~'^[1-9][0-9]{0,18}$' or (p_data->>'episodeId')::numeric>9223372036854775807 then return jsonb_build_object('error','INVALID_TEST_REQUEST','status',400);end if;id_no:=(p_data->>'episodeId')::bigint;
 end if;
 if p_action='admin-state' then return base||commerce.op04_admin_state();end if;
 if p_action in ('works','admin-search') then
  term:=coalesce(p_data->>'q','');typ:=coalesce(p_data->>'type','ALL');
  if length(term)>100 or typ not in ('ALL','NOVEL','WEBTOON') then return jsonb_build_object('error','INVALID_TEST_REQUEST','status',400);end if;
  with candidates as(select w.id from public.works w join public.authors a on a.id=w.author_id
   where commerce.op04_work_visible(w.id) and exists(select 1 from commerce.op04_episode_rows(w.id))
   and (p_action='admin-search' or exists(select 1 from commerce.op04_works x where x.work_id=w.id and x.enabled))
   and (typ='ALL' or w.content_type::text=typ) and (term='' or strpos(lower(w.title),lower(btrim(term)))>0 or strpos(lower(coalesce(a.pen_name,'')),lower(btrim(term)))>0 or w.id::text=term))
  select (select count(*) from candidates),coalesce((select jsonb_agg(commerce.op04_work_card(id) order by id) from (select id from candidates order by id limit 50 offset off) pg),'[]'::jsonb) into total_no,items;
  return base||jsonb_build_object('items',items,'offset',off,'limit',50,'total',total_no,'hasMore',total_no>off+50,'nextOffset',case when total_no>off+50 then off+50 else null end);
 end if;
 if p_action='episodes' then
  if not exists(select 1 from commerce.op04_works where work_id=work_no and enabled) then return jsonb_build_object('error','TEST_WORK_NOT_FOUND','status',404);end if;
  if not commerce.op04_work_visible(work_no) then return jsonb_build_object('error','CONTENT_NOT_AVAILABLE','status',404);end if;
  with rows as(select e.*,commerce.op04_price(e.episode_id) price from commerce.op04_episode_rows(work_no) e)
  select (select count(*) from rows),coalesce((select jsonb_agg(jsonb_build_object('id',r.episode_id::text,'workId',r.work_id::text,'episodeNumber',r.episode_number,'title',r.title,'versionId',r.version_id,'access',commerce.op04_access(p_user,r.episode_id,r.episode_number,(r.price).points),'pricePoints',case when r.episode_number<=2 then 0 else (r.price).points end,'priceVersion',(r.price).id) order by r.episode_number,r.episode_id) from (select * from rows order by episode_number,episode_id limit 50 offset off) r),'[]'::jsonb) into total_no,items;
  return base||jsonb_build_object('work',commerce.op04_work_card(work_no),'items',items,'offset',off,'limit',50,'total',total_no,'hasMore',total_no>off+50,'nextOffset',case when total_no>off+50 then off+50 else null end);
 end if;
 if p_action='wallet' then
  return base||jsonb_build_object('balancePoints',coalesce((select balance_points from commerce.op04_wallets where user_id=p_user),0),'ledger',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'kind',l.kind,'deltaPoints',l.delta_points,'createdAt',l.created_at) order by l.created_at desc,l.id) from (select * from commerce.op04_ledger where user_id=p_user order by created_at desc,id limit 50) l),'[]'::jsonb));
 end if;
 if p_action in ('quote','content','panel') then
  select * into ep from commerce.op04_episode_rows() where episode_id=id_no;
  if not found then return jsonb_build_object('error','CONTENT_NOT_AVAILABLE','status',404);end if;
  if not exists(select 1 from commerce.op04_works where work_id=ep.work_id and enabled) then return jsonb_build_object('error','TEST_WORK_NOT_FOUND','status',404);end if;
  pr:=commerce.op04_price(id_no);access_kind:=commerce.op04_access(p_user,id_no,ep.episode_number,pr.points);
  if p_action='quote' then
   perform pg_advisory_xact_lock(hashtextextended('op04-wallet:'||p_user,0));
   if (select count(*) from commerce.op04_quotes where user_id=p_user and created_at>now()-interval '1 minute')>=60 then return jsonb_build_object('error','RATE_LIMITED','status',429);end if;
   insert into commerce.op04_quotes(user_id,episode_id,work_id,publication_id,price_id,points) values(p_user,id_no,ep.work_id,ep.version_id,pr.id,case when ep.episode_number<=2 then 0 else pr.points end) returning * into qt;
   return base||jsonb_build_object('quote',jsonb_build_object('id',qt.id,'episodeId',id_no::text,'workId',ep.work_id::text,'versionId',qt.publication_id,'priceVersion',qt.price_id,'pricePoints',qt.points,'access',access_kind,'expiresAt',qt.expires_at),'balancePoints',coalesce((select balance_points from commerce.op04_wallets where user_id=p_user),0));
  end if;
  if access_kind='LOCKED' then return jsonb_build_object('error','EPISODE_LOCKED','status',403);end if;
  if p_action='content' then
   items:='[]'::jsonb;
   if ep.content_type='WEBTOON' then select coalesce(jsonb_agg(jsonb_build_object('id',v.value->>'id','order',v.ord-1,'width',(v.value->>'width')::integer,'height',(v.value->>'height')::integer,'format','webp') order by v.ord),'[]'::jsonb) into items from jsonb_array_elements(authoring.webtoon_panels_json(ep.manifest)) with ordinality v(value,ord);end if;
   return base||jsonb_build_object('episodeId',id_no::text,'workId',ep.work_id::text,'versionId',ep.version_id,'contentType',ep.content_type,'title',ep.title,'content',case when ep.content_type='NOVEL' then to_jsonb(ep.content) else 'null'::jsonb end,'contentDocument',case when ep.content_type='NOVEL' then ep.document else null end,'panels',items);
  end if;
  if coalesce(p_data->>'versionId','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or coalesce(p_data->>'panelId','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or coalesce(p_data->>'format','') not in ('webp','png') then return jsonb_build_object('error','INVALID_TEST_REQUEST','status',400);end if;
  if ep.content_type<>'WEBTOON' or ep.version_id<>(p_data->>'versionId')::uuid then return jsonb_build_object('error','CONTENT_NOT_AVAILABLE','status',404);end if;
  select a.id asset_id,p.part,p.webp_sha,p.png_sha into panel from authoring.webtoon_assets a join authoring.webtoon_panels p on p.asset_id=a.id
   where a.work_id=ep.work_id and a.state='READY' and a.id in(select value::uuid from jsonb_array_elements_text(ep.manifest->'assetIds')) and p.id=(p_data->>'panelId')::uuid;
  if not found then return jsonb_build_object('error','CONTENT_NOT_AVAILABLE','status',404);end if;
  return base||jsonb_build_object('bucket','authoring-webtoons','path','webtoon/'||ep.work_id||'/'||panel.asset_id||'/'||panel.part||'/'||case when p_data->>'format'='webp' then panel.webp_sha||'.webp' else panel.png_sha||'.png' end,'mimeType',case when p_data->>'format'='webp' then 'image/webp' else 'image/png' end,'bytes',null);
 end if;
 if p_action='purchase' then
  if coalesce(p_data->>'quoteId','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return jsonb_build_object('error','INVALID_TEST_REQUEST','status',400);end if;
  select * into qt from commerce.op04_quotes where id=(p_data->>'quoteId')::uuid and user_id=p_user;
  if not found then return jsonb_build_object('error','QUOTE_NOT_FOUND','status',404);end if;
  perform pg_advisory_xact_lock(hashtextextended('op04-wallet:'||p_user,0));
  perform pg_advisory_xact_lock(hashtextextended('op04-episode:'||p_user||':'||qt.episode_id,0));
  -- Match the publication writer's work/state/episode/head order. A concurrent
  -- approval or withdrawal is serialized with the confirmed purchase snapshot.
  perform 1 from public.works where id=qt.work_id for share;
  perform 1 from authoring.work_state where work_id=qt.work_id for share;
  perform 1 from public.episodes where id=qt.episode_id for share;
  perform 1 from authoring.publication_heads where episode_id=qt.episode_id for share;
  perform 1 from public.authors a join auth.users u on u.id=a.auth_user_id
   where a.id=(select author_id from public.works where id=qt.work_id) for share of a,u;
  select * into ep from commerce.op04_episode_rows() where episode_id=qt.episode_id;
  if not found then return jsonb_build_object('error','CONTENT_NOT_AVAILABLE','status',404);end if;
  if not exists(select 1 from commerce.op04_works where work_id=ep.work_id and enabled) then return jsonb_build_object('error','TEST_WORK_NOT_FOUND','status',404);end if;
  select balance_points into balance from commerce.op04_wallets where user_id=p_user for update;balance:=coalesce(balance,0);
  pr:=commerce.op04_price(ep.episode_id);access_kind:=commerce.op04_access(p_user,ep.episode_id,ep.episode_number,pr.points);
  if access_kind='LOCKED' then
   if qt.expires_at<=now() then return jsonb_build_object('error','QUOTE_EXPIRED','status',409);end if;
   if qt.publication_id<>ep.version_id then return jsonb_build_object('error','PUBLICATION_CHANGED','status',409);end if;
   if qt.price_id<>pr.id or qt.points<>pr.points then return jsonb_build_object('error','PRICE_CHANGED','status',409);end if;
   if balance<qt.points then return jsonb_build_object('error','INSUFFICIENT_POINTS','status',409);end if;
   update commerce.op04_wallets set balance_points=balance_points-qt.points where user_id=p_user;
   balance:=balance-qt.points;
   insert into commerce.op04_purchases(user_id,episode_id,work_id,author_id,publication_id,price_id,quote_id,request_id,points)
    values(p_user,ep.episode_id,ep.work_id,ep.author_id,ep.version_id,pr.id,qt.id,request_key,qt.points) returning id into purchase_key;
   insert into commerce.op04_ledger(user_id,actor_id,request_id,kind,delta_points,purchase_id,reason) values(p_user,p_user,request_key,'DEBIT',-qt.points,purchase_key,'TEST 회차 열람');
   insert into commerce.op04_entitlements(user_id,episode_id,purchase_id) values(p_user,ep.episode_id,purchase_key)
    on conflict(user_id,episode_id) do update set purchase_id=excluded.purchase_id,granted_at=now(),revoked_at=null,expires_at=null returning * into ent;
   result:=base||jsonb_build_object('episodeId',ep.episode_id::text,'access','OWNED','chargedPoints',qt.points,'balancePoints',balance,'entitlementId',ent.id,'replayed',false);
  else
   select * into ent from commerce.op04_entitlements where user_id=p_user and episode_id=ep.episode_id and revoked_at is null and (expires_at is null or expires_at>now());
   result:=base||jsonb_build_object('episodeId',ep.episode_id::text,'access',access_kind,'chargedPoints',0,'balancePoints',balance,'entitlementId',case when access_kind='OWNED' then ent.id else null end,'replayed',false);
  end if;
 elsif p_action='admin-enroll' then
  if jsonb_typeof(p_data->'enabled') is distinct from 'boolean' or not exists(select 1 from public.works where id=work_no) then return jsonb_build_object('error','INVALID_TEST_REQUEST','status',400);end if;
  if not exists(select 1 from commerce.op04_works where work_id=work_no) and (select count(*) from commerce.op04_works)>=1000 then return jsonb_build_object('error','TEST_WORK_LIMIT','status',409);end if;
  if (p_data->>'enabled')::boolean and not exists(select 1 from commerce.op04_episode_rows(work_no)) then return jsonb_build_object('error','CONTENT_NOT_AVAILABLE','status',404);end if;
  insert into commerce.op04_works(work_id,enabled,actor_id,reason) values(work_no,(p_data->>'enabled')::boolean,p_user,btrim(p_data->>'reason'))
   on conflict(work_id) do update set enabled=excluded.enabled,actor_id=p_user,reason=excluded.reason,updated_at=now();
  update commerce.op04_config set revision=revision+1 where singleton returning revision into revision_no;
  result:=base||commerce.op04_admin_state()||jsonb_build_object('saved',true,'replayed',false);
 elsif p_action='admin-policy' then
  if coalesce(p_data->>'scope','') not in ('DEFAULT','WORK','EPISODE') or jsonb_typeof(p_data->'points') is distinct from 'number' or coalesce(p_data->>'points','')!~'^(0|[1-9][0-9]{0,6})$' or (p_data->>'points')::numeric>1000000 then return jsonb_build_object('error','INVALID_TEST_REQUEST','status',400);end if;
  if p_data->>'scope'='DEFAULT' then if p_data->'targetId' is distinct from 'null'::jsonb then return jsonb_build_object('error','INVALID_TEST_REQUEST','status',400);end if;id_no:=null;
  else
   if jsonb_typeof(p_data->'targetId') is distinct from 'string' or coalesce(p_data->>'targetId','')!~'^[1-9][0-9]{0,18}$' or (p_data->>'targetId')::numeric>9223372036854775807 then return jsonb_build_object('error','INVALID_TEST_REQUEST','status',400);end if;id_no:=(p_data->>'targetId')::bigint;
   if p_data->>'scope'='WORK' then work_no:=id_no;else select work_id into work_no from public.episodes where id=id_no;end if;
   if not exists(select 1 from commerce.op04_works where work_id=work_no and enabled) then return jsonb_build_object('error','TEST_WORK_NOT_FOUND','status',404);end if;
  end if;
  if coalesce(p_data->>'startsAt','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$' then return jsonb_build_object('error','INVALID_TEST_REQUEST','status',400);end if;
  begin starts:=(p_data->>'startsAt')::timestamptz;exception when others then return jsonb_build_object('error','INVALID_TEST_REQUEST','status',400);end;
  if starts<now()-interval '5 minutes' then return jsonb_build_object('error','INVALID_TEST_REQUEST','status',400);end if;
  starts:=greatest(starts,now());update commerce.op04_config set revision=revision+1 where singleton returning revision into revision_no;
  insert into commerce.op04_policies(sequence,scope,target_id,points,starts_at,actor_id,reason) values(revision_no,p_data->>'scope',id_no,(p_data->>'points')::integer,starts,p_user,btrim(p_data->>'reason'));
  result:=base||commerce.op04_admin_state()||jsonb_build_object('saved',true,'replayed',false);
 elsif p_action='admin-credit' then
  if coalesce(p_data->>'targetUserId','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or jsonb_typeof(p_data->'points') is distinct from 'number' or coalesce(p_data->>'points','')!~'^[1-9][0-9]{0,6}$' or (p_data->>'points')::numeric>1000000 then return jsonb_build_object('error','INVALID_TEST_REQUEST','status',400);end if;
  target:=(p_data->>'targetUserId')::uuid;points_no:=(p_data->>'points')::integer;
  perform 1 from auth.users u join public.readers r on r.auth_user_id=u.id where u.id=target and r.status::text='ACTIVE' and u.email_confirmed_at is not null and u.is_anonymous is not true and (u.banned_until is null or u.banned_until<=now()) and coalesce(to_jsonb(u)->>'deleted_at','')=''
   and (select count(*) from public.readers where auth_user_id=target)=1 for share of u,r;
  if not found then return jsonb_build_object('error','READER_REQUIRED','status',403);end if;
  perform pg_advisory_xact_lock(hashtextextended('op04-wallet:'||target,0));
  insert into commerce.op04_wallets(user_id) values(target) on conflict do nothing;
  select balance_points into balance from commerce.op04_wallets where user_id=target for update;
  if balance+points_no>1000000000 then return jsonb_build_object('error','BALANCE_LIMIT','status',409);end if;
  update commerce.op04_wallets set balance_points=balance_points+points_no where user_id=target;
  insert into commerce.op04_ledger(user_id,actor_id,request_id,kind,delta_points,reason) values(target,p_user,request_key,'CREDIT',points_no,btrim(p_data->>'reason'));
  result:=base||jsonb_build_object('targetUserId',target,'balancePoints',balance+points_no,'creditedPoints',points_no,'replayed',false);
 else return jsonb_build_object('error','INVALID_TEST_REQUEST','status',400);end if;
 if admin_action then insert into commerce.op04_audit(actor_id,action,reason,revision,detail) values(p_user,p_action,btrim(p_data->>'reason'),revision_no,p_data-array['reason','requestId']);end if;
 insert into commerce.op04_receipts(actor_id,request_id,action,fingerprint,result) values(p_user,request_key,p_action,fp,result);
 return result;
end $$;
revoke all on function commerce.op04_immutable(),commerce.op04_work_visible(bigint),commerce.op04_episode_rows(bigint),commerce.op04_work_card(bigint,boolean),commerce.op04_price(bigint),commerce.op04_access(uuid,bigint,integer,integer),commerce.op04_admin_state() from public,anon,authenticated,service_role;
revoke all on function public.op04_points_test(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.op04_points_test(uuid,text,jsonb) to service_role;
insert into authoring.migrations(version) values('launch-019-points-test') on conflict do nothing;
notify pgrst,'reload schema';
commit;
