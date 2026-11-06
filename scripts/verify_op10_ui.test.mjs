import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import worker from '../scheduler/worker.mjs';
const code=readFileSync('public/js/admin/admin-payout-provider-test.js','utf8');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.value='';this.attrs={};this._text='';}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;this._text='';}
 set textContent(v){this.replaceChildren();this._text=String(v);}get textContent(){return this._text+this.children.map(n=>n.textContent).join(' ');}
 set innerHTML(_){assert.fail('text-only rendering required');}setAttribute(k,v){this.attrs[k]=v;}
}
const all=n=>[n,...n.children.flatMap(all)],button=(f,text)=>all(f.root).find(n=>n.tag==='button'&&n.textContent===text);
const field=(f,label)=>all(f.root).find(n=>n.tag==='label'&&n._text===label)?.children[0];
function fixture({settings=false,handler,role='SUPER_ADMIN'}={}){
 let who={userId:randomUUID(),admin:{role,is_active:true}};const root=new Element('div'),calls=[],configId=randomUUID(),sourceId=randomUUID(),jobId=randomUUID();
 const state={revision:'1',configId,configured:true,keyReady:true,runtimeEnabled:true,reviewedConfigId:configId};
 const data={items:[{id:jobId,sourceId,configId,state:'READY',amountKrw:70,destination:'synthetic',transactionDescription:'TEST'}],total:1};
 const window={WebNovelsAuth:{getActor:()=>who,api:async(url,init)=>{const body=init?.body?JSON.parse(init.body):null;calls.push({url,body});const result=await handler?.(url,body);if(result!==undefined)return result;if(!body)return state;if(url.includes('/payouts-test?'))return {items:[{id:sourceId,authorName:'합성 작가',amountKrw:70}]};if(body.action==='list')return data;if(body.action==='prepare')return {job:{id:body.id}};if(body.action==='detail')return {evidence:[{state:'PENDING',requestedAt:null}]};if(body.action==='save')return {saved:true,revision:'2',configId:randomUUID(),configured:true};return {claimed:true};}}};
 vm.runInNewContext(code,{window,document:{createElement:t=>new Element(t)},crypto:{randomUUID},console});
 return {root,window,calls,state,data,configId,sourceId,jobId,render:()=>window.AdminPayoutProviderTest.render(root,{settings}),reset:()=>window.AdminPayoutProviderTest.reset(),switch:()=>{who={...who,userId:randomUUID()};}};
}
test('settings are explicit TEST, passwords clear on save/reset and stale responses cannot redraw',async()=>{
 const f=fixture({settings:true});await f.render();assert.match(f.root.textContent,/카드결제 키와 별개/);assert.match(f.root.textContent,/실제 작가 지급 기능이 아닙니다/);
 const inputs=all(f.root).filter(x=>x.tag==='input');assert(inputs.every(i=>i.type==='password'));inputs.forEach(i=>{i.value='synthetic';});
 const form=all(f.root).find(n=>n.tag==='form');await form.onsubmit({preventDefault(){}});assert(inputs.every(i=>i.value===''));assert.equal(f.calls.at(-1).body.action,'save');
 inputs.forEach(i=>{i.value='private';});f.reset();assert(inputs.every(i=>i.value===''));assert.equal(f.root.children.length,0);
 let resolve;const wait=new Promise(r=>resolve=r),late=fixture({handler:(_url,body)=>!body?wait:undefined});const rendering=late.render();late.reset();resolve({});await rendering;assert.equal(late.root.children.length,0);
});
test('unauthorized and disabled screens do not offer dispatch',async()=>{
 const wrong=fixture({role:'SUB_ADMIN'});await wrong.render();assert.equal(wrong.calls.length,0);
 const off=fixture({handler:()=>{throw Object.assign(Error(),{code:'PAYOUT_TEST_NOT_ACTIVATED'});}});await off.render();assert.match(off.root.textContent,/준비 중/);assert(!button(off,'TEST 1회 발송'));
 const unreviewed=fixture();unreviewed.state.reviewedConfigId=randomUUID();await unreviewed.render();assert(button(unreviewed,'TEST 1회 발송').disabled);
});
test('prepare is explicit, retries reuse operation ID and uncertain jobs offer only query',async()=>{
 let writes=0;const f=fixture({handler:(_url,body)=>{if(body?.action==='prepare'&&++writes===1)throw Error('lost');}});await f.render();
 field(f,'참조할 승인 정산').value=f.sourceId;field(f,'제공자 TEST 셀러 ID').value='synthetic-seller';field(f,'지급 방식').value='EXPRESS';
 const form=all(f.root).find(n=>n.tag==='form');await form.onsubmit({preventDefault(){}});await form.onsubmit({preventDefault(){}});
 const writesSeen=f.calls.filter(x=>x.body?.action==='prepare');assert.equal(writesSeen.length,2);assert.deepEqual(writesSeen[0].body,writesSeen[1].body);
 f.data.items[0].state='UNKNOWN';await f.render();assert(!button(f,'TEST 1회 발송'));await button(f,'제공자 조회·대사').onclick();assert(f.calls.some(x=>x.body?.action==='reconcile'));
 f.data.items[0].destination='<img src=x onerror=alert(1)>';await f.render();assert.match(f.root.textContent,/<img/);assert(!all(f.root).some(x=>x.tag==='img'));
});
test('changed assets are loaded in role order and reset at session/navigation boundaries',()=>{
 const loader=readFileSync('public/js/core/role-modules.js','utf8'),html=readFileSync('public/index.html','utf8');
 assert(loader.indexOf('admin-payout-provider-test.js?v=20261102op10')<loader.indexOf('admin-console.js?v=20261103op13'));
 assert.match(html,/role-modules\.js\?v=[a-z0-9]+/);assert.match(html,/auth-session\.js\?v=[a-z0-9]+"/);
 for(const file of ['public/js/core/auth-session.js','public/js/admin/admin-console.js','public/js/admin/admin-operations.js'])assert(readFileSync(file,'utf8').includes('AdminPayoutProviderTest?.reset()'));
 assert(!/localStorage|sessionStorage|innerHTML|console\.log/.test(code));
});
test('scheduler independently queues only bounded reconciliation; no HTTP payout trigger',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,init)=>{const payload=JSON.parse(init.body);calls.push({url:String(url),payload});return Response.json(payload.p_action==='due'?{items:[]}:{});};
 try{
  const env={SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_synthetic',PAYOUT_PROVIDER_TEST_ENABLED:'true',PAYOUT_PROVIDER_TEST_ENVIRONMENT:'TEST',PAYOUT_PROVIDER_TEST_CONFIG_ID:randomUUID(),PAYOUT_PROVIDER_TEST_RECONCILE_ENABLED:'true'};
  await worker.scheduled({},env,{waitUntil(){}});assert.equal(calls.length,1);assert.equal(calls[0].payload.p_action,'due');
  await worker.scheduled({},{...env,PAYOUT_PROVIDER_TEST_RECONCILE_ENABLED:'false'},{waitUntil(){}});assert.equal(calls.length,1);assert.equal((await worker.fetch()).status,404);
 }finally{globalThis.fetch=original;}
});
