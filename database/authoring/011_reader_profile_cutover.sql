-- Stage 10: a verified reader may change only their own nickname through the service API.
-- Review the live schema, backup, and authoring-010 before applying in staging.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
  if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
    or not exists(select 1 from authoring.migrations where version='authoring-010') then
    raise exception 'Reviewed authoring-010 prerequisite required';
  end if;
end $$;

create or replace function public.stage10_reader_profile(p_user uuid,p_nickname text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.readers;
begin
  if p_nickname is null or length(btrim(p_nickname)) not between 2 and 40
    or p_nickname ~ '[<>[:cntrl:]]' then
    return jsonb_build_object('error','INVALID_NICKNAME','status',400);
  end if;
  select * into r from public.readers
    where auth_user_id=p_user and status::text='ACTIVE' for update;
  if not found or not exists(select 1 from auth.users
    where id=p_user and email_confirmed_at is not null and is_anonymous is not true
      and (banned_until is null or banned_until<=now())) then
    return jsonb_build_object('error','READER_REQUIRED','status',403);
  end if;
  update public.readers set nickname=btrim(p_nickname) where id=r.id returning * into r;
  return jsonb_build_object('id',r.id::text,'nickname',r.nickname);
exception when unique_violation then
  return jsonb_build_object('error','NICKNAME_CONFLICT','status',409);
end $$;
revoke all on function public.stage10_reader_profile(uuid,text) from public,anon,authenticated;
grant execute on function public.stage10_reader_profile(uuid,text) to service_role;
insert into authoring.migrations(version) values('authoring-011') on conflict do nothing;
notify pgrst,'reload schema';
commit;
