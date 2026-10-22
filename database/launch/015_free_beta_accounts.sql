-- Stage 35 extends authenticated account receipts. Admin authority remains operator-linked.
begin;
set local lock_timeout='5s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
 or not exists(select 1 from authoring.migrations where version='authoring-024')
 or to_regprocedure('public.launch_accounts_ready()') is null then raise exception 'Reviewed enrollment and account service required'; end if;
end $$;
create or replace function public.launch_account_actor(p_user uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb; a jsonb; m jsonb;
begin
 if not public.launch_accounts_ready() then return jsonb_build_object('error','ACCOUNT_SERVICE_NOT_ACTIVATED','status',503); end if;
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null
   and not is_anonymous and deleted_at is null and (banned_until is null or banned_until<=now())) then
   return jsonb_build_object('error','INVALID_SESSION','status',401); end if;
 if exists(select 1 from launch_recovery.virtual_accounts where auth_user_id=p_user and (deleted_at is not null or desired_ban)) then
   return jsonb_build_object('error','ACCOUNT_INACTIVE','status',403); end if;
 select jsonb_build_object('id',x.id::text,'username',x.username,'nickname',x.nickname,'status',x.status,
   'is_adult_verified',x.is_adult_verified,'adult_verified_at',x.adult_verified_at,'points',x.points)
 into r from public.readers x left join launch_recovery.account_links l on l.kind='reader' and l.profile_id=x.id::text
   and l.auth_user_id=x.auth_user_id where x.auth_user_id=p_user and (l.auth_user_id is not null or exists(select 1 from authoring.free_beta_accounts b where b.auth_user_id=x.auth_user_id and b.kind='reader' and b.profile_id=x.id::text));
 select jsonb_build_object('id',x.id::text,'username',x.username,'pen_name',x.pen_name,'bio',x.bio,'profile_image',x.profile_image,'status',x.status,
   'identity_verified',exists(select 1 from authoring.author_identity_accounts i where i.auth_user_id=x.auth_user_id and i.author_id=x.id))
 into a from public.authors x left join launch_recovery.account_links l on l.kind='author' and l.profile_id=x.id::text
   and l.auth_user_id=x.auth_user_id where x.auth_user_id=p_user and (l.auth_user_id is not null or exists(
   select 1 from authoring.author_identity_accounts i where i.auth_user_id=x.auth_user_id and i.author_id=x.id) or exists(select 1 from authoring.free_beta_accounts b where b.auth_user_id=x.auth_user_id and b.kind='author' and b.profile_id=x.id::text));
 select jsonb_build_object('id',x.id::text,'username',x.username,'nickname',x.nickname,'role',x.role,'is_active',x.is_active,'permissions',x.permissions)
 into m from public.admin_users x join launch_recovery.account_links l on l.kind='admin' and l.profile_id=x.id::text
   and l.auth_user_id=x.auth_user_id where x.auth_user_id=p_user;
 if r is null and a is null and m is null then return jsonb_build_object('error','ACCOUNT_NOT_LINKED','status',403); end if;
 if (r is not null and coalesce(r->>'status','')<>'ACTIVE') or (a is not null and coalesce(a->>'status','')<>'APPROVED') or
   (m is not null and (m->>'is_active')::boolean is not true) then return jsonb_build_object('error','ACCOUNT_INACTIVE','status',403); end if;
 return jsonb_build_object('userId',p_user,'reader',r,'author',a,'admin',m);
end $$;

revoke all on function public.launch_account_actor(uuid) from public,anon,authenticated;
grant execute on function public.launch_account_actor(uuid) to service_role;
create or replace function public.free_beta_enrollment_launch_ready() returns boolean
language sql stable security definer set search_path='' as $$
 select public.launch_accounts_ready() and exists(select 1 from authoring.migrations where version='authoring-024')
$$;
revoke all on function public.free_beta_enrollment_launch_ready() from public,anon,authenticated;
grant execute on function public.free_beta_enrollment_launch_ready() to service_role;
notify pgrst,'reload schema';
commit;
