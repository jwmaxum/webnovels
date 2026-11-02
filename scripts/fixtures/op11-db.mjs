import {readFile} from 'node:fs/promises';
import {setup as foundation,admin,reader,limited,uuid} from './op10-db.mjs';
export {admin,reader,limited,uuid};
export const sql=await readFile(new URL('../../database/launch/024_manual_payout_workflow.sql',import.meta.url),'utf8');
export async function setup(options={}){
 const f=await foundation(options),{db}=f;
 try{
  await db.exec("set webnovels.manual_payout_workflow_apply_verified='true'");await db.exec(sql);
  const flow=async(action,data={},user=admin,isAdmin=true)=>(await db.query('select public.op11_manual_payout($1,$2,$3,$4) result',[user,action,JSON.stringify(data),isAdmin])).rows[0].result;
  const approve=async()=>{await f.prepared();return (await f.transition('approve',(await f.requestPayout()).payout)).payout;};
  const change=(p,extra={})=>({payoutId:p.id||p.payoutId,revision:p.revision,requestId:uuid(),reason:'수동 송금 절차 합성 검증',...extra});
  const start=async p=>flow('start',change(p));
  const proof=p=>change(p,{reference:'TEST-transfer-'+uuid(),documentReference:'TEST-document-'+uuid(),testReference:p.payeeReference,amountKrw:p.amountKrw,paidAt:new Date().toISOString()});
  return {...f,flow,approve,change,start,proof};
 }catch(e){await db.close();throw e;}
}
