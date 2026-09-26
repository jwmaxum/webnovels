-- Owner dashboard and settlement-account registration, never payout authorization.
begin;
set local lock_timeout='5s';
do $$ begin
 if current_setting('webnovels.dashboard_apply_verified',true) is distinct from 'true'
   or not public.launch_author_workspace_ready() then raise exception 'Dashboard review gate'; end if;
end $$;

create table if not exists launch_recovery.author_payout_details (
 author_id bigint primary key references public.authors(id),
 bank_name text not null, account_holder text not null,
 account_envelope jsonb not null, last4 text not null check(last4 ~ '^[0-9]{4}$'),
 revision bigint not null default 1 check(revision>0),
 verification_status text not null default 'PENDING' check(verification_status='PENDING'),
 updated_at timestamptz not null default now()
);
create table if not exists launch_recovery.author_dashboard_audit (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references auth.users(id),
 author_id bigint not null references public.authors(id), action text not null,
 revision text not null, created_at timestamptz not null default now()
);
create table if not exists launch_recovery.author_bank_attempts (
 author_id bigint primary key references public.authors(id),
 window_start timestamptz not null, attempts integer not null
);
alter table launch_recovery.author_payout_details enable row level security;
alter table launch_recovery.author_dashboard_audit enable row level security;
alter table launch_recovery.author_bank_attempts enable row level security;
revoke all on launch_recovery.author_payout_details,launch_recovery.author_dashboard_audit,launch_recovery.author_bank_attempts from public,anon,authenticated,service_role;
drop trigger if exists author_dashboard_audit_immutable on launch_recovery.author_dashboard_audit;
create trigger author_dashboard_audit_immutable before update or delete on launch_recovery.author_dashboard_audit
 for each row execute function launch_recovery.account_audit_immutable();

create or replace function launch_recovery.author_dashboard_profile(p_id bigint) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('profile',jsonb_build_object('penName',a.pen_name,'bio',coalesce(a.bio,''),
   'email',u.email,'version',md5(jsonb_build_array(a.pen_name,a.bio,a.status,v.revision)::text)),
   'bank',case when b.author_id is null then null else jsonb_build_object('bankName',b.bank_name,
     'holder',b.account_holder,'maskedNumber','**** '||b.last4,'revision',b.revision::text,
     'verificationStatus',b.verification_status,'updatedAt',b.updated_at) end,
   'legacyBankExists',exists(select 1 from public.author_settlement_accounts x where x.author_id=a.id))
 from public.authors a join auth.users u on u.id=a.auth_user_id
 left join launch_recovery.virtual_accounts v on v.kind='author' and v.profile_id=a.id::text
 left join launch_recovery.author_payout_details b on b.author_id=a.id where a.id=p_id
$$;

create or replace function public.launch_author_dashboard(p_user uuid,p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare who jsonb; aid bigint; profile jsonb; bank launch_recovery.author_payout_details;
 month_filter text:=coalesce(p_data->>'month',''); page_no integer; total_count bigint; result jsonb; rev text;
begin
 if not public.launch_author_workspace_ready() then return jsonb_build_object('error','AUTHOR_WORKSPACE_NOT_ACTIVATED','status',503); end if;
 who:=public.launch_account_actor(p_user);
 if who ? 'error' then return who; end if;
 if coalesce(who->'author'->>'status','')<>'APPROVED' then return jsonb_build_object('error','AUTHOR_REQUIRED','status',403); end if;
 aid:=(who->'author'->>'id')::bigint;
 if p_action='home' then
   return jsonb_build_object('counts',jsonb_build_object(
     'works',(select count(*) from authoring.work_state where author_id=aid and trashed_at is null),
     'episodes',(select count(*) from public.episodes e join authoring.work_state w on w.work_id=e.work_id where w.author_id=aid and w.trashed_at is null),
     'drafts',(select count(*) from authoring.drafts d join authoring.work_state w on w.work_id=d.work_id where d.author_id=aid and w.author_id=aid and w.trashed_at is null and d.lifecycle='ACTIVE')),
     'estimatedRevenue',null,'revenueStatus','NOT_CONNECTED',
     'bankRegistered',exists(select 1 from launch_recovery.author_payout_details where author_id=aid),
     'recentWorks',coalesce((select jsonb_agg(to_jsonb(x)) from (
       select w.id::text id,w.title,s.visibility from public.works w join authoring.work_state s on s.work_id=w.id and s.author_id=w.author_id
       where w.author_id=aid and s.trashed_at is null order by s.updated_at desc,w.id desc limit 5) x),'[]'::jsonb));
 end if;
 if p_action='earnings' then
   if (month_filter<>'' and month_filter !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$') or
     coalesce(p_data->>'page','0') !~ '^[0-9]{1,4}$' then return jsonb_build_object('error','INVALID_QUERY','status',400); end if;
   page_no:=coalesce(p_data->>'page','0')::integer;
   if page_no>2000 then return jsonb_build_object('error','INVALID_QUERY','status',400); end if;
   select count(*) into total_count from public.author_earnings e where e.author_id=aid and
     (e.work_id is null or exists(select 1 from public.works w where w.id=e.work_id and w.author_id=aid)) and
     (month_filter='' or to_char(e.period_date,'YYYY-MM')=month_filter);
   return jsonb_build_object('estimatedRevenue',null,'revenueStatus','NOT_CONNECTED','recordStatus','UNVERIFIED_LEGACY',
     'total',total_count,'page',page_no,'pageSize',50,
     'months',coalesce((select jsonb_agg(m order by m desc) from (select distinct to_char(e.period_date,'YYYY-MM') m from public.author_earnings e
       where e.author_id=aid and e.period_date is not null and (e.work_id is null or exists(select 1 from public.works w where w.id=e.work_id and w.author_id=aid))) x),'[]'::jsonb),
     'records',coalesce((select jsonb_agg(to_jsonb(x)) from (
       select e.id,e.period_date "date",e.author_revenue::text amount,e.status "recordedStatus",w.title "workTitle"
       from public.author_earnings e left join public.works w on w.id=e.work_id and w.author_id=aid
       where e.author_id=aid and (e.work_id is null or w.id is not null) and (month_filter='' or to_char(e.period_date,'YYYY-MM')=month_filter)
       order by e.period_date desc nulls last,e.id limit 50 offset page_no*50) x),'[]'::jsonb));
 end if;
 if p_action='profile' then return launch_recovery.author_dashboard_profile(aid); end if;
 if p_action not in ('save-profile','bank-attempt','save-bank') then return jsonb_build_object('error','INVALID_ACTION','status',400); end if;
 -- Same lock order as administrator account edits; recheck suspension after the lock.
 perform 1 from launch_recovery.virtual_accounts where kind='author' and profile_id=aid::text for update;
 perform 1 from public.authors where id=aid for update;
 who:=public.launch_account_actor(p_user); if who ? 'error' then return who; end if;
 profile:=launch_recovery.author_dashboard_profile(aid);
 if p_action='bank-attempt' then
   insert into launch_recovery.author_bank_attempts(author_id,window_start,attempts) values(aid,now(),1)
   on conflict(author_id) do update set window_start=case when author_bank_attempts.window_start<now()-interval '15 minutes' then now() else author_bank_attempts.window_start end,
     attempts=case when author_bank_attempts.window_start<now()-interval '15 minutes' then 1 else author_bank_attempts.attempts+1 end
   where author_bank_attempts.window_start<now()-interval '15 minutes' or author_bank_attempts.attempts<5;
   if not found then return jsonb_build_object('error','RATE_LIMITED','status',429); end if;
   return jsonb_build_object('ok',true);
 elsif p_action='save-profile' then
   if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('version','penName','bio')) or
     jsonb_typeof(p_data->'penName') is distinct from 'string' or length(btrim(p_data->>'penName')) not between 2 and 40 or
     p_data->>'penName' ~ '[<>[:cntrl:]]' or jsonb_typeof(p_data->'bio') is distinct from 'string' or length(p_data->>'bio')>2000 then
     return jsonb_build_object('error','INVALID_PROFILE','status',400); end if;
   if p_data->>'version' is distinct from profile->'profile'->>'version' then return jsonb_build_object('error','PROFILE_CONFLICT','status',409); end if;
   update public.authors set pen_name=btrim(p_data->>'penName'),bio=p_data->>'bio' where id=aid;
   update launch_recovery.virtual_accounts set revision=revision+1,updated_at=now() where kind='author' and profile_id=aid::text;
   result:=launch_recovery.author_dashboard_profile(aid); rev:=result->'profile'->>'version';
 else
   if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('revision','bankName','holder','last4','envelope')) or
     coalesce(p_data->>'last4','') !~ '^[0-9]{4}$' or coalesce(p_data->>'bankName','') !~ '^[^<>[:cntrl:]]{2,60}$' or
     coalesce(p_data->>'holder','') !~ '^[^<>[:cntrl:]]{2,80}$' or jsonb_typeof(p_data->'envelope') is distinct from 'object' or
     p_data->'envelope'->>'version' is distinct from '1' or coalesce(p_data->'envelope'->>'iv','') !~ '^[A-Za-z0-9+/]{16}$' or
     coalesce(p_data->'envelope'->>'keyId','') !~ '^[a-f0-9]{16}$' or coalesce(p_data->'envelope'->>'ciphertext','') !~ '^[A-Za-z0-9+/=]{32,64}$' then
     return jsonb_build_object('error','INVALID_BANK_DETAILS','status',400); end if;
   select * into bank from launch_recovery.author_payout_details where author_id=aid;
   if p_data->>'revision' is distinct from coalesce(bank.revision,0)::text then return jsonb_build_object('error','PROFILE_CONFLICT','status',409); end if;
   insert into launch_recovery.author_payout_details(author_id,bank_name,account_holder,account_envelope,last4)
     values(aid,btrim(p_data->>'bankName'),btrim(p_data->>'holder'),p_data->'envelope',p_data->>'last4')
   on conflict(author_id) do update set bank_name=excluded.bank_name,account_holder=excluded.account_holder,
     account_envelope=excluded.account_envelope,last4=excluded.last4,revision=author_payout_details.revision+1,
     verification_status='PENDING',updated_at=now();
   result:=launch_recovery.author_dashboard_profile(aid); rev:=result->'bank'->>'revision';
 end if;
 insert into launch_recovery.author_dashboard_audit(actor_id,author_id,action,revision) values(p_user,aid,p_action,rev);
 return result;
end $$;
revoke all on function launch_recovery.author_dashboard_profile(bigint) from public,anon,authenticated,service_role;
revoke all on function public.launch_author_dashboard(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.launch_author_dashboard(uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
