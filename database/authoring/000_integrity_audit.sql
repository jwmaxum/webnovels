-- Read-only aggregate report. No passwords, emails, body text or profile IDs returned.
select jsonb_build_object(
 'works', (select count(*) from public.works),
 'episodes', (select count(*) from public.episodes),
 'orphan_works', (select count(*) from public.works w left join public.authors a on a.id=w.author_id where a.id is null),
 'orphan_episodes', (select count(*) from public.episodes e left join public.works w on w.id=e.work_id where w.id is null),
 'invalid_episode_numbers', (select count(*) from public.episodes where episode_number is null or episode_number<1),
 'duplicate_episode_number_groups', (select count(*) from (select work_id,episode_number from public.episodes group by work_id,episode_number having count(*)>1) s),
 'episode_number_gaps', (select coalesce(sum(missing),0) from (select greatest(max(episode_number)::bigint-count(distinct episode_number),0) missing from public.episodes where episode_number>0 group by work_id) s),
 'duplicate_author_auth_groups', (select count(*) from (select to_jsonb(a)->>'auth_user_id' uid from public.authors a where to_jsonb(a)->>'auth_user_id' is not null group by 1 having count(*)>1) s),
 'duplicate_reader_auth_groups', (select count(*) from (select to_jsonb(a)->>'auth_user_id' uid from public.readers a where to_jsonb(a)->>'auth_user_id' is not null group by 1 having count(*)>1) s),
 'duplicate_admin_auth_groups', (select count(*) from (select to_jsonb(a)->>'auth_user_id' uid from public.admin_users a where to_jsonb(a)->>'auth_user_id' is not null group by 1 having count(*)>1) s),
 'work_statuses', (select jsonb_agg(s) from (select status::text,count(*) from public.works group by 1) s),
 'episode_statuses', (select jsonb_agg(s) from (select status::text,count(*) from public.episodes group by 1) s),
 'work_ratings', (select jsonb_agg(s) from (select rating::text,count(*) from public.works group by 1) s)
) as integrity_audit;
