import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac,randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {parse} from 'parse5';
import {createSecureApi} from '../server/secure-api.mjs';
import {onRequestGet} from '../functions/api/public-config.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),plain=v=>JSON.parse(JSON.stringify(v));
const user='77777777-7777-4777-8777-777777777777',other='88888888-8888-4888-8888-888888888888',version='99999999-9999-4999-8999-999999999999';
const stamp={mode:'TEST',provenance:'LOCAL_SIMULATED'},marker={...stamp,provider:'NONE'};
const env={POINTS_TEST_ENABLED:'true',POINTS_TEST_ENVIRONMENT:'TEST',POINTS_TEST_PROVENANCE:'LOCAL_SIMULATED',P0_API_ENABLED:'true',FREE_BETA_ENABLED:'false',AD_REWARDS_TEST_ENABLED:'true',AD_REWARDS_TEST_ENVIRONMENT:'TEST',SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_synthetic_unit',NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_synthetic_unit'};
const internal={...env,AD_REWARDS_TEST_PROVIDER:'INTERNAL_TEST',AD_REWARDS_TEST_CALLBACK_ENABLED:'true',AD_REWARDS_TEST_CHANNEL_ID:'synthetic-channel',AD_REWARDS_TEST_KEY_ID:'synthetic-key',AD_REWARDS_TEST_SECRET:'b'.repeat(64)};
const fallback={kind:'POINTS',chargePath:'/charging-test',amountKrw:10000,points:10000,defaultEpisodePoints:100};
const policy={id:version,adEnabled:false,campaignEnabled:false,rewardHours:24,sessionMinutes:5,graceMinutes:10,dailyLimit:20,campaignTitle:'',campaignStartsAt:null,campaignEndsAt:null};
const options=()=>({...marker,episodeId:'3',access:'LOCKED',availability:'UNAVAILABLE',adAvailable:false,campaignAvailable:false,policy,fallback});
const session=(changes={})=>({id:version,episodeId:'3',kind:'AD_REWARD',status:'GRANTED',createdAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+240000).toISOString(),acceptUntil:new Date(Date.now()+840000).toISOString(),closedAt:null,rewardHours:24,policyVersion:user,grant:{id:other,kind:'AD_REWARD',expiresAt:new Date(Date.now()+86400000).toISOString()},...changes});
function gateway({who={userId:user,reader:{status:'ACTIVE'},admin:null},authUser={id:user,email_confirmed_at:'2026-01-01T00:00:00Z'},rewardResult,pointsResult}={}){
 const calls=[],handler=createSecureApi({fetchImpl:async(url,init={})=>{const u=new URL(url),data=init.body?JSON.parse(init.body):null;calls.push({path:u.pathname,data});assert.equal(u.origin,'https://synthetic.supabase.co','no real provider or DB');
  if(u.pathname==='/auth/v1/user')return Response.json(authUser);
  if(u.pathname.endsWith('/launch_accounts_ready'))return Response.json(true);
  if(u.pathname.endsWith('/launch_account_actor'))return Response.json(who);
  if(u.pathname.endsWith('/op06_rewards')||u.pathname.endsWith('/op06_apply_reward'))return Response.json(typeof rewardResult==='function'?rewardResult(data):rewardResult??options());
  if(u.pathname.endsWith('/op04_points_test'))return Response.json(typeof pointsResult==='function'?pointsResult(data):pointsResult);
  assert.fail('Unexpected gateway request');
 }});
 const run=(path,init={},settings=env,auth=true)=>handler(new Request('https://webnovels.uk'+path,{...init,headers:{...(auth?{Authorization:'Bearer synthetic.jwt.token'}:{}),...(init.method==='POST'?{Origin:'https://webnovels.uk','Content-Type':'application/json'}:{}),...init.headers}}),settings);
 return {calls,run};
}
const evidence=()=>({protocol:'OP06_INTERNAL_TEST_V1',eventId:'synthetic-event',sessionId:version,nonce:'a'.repeat(64),channelId:internal.AD_REWARDS_TEST_CHANNEL_ID,outcome:'GRANTED',completedAt:new Date().toISOString(),reward:{type:'EPISODE_ACCESS',quantity:1}});
function signed(value=evidence()){
 const body=JSON.stringify(value),time=String(Math.floor(Date.now()/1000));return {body,headers:{Origin:'', 'X-WN-Test-Key-Id':internal.AD_REWARDS_TEST_KEY_ID,'X-WN-Test-Timestamp':time,'X-WN-Test-Signature':createHmac('sha256',Buffer.from(internal.AD_REWARDS_TEST_SECRET,'hex')).update(time+'.').update(body).digest('hex')}};
}

test('all new routes reject default/LIVE/free-beta before Auth, database or a provider',async()=>{
 for(const patch of [{AD_REWARDS_TEST_ENABLED:undefined},{AD_REWARDS_TEST_ENABLED:true},{AD_REWARDS_TEST_ENVIRONMENT:'LIVE'},{AD_REWARDS_TEST_PROVIDER:'GOOGLE_UNVERIFIED'},{POINTS_TEST_ENABLED:'false'},{P0_API_ENABLED:'false'},{FREE_BETA_ENABLED:'true'},{FREE_BETA_ENABLED:true}])for(const path of ['/api/v2/ad-rewards-test?action=options&episodeId=3','/api/v2/admin/ad-rewards-test?action=state','/api/v2/ad-rewards-test/callback']){
  const app=gateway(),r=await app.run(path,{}, {...env,...patch});assert.equal(r.status,503);assert.equal((await r.json()).error,'AD_REWARDS_TEST_NOT_ACTIVATED');assert.equal(app.calls.length,0);
 }
});

test('no advertising defaults to exact 10000KRW/10000P fallback, without creating a session or credit',async()=>{
 const app=gateway(),r=await app.run('/api/v2/ad-rewards-test?action=options&episodeId=3');assert.equal(r.status,200);const dto=await r.json();assert.deepEqual(dto.fallback,fallback);assert.equal(dto.availability,'UNAVAILABLE');assert.equal(dto.campaignAvailable,false);assert.equal(r.headers.get('cache-control'),'no-store');
 const call=app.calls.find(c=>c.path.endsWith('/op06_rewards'));assert.equal(call.data.p_user,user);assert.equal(call.data.p_action,'options');assert.deepEqual(call.data.p_data,{episodeId:'3',provider:'NONE',channelId:null,binding:null});assert(!app.calls.some(c=>/op04_points_test|op05_topups|op06_apply_reward/.test(c.path)));
});

test('confirmed active actor and exact owner UUID are required; client proof and private fields cannot reach reward RPC',async()=>{
 for(const who of [{userId:other,reader:{status:'ACTIVE'}},{userId:user,reader:null},{userId:user,reader:{status:'BLOCKED'}}]){const app=gateway({who}),r=await app.run('/api/v2/ad-rewards-test?action=options&episodeId=3');assert.ok([401,403].includes(r.status));assert(!app.calls.some(c=>c.path.endsWith('/op06_rewards')));}
 for(const field of ['userId','provider','binding','outcome','completedAt','points']){const app=gateway(),r=await app.run('/api/v2/ad-rewards-test?action=start',{method:'POST',body:JSON.stringify({episodeId:'3',kind:'AD_REWARD',policyVersion:version,consent:true,requestId:version,[field]:'FORGED'})});assert.equal(r.status,400);assert(!app.calls.some(c=>c.path.endsWith('/op06_rewards')));}
 for(const headers of [{Origin:'https://evil.invalid'},{'Content-Type':'text/plain'}]){const app=gateway(),r=await app.run('/api/v2/ad-rewards-test?action=start',{method:'POST',body:'{}',headers});assert.ok([403,415].includes(r.status));assert(!app.calls.some(c=>c.path.endsWith('/op06_rewards')));}
});

test('only current SUPER_ADMIN manages reward policy and sessions',async()=>{
 for(const admin of [null,{is_active:true,role:'SUB_ADMIN',permissions:['CURATION_WRITE','SETTLEMENTS_READ']},{is_active:false,role:'SUPER_ADMIN'}]){const app=gateway({who:{userId:user,admin}}),r=await app.run('/api/v2/admin/ad-rewards-test?action=state',{method:'POST',body:'{}'});assert.equal(r.status,403);assert(!app.calls.some(c=>c.path.endsWith('/op06_rewards')));}
 const app=gateway({who:{userId:user,admin:{is_active:true,role:'SUPER_ADMIN'}},rewardResult:{...marker,revision:'0',policy,providerReady:false,secret:'PRIVATE_NEVER_RETURN'}}),r=await app.run('/api/v2/admin/ad-rewards-test?action=state',{method:'POST',body:'{}'});assert.equal(r.status,200);const dto=await r.json();assert.equal(dto.policy.id,version);assert.equal(dto.providerReady,false);assert(!JSON.stringify(dto).includes('PRIVATE'));assert.equal(app.calls.at(-1).data.p_action,'admin-state');
});

test('forged, unconfigured and mutated callback signatures fail before DB even with valid browser Auth',async()=>{
 for(const settings of [env,internal]){const app=gateway(),r=await app.run('/api/v2/ad-rewards-test/callback',{method:'POST',body:JSON.stringify(evidence())},settings);assert.ok([403,503].includes(r.status));assert.equal(app.calls.length,0);}
 const proof=signed(),app=gateway(),r=await app.run('/api/v2/ad-rewards-test/callback',{method:'POST',body:proof.body.replace('GRANTED','NO_FILL'),headers:proof.headers},internal);assert.equal(r.status,403);assert.equal(app.calls.length,0);
});

test('verified internal TEST callback uses service RPC without browser session and never exposes proof or account fields',async()=>{
 const app=gateway({rewardResult:{...marker,provider:'INTERNAL_TEST',replayed:false,session:{...session(),userId:user,nonce:'PRIVATE_NONCE',binding:'PRIVATE_BINDING'},signature:'PRIVATE_SIGNATURE'}}),proof=signed();
 const r=await app.run('/api/v2/ad-rewards-test/callback',{method:'POST',...proof},internal,false);assert.equal(r.status,200);const dto=await r.json();assert.equal(dto.session.status,'GRANTED');assert.equal(dto.session.grant.id,other);assert.doesNotMatch(JSON.stringify(dto),/PRIVATE|nonce|binding|userId|signature/);assert.deepEqual(app.calls.map(c=>c.path),['/rest/v1/rpc/launch_accounts_ready','/rest/v1/rpc/op06_apply_reward']);
 const forwarded=app.calls[1].data.p_evidence;assert.equal(forwarded.sessionId,version);assert.equal(forwarded.provider,'INTERNAL_TEST');assert.match(forwarded.bodyDigest,/^[a-f0-9]{64}$/);assert.match(forwarded.binding,/^[a-f0-9]{64}$/);assert(!JSON.stringify(forwarded).includes(internal.AD_REWARDS_TEST_SECRET));
});

test('runtime publishes one effective boolean and never exposes internal keys, nonce or channel configuration',async()=>{
 for(const [patch,enabled]of [[{},true],[{AD_REWARDS_TEST_ENABLED:undefined},false],[{AD_REWARDS_TEST_ENVIRONMENT:'LIVE'},false],[{AD_REWARDS_TEST_PROVIDER:'GAM_WEB'},false],[{FREE_BETA_ENABLED:'true'},false]]){const source=await onRequestGet({env:{...internal,...patch}}).text(),c={window:{}};vm.runInNewContext(source,c);assert.equal(c.window.WEBNOVELS_CONFIG.adRewardsTestEnabled,enabled);for(const secret of [internal.AD_REWARDS_TEST_SECRET,internal.AD_REWARDS_TEST_KEY_ID,internal.AD_REWARDS_TEST_CHANNEL_ID])assert(!source.includes(secret));}
 const c={window:{}};vm.runInNewContext(read('public/supabase-public-config.js'),c);assert.equal(c.window.WEBNOVELS_CONFIG.adRewardsTestEnabled,false);
});

test('existing points gateway validates temporary rights metadata and never turns it into a paid purchase',async()=>{
 for(const kind of ['AD_REWARD','CAMPAIGN_FREE'])for(const action of ['episodes','quote','purchase']){
  const rewardAccess={kind,grantId:other,expiresAt:new Date(Date.now()+86400000).toISOString(),privateEvidence:'PRIVATE'};
  const ep={id:'3',workId:'1',episodeNumber:3,title:'현재 공개 회차',versionId:version,priceVersion:user,pricePoints:100,access:kind,rewardAccess};
  const result=action==='episodes'?{...stamp,items:[ep],work:{id:'1',title:'작품',author:'작가',contentType:'NOVEL'},offset:0,limit:50,total:1,hasMore:false,nextOffset:null}:action==='quote'?{...stamp,quote:{...ep,episodeId:'3',id:version,expiresAt:new Date(Date.now()+300000).toISOString()},balancePoints:1000,totalPoints:1000,reservedPoints:0}:{...stamp,episodeId:'3',access:kind,rewardAccess,chargedPoints:0,balancePoints:1000,totalPoints:1000,reservedPoints:0,entitlementId:null,replayed:false};
  const app=gateway({pointsResult:result}),r=await app.run('/api/v2/points-test?action='+action+(action==='episodes'?'&workId=1':''),action==='episodes'?{}:{method:'POST',body:JSON.stringify(action==='quote'?{episodeId:'3'}:{quoteId:version,requestId:user})});assert.equal(r.status,200);const dto=await r.json(),row=action==='episodes'?dto.items[0]:action==='quote'?dto.quote:dto;assert.equal(row.access,kind);assert.deepEqual(row.rewardAccess,{kind,grantId:other,expiresAt:rewardAccess.expiresAt});assert(!JSON.stringify(dto).includes('PRIVATE'));if(action==='purchase'){assert.equal(dto.chargedPoints,0);assert.equal(dto.entitlementId,null);}
 }
 for(const patch of [{rewardAccess:null},{rewardAccess:{kind:'OWNED',grantId:other,expiresAt:new Date().toISOString()}},{chargedPoints:100},{entitlementId:user}]){const app=gateway({pointsResult:{...stamp,episodeId:'3',access:'AD_REWARD',chargedPoints:0,balancePoints:100,entitlementId:null,replayed:false,rewardAccess:{kind:'AD_REWARD',grantId:other,expiresAt:new Date().toISOString()},...patch}}),r=await app.run('/api/v2/points-test?action=purchase',{method:'POST',body:JSON.stringify({quoteId:version,requestId:user})});assert.equal(r.status,503);}
 const expired=gateway({pointsResult:{error:'REWARD_EXPIRED',status:409}}),r=await expired.run('/api/v2/points-test?action=purchase',{method:'POST',body:JSON.stringify({quoteId:version,requestId:user})});assert.equal(r.status,409);assert.equal((await r.json()).error,'REWARD_EXPIRED');
});

class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.attrs={};this._text='';this.value='';this.isConnected=true;this.hidden=false;this.classList={add(){},remove(){}};}
 set textContent(v){this.replaceChildren();this._text=String(v??'');}get textContent(){return this._text+' '+this.children.map(n=>n.textContent).join(' ');}
 set innerHTML(_){assert.fail('safe native DOM only');}append(...children){for(const n of children){n.isConnected=this.isConnected;this.children.push(n);}}
 replaceChildren(...children){for(const n of this.children)n.disconnect();this._text='';this.children=[];this.append(...children);}disconnect(){this.isConnected=false;for(const n of this.children)n.disconnect();}
 setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}removeAttribute(k){delete this.attrs[k];}focus(){}
 querySelectorAll(selector){const names=selector.split(',').map(v=>v.trim());return this.children.flatMap(n=>[...(names.includes(n.tag)?[n]:[]),...n.querySelectorAll(selector)]);}
}
const all=n=>[n,...n.children.flatMap(all)],button=(n,text)=>all(n).find(x=>x.tag==='button'&&x._text===text);
function readerShell(){
 const root=new Element(),calls=[],mounts=[];let reward=null,current=true,userId=user,child=null,left=0;
 const card={id:'1',title:'작품',author:'작가',contentType:'NOVEL'},ep=n=>({id:String(n),workId:'1',episodeNumber:n,title:'회차'+n,versionId:version,priceVersion:user,pricePoints:n<=2?0:100,access:n<=2?'MEMBER_FREE':reward?'AD_REWARD':'LOCKED',...(n>2&&reward?{rewardAccess:reward}:{})}),page=items=>({...stamp,items,offset:0,limit:50,total:items.length,hasMore:false,nextOffset:null});
 const c={URL,URLSearchParams,Date,crypto:{randomUUID},WEBNOVELS_CONFIG:{pointsTestEnabled:true,chargingTestEnabled:true,adRewardsTestEnabled:true},document:{createElement:t=>new Element(t)},WebNovelsAuth:{getActor:()=>({userId,reader:{status:'ACTIVE'}}),api:async(path,init={})=>{const u=new URL(path,'https://webnovels.uk'),action=u.searchParams.get('action');calls.push(action);if(action==='wallet')return {...stamp,balancePoints:10000,ledger:[]};if(action==='works')return page([card]);if(action==='episodes')return {...page([1,2,3].map(ep)),work:card};if(action==='quote')return {...stamp,balancePoints:10000,quote:{...ep(3),id:version,episodeId:'3',expiresAt:new Date(Date.now()+300000).toISOString()}};if(action==='content')return {...stamp,episodeId:'3',workId:'1',versionId:version,contentType:'NOVEL',title:'공개 원고',content:'본문',contentDocument:null,panels:[]};assert.fail('no automatic purchase or credit: '+action);}},ReaderRewardsTest:{leave(){left++;child?.replaceChildren();child=null;},async render(host,opts){child=host;mounts.push(opts);host.textContent='SERVER REWARD CHILD';}}};c.window=c;vm.createContext(c);vm.runInContext(read('public/js/reader/reader-points-test.js'),c);
 return {root,c,calls,mounts,render:()=>c.ReaderPointsTest.render(root,{isCurrent:()=>current}),setReward:v=>reward=v,setOwner:v=>userId=v,away:()=>current=false,get left(){return left;}};
}

test('reader quote mounts server reward child, verified grant refreshes metadata without points purchase, and stale callbacks are invalidated',async()=>{
 const app=readerShell();await app.render();await button(app.root,'회차 보기: 작품').onclick();await button(app.root,'가격 확인: 3화').onclick();assert.match(app.root.textContent,/10,000원 \/ 10,000P/);assert.equal(app.mounts.length,1);const first=app.mounts[0];assert.equal(first.episodeId,'3');assert.equal(first.isCurrent(),true);assert(!app.calls.includes('purchase'));
 app.setReward({kind:'AD_REWARD',grantId:other,expiresAt:new Date(Date.now()+86400000).toISOString()});await first.onGranted();assert.equal(first.isCurrent(),false);assert.match(app.root.textContent,/광고 보상/);assert(!app.calls.includes('purchase'));assert(app.left>0);
 await button(app.root,'읽기: 3화').onclick();assert.match(app.root.textContent,/본문/);app.c.ReaderPointsTest.leave();assert.equal(app.root.children.length,0);assert.equal(first.isCurrent(),false);
});

test('expired temporary metadata causes a new quote instead of direct body access or an automatic purchase',async()=>{
 const app=readerShell();app.setReward({kind:'AD_REWARD',grantId:other,expiresAt:new Date(Date.now()-1000).toISOString()});await app.render();await button(app.root,'회차 보기: 작품').onclick();await button(app.root,'읽기: 3화').onclick();assert(app.calls.includes('quote'));assert(!app.calls.includes('content'));assert(!app.calls.includes('purchase'));assert.equal(button(app.root,'포인트 차감 없이 읽기').disabled,true);
});

function adminShell(){
 const ids=['adminOperationsContent','adminOperationsShell','adminOperationsNav','adminSectionTabs','adminBreadcrumbs','adminWorkspaceHeading','adminWorkspaceDescription','adminGlobalSearch','adminGlobalSearchInput','adminGlobalSearchResults','adminConsoleIdentity','view-admin-cms'];const nodes=Object.fromEntries(ids.map(id=>[id,new Element()])),seen=[];let who={userId:user,accountServiceReady:true,admin:{is_active:true,role:'SUPER_ADMIN'}},left=0,resets=0;
 const c={URL,URLSearchParams,Date,location:new URL('https://webnovels.uk/admin'),history:{replaceState(){},pushState(){}},WEBNOVELS_CONFIG:{},currentActiveView:'view-admin-cms',WebNovelsAuth:{getActor:()=>who},document:{getElementById:id=>nodes[id],createElement:t=>new Element(t)},AdminPointsTest:{leave(){},reset(){},async render(root,opts){seen.push({kind:'points',root,opts});if(opts.isCurrent())root.textContent='POINTS POLICY';}},AdminRewardsTest:{leave(){left++;},reset(){resets++;},async render(root,opts){seen.push({kind:'rewards',root,opts});if(opts.isCurrent())root.textContent='REWARD POLICY';}}};c.window=c;vm.createContext(c);vm.runInContext(read('public/js/admin/admin-navigation.js'),c);vm.runInContext(read('public/js/admin/admin-operations.js'),c);return {c,nodes,seen,setActor:v=>who=v,get left(){return left;},get resets(){return resets;}};
}

test('service policy keeps sibling points/rewards hosts under one SUPER menu and invalidates both on reset',async()=>{
 const app=adminShell();await app.c.AdminOperations.openRoute('/admin/settings?tab=service',false);assert.deepEqual(app.seen.map(v=>v.kind),['points','rewards']);assert.notEqual(app.seen[0].root,app.seen[1].root);assert.match(app.nodes.adminOperationsContent.textContent,/POINTS POLICY/);assert.match(app.nodes.adminOperationsContent.textContent,/REWARD POLICY/);assert.equal(app.seen[1].opts.isCurrent(),true);app.c.AdminOperations.reset();assert.equal(app.seen[1].opts.isCurrent(),false);assert.equal(app.resets,1);assert(app.left>=1);
 const denied=adminShell();denied.setActor({userId:user,accountServiceReady:true,admin:{is_active:true,role:'SUB_ADMIN',permissions:['SETTLEMENTS_READ']}});await denied.c.AdminOperations.openRoute('/admin/settings?tab=service',false);assert.equal(denied.seen.length,0);
});

test('actual authentication logout clears both reward modules and their previous account state',async()=>{
 let session={access_token:'synthetic.jwt.token'},readerResets=0,adminResets=0;const storage=new Map();
 const auth={getSession:async()=>({data:{session}}),signInWithPassword:async()=>{session={access_token:'synthetic.jwt.token'};return {data:{session}};},signOut:async()=>{session=null;return {};},onAuthStateChange(){return {};}};
 const c={console,location:{origin:'https://webnovels.uk'},supabaseClient:{auth},initSupabaseAdmin:()=>true,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setTimeout(){},updateMemberHeader(){},ReaderRewardsTest:{reset(){readerResets++;}},AdminRewardsTest:{reset(){adminResets++;}},fetch:async()=>Response.json({userId:user,reader:{status:'ACTIVE'},admin:null})};c.window=c;vm.createContext(c);vm.runInContext(read('public/js/core/auth-session.js'),c);
 await c.WebNovelsAuth.login('synthetic@example.test','synthetic-password');const before=[readerResets,adminResets];await c.WebNovelsAuth.logout();assert.equal(c.WebNovelsAuth.getActor(),null);assert(readerResets>before[0]);assert(adminResets>before[1]);
});

test('shipped resources preserve load order, existing SIX menus, cleanup hooks and remove legacy simulated ad promises',()=>{
 const html=read('public/index.html'),loader=read('public/js/core/role-modules.js'),flat=n=>[n,...(n.childNodes??[]).flatMap(flat)],nodes=flat(parse(html)),attr=(n,k)=>n.attrs?.find(v=>v.name===k)?.value;
 const scripts=nodes.filter(n=>n.tagName==='script').map(n=>attr(n,'src')).filter(Boolean);assert(scripts.indexOf('/js/reader/reader-rewards-test.js?v=20261102op06')<scripts.indexOf('/js/reader/reader-points-test.js?v=20261102op06'));assert(scripts.includes('/js/reader/reader-topups.js?v=20261102op06'));assert(!scripts.some(p=>/gpt\.js|googlesyndication|doubleclick/.test(p)));
 assert(loader.indexOf('/admin-rewards-test.js?v=20261102op06')<loader.indexOf('/admin-operations.js?v=20261102op06'));assert(loader.includes('/admin-topups.js?v=20261102op05'));assert(loader.includes('/admin-points-test.js?v=20261102op04'));
 for(const hook of ['ReaderRewardsTest?.reset()','AdminRewardsTest?.reset()'])assert(read('public/js/core/auth-session.js').includes(hook));for(const hook of ['ReaderRewardsTest?.leave()','AdminRewardsTest?.leave()'])assert(read('public/js/core/router.js').includes(hook));
 const start=html.indexOf('id="modalAdUnlock"'),end=html.indexOf('id="modalReaderSettings"');const old=html.slice(start,end);assert.doesNotMatch(old,/3초|30초|직접 정산|즉시해금/);assert.match(old,/10,000원 \/ 10,000P/);assert.match(read('public/css/free-beta.css'),/#modalAdUnlock/);
});
