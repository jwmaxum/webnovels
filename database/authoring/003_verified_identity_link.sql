-- Operator-only account linking; never accepts an email match as ownership evidence.
begin;
do $$ begin
  if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true' then raise exception 'Authoring schema/backup review gate required'; end if;
  if not exists(select 1 from authoring.migrations where version='authoring-001') then raise exception 'Authoring foundation required'; end if;
end $$;
grant select(id,auth_user_id),update(auth_user_id) on public.readers,public.authors to service_role;
grant select(id,auth_user_id,role,is_active),update(auth_user_id) on public.admin_users to service_role;
create or replace function authoring.link_verified_identity(
  p_kind text,p_profile_id text,p_auth_user_id uuid,p_verified_by uuid,p_evidence_ref text
) returns boolean language plpgsql set search_path='' as $$
declare target_table text; previous_uid uuid; affected bigint; prior authoring.identity_evidence;
begin
  target_table := case p_kind when 'reader' then 'readers' when 'author' then 'authors' when 'admin' then 'admin_users' else null end;
  if target_table is null or p_auth_user_id is null or p_profile_id is null or p_verified_by is null or p_evidence_ref is null or length(btrim(p_evidence_ref))=0 then
    raise exception 'Verified mapping input required' using errcode='22023';
  end if;
  if not exists(select 1 from public.admin_users where auth_user_id=p_verified_by and is_active and role='SUPER_ADMIN') then
    raise exception 'Verified super administrator required' using errcode='42501';
  end if;
  execute format('select auth_user_id from public.%I where id::text=$1 for update',target_table) into previous_uid using p_profile_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Profile not found' using errcode='P0002'; end if;
  if previous_uid is not null and previous_uid <> p_auth_user_id then raise exception 'Existing identity mapping conflicts' using errcode='23505'; end if;
  select * into prior from authoring.identity_evidence where profile_kind=p_kind and profile_id=p_profile_id;
  if found then
    if prior.auth_user_id <> p_auth_user_id or previous_uid is distinct from p_auth_user_id then
      raise exception 'Identity audit conflicts' using errcode='23505';
    end if;
    return false; -- exact mapping already linked; do not rewrite the original evidence
  end if;
  execute format('update public.%I set auth_user_id=$1 where id::text=$2',target_table) using p_auth_user_id,p_profile_id;
  insert into authoring.identity_evidence(profile_kind,profile_id,auth_user_id,evidence_ref,verified_by)
    values(p_kind,p_profile_id,p_auth_user_id,p_evidence_ref,p_verified_by);
  return true;
end $$;
revoke all on function authoring.link_verified_identity(text,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function authoring.link_verified_identity(text,text,uuid,uuid,text) to service_role;
insert into authoring.migrations(version) values('authoring-003') on conflict do nothing;
commit;
