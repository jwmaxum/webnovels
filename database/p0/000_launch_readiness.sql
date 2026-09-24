-- Read-only aggregates and effective permissions. Never return credentials or manuscript text.
select jsonb_build_object(
 'p0_marker',to_regclass('public.p0_migration_status'),
 'authoring_marker',to_regclass('authoring.migrations'),
 'auth_users',(select count(*) from auth.users),
 'confirmed_auth_users',(select count(*) from auth.users where email_confirmed_at is not null),
 'linked_authors',(select count(*) from public.authors where auth_user_id is not null),
 'linked_readers',(select count(*) from public.readers r where to_jsonb(r)->>'auth_user_id' is not null),
 'linked_admins',(select count(*) from public.admin_users a where to_jsonb(a)->>'auth_user_id' is not null),
 'legacy_drafts',(select count(*) from public.episode_drafts),
 'legacy_revisions',(select count(*) from public.episode_draft_revisions),
 'legacy_draft_owner_conflicts',(select count(*) from public.episode_drafts d left join public.works w on w.id=d.work_id where w.id is null or d.author_id is distinct from w.author_id),
 'legacy_body_conflicts',(select count(*) from public.episode_contents c join public.episodes e on e.id=c.episode_id where c.text_content is distinct from e.content),
 'works_without_author_id',(select count(*) from public.works where author_id is null),
 'storage_buckets',(select count(*) from storage.buckets),
 'storage_objects',(select count(*) from storage.objects),
 'sensitive_column_access',(
   select jsonb_agg(jsonb_build_object('role',r.rolname,'table',t.tablename,'column',a.attname,
     'can_select',has_column_privilege(r.oid,c.oid,a.attnum,'SELECT')))
   from pg_catalog.pg_roles r cross join (values ('authors'),('readers'),('admin_users'),('system_config'),('episodes'),('episode_contents')) t(tablename)
   join pg_catalog.pg_class c on c.oid=to_regclass(format('public.%I',t.tablename))
   join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
   where r.rolname in ('anon','authenticated') and a.attname in ('email','password_hash','toss_secret_key','content','text_content')
 ),
 'browser_writable_tables',(
   select count(distinct c.oid) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   cross join pg_catalog.pg_roles r where n.nspname='public' and c.relkind in ('r','p')
   and r.rolname in ('anon','authenticated') and has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')
 )
) as readiness;
