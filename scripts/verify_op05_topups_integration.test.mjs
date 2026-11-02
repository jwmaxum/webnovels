import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {parse} from 'parse5';
import {createSecureApi} from '../server/secure-api.mjs';
import {onRequestGet} from '../functions/api/public-config.js';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const uid='77777777-7777-4777-8777-777777777777',other='88888888-8888-4888-8888-888888888888',oid='99999999-9999-4999-8999-999999999999';
const stamp={mode:'TEST',provenance:'LOCAL_SIMULATED'},marker={...stamp,providerMode:'LOCAL_SIMULATED'};
const enabled={POINTS_TEST_ENABLED:'true',POINTS_TEST_ENVIRONMENT:'TEST',POINTS_TEST_PROVENANCE:'LOCAL_SIMULATED',CHARGING_TEST_ENABLED:'true',P0_API_ENABLED:'true',FREE_BETA_ENABLED:'false',SUPABASE_URL:'https://unit.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_synthetic_unit',NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_synthetic_unit'};
const order=()=>({id:oid,checkoutId:'wn05-'+oid,userId:uid,productId:other,productVersion:uid,title:'TEST 충전',method:'CARD',amountKrw:700,points:1000,status:'CREATED',createdAt:'2026-11-02T00:00:00Z',expiresAt:'2026-11-02T01:00:00Z',credited:false,refundablePoints:0,refundAmountKrw:0,refund:null});
const pagination=items=>({...marker,items,offset:0,limit:50,total:items.length,hasMore:false,nextOffset:null});
function gateway({admin=null,reader={id:other,status:'ACTIVE'},actorUser=uid,authUser={id:uid,email_confirmed_at:'2026-11-01T00:00:00Z'},rpcResult,pointsResult,providerTransport}={}){
  const calls=[];const handler=createSecureApi({topupsProviderTransport:providerTransport,fetchImpl:async(url,options={})=>{
    const parsed=new URL(url),path=parsed.pathname,data=options.body?JSON.parse(options.body):null;calls.push({origin:parsed.origin,path,data,headers:options.headers});assert.equal(parsed.origin,'https://unit.supabase.co','integration cannot call a real provider');
    if(path==='/auth/v1/user')return Response.json(authUser);
    if(path.endsWith('/launch_accounts_ready'))return Response.json(true);
    if(path.endsWith('/launch_account_actor'))return Response.json({userId:actorUser,reader,admin});
    if(path.endsWith('/op05_topups')||path.endsWith('/op05_apply'))return Response.json(typeof rpcResult==='function'?rpcResult(path,data):rpcResult??pagination([]));
    if(path.endsWith('/op04_points_test'))return Response.json(typeof pointsResult==='function'?pointsResult(data):pointsResult??{...stamp,balancePoints:0,ledger:[]});
    throw Error('UNEXPECTED_INTEGRATION_CALL');
  }});
  return {calls,run:(path,options={},env=enabled)=>handler(new Request('https://webnovels.uk'+path,{...options,headers:{Authorization:'Bearer synthetic.jwt.token',...(options.method==='POST'?{Origin:'https://webnovels.uk','Content-Type':'application/json'}:{}),...options.headers}}),env)};
}

class Element{
  constructor(tag='div',attrs={}){this.tag=tag;this.attrs={...attrs};this.children=[];this.dataset={};this.classes=new Set();this.hidden=false;this.value='';this._text='';this.isConnected=true;this.classList={add:(...v)=>v.forEach(x=>this.classes.add(x)),remove:(...v)=>v.forEach(x=>this.classes.delete(x)),contains:v=>this.classes.has(v)};}
  set textContent(v){this._text=String(v??'');this.children=[];}get textContent(){return this._text+' '+this.children.map(x=>x.textContent).join(' ');}
  set innerHTML(_){assert.fail('integration must use native text nodes');}
  append(...v){this.children.push(...v);}replaceChildren(...v){this._text='';this.children=[...v];}
  setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}removeAttribute(k){delete this.attrs[k];}focus(){this.focused=true;}
  querySelectorAll(selector){const names=selector.split(',').map(v=>v.trim());return this.children.flatMap(child=>[...(names.includes(child.tag)?[child]:[]),...child.querySelectorAll(selector)]);}
}
function shell({admin={role:'SUPER_ADMIN',is_active:true,permissions:[]},hold}={}){
  const ids=['view-charging-test','readerTopupsContent','view-reading-test','readerPointsTestContent','view-home','view-discover','view-recommendations','view-mypage','view-reader','view-work-detail','view-creator','view-admin-cms','adminOperationsContent','adminOperationsShell','adminOperationsNav','adminConsoleIdentity','adminSectionTabs','adminBreadcrumbs','adminWorkspaceHeading','adminWorkspaceDescription','adminGlobalSearch','adminGlobalSearchInput','adminGlobalSearchResults'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Element()])),events=[],finance=[],readerCalls=[];let who={userId:uid,accountServiceReady:true,admin,reader:{status:'ACTIVE'}},left=0,resets=0,readerLeft=0;
  const c={URL,URLSearchParams,Date,location:new URL('https://webnovels.uk/admin'),console:{log(){}},currentActiveView:'view-admin-cms',lastMainView:'view-home',
    document:{readyState:'loading',body:new Element('body'),createElement:t=>new Element(t),getElementById:id=>nodes[id]??null,querySelector:()=>null,querySelectorAll:s=>s==='.main-view'?ids.filter(id=>id.startsWith('view-')).map(id=>nodes[id]):[],addEventListener(){}},
    history:{pushState(_s,_t,path){events.push(['push',path]);c.location=new URL(path,c.location);},replaceState(_s,_t,path){events.push(['replace',path]);c.location=new URL(path,c.location);}},
    WEBNOVELS_CONFIG:{adminOperationsEnabled:false,chargingTestEnabled:true},WebNovelsAuth:{getActor:()=>who,api(){assert.fail('router/shell cannot autoapprove or use legacy APIs');}},
    switchAdminSubTab(){},loadAdminDashboard(){},getCurrentCreatorSession:()=>null,scrollTo(){},addEventListener(){},closeAllModals(){},
    AdminRecovery:{active:()=>false,reset(){},leave(){}},AdminBetaOperations:{reset(){}},VirtualAccounts:{reset(){}},AdminConsole:{reset(){},render(){assert.fail('finance must use AdminTopups');}},AdminWorkflow:{active:()=>false,reset(){}},
    ReaderDiscovery:{active:()=>false,leave(){}},ReaderDisplay:{leave(){},enter(){}},ReaderPointsTest:{leave(){},render(){}},
    AdminTopups:{leave(){left++;},reset(){resets++;},async render(root,options){finance.push(options);if(hold)await hold();if(options.isCurrent())root.textContent='PRIVATE FINANCE TEST';}},
    ReaderTopups:{leave(){readerLeft++;},reset(){},render(root,options){events.push(['render',c.location.pathname+c.location.search]);readerCalls.push(options);root.textContent='TEST CHARGING';}}};
  c.window=c;vm.createContext(c);for(const path of ['public/js/admin/admin-navigation.js','public/js/admin/admin-operations.js','public/js/core/router.js'])vm.runInContext(read(path),c,{filename:path});
  return {c,nodes,events,finance,readerCalls,setActor:v=>who=v,get left(){return left;},get resets(){return resets;},get readerLeft(){return readerLeft;}};
}

test('secure gateway blocks default, LIVE, free beta and invalid provider before every DB/provider call',async()=>{
  for(const patch of [{CHARGING_TEST_ENABLED:undefined},{CHARGING_TEST_ENABLED:true},{CHARGING_TEST_ENABLED:'false'},{POINTS_TEST_ENABLED:'false'},{POINTS_TEST_ENVIRONMENT:'LIVE'},{POINTS_TEST_PROVENANCE:'PROVIDER_TEST'},{P0_API_ENABLED:'false'},{FREE_BETA_ENABLED:'true'},{FREE_BETA_ENABLED:true},{CHARGING_TEST_PROVIDER:'LIVE'},{CHARGING_TEST_PROVIDER:'invalid'}])for(const prefix of ['','admin/']){
    const app=gateway(),response=await app.run('/api/v2/'+prefix+'topups-test?action=orders',{}, {...enabled,...patch});assert.equal(response.status,503);assert.equal((await response.json()).error,'TOPUPS_TEST_NOT_ACTIVATED');assert.equal(app.calls.length,0);
  }
});

test('verified Auth UUID and current role reach topups RPC while owner, private fields and headers stay bounded',async()=>{
  const app=gateway({rpcResult:{...marker,order:{...order(),binding:'PRIVATE_BINDING',paymentKey:'PRIVATE_KEY',bankReference:'PRIVATE_BANK'}}});const response=await app.run('/api/v2/topups-test?action=order&orderId='+oid);assert.equal(response.status,200);const result=await response.json();assert.equal(result.order.id,oid);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|binding|bankReference|paymentKey|userId/);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.ok(response.headers.get('x-request-id'));
  const call=app.calls.find(v=>v.path.endsWith('/op05_topups'));assert.equal(call.data.p_user,uid);assert.equal(call.data.p_action,'order');assert.notEqual(call.data.p_user,other);assert.equal(app.calls.find(v=>v.path==='/auth/v1/user').headers.Authorization,'Bearer synthetic.jwt.token');
  for(const args of [{actorUser:other},{reader:{status:'BLOCKED'}},{reader:null},{authUser:{id:uid}}]){const denied=gateway(args),r=await denied.run('/api/v2/topups-test?action=orders');assert.ok([401,403].includes(r.status));assert(!denied.calls.some(v=>v.path.endsWith('/op05_topups')));}
  for(const data of [{productId:uid,productVersion:other,method:'BANK',requestId:oid,userId:other},{orderId:oid,reason:'환불 요청',requestId:other,amountKrw:1},{orderId:oid,paymentKey:'x',expectedAmountKrw:700,providerMode:'LIVE'}]){const action='productId'in data?'create':'paymentKey'in data?'confirm':'refund',bad=gateway();const r=await bad.run('/api/v2/topups-test?action='+action,{method:'POST',body:JSON.stringify(data)});assert.equal(r.status,400);assert(!bad.calls.some(v=>v.path.endsWith('/op05_topups')));}
});

test('finance gateway requires active SUPER_ADMIN and administrator DTO alone includes validated userId',async()=>{
  for(const admin of [null,{role:'SUB_ADMIN',is_active:true,permissions:['SETTLEMENTS_READ','CURATION_WRITE']},{role:'SUPER_ADMIN',is_active:false}]){const app=gateway({admin}),r=await app.run('/api/v2/admin/topups-test?action=orders',{method:'POST',body:'{}'});assert.equal(r.status,403);assert(!app.calls.some(v=>v.path.endsWith('/op05_topups')));}
  const app=gateway({admin:{role:'SUPER_ADMIN',is_active:true},reader:null,rpcResult:pagination([{...order(),binding:'PRIVATE'}])}),r=await app.run('/api/v2/admin/topups-test?action=orders',{method:'POST',body:'{}'});assert.equal(r.status,200);assert.equal((await r.json()).items[0].userId,uid);const call=app.calls.find(v=>v.path.endsWith('/op05_topups'));assert.equal(call.data.p_action,'admin-orders');assert.equal(call.data.p_user,uid);
});

test('only explicit server injection can finalize local cards through actual secure gateway',async()=>{
  const body={orderId:oid,paymentKey:'synthetic_payment',expectedAmountKrw:700};const notReady=gateway({rpcResult:{...marker,order:order()}});const denied=await notReady.run('/api/v2/topups-test?action=confirm',{method:'POST',body:JSON.stringify(body)});assert.equal(denied.status,503);assert.equal((await denied.json()).error,'PROVIDER_NOT_READY');assert(!notReady.calls.some(v=>v.data?.p_action==='claim-confirm'));
  let transportValue,providerCalls=0;const app=gateway({providerTransport:async({order:t})=>{providerCalls++;return {state:'APPROVED',amountKrw:700,balanceKrw:700,merchantId:t.merchantId,paymentKey:t.paymentKey,approvedAt:new Date().toISOString(),transactionKey:'synthetic_approval'};},rpcResult:(path,p)=>{
    if(path.endsWith('/op05_apply')){assert.equal(p.p_order,oid);assert.equal(p.p_operation,transportValue.operationId);assert.equal(p.p_lease,transportValue.lease);return {...marker,order:{...order(),status:'PAID',credited:true,refundablePoints:1000,refundAmountKrw:700}};}
    if(p.p_action==='order')return {...marker,order:order()};assert.equal(p.p_action,'claim-confirm');assert.equal(p.p_data.expectedAmountKrw,undefined);
    transportValue={orderId:oid,checkoutId:'wn05-'+oid,operationId:randomUUID(),lease:randomUUID(),operationCreatedAt:new Date().toISOString(),operation:'confirm',paymentKey:body.paymentKey,amountKrw:700,providerMode:p.p_data.providerMode,merchantId:p.p_data.merchantId,binding:p.p_data.binding};return {...marker,order:{...order(),status:'APPROVING'},transport:transportValue};
  }});const paid=await app.run('/api/v2/topups-test?action=confirm',{method:'POST',body:JSON.stringify(body)});assert.equal(paid.status,200);assert.equal((await paid.json()).order.status,'PAID');assert.equal(providerCalls,1);
});

test('runtime config exposes only effective charging boolean; static configuration is off',async()=>{
  for(const [patch,want]of [[{},true],[{CHARGING_TEST_ENABLED:undefined},false],[{CHARGING_TEST_PROVIDER:'LIVE'},false],[{FREE_BETA_ENABLED:'true'},false],[{POINTS_TEST_ENVIRONMENT:'LIVE'},false]]){
    const response=onRequestGet({env:{...enabled,...patch,TOSS_TEST_SECRET_KEY:'PRIVATE_SECRET',TOSS_TEST_CLIENT_KEY:'PRIVATE_CLIENT',TOSS_TEST_MERCHANT_ID:'PRIVATE_MID',CHARGING_TEST_BINDING_VERSION:'PRIVATE_REVISION',PROVIDER_SETTINGS_MASTER_KEY:'PRIVATE_MASTER'}}),source=await response.text(),context={window:{}};vm.runInNewContext(source,context);assert.equal(context.window.WEBNOVELS_CONFIG.chargingTestEnabled,want);assert.doesNotMatch(source,/PRIVATE_|LOCAL_SIMULATED|PROVIDER_TEST|TOSS_|binding|merchantId|clientKey/);assert.equal(response.headers.get('cache-control'),'no-store');
  }
  const c={window:{}};vm.runInNewContext(read('public/supabase-public-config.js'),c);assert.equal(c.window.WEBNOVELS_CONFIG.chargingTestEnabled,false);
});

test('configured provider mode reaches unbound catalogs and orders so the reviewed checkout can be opened',async()=>{
  const settings={...enabled,CHARGING_TEST_PROVIDER:'PROVIDER_TEST'};
  for(const [action,result,options]of [['products',pagination([]),{}],['order',{...marker,order:order()},{}],['create',{...marker,order:order(),replayed:false},{method:'POST',body:JSON.stringify({productId:other,productVersion:uid,method:'CARD',requestId:oid})}]]){
    const app=gateway({rpcResult:result}),r=await app.run('/api/v2/topups-test?action='+action+(action==='order'?'&orderId='+oid:''),options,settings);assert.equal(r.status,200);assert.equal((await r.json()).providerMode,'PROVIDER_TEST');assert(!app.calls.some(v=>v.origin!=='https://unit.supabase.co'));
  }
  const malformed=gateway({rpcResult:{...pagination([]),providerMode:'LIVE'}});assert.equal((await malformed.run('/api/v2/topups-test?action=products',{},settings)).status,503,'configured mode cannot conceal invalid source evidence');
});

test('actual router scrubs payment return before render, hands off data without approval and invalidates departure',()=>{
  const app=shell(),path='/charging-test/return?'+new URLSearchParams({orderId:'wn05-'+oid,paymentKey:'opaque=key',amount:'700'});app.c.location=new URL(path,app.c.location);app.c.resolveRoute(path);
  assert.equal(app.readerCalls.length,1);assert.deepEqual(plain(app.readerCalls[0].callback),{orderId:oid,paymentKey:'opaque=key',expectedAmountKrw:700});assert.deepEqual(app.events.slice(0,2),[['replace','/charging-test'],['render','/charging-test']]);assert.equal(app.c.location.search,'');assert.equal(app.readerCalls[0].isCurrent(),true);app.c.resolveRoute('/home');assert.equal(app.readerCalls[0].isCurrent(),false);assert(app.readerLeft>0);
  const failure=shell();failure.c.resolveRoute('/charging-test/return?code=USER_CANCEL&message=cancelled&orderId=wn05-'+oid);assert.deepEqual(plain(failure.readerCalls[0].callback),{code:'USER_CANCEL',message:'cancelled'});assert.equal(failure.c.location.pathname,'/charging-test');
});

test('forged/malformed charging callbacks are scrubbed and never rendered or approved',()=>{
  const valid='orderId=wn05-'+oid+'&paymentKey=synthetic&amount=700';for(const route of ['/charging-test?userId='+uid,'/charging-test#paymentKey=secret','/charging-test/return?'+valid+'&userId='+other,'/charging-test/return?'+valid+'&amount=700','/charging-test/return?'+valid.replace('amount=700','amount=0'),'/charging-test/return?'+valid.replace('amount=700','amount=700.5'),'/charging-test/return?'+valid.replace('amount=700','amount=1000001'),'/charging-test/return?'+valid.replace(oid,'forged'),'/charging-test/return?'+valid+'#secret','/charging-test/return?code=bad&message=no']){
    const app=shell();app.c.location=new URL(route,app.c.location);app.c.resolveRoute(route);assert.equal(app.readerCalls.length,0,route);assert.match(app.nodes.readerTopupsContent.textContent,/주소/);if(route.startsWith('/charging-test/return')){assert.equal(app.c.location.pathname,'/charging-test');assert.equal(app.c.location.search,'');assert.equal(app.c.location.hash,'');}
  }
  const app=shell();app.c.resolveRoute('/charging-test');assert.equal(app.readerCalls.length,1);const link=new Element('a',{href:'/charging-test'});let prevented=false;app.c.handleReaderRouteClick({currentTarget:link,ctrlKey:true,preventDefault(){prevented=true;}});assert.equal(prevented,false);
});

test('finance shell delegates exactly three tabs to highest admin and rejects stale work on role/navigation change',async()=>{
  const app=shell();for(const [tab,page]of [['payments','payments'],['refunds','refunds'],['reconciliation','reconciliation']]){await app.c.AdminOperations.openRoute('/admin/finance?tab='+tab,false);assert.equal(app.finance.at(-1).tab,page);assert.equal(app.finance.at(-1).isCurrent(),true);assert.match(app.nodes.adminOperationsContent.textContent,/PRIVATE FINANCE/);}
  const previous=app.finance.at(-1);await app.c.AdminOperations.openRoute('/admin/content?tab=pages',false);assert.equal(previous.isCurrent(),false);assert(app.left>=4);app.c.AdminOperations.reset();assert.equal(app.resets,1);
  for(const admin of [{role:'SUB_ADMIN',is_active:true,permissions:['SETTLEMENTS_READ','CURATION_WRITE']},{role:'SUPER_ADMIN',is_active:false,permissions:[]}]){const denied=shell({admin});await denied.c.AdminOperations.openRoute('/admin/finance?tab=payments',false);assert.equal(denied.finance.length,0);assert.doesNotMatch(denied.nodes.adminOperationsContent.textContent,/PRIVATE FINANCE/);}
  let release;const wait=new Promise(done=>release=done),late=shell({hold:()=>wait}),pending=late.c.AdminOperations.openRoute('/admin/finance?tab=payments',false);await Promise.resolve();late.setActor({userId:other,accountServiceReady:true,admin:{role:'SUPER_ADMIN',is_active:true}});release();await pending;assert.equal(late.finance[0].isCurrent(),false);assert.doesNotMatch(late.nodes.adminOperationsContent.textContent,/PRIVATE FINANCE/);
});

test('auth logout executes both topups reset hooks rather than retaining the previous account UI',async()=>{
  let session={access_token:'synthetic.jwt.token'},readerReset=0,adminReset=0;const storage=new Map();const actor={userId:uid,reader:{status:'ACTIVE'},admin:null};
  const auth={getSession:async()=>({data:{session}}),signInWithPassword:async()=>{session={access_token:'synthetic.jwt.token'};return {data:{session}};},signOut:async()=>{session=null;return {};},onAuthStateChange(){return {};}};
  const c={console,location:{origin:'https://webnovels.uk'},supabaseClient:{auth},initSupabaseAdmin:()=>true,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setTimeout(){},updateMemberHeader(){},ReaderTopups:{reset(){readerReset++;}},AdminTopups:{reset(){adminReset++;}},fetch:async()=>Response.json(actor)};c.window=c;vm.createContext(c);vm.runInContext(read('public/js/core/auth-session.js'),c);await c.WebNovelsAuth.login('synthetic@example.test','synthetic-password');const before=[readerReset,adminReset];await c.WebNovelsAuth.logout();assert.equal(c.WebNovelsAuth.getActor(),null);assert(readerReset>before[0]);assert(adminReset>before[1]);
});

test('HTML/lazy loader version resources and callback referrer/cache protections remain connected',()=>{
  const html=read('public/index.html'),loader=read('public/js/core/role-modules.js'),all=node=>[node,...(node.childNodes??[]).flatMap(all)],nodes=all(parse(html)),attr=(n,k)=>n.attrs?.find(v=>v.name===k)?.value;
  for(const id of ['view-charging-test','readerTopupsContent'])assert.equal(nodes.filter(n=>attr(n,'id')===id).length,1);
  const scripts=nodes.filter(n=>n.tagName==='script').map(n=>attr(n,'src')).filter(Boolean);assert.equal(scripts.filter(v=>v==='/js/reader/reader-topups.js?v=20261102op06').length,1);assert(!scripts.some(v=>/tosspayments\.com/.test(v)),'provider SDK is lazy and user-triggered');assert(scripts.indexOf('/js/reader/reader-points-test.js?v=20261102op06')<scripts.indexOf('/js/reader/reader-topups.js?v=20261102op06'));assert(scripts.indexOf('/js/reader/reader-topups.js?v=20261102op06')<scripts.indexOf('/js/core/auth-session.js?v=20261102op06'));
  assert(loader.indexOf('/js/admin/admin-topups.js?v=20261102op05')<loader.indexOf('/js/admin/admin-operations.js?v=20261102op06'));assert(!scripts.some(v=>v.startsWith('/js/admin/admin-topups.js')),'administrator code stays in role loader');
  const headers=read('public/_headers');assert.match(headers,/\/charging-test\/return\r?\n\s+Referrer-Policy: no-referrer\r?\n\s+Cache-Control: no-store/);assert.match(headers,/X-Content-Type-Options: nosniff/);
  for(const href of ['/company/','/policies/terms/','/policies/refund/'])assert(nodes.some(n=>attr(n,'href')===href));
});

test('OP04 gateway preserves v1 wallets and validates v2 available/total/reserved with TOPUP/REFUND safe deltas',async()=>{
  const ledger=[{id:uid,kind:'TOPUP',deltaPoints:1000,createdAt:'2026-11-02T00:00:00Z',orderId:'PRIVATE_ORDER',bankReference:'PRIVATE_BANK'},{id:other,kind:'REFUND',deltaPoints:-100,createdAt:'2026-11-02T00:01:00Z'}];
  for(const balances of [{balancePoints:900},{balancePoints:700,totalPoints:900,reservedPoints:200}]){const app=gateway({pointsResult:{...stamp,...balances,ledger,privateKey:'PRIVATE_KEY'}}),r=await app.run('/api/v2/points-test?action=wallet');assert.equal(r.status,200);const dto=await r.json();assert.deepEqual(Object.fromEntries(Object.keys(balances).map(k=>[k,dto[k]])),balances);assert.deepEqual(dto.ledger.map(v=>v.kind),['TOPUP','REFUND']);assert.doesNotMatch(JSON.stringify(dto),/PRIVATE_|orderId|bankReference/);if(!('totalPoints'in balances))assert(!Object.hasOwn(dto,'reservedPoints'));}
  for(const patch of [{totalPoints:900},{reservedPoints:0},{totalPoints:900,reservedPoints:1},{totalPoints:899,reservedPoints:0},{totalPoints:-1,reservedPoints:0}]){const app=gateway({pointsResult:{...stamp,balancePoints:900,...patch,ledger:[]}}),r=await app.run('/api/v2/points-test?action=wallet');assert.equal(r.status,503);assert.equal((await r.json()).error,'POINTS_TEST_UNAVAILABLE');}
  for(const row of [{...ledger[0],deltaPoints:-1},{...ledger[1],deltaPoints:1},{...ledger[0],kind:'PAYMENT'},{...ledger[0],deltaPoints:0}]){const app=gateway({pointsResult:{...stamp,balancePoints:900,ledger:[row]}});assert.equal((await app.run('/api/v2/points-test?action=wallet')).status,503);}
});

test('OP04 quote and purchase retain only valid v2 balances and reader UI labels topups/refunds and reservations',async()=>{
  for(const action of ['quote','purchase']){
    const value=action==='quote'?{quote:{id:uid,episodeId:'3',workId:'1',versionId:other,priceVersion:oid,pricePoints:100,access:'LOCKED',expiresAt:'2026-11-02T01:00:00Z'}}:{episodeId:'3',access:'OWNED',chargedPoints:100,entitlementId:other,replayed:false};
    for(const valid of [true,false]){const app=gateway({pointsResult:{...stamp,...value,balancePoints:100,totalPoints:300,reservedPoints:valid?200:201}}),r=await app.run('/api/v2/points-test?action='+action,{method:'POST',body:JSON.stringify(action==='quote'?{episodeId:'3'}:{quoteId:uid,requestId:oid})});assert.equal(r.status,valid?200:503);if(valid){const dto=await r.json();assert.equal(dto.totalPoints,300);assert.equal(dto.reservedPoints,200);}}
  }
  for(const balances of [{balancePoints:900},{balancePoints:700,totalPoints:900,reservedPoints:200}]){
    const root=new Element(),wallet={...stamp,...balances,ledger:[{id:uid,kind:'TOPUP',deltaPoints:1000,createdAt:'2026-11-02T00:00:00Z'},{id:other,kind:'REFUND',deltaPoints:-100,createdAt:'2026-11-02T00:01:00Z'}]},c={URL,URLSearchParams,Date,WEBNOVELS_CONFIG:{pointsTestEnabled:true,chargingTestEnabled:true},WebNovelsAuth:{getActor:()=>({userId:uid,reader:{status:'ACTIVE'}}),api:async path=>path.includes('action=wallet')?wallet:{...stamp,items:[],offset:0,limit:50,total:0,hasMore:false,nextOffset:null}},document:{createElement:t=>new Element(t)}};c.window=c;vm.createContext(c);vm.runInContext(read('public/js/reader/reader-points-test.js'),c);await c.ReaderPointsTest.render(root);assert.match(root.textContent,new RegExp('사용 가능 시험 잔액 '+balances.balancePoints+'P'));assert.match(root.textContent,/총 900P/);assert.match(root.textContent,new RegExp('환불 예약 '+(balances.reservedPoints??0)+'P'));assert.match(root.textContent,/충전 1000P/);assert.match(root.textContent,/환불 -100P/);assert(root.children.flatMap(n=>n.querySelectorAll('a')).some(n=>n.href==='/charging-test'));c.ReaderPointsTest.reset();assert.equal(root.children.length,0);
  }
});
