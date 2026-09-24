-- PREPARED ONLY. Run after authoring/003 and documented account ownership verification.
-- Supply these session settings in the same batch; never use a seed email as identity evidence:
-- webnovels.bootstrap_profile_id, webnovels.bootstrap_auth_user_id,
-- webnovels.bootstrap_evidence_ref, webnovels.bootstrap_operator_ref.
-- This operator-only SQL links an existing active SUPER_ADMIN; it never promotes a profile.
begin;
set local lock_timeout='5s';
do $$
declare
  profile_id text:=nullif(current_setting('webnovels.bootstrap_profile_id',true),'');
  auth_id uuid:=nullif(current_setting('webnovels.bootstrap_auth_user_id',true),'')::uuid;
  evidence text:=nullif(btrim(current_setting('webnovels.bootstrap_evidence_ref',true)),'');
  operator_ref text:=nullif(btrim(current_setting('webnovels.bootstrap_operator_ref',true)),'');
  profile public.admin_users;
  account auth.users;
  prior authoring.identity_evidence;
begin
  if current_user in ('anon','authenticated','service_role') then raise exception 'Database operator required'; end if;
  if profile_id is null or auth_id is null or evidence is null or operator_ref is null then
    raise exception 'Verified account, profile, operator and evidence are required'; end if;
  if not exists(select 1 from authoring.migrations where version='authoring-003') then
    raise exception 'Verified identity migration required'; end if;
  lock table public.admin_users in share row exclusive mode;
  select * into account from auth.users where id=auth_id for share;
  if not found or account.email_confirmed_at is null or account.email is null or account.is_anonymous
    or account.deleted_at is not null or account.banned_until>now() then raise exception 'Confirmed active Auth user required'; end if;
  select * into profile from public.admin_users where id::text=profile_id for update;
  if not found or not profile.is_active or profile.role<>'SUPER_ADMIN' then raise exception 'Existing active SUPER_ADMIN required'; end if;
  if profile.auth_user_id is not null and profile.auth_user_id<>auth_id then raise exception 'Existing identity mapping conflicts'; end if;
  if exists(select 1 from public.admin_users where auth_user_id is not null and id::text<>profile_id and is_active and role='SUPER_ADMIN') then
    raise exception 'Use the existing verified administrator for subsequent links'; end if;
  select * into prior from authoring.identity_evidence where profile_kind='admin' and authoring.identity_evidence.profile_id=profile.id::text;
  if found then
    if prior.auth_user_id<>auth_id or profile.auth_user_id is distinct from auth_id then raise exception 'Identity audit conflicts'; end if;
    return;
  end if;
  update public.admin_users set auth_user_id=auth_id where id=profile.id;
  insert into authoring.identity_evidence(profile_kind,profile_id,auth_user_id,evidence_ref,verified_by)
    values('admin',profile.id::text,auth_id,'Initial DB operator bootstrap; operator='||operator_ref||'; evidence='||evidence,auth_id);
end $$;
commit;
