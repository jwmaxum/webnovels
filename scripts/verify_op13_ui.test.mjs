import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const code=readFileSync('public/js/shared/live-commerce.js','utf8');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.value='';this.attrs={};this.style={};this.files=[];this._text='';}
 append(...nodes){for(const n of nodes)n.parent=this;this.children.push(...nodes);}replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}remove(){this.parent.children=this.parent.children.filter(n=>n!==this);}
 set textContent(v){this.replaceChildren();this._text=String(v);}get textContent(){return this._text+this.children.map(n=>n.textContent).join(' ');}setAttribute(k,v){this.attrs[k]=v;}
 querySelector(sel){return all(this).find(n=>n.attrs[sel.slice(1,-1)]!==undefined)||null;}set innerHTML(_){assert.fail('unsafe DOM');}
}
const all=n=>[n,...n.children.flatMap(all)],form=(f,title)=>all(f.root).find(n=>n.tag==='form'&&n.parent.children[0]?.textContent===title),field=(f,label)=>all(f.root).find(n=>n.tag==='label'&&n.children[0]?.textContent===label)?.children[1];
function fixture({role='reader',enabled=true,handler}={}){
 const root=new Element('div'),calls=[],revoked=[],timers=[];let who={userId:randomUUID(),reader:{status:'ACTIVE'},author:{id:'1',status:'APPROVED'},admin:{role:'SUPER_ADMIN',is_active:true}};
 const state=role==='admin'?{orders:[{id:randomUUID(),userId:randomUUID(),amount:10000,confirmed:false,deposits:[]}],works:[],payouts:[],corrections:[],policy:{enabled:true,hash:'b'.repeat(64),version:'synthetic',text:'합성 보관 정책'}}:role==='author'?{available:70,binding:'a'.repeat(64),bankConfirmed:true,payouts:[]}:{balance:10000,orders:[],lots:[],works:[],instructions:{text:'합성 입금 안내',destinationHash:'d'.repeat(64)}};
 const window={WEBNOVELS_CONFIG:{liveCommerceEnabled:enabled},WebNovelsAuth:{getActor:()=>who,api:async(url,init)=>{const body=JSON.parse(init.body);calls.push({url,body});return await handler?.(body)??structuredClone(state);}}};
 vm.runInNewContext(code,{window,document:{createElement:t=>new Element(t),querySelectorAll:sel=>all(root).filter(n=>n.attrs[sel.slice(1,-1)]!==undefined)},crypto:{randomUUID},Uint8Array,Blob,btoa,atob,URL:{createObjectURL:()=> 'blob:synthetic',revokeObjectURL:u=>revoked.push(u)},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{}});
 return {root,state,calls,revoked,timers,window,render:()=>window.LiveCommerce.render(root,{role}),reset:()=>window.LiveCommerce.reset(),switch:()=>{who={...who,userId:randomUUID()};}};
}
test('OP13 closed gate has no network; author sees only own payout flow',async()=>{
 const closed=fixture({enabled:false});await closed.render();assert.equal(closed.calls.length,0);
 const f=fixture({role:'author'});await f.render();assert.match(f.root.textContent,/70원/);assert(form(f,'정산 신청'));assert(!all(f.root).some(n=>n.type==='password'));assert.deepEqual(f.calls[0].body,{action:'state'});
 await form(f,'정산 신청').onsubmit({preventDefault(){}});assert(f.calls.some(c=>c.url==='/api/v2/creator/live-commerce'&&c.body.action==='request'));
});
test('OP13 lost order response reuses request ID; simultaneous submit blocked',async()=>{
 let writes=0,resolve;const pending=new Promise(r=>resolve=r);const f=fixture({handler:async b=>{if(b.action==='order'){if(++writes===1){await pending;throw Error('lost');}return {id:b.requestId};}}});await f.render();
 const order=form(f,'10,000원 충전 주문 만들기');const first=order.onsubmit({preventDefault(){}});await order.onsubmit({preventDefault(){}});resolve();await first;await order.onsubmit({preventDefault(){}});
 const requests=f.calls.filter(c=>c.body.action==='order');assert.equal(requests.length,2);assert.deepEqual(requests[0].body,requests[1].body);
});
test('OP13 bank upload confirmation, password clearing, reset and late response isolation',async()=>{
 const f=fixture({role:'admin'});await f.render();const upload=form(f,'입금 내역 등록');field(f,'실제 입금액 (원)').value='10000';field(f,'은행 입금 시각').value='2026-01-01T10:00';field(f,'은행 수취/출금 계좌의 내부 식별자').value='synthetic-account';field(f,'은행에서 확인한 고유 거래번호').value='synthetic-ref';field(f,'불필요한 개인정보를 가린 증빙 (PNG/JPEG, 150KB 이하)').files=[{size:3,type:'image/png',arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}];const password=field(f,'관리자 비밀번호 재확인');password.value='synthetic-only';
 await upload.onsubmit({preventDefault(){}});assert(!f.calls.some(c=>c.body.action==='deposit'));assert.equal(password.value,'');
 field(f,'실제 은행 내역·대상 계좌·금액과 대조했으며 증빙 처리 안내를 확인했습니다.').checked=true;password.value='synthetic-only';await upload.onsubmit({preventDefault(){}});assert.equal(f.calls.filter(c=>c.body.action==='deposit').length,1);assert.equal(password.value,'');
 let done;const waiting=new Promise(r=>done=r),g=fixture({handler:()=>waiting}),loading=g.render();g.reset();g.switch();done({balance:1,orders:[],works:[]});await loading;assert(!g.root.textContent.includes('1P'));
});
test('OP13 integration preserves role routes and safe DOM, account reset and hidden entry',()=>{
 assert(!/innerHTML|localStorage|sessionStorage|fetch\(/.test(code));assert(code.includes("notice.setAttribute('aria-live','polite')"));
 for(const p of ['public/js/core/auth-session.js','public/js/creator/creator-dashboard.js','public/js/admin/admin-console.js'])assert(readFileSync(p,'utf8').includes('LiveCommerce?.reset()'));
 const html=readFileSync('public/index.html','utf8');assert(html.includes('id="liveCommerceReader"'));assert(html.includes('data-live-commerce-entry hidden'));assert(html.includes('/js/shared/live-commerce.js?v=20261104op15'));
});
test('OP13 webtoon uses the shared responsive lazy viewer; logout destroys content and balances',async()=>{
 let disposed=0,renderer;const f=fixture({handler:b=>b.action==='episodes'?{episodes:[{id:'11',number:1,title:'웹툰 1화',price:0,owned:false}]}:b.action==='quote'?{price:0}:b.action==='content'?{title:'웹툰 1화',contentType:'WEBTOON',versionId:randomUUID(),panels:[{id:randomUUID(),format:'webp',order:0,width:800,height:1000}]}:undefined});f.state.works=[{id:'1',title:'그림 이야기',type:'WEBTOON'}];
 f.window.ReaderWebtoon={render:(_root,panels,options)=>{assert.equal(panels[0].width,800);renderer=options;return ()=>disposed++;}};
 await f.render();await all(f.root).find(n=>n.tag==='button'&&n.textContent==='그림 이야기 · 웹툰').onclick();await all(f.root).find(n=>n.tag==='button'&&n.textContent==='읽기').onclick();assert(renderer.valid());f.reset();assert.equal(disposed,1);assert.equal(f.root.textContent,'');assert.equal(renderer.valid(),false);
});
test('OP13 reader redirects only on the server commerce guard; other works retain their existing route',async()=>{
 const source=readFileSync('public/js/reader/reader.js','utf8'),start=source.indexOf('window.openReaderDirect = async function('),code=source.slice(start,source.indexOf('\n};',start)+4);
 for(const denied of ['LIVE_COMMERCE_ROUTE_REQUIRED','EPISODE_NOT_FOUND']){
  const nodes=new Map(),renders=[],fetches=[];const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element('div'));return nodes.get(id);},createElement:t=>new Element(t)};
  const window={WEBNOVELS_CONFIG:{authorPublishEnabled:true},WebNovelsAuth:{getActor:()=>null},LiveCommerce:{active:()=>true,render:(root,options)=>renders.push(options)}};
  const context={window,document,console:{warn(){}},history:{pushState(){}},encodeURIComponent,showToast(){},activeWork:null,refreshReaderCatalog:async()=>{},getPublishedWorks:()=>[{id:'1',genre:[],episodes:[{id:'11',episodeNumber:1,isFree:true}]}],switchWebNovelsView:view=>{window.currentActiveView=view;},fetch:async path=>{fetches.push(path);return {ok:false,status:409,json:async()=>({error:denied})};}};
  vm.runInNewContext(code,context);await window.openReaderDirect('1',1);assert.deepEqual(fetches,['/api/v2/episodes/11/content']);assert.equal(renders.length,denied==='LIVE_COMMERCE_ROUTE_REQUIRED'?1:0);
 }
});
test('OP13 successful purchase refreshes displayed wallet balance from the server result',async()=>{
 const f=fixture({handler:b=>b.action==='episodes'?{episodes:[{id:'11',number:3,title:'3화',price:100,owned:false}]}:b.action==='quote'?{id:randomUUID(),price:100,balance:10000}:b.action==='purchase'?{balance:9900}:b.action==='content'?{title:'3화',contentType:'NOVEL',content:'합성 본문',contentDocument:null,versionId:randomUUID(),panels:[]}:undefined});f.state.works=[{id:'1',title:'이야기',type:'NOVEL'}];
 await f.render();await all(f.root).find(n=>n.tag==='button'&&n.textContent==='이야기 · 웹소설').onclick();await all(f.root).find(n=>n.tag==='button'&&n.textContent==='가격 확인 후 구매').onclick();field(f,'가격과 유료 열람에 동의합니다.').checked=true;await all(f.root).find(n=>n.tag==='button'&&n.textContent==='100P 사용하여 읽기').onclick();assert(all(f.root).some(n=>n.tag==='h3'&&n.textContent==='9,900P'));assert.match(f.root.textContent,/합성 본문/);
});
