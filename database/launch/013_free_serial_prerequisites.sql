-- Schema-only compatibility, before authoring/014 on the actual legacy schema.
-- Not part of the private registration rollout. Do not invent historical edit times.
begin;
set local lock_timeout='5s';
do $$ begin
 if current_setting('webnovels.authoring_apply_verified',true) is distinct from 'true'
 or not exists(select 1 from authoring.migrations where version='launch-new-serial-foundation-20261021') then
  raise exception 'Reviewed new serial foundation required'; end if;
end $$;
alter table public.comments add column if not exists updated_at timestamptz;
alter table public.comments alter column updated_at set default now();
alter table public.episodes add column if not exists updated_at timestamptz;
alter table public.episodes alter column updated_at set default now();
alter table public.content_reviews add column if not exists reviewer_id uuid references auth.users(id);
alter table public.reports add column if not exists resolved_by uuid references auth.users(id);
alter table public.reports add column if not exists resolved_at timestamptz;
insert into authoring.migrations(version) values('launch-free-serial-prerequisites-20261021') on conflict do nothing;
commit;
