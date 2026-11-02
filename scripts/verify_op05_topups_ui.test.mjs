import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transform} from 'esbuild';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const adminCode=read('public/js/admin/admin-topups.js'),readerCode=read('public/js/reader/reader-topups.js'),css=read('public/css/topups-test.css');
const user='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',productId='20000000-0000-4000-8000-000000000001',version='30000000-0000-4000-8000-000000000001',newVersion='30000000-0000-4000-8000-000000000002',orderId='40000000-0000-4000-8000-000000000001',refundId='50000000-0000-4000-8000-000000000001';
const mode={mode:'TEST',provenance:'LOCAL_SIMULATED',providerMode:'LOCAL_SIMULATED'},clone=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.attributes={};this._text='';this.value='';this.checked=false;this.disabled=false;this.isConnected=true;this.style={};this.dataset={};}
 set textContent(value){this._text=String(value??'');this.children=[];}get textContent(){return this._text+' '+this.children.map(child=>child.textContent).join(' ');}
 set innerHTML(_){assert.fail('TEST UI must never assign untrusted HTML');}
 append(...children){for(const child of children){child.parentNode=this;this.children.push(child);}}
 replaceChildren(...children){this._text='';this.children=[];this.append(...children);}
 setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}
 querySelectorAll(selector){const tags=selector.split(',');return this.children.flatMap(child=>[...(tags.includes(child.tag)?[child]:[]),...child.querySelectorAll(selector)]);}
}
const all=root=>[root,...root.children.flatMap(all)],button=(root,label)=>all(root).find(node=>node.tag==='button'&&node._text===label);
const field=(root,label)=>all(root).find(node=>node.tag==='label'&&node.children[0]?._text===label)?.children.find(node=>['input','select'].includes(node.tag));
const form=(root,label)=>all(root).find(node=>node.tag==='form'&&node.getAttribute('aria-label')===label);
const enter=(node,value)=>{assert(node);node.value=value;node.oninput?.();node.onchange?.();};
const submit=node=>{assert(node);return node.onsubmit({preventDefault(){}});};
const check=(root,label)=>{const node=all(root).find(node=>node.tag==='label'&&node.children.some(child=>child._text===label))?.children.find(child=>child.tag==='input');assert(node);node.checked=true;node.onchange();};
const product=()=>({id:productId,versionId:version,title:'TEST 1만 포인트',amountKrw:8000,points:10000,enabled:true,startsAt:'2026-11-01T00:00:00.000Z',endsAt:null,expiresMinutes:30});
const order=(extra={})=>({id:orderId,checkoutId:'wn05-'+orderId,userId:user,productId,productVersion:version,title:'TEST 1만 포인트',method:'BANK',amountKrw:8000,points:10000,status:'WAITING_DEPOSIT',createdAt:'2026-11-02T00:00:00.000Z',expiresAt:'2026-11-02T00:30:00.000Z',credited:false,refundablePoints:0,refundAmountKrw:0,refund:null,...extra});
const page=(items,offset=0,total=items.length)=>({...mode,items,offset,limit:50,total,hasMore:total>offset+50,nextOffset:total>offset+50?offset+50:null});
function setup(kind='reader',{enabled=true,handler,adminRole='SUPER_ADMIN',readerStatus='ACTIVE',tab='payments',providerMode='LOCAL_SIMULATED',initialOrder=order(),callback=null,sdk=false}={}){
 let actor={userId:user,admin:{role:adminRole,is_active:true},reader:{status:readerStatus}},current=true,serial=0;
 const root=new Element(),head=new Element('head'),calls=[],sdkRequests=[],server={revision:'0',products:[product()],orders:[clone(initialOrder)],balance:10000,reserved:0},marker={...mode,providerMode};
 const state=()=>({...marker,revision:server.revision,products:clone(server.products)});
 const list=items=>({...page(clone(items)),...marker});
 const wallet=()=>({...mode,balancePoints:server.balance,reservedPoints:server.reserved,totalPoints:server.balance+server.reserved,ledger:[]});
 const context={URL,URLSearchParams,Date,BigInt,Object,console,location:{origin:'https://app.test'},crypto:{randomUUID:()=>`70000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`},document:{head,createElement:tag=>new Element(tag)},WEBNOVELS_CONFIG:{chargingTestEnabled:enabled},WebNovelsAuth:{getActor:()=>actor,api:async(url,options={})=>{
   const parsed=new URL(url,'https://app.test'),action=parsed.searchParams.get('action'),data=options.body?JSON.parse(options.body):Object.fromEntries([...parsed.searchParams].filter(([key])=>key!=='action')),call={url,action,data,options};calls.push(call);
   if(handler){const result=await handler(action,data,{calls,server,state,wallet,list,marker,context,root});if(result!==undefined)return result;}
   if(action==='state')return state();if(action==='wallet')return wallet();if(action==='products')return list(server.products);if(action==='orders')return list(server.orders);if(action==='order')return {...marker,order:clone(server.orders.find(row=>row.id===data.orderId))};
   if(action==='checkout')return {...marker,checkout:{clientKey:'test_ck_CONTROLLED_TEST_CLIENT_KEY',customerKey:user,orderId:'wn05-'+orderId,orderName:'TEST 1만 포인트',amountKrw:8000,currency:'KRW',successUrl:'https://app.test/charging-test/return',failUrl:'https://app.test/charging-test/return'}};
   if(action==='product'){server.revision=String(BigInt(server.revision)+1n);const saved={...data,id:data.productId??productId,versionId:newVersion};server.products=[saved];return {...state(),saved:true,replayed:false};}
   if(action==='create'){const row=order({method:data.method,status:data.method==='CARD'?'CREATED':'WAITING_DEPOSIT'});server.orders=[row];return {...marker,order:clone(row),replayed:false};}
   const index=server.orders.findIndex(row=>row.id===data.orderId),row=server.orders[index];
   if(action==='deposit'){row.status=data.amountKrw===row.amountKrw?'PAID':'REVIEW';row.credited=row.status==='PAID';row.refundablePoints=row.credited?row.points:0;row.refundAmountKrw=row.credited?row.amountKrw:0;return {...marker,order:clone(row),replayed:false};}
   if(action==='refund'){row.status=row.method==='BANK'?'REFUND_PENDING':'REFUND_UNKNOWN';row.refund={id:refundId,status:'PENDING',points:row.refundablePoints,amountKrw:row.refundAmountKrw,createdAt:'2026-11-02T00:10:00.000Z'};server.reserved=row.refund.points;server.balance-=row.refund.points;return {...marker,order:clone(row)};}
   if(action==='bank-refund'){row.status='REFUNDED';row.refund.status='COMPLETED';return {...marker,order:clone(row),replayed:false};}
   if(['reconcile','retry-refund','confirm'].includes(action))return {...marker,order:clone(row)};
   throw Error('UNEXPECTED_ACTION:'+action);
  }}};context.window=context;if(sdk){head.append=script=>{Element.prototype.append.call(head,script);context.TossPayments=clientKey=>({payment:({customerKey})=>({requestPayment:async options=>{sdkRequests.push({clientKey,customerKey,options:clone(options)});}})});script.onload();};}vm.createContext(context);vm.runInContext(kind==='admin'?adminCode:readerCode,context);
 const module=kind==='admin'?context.AdminTopups:context.ReaderTopups;
 return {root,head,context,calls,sdkRequests,server,module,render:()=>module.render(root,{tab,callback,isCurrent:()=>current}),setActor:value=>actor=value,away:()=>current=false};
}
const choose=async app=>button(app.root,'주문 관리: wn05-'+orderId).onclick();
const open=async app=>button(app.root,'주문 확인: wn05-'+orderId).onclick();
const selectProduct=app=>button(app.root,'상품 선택: TEST 1만 포인트').onclick();
const accept=app=>check(app.root,'가격·지급 포인트·TEST 조건을 확인했습니다.');
function fillProduct(app){enter(field(app.root,'상품명'),'새 TEST 상품');enter(field(app.root,'판매 시작 (한국 시간 KST)'),'2026-11-03T09:30');enter(field(app.root,'상품 변경 사유 (3~500자)'),'시험 상품 설정');}
function fillDeposit(app,amount='8000'){enter(field(app.root,'입금 원거래 키'),'BANK-TEST-001');enter(field(app.root,'실제 입금 금액 (KRW)'),amount);enter(field(app.root,'입금 시각 (한국 시간 KST)'),'2026-11-02T09:10');enter(field(app.root,'입금 대조 사유 (3~500자)'),'원거래 대조 완료');}

test('disabled or wrong-role workspaces never query payment APIs',async()=>{
 for(const kind of ['reader','admin']){const app=setup(kind,{enabled:false});await app.render();assert.equal(app.calls.length,0);assert.match(app.root.textContent,/준비 중/);}
 const admin=setup('admin',{adminRole:'SUB_ADMIN'});await admin.render();assert.equal(admin.calls.length,0);assert.match(admin.root.textContent,/최고 관리자/);
 const reader=setup('reader',{readerStatus:'BANNED'});await reader.render();assert.equal(reader.calls.length,0);assert.match(reader.root.textContent,/활성 독자/);
});
test('products store exact CAS contract with distinct KRW/points and KST conversion',async()=>{
 const app=setup('admin');await app.render();fillProduct(app);enter(field(app.root,'결제 금액 (KRW)'),'8000');enter(field(app.root,'지급 포인트 (P)'),'10000');await submit(form(app.root,'TEST 충전상품 설정'));const call=app.calls.find(row=>row.action==='product');assert.deepEqual(Object.keys(call.data).sort(),['amountKrw','enabled','endsAt','expiresMinutes','points','productId','reason','requestId','revision','startsAt','title']);assert.equal(call.data.productId,null);assert.equal(call.data.revision,'0');assert.equal(call.data.startsAt,'2026-11-03T00:30:00.000Z');assert.equal(call.data.endsAt,null);assert.equal(call.data.amountKrw,8000);assert.equal(call.data.points,10000);assert.equal(call.options.method,'POST');assert.match(app.root.textContent,/기존 주문의 조건은 유지/);
});
test('editing existing product preserves ID while revision refresh preserves edited inputs',async()=>{
 const app=setup('admin');await app.render();button(app.root,'상품 수정: TEST 1만 포인트').onclick();enter(field(app.root,'상품명'),'수정 중인 상품');enter(field(app.root,'상품 변경 사유 (3~500자)'),'상품 버전 변경');await button(app.root,'최신 TEST 상품·주문 불러오기').onclick();assert.equal(field(app.root,'상품명').value,'수정 중인 상품');await submit(form(app.root,'TEST 충전상품 설정'));assert.equal(app.calls.find(row=>row.action==='product').data.productId,productId);
});
test('bad amounts, expiry bounds and dates do not create product requests',async()=>{
 for(const [label,value]of [['결제 금액 (KRW)','0'],['지급 포인트 (P)','1.5'],['주문 기한 (분, 5~1440)','4'],['판매 시작 (한국 시간 KST)','2026-02-30T10:00'],['판매 종료 (한국 시간 KST, 선택)','2026-11-01T10:00']]){const app=setup('admin');await app.render();fillProduct(app);enter(field(app.root,label),value);await submit(form(app.root,'TEST 충전상품 설정'));assert.equal(app.calls.filter(row=>row.action==='product').length,0);}
});
test('CAS conflict keeps draft and requires explicit fresh state before another write',async()=>{
 let attempts=0;const app=setup('admin',{handler(action){if(action==='product'&&++attempts===1)throw Object.assign(Error('conflict'),{status:409,code:'REVISION_CONFLICT'});}});await app.render();fillProduct(app);await submit(form(app.root,'TEST 충전상품 설정'));assert.equal(field(app.root,'상품명').value,'새 TEST 상품');assert.equal(button(app.root,'TEST 상품 버전 저장').disabled,true);assert(!button(app.root,'같은 요청으로 결과 확인'));await button(app.root,'최신 TEST 상품·주문 불러오기').onclick();assert.equal(button(app.root,'TEST 상품 버전 저장').disabled,false);
});
test('unknown administrator product outcome preserves exact request across route leave',async()=>{
 let count=0;const app=setup('admin',{handler(action){if(action==='product'&&++count===1)throw TypeError('network');}});await app.render();fillProduct(app);await submit(form(app.root,'TEST 충전상품 설정'));const original=app.calls.find(row=>row.action==='product').options.body;assert.match(app.root.textContent,/미확인/);app.module.leave();await app.render();await button(app.root,'같은 요청으로 결과 확인').onclick();assert.equal(app.calls.filter(row=>row.action==='product')[1].options.body,original);
});
test('deposit mismatches remain REVIEW and require bank reference, amount, datetime and reason',async()=>{
 const app=setup('admin');await app.render();await choose(app);fillDeposit(app,'7999');await submit(form(app.root,'TEST 입금 대조'));const data=app.calls.find(row=>row.action==='deposit').data;assert.deepEqual(Object.keys(data).sort(),['amountKrw','bankReference','orderId','reason','receivedAt','requestId']);assert.equal(data.receivedAt,'2026-11-02T00:10:00.000Z');assert.equal(data.amountKrw,7999);assert.match(app.root.textContent,/서버 확인 상태: 관리자 확인 필요/);assert.doesNotMatch(app.root.textContent,/서버 확인 상태: 적립 완료/);
});
test('admin duplicate submission is blocked and late responses cannot cross account or route',async()=>{
 const hold=deferred(),app=setup('admin',{handler(action){if(action==='deposit')return hold.promise;}});await app.render();await choose(app);fillDeposit(app);const posting=submit(form(app.root,'TEST 입금 대조'));await submit(form(app.root,'TEST 입금 대조'));assert.equal(app.calls.filter(row=>row.action==='deposit').length,1);app.module.leave();app.setActor({userId:other,admin:{role:'SUPER_ADMIN',is_active:true}});hold.resolve({...mode,order:order({status:'PAID',credited:true,refundablePoints:10000,refundAmountKrw:8000}),replayed:false});await posting;assert.equal(app.root.textContent.trim(),'');
});
test('admin refund reserves unspent part and bank payout completion uses separate actual evidence',async()=>{
 const app=setup('admin',{tab:'refunds',initialOrder:order({status:'PAID',credited:true,refundablePoints:4500,refundAmountKrw:3600})});await app.render();assert(!form(app.root,'TEST 충전상품 설정'));await choose(app);enter(field(app.root,'환불 사유 (3~200자)'),'남은 미사용분 환불');await submit(form(app.root,'TEST 환불 예약'));assert.match(app.root.textContent,/환불 처리 대기 · 예약 유지/);assert.equal(app.calls.find(row=>row.action==='refund').data.orderId,orderId);assert(!('points'in app.calls.find(row=>row.action==='refund').data));enter(field(app.root,'환불 이체 거래 키'),'BANK-PAYOUT-001');enter(field(app.root,'실제 환불 금액 (KRW)'),'3600');enter(field(app.root,'환불 이체 시각 (한국 시간 KST)'),'2026-11-02T10:20');enter(field(app.root,'환불 증빙 확인 사유 (3~500자)'),'은행 환불 이체 확인');await submit(form(app.root,'TEST 은행 환불 증빙'));const data=app.calls.find(row=>row.action==='bank-refund').data;assert.equal(data.paidAt,'2026-11-02T01:20:00.000Z');assert.equal(data.amountKrw,3600);assert.match(app.root.textContent,/서버 확인 상태: 환불 완료/);
});
test('admin filters and next pages send only strict status and offset contract',async()=>{
 const app=setup('admin',{tab:'reconciliation',handler(action,data){if(action==='orders')return {...page([order()],data.offset,51)};}});await app.render();enter(field(app.root,'주문 상태'),'UNKNOWN');await submit(form(app.root,'TEST 주문 필터'));await button(app.root,'다음 주문').onclick();assert.deepEqual(app.calls.filter(row=>row.action==='orders').at(-1).data,{status:'UNKNOWN',offset:50});assert(!form(app.root,'TEST 충전상품 설정'));
});
test('reader lists safe metadata and wallet gross/reserved/available without creating orders',async()=>{
 const app=setup('reader',{handler(action,data,{wallet}){if(action==='wallet')return {...wallet(),balancePoints:7500,reservedPoints:2500,totalPoints:10000};}});await app.render();assert.match(app.root.textContent,/총 10,000P · 환불 예약 2,500P · 사용 가능 7,500P/);assert.equal(app.calls.filter(row=>row.action==='create'||row.action==='confirm').length,0);const back=all(app.root).find(node=>node.tag==='a');assert.equal(back.href,'/reading-test');selectProduct(app);assert.equal(button(app.root,'확인한 조건으로 TEST 주문 생성').disabled,true);
});
test('reader explicitly creates BANK order with the displayed immutable product version',async()=>{
 const app=setup();await app.render();selectProduct(app);accept(app);await submit(form(app.root,'TEST 주문 생성'));const call=app.calls.find(row=>row.action==='create');assert.deepEqual(Object.keys(call.data).sort(),['method','productId','productVersion','requestId']);assert.equal(call.data.productVersion,version);assert.equal(call.data.method,'BANK');assert.match(app.root.textContent,/서버 확인 상태: 입금 대기/);assert.equal(app.calls.filter(row=>row.action==='deposit').length,0);
});
test('LOCAL_SIMULATED CARD order is never automatically confirmed or given paymentKey field',async()=>{
 const app=setup();await app.render();selectProduct(app);enter(field(app.root,'시험 결제 방식'),'CARD');accept(app);await submit(form(app.root,'TEST 주문 생성'));assert.match(app.root.textContent,/서버 모의전송 필요/);assert(!field(app.root,'제공자 TEST paymentKey'));assert.equal(app.calls.filter(row=>row.action==='confirm').length,0);await button(app.root,'카드 서버 결과 재조회').onclick();assert.deepEqual(app.calls.find(row=>row.action==='reconcile').data,{orderId});
});
test('PROVIDER_TEST callback checks own order and amount then requires explicit server approval',async()=>{
 const callback={orderId,paymentKey:'TEST-PAYMENT-EVIDENCE',expectedAmountKrw:8000},app=setup('reader',{providerMode:'PROVIDER_TEST',initialOrder:order({method:'CARD',status:'CREATED'}),callback});await app.render();assert.equal(app.calls.filter(row=>row.action==='confirm').length,0);assert.match(app.root.textContent,/복귀만으로는 적립하지 않습니다/);assert.doesNotMatch(app.root.textContent,/TEST-PAYMENT-EVIDENCE/);await submit(form(app.root,'제공자 TEST 승인 확인'));const call=app.calls.find(row=>row.action==='confirm');assert.deepEqual(call.data,callback);assert.equal(call.options.method,'POST');assert(!call.url.includes('EVIDENCE'));assert(!form(app.root,'제공자 TEST 승인 확인'));
});
test('changed product response never silently creates a replacement order with a new version',async()=>{
 const app=setup('reader',{handler(action){if(action==='create')throw Object.assign(Error('changed'),{status:409,code:'PRODUCT_CHANGED'});}});await app.render();selectProduct(app);accept(app);await submit(form(app.root,'TEST 주문 생성'));assert.equal(app.calls.filter(row=>row.action==='create').length,1);assert.match(app.root.textContent,/최신 상품/);assert(!button(app.root,'같은 요청으로 결과 확인'));
});
test('unknown reader create preserves exact payload across leave and suppresses duplicate creation',async()=>{
 let count=0;const hold=deferred(),app=setup('reader',{handler(action){if(action==='create'&&++count===1)return hold.promise;}});await app.render();selectProduct(app);accept(app);const posting=submit(form(app.root,'TEST 주문 생성'));await submit(form(app.root,'TEST 주문 생성'));assert.equal(app.calls.filter(row=>row.action==='create').length,1);hold.reject(TypeError('network'));await posting;const original=app.calls.find(row=>row.action==='create').options.body;app.module.leave();await app.render();await button(app.root,'같은 요청으로 결과 확인').onclick();assert.equal(app.calls.filter(row=>row.action==='create')[1].options.body,original);
});
test('reader card unknown refund keeps reserved balance and uses same operation retry without new requestId',async()=>{
 const app=setup('reader',{initialOrder:order({method:'CARD',status:'PAID',credited:true,refundablePoints:2500,refundAmountKrw:2000})});await app.render();await open(app);enter(field(app.root,'환불 사유 (3~200자)'),'미사용 포인트 환불');await submit(form(app.root,'TEST 미사용분 환불'));const data=app.calls.find(row=>row.action==='refund').data;assert.deepEqual(Object.keys(data).sort(),['orderId','reason','requestId']);assert.match(app.root.textContent,/환불 결과 미확인 · 예약 유지/);assert.match(app.root.textContent,/환불 예약 2,500P · 사용 가능 7,500P/);assert(!form(app.root,'TEST 미사용분 환불'));await button(app.root,'같은 카드 환불 결과 재확인').onclick();assert.deepEqual(app.calls.find(row=>row.action==='retry-refund').data,{orderId});assert.equal(app.calls.filter(row=>row.action==='refund').length,1);
});
test('reader order details use authenticated order GET and never render private transport or bank references',async()=>{
 const app=setup('reader',{handler(action){if(action==='order')return {...mode,order:{...order(),bankReference:'PRIVATE_BANK_TOKEN',paymentKey:'PRIVATE_PAYMENT_TOKEN',transport:{binding:'PRIVATE_BINDING'}}};}});await app.render();await open(app);const call=app.calls.find(row=>row.action==='order');assert.deepEqual(call.data,{orderId});assert(!call.options.body);assert.doesNotMatch(app.root.textContent,/PRIVATE_/);
});
test('reader pages use server offsets and do not create financial actions while paging',async()=>{
 const app=setup('reader',{handler(action,data){if(action==='products')return page([product()],Number(data.offset),51);if(action==='orders')return page([order()],Number(data.offset),51);}});await app.render();await button(app.root,'다음 상품').onclick();assert.equal(app.calls.filter(row=>row.action==='products').at(-1).data.offset,'50');await button(app.root,'다음 주문').onclick();assert.equal(app.calls.filter(row=>row.action==='orders').at(-1).data.offset,'50');assert.equal(app.calls.filter(row=>['create','refund','confirm'].includes(row.action)).length,0);
});
test('account switch discards private pending requests and reset clears rendered data',async()=>{
 const app=setup('reader',{handler(action){if(action==='create')throw TypeError('network');}});await app.render();selectProduct(app);accept(app);await submit(form(app.root,'TEST 주문 생성'));assert(button(app.root,'같은 요청으로 결과 확인'));app.setActor({userId:other,reader:{status:'ACTIVE'}});await app.render();assert(!button(app.root,'같은 요청으로 결과 확인'));app.module.reset();assert.equal(app.root.textContent.trim(),'');
});
test('late reader order response is ignored after navigation',async()=>{
 const hold=deferred(),app=setup('reader',{handler(action){if(action==='order')return hold.promise;}});await app.render();const opening=open(app);app.module.leave();hold.resolve({...mode,order:order({title:'유출되면 안 되는 다른 화면 응답'})});await opening;assert.equal(app.root.textContent.trim(),'');
});
test('wrong-mode or malformed wallet data never fabricates balances or enables writes',async()=>{
 for(const kind of ['reader','admin']){const app=setup(kind,{handler(action){if(action==='wallet')return {...mode,balancePoints:999999,totalPoints:1000000,reservedPoints:0};if(action==='state')return {mode:'LIVE',provenance:'LOCAL_SIMULATED',providerMode:'LOCAL_SIMULATED',revision:'0',products:[product()]};}});await app.render();assert.doesNotMatch(app.root.textContent,/999,999P/);assert(!button(app.root,'TEST 상품 버전 저장'));assert(!button(app.root,'상품 선택: TEST 1만 포인트'));}
});
test('safe DOM renders hostile names as text and assets remain scoped, keyboard and mobile ready',async()=>{
 const app=setup('admin',{handler(action,data,{state}){if(action==='state')return {...state(),products:[{...product(),title:'<img src=x onerror=alert(1)>'}]};}});await app.render();assert.match(app.root.textContent,/<img src=x onerror=alert\(1\)>/);assert(!all(app.root).some(node=>node.tag==='img'));
 await transform(css,{loader:'css'});assert.match(css,/min-height: 44px/);assert.match(css,/:focus-visible/);assert.match(css,/@media \(max-width: 650px\)/);assert.doesNotMatch(css,/#[a-f0-9]{3,8}\b/i);for(const source of [adminCode,readerCode])assert.doesNotMatch(source,/innerHTML|localStorage|sessionStorage|confirmPayment|\.location\s*=|\.innerText|console\.log/);
});

test('explicit PROVIDER_TEST checkout lazy-loads only fixed SDK once and never confirms from SDK resolution',async()=>{
 const app=setup('reader',{providerMode:'PROVIDER_TEST',initialOrder:order({method:'CARD',status:'CREATED'}),sdk:true});await app.render();assert.equal(app.head.children.length,0);await open(app);assert.equal(app.calls.filter(row=>row.action==='checkout').length,0);await button(app.root,'제공자 TEST 카드 결제창 열기').onclick();assert.equal(app.head.children.length,1);assert.equal(app.head.children[0].src,'https://js.tosspayments.com/v2/standard');assert.deepEqual(app.sdkRequests[0],{clientKey:'test_ck_CONTROLLED_TEST_CLIENT_KEY',customerKey:user,options:{method:'CARD',amount:{currency:'KRW',value:8000},orderId:'wn05-'+orderId,orderName:'TEST 1만 포인트',successUrl:'https://app.test/charging-test/return',failUrl:'https://app.test/charging-test/return'}});assert.equal(app.calls.filter(row=>row.action==='confirm').length,0);await button(app.root,'제공자 TEST 카드 결제창 열기').onclick();assert.equal(app.head.children.length,1);assert.equal(app.sdkRequests.length,2);
});
test('checkout freezes provider binding through POST, never GET query mutation',async()=>{
 const app=setup('reader',{providerMode:'PROVIDER_TEST',initialOrder:order({method:'CARD',status:'CREATED'}),sdk:true});await app.render();await open(app);await button(app.root,'제공자 TEST 카드 결제창 열기').onclick();const call=app.calls.find(row=>row.action==='checkout');assert.equal(call.options.method,'POST');assert.deepEqual(call.data,{orderId});assert(!call.url.includes('orderId='));
});
test('invalid checkout merchant mode, LIVE key, owner, amount or off-origin redirects never load SDK',async()=>{
 for(const invalid of [{clientKey:'live_ck_INVALID_LIVE_KEY'},{customerKey:other},{amountKrw:7999},{orderId:'wn05-'+other},{successUrl:'https://elsewhere.test/charging-test/return'},{failUrl:'https://app.test/not-our-return'},{orderName:'가'.repeat(200)}]){const app=setup('reader',{providerMode:'PROVIDER_TEST',initialOrder:order({method:'CARD',status:'CREATED'}),sdk:true,handler(action,data,{marker}){if(action==='checkout')return {...marker,checkout:{clientKey:'test_ck_CONTROLLED_TEST_CLIENT_KEY',customerKey:user,orderId:'wn05-'+orderId,orderName:'TEST',amountKrw:8000,currency:'KRW',successUrl:'https://app.test/charging-test/return',failUrl:'https://app.test/charging-test/return',...invalid}};}});await app.render();await open(app);await button(app.root,'제공자 TEST 카드 결제창 열기').onclick();assert.equal(app.head.children.length,0);assert.equal(app.sdkRequests.length,0);}
});
test('mismatched callback, simulated callback and failure callback never approve or display paymentKey',async()=>{
 for(const options of [{expectedAmountKrw:7999},{providerMode:'LOCAL_SIMULATED'},{expectedAmountKrw:0},{code:'USER_CANCEL',message:'provider text'}]){const {providerMode='PROVIDER_TEST',...callbackChange}=options,app=setup('reader',{providerMode,initialOrder:order({method:'CARD',status:'CREATED'}),callback:{orderId,paymentKey:'PRIVATE_CALLBACK_TOKEN',expectedAmountKrw:8000,...callbackChange}});await app.render();assert(!form(app.root,'제공자 TEST 승인 확인'));assert.equal(app.calls.filter(row=>row.action==='confirm').length,0);assert.doesNotMatch(app.root.textContent,/PRIVATE_CALLBACK_TOKEN/);}
});
test('late checkout response cannot open external card SDK after leaving',async()=>{
 const hold=deferred(),app=setup('reader',{providerMode:'PROVIDER_TEST',initialOrder:order({method:'CARD',status:'CREATED'}),sdk:true,handler(action){if(action==='checkout')return hold.promise;}});await app.render();await open(app);const opening=button(app.root,'제공자 TEST 카드 결제창 열기').onclick();app.module.leave();hold.resolve({...mode,providerMode:'PROVIDER_TEST',checkout:{clientKey:'test_ck_CONTROLLED_TEST_CLIENT_KEY',customerKey:user,orderId:'wn05-'+orderId,orderName:'TEST',amountKrw:8000,currency:'KRW',successUrl:'https://app.test/charging-test/return',failUrl:'https://app.test/charging-test/return'}});await opening;assert.equal(app.head.children.length,0);assert.equal(app.sdkRequests.length,0);assert.equal(app.root.textContent.trim(),'');
});
test('unknown callback approval preserves its original evidence payload across navigation without displaying the key',async()=>{
 let attempts=0;const callback={orderId,paymentKey:'PRIVATE_TEST_EVIDENCE',expectedAmountKrw:8000},app=setup('reader',{providerMode:'PROVIDER_TEST',initialOrder:order({method:'CARD',status:'CREATED'}),callback,handler(action){if(action==='confirm'&&++attempts===1)throw TypeError('network');}});await app.render();await submit(form(app.root,'제공자 TEST 승인 확인'));const original=app.calls.find(row=>row.action==='confirm').options.body;assert.match(app.root.textContent,/미확인/);app.module.leave();await app.render();assert.doesNotMatch(app.root.textContent,/PRIVATE_TEST_EVIDENCE/);await button(app.root,'같은 요청으로 결과 확인').onclick();assert.equal(app.calls.filter(row=>row.action==='confirm')[1].options.body,original);assert.equal(app.calls.filter(row=>row.action==='confirm').length,2);
});
test('callbacks for an already credited order do not offer duplicate confirmation',async()=>{
 const app=setup('reader',{providerMode:'PROVIDER_TEST',initialOrder:order({method:'CARD',status:'PAID',credited:true,refundablePoints:10000,refundAmountKrw:8000}),callback:{orderId,paymentKey:'PRIVATE_TEST_EVIDENCE',expectedAmountKrw:8000}});await app.render();assert(!form(app.root,'제공자 TEST 승인 확인'));assert.equal(app.calls.filter(row=>row.action==='confirm').length,0);assert.match(app.root.textContent,/중복 승인하지 않습니다/);
});
test('legacy wallet balance fallback is accepted only when both reserve fields are absent',async()=>{
 const app=setup('reader',{handler(action){if(action==='wallet')return {...mode,balancePoints:10000,ledger:[]};}});await app.render();assert.match(app.root.textContent,/총 10,000P · 환불 예약 0P · 사용 가능 10,000P/);
 const broken=setup('reader',{handler(action){if(action==='wallet')return {...mode,balancePoints:10000,reservedPoints:0,ledger:[]};}});await broken.render();assert(!button(broken.root,'상품 선택: TEST 1만 포인트'));assert.doesNotMatch(broken.root.textContent,/사용 가능 10,000P/);
});
test('unknown refund hides stale spendable balance until explicit authenticated wallet requery',async()=>{
 const app=setup('reader',{initialOrder:order({status:'PAID',credited:true,refundablePoints:10000,refundAmountKrw:8000}),handler(action,data,{server}){if(action==='refund'){server.balance=0;server.reserved=10000;throw TypeError('network after committed reservation');}}});await app.render();await open(app);enter(field(app.root,'환불 사유 (3~200자)'),'미확인 환불 예약');await submit(form(app.root,'TEST 미사용분 환불'));assert.doesNotMatch(app.root.textContent,/사용 가능 10,000P/);assert.match(app.root.textContent,/지갑을 조회하지 못했습니다/);await button(app.root,'최신 TEST 상품·본인 주문 불러오기').onclick();assert.match(app.root.textContent,/환불 예약 10,000P · 사용 가능 0P/);assert(button(app.root,'같은 요청으로 결과 확인'));assert.equal(app.calls.filter(row=>row.action==='refund').length,1);
});
test('SDK documentation keys are rejected independently of server checkout projection',async()=>{
 const app=setup('reader',{providerMode:'PROVIDER_TEST',initialOrder:order({method:'CARD',status:'CREATED'}),sdk:true,handler(action,data,{marker}){if(action==='checkout')return {...marker,checkout:{clientKey:'test_ck_docs_EXAMPLE_ONLY',customerKey:user,orderId:'wn05-'+orderId,orderName:'TEST',amountKrw:8000,currency:'KRW',successUrl:'https://app.test/charging-test/return',failUrl:'https://app.test/charging-test/return'}};}});await app.render();await open(app);await button(app.root,'제공자 TEST 카드 결제창 열기').onclick();assert.equal(app.head.children.length,0);assert.equal(app.sdkRequests.length,0);
});
test('reader and administrator reject refund reasons over the shared 200-character provider limit',async()=>{
 for(const kind of ['reader','admin']){const app=setup(kind,{tab:'refunds',initialOrder:order({status:'PAID',credited:true,refundablePoints:10000,refundAmountKrw:8000})});await app.render();await(kind==='reader'?open(app):choose(app));const input=field(app.root,'환불 사유 (3~200자)');assert.equal(input.maxLength,200);enter(input,'가'.repeat(201));await submit(form(app.root,kind==='reader'?'TEST 미사용분 환불':'TEST 환불 예약'));assert.equal(app.calls.filter(row=>row.action==='refund').length,0);assert.match(app.root.textContent,/200자/);}
});

test('default10000 product requires exact server SKU and explicit selection before any order',async()=>{
 const app=setup('reader',{handler(action,data,{list}){if(action==='products')return list([{...product(),amountKrw:10000,points:10000}]);}});await app.render();assert.match(app.root.textContent,/기본 충전 · 10,000원 → 10,000P/);assert(!form(app.root,'TEST 주문 생성'));assert(!app.calls.some(v=>v.action==='create'));await button(app.root,'기본 10,000원·10,000P 상품 선택').onclick();assert(form(app.root,'TEST 주문 생성'));assert.match(form(app.root,'TEST 주문 생성').textContent,/10,000원 \/ 10,000P/);assert.equal(button(app.root,'확인한 조건으로 TEST 주문 생성').disabled,true);assert(!app.calls.some(v=>v.action==='create'));
});

test('missing or different default SKU never fabricates a product, order or point credit',async()=>{
 for(const products of [[],[{...product(),amountKrw:8000,points:10000}],[{...product(),amountKrw:10000,points:12000}],[{...product(),amountKrw:10000,points:10000,enabled:false}]]){const app=setup('reader',{handler(action,data,{list}){if(action==='products')return list(products);}});await app.render();assert(!button(app.root,'기본 10,000원·10,000P 상품 선택'));assert.match(app.root.textContent,/관리자에게 10,000원·10,000P 기본 상품 등록/);assert(!app.calls.some(v=>['create','confirm','credit'].includes(v.action)));}
});
