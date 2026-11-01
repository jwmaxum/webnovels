-- UI-R12: read-only owner CMS projection. No public policy or publication path changes.
-- Requires 015_webtoon and 021_manuscript_documents; all existing review wrappers stay intact.
begin;

create or replace function public.creator_episode_workspace(
 p_user uuid,p_work bigint,p_episode bigint default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.authors; w public.works; s authoring.work_state; result jsonb;
begin
 if p_user is null or p_work is null or p_work<1 or (p_episode is not null and p_episode<1) then
  return jsonb_build_object('error','INVALID_ID','status',400); end if;
 select * into a from public.authors where auth_user_id=p_user and status::text='APPROVED';
 if not found then return jsonb_build_object('error','AUTHOR_REQUIRED','status',403); end if;
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null
   and is_anonymous is not true and (banned_until is null or banned_until<=now()))
  or exists(select 1 from public.readers where auth_user_id=p_user and status::text is distinct from 'ACTIVE')
  or exists(select 1 from public.admin_users where auth_user_id=p_user and is_active is distinct from true) then
  return jsonb_build_object('error','ACCOUNT_INACTIVE','status',403); end if;
 select * into w from public.works where id=p_work and author_id=a.id;
 select * into s from authoring.work_state where work_id=p_work and author_id=a.id;
 if w.id is null or s.work_id is null then return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;

 if p_episode is null then
  with reads as (select ev.episode_id,count(distinct (ev.user_id,ev.bucket))::text total
   from authoring.reader_events_v2 ev where ev.work_id=p_work and ev.user_id<>p_user
    and ev.event_type in ('OPEN','COMPLETE') group by ev.episode_id)
  select coalesce(jsonb_agg(jsonb_build_object(
   'id',e.id::text,'episode_number',e.episode_number,'title',coalesce(v.title,e.title),
   'status',e.status::text,'scheduled_at',e.scheduled_at,
   'member_read_count',coalesce(reads.total,'0'),'published_at',h.published_at,
   'has_head',h.version_id is not null,'versionId',h.version_id,
   'schedule_status',q.status,'due_at',q.due_at,'generation',q.generation
  ) order by e.episode_number,e.id),'[]'::jsonb) into result
  from public.episodes e
  left join reads on reads.episode_id=e.id
  left join authoring.publication_heads h on h.episode_id=e.id
  left join authoring.publication_versions v on v.id=h.version_id and v.episode_id=e.id and v.work_id=p_work
  left join lateral (select qs.status,qs.due_at,qs.generation from authoring.schedules qs
   where qs.episode_id=e.id and qs.status in ('PENDING','RUNNING','FAILED')
   order by case when qs.status='RUNNING' then 0 when qs.status='PENDING' then 1 else 2 end,qs.updated_at desc,qs.id limit 1) q on true
  where e.work_id=p_work;
  return jsonb_build_object('workId',w.id::text,'contentType',w.content_type,'episodes',result);
 end if;

 -- A preview reads the immutable current head, never an active draft or a reservation.
 -- The verified owner can also inspect a withdrawn episode/private work without reopening it.
 select jsonb_build_object('id',e.id::text,'workId',w.id::text,
  'episode_number',e.episode_number,'title',v.title,'status',e.status::text,
  'member_read_count',(select count(distinct (ev.user_id,ev.bucket))::text
   from authoring.reader_events_v2 ev where ev.work_id=p_work and ev.episode_id=e.id
   and ev.user_id<>p_user and ev.event_type in ('OPEN','COMPLETE')),
  'published_at',h.published_at,'versionId',v.id,
  'contentType',w.content_type,'content',v.content,'contentDocument',v.content_document,
  'authorComment',v.author_comment,
  'webtoon',case when v.webtoon is null then null else jsonb_build_object(
   'schemaVersion',1,'credits',v.webtoon->'credits','panels',authoring.webtoon_panels_json(v.webtoon)) end
 ) into result
 from public.episodes e
 join authoring.publication_heads h on h.episode_id=e.id
 join authoring.publication_versions v on v.id=h.version_id and v.episode_id=e.id and v.work_id=p_work
 where e.id=p_episode and e.work_id=p_work;
 if result is null then return jsonb_build_object('error','PUBLICATION_NOT_FOUND','status',404); end if;
 return jsonb_build_object('episode',result);
end $$;

-- API access stays server-only. SECURITY DEFINER performs verified Auth/author/work checks.
revoke all on function public.creator_episode_workspace(uuid,bigint,bigint) from public,anon,authenticated;
grant execute on function public.creator_episode_workspace(uuid,bigint,bigint) to service_role;

insert into authoring.migrations(version) values('authoring-030') on conflict do nothing;
notify pgrst,'reload schema';
commit;
