-- Record the first-work route with the private work in the same transaction.
begin;
set local lock_timeout='5s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
  or not exists(select 1 from authoring.migrations where version='authoring-022') then
  raise exception 'Reviewed authoring-022 prerequisite required';
 end if;
 if to_regprocedure('authoring.first_registration_original_works(uuid,text,bigint,jsonb,uuid,text,bigint)') is null then
  alter function public.creator_works(uuid,text,bigint,jsonb,uuid,text,bigint) set schema authoring;
  alter function authoring.creator_works(uuid,text,bigint,jsonb,uuid,text,bigint) rename to first_registration_original_works;
 end if;
end $$;
revoke all on function authoring.first_registration_original_works(uuid,text,bigint,jsonb,uuid,text,bigint)
 from public,anon,authenticated,service_role;

create table if not exists authoring.first_work_registrations (
 author_id bigint primary key references public.authors(id) on delete cascade,
 request_key uuid not null,
 registration_path text not null check (registration_path in ('NO_SETTLEMENT','FOREIGN')),
 registered_at timestamptz not null default now()
);
alter table authoring.first_work_registrations enable row level security;
revoke all on authoring.first_work_registrations from public,anon,authenticated,service_role;

create or replace function public.creator_works(
 p_user_id uuid,p_action text,p_work_id bigint default null,p_data jsonb default '{}',
 p_key uuid default null,p_filter text default 'all',p_after bigint default 0
) returns jsonb language plpgsql security definer set search_path='' as $$
declare author public.authors; registration authoring.first_work_registrations;
 requires_path boolean; selected_path text; result jsonb;
begin
 if p_action is distinct from 'first-registration' and p_action is distinct from 'create' then
  return authoring.first_registration_original_works(p_user_id,p_action,p_work_id,p_data,p_key,p_filter,p_after);
 end if;
 -- Same author lock as the existing creation RPC. Concurrent first creates cannot both record a route.
 select * into author from public.authors where auth_user_id=p_user_id for update;
 if not found or author.status::text is distinct from 'APPROVED' then
  return jsonb_build_object('error','AUTHOR_REQUIRED','status',403);
 end if;
 if not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null
    and is_anonymous is not true and (banned_until is null or banned_until<=now()))
  or exists(select 1 from public.readers where auth_user_id=p_user_id and status::text is distinct from 'ACTIVE')
  or exists(select 1 from public.admin_users where auth_user_id=p_user_id and is_active is distinct from true) then
  return jsonb_build_object('error','ACCOUNT_INACTIVE','status',403);
 end if;
 select * into registration from authoring.first_work_registrations where author_id=author.id;
 requires_path:=registration.author_id is null and not exists(select 1 from public.works where author_id=author.id);
 if p_action='first-registration' then
  return jsonb_build_object('required',requires_path);
 end if;

 if jsonb_typeof(p_data) is distinct from 'object' then
  return jsonb_build_object('error','INVALID_REQUEST','status',400);
 end if;
 if p_data?'firstWorkPath' then
  selected_path:=p_data->>'firstWorkPath';
  if selected_path is null or selected_path not in ('DOMESTIC_SETTLEMENT','NO_SETTLEMENT','FOREIGN') then
   return jsonb_build_object('error','INVALID_FIELD','status',400);
  end if;
 end if;
 if registration.request_key=p_key and selected_path is not null and selected_path<>registration.registration_path then
  return jsonb_build_object('error','IDEMPOTENCY_CONFLICT','status',409);
 end if;
 if selected_path='DOMESTIC_SETTLEMENT' then
  return jsonb_build_object('error','FIRST_WORK_PASS_REQUIRED','status',403);
 end if;
 if requires_path and selected_path is null then
  return jsonb_build_object('error','FIRST_WORK_PATH_REQUIRED','status',400);
 end if;
 result:=authoring.first_registration_original_works(p_user_id,p_action,p_work_id,p_data-'firstWorkPath',p_key,p_filter,p_after);
 if requires_path and result->'created'='true'::jsonb then
  insert into authoring.first_work_registrations(author_id,request_key,registration_path)
  values(author.id,p_key,selected_path);
 end if;
 return result;
end $$;
revoke all on function public.creator_works(uuid,text,bigint,jsonb,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.creator_works(uuid,text,bigint,jsonb,uuid,text,bigint) to service_role;
insert into authoring.migrations(version) values('authoring-034') on conflict do nothing;
notify pgrst,'reload schema';
commit;
