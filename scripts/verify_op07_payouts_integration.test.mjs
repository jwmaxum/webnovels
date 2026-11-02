import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transform} from 'esbuild';
import {createSecureApi} from '../server/secure-api.mjs';
import {setup,admin,uuid} from './fixtures/op07-db.mjs';
import {env} from './fixtures/op07-api.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('real gateway and synthetic SQL complete source -> request -> approve -> uncertain -> matched TEST evidence',async()=>{
 const f=await setup();try{
  const actor={userId:admin,author:{id:f.author,status:'APPROVED'},admin:{role:'SUPER_ADMIN',is_active:true}};
  const run=createSecureApi({fetchImpl:async(url,init={})=>{const u=new URL(url);assert.equal(u.origin,'https://synthetic.supabase.co');const body=init.body?JSON.parse(init.body):{};
   if(u.pathname==='/auth/v1/user')return Response.json({id:admin,email_confirmed_at:'2026-01-01T00:00:00Z'});
   if(u.pathname.endsWith('/launch_accounts_ready'))return Response.json(true);
   if(u.pathname.endsWith('/launch_account_actor'))return Response.json(actor);
   if(u.pathname.endsWith('/op07_payouts'))return Response.json(await f.payouts(body.p_action,body.p_data,body.p_user));
   assert.fail('unexpected provider/DB path '+u.pathname);
  }});
  async function call(action,data={},adminRoute=true){const write=adminRoute||['request','cancel'].includes(action);const q=new URLSearchParams({action,...(!write?data:{})});const r=await run(new Request('https://site.test/api/v2/'+(adminRoute?'admin':'creator')+'/payouts-test?'+q,{method:write?'POST':'GET',headers:{Authorization:'Bearer synthetic.jwt.token',Origin:'https://site.test','Content-Type':'application/json'},...(write?{body:JSON.stringify(data)}:{})}),env);const result=await r.json();assert.equal(r.status,200,JSON.stringify(result));return result;}
  const start=await call('state');assert.equal(start.policy.enabled,false);
  await call('policy',{enabled:true,authorBps:7000,deductionBps:0,revision:start.revision,reason:'합성 정책 대조',requestId:uuid()});
  const authors=await call('authors',{offset:0,query:''}),a=authors.items.find(x=>x.id===f.author);assert(a);
  await call('payee',{authorId:a.id,ready:true,testReference:'TEST-gateway-author',revision:a.payee.revision,reason:'모의 대상 준비',requestId:uuid()});
  const consumed=await f.fundedConsumption(),sources=await call('sources',{offset:0,authorId:a.id});assert.equal(sources.items[0].sourceAmountKrw,100);
  const policy=(await call('state')).policy;
  const confirmed=await call('confirm',{allocationId:consumed.allocationId,policyVersion:policy.id,reason:'원충전 소비 대조',requestId:uuid()});assert.equal(confirmed.earning.netKrw,70);
  const own=await call('summary',{},false);assert.equal(own.summary.availableKrw,70);
  const input={amountKrw:70,policyVersion:policy.id,payeeRevision:own.payee.revision,requestId:uuid()},requested=await call('request',input,false);assert.equal(requested.summary.availableKrw,0);assert.equal((await call('request',input,false)).replayed,true);
  const change=(action,p,extra={})=>call(action,{payoutId:p.id,revision:p.revision,reason:'모의 상태 증빙 대조',requestId:uuid(),...extra});
  const approved=await change('approve',requested.payout);assert.equal(approved.payout.status,'APPROVED');assert.equal(approved.summary.paidKrw,0);
  const unknown=await change('begin',approved.payout);assert.equal(unknown.payout.status,'UNKNOWN');assert.equal(unknown.summary.reservedKrw,70);
  const paid=await change('paid',unknown.payout,{reference:'TEST-gateway-transfer',testReference:unknown.payout.testReference,amountKrw:70,paidAt:new Date().toISOString()});assert.equal(paid.payout.status,'PAID');assert.equal(paid.summary.paidKrw,70);assert.equal(paid.summary.reservedKrw,0);
  const adjusted=await call('adjust',{earningId:confirmed.earning.id,amountKrw:20,reason:'모의 분쟁 후 수익 감액',requestId:uuid()});assert.equal(adjusted.summary.debtKrw,20);
  const statement=await call('earnings',{offset:0},false);assert.equal(statement.items[0].availableNetKrw,50);assert.equal(statement.items[0].adjustments[0].amountKrw,20);
  const detail=await call('request-detail',{payoutId:paid.payout.id},false);assert.equal(detail.payout.evidence.source,'LOCAL_SIMULATED');
 }finally{await f.db.close();}
});

test('shared module loads before both owners, stale sessions dispose and only changed resources are versioned',()=>{
 const loader=read('public/js/core/role-modules.js'),html=read('public/index.html');
 const c={window:{},Map,Set};vm.runInNewContext(loader,c);
 assert.equal((loader.match(/\/js\/shared\/payouts-test\.js\?v=20261102op11/g)||[]).length,2);
 for(const file of ['creator/creator-dashboard','admin/admin-console'])assert(loader.indexOf('/js/shared/payouts-test.js?')<loader.indexOf('/js/'+file+'.js?v='+('20261102op12')));
 assert.match(html,/payouts-test\.css\?v=20261102op07/);
 assert.match(html,/supabase-public-config\.js\?v=20261102op12/);
 for(const x of ['auth-session','router','role-modules'])assert(html.includes('/js/core/'+x+'.js?v='+(x==='role-modules'?'20261102op12':x==='router'?'20261102op07':'20261102op12')));
 for(const x of ['reader-rewards-test','reader-points-test','reader-topups'])assert(html.includes('/js/reader/'+x+'.js?v=20261102op06'));
 const auth=read('public/js/core/auth-session.js');assert.match(auth,/AuthorPayoutsTest\?\.reset\(\)/);assert.match(auth,/AdminPayoutsTest\?\.reset\(\)/);
 assert.match(read('public/js/creator/creator-dashboard.js'),/AuthorPayoutsTest\?\.leave\(\)/);
 assert.match(read('public/js/admin/admin-operations.js'),/AdminPayoutsTest\?\.leave\(\)/);
});
test('settlement stylesheet parses and does not introduce global layout selectors',async()=>{
 const css=read('public/css/payouts-test.css');await transform(css,{loader:'css'});assert(!/(?:^|\})\s*(?:body|html|button|input)\s*\{/m.test(css));assert.match(css,/@media\(max-width:640px\)/);
});
