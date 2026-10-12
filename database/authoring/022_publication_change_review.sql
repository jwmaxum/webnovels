-- First publication is an author action. Only changes to published material enter this queue.
-- Apply after reviewed 021; preserve originals, drafts, receipts and public heads.
begin;
set local lock_timeout='5s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true' or not exists(select 1 from authoring.migrations where version='authoring-021') then raise exception 'Reviewed authoring-021 prerequisite required';end if;
end $$;
create table if not exists authoring.publication_changes(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),work_id bigint not null references public.works(id),
 kind text not null,arguments jsonb not null,baseline jsonb not null,candidate jsonb not null,
 request_fingerprint text generated always as (md5(arguments::text)) stored,
 created_at timestamptz not null default now(),unique(user_id,kind,request_fingerprint)
);
create table if not exists authoring.publication_change_decisions(
 change_id uuid primary key references authoring.publication_changes(id),admin_user_id uuid not null references auth.users(id),
 decision text not null check(decision in ('APPROVE','REJECT')),reason text not null check(length(reason) between 3 and 500),
 result jsonb not null,created_at timestamptz not null default now()
);
create table if not exists authoring.publication_history(
 work_id bigint primary key references public.works(id),first_recorded_at timestamptz not null default now()
);
insert into authoring.publication_history(work_id)
 select w.id from public.works w where w.published_at is not null or w.status::text in ('PUBLISHED','ONGOING','PAUSED','COMPLETED')
 or exists(select 1 from public.episodes e where e.work_id=w.id and ((to_jsonb(e)->>'published_at') is not null or e.status::text='PUBLISHED'))
 or exists(select 1 from authoring.publication_heads h join public.episodes e on e.id=h.episode_id where e.work_id=w.id)
 on conflict do nothing;
do $$ declare t text;begin
 foreach t in array array['publication_changes','publication_change_decisions','publication_history'] loop
 execute format('alter table authoring.%I enable row level security',t);
 execute format('revoke all on authoring.%I from public,anon,authenticated,service_role',t);
 execute format('drop trigger if exists immutable_review on authoring.%I',t);
 execute format('create trigger immutable_review before update or delete on authoring.%I for each row execute function authoring.workflow_immutable()',t);
 end loop;
end $$;

create or replace function authoring.change_baseline(w bigint) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('work',to_jsonb(ww)-array['view_count','like_count'], 'state',to_jsonb(s),
 'episodes',coalesce((select jsonb_agg(to_jsonb(e)-array['view_count'] order by e.id) from public.episodes e where e.work_id=w),'[]'),
 'heads',coalesce((select jsonb_agg(to_jsonb(h) order by h.episode_id) from authoring.publication_heads h join public.episodes e on e.id=h.episode_id where e.work_id=w),'[]'))
 from public.works ww join authoring.work_state s on s.work_id=ww.id where ww.id=w
$$;
-- Save original implementations privately. Renamed RPCs have no direct service-role grant.
do $$ begin
 if to_regprocedure('authoring.review_original_works(uuid,text,bigint,jsonb,uuid,text,bigint)') is null then
  alter function public.creator_works(uuid,text,bigint,jsonb,uuid,text,bigint) set schema authoring;
  alter function authoring.creator_works(uuid,text,bigint,jsonb,uuid,text,bigint) rename to review_original_works;
  alter function public.creator_publications_v18(uuid,text,bigint,uuid,bigint,jsonb,uuid) set schema authoring;
  alter function authoring.creator_publications_v18(uuid,text,bigint,uuid,bigint,jsonb,uuid) rename to review_original_publications;
  alter function public.stage8_creator(uuid,text,bigint,jsonb) set schema authoring;
  alter function authoring.stage8_creator(uuid,text,bigint,jsonb) rename to review_original_operations;
  alter function public.creator_work_distribution(uuid,bigint,text,jsonb) set schema authoring;
  alter function authoring.creator_work_distribution(uuid,bigint,text,jsonb) rename to review_original_distribution;
  alter function public.creator_files(uuid,text,bigint,uuid,jsonb) set schema authoring;
  alter function authoring.creator_files(uuid,text,bigint,uuid,jsonb) rename to review_original_files;
 end if;
end $$;
create or replace function authoring.apply_change(k text,u uuid,w bigint,args jsonb) returns jsonb language plpgsql set search_path='' as $$
begin
 case k
 when 'work' then return authoring.review_original_works(u,args->>'action',w,args->'data',(args->>'key')::uuid,coalesce(args->>'filter','all'),coalesce((args->>'after')::bigint,0));
 when 'publication' then return authoring.review_original_publications(u,args->>'action',w,(args->>'draft')::uuid,(args->>'episode')::bigint,args->'data',(args->>'key')::uuid);
 when 'operation' then return authoring.review_original_operations(u,args->>'action',w,args->'data');
 when 'distribution' then return authoring.review_original_distribution(u,w,args->>'action',args->'data');
 when 'file' then return authoring.review_original_files(u,args->>'action',w,(args->>'id')::uuid,args->'data');
 else return jsonb_build_object('error','INVALID_ACTION','status',400);end case;
end $$;
-- The former rating-review stop now uses this same review transaction.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('authoring.review_original_works(uuid,text,bigint,jsonb,uuid,text,bigint)'::regprocedure);
 definition:=replace(definition,
  'if p_action=''update'' and s.visibility=''PUBLIC'' and p_data?''rating'' and p_data->>''rating''<>w.rating then',
  'if p_action=''update'' and s.visibility=''PUBLIC'' and p_data?''rating'' and p_data->>''rating''<>w.rating and current_setting(''webnovels.review_change_applying'',true) is distinct from ''true'' then');
 execute definition;
end $$;
create or replace function authoring.review_change(k text,u uuid,w bigint,args jsonb,needs_review boolean) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb;q authoring.publication_changes;before_state jsonb;candidate jsonb;
begin
 if not needs_review then return authoring.apply_change(k,u,w,args);end if;
 -- Consistent author -> work -> state lock order; canonical RPC performs full identity/ownership checks.
 perform 1 from public.authors where auth_user_id=u for update;
 perform 1 from public.works where id=w for update;
 perform 1 from authoring.work_state where work_id=w for update;
 if not exists(select 1 from public.authors a join public.works ww on ww.author_id=a.id join auth.users au on au.id=a.auth_user_id
 where ww.id=w and au.id=u and a.status::text='APPROVED' and au.email_confirmed_at is not null and au.is_anonymous is not true and (au.banned_until is null or au.banned_until<=now()))
 or exists(select 1 from public.readers where auth_user_id=u and status::text<>'ACTIVE')
 or exists(select 1 from public.admin_users where auth_user_id=u and is_active is distinct from true) then return jsonb_build_object('error','WORK_NOT_FOUND','status',404);end if;
 if k='publication' and args->'data'->>'mode'='SCHEDULED' then return jsonb_build_object('error','REVIEW_SCHEDULE_UNSUPPORTED','status',409);end if;
 select * into q from authoring.publication_changes where user_id=u and kind=k and arguments=args;
 if found then return jsonb_build_object('reviewRequired',true,'changeId',q.id);end if;
 if k='publication' and exists(select 1 from authoring.publication_changes where user_id=u and kind=k and arguments->>'key'=args->>'key') then return jsonb_build_object('error','IDEMPOTENCY_CONFLICT','status',409);end if;
 before_state:=authoring.change_baseline(w);
 if k='publication' then before_state:=before_state||jsonb_build_object('draft',(select jsonb_build_object('title',v.title,'content',v.content,'contentDocument',v.content_document,'webtoon',v.webtoon,'authorComment',v.author_comment) from authoring.drafts d join authoring.publication_heads h on h.episode_id=d.episode_id join authoring.publication_versions v on v.id=h.version_id where d.id=(args->>'draft')::uuid));end if;
 -- Validate with the canonical implementation in a rolled-back subtransaction.
 -- Nothing in the database is published by this rehearsal. Immutable source revision is retained.
 begin
  perform set_config('webnovels.review_change_applying','true',true);
  result:=authoring.apply_change(k,u,w,args);
  candidate:=jsonb_build_object('result',result,'after',authoring.change_baseline(w));
  if k='publication' then candidate:=candidate||jsonb_build_object('draft',authoring.draft_json((args->>'draft')::uuid,(args->'data'->>'revision')::bigint));end if;
  raise exception using errcode='ZC001',message='REVIEW_VALIDATION_ROLLBACK';
 exception when sqlstate 'ZC001' then null;
 end;
 if result ? 'error' then return result;end if;
 insert into authoring.publication_changes(user_id,work_id,kind,arguments,baseline,candidate) values(u,w,k,args,before_state,candidate) returning * into q;
 return jsonb_build_object('reviewRequired',true,'changeId',q.id);
end $$;
create or replace function public.creator_works(p_user_id uuid,p_action text,p_work_id bigint default null,p_data jsonb default '{}',p_key uuid default null,p_filter text default 'all',p_after bigint default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;items jsonb;
begin
 result:=authoring.review_change('work',p_user_id,p_work_id,jsonb_build_object('action',p_action,'data',p_data,'key',p_key,'filter',p_filter,'after',p_after),p_action in ('update','trash','restore') and exists(select 1 from authoring.publication_history where work_id=p_work_id));
 if p_action='get' and result ? 'work' then
  select coalesce(jsonb_agg(x.item),'[]') into items from (select jsonb_build_object('id',c.id,'kind',c.kind,'decision',dd.decision,'reason',dd.reason,'createdAt',c.created_at) item from authoring.publication_changes c left join authoring.publication_change_decisions dd on dd.change_id=c.id where c.user_id=p_user_id and c.work_id=p_work_id order by c.created_at desc,c.id limit 20) x;
  result:=jsonb_set(result,'{work,hasPublicationHistory}',to_jsonb(exists(select 1 from authoring.publication_history where work_id=p_work_id)))||jsonb_build_object('changeRequests',items);
 end if;return result;
end $$;
create or replace function public.creator_publications_v18(p_user_id uuid,p_action text,p_work_id bigint,p_draft_id uuid default null,p_episode_id bigint default null,p_data jsonb default '{}',p_key uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare needs boolean;
begin
 needs:=p_action='publish' and not exists(select 1 from authoring.publish_requests where work_id=p_work_id and idempotency_key=p_key) and exists(
 select 1 from public.episodes e where e.work_id=p_work_id and (e.id=(select episode_id from authoring.drafts where id=p_draft_id) or e.episode_number::text=p_data->>'episodeNumber')
 and ((to_jsonb(e)->>'published_at') is not null or e.status::text='PUBLISHED' or exists(select 1 from authoring.publication_heads where episode_id=e.id)));
 return authoring.review_change('publication',p_user_id,p_work_id,jsonb_build_object('action',p_action,'data',p_data,'draft',p_draft_id,'episode',p_episode_id,'key',p_key),needs);
end $$;
create or replace function public.stage8_creator(p_user uuid,p_action text,p_work_id bigint,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
begin return authoring.review_change('operation',p_user,p_work_id,jsonb_build_object('action',p_action,'data',p_data),p_action in ('serial-state','withdraw','restore-episode') and exists(select 1 from authoring.publication_history where work_id=p_work_id));end $$;
create or replace function public.creator_work_distribution(p_user_id uuid,p_work_id bigint,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
begin return authoring.review_change('distribution',p_user_id,p_work_id,jsonb_build_object('action',p_action,'data',p_data),p_action='update' and exists(select 1 from authoring.publication_history where work_id=p_work_id));end $$;
create or replace function public.creator_files(p_user_id uuid,p_action text,p_work_id bigint default null,p_id uuid default null,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
begin return authoring.review_change('file',p_user_id,p_work_id,jsonb_build_object('action',p_action,'data',p_data,'id',p_id),p_action='commit' and exists(select 1 from authoring.file_jobs where user_id=p_user_id and id=p_id and work_id=p_work_id and kind='COVER' and state<>'COMMITTED') and exists(select 1 from authoring.publication_history where work_id=p_work_id));end $$;

create or replace function public.admin_publication_changes(p_user uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.admin_users;q authoring.publication_changes;d authoring.publication_change_decisions;result jsonb;items jsonb;snapshot jsonb;panel authoring.webtoon_panels;asset authoring.webtoon_assets;file authoring.files;
begin
 select * into a from public.admin_users where auth_user_id=p_user and is_active=true for update;
 if not found or a.role::text not in ('SUPER_ADMIN','ADMIN','SUB_ADMIN') or not authoring.workflow_can(a,'CONTENT_REVIEW') or not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null and is_anonymous is not true and (banned_until is null or banned_until<=now())) then return jsonb_build_object('error','ADMIN_REQUIRED','status',403);end if;
 if coalesce(p_action,'') not in ('list','detail','image','decide') or jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text)>4096 or
 (p_data-case p_action when 'list' then array[]::text[] when 'detail' then array['changeId'] when 'image' then array['changeId','side','panelId'] else array['changeId','decision','reason'] end)<>'{}'::jsonb then return jsonb_build_object('error','INVALID_FIELD','status',400);end if;
 if p_action='list' then
  select coalesce(jsonb_agg(x.item),'[]') into items from (select jsonb_build_object('id',c.id,'workId',c.work_id::text,'kind',c.kind,'action',c.arguments->>'action','createdAt',c.created_at,'title',w.title,'decision',dd.decision) item from authoring.publication_changes c join public.works w on w.id=c.work_id left join authoring.publication_change_decisions dd on dd.change_id=c.id order by (dd.change_id is null) desc,c.created_at,c.id limit 100) x;
  return jsonb_build_object('changes',items);
 end if;
 if coalesce(p_data->>'changeId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return jsonb_build_object('error','INVALID_FIELD','status',400);end if;
 select * into q from authoring.publication_changes where id=(p_data->>'changeId')::uuid;
 if not found then return jsonb_build_object('error','CHANGE_NOT_FOUND','status',404);end if;
 if p_action='image' then
  if coalesce(p_data->>'side','') not in ('before','after') then return jsonb_build_object('error','INVALID_FIELD','status',400);end if;
  snapshot:=case when p_data->>'side'='before' then q.baseline->'draft' else q.candidate->'draft' end;
  if q.kind='publication' then
   select p.* into panel from authoring.webtoon_panels p join authoring.webtoon_assets a2 on a2.id=p.asset_id where p.id::text=p_data->>'panelId' and a2.work_id=q.work_id and a2.state='READY' and snapshot->'webtoon'->'assetIds' ? p.asset_id::text;
   if not found then return jsonb_build_object('error','IMAGE_NOT_FOUND','status',404);end if;
   return jsonb_build_object('bucket','authoring-webtoons','path','webtoon/'||q.work_id||'/'||panel.asset_id||'/'||panel.part||'/'||panel.png_sha||'.png','mime','image/png');
  elsif q.kind='file' then
   select * into file from authoring.files where work_id=q.work_id and id::text=case when p_data->>'side'='before' then q.baseline->'state'->>'cover_file_id' else q.candidate->'after'->'state'->>'cover_file_id' end and purpose='COVER_DERIVATIVE';
   if not found then return jsonb_build_object('error','IMAGE_NOT_FOUND','status',404);end if;
   return jsonb_build_object('bucket',file.bucket_id,'path',file.object_key,'mime','image/jpeg');
  end if;return jsonb_build_object('error','IMAGE_NOT_FOUND','status',404);
 end if;
 if p_action='detail' then return jsonb_build_object('change',to_jsonb(q)||jsonb_build_object('beforePanels',authoring.webtoon_panels_json(q.baseline->'draft'->'webtoon'),'afterPanels',authoring.webtoon_panels_json(q.candidate->'draft'->'webtoon')));end if;
 if p_action<>'decide' or coalesce(p_data->>'decision','') not in ('APPROVE','REJECT') or jsonb_typeof(p_data->'reason') is distinct from 'string' or length(p_data->>'reason')>500 or length(trim(coalesce(p_data->>'reason',''))) not between 3 and 500 then return jsonb_build_object('error','INVALID_FIELD','status',400);end if;
 perform 1 from public.authors where auth_user_id=q.user_id for update;
 perform 1 from public.works where id=q.work_id for update;
 perform 1 from authoring.work_state where work_id=q.work_id for update;
 select * into q from authoring.publication_changes where id=q.id for update;
 select * into d from authoring.publication_change_decisions where change_id=q.id;
 if found then
  if d.decision<>p_data->>'decision' or d.reason<>p_data->>'reason' then return jsonb_build_object('error','DECISION_CONFLICT','status',409);end if;
  return jsonb_build_object('decision',d.decision,'result',d.result);
 end if;
 if p_data->>'decision'='APPROVE' then
  if authoring.change_baseline(q.work_id) is distinct from (q.baseline-'draft') then return jsonb_build_object('error','REVIEW_BASELINE_CHANGED','status',409);end if;
  if q.kind='publication' and (select current_revision::text from authoring.drafts where id=(q.arguments->>'draft')::uuid) is distinct from q.arguments->'data'->>'revision' then return jsonb_build_object('error','DRAFT_REVISION_CONFLICT','status',409);end if;
  perform set_config('webnovels.review_change_applying','true',true);
  result:=authoring.apply_change(q.kind,q.user_id,q.work_id,q.arguments);
  perform set_config('webnovels.review_change_applying','false',true);
  if result ? 'error' then return result;end if;
 else result:=jsonb_build_object('preserved',true);end if;
 insert into authoring.publication_change_decisions(change_id,admin_user_id,decision,reason,result) values(q.id,p_user,p_data->>'decision',p_data->>'reason',result);
 insert into authoring.workflow_events(actor_user_id,action,target,work_id,reason,detail) values(p_user,'PUBLICATION_CHANGE_'||(p_data->>'decision'),q.id::text,q.work_id,p_data->>'reason',jsonb_build_object('kind',q.kind));
 return jsonb_build_object('decision',p_data->>'decision','result',result);
end $$;
-- The scheduler cannot replace an existing public head behind the review queue.
create or replace function authoring.guard_publication_change() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and new.version_id<>old.version_id and current_setting('webnovels.review_change_applying',true) is distinct from 'true' then raise exception 'PUBLICATION_CHANGE_REVIEW_REQUIRED';end if;
 insert into authoring.publication_history(work_id) select work_id from public.episodes where id=new.episode_id on conflict do nothing;
 return new;
end $$;
drop trigger if exists publication_change_guard on authoring.publication_heads;
create trigger publication_change_guard before insert or update on authoring.publication_heads for each row execute function authoring.guard_publication_change();
-- Scheduled replacements need a separate approved schedule/head contract; do not queue them as successful.
-- NOW replacements and first scheduled publication retain their existing atomic behavior.
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='authoring' and (p.proname like 'review_original_%' or p.proname in ('change_baseline','apply_change','review_change','guard_publication_change')) loop
 execute 'revoke all on function '||f.signature||' from public,anon,authenticated,service_role';end loop;
end $$;
revoke all on function public.creator_works(uuid,text,bigint,jsonb,uuid,text,bigint),public.creator_publications_v18(uuid,text,bigint,uuid,bigint,jsonb,uuid),public.stage8_creator(uuid,text,bigint,jsonb),public.creator_work_distribution(uuid,bigint,text,jsonb),public.creator_files(uuid,text,bigint,uuid,jsonb),public.admin_publication_changes(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.creator_works(uuid,text,bigint,jsonb,uuid,text,bigint),public.creator_publications_v18(uuid,text,bigint,uuid,bigint,jsonb,uuid),public.stage8_creator(uuid,text,bigint,jsonb),public.creator_work_distribution(uuid,bigint,text,jsonb),public.creator_files(uuid,text,bigint,uuid,jsonb),public.admin_publication_changes(uuid,text,jsonb) to service_role;
insert into authoring.migrations(version) values('authoring-022') on conflict do nothing;
commit;
