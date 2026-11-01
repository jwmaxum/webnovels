-- Add trustworthy last-authored ordering to the existing private draft list.
-- Preserve all drafts, revisions, save receipts, ownership checks and review gates.
begin;
set local lock_timeout='5s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
 or not exists(select 1 from authoring.migrations where version='authoring-021')
 or not exists(select 1 from authoring.migrations where version='authoring-028') then
  raise exception 'Reviewed authoring-021 and authoring-028 prerequisites required';
 end if;
end $$;

-- d.updated_at also changes during publication/cancellation. Order by the actual
-- immutable revision creation time so an old draft being archived cannot become
-- the latest authored manuscript. No manuscript content is returned by this list.
do $$
declare definition text;matches integer;patched_matches integer;
 old_fragment text:=$old$select coalesce(jsonb_agg(x.item),'[]') into items from (
    select jsonb_build_object('id',dd.id,'title',r.title,'lifecycle',dd.lifecycle,'revision',dd.current_revision::text) item
    from authoring.drafts dd join authoring.draft_revisions r on r.draft_id=dd.id and r.revision=dd.current_revision
    where dd.work_id=p_work_id and dd.author_id=a.id order by dd.created_at,dd.id) x;$old$;
 new_fragment text:=$new$select coalesce(jsonb_agg(x.item order by x.written_at desc,x.draft_id),'[]') into items from (
    select dd.id draft_id,r.created_at written_at,
      jsonb_build_object('id',dd.id,'title',r.title,'lifecycle',dd.lifecycle,'revision',dd.current_revision::text,
        'episodeId',dd.episode_id::text,'createdAt',dd.created_at,'updatedAt',r.created_at) item
    from authoring.drafts dd join authoring.draft_revisions r on r.draft_id=dd.id and r.revision=dd.current_revision
    where dd.work_id=p_work_id and dd.author_id=a.id) x;$new$;
begin
 definition:=pg_get_functiondef('public.creator_drafts(uuid,text,bigint,uuid,jsonb,uuid,bigint)'::regprocedure);
 matches:=(length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment);
 patched_matches:=(length(definition)-length(replace(definition,new_fragment,'')))/length(new_fragment);
 if matches=1 and patched_matches=0 then
  execute replace(definition,old_fragment,new_fragment);
 elsif matches<>0 or patched_matches<>1 then
  raise exception 'Unexpected draft list definition; review before applying';
 end if;
end $$;

-- No new tables or direct browser access. Existing verified-owner RPC only.
revoke all on function public.creator_drafts(uuid,text,bigint,uuid,jsonb,uuid,bigint) from public,anon,authenticated;
grant execute on function public.creator_drafts(uuid,text,bigint,uuid,jsonb,uuid,bigint) to service_role;
insert into authoring.migrations(version) values('authoring-031') on conflict do nothing;
notify pgrst,'reload schema';
commit;
