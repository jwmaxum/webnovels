import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transform} from 'esbuild';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const adminCode=read('public/js/admin/admin-points-test.js'),readerCode=read('public/js/reader/reader-points-test.js'),css=read('public/css/points-test.css');
const user='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',version='20000000-0000-4000-8000-000000000001',price='30000000-0000-4000-8000-000000000001',quoteId='40000000-0000-4000-8000-000000000001',panelId='50000000-0000-4000-8000-000000000001',entitlement='60000000-0000-4000-8000-000000000001';
const mode={mode:'TEST',provenance:'LOCAL_SIMULATED'},clone=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.attributes={};this._text='';this.value='';this.checked=false;this.disabled=false;this.isConnected=true;this.style={};this.dataset={};}
 set textContent(value){this._text=String(value??'');this.children=[];}get textContent(){return this._text+' '+this.children.map(child=>child.textContent).join(' ');}
 set innerHTML(_){assert.fail('TEST UI must not assign untrusted HTML');}
 append(...children){for(const child of children){child.parentNode=this;this.children.push(child);}}
 replaceChildren(...children){this._text='';this.children=[];this.append(...children);}
 setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}
 removeAttribute(key){delete this.attributes[key];}focus(){this.focused=true;}
 querySelectorAll(selector){const tags=selector.split(',');return this.children.flatMap(child=>[...(tags.includes(child.tag)?[child]:[]),...child.querySelectorAll(selector)]);}
}
const all=root=>[root,...root.children.flatMap(all)],button=(root,label)=>all(root).find(node=>node.tag==='button'&&node._text===label),buttons=root=>all(root).filter(node=>node.tag==='button');
const field=(root,label)=>all(root).find(node=>node.tag==='label'&&node.children[0]?._text===label)?.children.find(node=>['input','select'].includes(node.tag));
const form=(root,label)=>all(root).find(node=>node.tag==='form'&&node.getAttribute('aria-label')===label);
const enter=(node,value)=>{assert(node);node.value=value;node.oninput?.();node.onchange?.();};
const submit=node=>{assert(node);return node.onsubmit({preventDefault(){}});};
const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const work=(id='1',type='NOVEL')=>({id,title:type==='NOVEL'?'TEST 소설':'TEST 웹툰',author:'시험 필명',contentType:type});
const episodes=workId=>[1,2,3].map(number=>({id:String(number),workId,episodeNumber:number,title:'시험 '+number+'화',versionId:version,access:number<=2?'MEMBER_FREE':'LOCKED',pricePoints:number<=2?0:100,priceVersion:price}));
const page=items=>({...mode,items,offset:0,limit:50,total:items.length,hasMore:false,nextOffset:null});
function setup(kind='reader',{enabled=true,handler,shared=false,webtoon,adminRole='SUPER_ADMIN',readerStatus='ACTIVE'}={}){
 let actor={userId:user,accountServiceReady:true,admin:{role:adminRole,is_active:true},reader:{status:readerStatus}},current=true,serial=0;
 const root=new Element(),calls=[],created=[],revoked=[],server={revision:'0',works:[],policies:[],balance:10000,owned:false},card=work();
 const state=()=>({...mode,revision:server.revision,defaults:{freeEpisodes:2,pricePoints:100},works:clone(server.works),policies:clone(server.policies)});
 const wallet=()=>({...mode,balancePoints:server.balance,ledger:[]});
 class TestURL extends URL{static createObjectURL(blob){assert(blob instanceof Blob);const value='blob:test-'+(created.length+1);created.push(value);return value;}static revokeObjectURL(value){revoked.push(value);}}
 const context={URL:TestURL,URLSearchParams,Blob,Date,BigInt,console,crypto:{randomUUID:()=>`70000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`},document:{createElement:tag=>new Element(tag),createDocumentFragment:()=>new Element('fragment'),createTextNode:text=>{const node=new Element('#text');node.textContent=text;return node;}},WEBNOVELS_CONFIG:{pointsTestEnabled:enabled},WebNovelsAuth:{getActor:()=>actor,api:async(url,options={})=>{
   const parsed=new URL(url,'https://app.test'),action=parsed.searchParams.get('action'),data=options.body?JSON.parse(options.body):Object.fromEntries([...parsed.searchParams].filter(([key])=>key!=='action'));const call={url,action,data,options};calls.push(call);
   if(handler){const result=await handler(action,data,{calls,server,state,wallet,context,root});if(result!==undefined)return result;}
   if(action==='state')return state();if(action==='search')return page([card,work('2','WEBTOON')]);
   if(action==='enroll'){const index=server.works.findIndex(row=>row.id===data.workId),row={...work(data.workId,data.workId==='2'?'WEBTOON':'NOVEL'),enabled:data.enabled};if(index<0)server.works.push(row);else server.works[index]=row;server.revision=String(BigInt(server.revision)+1n);return {...state(),saved:true,replayed:false};}
   if(action==='policy'){server.revision=String(BigInt(server.revision)+1n);server.policies.unshift({...data,id:price});return {...state(),saved:true,replayed:false};}
   if(action==='credit')return {...mode,targetUserId:data.targetUserId,balancePoints:data.points,creditedPoints:data.points,replayed:false};
   if(action==='works')return page([card,work('2','WEBTOON')]);if(action==='wallet')return wallet();
   if(action==='episodes')return {...page(episodes(data.workId).map(ep=>ep.id==='3'&&server.owned?{...ep,access:'OWNED'}:ep)),work:work(data.workId,data.workId==='2'?'WEBTOON':'NOVEL')};
   if(action==='quote')return {...mode,quote:{id:quoteId,episodeId:data.episodeId,workId:'1',versionId:version,priceVersion:price,pricePoints:100,access:'LOCKED',expiresAt:new Date(Date.now()+300000).toISOString()},balancePoints:server.balance};
   if(action==='purchase'){server.owned=true;server.balance-=100;return {...mode,episodeId:'3',access:'OWNED',chargedPoints:100,balancePoints:server.balance,entitlementId:entitlement,replayed:false};}
   if(action==='content')return {...mode,episodeId:data.episodeId,workId:'1',versionId:version,contentType:'NOVEL',title:'현재 공개 시험 원고',content:'<script>alert(1)</script>\n\n시험 본문',contentDocument:null,panels:[]};
   if(action==='panel')return new Blob(['TEST'],{type:'image/webp'});throw Error('UNEXPECTED_ACTION:'+action);
  }}};context.window=context;
 if(webtoon)context.ReaderWebtoon=webtoon;
 vm.createContext(context);if(shared){vm.runInContext(read('public/js/shared/manuscript-document.js'),context);vm.runInContext(read('public/js/reader/reader-content.js'),context);}
 vm.runInContext(kind==='admin'?adminCode:readerCode,context);
 const module=kind==='admin'?context.AdminPointsTest:context.ReaderPointsTest;
 return {root,context,calls,server,created,revoked,module,render:()=>module.render(root,{isCurrent:()=>current}),setActor:value=>actor=value,away:()=>current=false};
}
const choose=async(app,title='TEST 소설')=>button(app.root,'회차 보기: '+title).onclick();
const getQuote=async app=>{await choose(app);await button(app.root,'가격 확인: 3화').onclick();};
const confirm=async app=>{const check=all(app.root).find(node=>node.tag==='input'&&node.type==='checkbox');assert(check);check.checked=true;check.onchange();const action=buttons(app.root).find(node=>/P로 시험 열람권 받기$/.test(node._text));return action.onclick();};

test('OFF mode and wrong roles show preparation/permission without any requests',async()=>{
 for(const kind of ['reader','admin']){const app=setup(kind,{enabled:false});await app.render();assert.equal(app.calls.length,0);assert.match(app.root.textContent,/준비 중/);}
 const admin=setup('admin',{adminRole:'SUB_ADMIN'});await admin.render();assert.equal(admin.calls.length,0);assert.match(admin.root.textContent,/최고 관리자/);
 const reader=setup('reader',{readerStatus:'BANNED'});await reader.render();assert.equal(reader.calls.length,0);assert.match(reader.root.textContent,/활성 독자/);
});
test('administrator reads authenticated state and explicitly enrolls/disables a TEST work',async()=>{
 const app=setup('admin');await app.render();assert.equal(app.calls[0].action,'state');assert.match(app.root.textContent,/실제 결제/);await submit(form(app.root,'TEST 작품 검색'));assert.equal(app.calls.at(-1).options.method,'POST');
 enter(field(app.root,'작품 등록·노출 변경 사유 (3~500자)'),'시험 작품 등록');await button(app.root,'TEST 작품 등록').onclick();let write=app.calls.find(call=>call.action==='enroll');assert.deepEqual({...write.data,requestId:'X'},{workId:'1',enabled:true,revision:'0',reason:'시험 작품 등록',requestId:'X'});assert.match(app.root.textContent,/TEST 노출 중/);
 await button(app.root,'TEST 노출 중단').onclick();write=app.calls.filter(call=>call.action==='enroll').at(-1);assert.equal(write.data.enabled,false);assert.equal(write.data.revision,'1');assert.match(app.root.textContent,/TEST 노출 중단/);
});
test('administrator search pages preserve query/type and do not enroll automatically',async()=>{
 const app=setup('admin',{handler(action,data){if(action==='search')return {...page([work()]),offset:data.offset,total:51,hasMore:data.offset===0,nextOffset:data.offset===0?50:null};}});await app.render();enter(field(app.root,'작품명·필명·작품 ID'),'찾을 작품');enter(field(app.root,'작품 유형'),'WEBTOON');await submit(form(app.root,'TEST 작품 검색'));await button(app.root,'다음 검색 결과').onclick();assert.deepEqual(app.calls.at(-1).data,{q:'찾을 작품',type:'WEBTOON',offset:50});assert.equal(app.calls.filter(call=>call.action==='enroll').length,0);
});
test('price policy converts KST, keeps zero price and never sends client free-episode edits',async()=>{
 const app=setup('admin');await app.render();enter(field(app.root,'가격 적용 범위'),'EPISODE');enter(field(app.root,'가격 대상 ID'),'3');enter(field(app.root,'회차 가격 (P)'),'0');enter(field(app.root,'시행 일시 (한국 시간 KST)'),'2026-11-03T09:30');enter(field(app.root,'가격 변경 사유 (3~500자)'),'시험 가격 예외');await submit(form(app.root,'TEST 가격 설정'));const data=app.calls.find(call=>call.action==='policy').data;assert.equal(data.scope,'EPISODE');assert.equal(data.targetId,'3');assert.equal(data.points,0);assert.equal(data.startsAt,'2026-11-03T00:30:00.000Z');assert.equal(data.revision,'0');assert(!('freeEpisodes'in data));
});
test('default policy begins with the server value and does not overwrite a locally edited price',async()=>{
 const app=setup('admin',{handler(action,data,{state}){if(action==='state')return {...state(),defaults:{freeEpisodes:2,pricePoints:450}};}});await app.render();assert.equal(field(app.root,'회차 가격 (P)').value,'450');enter(field(app.root,'회차 가격 (P)'),'350');await button(app.root,'최신 TEST 상태 불러오기').onclick();assert.equal(field(app.root,'회차 가격 (P)').value,'350');
});
test('price and credit input guards reject fractional points, missing IDs and short reasons',async()=>{
 const app=setup('admin');await app.render();enter(field(app.root,'회차 가격 (P)'),'1.5');await submit(form(app.root,'TEST 가격 설정'));assert.equal(app.calls.filter(call=>call.action==='policy').length,0);
 enter(field(app.root,'지급 대상 Auth UUID'),'1');enter(field(app.root,'시험 지급 사유 (3~500자)'),'시험 지급');await submit(form(app.root,'TEST 포인트 지급'));assert.equal(app.calls.filter(call=>call.action==='credit').length,0);
 enter(field(app.root,'지급 대상 Auth UUID'),other);enter(field(app.root,'시험 지급 포인트 (P)'),'10000');await submit(form(app.root,'TEST 포인트 지급'));const data=app.calls.find(call=>call.action==='credit').data;assert.equal(data.targetUserId,other);assert.equal(data.points,10000);assert.equal(field(app.root,'지급 대상 Auth UUID').value,'');assert.match(app.root.textContent,/실제 입금·정산 없음/);
});
test('administrator unknown outcome retains exactly one original policy request across leave/render',async()=>{
 let attempts=0;const app=setup('admin',{handler(action,data,{state}){if(action==='policy'){attempts++;if(attempts===1)throw TypeError('network');return {...state(),saved:true,replayed:true};}}});await app.render();enter(field(app.root,'시행 일시 (한국 시간 KST)'),'2026-11-03T09:30');enter(field(app.root,'가격 변경 사유 (3~500자)'),'미확인 정책 시험');await submit(form(app.root,'TEST 가격 설정'));const body=app.calls.find(call=>call.action==='policy').options.body;assert.match(app.root.textContent,/미확인/);app.module.leave();await app.render();await button(app.root,'같은 요청으로 결과 확인').onclick();assert.equal(app.calls.filter(call=>call.action==='policy').length,2);assert.equal(app.calls.filter(call=>call.action==='policy')[1].options.body,body);
});
test('revision conflict preserves fields and requires explicit fresh state before a new write',async()=>{
 const app=setup('admin',{handler(action){if(action==='policy')throw Object.assign(Error('conflict'),{code:'REVISION_CONFLICT',status:409});}});await app.render();enter(field(app.root,'회차 가격 (P)'),'350');enter(field(app.root,'가격 변경 사유 (3~500자)'),'충돌 시험 정책');await submit(form(app.root,'TEST 가격 설정'));assert.equal(field(app.root,'회차 가격 (P)').value,'350');assert.equal(button(app.root,'TEST 가격 버전 저장').disabled,true);assert(!button(app.root,'같은 요청으로 결과 확인'));await button(app.root,'최신 TEST 상태 불러오기').onclick();assert.equal(button(app.root,'TEST 가격 버전 저장').disabled,false);
});
test('late administrator responses cannot populate a departed workspace or another account',async()=>{
 const hold=deferred();const app=setup('admin',{handler(action){if(action==='state')return hold.promise;}});const rendering=app.render();app.module.leave();app.setActor({userId:other,admin:{role:'SUPER_ADMIN',is_active:true}});hold.resolve({...mode,revision:'0',defaults:{freeEpisodes:2,pricePoints:100},works:[],policies:[]});await rendering;assert.equal(app.root.textContent.trim(),'');
});
test('reader lists FREE/LOCKED metadata and obtains a quote without automatically buying',async()=>{
 const app=setup();await app.render();assert.match(app.root.textContent,/10,000P/);await getQuote(app);assert.match(app.root.textContent,/회원 무료/);assert.match(app.root.textContent,/100P/);assert.equal(app.calls.filter(call=>call.action==='purchase'||call.action==='content').length,0);assert.equal(button(app.root,'100P로 시험 열람권 받기').disabled,true);assert.equal(app.calls.find(call=>call.action==='quote').options.method,'POST');
});
test('confirmed TEST purchase sends only quote/request IDs then reopens the stable episode without recharging',async()=>{
 const app=setup();await app.render();await getQuote(app);await confirm(app);const write=app.calls.find(call=>call.action==='purchase');assert.deepEqual(Object.keys(write.data).sort(),['quoteId','requestId']);assert.equal(write.data.quoteId,quoteId);assert.match(app.root.textContent,/9,900P/);assert.match(app.root.textContent,/보유 열람권/);await button(app.root,'읽기: 3화').onclick();assert.match(app.root.textContent,/<script>alert\(1\)<\/script>/);assert.equal(app.calls.filter(call=>call.action==='purchase').length,1);
});
test('member-free episode reads immediately using authenticated content only',async()=>{
 const app=setup();await app.render();await choose(app);await button(app.root,'읽기: 1화').onclick();assert.equal(app.calls.filter(call=>call.action==='quote'||call.action==='purchase').length,0);assert.equal(app.calls.find(call=>call.action==='content').data.episodeId,'1');assert.match(app.root.textContent,/현재 공개 시험 원고/);
});
test('known price/publication/expiry errors clear stale quotes and require an explicit new confirmation',async()=>{
 for(const code of ['PRICE_CHANGED','PUBLICATION_CHANGED','QUOTE_EXPIRED','INSUFFICIENT_POINTS']){const app=setup('reader',{handler(action){if(action==='purchase')throw Object.assign(Error(code),{code,status:409});}});await app.render();await getQuote(app);await confirm(app);assert(!button(app.root,'100P로 시험 열람권 받기'));assert(!button(app.root,'같은 구매 요청으로 결과 확인'));assert.equal(app.calls.filter(call=>call.action==='purchase').length,1);assert.equal(app.calls.filter(call=>call.action==='quote').length,1);assert.equal(button(app.root,'가격 확인: 3화').disabled,false);}
});
test('expired quote is rejected locally without a purchase request',async()=>{
 const app=setup('reader',{handler(action,data){if(action==='quote')return {...mode,quote:{id:quoteId,episodeId:data.episodeId,workId:'1',versionId:version,priceVersion:price,pricePoints:100,access:'LOCKED',expiresAt:'2020-01-01T00:00:00Z'},balancePoints:10000};}});await app.render();await getQuote(app);await confirm(app);assert.equal(app.calls.filter(call=>call.action==='purchase').length,0);assert.match(app.root.textContent,/만료/);
});
test('unknown purchase reuses its exact payload after navigation and never creates another debit',async()=>{
 let count=0;const app=setup('reader',{handler(action,data,{server}){if(action==='purchase'){count++;if(count===1){server.balance=9900;server.owned=true;throw TypeError('network');}return {...mode,episodeId:'3',access:'OWNED',chargedPoints:100,balancePoints:9900,entitlementId:entitlement,replayed:true};}}});await app.render();await getQuote(app);await confirm(app);const original=app.calls.find(call=>call.action==='purchase').options.body;app.module.leave();await app.render();assert.match(app.root.textContent,/미확인/);await button(app.root,'같은 구매 요청으로 결과 확인').onclick();assert.equal(app.calls.filter(call=>call.action==='purchase')[1].options.body,original);assert.equal(app.server.balance,9900);
});
test('account changes and reset discard private pending transactions instead of replaying for a new reader',async()=>{
 const app=setup('reader',{handler(action){if(action==='purchase')throw TypeError('network');}});await app.render();await getQuote(app);await confirm(app);app.setActor({userId:other,reader:{status:'ACTIVE'}});await app.render();assert(!button(app.root,'같은 구매 요청으로 결과 확인'));app.module.reset();assert.equal(app.root.textContent.trim(),'');
});
test('late reader content is ignored after leaving',async()=>{
 const hold=deferred(),app=setup('reader',{handler(action){if(action==='content')return hold.promise;}});await app.render();await choose(app);const loading=button(app.root,'읽기: 1화').onclick();app.module.leave();hold.resolve({...mode,episodeId:'1',workId:'1',versionId:version,contentType:'NOVEL',title:'늦은 원고',content:'유출되면 안 되는 늦은 응답',contentDocument:null,panels:[]});await loading;assert.equal(app.root.textContent.trim(),'');
});
test('existing safe manuscript renderer preserves Word formatting and treats arbitrary HTML as text',async()=>{
 const document={version:1,paragraphs:[{align:'center',indent:1,runs:[{text:'서식 본문',bold:true,italic:true,underline:true}]}]};const app=setup('reader',{shared:true,handler(action,data){if(action==='content')return {...mode,episodeId:data.episodeId,workId:'1',versionId:version,contentType:'NOVEL',title:'서식 시험',content:'서식 본문',contentDocument:document,panels:[]};}});await app.render();await choose(app);await button(app.root,'읽기: 1화').onclick();for(const tag of ['strong','em','u'])assert(all(app.root).some(node=>node.tag===tag));const paragraph=all(app.root).find(node=>node.tag==='p'&&node.style.textAlign==='center');assert.equal(paragraph.style.textIndent,'1em');
});
const toonContent=()=>({...mode,episodeId:'1',workId:'2',versionId:version,contentType:'WEBTOON',title:'인증 이미지 시험',content:null,contentDocument:null,panels:[{id:panelId,order:0,width:800,height:4096,format:'webp'}]});
test('webtoon fallback requests authenticated blobs and revokes object URLs on leave',async()=>{
 const app=setup('reader',{handler(action){if(action==='content')return toonContent();}});await app.render();await choose(app,'TEST 웹툰');await button(app.root,'읽기: 1화').onclick();assert.equal(app.calls.filter(call=>call.action==='panel').length,0);await button(app.root,'1번째 이미지 불러오기').onclick();const call=app.calls.find(call=>call.action==='panel');assert.equal(call.options.responseType,'blob');assert.deepEqual(call.data,{episodeId:'1',versionId:version,panelId,format:'webp'});assert.deepEqual(app.created,['blob:test-1']);app.module.leave();assert.deepEqual(app.revoked,['blob:test-1']);
});
test('late panel blobs after navigation create no object URL',async()=>{
 const hold=deferred(),app=setup('reader',{handler(action){if(action==='content')return toonContent();if(action==='panel')return hold.promise;}});await app.render();await choose(app,'TEST 웹툰');await button(app.root,'읽기: 1화').onclick();const loading=button(app.root,'1번째 이미지 불러오기').onclick();app.module.leave();hold.resolve(new Blob(['late']));await loading;assert.equal(app.created.length,0);
});
test('existing virtualized webtoon renderer gets only the new authenticated panel callback and is disposed',async()=>{
 let received,disposed=0;const app=setup('reader',{webtoon:{render(root,panels,options){received={panels,options};return ()=>disposed++;}},handler(action){if(action==='content')return toonContent();}});await app.render();await choose(app,'TEST 웹툰');await button(app.root,'읽기: 1화').onclick();assert(received);await received.options.load(received.panels[0],'webp');assert.equal(app.calls.at(-1).data.format,'webp');await received.options.load(received.panels[0],'png');assert.equal(app.calls.at(-1).data.format,'png');assert.equal(app.calls.at(-1).options.responseType,'blob');assert.throws(()=>received.options.load(received.panels[0],'jpeg'),/INVALID_TEST_IMAGE_FORMAT/);assert(app.calls.filter(call=>call.action==='panel').every(call=>call.url.startsWith('/api/v2/points-test?')));app.module.leave();assert.equal(disposed,1);assert.equal(received.options.valid(),false);
});
test('metadata paging uses server offsets and keeps work ID separate from episode ID',async()=>{
 const app=setup('reader',{handler(action,data){if(action==='works')return {...page([work()]),offset:Number(data.offset),total:51,hasMore:Number(data.offset)===0,nextOffset:Number(data.offset)===0?50:null};if(action==='episodes')return {...page(episodes(data.workId)),work:work(data.workId),offset:Number(data.offset),total:51,hasMore:Number(data.offset)===0,nextOffset:Number(data.offset)===0?50:null};}});await app.render();await button(app.root,'다음 작품').onclick();assert.equal(app.calls.filter(call=>call.action==='works').at(-1).data.offset,'50');await choose(app);await button(app.root,'다음 회차').onclick();assert.deepEqual(app.calls.at(-1).data,{workId:'1',offset:'50'});
});
test('wrong-mode server data cannot fabricate balances or expose TEST content',async()=>{
 const app=setup('reader',{handler(action){if(action==='wallet')return {mode:'LIVE',provenance:'LOCAL_SIMULATED',balancePoints:500000,ledger:[]};}});await app.render();assert.doesNotMatch(app.root.textContent,/500,000P/);assert(!button(app.root,'회차 보기: TEST 소설'));const admin=setup('admin',{handler(action){if(action==='state')return {mode:'LIVE',revision:'0',defaults:{freeEpisodes:2,pricePoints:100},works:[],policies:[]};}});await admin.render();assert(!button(admin.root,'시험 포인트 지급'));
});
test('TEST assets use scoped tokens, keyboard/mobile controls and no production storage or history effects',async()=>{
 await transform(css,{loader:'css'});assert.match(css,/min-height: 44px/);assert.match(css,/:focus-visible/);assert.match(css,/@media \(max-width: 650px\)/);assert.match(css,/width: 100%; height: auto/);assert.doesNotMatch(css,/#[a-f0-9]{3,8}\b/i);
 for(const source of [adminCode,readerCode])assert.doesNotMatch(source,/innerHTML|localStorage|sessionStorage|requestPayment|unlockEpisode|ReadingHistory|ReaderHub|GrowthStudio|\/api\/v2\/webtoon\/images/);
});
