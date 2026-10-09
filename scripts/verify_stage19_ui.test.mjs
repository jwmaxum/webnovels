import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { withSecurityHeaders } from '../server/security-headers.mjs';
import { onRequest as v2 } from '../functions/api/v2/[[path]].js';
import { onRequestGet as publicConfig } from '../functions/api/public-config.js';
const source=file=>readFileSync(file,'utf8');
const ticks=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
function fixture({execute=false}={}){
  const nodes=new Map(),scripts=[],events=new Map(),storage=new Map();let who={userId:'author-a',author:{status:'APPROVED',id:1},admin:null};
  const node=tag=>({tag,children:[],value:'',style:{setProperty(){}},dataset:{},hidden:false,tabIndex:0,attributes:{},isConnected:true,
    classList:{add(){},remove(){},toggle(){}},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
    setAttribute(k,v){this.attributes[k]=v;},getAttribute(k){return this.attributes[k]??null;},querySelector(){return null;},querySelectorAll(){return [];},
    closest(){return node('div');},addEventListener(){},remove(){this.removed=true;},contains(child){return this===child||this.children.includes(child);},
    getClientRects(){return this.hidden?[]:[{}];},focus(){context.document.activeElement=this;}});
  const context={console:{log(){},warn(){},error(){}},crypto,URL,URLSearchParams,Blob,TextEncoder,TextDecoder,AbortController,AbortSignal,setTimeout,clearTimeout,
    location:new URL('https://app.test/home'),history:{pushState(_state,_title,url){context.location=new URL(url,context.location);}},scrollTo(){},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    WebNovelsAuth:{getActor:()=>who,api:()=>{throw Error('Unexpected API during module load');}},
    getCurrentCreatorSession:()=>who?.author,showToast(){},openModal(){},
    document:{readyState:'complete',documentElement:{style:{setProperty(){}}},createElement:node,activeElement:null,
      getElementById:id=>{if(!nodes.has(id)){const n=node('div');n.id=id;nodes.set(id,n);}return nodes.get(id);},
      querySelectorAll:()=>[],querySelector:()=>null,addEventListener:(name,fn)=>events.set(name,fn),
      head:{appendChild(script){scripts.push(script);if(execute)queueMicrotask(()=>{try{vm.runInContext(source('public'+script.src.split('?')[0]),context,{filename:script.src});script.onload();}catch(error){script.onerror();context.loadError=error;}});}}},
    addEventListener:(name,fn)=>events.set(name,fn),removeEventListener(){}};
  context.document.body=node('body');context.window=context;vm.createContext(context);
  vm.runInContext(source('public/js/core/state.js'),context,{filename:path.resolve('public/js/core/state.js')});
  vm.runInContext(source('public/js/core/role-modules.js'),context,{filename:path.resolve('public/js/core/role-modules.js')});
  const drain=async()=>{let index=0;while(index<scripts.length){scripts[index++].onload();await ticks();}};
  return {context,nodes,scripts,events,node,drain,setActor:value=>who=value};
}
test('reader route loads neither role group; authentication is required even for direct ensure calls',async()=>{
  const app=fixture();app.setActor({userId:'reader',reader:{status:'ACTIVE'}});
  await assert.rejects(app.context.WebNovelsModules.ensure('creator'),/MODULE_ROLE_REQUIRED/);
  await assert.rejects(app.context.WebNovelsModules.ensure('admin'),/MODULE_ROLE_REQUIRED/);
  await assert.rejects(app.context.WebNovelsModules.ensure('__proto__'),/MODULE_ROLE_REQUIRED/);assert.equal(app.scripts.length,0);
});
test('role files execute once in dependency order; failed file retries without rerunning prior scripts',async()=>{
  const app=fixture(),modules=app.context.WebNovelsModules;
  const a=modules.ensure('creator'),b=modules.ensure('creator');assert.equal(app.scripts.length,1);
  app.scripts[0].onload();await ticks();assert.equal(app.scripts.length,2);app.scripts[1].onerror();await assert.rejects(a,/MODULE_LOAD_FAILED/);await assert.rejects(b);
  const retry=modules.ensure('creator');await ticks();assert.equal(app.scripts.length,3);assert.equal(app.scripts[2].src,app.scripts[1].src);
  let index=2;while(index<app.scripts.length){app.scripts[index++].onload();await ticks();}await retry;
  assert.equal(modules.ready('creator'),true);assert.equal(app.scripts.filter(script=>script.src.includes('fflate')).length,1);
  const count=app.scripts.length;await modules.ensure('creator');assert.equal(app.scripts.length,count);
});
test('navigation and account changes discard late role entry and stop requesting further files',async()=>{
  const app=fixture();let entered=0;const pending=app.context.WebNovelsModules.enter('creator',()=>entered++);
  app.context.WebNovelsModules.cancel();await app.drain();await pending;assert.equal(entered,0);
  const second=fixture(),task=second.context.WebNovelsModules.enter('creator',()=>entered++);
  second.setActor({userId:'other-reader',reader:{status:'ACTIVE'}});second.scripts[0].onload();await task;
  assert.equal(entered,0);assert.equal(second.scripts.length,1);assert.equal(second.context.WebNovelsModules.ready('creator'),false);
});
test('actual creator scripts initialize after DOM ready and preserve all Author/Creator aliases',async()=>{
  const app=fixture({execute:true});await app.context.WebNovelsModules.ensure('creator');assert.ifError(app.context.loadError);
  for(const [a,b] of [['switchAuthorTab','switchCreatorTab'],['fetchAuthorDashboardData','fetchCreatorDashboardData'],
    ['handleAuthorSettlementReq','handleCreatorSettlementReq'],['handleAuthorLogoutProcess','handleCreatorLogoutProcess'],['loadAuthorStudioEarnings','loadCreatorStudioEarnings']]){
    assert.equal(typeof app.context[a],'function',a);assert.equal(app.context[a],app.context[b]);
  }
  assert.equal(typeof app.context.CreatorDraftEditor.enter,'function');assert.equal(typeof app.context.CreatorWorks.loadFromRoute,'function');
});
test('admin login exists before the admin group and actual admin scripts remain loadable',async()=>{
  const app=fixture({execute:true});vm.runInContext(source('public/js/core/auth-ui.js'),app.context);
  assert.equal(typeof app.context.handleAdminLoginProcess,'function');assert.equal(app.scripts.length,0);
  app.setActor({userId:'administrator',admin:{role:'SUPER_ADMIN'}});await app.context.WebNovelsModules.ensure('admin');assert.ifError(app.context.loadError);
  assert.equal(typeof app.context.switchAdminSubTab,'function');assert.equal(typeof app.context.AdminOperations.refresh,'function');
});
test('router deep link and inline view switch await roles; a home route wins over an old pending load',async()=>{
  const app=fixture();vm.runInContext(source('public/js/core/router.js'),app.context);
  const pending=app.context.resolveRoute('/creator/episodes');app.context.resolveRoute('/home');await app.drain();await pending;
  assert.equal(app.context.currentActiveView,'view-home');
  const other=fixture();vm.runInContext(source('public/js/core/router.js'),other.context);
  const task=other.context.switchWebNovelsView('view-creator');assert.equal(other.context.currentActiveView,'view-home');await other.drain();await task;
  assert.equal(other.context.currentActiveView,'view-creator');
});
test('dialog keyboard focus wraps, Escape closes top only and nested focus returns to invoker',()=>{
  const app=fixture();vm.runInContext(source('public/js/core/ui-utils.js'),app.context);
  const outer=app.context.document.getElementById('outer'),inner=app.context.document.getElementById('inner');
  const invoker=app.node('button'),first=app.node('button'),last=app.node('button'),nested=app.node('button');
  outer.children=[first,last];inner.children=[nested];outer.querySelectorAll=()=>outer.children;inner.querySelectorAll=()=>inner.children;
  app.context.document.activeElement=invoker;app.context.openModal('outer');assert.equal(app.context.document.activeElement,first);
  last.focus();let prevented=0;app.events.get('keydown')({key:'Tab',preventDefault:()=>prevented++});assert.equal(app.context.document.activeElement,first);assert.equal(prevented,1);
  app.context.openModal('inner');assert.equal(app.context.document.activeElement,nested);
  app.events.get('keydown')({key:'Escape',isComposing:true,preventDefault(){throw Error('IME intercepted');}});assert.equal(inner.hidden,false);
  app.events.get('keydown')({key:'Escape',preventDefault(){}});assert.equal(inner.hidden,true);assert.equal(outer.hidden,false);assert.equal(app.context.document.activeElement,first);
  app.context.closeAllModals();assert.equal(app.context.document.activeElement,invoker);
});
test('security headers cover disabled API/config and preserve image byte streams, privacy and request IDs',async()=>{
  const response=withSecurityHeaders(new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Request-ID':'safe-id'}}));
  assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-request-id'),'safe-id');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[1,2,3]);assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  for(const res of [await v2({request:new Request('https://app.test/api/v2/health'),env:{}}),publicConfig({env:{}})]){
    assert.equal(res.status,503);assert.equal(res.headers.get('x-frame-options'),'DENY');assert.equal(res.headers.get('x-content-type-options'),'nosniff');
  }
});
test('HTML has no eager role or floating vendor scripts; pinned vendor bytes and licenses match provenance',()=>{
  const html=source('public/index.html'),manifest=JSON.parse(source('public/vendor/manifest.json'));
  assert.doesNotMatch(html,/<script src="\/js\/(creator|admin)\//);assert.doesNotMatch(html,/<script[^>]*src="https:/);
  for(const asset of manifest.assets){const bytes=readFileSync(asset.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
    assert.equal('sha384-'+createHash('sha384').update(bytes).digest('base64'),asset.integrity);assert.ok((html+source('public/js/core/role-modules.js')).includes(asset.integrity));assert.ok(existsSync(asset.licensePath));}
  const icons={};icons.window=icons;vm.createContext(icons);vm.runInContext(source('public/vendor/lucide/lucide-1.52.0.min.js'),icons);
  for(const [,name] of html.matchAll(/data-lucide="([a-z0-9-]+)"/g))assert.ok(icons.lucide.icons[name.replace(/(^|-)([a-z])/g,(_a,_b,c)=>c.toUpperCase())],name);
});
