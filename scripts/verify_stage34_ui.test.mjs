import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {enrollmentDocuments} from '../server/author-enrollment-policy.mjs';
const source=await readFile(new URL('../public/js/core/author-enrollment.js',import.meta.url),'utf8');
const docs=await enrollmentDocuments();
function fixture({enabled=true,status=null,mode='LIVE',redirect=false}={}){
 const elements=new Map(),calls=[];let validation=0,finish=null;
 const root={dataset:{},set innerHTML(value){for(const match of value.matchAll(/data-enrollment="([^"]+)"/g))this.querySelector('[data-enrollment="'+match[1]+'"]');},querySelector(selector){const id=selector.match(/"([^"]+)"/)[1];
  if(!elements.has(id))elements.set(id,{checked:false,value:id==='basis'?'OWN':'',disabled:false,textContent:''});return elements.get(id);}};
 const attempt={id:'ae_'+'1'.repeat(32),status:'PENDING',mode,expiresAt:'2026-10-21T00:10:00Z'};
 const context={crypto,URLSearchParams,AbortSignal,location:{search:redirect?'?auth=author-identity&success=true':''},
  fetch:async()=>Response.json({enabled,documents:docs}),PortOne:{requestIdentityVerification:async data=>{calls.push(['sdk',data]);if(finish)return finish();return {}; }},
  WebNovelsAuth:{message:e=>e.message,validate:async()=>{validation++;return {userId:'A'};},api:async(path,options)=>{
   const action=path.split('/').pop(),data=options?.body?JSON.parse(options.body):undefined;calls.push([action,data]);
   if(action==='status')return {completed:false,existingAuthor:false,attempt:status?{...attempt,status}:null};
   if(action==='start')return {attempt,request:{identityVerificationId:attempt.id,storeId:'store',channelKey:'channel',redirectUrl:'https://app.test/?auth=author-identity'}};
   if(action==='verify')return {attempt:{...attempt,status:'VERIFIED'},completed:false};
   if(action==='complete'){if(mode==='TEST')throw Error('TEST rejected');return {completed:true};}
   if(action==='cancel')return {cancelled:true};throw Error('Unexpected API');
  }}};
 context.window=context;vm.createContext(context);vm.runInContext(source,context);
 return {api:context.AuthorEnrollment,root,calls,el:id=>elements.get(id),context,validated:()=>validation,hold:fn=>{finish=fn;}};
}
test('author form requires two explicit choices, sends exact document evidence, and completes only after server verification',async()=>{
 const f=fixture();await f.api.mount(f.root);
 assert.equal(f.el('rights').checked,false);assert.equal(f.el('privacy').checked,false);
 await f.el('start').onclick();assert.equal(f.calls.some(c=>c[0]==='start'),false);
 await assert.rejects(f.api.complete('필명'),/먼저/);
 f.el('rights').checked=true;await f.el('start').onclick();assert.equal(f.calls.some(c=>c[0]==='start'),false);
 f.el('privacy').checked=true;await f.el('start').onclick();
 const start=f.calls.find(c=>c[0]==='start')[1];assert.equal(start.documentHash,docs[0].hash);assert.equal(start.privacyHash,docs[2].hash);
 assert.ok(f.calls.find(c=>c[0]==='verify'));assert.equal(f.root.dataset.verified,'true');
 await f.api.complete('새필명');assert.equal(f.validated(),1);
 const complete=f.calls.find(c=>c[0]==='complete')[1];assert.equal(complete.displayName,'새필명');
 assert.deepEqual(Object.keys(complete),['attemptId','displayName']);
});
test('licensed rights need a fresh checkbox; disabled contracts and TEST proof cannot finish signup',async()=>{
 const disabled=fixture({enabled:false});await disabled.api.mount(disabled.root);assert.equal(disabled.el('start').disabled,true);
 assert.equal(disabled.calls.length,0);assert.match(disabled.el('message').textContent,/계약/);
 const f=fixture({mode:'TEST'});await f.api.mount(f.root);f.el('rights').checked=true;f.el('basis').value='LICENSED';f.el('basis').onchange();
 assert.equal(f.el('rights').checked,false);assert.match(f.el('rightsText').textContent,/공동 창작/);
 f.el('rights').checked=f.el('privacy').checked=true;await f.el('start').onclick();assert.match(f.el('message').textContent,/TEST/);
 await assert.rejects(f.api.complete('필명'),/TEST/);assert.equal(f.validated(),0);
});
test('redirect success flag does not prove identity; server resume and account-change cancellation work',async()=>{
 const f=fixture({status:'PENDING',redirect:true});await f.api.mount(f.root);
 assert.ok(f.calls.some(c=>c[0]==='verify'));assert.equal(f.calls.some(c=>c[0]==='sdk'),false);
 const g=fixture();await g.api.mount(g.root);let release;
 g.hold(()=>new Promise(resolve=>{release=resolve;}));g.el('rights').checked=g.el('privacy').checked=true;
 const inFlight=g.el('start').onclick();for(let i=0;i<10;i++)await Promise.resolve();
 g.api.reset();release({});await inFlight;
 assert.equal(g.calls.some(c=>c[0]==='verify'),false);await assert.rejects(g.api.complete('다른계정'),/먼저/);
});
test('cancel/retry replaces a request key, while uncertain requests keep the same key',async()=>{
 const f=fixture();await f.api.mount(f.root);f.el('rights').checked=f.el('privacy').checked=true;
 const original=f.context.WebNovelsAuth.api;let lost=true;
 f.context.WebNovelsAuth.api=async(...args)=>{const result=await original(...args);if(args[0].endsWith('/start')&&lost){lost=false;throw Error('lost response');}return result;};
 await f.el('start').onclick();await f.el('start').onclick();
 const first=f.calls.filter(c=>c[0]==='start');assert.equal(first[0][1].requestKey,first[1][1].requestKey);
 await f.el('cancel').onclick();await f.el('start').onclick();
 assert.notEqual(f.calls.filter(c=>c[0]==='start')[2][1].requestKey,first[0][1].requestKey);
});
