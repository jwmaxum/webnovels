import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {setup as foundation,admin,reader,limited,uuid} from './op07-db.mjs';
import {encryptProviderSettings} from '../../server/provider-settings-crypto.mjs';
export {admin,reader,limited,uuid};
export const sql=await readFile(new URL('../../database/launch/023_payout_provider_test.sql',import.meta.url),'utf8');
export async function setup(options={}){
 const f=await foundation(options),{db}=f;
 try{
  const routines=(await db.query("select oid::text,prosrc,proacl::text,proconfig from pg_proc where proname like 'op07_%' order by oid")).rows;
  await db.exec("set webnovels.payout_provider_test_apply_verified='true'");await db.exec(sql);
  const adminCall=async(action,data={},user=admin)=>(await db.query('select public.op10_payout_admin($1,$2,$3) result',[user,action,JSON.stringify(data)])).rows[0].result;
  const runtime=async(action,data={})=>(await db.query('select public.op10_payout_runtime($1,$2) result',[action,JSON.stringify(data)])).rows[0].result;
  const env={PAYOUT_PROVIDER_TEST_SETTINGS_ENABLED:'true',PAYOUT_PROVIDER_TEST_ENABLED:'true',PAYOUT_PROVIDER_TEST_ENVIRONMENT:'TEST',PAYOUT_PROVIDER_TEST_RECONCILE_ENABLED:'true',PAYOUT_PROVIDER_TEST_WEBHOOK_ENABLED:'true',PROVIDER_SETTINGS_MASTER_KEY:randomBytes(32).toString('hex'),PROVIDER_SETTINGS_KEY_VERSION:'synthetic-v1'};
  const values={secretKey:'test_sk_synthetic_op10',securityKey:randomBytes(32).toString('hex'),merchantId:'synthetic-op10',webhookKeyBase64:randomBytes(32).toString('base64')};
  const save=async(changes={})=>{const state=await adminCall('state'),v={...values,...changes},envelope=await encryptProviderSettings(v,{provider:'TOSS_PAYOUT',mode:'TEST',env});return adminCall('save',{revision:state.revision,merchantId:v.merchantId,envelope});};
  const prepare=async()=>{
   await f.prepared();const source=(await f.transition('approve',(await f.requestPayout()).payout)).payout;
   const cfg=await save();env.PAYOUT_PROVIDER_TEST_CONFIG_ID=cfg.configId;
   const data={id:uuid(),sourceId:source.id,configId:cfg.configId,destination:'synthetic-seller',scheduleType:'EXPRESS',payoutDate:null,transactionDescription:'TEST정산'};
   const result=await adminCall('prepare',data);return {...result,source,data};
  };
  const claim=(job,action='claim-create')=>runtime(action,{id:job.id,actorId:admin,reviewedConfigId:env.PAYOUT_PROVIDER_TEST_CONFIG_ID});
  const rpc=async(name,body)=>{const result=name==='op10_payout_admin'?await adminCall(body.p_action,body.p_data,body.p_user):await runtime(body.p_action,body.p_data);if(result?.error)throw Object.assign(Error(result.error),{code:result.error,status:result.status});return result;};
  return {...f,adminCall,runtime,claim,save,prepare,env,values,rpc,op07Routines:routines};
 }catch(e){await db.close();throw e;}
}
