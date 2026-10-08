-- Stage 14 Sprint 1. Additive author-owned metadata; does not activate routes.
begin;
do $$ begin
  if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
    or not exists(select 1 from authoring.migrations where version='authoring-005') then
    raise exception 'Reviewed authoring-005 prerequisite required';
  end if;
end $$;

create table if not exists authoring.work_distribution (
  work_id bigint primary key references public.works(id) on delete restrict,
  mode text not null check(mode in ('NON_EXCLUSIVE','EXCLUSIVE_INTEREST')),
  external_links jsonb not null default '[]' check(jsonb_typeof(external_links)='array' and jsonb_array_length(external_links)<=5),
  version bigint not null check(version>0),
  declaration_version text not null check(declaration_version='author-declaration-v1'),
  declared_at timestamptz not null default now()
);
create table if not exists authoring.work_distribution_events (
  work_id bigint not null references public.works(id) on delete restrict,
  version bigint not null,
  author_id bigint not null references public.authors(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  previous_value jsonb not null, next_value jsonb not null,
  created_at timestamptz not null default now(), primary key(work_id,version)
);
alter table authoring.work_distribution enable row level security;
alter table authoring.work_distribution_events enable row level security;
revoke all on authoring.work_distribution,authoring.work_distribution_events from public,anon,authenticated,service_role;

create or replace function authoring.creator_distribution_json(p_work_id bigint) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('workId',p_work_id::text,'mode',coalesce(d.mode,'UNSET'),
    'externalLinks',coalesce(d.external_links,'[]'::jsonb),'version',coalesce(d.version,0)::text,
    'declarationVersion',d.declaration_version,'declaredAt',d.declared_at)
  from (select 1) base left join authoring.work_distribution d on d.work_id=p_work_id;
$$;
revoke all on function authoring.creator_distribution_json(bigint) from public,anon,authenticated,service_role;

create or replace function public.creator_work_distribution(
  p_user_id uuid, p_work_id bigint, p_action text, p_data jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.authors; w public.works; s authoring.work_state; prior jsonb; next_value jsonb;
  prior_version bigint; link jsonb;
begin
  select * into a from public.authors where auth_user_id=p_user_id for update;
  if not found or a.status::text is distinct from 'APPROVED' then
    return jsonb_build_object('error','AUTHOR_REQUIRED','status',403);
  end if;
  if not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null and is_anonymous is not true and (banned_until is null or banned_until<=now()))
    or exists(select 1 from public.readers where auth_user_id=p_user_id and status::text is distinct from 'ACTIVE')
    or exists(select 1 from public.admin_users where auth_user_id=p_user_id and is_active is distinct from true) then
    return jsonb_build_object('error','ACCOUNT_INACTIVE','status',403);
  end if;
  if p_action is null or p_action not in ('get','update') or jsonb_typeof(p_data) is distinct from 'object' then
    return jsonb_build_object('error','INVALID_REQUEST','status',400);
  end if;
  if (p_action='get' and p_data<>'{}') or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('mode','externalLinks','version','rightsConfirmed')) then
    return jsonb_build_object('error','FIELD_NOT_ALLOWED','status',400);
  end if;
  select * into w from public.works where id=p_work_id and author_id=a.id for update;
  if not found then return jsonb_build_object('error','WORK_NOT_FOUND','status',404); end if;
  select * into s from authoring.work_state where work_id=w.id for update;
  if not found or s.author_id is distinct from a.id or
    (s.visibility='PUBLIC') is distinct from (coalesce(w.status::text,'') in ('PUBLISHED','ONGOING','PAUSED','COMPLETED')) then
    return jsonb_build_object('error','WORK_STATE_MIGRATION_REQUIRED','status',503);
  end if;
  prior:=authoring.creator_distribution_json(w.id);
  if p_action='get' then return jsonb_build_object('distribution',prior); end if;
  if s.trashed_at is not null then return jsonb_build_object('error','WORK_TRASHED','status',409); end if;
  if s.moderation_state is distinct from 'CLEAR' then return jsonb_build_object('error','WORK_RESTRICTED','status',403); end if;
  if not (p_data ?& array['mode','externalLinks','version','rightsConfirmed']) then
    return jsonb_build_object('error','FIELD_NOT_ALLOWED','status',400);
  end if;
  if jsonb_typeof(p_data->'version') is distinct from 'string' or coalesce(p_data->>'version','') !~ '^(0|[1-9][0-9]{0,18})$' then
    return jsonb_build_object('error','VERSION_REQUIRED','status',400);
  end if;
  if (p_data->>'version')::numeric>9223372036854775807 then return jsonb_build_object('error','VERSION_REQUIRED','status',400); end if;
  if coalesce(p_data->>'mode','') not in ('NON_EXCLUSIVE','EXCLUSIVE_INTEREST') then return jsonb_build_object('error','INVALID_FIELD','status',400); end if;
  if p_data->'rightsConfirmed' is distinct from 'true'::jsonb then return jsonb_build_object('error','RIGHTS_CONFIRMATION_REQUIRED','status',400); end if;
  if jsonb_typeof(p_data->'externalLinks') is distinct from 'array' then return jsonb_build_object('error','INVALID_EXTERNAL_LINK','status',400); end if;
  if jsonb_array_length(p_data->'externalLinks')>5 then return jsonb_build_object('error','INVALID_EXTERNAL_LINK','status',400); end if;
  for link in select value from jsonb_array_elements(p_data->'externalLinks') loop
    if jsonb_typeof(link) is distinct from 'string' or length(link#>>'{}')>2048 or (link#>>'{}') ~ '[[:space:][:cntrl:]]' or position(chr(92) in link#>>'{}')>0
      or (link#>>'{}') !~ '^https://(www[.]munpia[.]com|novel[.]munpia[.]com|novel[.]naver[.]com|comic[.]naver[.]com|page[.]kakao[.]com|webtoon[.]kakao[.]com|www[.]joara[.]com|www[.]lezhin[.]com)/' then
      return jsonb_build_object('error','INVALID_EXTERNAL_LINK','status',400);
    end if;
  end loop;
  if (select count(*)<>count(distinct value) from jsonb_array_elements_text(p_data->'externalLinks')) then
    return jsonb_build_object('error','INVALID_EXTERNAL_LINK','status',400);
  end if;
  prior_version:=(prior->>'version')::bigint;
  if (p_data->>'version')::bigint<>prior_version then return jsonb_build_object('error','DISTRIBUTION_CONFLICT','status',409); end if;
  if prior_version=9223372036854775807 then return jsonb_build_object('error','VERSION_EXHAUSTED','status',503); end if;
  insert into authoring.work_distribution(work_id,mode,external_links,version,declaration_version,declared_at)
    values(w.id,p_data->>'mode',p_data->'externalLinks',prior_version+1,'author-declaration-v1',now())
    on conflict(work_id) do update set mode=excluded.mode,external_links=excluded.external_links,
      version=excluded.version,declaration_version=excluded.declaration_version,declared_at=excluded.declared_at;
  next_value:=authoring.creator_distribution_json(w.id);
  insert into authoring.work_distribution_events(work_id,version,author_id,actor_user_id,previous_value,next_value)
    values(w.id,prior_version+1,a.id,p_user_id,prior,next_value);
  return jsonb_build_object('distribution',next_value);
end $$;
revoke all on function public.creator_work_distribution(uuid,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.creator_work_distribution(uuid,bigint,text,jsonb) to service_role;
insert into authoring.migrations(version) values('authoring-012') on conflict do nothing;
commit;
