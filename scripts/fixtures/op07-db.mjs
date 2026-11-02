import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup as foundation,admin,reader,limited,otherReader,uuid} from './op06-db.mjs';
export {admin,reader,limited,otherReader,uuid};
export const sql=await readFile(new URL('../../database/launch/022_author_payouts_test.sql',import.meta.url),'utf8');
export async function setup(options={}){
 const f=await foundation(options),{db}=f;
 try{
  const originalRoutines=(await db.query("select p.oid::text,n.nspname,p.proname,p.prosrc,p.proowner::text,p.proacl::text,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('commerce','public') order by p.oid")).rows;
  const tables=(await db.query("select tablename from pg_tables where schemaname='commerce' order by tablename")).rows.map(r=>r.tablename),snapshot={};
  for(const table of tables)snapshot[table]=(await db.query('select to_jsonb(x) data from commerce.'+table+' x order by to_jsonb(x)::text')).rows.map(r=>r.data);
  await db.exec("set webnovels.author_payouts_test_apply_verified='true'");await db.exec(sql);
  assert.deepEqual((await db.query("select p.oid::text,n.nspname,p.proname,p.prosrc,p.proowner::text,p.proacl::text,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('commerce','public') and p.proname not like 'op07_%' order by p.oid")).rows,originalRoutines);
  for(const table of tables)assert.deepEqual((await db.query('select to_jsonb(x) data from commerce.'+table+' x order by to_jsonb(x)::text')).rows.map(r=>r.data),snapshot[table]);
  const author=(await db.query('select id::text from public.authors where auth_user_id=$1',[admin])).rows[0].id;
  const payouts=async(action,data={},user=admin)=>(await db.query('select public.op07_payouts($1,$2,$3) result',[user,action,JSON.stringify(data)])).rows[0].result;
  const adminPayouts=(action,data={})=>payouts('admin-'+action,data);
  const payoutPolicy=async(changes={})=>{const state=await adminPayouts('state');return adminPayouts('policy',{enabled:true,authorBps:7000,deductionBps:0,revision:state.revision,reason:'명시적 TEST 수익 분배 정책',requestId:uuid(),...changes});};
  const payee=async(changes={})=>{const row=(await adminPayouts('authors',{query:''})).items.find(x=>x.id===author);return adminPayouts('payee',{authorId:author,ready:true,testReference:'TEST-payee-'+uuid(),revision:row.payee.revision,reason:'실제 계좌가 아닌 합성 지급 대상',requestId:uuid(),...changes});};
  const sources=(changes={})=>adminPayouts('sources',{offset:0,...changes});
  const confirm=async(allocationId,changes={})=>adminPayouts('confirm',{allocationId,policyVersion:(await adminPayouts('state')).policy.id,reason:'원충전 소비 근거 TEST 수익 확정',requestId:uuid(),...changes});
  const requestPayout=async(amountKrw=70,changes={})=>{const state=await payouts('summary');return payouts('request',{amountKrw,policyVersion:state.policy.id,payeeRevision:state.payee.revision,requestId:uuid(),...changes});};
  const transition=(action,payout,changes={})=>adminPayouts(action,{payoutId:payout.id,revision:payout.revision,reason:'정산 상태 변경 합성 인수',requestId:uuid(),...changes});
  const evidence=(payout,changes={})=>({reference:'TEST-evidence-'+uuid(),testReference:payout.testReference,amountKrw:payout.amountKrw,paidAt:new Date().toISOString(),...changes});
  const fundedConsumption=async({amountKrw=10000,points=10000,episodeId=f.novel.episodes[2].id,user=reader}={})=>{const product=await f.makeProduct({amountKrw,points});const order=(await f.create(product,'BANK',{},user)).order;assert.equal((await f.deposit(order)).order.status,'PAID');const quote=await f.quote(episodeId,user),purchase=await f.purchase(quote.quote.id,uuid(),user);assert.equal(purchase.chargedPoints,100);const allocation=(await db.query('select x.id from commerce.op05_allocations x join commerce.op04_purchases p on p.id=x.purchase_id where p.episode_id=$1 and p.user_id=$2 order by x.id limit 1',[episodeId,user])).rows[0];return {product,order,purchase,allocationId:allocation.id};};
  const prepared=async(options={})=>{await payoutPolicy();await payee();const consumed=await fundedConsumption(options),confirmed=await confirm(consumed.allocationId);assert.ok(confirmed.earning,JSON.stringify(confirmed));return {...consumed,earning:confirmed.earning};};
  async function makeAuthorNovel(user=reader){
   const created=(await db.query("select public.creator_works($1,'create',null,$2,$3) result",[user,JSON.stringify({title:'OP07 별도 작가 TEST 소설',contentType:'NOVEL'}),uuid()])).rows[0].result;
   assert.ok(created.work,JSON.stringify(created));const workId=created.work.id,episodes=[];
   await db.query("update public.works set description='별도 작가 합성 소개',genre=array['판타지'] where id=$1",[workId]);await db.query('update authoring.work_state set rating_confirmed=true,ai_confirmed=true where work_id=$1',[workId]);
   for(let number=1;number<=3;number++){
    const draftId=uuid(),saved=(await db.query("select public.creator_drafts($1,'save',$2,$3,$4,$5) result",[user,workId,draftId,JSON.stringify({title:number+'화 TEST',content:'두번째 작가의 합성 TEST 본문',authorComment:'',expectedRevision:'0'}),uuid()])).rows[0].result;assert.ok(saved.draft,JSON.stringify(saved));
    const publication=(await db.query("select public.creator_publications_v18($1,'publish',$2,$3,null,$4,$5) result",[user,workId,draftId,JSON.stringify({revision:'1',episodeNumber:number,mode:'NOW',rightsConfirmed:true}),uuid()])).rows[0].result;assert.ok(publication.publication,JSON.stringify(publication));episodes.push({id:publication.publication.episodeId});
   }
   assert.equal((await f.enroll(workId)).saved,true);return {id:workId,episodes};
  }
  return {...f,payouts,adminPayouts,payoutPolicy,payee,sources,confirm,requestPayout,transition,evidence,fundedConsumption,prepared,makeAuthorNovel,author,originalRoutines,preservedTables:tables,preservedSnapshot:snapshot};
 }catch(error){await db.close();throw error;}
}
