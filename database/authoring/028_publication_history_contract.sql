-- Expose episode publication history through existing private owner-only JSON.
-- Reservations do not count as public content; review gates remain unchanged.
begin;
set local lock_timeout='5s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
 or not exists(select 1 from authoring.migrations where version='authoring-021')
 or not exists(select 1 from authoring.migrations where version='authoring-022') then
  raise exception 'Reviewed authoring-021 and authoring-022 prerequisites required';
 end if;
end $$;

-- The original list used the same e/v names for PL/pgSQL row variables and
-- subquery aliases. Replace exactly this projection, preserving every gate.
do $$
declare definition text;matches integer;patched_matches integer;
 old_fragment text:=$old$select v.id,e.episode_number,v.created_at from authoring.publication_versions v
       join public.episodes e on e.id=v.episode_id where v.work_id=w.id
       order by e.episode_number,v.created_at limit 200$old$;
 new_fragment text:=$new$select list_version.id,list_episode.episode_number,list_version.created_at from authoring.publication_versions list_version
       join public.episodes list_episode on list_episode.id=list_version.episode_id where list_version.work_id=w.id
       order by list_episode.episode_number,list_version.created_at limit 200$new$;
begin
 definition:=pg_get_functiondef('authoring.review_original_publications(uuid,text,bigint,uuid,bigint,jsonb,uuid)'::regprocedure);
 matches:=(length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment);
 patched_matches:=(length(definition)-length(replace(definition,new_fragment,'')))/length(new_fragment);
 if matches=1 and patched_matches=0 then
  execute replace(definition,old_fragment,new_fragment);
 elsif matches<>0 or patched_matches<>1 then
  raise exception 'Unexpected original publication list definition; review before applying';
 end if;
end $$;

create or replace function authoring.draft_json(p_id uuid,p_revision bigint) returns jsonb
language sql stable set search_path='' as $$
select jsonb_build_object('id',d.id,'workId',d.work_id::text,'episodeId',d.episode_id::text,
 'revision',r.revision::text,'lifecycle',d.lifecycle,'title',r.title,'content',r.content,'authorComment',r.author_comment,
 'hasPublicationHistory',exists(select 1 from public.episodes e
   where e.id=d.episode_id and e.work_id=d.work_id
   and ((to_jsonb(e)->>'published_at') is not null or e.status::text='PUBLISHED'
     or exists(select 1 from authoring.publication_heads h where h.episode_id=e.id))))
 ||case when r.content_document is null then '{}'::jsonb else jsonb_build_object('contentDocument',r.content_document) end
 ||case when r.webtoon is null then '{}'::jsonb else jsonb_build_object('webtoon',r.webtoon) end
from authoring.drafts d join authoring.draft_revisions r on r.draft_id=d.id and r.revision=p_revision where d.id=p_id;
$$;
revoke all on function authoring.draft_json(uuid,bigint) from public,anon,authenticated,service_role;

create or replace function authoring.publication_json(p_version uuid) returns jsonb
language sql stable set search_path='' as $$
select jsonb_build_object(
  'versionId',v.id,'episodeId',v.episode_id::text,'workId',v.work_id::text,
  'draftId',v.source_draft_id,'revision',v.source_revision::text,
  'episodeNumber',e.episode_number,'title',v.title,
  'accessPolicy',e.access_policy,'isFree',e.is_free,
  'status',case when h.version_id=v.id then 'PUBLISHED'
                when q.status='PENDING' then 'SCHEDULED'
                when q.status='SUCCEEDED' then 'SUPERSEDED'
                when q.status is not null then q.status else 'SUPERSEDED' end,
  'scheduleId',q.id,'generation',q.generation,'dueAt',q.due_at,
  'displayTimezone',q.display_timezone,'lastErrorCode',q.last_error_code,
  'publishedAt',case when h.version_id=v.id then h.published_at else null end,
  'hasPublicationHistory',(to_jsonb(e)->>'published_at') is not null
    or coalesce(e.status::text='PUBLISHED',false) or h.episode_id is not null
) from authoring.publication_versions v
join public.episodes e on e.id=v.episode_id
left join authoring.publication_heads h on h.episode_id=e.id
left join authoring.schedules q on q.version_id=v.id
where v.id=p_version;
$$;
revoke all on function authoring.publication_json(uuid) from public,anon,authenticated,service_role;

insert into authoring.migrations(version) values('authoring-028') on conflict do nothing;
notify pgrst,'reload schema';
commit;
