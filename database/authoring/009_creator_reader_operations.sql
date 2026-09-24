-- Step 8: additive reader activity and creator community operations.
-- Review the live schema and backup before applying after authoring-008.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
  if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
    or not exists(select 1 from authoring.migrations where version='authoring-008') then
    raise exception 'Reviewed authoring-008 prerequisite required';
  end if;
  if to_regclass('public.comments') is null then
    raise exception 'Legacy comments schema must be reviewed before step 8';
  end if;
end $$;

create table if not exists authoring.reader_progress(
 user_id uuid not null references auth.users(id) on delete restrict,
 work_id bigint not null references public.works(id) on delete restrict,
 episode_id bigint not null references public.episodes(id) on delete restrict,
 progress integer not null check(progress between 0 and 100),
 last_read_at timestamptz not null default now(),
 primary key(user_id,episode_id),
 foreign key(episode_id,work_id) references public.episodes(id,work_id) on delete restrict
);
create index if not exists authoring_reader_recent on authoring.reader_progress(user_id,last_read_at desc);
create table if not exists authoring.reader_favorites(
 user_id uuid not null references auth.users(id) on delete restrict,
 work_id bigint not null references public.works(id) on delete restrict,
 created_at timestamptz not null default now(), primary key(user_id,work_id)
);
create table if not exists authoring.reader_subscriptions(
 user_id uuid not null references auth.users(id) on delete restrict,
 author_id bigint not null references public.authors(id) on delete restrict,
 created_at timestamptz not null default now(), primary key(user_id,author_id)
);
create table if not exists authoring.reader_preferences(
 user_id uuid primary key references auth.users(id) on delete restrict,
 settings jsonb not null default '{}' check(jsonb_typeof(settings)='object'),
 updated_at timestamptz not null default now()
);
create table if not exists authoring.reader_events_v2(
 user_id uuid not null references auth.users(id) on delete restrict,
 episode_id bigint not null references public.episodes(id) on delete restrict,
 work_id bigint not null references public.works(id) on delete restrict,
 event_type text not null check(event_type in ('OPEN','COMPLETE')),
 bucket timestamptz not null,
 created_at timestamptz not null default now(),
 primary key(user_id,episode_id,event_type,bucket),
 foreign key(episode_id,work_id) references public.episodes(id,work_id) on delete restrict
);
create index if not exists authoring_reader_events_work on authoring.reader_events_v2(work_id,created_at desc);
create table if not exists authoring.comment_policies(
 work_id bigint primary key references authoring.work_state(work_id) on delete restrict,
 comments_enabled boolean not null default true,
 blocked_terms text[] not null default '{}',
 min_read_episodes integer not null default 0 check(min_read_episodes between 0 and 100),
 updated_at timestamptz not null default now()
);
create table if not exists authoring.comment_blocks(
 work_id bigint not null references authoring.work_state(work_id) on delete restrict,
 reader_user_id uuid not null references auth.users(id) on delete restrict,
 blocked_at timestamptz not null default now(),
 primary key(work_id,reader_user_id)
);
-- Existing text reader IDs cannot be treated as verified Auth UUIDs.
do $$ declare has_blocks boolean; begin
 if to_regclass('public.creator_comment_blocks') is not null then
   execute 'select exists(select 1 from public.creator_comment_blocks)' into has_blocks;
   if has_blocks then raise exception 'Reconcile legacy creator_comment_blocks identities before step 8'; end if;
 end if;
 if to_regclass('public.work_comment_policies') is not null then
   execute 'insert into authoring.comment_policies(work_id,comments_enabled,blocked_terms,min_read_episodes)
     select work_id,comments_enabled,blocked_terms,min_read_episodes
     from public.work_comment_policies on conflict(work_id) do nothing';
 end if;
end $$;
create table if not exists authoring.comment_likes(
 comment_id uuid not null references public.comments(id) on delete restrict,
 user_id uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(), primary key(comment_id,user_id)
);
create table if not exists authoring.comment_actions(
 id bigint generated always as identity primary key,
 comment_id uuid references public.comments(id) on delete restrict,
 work_id bigint not null references authoring.work_state(work_id) on delete restrict,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 action text not null check(action in ('HIDE','UNHIDE','REPORT','BLOCK','UNBLOCK')),
 reason text, created_at timestamptz not null default now()
);
create table if not exists authoring.comment_reports(
 id uuid primary key default gen_random_uuid(),
 comment_id uuid not null references public.comments(id) on delete restrict,
 work_id bigint not null references authoring.work_state(work_id) on delete restrict,
 reporter_user_id uuid not null references auth.users(id) on delete restrict,
 reason text not null check(length(btrim(reason)) between 3 and 500),
 status text not null default 'PENDING' check(status in ('PENDING','REVIEWED')),
 created_at timestamptz not null default now()
);
create table if not exists authoring.creator_notices(
 id uuid primary key default gen_random_uuid(),
 work_id bigint not null references authoring.work_state(work_id) on delete restrict,
 kind text not null check(kind in ('INQUIRY','REPORT_RESULT','SCHEDULE_FAILED')),
 title text not null, detail text,
 created_at timestamptz not null default now(),
 schedule_event_id bigint unique references authoring.schedule_events(id) on delete restrict,
 comment_report_id uuid unique references authoring.comment_reports(id) on delete restrict,
 unique(id,work_id)
);
create table if not exists authoring.creator_notice_reads(
 notice_id uuid primary key references authoring.creator_notices(id) on delete restrict,
 author_user_id uuid not null references auth.users(id) on delete restrict,
 read_at timestamptz not null default now()
);

alter table public.comments add column if not exists is_hidden_by_author boolean not null default false;
alter table public.comments add column if not exists anchor_version_id uuid;
alter table public.comments add column if not exists anchor_paragraph integer;
alter table public.comments add column if not exists anchor_hash text;
alter table public.comments add column if not exists quote_text text;
alter table public.comments add column if not exists is_spoiler boolean not null default false;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.comments'::regclass and conname='stage8_comment_version_fk') then
   alter table public.comments add constraint stage8_comment_version_fk
     foreign key(anchor_version_id) references authoring.publication_versions(id) on delete restrict;
 end if;
end $$;
create index if not exists stage8_comment_episode on public.comments(episode_id,created_at desc);
do $$ declare t text; begin
 foreach t in array array['reader_progress','reader_favorites','reader_subscriptions','reader_preferences',
  'reader_events_v2','comment_policies','comment_blocks','comment_likes','comment_actions','comment_reports',
  'creator_notices','creator_notice_reads'] loop
  execute format('alter table authoring.%I enable row level security',t);
  execute format('revoke all on authoring.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on authoring.%I to service_role',t);
 end loop;
end $$;
grant usage,select on sequence authoring.comment_actions_id_seq to service_role;

create or replace function authoring.stage8_schedule_notice() returns trigger
language plpgsql security definer set search_path='' as $$
declare work bigint; begin
 if new.event='FAILED' then
   select e.work_id into work from authoring.schedules q
     join public.episodes e on e.id=q.episode_id where q.id=new.schedule_id;
   if work is not null then
     insert into authoring.creator_notices(work_id,kind,title,detail,schedule_event_id)
       values(work,'SCHEDULE_FAILED','예약 발행 실패',new.reason_code,new.id)
       on conflict(schedule_event_id) do nothing;
   end if;
 end if;
 return new;
end $$;
drop trigger if exists stage8_schedule_notice on authoring.schedule_events;
create trigger stage8_schedule_notice after insert on authoring.schedule_events
 for each row execute function authoring.stage8_schedule_notice();
insert into authoring.creator_notices(work_id,kind,title,detail,schedule_event_id)
select e.work_id,'SCHEDULE_FAILED','예약 발행 실패',ev.reason_code,ev.id
 from authoring.schedule_events ev join authoring.schedules q on q.id=ev.schedule_id
 join public.episodes e on e.id=q.episode_id where ev.event='FAILED'
on conflict(schedule_event_id) do nothing;

create or replace function authoring.stage8_report_notice() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='REVIEWED' and old.status is distinct from 'REVIEWED' then
   insert into authoring.creator_notices(work_id,kind,title,detail,comment_report_id)
     values(new.work_id,'REPORT_RESULT','댓글 신고 결과','운영 검토가 완료됐습니다.',new.id)
     on conflict(comment_report_id) do nothing;
 end if;
 return new;
end $$;
drop trigger if exists stage8_report_notice on authoring.comment_reports;
create trigger stage8_report_notice after update on authoring.comment_reports
 for each row execute function authoring.stage8_report_notice();

create or replace function authoring.stage8_visible(p_work bigint,p_episode bigint default null)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.works w join authoring.work_state s on s.work_id=w.id
  where w.id=p_work and s.visibility='PUBLIC' and s.trashed_at is null
    and s.moderation_state='CLEAR' and w.status::text in ('PUBLISHED','ONGOING','PAUSED','COMPLETED')
    and (p_episode is null or exists(select 1 from public.episodes e where e.id=p_episode
      and e.work_id=w.id and e.status::text='PUBLISHED'
      and (e.scheduled_at is null or e.scheduled_at<=now()))))
$$;
revoke all on function authoring.stage8_visible(bigint,bigint) from public,anon,authenticated;

create or replace function public.stage8_reader(p_user uuid,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.readers; w public.works; ep public.episodes; h authoring.publication_heads;
 policy authoring.comment_policies; c public.comments; v authoring.publication_versions;
 v_work_id bigint; v_episode_id bigint; idx integer; snippet text; content text;
 parent uuid; v_progress integer; enabled boolean; result jsonb;
begin
 select * into r from public.readers where auth_user_id=p_user and status::text='ACTIVE';
 if not found or not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null
   and is_anonymous is not true and (banned_until is null or banned_until<=now())) then
   return jsonb_build_object('error','READER_REQUIRED','status',403); end if;
 if p_action='activity' then
   return jsonb_build_object(
    'readingHistory',coalesce((select jsonb_agg(x order by x.last_read_at desc) from
      (select q.work_id::text "workId",e.episode_number "episodeNumber",q.progress,q.last_read_at
       from authoring.reader_progress q join public.episodes e on e.id=q.episode_id
       where q.user_id=p_user and authoring.stage8_visible(q.work_id,q.episode_id)
       order by q.last_read_at desc limit 100) x),'[]'::jsonb),
    'favorites',coalesce((select jsonb_agg(f.work_id::text) from authoring.reader_favorites f
      where f.user_id=p_user and authoring.stage8_visible(f.work_id)),'[]'::jsonb),
    'subscriptions',coalesce((select jsonb_agg(jsonb_build_object('authorId',s.author_id::text,'name',a.pen_name))
      from authoring.reader_subscriptions s join public.authors a on a.id=s.author_id
      where s.user_id=p_user),'[]'::jsonb),
    'preferences',coalesce((select settings from authoring.reader_preferences where user_id=p_user),'{}'::jsonb));
 end if;
 if p_action='preferences' then
   if p_data ? 'settings' and jsonb_typeof(p_data->'settings')='object'
     and length((p_data->'settings')::text)<2000
     and (select count(*)=6 and bool_and(key in ('theme','fontFamily','fontSize',
       'lineHeight','paddingX','paragraphGap')) from jsonb_object_keys(p_data->'settings') key)
     and p_data->'settings'->>'theme' in ('theme-dark','theme-oled','theme-sepia','theme-light')
     and p_data->'settings'->>'fontFamily' in ('serif','sans')
     and jsonb_typeof(p_data->'settings'->'fontSize')='number'
     and p_data->'settings'->>'fontSize' ~ '^(1[4-9]|2[0-6])$'
     and jsonb_typeof(p_data->'settings'->'lineHeight')='number'
     and p_data->'settings'->>'lineHeight' in ('1.5','1.8','2.2')
     and jsonb_typeof(p_data->'settings'->'paddingX')='number'
     and p_data->'settings'->>'paddingX' in ('12','20','36')
     and jsonb_typeof(p_data->'settings'->'paragraphGap')='number'
     and p_data->'settings'->>'paragraphGap' in ('0.8','1.2','1.6') then
     insert into authoring.reader_preferences(user_id,settings) values(p_user,p_data->'settings')
       on conflict(user_id) do update set settings=excluded.settings,updated_at=now();
     return jsonb_build_object('preferences',p_data->'settings');
   end if;
   return jsonb_build_object('error','INVALID_PREFERENCES','status',400);
 end if;
 if coalesce(p_data->>'workId','') !~ '^[1-9][0-9]{0,18}$' then
   return jsonb_build_object('error','INVALID_WORK_ID','status',400); end if;
 v_work_id:=(p_data->>'workId')::bigint;
 select * into w from public.works where id=v_work_id;
 if not found or not authoring.stage8_visible(v_work_id) then
   return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
 if p_action in ('favorite','subscribe') then
   if jsonb_typeof(p_data->'enabled') is distinct from 'boolean' then
     return jsonb_build_object('error','INVALID_FIELD','status',400); end if;
   enabled:=(p_data->>'enabled')::boolean;
   if p_action='favorite' then
     if enabled then insert into authoring.reader_favorites(user_id,work_id) values(p_user,v_work_id)
       on conflict do nothing;
     else delete from authoring.reader_favorites where user_id=p_user and work_id=v_work_id; end if;
   else
     if enabled then insert into authoring.reader_subscriptions(user_id,author_id) values(p_user,w.author_id)
       on conflict do nothing;
     else delete from authoring.reader_subscriptions where user_id=p_user and author_id=w.author_id; end if;
   end if;
   return jsonb_build_object('enabled',enabled);
 end if;
 if coalesce(p_data->>'episodeId','') !~ '^[1-9][0-9]{0,18}$' then
   return jsonb_build_object('error','INVALID_EPISODE_ID','status',400); end if;
 v_episode_id:=(p_data->>'episodeId')::bigint;
 select * into ep from public.episodes where id=v_episode_id and work_id=v_work_id;
 if not found or not authoring.stage8_visible(v_work_id,v_episode_id) then
   return jsonb_build_object('error','EPISODE_NOT_FOUND','status',404); end if;
 if p_action='like' then
   begin parent:=(p_data->>'commentId')::uuid; exception when others then
     return jsonb_build_object('error','INVALID_COMMENT_ID','status',400); end;
   select * into c from public.comments where id=parent and work_id=v_work_id
     and episode_id=v_episode_id and not is_deleted and not is_blocked and not is_hidden_by_author;
   if not found then return jsonb_build_object('error','COMMENT_NOT_FOUND','status',404); end if;
   if exists(select 1 from authoring.comment_likes where comment_id=parent and user_id=p_user) then
     delete from authoring.comment_likes where comment_id=parent and user_id=p_user;
     enabled:=false;
   else
     insert into authoring.comment_likes(comment_id,user_id) values(parent,p_user);
     enabled:=true;
   end if;
   return jsonb_build_object('liked',enabled,'likes',c.likes_count+
     (select count(*) from authoring.comment_likes where comment_id=parent));
 end if;
 if p_action='progress' then
   if coalesce(p_data->>'progress','') !~ '^(100|[0-9]|[1-9][0-9])$' then
     return jsonb_build_object('error','INVALID_PROGRESS','status',400); end if;
   v_progress:=(p_data->>'progress')::integer;
   insert into authoring.reader_progress(user_id,work_id,episode_id,progress)
    values(p_user,v_work_id,v_episode_id,v_progress)
    on conflict(user_id,episode_id) do update
      set progress=greatest(authoring.reader_progress.progress,excluded.progress),last_read_at=now();
   if w.author_id is distinct from (select id from public.authors where auth_user_id=p_user) then
     insert into authoring.reader_events_v2(user_id,work_id,episode_id,event_type,bucket)
       values(p_user,v_work_id,v_episode_id,case when v_progress>=90 then 'COMPLETE' else 'OPEN' end,
         date_trunc('hour',now()))
       on conflict do nothing;
   end if;
   return jsonb_build_object('saved',true);
 end if;
 if p_action='comments' then
   return jsonb_build_object('comments',coalesce((select jsonb_agg(row_to_json(x) order by x.created_at)
    from (select c.id,c.parent_id,c.content,c.nickname_snapshot nickname,
      c.likes_count+(select count(*) from authoring.comment_likes l where l.comment_id=c.id) likes_count,
      c.quote_text,c.anchor_paragraph,c.anchor_version_id,c.anchor_hash,c.is_spoiler,c.created_at,
      case when c.user_id=p_user then true else false end "mine"
      from public.comments c where c.episode_id=v_episode_id and c.work_id=v_work_id
      and not c.is_deleted and not c.is_blocked and not c.is_hidden_by_author
      order by c.created_at limit 200) x),'[]'::jsonb),
    'versionId',(select version_id from authoring.publication_heads where episode_id=v_episode_id));
 end if;
 if p_action<>'comment' then return jsonb_build_object('error','INVALID_ACTION','status',400); end if;
 if ep.access_policy is distinct from 'FREE' or ep.is_free is distinct from true then
   return jsonb_build_object('error','COMMENT_ACCESS_REQUIRED','status',403); end if;
 select * into policy from authoring.comment_policies where work_id=v_work_id;
 if policy.comments_enabled is false then return jsonb_build_object('error','COMMENTS_DISABLED','status',403); end if;
 if exists(select 1 from authoring.comment_blocks where work_id=v_work_id and reader_user_id=p_user) then
   return jsonb_build_object('error','COMMENT_BLOCKED','status',403); end if;
 if coalesce(policy.min_read_episodes,0) >
   (select count(*) from authoring.reader_progress where user_id=p_user and work_id=v_work_id and progress>=90) then
   return jsonb_build_object('error','READ_REQUIREMENT','status',403); end if;
 content:=btrim(p_data->>'content');
 if content is null or length(content) not between 1 and 2000 then
   return jsonb_build_object('error','INVALID_COMMENT','status',400); end if;
 if exists(select 1 from unnest(coalesce(policy.blocked_terms,'{}')) term
   where length(term)>0 and position(lower(term) in lower(content))>0) then
   return jsonb_build_object('error','BLOCKED_TERM','status',403); end if;
 if p_data ? 'parentId' then
   begin parent:=(p_data->>'parentId')::uuid; exception when others then
     return jsonb_build_object('error','INVALID_PARENT','status',400); end;
   select * into c from public.comments where id=parent and episode_id=v_episode_id and work_id=v_work_id
     and parent_id is null and not is_deleted and not is_blocked and not is_hidden_by_author;
   if not found then return jsonb_build_object('error','INVALID_PARENT','status',400); end if;
 end if;
 if p_data ? 'anchorIndex' then
   if p_data->>'anchorIndex' !~ '^(0|[1-9][0-9]{0,5})$' then
     return jsonb_build_object('error','INVALID_ANCHOR','status',400); end if;
   idx:=(p_data->>'anchorIndex')::integer;
   select * into h from authoring.publication_heads where episode_id=v_episode_id;
   if not found or h.version_id::text is distinct from p_data->>'versionId' then
     return jsonb_build_object('error','ANCHOR_VERSION_CHANGED','status',409); end if;
   select * into v from authoring.publication_versions where id=h.version_id;
   snippet:=split_part(replace(replace(v.content,E'\r\n',E'\n'),E'\r',E'\n'),E'\n\n',idx+1);
   if snippet='' or encode(sha256(convert_to(snippet,'UTF8')),'hex') is distinct from p_data->>'anchorHash' then
     return jsonb_build_object('error','ANCHOR_CHANGED','status',409); end if;
 end if;
 insert into public.comments(user_id,nickname_snapshot,work_id,episode_id,parent_id,content,
   anchor_version_id,anchor_paragraph,anchor_hash,quote_text,is_spoiler)
 values(p_user,coalesce(nullif(r.nickname,''),nullif(r.username,''),'독자'),v_work_id,v_episode_id,parent,
   content,h.version_id,idx,case when idx is null then null else p_data->>'anchorHash' end,
   case when idx is null then null else left(snippet,300) end,
   coalesce((p_data->>'isSpoiler')::boolean,false)) returning * into c;
 return jsonb_build_object('commentId',c.id);
end $$;
revoke all on function public.stage8_reader(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.stage8_reader(uuid,text,jsonb) to service_role;

create or replace function public.stage8_comments(p_work_id bigint,p_episode_id bigint)
returns jsonb language sql stable security definer set search_path='' as $$
 select case when not authoring.stage8_visible(p_work_id,p_episode_id)
   then jsonb_build_object('error','EPISODE_NOT_FOUND','status',404)
   else jsonb_build_object('comments',coalesce((select jsonb_agg(row_to_json(x) order by x.created_at)
    from (select c.id,c.parent_id,c.content,c.nickname_snapshot nickname,
      c.likes_count+(select count(*) from authoring.comment_likes l where l.comment_id=c.id) likes_count,
      c.quote_text,c.anchor_paragraph,c.anchor_version_id,c.anchor_hash,c.is_spoiler,c.created_at
      from public.comments c where c.episode_id=p_episode_id and c.work_id=p_work_id
      and not c.is_deleted and not c.is_blocked and not c.is_hidden_by_author
      order by c.created_at limit 200) x),'[]'::jsonb),
    'versionId',(select version_id from authoring.publication_heads where episode_id=p_episode_id))
 end
$$;
revoke all on function public.stage8_comments(bigint,bigint) from public,anon,authenticated;
grant execute on function public.stage8_comments(bigint,bigint) to service_role;

create or replace function public.stage8_creator(
 p_user uuid,p_action text,p_work_id bigint,p_data jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.authors; w public.works; s authoring.work_state; c public.comments;
 notice authoring.creator_notices; enabled boolean; terms text[]; minimum integer;
 target_user uuid; target_id uuid; reason text; n integer; target_episode bigint;
 next_state text; schedule_policy text; cancelled integer; cancelled_ids uuid[];
begin
 select * into a from public.authors where auth_user_id=p_user and status::text='APPROVED';
 if not found or not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null
   and is_anonymous is not true and (banned_until is null or banned_until<=now())) then
   return jsonb_build_object('error','AUTHOR_REQUIRED','status',403); end if;
 select * into w from public.works where id=p_work_id and author_id=a.id;
 select * into s from authoring.work_state where work_id=p_work_id and author_id=a.id;
 if w.id is null or s.work_id is null then return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
 if p_action='home' then
   return jsonb_build_object(
    'drafts',coalesce((select jsonb_agg(row_to_json(x)) from
      (select d.id,d.work_id::text "workId",r.title,d.updated_at
       from authoring.drafts d join authoring.draft_revisions r
         on r.draft_id=d.id and r.revision=d.current_revision
       where d.author_id=a.id and d.lifecycle='ACTIVE'
       order by d.updated_at desc limit 5) x),'[]'::jsonb),
    'failedSchedules',coalesce((select jsonb_agg(row_to_json(x)) from
      (select q.id,e.episode_number,q.last_error_code,q.due_at
       from authoring.schedules q join public.episodes e on e.id=q.episode_id
       join public.works aw on aw.id=e.work_id
       where aw.author_id=a.id and q.status='FAILED'
       order by q.updated_at desc limit 5) x),'[]'::jsonb));
 end if;
 if p_action='episodes' then
   return jsonb_build_object('episodes',coalesce((select jsonb_agg(row_to_json(x) order by x.episode_number)
    from (select e.id::text id,e.episode_number,e.title,e.status::text status,e.scheduled_at,
      q.status schedule_status,q.due_at,q.generation,
      exists(select 1 from authoring.publication_heads h where h.episode_id=e.id) has_head
      from public.episodes e left join authoring.schedules q on q.episode_id=e.id
        and q.status in ('PENDING','RUNNING','FAILED')
      where e.work_id=p_work_id order by e.episode_number limit 300) x),'[]'::jsonb));
 end if;
 if p_action='serial-state' then
   next_state:=p_data->>'serialState';
   schedule_policy:=p_data->>'schedulePolicy';
   if next_state not in ('ONGOING','HIATUS','COMPLETED')
     or schedule_policy not in ('KEEP','CANCEL')
     or coalesce(p_data->>'version','') !~ '^[1-9][0-9]{0,18}$' then
     return jsonb_build_object('error','INVALID_SERIAL_CHANGE','status',400); end if;
   perform 1 from public.works where id=p_work_id for update;
   select * into s from authoring.work_state where work_id=p_work_id for update;
   if s.version::text is distinct from p_data->>'version' then
     return jsonb_build_object('error','WORK_CONFLICT','status',409); end if;
   if s.trashed_at is not null or s.moderation_state<>'CLEAR' then
     return jsonb_build_object('error','WORK_UNAVAILABLE','status',409); end if;
   cancelled:=0;
   if schedule_policy='CANCEL' then
     perform 1 from authoring.schedules q join public.episodes e on e.id=q.episode_id
       where e.work_id=p_work_id and q.status in ('PENDING','RUNNING') for update of q;
     if exists(select 1 from authoring.schedules q join public.episodes e on e.id=q.episode_id
       where e.work_id=p_work_id and q.status='RUNNING') then
       return jsonb_build_object('error','SCHEDULE_RUNNING','status',409); end if;
     select coalesce(array_agg(q.id),'{}'::uuid[]) into cancelled_ids
       from authoring.schedules q join public.episodes e on e.id=q.episode_id
       where e.work_id=p_work_id and q.status='PENDING';
     cancelled:=cardinality(cancelled_ids);
     update authoring.schedules set status='CANCELLED',generation=generation+1,
       updated_at=now() where id=any(cancelled_ids);
     update public.episodes e set scheduled_at=null,updated_at=now()
       from authoring.schedules q where q.id=any(cancelled_ids) and e.id=q.episode_id
         and e.status::text<>'PUBLISHED';
     update authoring.drafts d set lifecycle='ACTIVE',updated_at=now()
       from authoring.publication_versions v join authoring.schedules q on q.version_id=v.id
       where q.id=any(cancelled_ids) and d.id=v.source_draft_id and d.lifecycle='PUBLISHED';
     insert into authoring.schedule_events(schedule_id,event,reason_code)
       select unnest(cancelled_ids),'CANCELLED','SERIAL_STATE_CHANGE';
   end if;
   update authoring.work_state set serial_state=next_state,version=version+1,updated_at=now()
     where work_id=p_work_id;
   update public.works set is_completed=(next_state='COMPLETED') where id=p_work_id;
   if s.visibility='PUBLIC' then
     if next_state='HIATUS' then update public.works set status='PAUSED' where id=p_work_id;
     elsif next_state='COMPLETED' then update public.works set status='COMPLETED' where id=p_work_id;
     else update public.works set status='PUBLISHED' where id=p_work_id; end if;
   end if;
   return jsonb_build_object('version',(s.version+1)::text,'cancelledSchedules',cancelled,
     'schedulePolicy',schedule_policy);
 end if;
 if p_action in ('withdraw','restore-episode') then
   if coalesce(p_data->>'episodeId','') !~ '^[1-9][0-9]{0,18}$' then
     return jsonb_build_object('error','INVALID_EPISODE_ID','status',400); end if;
   target_episode:=(p_data->>'episodeId')::bigint;
   perform 1 from public.works where id=p_work_id for update;
   select * into s from authoring.work_state where work_id=p_work_id for update;
   if s.trashed_at is not null or s.moderation_state<>'CLEAR' then
     return jsonb_build_object('error','WORK_UNAVAILABLE','status',409); end if;
   if exists(select 1 from authoring.schedules where episode_id=target_episode
     and status in ('PENDING','RUNNING')) then
     return jsonb_build_object('error','SCHEDULE_ACTIVE','status',409); end if;
   if p_action='withdraw' and not exists(select 1 from authoring.publication_heads
     where episode_id=target_episode) then
     return jsonb_build_object('error','PUBLICATION_NOT_READY','status',409); end if;
   if p_action='withdraw' then
     update public.episodes set status='DRAFT',updated_at=now()
       where id=target_episode and work_id=p_work_id and status::text='PUBLISHED';
   else
     if s.visibility<>'PUBLIC' or not exists(select 1 from authoring.publication_heads
       where episode_id=target_episode) then
       return jsonb_build_object('error','PUBLICATION_NOT_READY','status',409); end if;
     update public.episodes set status='PUBLISHED',updated_at=now()
       where id=target_episode and work_id=p_work_id and status::text='DRAFT';
   end if;
   if not found then return jsonb_build_object('error','EPISODE_CONFLICT','status',409); end if;
   return jsonb_build_object('saved',true,'status',case when p_action='withdraw' then 'DRAFT' else 'PUBLISHED' end);
 end if;
 if p_action='policy' then
   return jsonb_build_object('policy',coalesce((select jsonb_build_object(
     'commentsEnabled',comments_enabled,'blockedTerms',blocked_terms,'minReadEpisodes',min_read_episodes)
     from authoring.comment_policies where work_id=p_work_id),
     '{"commentsEnabled":true,"blockedTerms":[],"minReadEpisodes":0}'::jsonb),
    'blocks',coalesce((select jsonb_agg(jsonb_build_object('readerUserId',reader_user_id,
      'blockedAt',blocked_at)) from authoring.comment_blocks where work_id=p_work_id),'[]'::jsonb));
 end if;
 if p_action='policy-save' then
   if jsonb_typeof(p_data->'commentsEnabled') is distinct from 'boolean'
     or jsonb_typeof(p_data->'blockedTerms') is distinct from 'array'
     or coalesce(p_data->>'minReadEpisodes','') !~ '^(0|[1-9][0-9]?)$' then
     return jsonb_build_object('error','INVALID_POLICY','status',400); end if;
   select coalesce(array_agg(distinct btrim(value)), '{}') into terms
     from jsonb_array_elements_text(p_data->'blockedTerms') value
     where length(btrim(value)) between 2 and 30;
   if jsonb_array_length(p_data->'blockedTerms')>20 or
     exists(select 1 from jsonb_array_elements(p_data->'blockedTerms') v
       where jsonb_typeof(v.value)<>'string' or length(btrim(v.value#>>'{}')) not between 2 and 30) then
     return jsonb_build_object('error','INVALID_POLICY','status',400); end if;
   enabled:=(p_data->>'commentsEnabled')::boolean;
   minimum:=(p_data->>'minReadEpisodes')::integer;
   insert into authoring.comment_policies(work_id,comments_enabled,blocked_terms,min_read_episodes)
     values(p_work_id,enabled,terms,minimum)
     on conflict(work_id) do update set comments_enabled=excluded.comments_enabled,
       blocked_terms=excluded.blocked_terms,min_read_episodes=excluded.min_read_episodes,updated_at=now();
   return jsonb_build_object('saved',true);
 end if;
 if p_action='comments' then
   return jsonb_build_object('comments',coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc)
    from (select c.id,c.episode_id::text "episodeId",c.nickname_snapshot nickname,c.user_id::text "readerUserId",
      c.content,c.quote_text,c.anchor_version_id,c.is_hidden_by_author,c.is_blocked,c.is_deleted,c.created_at
      from public.comments c where c.work_id=p_work_id order by c.created_at desc limit 200) x),'[]'::jsonb));
 end if;
 if p_action in ('hide','unhide','report','block','unblock') then
   reason:=nullif(left(btrim(p_data->>'reason'),500),'');
   if p_action in ('hide','unhide','report','block') then
     begin target_id:=(p_data->>'commentId')::uuid; exception when others then
       return jsonb_build_object('error','INVALID_COMMENT_ID','status',400); end;
     select * into c from public.comments where id=target_id and work_id=p_work_id;
     if not found then return jsonb_build_object('error','COMMENT_NOT_FOUND','status',404); end if;
   end if;
   if p_action='hide' or p_action='unhide' then
     update public.comments set is_hidden_by_author=(p_action='hide'),updated_at=now()
       where id=target_id and work_id=p_work_id;
   elsif p_action='report' then
     if reason is null or length(reason)<3 then
       return jsonb_build_object('error','REPORT_REASON_REQUIRED','status',400); end if;
     insert into authoring.comment_reports(comment_id,work_id,reporter_user_id,reason)
       values(target_id,p_work_id,p_user,reason);
   elsif p_action='block' then
     target_user:=c.user_id;
     insert into authoring.comment_blocks(work_id,reader_user_id) values(p_work_id,target_user)
       on conflict do nothing;
   else
     begin target_user:=(p_data->>'readerUserId')::uuid; exception when others then
       return jsonb_build_object('error','INVALID_READER_ID','status',400); end;
     delete from authoring.comment_blocks where work_id=p_work_id and reader_user_id=target_user;
   end if;
   insert into authoring.comment_actions(comment_id,work_id,actor_user_id,action,reason)
    values(coalesce(target_id,(select id from public.comments where work_id=p_work_id and user_id=target_user
      order by created_at desc limit 1)),p_work_id,p_user,upper(p_action),reason);
   return jsonb_build_object('saved',true);
 end if;
 if p_action='statistics' then
   select count(distinct user_id)::integer into n from authoring.reader_events_v2
     where work_id=p_work_id and created_at>=now()-interval '30 days';
   return jsonb_build_object('periodDays',30,'sample',n,
     'state',case when n=0 then 'EMPTY' when n<5 then 'INSUFFICIENT' else 'READY' end,
     'recentEpisodes',case when n<5 then '[]'::jsonb else coalesce((select jsonb_agg(row_to_json(x) order by x.episode_number desc)
       from (select e.episode_number,
         case when count(distinct ev.user_id)>=5 then count(distinct ev.user_id)::integer else null end readers
         from public.episodes e left join authoring.reader_events_v2 ev on ev.episode_id=e.id
           and ev.created_at>=now()-interval '30 days'
         where e.work_id=p_work_id and e.status::text='PUBLISHED'
         group by e.id,e.episode_number order by e.episode_number desc limit 10) x),'[]'::jsonb) end,
     'favorites',(select count(*) from authoring.reader_favorites where work_id=p_work_id
       and created_at>=now()-interval '30 days'),
     'comments',(select count(*) from public.comments where work_id=p_work_id
       and created_at>=now()-interval '30 days'
       and not is_deleted and not is_blocked and not is_hidden_by_author));
 end if;
 if p_action='notices' then
   return jsonb_build_object('notices',coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc)
    from (select z.id,z.kind,z.title,z.detail,z.created_at,rd.read_at
      from authoring.creator_notices z left join authoring.creator_notice_reads rd on rd.notice_id=z.id
      where z.work_id=p_work_id order by z.created_at desc limit 100) x),'[]'::jsonb));
 end if;
 if p_action='notice-read' then
   begin target_id:=(p_data->>'noticeId')::uuid; exception when others then
     return jsonb_build_object('error','INVALID_NOTICE_ID','status',400); end;
   select * into notice from authoring.creator_notices where id=target_id and work_id=p_work_id;
   if not found then return jsonb_build_object('error','NOTICE_NOT_FOUND','status',404); end if;
   insert into authoring.creator_notice_reads(notice_id,author_user_id) values(target_id,p_user)
     on conflict do nothing;
   return jsonb_build_object('saved',true);
 end if;
 return jsonb_build_object('error','INVALID_ACTION','status',400);
end $$;
revoke all on function public.stage8_creator(uuid,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.stage8_creator(uuid,text,bigint,jsonb) to service_role;

create or replace function public.stage8_catalog() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'works',coalesce((select jsonb_agg(row_to_json(w)) from
    (select w.id::text id,w.title,w.author,w.author_id::text author_id,w.genre,w.tags,w.description,
      w.cover_image,w.view_count,w.like_count,w.created_at,w.status::text status,w.content_type,
      w.is_completed,w.is_top_recommended,w.is_popular_work,w.is_new_work,
      w.rating,w.ai_usage_type,w.published_at
     from public.works w join authoring.work_state s on s.work_id=w.id
     where authoring.stage8_visible(w.id) order by w.published_at desc nulls last,w.id desc limit 5000) w),'[]'::jsonb),
  'episodes',coalesce((select jsonb_agg(row_to_json(e)) from
    (select e.id::text id,e.work_id::text work_id,e.episode_number,e.title,e.access_policy,
      e.status::text status,e.view_count,e.is_free,e.is_ad_free,e.scheduled_at,e.author_comment
     from public.episodes e join authoring.work_state s on s.work_id=e.work_id
     where authoring.stage8_visible(e.work_id,e.id)
     order by e.work_id,e.episode_number limit 100000) e),'[]'::jsonb))
$$;
revoke all on function public.stage8_catalog() from public,anon,authenticated;
grant execute on function public.stage8_catalog() to service_role;

insert into authoring.migrations(version) values('authoring-009') on conflict do nothing;
notify pgrst,'reload schema';
commit;
