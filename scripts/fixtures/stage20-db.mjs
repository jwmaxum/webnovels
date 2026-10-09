import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup as foundation,admin,reader,limited} from './stage17-db.mjs';
export {admin,reader,limited};
export const otherReader='44444444-4444-4444-8444-444444444444';
export const policy='local-fixture-v1',merchant='fixture_mid';
export const uuid=()=>crypto.randomUUID();
export const sql=await readFile(new URL('../../database/authoring/016_paid_episodes.sql',import.meta.url),'utf8');
export async function setup(){
 const {db}=await foundation();
 try{
  await db.exec(sql);
  await db.query('insert into auth.users(id) values($1)',[otherReader]);
  await db.query("insert into readers(id,auth_user_id,status) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',$1,'ACTIVE')",[otherReader]);
  await db.query("insert into commerce.policies(version,provenance,merchant_id,fee_bps,author_bps,terms) values($1,'LOCAL_SIMULATED',$2,300,7000,'합성 시험 정책입니다. 운영 가격·배분·약관이 아닙니다.')",[policy,merchant]);
  const call=async(action,data={},user=reader)=>(await db.query('select public.stage20_payments($1,$2,$3) result',[user,action,JSON.stringify(data)])).rows[0].result;
  const apply=async(t,receipt)=>(await db.query('select public.stage20_apply_payment($1,$2,$3) result',[t.id,t.lease,JSON.stringify(receipt)])).rows[0].result;
  const offer=async({amount=101,kind='OWN',hours=null}={})=>{
   const w=(await db.query("select public.creator_works($1,'create',null,$2,$3) result",[admin,JSON.stringify({title:'시험 작품'}),uuid()])).rows[0].result.work.id;
   await db.query("update works set description='시험 소개',genre=array['판타지'] where id=$1",[w]);
   await db.query('update authoring.work_state set rating_confirmed=true,ai_confirmed=true where work_id=$1',[w]);
   const d=uuid();const saved=(await db.query("select public.creator_drafts($1,'save',$2,$3,$4,$5) result",[admin,w,d,JSON.stringify({title:'시험 회차',content:'시험용 본문입니다.',authorComment:'',expectedRevision:'0'}),uuid()])).rows[0].result;
   assert.ok(saved.draft,JSON.stringify(saved));
   const p=(await db.query("select public.creator_publications($1,'publish',$2,$3,null,$4,$5) result",[admin,w,d,JSON.stringify({revision:'1',episodeNumber:1,mode:'NOW',rightsConfirmed:true}),uuid()])).rows[0].result;
   assert.ok(p.publication,JSON.stringify(p));
   const episode=p.publication.episodeId;
   // This is synthetic data only; the production authoring flow continues to publish FREE.
   await db.query("update episodes set is_free=false,access_policy='PAID' where id=$1",[episode]);
   await db.query('insert into commerce.offers(episode_id,policy_version,amount_krw,access_kind,duration_hours,enabled) values($1,$2,$3,$4,$5,true)',[episode,policy,amount,kind,hours]);
   return {episode,w};
  };
  const quote=async(episode)=>call('quote',{episodeId:episode,merchantId:merchant,provenance:'LOCAL_SIMULATED'});
  const create=async(episode,changes={})=>{
   const {quote:q}=await quote(episode);assert.ok(q);
   const data={episodeId:episode,requestId:uuid(),offerVersion:q.offerVersion,policyVersion:q.policyVersion,
    expectedAmountKrw:q.amountKrw,merchantId:merchant,provenance:'LOCAL_SIMULATED',...changes};
   return {data,...await call('create',data)};
  };
  const claim=async(id,action='claim-confirm',data={},user=reader)=>call(action,{orderId:id,...(action==='claim-confirm'?{paymentKey:'pk_'+uuid()}:{}),...data},user);
  const receipt=(t,state='APPROVED')=>({state,paymentKey:t.payment_key,merchantId:t.merchant_id,mode:'TEST',amountKrw:t.amount_krw,currency:'KRW',approvedAt:new Date().toISOString(),transactionKey:'txn_'+uuid(),...(state==='CANCELLED'?{cancelledAt:new Date().toISOString()}: {})});
  const paid=async(options)=>{const f=await offer(options),c=await create(f.episode),r=await claim(c.order.id);const proof=receipt(r.transport);const result=await apply(r.transport,proof);assert.equal(result.order?.status,'PAID',JSON.stringify(result));return {...f,...c,t:r.transport,proof};};
  return {db,call,apply,offer,quote,create,claim,receipt,paid};
 }catch(error){await db.close();throw error;}
}
