import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';

const source=readFileSync(new URL('../public/js/admin/admin-members.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/css/admin-members.css',import.meta.url),'utf8');
const readerId='b1348109-d1a1-402c-a21e-875200c9e0d8',authorId='9007199254740993';
const revision='2:'+'a'.repeat(32),nextRevision='3:'+'b'.repeat(32);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
class Node{
  constructor(tag='div'){this.tag=tag;this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this._text='';this.value='';this.disabled=false;this.hidden=false;this.isConnected=true;}
  set textContent(value){this._text=String(value??'');this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join(' ');}
  set innerHTML(_){assert.fail('Member content must use text nodes');}
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}appendChild(node){this.append(node);return node;}
  replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}
  focus(options){this.focused=true;this.focusOptions=options;}
}
const all=root=>[root,...root.children.flatMap(all)];
const buttons=root=>all(root).filter(node=>node.tag==='button');
const button=(root,text)=>buttons(root).find(node=>node._text===text);
const byField=(root,name)=>{const wrap=all(root).find(node=>node.tag==='label'&&node.children[0]?._text===name);return wrap?.children.find(node=>['input','select','textarea'].includes(node.tag));};
const form=(root,label)=>all(root).find(node=>node.tag==='form'&&node.getAttribute('aria-label')===label);
const submit=node=>node.onsubmit({preventDefault(){}});
const member=(kind,changes={})=>({id:kind==='author'?authorId:readerId,displayName:kind==='author'?'작가 하나':'독자 하나',bio:'공개 소개',status:kind==='author'?'APPROVED':'ACTIVE',createdAt:'2026-10-01T00:00:00Z',lastActivityAt:'2026-11-01T00:00:00Z',authLinked:true,emailConfirmed:true,maskedEmail:'m***@example.test',revision,workCount:2,lastPublishedAt:'2026-10-31T00:00:00Z',pendingRequests:1,settlementState:'PENDING',...changes});
const capabilities=(changes={})=>({canEditPublic:true,canSearchEmail:true,canReadSettlement:true,filters:{work:true,settlement:true,requests:true,activity:true,payments:false,balance:false,orderSearch:false},sources:{},...changes});
function setup({permissions,handler,ready=true}={}){
  let actor={userId:'admin-a',accountServiceReady:ready,admin:{role:permissions?'SUB_ADMIN':'SUPER_ADMIN',permissions:permissions||[],is_active:true}};
  const root=new Node(),calls=[],routes=[];let routeCurrent=true,uuidIndex=0;
  const c={URL,Date,BigInt,console,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++uuidIndex).padStart(12,'0')}`},
    document:{createElement:tag=>new Node(tag)},WebNovelsAuth:{getActor:()=>actor,api:async(url,options)=>{
      const action=new URL(url,'https://app.test').searchParams.get('action'),data=JSON.parse(options.body);calls.push({action,url,options,data});
      if(handler)return handler(action,data,calls.length);
      if(action==='list')return {kind:data.kind,items:[member(data.kind)],offset:data.offset,limit:50,total:1,hasMore:false,nextOffset:null,capabilities:capabilities()};
      if(action==='detail')return {kind:data.kind,member:member(data.kind),works:[{id:'12',title:'발행 작품',type:'NOVEL',status:'COMPLETED',episodeCount:10,lastPublishedAt:'2026-10-31T00:00:00Z'}],requests:[{id:'case-id',kind:'SUPPORT',label:'계정 문의',status:'OPEN',createdAt:'2026-11-01T00:00:00Z'}],history:[],rights:[],finance:{state:'NOT_CONNECTED',paidTotal:null,netPaidTotal:null,paidPoints:null,bonusPoints:null,latestPayment:null},settlement:{state:'PENDING'},capabilities:capabilities()};
      return {saved:true,kind:data.kind,member:member(data.kind,{displayName:data.displayName,bio:data.bio,revision:nextRevision})};
    }}};c.window=c;vm.createContext(c);vm.runInContext(source,c,{filename:'admin-members.js'});
  return {c,root,calls,routes,setActor:next=>actor=next,actor:()=>actor,setCurrent:value=>routeCurrent=value,
    render:(kind='reader',accountId,options={})=>c.AdminMembers.render(root,{kind,accountId,isCurrent:()=>routeCurrent,...options})};
}

test('author and reader tabs call separate server lists and never infer IDs from display names',async()=>{
  const app=setup();await app.render('author');assert.equal(app.calls[0].data.kind,'author');assert.match(app.root.textContent,/작가 검색·상세 관리/);
  assert.equal(byField(app.root,'닉네임·독자 ID 검색'),undefined);assert(byField(app.root,'작품 등록'));assert.match(app.root.textContent,new RegExp(authorId));
  await app.render('reader');assert.equal(app.calls.at(-1).data.kind,'reader');assert(byField(app.root,'닉네임·독자 ID 검색'));assert.equal(byField(app.root,'작품 등록'),undefined);
  assert.doesNotMatch(app.root.textContent,new RegExp(authorId));
});

test('per-kind read permissions and inactive actors deny before issuing any request',async()=>{
  const app=setup({permissions:['CREATOR_MGMT']});await app.render('reader');assert.equal(app.calls.length,0);assert.match(app.root.textContent,/권한/);
  await app.render('author');assert.equal(app.calls.length,1);assert.equal(all(app.root).some(node=>node.tag==='details'),false);
  app.setActor({...app.actor(),admin:{role:'SUPER_ADMIN',is_active:false}});await app.render('author');assert.equal(app.calls.length,1);
});

test('search and filters are sent as POST JSON, preserve their own tab state, and never enter URL/storage',async()=>{
  const app=setup();await app.render('author');byField(app.root,'필명·작가 ID 검색').value='writer@example.test';byField(app.root,'작품 등록').value='YES';byField(app.root,'계정 상태').value='APPROVED';
  await submit(form(app.root,'작가 검색 조건'));assert.equal(app.calls.at(-1).data.q,'writer@example.test');assert.equal(app.calls.at(-1).data.hasWorks,'YES');
  app.c.AdminMembers.leave();await app.render('reader');assert.equal(byField(app.root,'닉네임·독자 ID 검색').value,'');byField(app.root,'닉네임·독자 ID 검색').value='다른 독자';await submit(form(app.root,'독자 검색 조건'));
  await app.render('author');assert.equal(byField(app.root,'필명·작가 ID 검색').value,'writer@example.test');assert.equal(byField(app.root,'작품 등록').value,'YES');
  assert(app.calls.every(call=>call.options.method==='POST'&&!call.url.includes('writer')&&!call.url.includes('%40')));
  assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB|(?:window\.)?history\.(?:pushState|replaceState)|(?:window\.)?location\./);
});

test('server pagination reaches records beyond the first 50 and keeps server filter values',async()=>{
  const app=setup({handler:(action,data)=>({kind:data.kind,items:[member(data.kind,{displayName:data.offset?'51번째 독자':'첫 독자'})],offset:data.offset,limit:50,total:51,hasMore:data.offset===0,nextOffset:data.offset===0?50:null,capabilities:capabilities()})});
  await app.render();byField(app.root,'닉네임·독자 ID 검색').value='독자';byField(app.root,'계정 연결').value='LINKED';await submit(form(app.root,'독자 검색 조건'));
  await button(app.root,'다음 페이지').onclick();assert.equal(app.calls.at(-1).data.offset,50);assert.equal(app.calls.at(-1).data.q,'독자');assert.equal(app.calls.at(-1).data.linked,'LINKED');assert.match(app.root.textContent,/51번째 독자/);
  assert(all(app.root).some(node=>node.className==='admin-members'&&node.focused),'pagination retains focus in the labelled workspace');
  await button(app.root,'이전 페이지').onclick();assert.equal(app.calls.at(-1).data.offset,0);
});

test('date validation and reset filter actions do not silently mix list states',async()=>{
  const app=setup();await app.render();byField(app.root,'가입일 시작').value='2026-11-02';byField(app.root,'가입일 종료').value='2026-11-01';
  await submit(form(app.root,'독자 검색 조건'));assert.equal(app.calls.length,1);assert.match(app.root.textContent,/가입일 범위/);
  await button(app.root,'조건 초기화').onclick();assert.equal(app.calls.at(-1).data.createdFrom,'');assert.equal(app.calls.at(-1).data.createdTo,'');
});

test('unavailable filters stay disabled and financial data is explicitly unaggregated',async()=>{
  const app=setup({handler:(_action,data)=>({kind:data.kind,items:[member(data.kind)],offset:0,limit:50,total:1,hasMore:false,capabilities:capabilities({canReadSettlement:false,filters:{activity:false,requests:false,work:false,settlement:false}})})});
  await app.render('author');assert.equal(byField(app.root,'작품 등록').disabled,true);assert.equal(byField(app.root,'정산 준비').disabled,true);assert.equal(byField(app.root,'최근 활동').disabled,true);
  await app.render('reader');assert.equal(byField(app.root,'결제·포인트 필터').disabled,true);assert.match(app.root.textContent,/미집계/);assert.doesNotMatch(app.root.textContent,/잔액[:：]\s*0|유료 독자[:：]\s*0/);
});

test('author and reader details have different domain sections and keep IDs precise',async()=>{
  const app=setup();await app.render('author',authorId);assert(app.calls.some(call=>call.action==='detail'&&call.data.accountId===authorId));
  const headings=all(app.root).filter(node=>node.tag==='h4').map(node=>node._text);assert.deepEqual(headings,['기본 정보','작품','정산','요청·이력']);
  assert.match(app.root.textContent,/서류 확인 대기/);assert.match(app.root.textContent,/PASS 인증·은행 예금주 확인·지급 완료를 뜻하지/);assert(!all(app.root).some(node=>node.tag==='a'&&node.href.includes('case-id')));
  await app.render('reader',readerId);assert.deepEqual(all(app.root).filter(node=>node.tag==='h4').map(node=>node._text),['계정','결제·포인트','구매·열람권','요청·이력']);
  assert.match(app.root.textContent,/구매 이력 없음으로 판정하지/);assert.doesNotMatch(app.root.textContent,/출금 가능액/);
});

test('member row and close actions navigate with kind and profile ID only',async()=>{
  const app=setup(),routes=[];await app.render('author',undefined,{onNavigate:route=>routes.push(route)});await button(app.root,'작가 하나').onclick();assert.equal(routes[0].kind,'author');assert.equal(routes[0].accountId,authorId);
  await app.render('reader',readerId,{onNavigate:route=>routes.push(route)});await button(app.root,'상세 닫기').onclick();assert.equal(routes.at(-1).kind,'reader');assert.equal(routes.at(-1).accountId,undefined);
});

test('kind mismatch, invalid IDs and malformed revision responses fail without mixed records',async()=>{
  const app=setup({handler:(_action,data)=>({kind:'author',items:[member('author')],capabilities:capabilities()})});await app.render('reader');assert.match(app.root.textContent,/결과를 확인하지/);assert.doesNotMatch(app.root.textContent,/작가 하나/);
  const invalid=setup();await invalid.render('reader','invalid-reader-id');assert.equal(invalid.calls.length,0);assert.match(invalid.root.textContent,/회원 ID 형식/);
  const bad=setup({handler:(_action,data)=>({kind:data.kind,items:[member(data.kind,{revision:'untrusted'})],capabilities:capabilities()})});await bad.render();assert.match(bad.root.textContent,/결과를 확인하지/);
});

test('legacy positive decimal reader IDs survive list, detail and edit while author UUIDs stay invalid',async()=>{
  const app=setup({handler:(action,data)=>{
    const item=member('reader',{id:'43',displayName:action==='update-profile'?data.displayName:'기존 독자',revision:action==='update-profile'?nextRevision:revision});
    if(action==='list')return {kind:'reader',items:[item],offset:0,limit:50,total:1,hasMore:false,capabilities:capabilities()};
    if(action==='detail')return {kind:'reader',member:item,works:[],requests:[],history:[],rights:[],finance:{state:'NOT_CONNECTED'},capabilities:capabilities()};
    return {saved:true,kind:'reader',member:item};
  }});
  await app.render('reader','43');assert.match(app.root.textContent,/기존 독자/);assert.equal(app.calls.find(call=>call.action==='detail').data.accountId,'43');
  byField(app.root,'닉네임 (2~40자)').value='수정한 기존 독자';byField(app.root,'수정 사유 (3~500자)').value='기존 계정 요청 확인';
  await submit(all(app.root).find(node=>node.className==='members-edit-form'));const write=app.calls.find(call=>call.action==='update-profile');assert.equal(write.data.accountId,'43');assert.equal(write.data.kind,'reader');assert.match(app.root.textContent,/저장 완료/);
  const invalid=setup();await invalid.render('author',readerId);assert.equal(invalid.calls.length,0);assert.match(invalid.root.textContent,/회원 ID 형식/);
  for(const id of ['0','01','-1','1.0','1e2','9223372036854775808'])await invalid.render('reader',id);
  assert.equal(invalid.calls.length,0);
});

test('uppercase reader UUID detail routes are normalized before requesting',async()=>{
  const app=setup();await app.render('reader',readerId.toUpperCase());assert.equal(app.calls.find(call=>call.action==='detail').data.accountId,readerId);assert.match(app.root.textContent,/독자 하나 · 독자 상세/);
});

test('user text is literal and an accidental unmasked email is never displayed',async()=>{
  const text='<img src=x onerror=alert(1)>',app=setup({handler:(_action,data)=>({kind:data.kind,items:[member(data.kind,{displayName:text,maskedEmail:'private@example.test'})],offset:0,limit:50,total:1,hasMore:false,capabilities:capabilities()})});
  await app.render();assert.match(app.root.textContent,/<img src=x onerror=alert\(1\)>/);assert.equal(all(app.root).some(node=>node.tag==='img'),false);assert.doesNotMatch(app.root.textContent,/private@example/);
});

test('late list/detail responses cannot restore a departed or changed account workspace',async()=>{
  for(const mode of ['leave','reset','actor','permission','route']){
    const late=deferred(),app=setup({handler:()=>late.promise}),pending=app.render();
    if(mode==='leave')app.c.AdminMembers.leave();if(mode==='reset')app.c.AdminMembers.reset();if(mode==='actor')app.setActor({userId:'other',admin:{role:'SUPER_ADMIN'}});if(mode==='permission')app.setActor({...app.actor(),admin:{role:'SUB_ADMIN',permissions:[]}});if(mode==='route')app.setCurrent(false);
    late.resolve({kind:'reader',items:[member('reader')],offset:0,limit:50,total:1,hasMore:false,capabilities:capabilities()});await pending;assert.doesNotMatch(app.root.textContent,/독자 하나/);
  }
  const late=deferred(),app=setup({handler:(action,data)=>action==='list'?{kind:data.kind,items:[member(data.kind)],offset:0,limit:50,total:1,hasMore:false,capabilities:capabilities()}:late.promise}),pending=app.render('reader',readerId);
  await Promise.resolve();await Promise.resolve();app.c.AdminMembers.reset();late.resolve({kind:'reader',member:member('reader'),capabilities:capabilities()});await pending;assert.equal(app.root.children.length,0);
});

test('reset clears private DOM and owner filter memory; leave only retains same-owner filters',async()=>{
  const app=setup();await app.render();const input=byField(app.root,'닉네임·독자 ID 검색');input.value='reader@example.test';await submit(form(app.root,'독자 검색 조건'));
  const old=byField(app.root,'닉네임·독자 ID 검색');app.c.AdminMembers.reset();assert.equal(old.value,'');assert.equal(app.root.children.length,0);
  await app.render();assert.equal(byField(app.root,'닉네임·독자 ID 검색').value,'');
});

test('public profile edits require SUPER plus capability and keep reader bio absent',async()=>{
  const restricted=setup({permissions:['ACCOUNTS_READ','ACCOUNT_MODERATE']});await restricted.render('reader',readerId);assert.equal(all(restricted.root).some(node=>node.tag==='summary'),false);
  const app=setup();await app.render('reader',readerId);assert.equal(byField(app.root,'공개 소개 (최대 2,000자)'),undefined);
  byField(app.root,'닉네임 (2~40자)').value='수정 독자';byField(app.root,'수정 사유 (3~500자)').value='본인 요청 확인';const edit=all(app.root).find(node=>node.className==='members-edit-form');await submit(edit);
  const write=app.calls.find(call=>call.action==='update-profile');assert.equal(write.data.accountId,readerId);assert.equal(write.data.kind,'reader');assert.equal(write.data.bio,undefined);assert.equal(write.data.revision,revision);assert.match(write.data.requestId,/^[0-9a-f-]{36}$/);assert.equal(write.data.reason,'본인 요청 확인');assert.match(app.root.textContent,/저장하고 이력을 기록/);
});

test('invalid public names and reasons do not reach profile mutation',async()=>{
  const app=setup();await app.render('author',authorId);const edit=all(app.root).find(node=>node.className==='members-edit-form');
  byField(app.root,'필명 (2~40자)').value='<name>';byField(app.root,'수정 사유 (3~500자)').value='사유 확인';await submit(edit);assert.equal(app.calls.filter(call=>call.action==='update-profile').length,0);
  byField(app.root,'필명 (2~40자)').value='작가 수정';byField(app.root,'수정 사유 (3~500자)').value='짧';await submit(edit);assert.equal(app.calls.filter(call=>call.action==='update-profile').length,0);
});

test('conflict preserves typed fields until an explicit latest-detail reload',async()=>{
  const app=setup();const original=app.c.WebNovelsAuth.api;app.c.WebNovelsAuth.api=async(url,options)=>url.includes('update-profile')?Promise.reject({status:409,code:'CONFLICT'}):original(url,options);
  await app.render('author',authorId);const name=byField(app.root,'필명 (2~40자)'),bio=byField(app.root,'공개 소개 (최대 2,000자)'),reason=byField(app.root,'수정 사유 (3~500자)');name.value='보존할 필명';bio.value='보존할 소개';reason.value='확인한 요청';
  await submit(all(app.root).find(node=>node.className==='members-edit-form'));assert.equal(name.value,'보존할 필명');assert.equal(bio.value,'보존할 소개');assert.equal(name.disabled,true);assert.match(app.root.textContent,/충돌/);assert(button(app.root,'최신 상세 불러오기'));
});

test('an unknown outcome retries the exact request body and key across reopening',async()=>{
  const app=setup(),original=app.c.WebNovelsAuth.api,writes=[];let fail=true;
  app.c.WebNovelsAuth.api=async(url,options)=>{if(!url.includes('update-profile'))return original(url,options);writes.push(options.body);if(fail)throw Error('NETWORK');const data=JSON.parse(options.body);return {saved:true,kind:data.kind,member:member(data.kind,{displayName:data.displayName,revision:nextRevision})};};
  await app.render('author',authorId);byField(app.root,'필명 (2~40자)').value='보존할 필명';byField(app.root,'수정 사유 (3~500자)').value='확인된 변경';
  await submit(all(app.root).find(node=>node.className==='members-edit-form'));assert.match(app.root.textContent,/저장 결과를 확인하지/);assert.equal(byField(app.root,'필명 (2~40자)').disabled,true);
  app.c.AdminMembers.leave();await app.render('author',authorId);assert.equal(byField(app.root,'필명 (2~40자)').value,'보존할 필명');fail=false;await submit(all(app.root).find(node=>node.className==='members-edit-form'));assert.equal(writes[0],writes[1]);assert.match(app.root.textContent,/저장 완료/);
});

test('detached edit and search controls cannot mutate after reset',async()=>{
  const app=setup();await app.render('author',authorId);const edit=all(app.root).find(node=>node.className==='members-edit-form'),search=form(app.root,'작가 검색 조건');app.c.AdminMembers.reset();
  await submit(edit);await submit(search);assert.equal(app.calls.length,2);assert.equal(app.root.children.length,0);
});

test('public history shows name changes without copying biography or unrelated payloads',async()=>{
  const app=setup(),original=app.c.WebNovelsAuth.api;app.c.WebNovelsAuth.api=async(url,options)=>{
    const result=await original(url,options);if(url.includes('action=detail')){result.capabilities.canEditPublic=false;result.history=[{createdAt:'2026-11-01T00:00:00Z',reason:'본인 요청',before:{displayName:'이전 필명',bio:'OLD_BIO_PAYLOAD'},after:{displayName:'새 필명',bio:'NEW_BIO_PAYLOAD'},privatePayload:'DO_NOT_RENDER'}];}return result;
  };
  await app.render('author',authorId);assert.match(app.root.textContent,/이전 필명 → 새 필명/);assert.match(app.root.textContent,/본인 요청/);assert.doesNotMatch(app.root.textContent,/OLD_BIO_PAYLOAD|NEW_BIO_PAYLOAD|DO_NOT_RENDER/);
  assert.equal(all(app.root).some(node=>node.tag==='summary'&&node._text==='공개 정보 수정'),false);
});

test('late successful profile save cannot repopulate a reset workspace',async()=>{
  const app=setup(),original=app.c.WebNovelsAuth.api,late=deferred();app.c.WebNovelsAuth.api=async(url,options)=>url.includes('update-profile')?late.promise:original(url,options);
  await app.render('author',authorId);byField(app.root,'필명 (2~40자)').value='새로운 필명';byField(app.root,'수정 사유 (3~500자)').value='변경 요청 확인';
  const pending=submit(all(app.root).find(node=>node.className==='members-edit-form'));app.c.AdminMembers.reset();late.resolve({saved:true,kind:'author',member:member('author',{revision:nextRevision})});await pending;
  assert.equal(app.root.children.length,0);
});

test('empty, failed and retried loads remain distinguishable',async()=>{
  let fail=true;const app=setup({handler:(_action,data)=>{if(fail)throw {code:'MEMBERS_NOT_READY'};return {kind:data.kind,items:[],offset:0,limit:50,total:0,hasMore:false,capabilities:capabilities()};}});
  await app.render();assert.match(app.root.textContent,/연결을 준비/);assert.doesNotMatch(app.root.textContent,/맞는 독자가 없습니다/);fail=false;await button(app.root,'다시 불러오기').onclick();assert.match(app.root.textContent,/맞는 독자가 없습니다/);
});

test('only an unavailable member list invokes the optional compatibility fallback once',async()=>{
  for(const [code,status]of [['ACCOUNT_SERVICE_NOT_ACTIVATED',503],['MEMBERS_NOT_READY',503],['MEMBER_SERVICE_UNAVAILABLE',503],['MEMBERS_NOT_READY',undefined]]){
    const app=setup({handler:()=>{throw {code,status};}});let fallback=0;await app.render('reader',undefined,{onUnavailable:()=>{fallback++;app.root.textContent='기존 독자 목록';}});
    assert.equal(fallback,1,code);assert.equal(app.root.textContent,'기존 독자 목록');
  }
  for(const error of [{code:'MEMBERS_NOT_READY',status:403},{code:'MEMBERS_NOT_READY',status:401},{code:'MEMBERS_NOT_READY',status:400},{code:'MEMBERS_NOT_READY',status:409},{code:'MEMBERS_NOT_READY',status:500},{code:'INVALID_INPUT',status:503}]){
    const app=setup({handler:()=>{throw error;}});let fallback=0;await app.render('reader',undefined,{onUnavailable:()=>fallback++});assert.equal(fallback,0);assert(button(app.root,'다시 불러오기'));
  }
});

test('stale or detail-only unavailable responses never invoke compatibility fallback',async()=>{
  const late=deferred(),app=setup({handler:()=>late.promise});let fallback=0;const pending=app.render('reader',undefined,{onUnavailable:()=>fallback++});app.c.AdminMembers.leave();late.reject({code:'MEMBERS_NOT_READY',status:503});await pending;assert.equal(fallback,0);assert.equal(app.root.children.length,0);
  const detailApp=setup(),original=detailApp.c.WebNovelsAuth.api;detailApp.c.WebNovelsAuth.api=async(url,options)=>url.includes('action=detail')?Promise.reject({code:'MEMBER_SERVICE_UNAVAILABLE',status:503}):original(url,options);
  await detailApp.render('reader',readerId,{onUnavailable:()=>fallback++});assert.equal(fallback,0);assert(button(detailApp.root,'상세 다시 불러오기'));
});

test('internal search, reset, reload and paging retain the unavailable callback',async()=>{
  for(const action of ['reload','search','reset','next','previous']){
    let lists=0,fallback=0;const app=setup({handler:(_action,data)=>{
      if(++lists===(action==='previous'?3:2))throw {code:'MEMBERS_NOT_READY',status:503};
      return {kind:data.kind,items:[member(data.kind)],offset:data.offset,limit:50,total:100,hasMore:data.offset===0,nextOffset:data.offset===0?50:null,capabilities:capabilities()};
    }});
    await app.render('reader',undefined,{onUnavailable:()=>fallback++});
    if(action==='reload')await button(app.root,'새로고침').onclick();
    if(action==='search')await submit(form(app.root,'독자 검색 조건'));
    if(action==='reset')await button(app.root,'조건 초기화').onclick();
    if(action==='next')await button(app.root,'다음 페이지').onclick();
    if(action==='previous'){await button(app.root,'다음 페이지').onclick();await button(app.root,'이전 페이지').onclick();}
    assert.equal(fallback,1,action);
  }
});

test('native forms have labels, status regions, table semantics and detail focus',async()=>{
  const app=setup();await app.render('author',authorId);const nodes=all(app.root);
  assert(nodes.filter(node=>['input','select','textarea'].includes(node.tag)).every(node=>node.parentNode.tag==='label'));
  assert(nodes.filter(node=>node.tag==='th').every(node=>node.scope==='col'));assert(nodes.some(node=>node.tag==='caption'));
  assert(nodes.some(node=>node.getAttribute('role')==='status'&&node.getAttribute('aria-live')==='polite'));
  assert(nodes.some(node=>node.className==='members-detail'&&node.focused&&node.getAttribute('tabindex')==='-1'));
  assert(nodes.filter(node=>node.tag==='form').every(node=>{let at=node.parentNode;while(at){if(at.tag==='form')return false;at=at.parentNode;}return true;}));
});

test('member stylesheet parses, remains scoped and preserves keyboard/mobile access',async()=>{
  const result=await transform(css,{loader:'css'});assert.deepEqual(result.warnings,[]);
  for(const [,selector]of css.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{[^{}]*\}/g)){if(selector.trim().startsWith('@'))continue;assert(selector.trim().startsWith('#view-admin-cms '),selector);}
  assert.match(css,/min-height:\s*44px/);assert.match(css,/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--border-focus\)/);
  assert.match(css,/@media \(max-width: 600px\)/);assert.match(css,/overflow-x:\s*auto/);assert.doesNotMatch(css,/@import|url\(|@font-face|position:\s*fixed|#[0-9a-f]{3,6}\b/i);
});
