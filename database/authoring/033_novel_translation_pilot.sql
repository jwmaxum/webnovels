-- ML-03 is an opt-in free-novel pilot. Runtime roles never access the tables directly.
begin;
set local lock_timeout='5s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
 or not exists(select 1 from authoring.migrations where version='authoring-021') then
  raise exception 'Reviewed authoring-021 prerequisite required';
 end if;
end $$;

create table if not exists authoring.novel_translation_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 character_limit bigint not null default 0 check(character_limit>=0),
 reserved_characters bigint not null default 0 check(reserved_characters>=0)
);
insert into authoring.novel_translation_settings(singleton) values(true) on conflict do nothing;

-- Operators select the cohort and provision a versioned multilingual glossary.
create table if not exists authoring.novel_translation_works (
 work_id bigint primary key references public.works(id) on delete cascade,
 author_id bigint not null references public.authors(id) on delete cascade,
 selected boolean not null default false,
 consent_revision integer not null default 0 check(consent_revision>=0),
 consent_version text,
 consented_at timestamptz,
 revoked_at timestamptz,
 glossary_resource text,
 glossary_revision integer not null default 0 check(glossary_revision>=0),
 check ((glossary_resource is null and glossary_revision=0) or
  (glossary_revision>0 and glossary_resource is not null and glossary_resource ~ '^projects/[a-z0-9-]+/locations/[a-z0-9-]+/glossaries/[a-zA-Z0-9_-]+$'))
);
create table if not exists authoring.novel_translation_jobs (
 id uuid primary key default gen_random_uuid(),
 work_id bigint not null references authoring.novel_translation_works(work_id) on delete cascade,
 episode_id bigint not null,
 version_id uuid not null,
 locale text not null check(locale in ('en','ja','zh-Hans')),
 consent_revision integer not null check(consent_revision>0),
 glossary_revision integer not null check(glossary_revision>=0),
 state text not null check(state in ('PROCESSING','FAILED','DRAFT','APPROVED')),
 revision integer not null default 1 check(revision>0),
 character_count integer not null check(character_count between 1 and 28000),
 segment_count integer not null check(segment_count between 2 and 1024),
 segments jsonb,
 created_at timestamptz not null default now(),
 approved_at timestamptz,
 reviewed_by uuid,
 unique(version_id,locale,consent_revision,glossary_revision),
 foreign key(version_id,episode_id) references authoring.publication_versions(id,episode_id) on delete cascade,
 check((state in ('DRAFT','APPROVED'))=(segments is not null)),
 check((state='APPROVED')=(approved_at is not null and reviewed_by is not null))
);
create index if not exists novel_translation_job_work_episode on authoring.novel_translation_jobs(work_id,episode_id);
alter table authoring.novel_translation_settings enable row level security;
alter table authoring.novel_translation_works enable row level security;
alter table authoring.novel_translation_jobs enable row level security;
revoke all on authoring.novel_translation_settings,authoring.novel_translation_works,authoring.novel_translation_jobs
 from public,anon,authenticated,service_role;

create or replace function public.novel_translation_author(
 p_user uuid,p_action text,p_work bigint,p_episode bigint default null,p_locale text default null,p_data jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 owner_id bigint;
 pilot authoring.novel_translation_works;
 settings authoring.novel_translation_settings;
 source authoring.publication_versions;
 job authoring.novel_translation_jobs;
 episodes jsonb;
 cost integer;
 part_count integer;
 next_state text;
 required_consent constant text:='google-cloud-translation-v1';
begin
 select a.id into owner_id from public.authors a join auth.users u on u.id=a.auth_user_id
 where u.id=p_user and a.status::text='APPROVED' and u.email_confirmed_at is not null and u.deleted_at is null and u.is_anonymous is not true
  and (u.banned_until is null or u.banned_until<=now());
 if owner_id is null or not exists(select 1 from public.works where id=p_work and author_id=owner_id and content_type='NOVEL') then
  return jsonb_build_object('error','WORK_NOT_FOUND','status',404);
 end if;
 if p_action in ('state','detail') then
  select * into pilot from authoring.novel_translation_works where work_id=p_work;
 else
  select * into pilot from authoring.novel_translation_works where work_id=p_work for update;
 end if;
 if pilot.work_id is null or pilot.author_id<>owner_id or not pilot.selected then
  if p_action='state' then return jsonb_build_object('selected',false); end if;
  return jsonb_build_object('error','TRANSLATION_PILOT_NOT_SELECTED','status',403);
 end if;
 if p_action='consent' then
  if p_data->'accepted' is distinct from 'true'::jsonb or p_data->>'version' is distinct from required_consent then
   return jsonb_build_object('error','TRANSLATION_CONSENT_REQUIRED','status',400);
  end if;
  update authoring.novel_translation_works set consent_revision=consent_revision+1,consent_version=required_consent,
   consented_at=now(),revoked_at=null where work_id=p_work
   and (consented_at is null or revoked_at is not null or consent_version is distinct from required_consent);
  return jsonb_build_object('consented',true);
 end if;
 if p_action='withdraw' then
  update authoring.novel_translation_works set revoked_at=now() where work_id=p_work and consented_at is not null and revoked_at is null;
  return jsonb_build_object('consented',false);
 end if;
 if p_action='state' then
  select coalesce(jsonb_agg(jsonb_build_object('id',ep.episode_id::text,'number',ep.episode_number,'title',ep.item->>'title')
    order by ep.episode_number,ep.episode_id),'[]'::jsonb) into episodes
  from (select * from authoring.stage16_episode_rows(p_work,now()) order by episode_number,episode_id limit 5) ep;
  return jsonb_build_object('selected',true,'consented',pilot.consented_at is not null and pilot.revoked_at is null
   and pilot.consent_version is not distinct from required_consent,'consentVersion',required_consent,'glossaryVersion',pilot.glossary_revision,
   'episodes',episodes,'generationEnabled',(select enabled and character_limit>reserved_characters from authoring.novel_translation_settings where singleton));
 end if;
 if p_locale is null or p_locale not in ('en','ja','zh-Hans') or p_action is null or
  p_action not in ('detail','claim','finish','fail','save','approve') then
  return jsonb_build_object('error','TRANSLATION_INVALID_REQUEST','status',400);
 end if;
 if pilot.consented_at is null or pilot.revoked_at is not null or pilot.consent_version is distinct from required_consent then
  return jsonb_build_object('error','TRANSLATION_CONSENT_REQUIRED','status',403);
 end if;
 select v.* into source
 from (select * from authoring.stage16_episode_rows(p_work,now()) order by episode_number,episode_id limit 5) ep
 join authoring.publication_versions v on v.id=(ep.item->>'versionId')::uuid and v.episode_id=ep.episode_id and v.work_id=p_work
 where ep.episode_id=p_episode and v.webtoon is null;
 if source.id is null then return jsonb_build_object('error','TRANSLATION_EPISODE_UNAVAILABLE','status',404); end if;
 select * into job from authoring.novel_translation_jobs
 where work_id=p_work and episode_id=p_episode and version_id=source.id and locale=p_locale
  and consent_revision=pilot.consent_revision and glossary_revision=pilot.glossary_revision;
 if p_action='detail' then
  return jsonb_build_object('versionId',source.id,'consentRevision',pilot.consent_revision,'glossaryVersion',pilot.glossary_revision,
   'glossaryResource',pilot.glossary_resource,'title',source.title,'content',source.content,'contentDocument',source.content_document,
   'job',case when job.id is not null then jsonb_build_object('state',job.state,'revision',job.revision,'segments',job.segments) end);
 end if;
 if p_action='claim' then
  if p_data->>'versionId' is distinct from source.id::text or p_data->'glossaryVersion' is distinct from to_jsonb(pilot.glossary_revision)
   or p_data->'consentRevision' is distinct from to_jsonb(pilot.consent_revision) then
   return jsonb_build_object('error','TRANSLATION_SOURCE_CHANGED','status',409);
  end if;
  if job.id is not null then return jsonb_build_object('error','TRANSLATION_ALREADY_REQUESTED','status',409); end if;
  if coalesce(p_data->>'characterCount','') !~ '^[0-9]{1,5}$' or coalesce(p_data->>'segmentCount','') !~ '^[0-9]{1,4}$' then
   return jsonb_build_object('error','TRANSLATION_INVALID_REQUEST','status',400);
  end if;
  cost:=(p_data->>'characterCount')::integer;
  part_count:=(p_data->>'segmentCount')::integer;
  if cost not between 1 and 28000 or part_count not between 2 and 1024 then
   return jsonb_build_object('error','TRANSLATION_SOURCE_LIMIT','status',400);
  end if;
  select * into settings from authoring.novel_translation_settings where singleton for update;
  if not settings.enabled or settings.character_limit-settings.reserved_characters<cost then
   return jsonb_build_object('error','TRANSLATION_BUDGET_OR_PROVIDER_DISABLED','status',409);
  end if;
  if ((select count(distinct work_id) from authoring.novel_translation_jobs)>=2
      and not exists(select 1 from authoring.novel_translation_jobs where work_id=p_work))
    or ((select count(distinct episode_id) from authoring.novel_translation_jobs where work_id=p_work)>=5
      and not exists(select 1 from authoring.novel_translation_jobs where work_id=p_work and episode_id=p_episode))
    or (select count(*) from authoring.novel_translation_jobs)>=30 then
   return jsonb_build_object('error','TRANSLATION_PILOT_LIMIT','status',409);
  end if;
  insert into authoring.novel_translation_jobs(work_id,episode_id,version_id,locale,consent_revision,glossary_revision,state,character_count,segment_count)
   values(p_work,p_episode,source.id,p_locale,pilot.consent_revision,pilot.glossary_revision,'PROCESSING',cost,part_count) returning * into job;
  update authoring.novel_translation_settings set reserved_characters=reserved_characters+cost where singleton;
  return jsonb_build_object('jobId',job.id);
 end if;
 if job.id is null or p_data->>'versionId' is distinct from source.id::text or
   (p_action in ('finish','fail') and (job.state<>'PROCESSING' or p_data->>'jobId' is distinct from job.id::text)) or
   (p_action in ('save','approve') and (job.state<>'DRAFT' or p_data->'revision' is distinct from to_jsonb(job.revision))) then
  return jsonb_build_object('error','TRANSLATION_REVISION_CHANGED','status',409);
 end if;
 if p_action<>'fail' then
  if jsonb_typeof(p_data->'segments') is distinct from 'array' or pg_column_size(p_data->'segments')>240000 then
   return jsonb_build_object('error','TRANSLATION_INVALID_SEGMENTS','status',400);
  end if;
  if jsonb_array_length(p_data->'segments')<>job.segment_count or exists(
   select 1 from jsonb_array_elements(p_data->'segments') x(value)
   where jsonb_typeof(x.value)<>'string' or length(x.value#>>'{}') not between 1 and 8000
   or btrim(x.value#>>'{}')='' or x.value#>>'{}' ~ '[[:cntrl:]]') then
   return jsonb_build_object('error','TRANSLATION_INVALID_SEGMENTS','status',400);
  end if;
 end if;
 next_state:=case p_action when 'fail' then 'FAILED' when 'approve' then 'APPROVED' else 'DRAFT' end;
 update authoring.novel_translation_jobs set state=next_state,revision=revision+1,segments=p_data->'segments',
  approved_at=case when next_state='APPROVED' then now() end,reviewed_by=case when next_state='APPROVED' then p_user end
  where id=job.id returning * into job;
 return jsonb_build_object('state',job.state,'revision',job.revision);
end $$;

create or replace function public.novel_translation_public(p_episode bigint,p_version uuid,p_locale text default null)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('locale',j.locale,'segments',case when j.locale=p_locale then j.segments end)
   order by j.locale),'[]'::jsonb)
 from authoring.novel_translation_jobs j join authoring.novel_translation_works pilot on pilot.work_id=j.work_id
 join public.works w on w.id=j.work_id and w.author_id=pilot.author_id
 where j.episode_id=p_episode and j.version_id=p_version and j.state='APPROVED' and j.approved_at<=now()
 and pilot.selected and pilot.consented_at is not null and pilot.revoked_at is null and pilot.consent_version='google-cloud-translation-v1'
 and j.consent_revision=pilot.consent_revision and j.glossary_revision=pilot.glossary_revision
 and exists(select 1 from authoring.stage16_episode_rows(j.work_id,now()) ep
  where ep.episode_id=j.episode_id and ep.item->>'versionId'=p_version::text)
$$;

revoke all on function public.novel_translation_author(uuid,text,bigint,bigint,text,jsonb),public.novel_translation_public(bigint,uuid,text)
 from public,anon,authenticated;
grant execute on function public.novel_translation_author(uuid,text,bigint,bigint,text,jsonb),public.novel_translation_public(bigint,uuid,text)
 to service_role;
insert into authoring.migrations(version) values('authoring-033') on conflict do nothing;
notify pgrst,'reload schema';
commit;
