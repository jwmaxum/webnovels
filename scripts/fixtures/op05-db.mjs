import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setup as foundation,admin,reader,limited,otherReader,uuid} from './op04-db.mjs';
export {admin,reader,limited,otherReader,uuid};
export const sql=await readFile(new URL('../../database/launch/020_topups_test.sql',import.meta.url),'utf8');
export const provider={providerMode:'LOCAL_SIMULATED',merchantId:'LOCAL_SIMULATED',binding:'a'.repeat(64)};
export async function setup({seed=true,openingPoints=0}={}){
 const f=await foundation({seed});const {db}=f;
 try{
  if(openingPoints)assert.equal((await f.credit(openingPoints)).creditedPoints,openingPoints);
  const before=(await db.query("select prosrc,proowner::text from pg_proc where oid='public.op04_points_test(uuid,text,jsonb)'::regprocedure")).rows[0];
  const existingLedger=(await db.query('select row_to_json(l) data from commerce.op04_ledger l order by id')).rows.map(r=>r.data);
  await db.exec("set webnovels.topups_test_apply_verified='true'");await db.exec(sql);
  const after=(await db.query("select prosrc,proowner::text from pg_proc where oid='commerce.op05_points_base(uuid,text,jsonb)'::regprocedure")).rows[0];assert.deepEqual(after,before);
  assert.deepEqual((await db.query("select to_jsonb(l)-'order_id'-'refund_id' data from commerce.op04_ledger l order by id")).rows.map(r=>r.data),existingLedger);
  const topups=async(action,data={},user=reader)=>(await db.query('select public.op05_topups($1,$2,$3) result',[user,action,JSON.stringify(data)])).rows[0].result;
  const adminTopups=(action,data={})=>topups('admin-'+action,data,admin);
  const product=async(changes={})=>{
   const state=await adminTopups('state');return adminTopups('product',{productId:null,title:'명시적 TEST 충전상품',amountKrw:10000,points:10000,enabled:true,startsAt:new Date(Date.now()-1000).toISOString(),endsAt:null,expiresMinutes:60,revision:state.revision,reason:'합성 검증용 TEST 상품 설정',requestId:uuid(),...changes});
  };
  const makeProduct=async(changes={})=>{const before=await adminTopups('state'),known=new Set(before.products.map(p=>p.versionId));const saved=await product(changes);assert.equal(saved.saved,true,JSON.stringify(saved));return saved.products.find(p=>!known.has(p.versionId));};
  const create=(p,method='BANK',changes={},user=reader)=>topups('create',{productId:p.id,productVersion:p.versionId,method,requestId:uuid(),...changes},user);
  const deposit=(order,changes={})=>adminTopups('deposit',{orderId:order.id,bankReference:'deposit-'+uuid(),amountKrw:order.amountKrw,receivedAt:new Date().toISOString(),reason:'은행 입금 증빙 대조 TEST',requestId:uuid(),...changes});
  const claim=(action,order,changes={},user=reader)=>topups(action,{orderId:order.id,...provider,...changes},user);
  const apply=async(transport,receipt)=>(await db.query('select public.op05_apply($1,$2,$3,$4) result',[transport.orderId,transport.operationId,transport.lease,JSON.stringify(receipt)])).rows[0].result;
  const approved=(t,changes={})=>({state:'APPROVED',amountKrw:t.amountKrw,merchantId:t.merchantId,paymentKey:t.paymentKey,approvedAt:new Date().toISOString(),transactionKey:'approval-'+uuid(),...changes});
  const cancelled=(t,changes={})=>({state:'CANCELLED',amountKrw:t.amountKrw,merchantId:t.merchantId,paymentKey:t.paymentKey,cancelledAt:new Date().toISOString(),transactionKey:'cancel-'+uuid(),cancelAmountKrw:t.refundAmountKrw,balanceKrw:t.expectedBalanceKrw,...changes});
  const card=async(p,changes={})=>{const created=await create(p,'CARD');assert.ok(created.order,JSON.stringify(created));const c=await claim('claim-confirm',created.order,{paymentKey:'payment-'+uuid(),...changes});assert.ok(c.transport,JSON.stringify(c));return {order:(await apply(c.transport,approved(c.transport))).order,transport:c.transport};};
  const refund=(order,changes={},user=reader)=>claim('claim-refund',order,{reason:'미사용 포인트 전부 환불 TEST',requestId:uuid(),...changes},user);
  const bankRefund=(order,changes={})=>adminTopups('bank-refund',{orderId:order.id,bankReference:'refund-'+uuid(),amountKrw:order.refund?.amountKrw??order.refundAmountKrw,paidAt:new Date().toISOString(),reason:'은행 실제 환불 이체 증빙 TEST',requestId:uuid(),...changes});
  const lots=async(user=reader)=>(await db.query('select * from commerce.op05_lots where user_id=$1 order by sequence',[user])).rows;
  const wallet=()=>f.call('wallet');
  const sourceHash=createHash('sha256').update(before.prosrc).digest('hex');
  return {...f,topups,adminTopups,product,makeProduct,create,deposit,claim,apply,approved,cancelled,card,refund,bankRefund,lots,wallet,sourceHash,sourceOwner:before.proowner};
 }catch(error){await db.close();throw error;}
}
