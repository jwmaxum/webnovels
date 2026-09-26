-- Apply after canonical authoring 001/003/004/005/006 and the isolated rehearsal.
-- Reuse existing account evidence and preserve all original profiles/drafts/episodes.
begin;
set local lock_timeout='5s';
do $$ begin
  if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
    or not launch_recovery.private_authoring_prerequisites()
    or (select count(*) from authoring.migrations where version in
      ('authoring-001','authoring-003','authoring-004','authoring-005','authoring-006'))<>5 then
    raise exception 'Reviewed private workspace migrations required';
  end if;
  if exists(select 1 from launch_recovery.account_links l left join (
    select 'author' kind,id::text profile_id,auth_user_id from public.authors union all
    select 'reader',id::text,auth_user_id from public.readers union all
    select 'admin',id::text,auth_user_id from public.admin_users
  ) p using(kind,profile_id) where p.auth_user_id is distinct from l.auth_user_id) then
    raise exception 'Prior account evidence no longer matches profiles';
  end if;
  if (select count(*) from public.admin_users a join launch_recovery.account_links l
    on l.kind='admin' and l.profile_id=a.id::text and l.auth_user_id=a.auth_user_id
    join auth.users u on u.id=a.auth_user_id
    where a.role='SUPER_ADMIN' and a.is_active and u.email_confirmed_at is not null
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()))<>1 then
    raise exception 'Verified initial administrator required';
  end if;
  if exists(select 1 from authoring.identity_evidence e join launch_recovery.account_links l
    on l.kind=e.profile_kind and l.profile_id=e.profile_id where e.auth_user_id<>l.auth_user_id) then
    raise exception 'Identity evidence conflict';
  end if;
end $$;
insert into authoring.identity_evidence(profile_kind,profile_id,auth_user_id,evidence_ref,verified_by)
select l.kind,l.profile_id,l.auth_user_id,
  'Preserved launch account evidence: '||l.evidence_ref||'; operator='||l.operator_ref||'; backup='||l.backup_sha256,
  (select a.auth_user_id from public.admin_users a join launch_recovery.account_links m
    on m.kind='admin' and m.profile_id=a.id::text and m.auth_user_id=a.auth_user_id where a.role='SUPER_ADMIN' and a.is_active)
from launch_recovery.account_links l on conflict(profile_kind,profile_id) do nothing;

-- Stable UUIDs and legacy source references, with every stored revision retained.
insert into authoring.drafts(id,work_id,author_id,legacy_draft_id,current_revision,created_at,updated_at)
select id,work_id,author_id,id,server_revision,updated_at,updated_at from public.episode_drafts
on conflict(id) do nothing;
insert into authoring.draft_revisions(draft_id,revision,title,content,author_comment,created_at)
select draft_id,server_revision,coalesce(title,''),coalesce(content,''),coalesce(author_comment,''),created_at
from public.episode_draft_revisions on conflict(draft_id,revision) do nothing;
insert into authoring.draft_revisions(draft_id,revision,title,content,author_comment,created_at)
select id,server_revision,coalesce(title,''),coalesce(content,''),coalesce(author_comment,''),updated_at
from public.episode_drafts on conflict(draft_id,revision) do nothing;
do $$ begin
  if exists(select 1 from public.episode_drafts l left join authoring.drafts d on d.id=l.id
    left join authoring.draft_revisions r on r.draft_id=d.id and r.revision=l.server_revision
    where (d.work_id,d.author_id,d.legacy_draft_id) is distinct from (l.work_id,l.author_id,l.id)
      or (r.title,r.content,r.author_comment) is distinct from (coalesce(l.title,''),coalesce(l.content,''),coalesce(l.author_comment,'')))
    or exists(select 1 from public.episode_draft_revisions l left join authoring.draft_revisions r
      on r.draft_id=l.draft_id and r.revision=l.server_revision
      where (r.title,r.content,r.author_comment) is distinct from (coalesce(l.title,''),coalesce(l.content,''),coalesce(l.author_comment,''))) then
    raise exception 'Legacy draft preservation check failed';
  end if;
end $$;

create or replace function public.launch_author_workspace_ready() returns boolean
language sql stable security definer set search_path='' as $$
 select launch_recovery.private_authoring_prerequisites()
 and exists(select 1 from launch_recovery.author_workspace_service where version='workspace-20260926' and enabled)
 and (select count(*) from authoring.migrations where version in
   ('authoring-001','authoring-003','authoring-004','authoring-005','authoring-006'))=5
 and not exists(select 1 from public.works w left join authoring.work_state s on s.work_id=w.id
   where s.work_id is null or s.author_id<>w.author_id)
 and not exists(select 1 from pg_catalog.pg_roles r where r.rolname in ('anon','authenticated') and (
   has_schema_privilege(r.oid,'authoring','USAGE')
   or has_function_privilege(r.oid,'public.creator_works(uuid,text,bigint,jsonb,uuid,text,bigint)','EXECUTE')
   or has_function_privilege(r.oid,'public.creator_drafts(uuid,text,bigint,uuid,jsonb,uuid,bigint)','EXECUTE')))
$$;
revoke all on function public.launch_author_workspace_ready() from public,anon,authenticated;
grant execute on function public.launch_author_workspace_ready() to service_role;
update launch_recovery.author_workspace_service set enabled=true,activated_at=coalesce(activated_at,now())
where version='workspace-20260926';
do $$ begin
  if not public.launch_author_workspace_ready() then raise exception 'Private workspace readiness failed'; end if;
end $$;
notify pgrst,'reload schema';
commit;
