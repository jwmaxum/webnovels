import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {authorDashboardApi} from '../server/author-dashboard-api.mjs';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
function documentFixture(){
 const ids=new Map(),listeners=new Map();
 function node(tag='div'){
  return {tag,dataset:{},children:[],textContent:'',setAttribute(k,v){this[k]=v;},appendChild(child){this.children.push(child);if(child.id)ids.set(child.id,child);return child;},prepend(child){this.children.unshift(child);if(child.id)ids.set(child.id,child);},querySelector(s){if(s==='[data-beta-email-help]')return this.children.find(c=>c.dataset.betaEmailHelp);return null;}};
 }
 for(const id of ['mainContentWrapper','authForm-login','authForm-signup','authForm-signup-author'])ids.set(id,node());
 const intro=node('p'),profile=node('button'),html=node('html');
 return {ids,intro,profile,html,listeners,document:{readyState:'complete',documentElement:html,
  getElementById:id=>ids.get(id)||null,createElement:node,createTextNode:text=>({textContent:text}),
  querySelector:s=>s==='.webnovels-body'?ids.get('mainContentWrapper'):s==='#authForm-signup-author > p'?intro:null,
  querySelectorAll:s=>s==='[data-creator-tab="profile"]'?[profile]:[],addEventListener:(name,fn)=>listeners.set(name,fn)}};
}
test('free beta notice, email help and unavailable-action guard are scoped and idempotent',async()=>{
 const source=await read('public/js/core/free-beta-ui.js'),f=documentFixture(),toasts=[];
 const c={document:f.document,WEBNOVELS_CONFIG:{freeBetaEnabled:false},showToast:text=>toasts.push(text)};c.window=c;vm.createContext(c);vm.runInContext(source,c);
 assert.equal(f.ids.has('freeBetaNotice'),false);assert.equal(f.html.dataset.freeBeta,undefined);
 c.WEBNOVELS_CONFIG.freeBetaEnabled=true;c.FreeBetaUI.init();c.FreeBetaUI.init();
 assert.equal(f.html.dataset.freeBeta,'true');assert.equal(f.ids.get('mainContentWrapper').children.length,1);
 assert.match(f.ids.get('freeBetaNotice').children[1].textContent,/결제·유료 후원·PASS 인증은 아직 제공하지/);
 assert.equal(f.profile.textContent,'내 정보');assert.match(f.intro.textContent,/이메일 확인과 저작권 동의/);
 for(const id of ['authForm-login','authForm-signup','authForm-signup-author']){
  assert.equal(f.ids.get(id).children.length,1);assert.equal(f.ids.get(id).children[0].children[0].textContent,'이메일 확인 메일이 오지 않나요?');
 }
 let prevented=0,stopped=0;
 f.listeners.get('click')({target:{closest:s=>s.includes('openWalletModal')?{}:null},preventDefault:()=>prevented++,stopImmediatePropagation:()=>stopped++});
 assert.equal(prevented,1);assert.equal(stopped,1);assert.equal(toasts.length,1);
 f.listeners.get('click')({target:{closest:()=>null},preventDefault:()=>assert.fail('ordinary links remain usable')});
 c.WEBNOVELS_CONFIG.freeBetaEnabled=false;
 f.listeners.get('click')({target:{closest:()=>({})},preventDefault:()=>assert.fail('non-beta remains untouched')});
});
test('free beta blocks bank collection before reading the body, reauthentication or writing SQL',async()=>{
 const request=new Request('https://app.test/api/v2/creator/dashboard?action=save-bank',{method:'POST',body:'private-input'});
 await assert.rejects(authorDashboardApi({request,env:{FREE_BETA_ENABLED:'true'},actor:{author:{status:'APPROVED'}},ready:true,
  user:{id:'user'},rpc:()=>assert.fail('No SQL mutation'),remote:()=>assert.fail('No password verification'),fail:(status,code)=>{throw Object.assign(Error(code),{status});}}),e=>e.message==='FREE_BETA_FEATURE_UNAVAILABLE'&&e.status===503);
 assert.equal(request.bodyUsed,false);
});
test('public beta actor without the private-workspace marker can view dashboard and profile without payout requests',async()=>{
 const nodes=new Map(),forms=new Map(),calls=[];
 const node=()=>({innerHTML:'',hidden:false,replaceChildren(){this.empty=true;},querySelector(selector){if(!forms.has(selector))forms.set(selector,node());return forms.get(selector);},querySelectorAll:()=>[]});
 for(const id of ['creatorHomeContent','creatorEarningsContent','creatorProfileContent'])nodes.set(id,node());
 const actor=Object.freeze({userId:'owner',author:Object.freeze({id:'101',status:'APPROVED'}),multiFormatWorksEnabled:true});
 const c={WEBNOVELS_CONFIG:{freeBetaEnabled:true},document:{getElementById:id=>nodes.get(id)},WebNovelsAuth:{getActor:()=>actor,api:async path=>{calls.push(path);return path.endsWith('home')?{counts:{works:0,episodes:0,drafts:0},recentWorks:[],bankRegistered:false}:{profile:{version:'a'.repeat(32),email:'fixture@example.test',penName:'필명',bio:''},bank:null};}}};
 c.window=c;vm.createContext(c);vm.runInContext(await read('public/js/creator/creator-dashboard.js'),c);
 await c.CreatorDashboard.home();assert.match(nodes.get('creatorHomeContent').innerHTML,/첫 작품을 등록/);assert.doesNotMatch(nodes.get('creatorHomeContent').innerHTML,/예상수익|계좌를 등록|data-go="earnings"/);
 await c.CreatorDashboard.earnings();assert.equal(calls.length,1);assert.match(nodes.get('creatorEarningsContent').innerHTML,/무료 연재/);
 await c.CreatorDashboard.profile();assert.equal(forms.get('#adBankForm').hidden,true);assert.equal(forms.get('#adBankForm').empty,true);assert.equal(forms.get('#adBankForm').onsubmit,undefined);
 assert.equal(typeof forms.get('#adProfileForm').onsubmit,'function');
 assert.deepEqual(calls,['/api/v2/creator/dashboard?action=home','/api/v2/creator/dashboard?action=profile']);
 assert.equal(actor.authorWorkspaceReady,undefined,'dashboard access must not mark the actor as a publication-restricted private workspace');
});
test('beta dashboard retains approved-author and account-only rollout gates without using multi-format support as authority',async()=>{
 let actor=null;
 const approved={userId:'owner',author:{id:'101',status:'APPROVED'}};
 const c={WEBNOVELS_CONFIG:{freeBetaEnabled:true},document:{getElementById:()=>({innerHTML:''})},WebNovelsAuth:{getActor:()=>actor,api:()=>assert.fail('ineligible actor must not request private dashboard data')}};
 c.window=c;vm.createContext(c);vm.runInContext(await read('public/js/creator/creator-dashboard.js'),c);
 for(const value of [null,{userId:'reader',reader:{status:'ACTIVE'},multiFormatWorksEnabled:true},{...approved,author:{status:'PENDING'}},{...approved,author:{status:'SUSPENDED'},authorWorkspaceReady:true},{...approved,accountServiceOnly:true,authorWorkspaceReady:false}]){
  actor=value;assert.equal(c.CreatorDashboard.active(),false);await c.CreatorDashboard.home();await c.CreatorDashboard.profile();
 }
 actor={...approved,multiFormatWorksEnabled:false};assert.equal(c.CreatorDashboard.active(),true);
 c.WEBNOVELS_CONFIG.freeBetaEnabled=false;assert.equal(c.CreatorDashboard.active(),false);
 c.WEBNOVELS_CONFIG.freeBetaEnabled='true';assert.equal(c.CreatorDashboard.active(),false);
 actor={...approved,accountServiceOnly:true,authorWorkspaceReady:true};assert.equal(c.CreatorDashboard.active(),true,'existing private workspace remains available outside beta');
});
test('public beta dashboard discards pending profile data after the authenticated author changes',async()=>{
 let actor={userId:'owner',author:{id:'101',status:'APPROVED'}},resolve;
 const root={innerHTML:'',replaceChildren(){this.innerHTML='';}};
 const c={WEBNOVELS_CONFIG:{freeBetaEnabled:true},document:{getElementById:()=>root},WebNovelsAuth:{getActor:()=>actor,api:()=>new Promise(done=>resolve=done)}};
 c.window=c;vm.createContext(c);vm.runInContext(await read('public/js/creator/creator-dashboard.js'),c);
 const pending=c.CreatorDashboard.profile();assert.equal(typeof resolve,'function');
 c.CreatorDashboard.reset();actor={userId:'other',author:{id:'102',status:'APPROVED'}};
 resolve({profile:{email:'private@example.test'}});await pending;assert.equal(root.innerHTML,'');
});
test('beta CSS hides dynamic payment, PASS and payout entry points while leaving administrator settings accessible',async()=>{
 const css=await read('public/css/free-beta.css');
 for(const id of ['#modalAdUnlock','#modalSupportCreator','#boxPassVerify','#adBankForm'])assert.ok(css.includes(id));
 assert.match(css,/html\[data-free-beta="true"\]/);assert.doesNotMatch(css,/#providerSettings|#view-admin|#adminConsole/);
 const state=await read('public/js/core/state.js');assert.match(state,/const SAMPLE_WORKS = \[\]/);
 const discovery=await read('public/js/reader/reader-discovery.js');assert.match(discovery,/조건에 맞는 공개 작품이 없습니다/);
});
