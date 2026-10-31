-- Scope review receipts to their work, matching publish_requests(work_id,key).
-- Apply only after reviewed 022 and a verified current backup. No data rewrite.
begin;
set local lock_timeout='5s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
 or not exists(select 1 from authoring.migrations where version='authoring-022') then
  raise exception 'Reviewed authoring-022 prerequisite required';
 end if;
end $$;

-- Keep the constraint replacement and both lookups atomic with new requests.
-- Old receipts/decisions/arguments remain immutable and keep their original IDs.
lock table authoring.publication_changes in access exclusive mode;
do $$
declare old_names text[];new_names text[];old_columns smallint[];new_columns smallint[];
begin
 select array_agg(a.attnum order by names.position) into old_columns
 from unnest(array['user_id','kind','request_fingerprint']) with ordinality names(name,position)
 join pg_attribute a on a.attrelid='authoring.publication_changes'::regclass and a.attname=names.name and not a.attisdropped;
 select array_agg(a.attnum order by names.position) into new_columns
 from unnest(array['user_id','work_id','kind','request_fingerprint']) with ordinality names(name,position)
 join pg_attribute a on a.attrelid='authoring.publication_changes'::regclass and a.attname=names.name and not a.attisdropped;
 if coalesce(cardinality(old_columns),0)<>3 or coalesce(cardinality(new_columns),0)<>4 then
  raise exception 'Unexpected review receipt columns; review before applying';
 end if;
 if (select count(*) from pg_constraint where conrelid='authoring.publication_changes'::regclass and contype='u')<>1 then
  raise exception 'Unexpected review receipt uniqueness; review before applying';
 end if;
 select array_agg(conname::text) into old_names from pg_constraint
 where conrelid='authoring.publication_changes'::regclass and contype='u' and conkey=old_columns and convalidated and not condeferrable;
 select array_agg(conname::text) into new_names from pg_constraint
 where conrelid='authoring.publication_changes'::regclass and contype='u' and conkey=new_columns and convalidated and not condeferrable;
 if coalesce(cardinality(old_names),0)=1 and coalesce(cardinality(new_names),0)=0 then
  alter table authoring.publication_changes add constraint publication_changes_work_request_key
   unique(user_id,work_id,kind,request_fingerprint);
  execute format('alter table authoring.publication_changes drop constraint %I restrict',old_names[1]);
 elsif coalesce(cardinality(old_names),0)<>0 or coalesce(cardinality(new_names),0)<>1 then
  raise exception 'Unexpected review receipt uniqueness; review before applying';
 end if;
end $$;

-- Replace only the two reviewed fragments, leaving ownership, validation,
-- author/work lock order, approval rehearsal and same-work conflicts intact.
-- CREATE OR REPLACE preserves owner/ACL; pg_get_functiondef retains settings.
-- The private helper has no direct browser or service_role EXECUTE path.
do $$
declare definition text;original_acl aclitem[];original_owner oid;original_config text[];original_security boolean;
 old_fragments text[]:=array[
  $old$from authoring.publication_changes where user_id=u and kind=k and arguments=args;$old$,
  $old$from authoring.publication_changes where user_id=u and kind=k and arguments->>'key'=args->>'key')$old$
 ];
 new_fragments text[]:=array[
  $new$from authoring.publication_changes where user_id=u and work_id=w and kind=k and arguments=args;$new$,
  $new$from authoring.publication_changes where user_id=u and work_id=w and kind=k and arguments->>'key'=args->>'key')$new$
 ];
 original_count integer;patched_count integer;state integer;fragment_state integer;i integer;signature regprocedure;
begin
 signature:='authoring.review_change(text,uuid,bigint,jsonb,boolean)'::regprocedure;
 select proacl,proowner,proconfig,prosecdef into original_acl,original_owner,original_config,original_security
 from pg_proc where oid=signature;
 if original_security or not coalesce(original_config @> array['search_path=""'],false)
 or has_function_privilege('anon',signature,'EXECUTE')
 or has_function_privilege('authenticated',signature,'EXECUTE')
 or has_function_privilege('service_role',signature,'EXECUTE') then
  raise exception 'Unexpected private review helper permissions; review before applying';
 end if;
 definition:=pg_get_functiondef(signature);
 for i in 1..2 loop
  original_count:=(length(definition)-length(replace(definition,old_fragments[i],'')))/length(old_fragments[i]);
  patched_count:=(length(definition)-length(replace(definition,new_fragments[i],'')))/length(new_fragments[i]);
  if original_count=1 and patched_count=0 then fragment_state:=0;
  elsif original_count=0 and patched_count=1 then fragment_state:=1;
  else raise exception 'Unexpected review receipt lookup; review before applying';end if;
  if state is not null and state<>fragment_state then
   raise exception 'Partially patched review receipt lookup; review before applying';
  end if;
  state:=fragment_state;
 end loop;
 if state=0 then
  for i in 1..2 loop definition:=replace(definition,old_fragments[i],new_fragments[i]);end loop;
  execute definition;
 end if;
 if not exists(select 1 from pg_proc where oid=signature and proacl is not distinct from original_acl
  and proowner=original_owner and proconfig is not distinct from original_config and prosecdef=original_security) then
  raise exception 'Review helper identity or permissions changed';
 end if;
end $$;

-- No new table/schema/sequence or grants. Existing RLS, immutable triggers,
-- service-only public wrappers and explicit table ACLs are unchanged.
insert into authoring.migrations(version) values('authoring-029') on conflict do nothing;
notify pgrst,'reload schema';
commit;
