import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const support=await readFile(new URL('../public/js/core/beta-support.js',import.meta.url),'utf8');
const operations=await readFile(new URL('../public/js/admin/admin-beta-operations.js',import.meta.url),'utf8');
const id='3d80dc4b-0aa0-4e41-8da2-bdd5acc2daf1';
const item=(extra={})=>({id,category:'QUESTION',title:'이용 문의',status:'OPEN',revision:'1',createdAt:'2026-10-31T00:00:00Z',updatedAt:'2026-10-31T01:00:00Z',replyCount:1,reopenCount:0,...extra});
const detail=(extra={})=>({case:item(extra),messages:[{id:'message-1',authorKind:'ADMIN',kind:'REPLY',message:'<svg onload=1>를 실행하지 않습니다.',createdAt:'2026-10-31T01:00:00Z'}]});
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const ticks=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
class Node {
 constructor(tag,document){this.tag=tag;this.tagName=tag.toUpperCase();this.document=document;this.children=[];this.attributes={};this._text='';this.value='';this.hidden=false;this.disabled=false;this.checked=false;this.className='';this.parent=null;}
 set textContent(value){this._text=String(value??'');this.children.forEach(child=>child.parent=null);this.children=[];}
 get textContent(){return this._text;}
 append(...children){for(const child of children){this.children.push(child);child.parent=this;}}
 replaceChildren(...children){this.children.forEach(child=>child.parent=null);this.children=[];this._text='';this.append(...children);}
 setAttribute(key,value){this.attributes[key]=String(value);}
 getAttribute(key){return this.attributes[key]??null;}
 get isConnected(){return this===this.document.body||!!this.parent?.isConnected;}
 matches(selector){return selector==='[hidden]'?this.hidden:selector.startsWith('#')?this.id===selector.slice(1):selector.startsWith('[')?selector.slice(1,-1) in this.attributes:selector===this.tag;}
 closest(selector){return this.matches(selector)?this:this.parent?.closest(selector)||null;}
 querySelectorAll(selector){return this.children.flatMap(child=>[...(selector.split(',').some(part=>child.matches(part))?[child]:[]),...child.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 contains(node){return this===node||this.children.some(child=>child.contains(node));}
 focus(){this.document.activeElement=this;}
 set innerHTML(_){assert.fail('Private support values must be rendered as text');}
}
const text=node=>node.textContent+' '+node.children.map(text).join(' ');
const button=(root,label)=>root.querySelectorAll('button').find(node=>node.textContent===label);
const field=(root,name)=>root.querySelectorAll('input,select,textarea').find(node=>node.name===name);
const submit=form=>form.onsubmit({preventDefault(){}});
function fixture({admin=false,api}={}){
 const document={addEventListener(){}};document.createElement=tag=>new Node(tag,document);document.body=document.createElement('body');document.activeElement=document.body;document.getElementById=id=>document.body.querySelector('#'+id);
 const root=document.createElement('div');document.body.append(root);let actor={userId:'user-a',...(admin?{admin:{role:'SUB_ADMIN',is_active:true,permissions:['CASE_READ','CASE_RESOLVE','OPERATIONS_READ']}}:{})},serial=0;
 const calls=[],context={document,URLSearchParams,crypto:{randomUUID:()=>`3d80dc4b-0aa0-4e41-8da2-${String(++serial).padStart(12,'0')}`},WebNovelsAuth:{getActor:()=>actor,api:async(path,options)=>{const url=new URL(path,'https://app.test'),call={path,url,action:url.searchParams.get('action'),payload:options?JSON.parse(options.body):null};calls.push(call);return api?api(call):call.action==='list'?{items:[item()],nextOffset:null}:detail();}}};
 context.window=context;vm.createContext(context);vm.runInContext(support,context);vm.runInContext(operations,context);
 return {context,document,root,calls,setActor:value=>actor=value,render:()=>context.BetaSupport.render(root,{admin})};
}
async function create(app){await app.render();button(app.root,'새 문의').onclick();const form=app.root.querySelector('form');field(form,'title').value='오류 문의입니다';field(form,'message').value='이미지를 확인하고 싶습니다.';return form;}
async function open(app){await app.render();await button(app.root,'이용 문의').onclick();return app.root.querySelector('form');}

test('reader sees actual case identity, current status and next action while message strings remain inert text',async()=>{
 const app=fixture({api:call=>call.action==='list'?{items:[item({status:'WAITING_USER'})],nextOffset:null}:detail({status:'WAITING_USER'})});
 await open(app);assert.match(text(app.root),/현재|문의 내역/);assert.match(text(app.root),/내 답변 필요/);assert.match(text(app.root),/관리자가 추가 답변을 요청/);assert.match(text(app.root),new RegExp(id));assert.match(text(app.root),/<svg onload=1>/);assert.equal(app.root.querySelectorAll('svg').length,0);
 const badge=app.root.querySelector('[data-support-status]');assert.equal(badge.getAttribute('data-support-status'),'WAITING_USER');assert.match(text(app.root),/대화·처리 이력/);assert.equal(app.root.querySelector('section').getAttribute('aria-busy'),'false');
});

test('typed admin queue filters retain the selected category and list counts describe only the loaded page',async()=>{
 const app=fixture({admin:true,api:call=>({items:[],nextOffset:null})});await app.render();
 field(app.root,'category').value='COPYRIGHT';await field(app.root,'category').onchange();await ticks();
 await button(app.root,'회원 답변 대기').onclick();const last=app.calls.at(-1).url.searchParams;
 assert.equal(last.get('status'),'WAITING_USER');assert.equal(last.get('category'),'COPYRIGHT');assert.equal(last.get('offset'),'0');assert.equal(button(app.root,'회원 답변 대기').getAttribute('aria-pressed'),'true');
 assert.match(text(app.root),/현재 목록 0건/);assert.match(text(app.root),/선택한 조건에 맞는 문의가 없습니다/);
 await button(app.root,'전체 문의 보기').onclick();assert.equal(app.calls.at(-1).url.searchParams.has('status'),false);assert.equal(app.calls.at(-1).url.searchParams.has('category'),false);assert.match(text(app.root),/등록된 문의가 없습니다/);
});

test('transport failure exposes the actual retry request ID and manual retry reuses it exactly once',async()=>{
 const pending=gate();let writes=0;
 const app=fixture({api:call=>{if(call.action==='list')return {items:[],nextOffset:null};if(++writes===1)return pending.promise;return {...detail(),replayed:true};}});
 const form=await create(app),saving=submit(form);await submit(form);assert.equal(writes,1);assert.equal(form.getAttribute('aria-busy'),'true');
 const requestId=app.calls.find(call=>call.payload).payload.requestId;assert.match(text(form),new RegExp(requestId));pending.reject(Error('network'));await saving;
 assert.equal(form.getAttribute('aria-busy'),'false');assert.match(text(form),new RegExp(requestId));await button(form,'같은 요청 다시 보내기').onclick();
 const posts=app.calls.filter(call=>call.payload);assert.equal(posts.length,2);assert.deepEqual(posts[0].payload,posts[1].payload);assert.match(text(app.root),/이미 접수된 문의를 확인했습니다/);assert.match(text(app.root),new RegExp(id));
});

test('an older save completion cannot unlock a newer form request after changing the support view',async()=>{
 const first=gate(),second=gate();let writes=0;
 const app=fixture({api:call=>call.action==='list'?{items:[],nextOffset:null}:++writes===1?first.promise:second.promise});
 const oldForm=await create(app),old=submit(oldForm);await button(app.root,'내 문의 목록').onclick();button(app.root,'새 문의').onclick();
 const current=app.root.querySelector('form');field(current,'title').value='새로운 문의입니다';field(current,'message').value='다른 내용을 접수합니다.';const saving=submit(current);
 first.resolve(detail());await old;assert.equal(current.getAttribute('aria-busy'),'true');assert.equal(button(current,'문의 접수').disabled,true);await submit(current);assert.equal(writes,2);
 second.resolve(detail({title:'현재 문의'}));await saving;assert.match(text(app.root),/현재 문의/);assert.doesNotMatch(text(app.root),/새로운 문의입니다/);
});

test('admin action hint hides irrelevant state selection and posts only the selected transition contract',async()=>{
 const app=fixture({admin:true});const form=await open(app),action=field(form,'action'),next=field(form,'nextStatus');
 assert.equal(next.closest('label').hidden,true);assert.match(text(form),/현재 처리 상태는 유지/);
 action.value='transition';action.onchange();assert.equal(next.closest('label').hidden,false);assert.match(text(form),/선택한 상태로 변경/);next.value='WAITING_USER';field(form,'message').value='추가 내용을 알려 주세요.';
 await submit(form);const sent=app.calls.at(-1);assert.equal(sent.action,'transition');assert.deepEqual(Object.keys(sent.payload).sort(),['id','message','requestId','revision','status']);assert.equal(sent.payload.revision,'1');assert.equal(sent.payload.status,'WAITING_USER');
});

test('failed or malformed lists remain errors and retry keeps page offset rather than claiming no inquiries',async()=>{
 let pageAttempts=0;
 const app=fixture({api:call=>{if(call.url.searchParams.get('offset')==='20'){if(++pageAttempts===1)throw Error('network');return {items:[],nextOffset:null};}return {items:[item()],nextOffset:20};}});
 await app.render();await button(app.root,'다음 목록').onclick();assert.match(text(app.root),/목록 조회 실패/);assert.doesNotMatch(text(app.root),/등록된 문의가 없습니다/);
 await button(app.root,'목록 다시 불러오기').onclick();assert.equal(app.calls.at(-1).url.searchParams.get('offset'),'20');assert.match(text(app.root),/등록된 문의가 없습니다/);
 const malformed=fixture({api:()=>({items:null})});await malformed.render();assert.match(text(malformed.root),/목록 조회 실패/);assert.ok(button(malformed.root,'목록 다시 불러오기'));
});

test('form guidance and validation identify entered values without adding sensitive data to the request',async()=>{
 const app=fixture(),form=await create(app),message=field(form,'message');
 message.value='다섯 글자';message.oninput();assert.match(text(form),/5 \/ 4,000자/);assert.ok(message.getAttribute('aria-describedby'));
 field(form,'category').value='BUG';field(form,'category').onchange();assert.match(text(form),/오류 확인 번호/);
 field(form,'title').value='짧';await submit(form);assert.equal(field(form,'title').getAttribute('aria-invalid'),'true');assert.equal(app.calls.filter(call=>call.payload).length,0);
 field(form,'title').value='오류 내용 문의';await submit(form);const payload=app.calls.find(call=>call.payload).payload;assert.deepEqual(Object.keys(payload).sort(),['category','message','requestId','title']);
});

test('operations retries remain read-only and do not block support; lost permissions clear private late responses',async()=>{
 let operationsCalls=0;
 const metrics={enabled:true,summary:{observedRequests:3,failures:0,conflicts:0,averageDurationMs:4},areas:[],queue:{pendingSchedules:0,failedSchedules:1,failedWebtoonAssets:2},recentErrors:[],observedAt:'2026-10-31T00:00:00Z',retentionDays:7};
 const app=fixture({admin:true,api:call=>{if(call.path==='/api/v2/admin/beta-operations'){if(++operationsCalls===1)throw Error('network');return metrics;}return {items:[item()],nextOffset:null};}});
 await app.context.AdminBetaOperations.render(app.root);assert.match(text(app.root),/이용 문의/);await button(app.root,'운영 기록 다시 불러오기').onclick();assert.match(text(app.root),/예약 대기 0/);assert.match(text(app.root),/이미지 처리 실패 2/);assert.ok(app.calls.every(call=>!call.payload));
 const pending=gate(),late=fixture({admin:true,api:call=>call.path==='/api/v2/admin/beta-operations'?pending.promise:{items:[],nextOffset:null}});
 const loading=late.context.AdminBetaOperations.render(late.root);late.setActor({userId:'user-a',admin:{is_active:true,role:'SUB_ADMIN',permissions:[]}});pending.resolve(metrics);await loading;assert.equal(late.root.children.length,0);
});
