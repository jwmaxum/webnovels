import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {parseFragment} from 'parse5';
import {randomUUID} from 'node:crypto';

const source=await readFile(new URL('../public/js/creator/creator-settlement.js',import.meta.url),'utf8');
const dashboard=await readFile(new URL('../public/js/creator/creator-dashboard.js',import.meta.url),'utf8');
const fileImage=await readFile(new URL('../public/js/creator/file-image.js',import.meta.url),'utf8');
const gate=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {resolve,promise};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const initial={enabled:true,collectionEnabled:true,policy:{version:'settlement-v1',hash:'a'.repeat(64),privacyText:'정산 준비의 개인정보 처리 안내',retentionText:'검토 후 첨부 삭제',redactionText:'불필요한 번호 가림',taxText:'주민등록번호는 실제 세무 대상 확정 후 별도 수집',transferNoticeVersion:'transfer-v1',transferNoticeHash:'b'.repeat(64),transferNoticeText:'보관 국가·처리자 안내'},application:null,taxCollectionEnabled:false};
function fixture(){
 const paint=[],revoked=[],urls=[],calls=[],bitmaps=[];let actor={userId:'owner-a',author:{id:'9007199254740993',status:'APPROVED'},authorWorkspaceReady:true},response=async()=>({application:{revision:'1',status:'PENDING'}}),decode=null;
 class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.attrs=new Map();this.style={};this.dataset={};this.value='';this.hidden=false;this.disabled=false;this.checked=false;this.isConnected=true;this.classList={toggle(){},add(){},remove(){}};}
  set textContent(value){this.text=String(value??'');this.children=[];}get textContent(){return (this.text||'')+this.children.map(child=>child.textContent).join('');}
  append(...items){for(const child of items){this.children.push(child);child.parentNode=this;}}
  replaceChildren(...items){this.text='';this.children=[];this.append(...items);}
  setAttribute(name,value){this.attrs.set(name,String(value));if(name==='id')this.id=String(value);if(name==='name')this.name=String(value);}
  getAttribute(name){return this.attrs.get(name)??this[name]??null;}
  removeAttribute(name){this.attrs.delete(name);delete this[name];}
  focus(){this.focused=true;}
  get elements(){return Object.fromEntries(all(this).filter(el=>el.name).map(el=>[el.name,el]));}
  checkValidity(){return all(this).filter(el=>el.required).every(el=>el.type==='checkbox'?el.checked:!!el.value);}
  reportValidity(){this.reported=true;}
  querySelectorAll(selector){const match=el=>selector.startsWith('#')?el.id===selector.slice(1):selector.startsWith('.')?String(el.className||'').split(' ').includes(selector.slice(1)):el.tagName===selector;return all(this).filter(match);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  set innerHTML(html){this.html=html;this.replaceChildren();const convert=ast=>{const el=new Element(ast.tagName||'#text');for(const attr of ast.attrs||[])el.setAttribute(attr.name,attr.value);if(ast.nodeName==='#text')el.textContent=ast.value;else el.append(...(ast.childNodes||[]).map(convert));return el;};this.append(...parseFragment(html).childNodes.map(convert));}
  get innerHTML(){return this.html||'';}
  getContext(){return {set fillStyle(value){paint.push({color:value});},fillRect:(...args)=>paint.push({rect:args}),drawImage:(...args)=>paint.push({draw:args})};}
  toBlob(callback,type){callback(new Blob(['FLATTENED_JPEG'],{type}));}
  getBoundingClientRect(){return {left:0,top:0,width:this.width,height:this.height};}
  setPointerCapture(){}
 }
 const all=node=>node.children.flatMap(child=>[child,...all(child)]),root=new Element(),nodes=new Map(['creatorHomeContent','creatorEarningsContent','creatorProfileContent','creatorBankInfo'].map(id=>[id,new Element()]));
 const context={URL:{createObjectURL:blob=>{const url='blob:preview-'+urls.length;urls.push({url,blob});return url;},revokeObjectURL:url=>revoked.push(url)},crypto:{randomUUID},Blob,Uint8Array,DataView,btoa,atob,Number,Object,String,Date,Math,
 document:{createElement:tag=>new Element(tag),getElementById:id=>nodes.get(id)||root.querySelector('#'+id)},WEBNOVELS_CONFIG:{freeBetaEnabled:true},
 WebNovelsAuth:{getActor:()=>actor,api:async(path,options)=>{const record={path,options,body:options?.body?JSON.parse(options.body):null};calls.push(record);return response(record);}},
 createImageBitmap:async()=>{if(decode)return decode.promise;const bitmap={width:800,height:400,close(){this.closed=true;}};bitmaps.push(bitmap);return bitmap;},confirm:()=>true};
 context.window=context;vm.createContext(context);vm.runInContext(fileImage,context);vm.runInContext(source,context);
 const mount=state=>context.CreatorSettlement.mount(root,{initial:state??structuredClone(initial)});
 const named=name=>all(root).find(el=>el.name===name),find=(tag,title)=>all(root).find(el=>el.tagName===tag&&el.textContent===title),sections=()=>all(root).filter(el=>el.className==='settlement-image-editor').sort((a,b)=>Number(!a.querySelector('h4').textContent.includes('신분증'))-Number(!b.querySelector('h4').textContent.includes('신분증')));
 const png=new Uint8Array(32);png.set([137,80,78,71,13,10,26,10],0);new DataView(png.buffer).setUint32(12,0x49484452);new DataView(png.buffer).setUint32(16,800);new DataView(png.buffer).setUint32(20,400);
 const file=(extra={})=>({type:'image/png',size:png.length,arrayBuffer:async()=>png.buffer,...extra});
 async function prepare(index=0){const section=sections()[index],input=all(section).find(el=>el.type==='file');input.files=[file()];await input.onchange();await all(section).find(el=>el.tagName==='button'&&el.textContent==='전체 가리기').onclick();await all(section).find(el=>el.tagName==='button'&&el.textContent==='가린 이미지 확정').onclick();return section;}
 const populate=()=>{for(const [name,value]of Object.entries({legalName:'실명 테스트',birthDate:'1990-01-01',postalCode:'12345',address:'서울시 테스트 주소',addressDetail:'',password:'current-secret'}))named(name).value=value;const checks=all(root).filter(el=>el.type==='checkbox');checks.forEach(el=>el.checked=true);};
 const submit=()=>root.querySelector('form').onsubmit({preventDefault(){}});
 return {context,root,nodes,calls,urls,revoked,paint,bitmaps,all,mount,named,find,sections,prepare,populate,submit,file,setResponse:value=>response=value,setActor:value=>actor=value,setDecode:value=>decode=value};
}

test('settlement wizard is gated by authenticated server readiness and never creates a resident-number input',async()=>{
 const f=fixture();await f.mount({enabled:false});assert.equal(f.root.querySelector('form'),null);assert.match(f.root.textContent,/준비 중/);
 await f.mount();assert.match(f.root.textContent,/PASS 인증·은행 예금주 검증/);assert.match(f.root.textContent,/주민등록번호.*별도 수집/);
 assert.equal(f.all(f.root).some(el=>el.name&&/rrn|resident|national/i.test(el.name)),false);assert.equal(f.named('legalName').autocomplete,'off');assert.deepEqual(f.calls,[]);
});

test('individual application uploads only the explicitly flattened image and clears sensitive form controls on success',async()=>{
 const f=fixture();await f.mount();await f.prepare();f.populate();await f.submit();
 const sent=f.calls[0];assert.equal(sent.path,'/api/v2/creator/settlement');assert.equal(sent.body.applicantType,'INDIVIDUAL');assert.equal(sent.body.identityImage.data,btoa('FLATTENED_JPEG'));assert.equal(sent.body.identityImage.mime,'image/jpeg');assert.equal(sent.body.businessImage,null);
 assert.equal(sent.body.policyVersion,initial.policy.version);assert.equal(sent.body.policyHash,initial.policy.hash);assert.equal(sent.body.privacyConsent,true);assert.equal(sent.body.redactionConfirmed,true);assert.match(sent.options.headers['Idempotency-Key'],/^[0-9a-f-]{36}$/);
 assert.equal(f.named('password').value,'');assert.equal(f.named('legalName').value,'');assert.equal(f.sections()[0].querySelector('canvas').width,1);assert.deepEqual(f.revoked,['blob:preview-0']);assert.match(f.root.textContent,/서류 확인 대기/);
 assert.doesNotMatch(JSON.stringify(sent.body),/authorId|auth_user_id|rrn|residentNumber/);
});

test('raw attachment and unconfirmed redaction cannot be submitted',async()=>{
 const f=fixture();await f.mount();f.populate();await f.submit();assert.equal(f.calls.length,0);
 const section=f.sections()[0],input=f.all(section).find(el=>el.type==='file');input.files=[f.file()];await input.onchange();await f.all(section).find(el=>el.textContent==='가린 이미지 확정'&&el.tagName==='button').onclick();await f.submit();
 assert.equal(f.calls.length,0);assert.match(f.root.textContent,/가리고 이미지를 확정/);
});

test('business and corporate applicants require registration data and a separate redacted certificate',async()=>{
 for(const kind of ['SOLE_PROPRIETOR','CORPORATION']){
  const f=fixture();await f.mount();f.named('applicantType').value=kind;f.named('applicantType').onchange();assert.equal(f.named('companyName').required,true);assert.equal(f.named('businessNumber').required,true);
  await f.prepare();f.populate();f.named('companyName').value='테스트 회사';f.named('businessNumber').value='1234567890';await f.submit();assert.equal(f.calls.length,0);
  await f.prepare(1);f.named('password').value='current-secret';await f.submit();assert.equal(f.calls[0].body.applicantType,kind);assert.equal(f.calls[0].body.companyName,'테스트 회사');assert.ok(f.calls[0].body.businessImage);
 }
});

test('lost response freezes logical input and retries the exact key and document payload with fresh reauthentication',async()=>{
 const f=fixture();await f.mount();await f.prepare();f.populate();let tries=0;f.setResponse(async()=>{if(!tries++)throw Error('NETWORK');return {application:{revision:'1',status:'PENDING'}};});await f.submit();
 assert.equal(f.root.querySelector('fieldset').disabled,true);assert.equal(f.named('password').value,'');assert.equal(f.find('button','동일 신청 결과 다시 확인')?.disabled,false);
 f.named('legalName').value='programmatic change';f.named('password').value='new-secret';await f.submit();assert.equal(f.calls.length,2);assert.equal(f.calls[1].body.legalName,'실명 테스트');
 assert.equal(f.calls[0].options.headers['Idempotency-Key'],f.calls[1].options.headers['Idempotency-Key']);const withoutPassword=body=>{const {password,...value}=body;return value;};assert.deepEqual(withoutPassword(f.calls[0].body),withoutPassword(f.calls[1].body));assert.equal(f.calls[1].body.password,'new-secret');
});

test('rejected consent and changed author callbacks never send private content',async()=>{
 const f=fixture();await f.mount();await f.prepare();f.populate();f.all(f.root).find(el=>el.type==='checkbox').checked=false;await f.submit();assert.equal(f.calls.length,0);
 f.all(f.root).find(el=>el.type==='checkbox').checked=true;f.setActor({userId:'other',author:{status:'APPROVED'}});await f.submit();assert.equal(f.calls.length,0);
});

test('reset revokes derivative preview URLs, clears private input, closes local bitmap, and ignores a late submit response',async()=>{
 const f=fixture();await f.mount();await f.prepare();f.populate();const pending=gate();f.setResponse(()=>pending.promise);const sending=f.submit();await tick();f.context.CreatorSettlement.reset();
 assert.equal(f.root.children.length,0);assert.deepEqual(f.revoked,['blob:preview-0']);assert.equal(f.bitmaps[0].closed,true);pending.resolve({application:{revision:'1',status:'APPROVED'}});await sending;assert.equal(f.root.children.length,0);
});

test('late image decode after cancel/reset closes the bitmap without exposing the original',async()=>{
 const f=fixture();await f.mount();const pending=gate();f.setDecode(pending);const section=f.sections()[0],input=f.all(section).find(el=>el.type==='file');input.files=[f.file()];const opening=input.onchange();await tick();f.context.CreatorSettlement.reset();const bitmap={width:800,height:400,close(){this.closed=true;}};pending.resolve(bitmap);await opening;
 assert.equal(bitmap.closed,true);assert.equal(f.urls.length,0);assert.equal(f.calls.length,0);assert.equal(f.root.children.length,0);
});

test('image type, size and pixel limits are enforced before decoding or submission',async()=>{
 for(const invalid of [{type:'image/svg+xml'},{size:11*1024*1024},{arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}]){
  const f=fixture();await f.mount();const section=f.sections()[0],input=f.all(section).find(el=>el.type==='file');input.files=[f.file(invalid)];await input.onchange();assert.equal(f.bitmaps.length,0);assert.equal(f.urls.length,0);assert.equal(f.calls.length,0);
 }
});

test('keyboard coordinates paint a black rectangle and any new mask invalidates the prior derivative',async()=>{
 const f=fixture();await f.mount();await f.prepare();const section=f.sections()[0],inputs=f.all(section).filter(el=>el.type==='number');inputs.forEach((input,i)=>input.value=['10','20','30','40'][i]);
 await f.all(section).find(el=>el.tagName==='button'&&el.textContent==='입력한 영역 가리기').onclick();assert.deepEqual(f.revoked,['blob:preview-0']);assert.ok(f.paint.some(item=>item.color==='#000'));assert.ok(f.paint.some(item=>JSON.stringify(item.rect)==='[80,80,240,160]'));
 f.populate();await f.submit();assert.equal(f.calls.length,0,'changed masking requires an explicit new derivative confirmation');
});

test('withdrawal retries the same revision and key after a lost response and clears documents on completion',async()=>{
 const f=fixture();await f.mount({...initial,application:{revision:'7',status:'PENDING'}});f.named('password').value='one';let tries=0;f.setResponse(async()=>{if(!tries++)throw Error('NETWORK');return {application:{revision:'8',status:'WITHDRAWN'}};});const withdraw=f.find('button','정산 본인 정보 철회·삭제');await withdraw.onclick();
 assert.equal(f.named('password').value,'');f.named('password').value='two';await withdraw.onclick();assert.equal(f.calls.length,2);assert.equal(f.calls[0].path,'/api/v2/creator/settlement/withdraw');assert.equal(f.calls[0].options.headers['Idempotency-Key'],f.calls[1].options.headers['Idempotency-Key']);assert.equal(f.calls[1].body.revision,'7');assert.equal(withdraw.hidden,true);assert.match(f.root.textContent,/철회/);
});

test('masked bank status refresh belongs only to the original approved author',async()=>{
 const f=fixture(),pending=gate();f.setResponse(()=>pending.promise);const updating=f.context.CreatorSettlement.refreshSummary();f.setActor({userId:'other',author:{status:'APPROVED'}});pending.resolve({bankRegistered:true});await updating;assert.equal(f.nodes.get('creatorBankInfo').textContent,'확인 중');
 f.setResponse(async()=>({bankRegistered:true}));await f.context.CreatorSettlement.refreshSummary();assert.equal(f.nodes.get('creatorBankInfo').textContent,'등록 · 계좌 확인 대기');
});

test('profile enables beta bank registration only after authenticated capability and submits current policy consent',async()=>{
 const f=fixture();vm.runInContext(dashboard,f.context);f.setResponse(async call=>{
  if(call.path.endsWith('action=profile'))return {profile:{email:'author@example.test',penName:'작가',bio:'',version:'a'.repeat(32)},bank:null};
  if(call.path==='/api/v2/creator/settlement')return structuredClone(initial);
  if(call.path.endsWith('action=save-bank'))return {bank:{revision:'1',bankName:'은행',holder:'명의',maskedNumber:'**** 5678'}};
  return {};
 });
 await f.context.CreatorDashboard.profile();const root=f.nodes.get('creatorProfileContent'),bank=root.querySelector('#adBankForm');assert.equal(bank.hidden,false);assert.equal(bank.dataset.settlementRegistration,'true');
 for(const [name,value]of Object.entries({bankName:'테스트 은행',holder:'계좌 명의',accountNumber:'12345678',password:'current-secret'}))bank.elements[name].value=value;bank.elements.consent.checked=true;bank.elements.transferConsent.checked=true;await bank.onsubmit({preventDefault(){}});
 const sent=f.calls.find(call=>call.path.endsWith('action=save-bank'));assert.equal(sent.body.consent,true);assert.equal(sent.body.policyHash,initial.policy.hash);assert.equal(bank.elements.password.value,'');assert.equal(bank.elements.accountNumber.value,'');assert.equal(f.nodes.get('creatorBankInfo').textContent,'등록 · 계좌 확인 대기');
 f.context.CreatorDashboard.reset();assert.equal(root.children.length,0);
});

test('unreviewed or missing collection readiness disables every new private input and never decodes or submits a file',async()=>{
 for(const state of [{...initial,collectionEnabled:false},{...initial,collectionEnabled:undefined}]){
  const f=fixture();await f.mount(state);assert.equal(f.root.querySelector('fieldset').disabled,true);assert.equal(f.named('password').disabled,true);
  assert.equal(f.find('button','서류 확인 신청').disabled,true);assert.match(f.root.textContent,/국외이전 조건/);
  const input=f.all(f.sections()[0]).find(el=>el.type==='file');input.files=[f.file()];await input.onchange();f.populate();await f.submit();assert.equal(f.bitmaps.length,0);assert.equal(f.calls.length,0);
 }
});

test('overseas-transfer agreement is separate, starts unchecked, and is included with its exact notice identity',async()=>{
 const f=fixture();await f.mount();assert.equal(f.all(f.root).filter(el=>el.type==='checkbox').every(el=>el.checked===false),true);
 await f.prepare();f.populate();const transfers=f.all(f.root).filter(el=>el.type==='checkbox');transfers[2].checked=false;await f.submit();assert.equal(f.calls.length,0);
 transfers[2].checked=true;await f.submit();assert.equal(f.calls[0].body.transferConsent,true);assert.equal(f.calls[0].body.transferNoticeVersion,initial.policy.transferNoticeVersion);assert.equal(f.calls[0].body.transferNoticeHash,initial.policy.transferNoticeHash);
});

test('reviewable beta bank form stays visible but all private controls and save remain blocked before collection review',async()=>{
 const f=fixture();vm.runInContext(dashboard,f.context);f.setResponse(async call=>call.path.endsWith('action=profile')?{profile:{email:'a@example.test',penName:'작가',bio:'',version:'a'.repeat(32)},bank:null}:{...structuredClone(initial),collectionEnabled:false});
 await f.context.CreatorDashboard.profile();const bank=f.nodes.get('creatorProfileContent').querySelector('#adBankForm');assert.equal(bank.hidden,false);assert.equal(bank.dataset.settlementRegistration,'true');
 assert.equal(bank.querySelectorAll('input').every(el=>el.disabled),true);assert.equal(bank.querySelector('button').disabled,true);
 for(const [name,value]of Object.entries({bankName:'은행',holder:'명의',accountNumber:'12345678',password:'secret'}))bank.elements[name].value=value;bank.elements.consent.checked=true;bank.elements.transferConsent.checked=true;bank.querySelector('button').disabled=false;await bank.onsubmit({preventDefault(){}});
 assert.equal(f.calls.some(call=>call.path.endsWith('action=save-bank')),false,'programmatic control changes never bypass authenticated collection readiness');
});

test('existing information can be withdrawn while new collection is blocked, without reopening private fields',async()=>{
 const f=fixture();await f.mount({...initial,collectionEnabled:false,application:{revision:'4',status:'PENDING'}});assert.equal(f.named('password').disabled,false);f.named('password').value='secret';f.setResponse(async()=>({application:{revision:'5',status:'WITHDRAWN'}}));
 await f.find('button','정산 본인 정보 철회·삭제').onclick();assert.equal(f.calls[0].path,'/api/v2/creator/settlement/withdraw');assert.equal(f.root.querySelector('fieldset').disabled,true);assert.equal(f.find('button','서류 확인 신청').disabled,true);
});

test('current bank deletion remains available during collection lock and retries the exact revision/key without retaining account numbers',async()=>{
 const f=fixture();vm.runInContext(dashboard,f.context);let tries=0;
 f.setResponse(async call=>{
  if(call.path.endsWith('action=profile'))return {profile:{email:'a@example.test',penName:'작가',bio:'',version:'a'.repeat(32)},bank:{revision:'7',bankName:'기존 은행',holder:'기존 명의',maskedNumber:'**** 5678'},legacyBankExists:true};
  if(call.path.endsWith('/bank/delete')){if(!tries++)throw Error('NETWORK');return {ok:true,bank:null};}
  return {...structuredClone(initial),collectionEnabled:false};
 });
 await f.context.CreatorDashboard.profile();const root=f.nodes.get('creatorProfileContent'),bank=root.querySelector('#adBankForm'),removal=bank.querySelector('section'),remove=removal.querySelector('button');
 assert.equal(bank.querySelector('button').disabled,true);assert.equal(bank.elements.deletePassword.disabled,false);
 bank.elements.deletePassword.value='first-secret';await remove.onclick();assert.equal(bank.elements.deletePassword.value,'');assert.equal(bank.querySelector('button').disabled,true);
 bank.elements.deletePassword.value='second-secret';await remove.onclick();const writes=f.calls.filter(call=>call.path.endsWith('/bank/delete'));assert.equal(writes.length,2);assert.equal(writes[0].options.headers['Idempotency-Key'],writes[1].options.headers['Idempotency-Key']);assert.equal(writes[1].body.revision,'7');assert.deepEqual(Object.keys(writes[1].body).sort(),['password','revision']);
 assert.equal(removal.hidden,true);assert.equal(bank.elements.deletePassword.value,'');assert.equal(f.nodes.get('creatorBankInfo').textContent,'미등록');assert.match(bank.querySelector('#adBankSummary').textContent,/이전 계좌 자료/);assert.equal(bank.querySelector('button').disabled,true);
});

test('stale bank deletion callbacks cannot run for another author or change a replacement profile after reset',async()=>{
 const f=fixture();vm.runInContext(dashboard,f.context);const pending=gate();f.setResponse(async call=>call.path.endsWith('action=profile')?{profile:{email:'a@example.test',penName:'작가',bio:'',version:'a'.repeat(32)},bank:{revision:'3',bankName:'은행',holder:'명의',maskedNumber:'**** 1234'}}:call.path.endsWith('/bank/delete')?pending.promise:{...structuredClone(initial),collectionEnabled:false});
 await f.context.CreatorDashboard.profile();const root=f.nodes.get('creatorProfileContent'),bank=root.querySelector('#adBankForm'),remove=bank.querySelector('section').querySelector('button');bank.elements.deletePassword.value='secret';
 f.setActor({userId:'other',author:{status:'APPROVED'}});await remove.onclick();assert.equal(f.calls.filter(call=>call.path.endsWith('/bank/delete')).length,0);
 f.setActor({userId:'owner-a',author:{status:'APPROVED'},authorWorkspaceReady:true});const removing=remove.onclick();await tick();f.context.CreatorDashboard.reset();f.setActor({userId:'other',author:{status:'APPROVED'}});pending.resolve({ok:true,bank:null});await removing;assert.equal(root.children.length,0);assert.equal(bank.elements.deletePassword.value,'');
});
