import {z} from 'zod';
const ref=z.string().regex(/^[a-z0-9]{20}$/);
const count=z.string().regex(/^(0|[1-9][0-9]{0,9})$/);
const inventorySchema=z.object({application_tables:count,auth_users:count,storage_buckets:count,storage_objects:count,
  foreign_servers:count,custom_triggers:count,cron_present:z.boolean()}).strict();
export const targetInventorySql=`select
  (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','authoring','launch_recovery','commerce','growth') and c.relkind in ('r','p','v','m')) application_tables,
  (select count(*)::text from auth.users) auth_users,(select count(*)::text from storage.buckets) storage_buckets,
  (select count(*)::text from storage.objects) storage_objects,
  (select count(*)::text from pg_foreign_server) foreign_servers,
  (select count(*)::text from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and n.nspname in ('public','auth','storage','authoring','launch_recovery','commerce','growth')
    and not exists(select 1 from pg_depend d where d.classid='pg_trigger'::regclass and d.objid=t.oid and d.deptype='e')) custom_triggers,
  to_regclass('cron.job') is not null cron_present`;

export async function inspectRestoreTarget({sourceRef,targetRef=null,token,fetcher=fetch,now=new Date().toISOString()}) {
  const report={format:'webnovels-restore-target-v1',checkedAt:now,
    sourceRef:ref.safeParse(sourceRef).success?sourceRef:null,targetRef:ref.safeParse(targetRef).success?targetRef:null,
    kind:'HOSTED_READ_ONLY_PREFLIGHT',status:'BLOCKED',accessible:false,emptyTargetVerified:false,
    restoreExecuted:false,restoreAllowed:false,hostedRestoreAccepted:false,flagsChanged:false,blockers:[]};
  const block=code=>{report.blockers.push(code);return report;};
  if(!ref.safeParse(sourceRef).success)return block('INVALID_SOURCE_REF');
  if(targetRef===null)return block('ISOLATED_TARGET_NOT_CONFIGURED');
  if(!ref.safeParse(targetRef).success)return block('INVALID_TARGET_REF');
  if(targetRef===sourceRef)return block('PRODUCTION_TARGET_FORBIDDEN');
  if(typeof token!=='string'||!token.startsWith('sbp_'))return block('MANAGEMENT_CREDENTIAL_REQUIRED');
  const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  const get=async(suffix,query)=>{
    const r=await fetcher('https://api.supabase.com/v1/projects/'+targetRef+suffix,{headers,redirect:'error',signal:AbortSignal.timeout(20000),
      ...(query?{method:'POST',body:JSON.stringify({query})}:{method:'GET'})});
    if(!r.ok)throw Error('RESTORE_TARGET_ACCESS_FAILED');return r.json();
  };
  try{
    const rows=await get('/database/query/read-only',targetInventorySql);
    const parsed=inventorySchema.safeParse(Array.isArray(rows)?rows[0]:null);
    if(!parsed.success)return block('TARGET_INVENTORY_UNVERIFIED');
    const inventory=parsed.data;report.accessible=true;report.inventory=inventory;
    if(['application_tables','auth_users','storage_buckets','storage_objects'].some(k=>inventory[k]!=='0'))block('TARGET_HAS_EXISTING_DATA_OR_APPLICATION_SCHEMA');
    else report.emptyTargetVerified=true;
    if(inventory.foreign_servers!=='0'||inventory.custom_triggers!=='0')block('TARGET_EXTERNAL_ACTIONS_REQUIRE_REVIEW');
    if(inventory.cron_present){
      const cron=await get('/database/query/read-only','select count(*)::text active_jobs from cron.job where active');
      if(!count.safeParse(cron?.[0]?.active_jobs).success)block('TARGET_CRON_UNVERIFIED');
      else {report.activeCronJobs=cron[0].active_jobs;if(cron[0].active_jobs!=='0')block('TARGET_CRON_ACTIVE');}
    }else report.activeCronJobs='0';
    const config=await get('/config/auth');
    // Do not persist SMTP host/password, OAuth credentials, URL lists or the raw provider reply.
    report.authIsolation={signupDisabled:config.disable_signup===true,emailProviderDisabled:config.external_email_enabled===false};
    if(!report.authIsolation.signupDisabled||!report.authIsolation.emailProviderDisabled)block('TARGET_AUTH_EXTERNAL_EFFECTS_NOT_ISOLATED');
    report.status=report.blockers.length?'BLOCKED':'EMPTY_ISOLATED_TARGET_OBSERVED';
    report.pending=['CONFIRM_TARGET_OWNERSHIP','REVIEW_SOURCE_ARCHIVE_EXTERNAL_EFFECTS','VERIFY_RESTORE_SCHEMA_ROLE_PLAN',
      'OFF_DEVICE_ENCRYPTED_BACKUP','EXECUTE_HOSTED_RESTORE_AND_ROLE_STORAGE_ACCEPTANCE'];
    return report;
  }catch{return block('TARGET_ACCESS_OR_CONFIGURATION_UNVERIFIED');}
}
