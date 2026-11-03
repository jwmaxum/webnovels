import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'parse5';
import {transform} from 'esbuild';
import scheduler from '../scheduler/worker.mjs';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const walk=node=>[node,...(node.childNodes||[]).flatMap(walk)];
const attr=(node,key)=>node.attrs?.find(item=>item.name===key)?.value;
test('settlement management remains keyboard accessible with unique original summary identity',async()=>{
 const tree=parse(await read('public/index.html')),nodes=walk(tree),ids=nodes.map(n=>attr(n,'id')).filter(Boolean);
 assert.equal(ids.length,new Set(ids).size);const button=nodes.find(n=>attr(n,'id')==='creatorSettlementManage');
 assert.equal(button.tagName,'button');assert.equal(attr(button,'type'),'button');assert(walk(button).some(n=>attr(n,'id')==='creatorBankInfo'));
 const loader=await read('public/js/core/role-modules.js');
 assert(loader.indexOf('/creator-settlement.js?')<loader.indexOf('/creator-dashboard.js?'));
 assert(loader.indexOf('/admin-settlement-review.js?')<loader.indexOf('/admin-console.js?'));
 for(const file of ['creator/creator-settlement','creator/creator-dashboard','creator/creator','admin/admin-settlement-review','admin/admin-console'])assert(loader.includes('/js/'+file+'.js?v='+(file==='admin/admin-console'?'20261103op13':file==='creator/creator-dashboard'?'20261103op13':'20261101r13')));
});
test('settlement styles parse and remain isolated; beta hides bank form without server capability',async()=>{
 const css=await read('public/css/settlement.css'),result=await transform(css,{loader:'css'});assert.deepEqual(result.warnings,[]);
 for(const [,selector] of result.code.matchAll(/([^{}]+)\{[^{}]*\}/g))if(!selector.trim().startsWith('@'))for(const part of selector.trim().split(/,\s*(?![^()]*\))/))assert.match(part,/^#view-(creator|admin-cms)\s/);
 assert.match(css,/touch-action:\s*none/);assert.match(css,/max-width:\s*100%/);assert.match(css,/:focus-visible/);
 assert.match(await read('public/css/free-beta.css'),/#adBankForm:not\(\[data-settlement-registration="true"\]\)/);
});
test('public preparation notice has valid anchors and distinguishes RRN/tax and pending overseas conditions',async()=>{
 const errors=[],html=await read('public/policies/settlement/index.html'),nodes=walk(parse(html,{onParseError:e=>errors.push(e)}));assert.deepEqual(errors,[]);
 const ids=nodes.map(n=>attr(n,'id')).filter(Boolean);assert.equal(ids.length,new Set(ids).size);
 for(const n of nodes.filter(n=>n.tagName==='a'&&attr(n,'href')?.startsWith('#')))assert(ids.includes(attr(n,'href').slice(1)));
 assert.match(html,/전체 주민등록번호는 현재 신청에서 받지 않습니다/);assert.match(html,/인도 뭄바이/);assert.match(html,/최대 7일/);assert.match(html,/최대 90일/);assert.match(html,/신규 계좌·본인 정보·신분증 제출을 받지 않습니다/);
 assert.equal(nodes.filter(n=>['script','form','input'].includes(n.tagName)).length,0);
});
test('retention cleanup runs with new collection closed and exposes no public trigger',async()=>{
 const prior=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push({url:String(url),options});return Response.json({expired:0});};
 try{
  const env={AUTHOR_SETTLEMENT_CLEANUP_ENABLED:'true',AUTHOR_SETTLEMENT_REGISTRATION_ENABLED:'false',AUTHOR_SETTLEMENT_PRIVACY_REVIEWED:'false',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'};
  await scheduler.scheduled({},env,{waitUntil(){}});assert.equal(calls.length,1);assert.match(calls[0].url,/\/rpc\/expire_author_settlement_registrations$/);assert.equal(calls[0].options.redirect,'manual');assert.equal((await scheduler.fetch()).status,404);
  await scheduler.scheduled({},{...env,AUTHOR_SETTLEMENT_CLEANUP_ENABLED:'false'},{waitUntil(){}});assert.equal(calls.length,1);
 }finally{globalThis.fetch=prior;}
});
test('an unavailable settlement cleanup cannot prevent the publication job from running',async()=>{
 const prior=globalThis.fetch,calls=[];globalThis.fetch=async(url)=>{calls.push(String(url));return String(url).includes('/expire_author_settlement')?new Response('',{status:503}):Response.json({published:1});};
 try{
  await assert.rejects(scheduler.scheduled({},{AUTHOR_SETTLEMENT_CLEANUP_ENABLED:'true',AUTHOR_PUBLISH_ENABLED:'true',WEBTOON_SERVICE_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'},{waitUntil(){}}),/Scheduled job failed/);
  assert(calls.some(url=>url.endsWith('/run_creator_schedules_v18')));assert.equal(calls.length,2);
 }finally{globalThis.fetch=prior;}
});
