-- New buckets only. Does not privatize/change existing customer buckets.
begin;
set local lock_timeout='5s';
do $$ begin
  if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true' then raise exception 'Authoring schema/backup review gate required'; end if;
  if not exists(select 1 from authoring.migrations where version='authoring-001') then raise exception 'Authoring foundation required'; end if;
  if not exists(select 1 from pg_class where oid='storage.objects'::regclass and relrowsecurity) then
    raise exception 'Storage objects RLS must already be enabled';
  end if;
  if exists(select 1 from storage.buckets where id in ('authoring-originals','authoring-covers') and public is distinct from false) then
    raise exception 'Existing public bucket conflicts with private authoring contract';
  end if;
end $$;
insert into storage.buckets(id,name,public) values
 ('authoring-originals','authoring-originals',false),('authoring-covers','authoring-covers',false)
on conflict(id) do nothing;
-- Restrictive policy defeats other permissive policies for these buckets only.
drop policy if exists authoring_private_objects on storage.objects;
create policy authoring_private_objects on storage.objects as restrictive for all to anon,authenticated
  using(bucket_id not in ('authoring-originals','authoring-covers'))
  with check(bucket_id not in ('authoring-originals','authoring-covers'));
insert into authoring.migrations(version) values('authoring-002') on conflict do nothing;
commit;
