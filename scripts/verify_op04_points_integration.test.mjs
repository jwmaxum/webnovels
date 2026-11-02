import test from 'node:test';
import {createSecureApi} from '../server/secure-api.mjs';
import {onRequestGet} from '../functions/api/public-config.js';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse} from 'parse5';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const code={router:read('public/js/core/router.js'),navigation:read('public/js/admin/admin-navigation.js'),operations:read('public/js/admin/admin-operations.js')};
const plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
class Element{
  constructor(tag='div',attrs={}){this.tag=tag;this.children=[];this.attrs={...attrs};this.dataset={};this.hidden=false;this._text='';this.value='';this.classes=new Set();
    for(const [key,value]of Object.entries(attrs))if(key==='data-reader-route')this.dataset.readerRoute=value;
    this.classList={add:(...names)=>names.forEach(name=>this.classes.add(name)),remove:(...names)=>names.forEach(name=>this.classes.delete(name)),contains:name=>this.classes.has(name)};}
  set textContent(value){this._text=String(value??'');this.children=[];}get textContent(){return this._text+' '+this.children.map(child=>child.textContent).join(' ');}
  set innerHTML(_){assert.fail('shell integration uses native text nodes');}
  append(...children){this.children.push(...children);}replaceChildren(...children){this._text='';this.children=[...children];}
  setAttribute(key,value){this.attrs[key]=String(value);}getAttribute(key){return this.attrs[key]??null;}removeAttribute(key){delete this.attrs[key];}
  querySelectorAll(selector){const tags=selector.split(',').map(value=>value.trim());return this.children.flatMap(child=>[...(tags.includes(child.tag)?[child]:[]),...child.querySelectorAll(selector)]);}
  focus(){this.focused=true;}
}
function fixture({permissions=['CURATION_WRITE'],hold,workflow=false}={}){
  const ids=['view-reading-test','readerPointsTestContent','view-home','view-discover','view-recommendations','view-mypage','view-reader','view-work-detail','view-creator','view-admin-cms','readerRecommendationsContent',
    'adminOperationsContent','adminOperationsShell','adminOperationsNav','adminConsoleIdentity','adminSectionTabs','adminBreadcrumbs','adminWorkspaceHeading','adminWorkspaceDescription','adminGlobalSearch','adminGlobalSearchInput','adminGlobalSearchResults'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Element()])),links=['home','novel','webtoon','recommendations','ranking','discover','library'].map(key=>new Element('a',{'data-reader-route':key,href:key==='recommendations'?'/recommendations':'/'+key}));
  let who={userId:'operator-auth',accountServiceReady:true,admin:{role:'SUB_ADMIN',is_active:true,permissions}},sequence=0,host,left=0,resets=0;
  const displays=[],legacy=[],publicEntries=[],publicLeaves=[],pushes=[],events=new Map();
  const context={URL,URLSearchParams,Date,currentActiveView:'view-admin-cms',lastMainView:'view-home',location:new URL('/admin','https://webnovels.uk'),console:{log(){}},
    history:{pushState(_state,_title,path){pushes.push(path);context.location=new URL(path,context.location);},replaceState(_state,_title,path){context.location=new URL(path,context.location);}},
    document:{readyState:'loading',body:new Element('body'),createElement:tag=>new Element(tag),getElementById:id=>nodes[id]||null,querySelector:()=>null,
      querySelectorAll:selector=>selector==='[data-reader-route]'?links:selector==='.main-view'?ids.filter(id=>id.startsWith('view-')).map(id=>nodes[id]):[],addEventListener(){}},
    WEBNOVELS_CONFIG:{adminOperationsEnabled:false,adminWorkflowEnabled:workflow},WebNovelsAuth:{getActor:()=>who,api(){assert.fail('shell must delegate display, not write old flags');}},
    switchAdminSubTab(){},loadAdminDashboard(){},scrollTo(){},getCurrentCreatorSession:()=>null,addEventListener:(key,fn)=>events.set(key,fn),closeAllModals(){},
    AdminDisplay:{leave(){left++;sequence++;host?.replaceChildren();host=null;},reset(){resets++;sequence++;host?.replaceChildren();host=null;},
      async render(root,options){host=root;const generation=++sequence,owner=who?.userId;displays.push({options});if(hold)await hold();if(generation===sequence&&who?.userId===owner&&options.isCurrent())root.textContent='PRIVATE DISPLAY DRAFT';}},
    AdminWorkflow:{active:()=>workflow,reset(){},async render(root,page){legacy.push(page);root.textContent=page;}},
    AdminConsole:{reset(){},async render(root,page){legacy.push(page);root.textContent=page;}},
    AdminRecovery:{active:()=>false,reset(){},leave(){}},AdminBetaOperations:{reset(){}},VirtualAccounts:{reset(){}},
    AdminPointsTest:{leave(){},reset(){},async render(root,options){displays.push({pointsTest:true,options});root.textContent='POINTS TEST POLICY';}},ReaderPointsTest:{leave(){publicLeaves.push('POINTS_TEST_LEAVE');},render(root,options){publicEntries.push({test:true,options});root.textContent='POINTS TEST READER';}},ReaderDiscovery:{active:()=>false,leave(){}},ReaderDisplay:{leave:view=>publicLeaves.push(view),enter:options=>publicEntries.push(plain(options))}};
  context.window=context;vm.createContext(context);
  for(const [name,source]of Object.entries({navigation:code.navigation,operations:code.operations,router:code.router}))vm.runInContext(source,context,{filename:name+'.js'});
  return {c:context,nodes,links,displays,legacy,publicEntries,publicLeaves,pushes,events,api:context.AdminOperations,setActor:value=>who=value,get left(){return left;},get resets(){return resets;}};
}

const userId='77777777-7777-4777-8777-777777777777';
const testEnv={POINTS_TEST_ENABLED:'true',POINTS_TEST_ENVIRONMENT:'TEST',POINTS_TEST_PROVENANCE:'LOCAL_SIMULATED',P0_API_ENABLED:'true',FREE_BETA_ENABLED:'false',SUPABASE_URL:'https://unit.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_unit',NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_unit'};
const stamp={mode:'TEST',provenance:'LOCAL_SIMULATED'};
function gateway({rpcResult,admin=false}={}){
 const calls=[];
 const handler=createSecureApi({fetchImpl:async(url,options={})=>{
  const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):null;calls.push({path,body});
  if(path==='/auth/v1/user')return Response.json({id:userId,email_confirmed_at:'2026-01-01T00:00:00Z'});
  if(path.endsWith('/launch_accounts_ready'))return Response.json(true);
  if(path.endsWith('/launch_account_actor'))return Response.json({userId,reader:{id:userId,status:'ACTIVE'},admin:admin?{role:'SUPER_ADMIN',is_active:true}:null});
  if(path.endsWith('/op04_points_test'))return Response.json(rpcResult||{...stamp,balancePoints:300,ledger:[]});
  throw Error('UNEXPECTED_GATEWAY_CALL');
 }});
 const request=(path,options={})=>new Request('https://webnovels.uk'+path,{...options,headers:{Authorization:'Bearer aaa.bbb.ccc',...(options.method==='POST'?{Origin:'https://webnovels.uk','Content-Type':'application/json'}:{}),...options.headers}});
 return {calls,run:(path,options={},env=testEnv)=>handler(request(path,options),env)};
}
test('isolated gate stays off by default, in LIVE and in free beta before any DB call',async()=>{
 for(const patch of [{POINTS_TEST_ENABLED:'false'},{POINTS_TEST_ENABLED:true},{POINTS_TEST_ENVIRONMENT:'LIVE'},{POINTS_TEST_PROVENANCE:'PROVIDER_TEST'},{P0_API_ENABLED:'false'},{FREE_BETA_ENABLED:'true'},{FREE_BETA_ENABLED:true}]){
  const app=gateway(),response=await app.run('/api/v2/points-test?action=wallet',{}, {...testEnv,...patch});assert.equal(response.status,503);assert.equal((await response.json()).error,'POINTS_TEST_NOT_ACTIVATED');assert.equal(app.calls.length,0);
 }
});
test('verified gateway maps own UUID and strict reader DTO without legacy balances',async()=>{
 const app=gateway({rpcResult:{...stamp,balancePoints:300,ledger:[],points:999999,accountNumber:'PRIVATE'}}),response=await app.run('/api/v2/points-test?action=wallet');assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{...stamp,balancePoints:300,ledger:[]});const rpc=app.calls.find(row=>row.path.endsWith('/op04_points_test'));assert.equal(rpc.body.p_user,userId);assert.equal(rpc.body.p_action,'wallet');assert.equal(response.headers.get('cache-control'),'no-store');
});
test('original novel and image URLs cannot bypass TEST through any legacy FREE branch',async()=>{
 for(const path of ['/api/v2/episodes/1/content','/api/v2/episodes/1/content/','/api/v2/webtoon/images/1/panel?versionId=forged&format=png']){
  const app=gateway(),response=await app.run(path);assert.equal(response.status,409);assert.equal((await response.json()).error,'POINTS_TEST_ROUTE_REQUIRED');assert.equal(app.calls.length,0);
 }
});
test('forged owner, charge and admin fields cannot reach the points RPC through account gateway',async()=>{
 for(const [action,data]of [['purchase',{quoteId:userId,requestId:userId,userId}],['purchase',{quoteId:userId,requestId:userId,points:0}],['quote',{episodeId:'1',isFree:true}]]){
  const app=gateway(),response=await app.run('/api/v2/points-test?action='+action,{method:'POST',body:JSON.stringify(data)});assert.equal(response.status,400);assert(!app.calls.some(row=>row.path.endsWith('/op04_points_test')));
 }
 const app=gateway(),denied=await app.run('/api/v2/admin/points-test?action=state',{method:'POST',body:'{}'});assert.equal(denied.status,403);assert(!app.calls.some(row=>row.path.endsWith('/op04_points_test')));
});
test('runtime exposes only an effective boolean and static fallback remains disabled',async()=>{
 for(const [patch,enabled]of [[{},true],[{FREE_BETA_ENABLED:'true'},false],[{POINTS_TEST_ENVIRONMENT:'LIVE'},false],[{POINTS_TEST_ENABLED:undefined},false]]){
  const source=await onRequestGet({env:{...testEnv,...patch,POINTS_TEST_PRIVATE_KEY:'PRIVATE_NEVER_SERIALIZE'}}).text(),context={window:{}};vm.runInNewContext(source,context);assert.equal(context.window.WEBNOVELS_CONFIG.pointsTestEnabled,enabled);assert(!source.includes('PRIVATE_NEVER_SERIALIZE'));assert(!source.includes('LOCAL_SIMULATED'));
 }
 const context={window:{}};
 vm.runInNewContext(read('public/supabase-public-config.js'),context);assert.equal(context.window.WEBNOVELS_CONFIG.pointsTestEnabled,false);
});
test('real router enters TEST portal, rejects unexpected query and invalidates late content',()=>{
 const app=fixture();app.c.resolveRoute('/reading-test');assert.match(app.nodes.readerPointsTestContent.textContent,/POINTS TEST READER/);assert.equal(app.publicEntries.length,1);assert.equal(app.publicEntries[0].options.isCurrent(),true);
 app.c.resolveRoute('/home');assert.equal(app.publicEntries[0].options.isCurrent(),false);assert(app.publicLeaves.includes('POINTS_TEST_LEAVE'));
 const bad=fixture();bad.c.resolveRoute('/reading-test');const prior=bad.publicEntries[0].options,leaves=bad.publicLeaves.filter(value=>value==='POINTS_TEST_LEAVE').length;bad.c.resolveRoute('/reading-test?userId=forged');assert.equal(bad.publicEntries.length,1);assert.equal(prior.isCurrent(),false);assert.equal(bad.publicLeaves.filter(value=>value==='POINTS_TEST_LEAVE').length,leaves+1);assert.match(bad.nodes.readerPointsTestContent.textContent,/주소/);
 const native=fixture();let prevented=false;const link=new Element('a',{href:'/reading-test'});native.c.handleReaderRouteClick({currentTarget:link,ctrlKey:true,preventDefault(){prevented=true;}});assert.equal(prevented,false);
});
test('service policy stays within highest-admin settings and module departure lifecycle',async()=>{
 const app=fixture();app.setActor({userId:'operator-auth',accountServiceReady:true,admin:{role:'SUPER_ADMIN',is_active:true,permissions:[]}});await app.api.openRoute('/admin/settings?tab=service',false);assert.match(app.nodes.adminOperationsContent.textContent,/POINTS TEST POLICY/);assert.equal(app.displays[0].options.isCurrent(),true);await app.api.openRoute('/admin/content?tab=curation',false);assert.equal(app.displays[0].options.isCurrent(),false);
 const denied=fixture();await denied.api.openRoute('/admin/settings?tab=service',false);assert(!denied.displays.some(row=>row.pointsTest));
});
test('HTML and loader include TEST resources without changing production navigation or legal links',()=>{
 const html=read('public/index.html'),loader=read('public/js/core/role-modules.js'),all=node=>[node,...(node.childNodes||[]).flatMap(all)],nodes=all(parse(html)),attr=(node,name)=>node.attrs?.find(row=>row.name===name)?.value;
 assert.equal(nodes.filter(node=>attr(node,'id')==='view-reading-test').length,1);const entry=nodes.find(node=>attr(node,'data-points-test-entry')!==undefined);assert(entry&&attr(entry,'hidden')!==undefined);assert.equal(attr(entry,'href'),'/reading-test');
 assert(loader.indexOf('/admin-points-test.js?v=20261102op04')<loader.indexOf('/admin-operations.js?v=20261102op10'));
 for(const href of ['/company/','/policies/terms/','/policies/refund/'])assert(nodes.some(node=>attr(node,'href')===href));
 for(const hook of ['ReaderPointsTest?.reset()','AdminPointsTest?.reset()'])assert(read('public/js/core/auth-session.js').includes(hook));
});
