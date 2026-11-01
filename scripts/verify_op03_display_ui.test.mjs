import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transform} from 'esbuild';
import {validDisplayDocument} from '../server/site-display-api.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const css=read('public/css/admin-display.css');
const source=read('public/js/admin/admin-display.js');
const selectionId='10000000-0000-4000-8000-000000000001',releaseId='20000000-0000-4000-8000-000000000001';
const clone=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
class Node{
  constructor(tag='div'){this.tag=tag;this.children=[];this.attributes={};this._text='';this.value='';this.checked=false;this.disabled=false;this.isConnected=true;this.validationMessage='';}
  set textContent(value){this._text=String(value??'');this.children=[];}get textContent(){return this._text+' '+this.children.map(child=>child.textContent).join(' ');}
  set innerHTML(_){assert.fail('Display CMS must use text nodes');}
  append(...children){for(const child of children){child.parentNode=this;this.children.push(child);}}
  replaceChildren(...children){this._text='';this.children=[];this.append(...children);}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}
  focus(options){this.focused=true;this.focusOptions=options;}
  setCustomValidity(value){this.validationMessage=value;}checkValidity(){return !this.validationMessage;}reportValidity(){this.reported=true;}
}
const all=root=>[root,...root.children.flatMap(all)];
const btn=(root,text)=>all(root).find(node=>node.tag==='button'&&node._text===text);
const buttons=root=>all(root).filter(node=>node.tag==='button');
const field=(root,label)=>{const wrap=all(root).find(node=>node.tag==='label'&&node.children.find(child=>child.tag==='span')?._text===label);return wrap?.children.find(child=>['input','select','textarea'].includes(child.tag));};
const fields=(root,label)=>all(root).filter(node=>node.tag==='label'&&node.children.find(child=>child.tag==='span')?._text===label).map(node=>node.children.find(child=>['input','select','textarea'].includes(child.tag)));
const form=(root,label)=>all(root).find(node=>node.tag==='form'&&node.getAttribute('aria-label')===label);
const enter=(node,value)=>{assert(node);node.value=value;node.oninput?.();node.onchange?.();};
const tick=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
const card=(id='1',extra={})=>({id,title:'작품 '+id,author:'필명 '+id,content_type:'NOVEL',eligible:true,exclusionReason:null,...extra});
const selection=(workId='1',extra={})=>({id:selectionId,workId,home:'NONE',startsAt:null,endsAt:null,enabled:true,caption:'',...extra});
const document=()=>({selections:[],blocks:['hero','recommendations','latest','ranking','notice'].map(key=>({key,enabled:true,title:key})),notices:[],menus:['home','novel','webtoon','recommendations','ranking'].map(key=>({key,label:key,visible:true})),footerNote:''});
function setup({doc=document(),revision='0',canEdit=true,permissions,handler,releases=[]}={}){
  let actor={userId:'admin-a',accountServiceReady:true,admin:{role:permissions?'SUB_ADMIN':'SUPER_ADMIN',is_active:true,permissions:permissions||[]}},isCurrent=true,serial=10;
  const root=new Node(),calls=[],server={document:clone(doc),revision,releases:clone(releases)};
  const get=()=>({ready:true,draft:{revision:server.revision,document:clone(server.document)},releases:clone(server.releases),capabilities:{canEdit},legacyAvailable:true,selectionCards:server.document.selections.map(row=>card(row.workId))});
  const c={URL,Date,BigInt,console,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`},document:{createElement:tag=>new Node(tag)},WebNovelsAuth:{getActor:()=>actor,api:async(url,options)=>{
    const action=new URL(url,'https://app.test').searchParams.get('action'),body=JSON.parse(options.body),call={action,body,url,options};calls.push(call);
    if(handler){const response=await handler(action,body,{server,get,calls});if(response!==undefined)return response;}
    if(action==='get')return get();
    if(action==='search')return {items:[card('1'),card('2')],offset:body.offset,limit:50,total:2,hasMore:false,nextOffset:null};
    if(action==='legacy')return {items:[{work:card('3'),origins:['HOME_RECOMMENDED']}],offset:body.offset,limit:50,total:1,hasMore:false,nextOffset:null};
    if(action==='preview')return {revision:body.revision,at:body.at,public:{ready:true,revision:'0',items:server.document.selections.filter(row=>row.enabled).slice(0,24).map(row=>card(row.workId,{caption:row.caption})),home:{hero:null,featured:[]},blocks:[],notices:[],menus:[],footerNote:''},excluded:[]};
    if(action==='save'){server.document=clone(body.document);server.revision=String(BigInt(server.revision)+1n);return {...get(),saved:true};}
    if(action==='publish'){server.releases.unshift({id:releaseId,startsAt:body.startsAt,endsAt:body.endsAt,createdAt:new Date().toISOString(),reason:body.reason,stopped:false,cancelled:false});return {...get(),saved:true};}
    if(action==='stop'){server.releases.find(row=>row.id===body.releaseId).stopped=true;return get();}
    if(action==='restore'){server.document.footerNote='복구된 초안';server.revision=String(BigInt(server.revision)+1n);return get();}
    throw Error('UNEXPECTED_ACTION');
  }}};c.window=c;vm.createContext(c);vm.runInContext(source,c,{filename:'admin-display.js'});
  return {root,c,calls,server,get,render:()=>c.AdminDisplay.render(root,{isCurrent:()=>isCurrent}),setActor:value=>actor=value,leave:()=>isCurrent=false};
}
const search=async(app,q='',type='ALL')=>{enter(field(app.root,'작품명·필명·작품 ID'),q);enter(field(app.root,'작품 유형'),type);return form(app.root,'추천 작품 검색').onsubmit({preventDefault(){}});};
const reason=(app,value='관리자 직접 선정 변경')=>enter(field(app.root,'변경 사유 (3~500자)'),value);

test('CMS uses authenticated POSTs and never invents a selected work',async()=>{
  const app=setup();await app.render();assert.equal(app.calls.length,1);assert.equal(app.calls[0].action,'get');assert.match(app.root.textContent,/선정한 작품이 없습니다/);
  assert.equal(btn(app.root,'확인한 초안 발행·예약').disabled,true);assert(app.calls.every(call=>call.options.method==='POST'&&!call.url.includes('q=')));
  assert.equal(field(app.root,'변경 사유 (3~500자)').maxLength,500);
});

test('only an active current curation administrator can enter and edit',async()=>{
  for(const permissions of [[],['ACCOUNTS_READ'],['OPERATIONS_READ']]){const app=setup({permissions});await app.render();assert.equal(app.calls.length,0);assert.match(app.root.textContent,/권한/);}
  const app=setup({canEdit:false});await app.render();assert.match(app.root.textContent,/조회 전용/);assert.equal(btn(app.root,'초안 저장').disabled,true);
  await btn(app.root,'초안 저장').onclick();assert.equal(app.calls.filter(call=>call.action==='save').length,0);
  const inactive=setup();inactive.setActor({userId:'admin-a',admin:{role:'SUPER_ADMIN',is_active:false}});await inactive.render();assert.equal(inactive.calls.length,0);
});

test('work search is body-only and explicit selections are unique',async()=>{
  const app=setup();await app.render();await search(app,'제목·필명','WEBTOON');const call=app.calls.at(-1);assert.deepEqual(call.body,{q:'제목·필명',type:'WEBTOON',offset:0});
  const choose=btn(app.root,'이 작품 선정');await choose.onclick();assert.match(app.root.textContent,/선정 작품 · 1개/);await choose.onclick();assert.match(app.root.textContent,/이미 선정한 작품/);
  reason(app);await btn(app.root,'초안 저장').onclick();const saved=app.calls.find(call=>call.action==='save').body.document.selections;assert.equal(saved.length,1);assert.equal(saved[0].workId,'1');assert.match(saved[0].id,/^[0-9a-f-]{36}$/);
});

test('server search paging preserves work query/type and never fills by popularity',async()=>{
  const app=setup({handler(action,body){if(action==='search')return {items:body.offset?[card('51')]:[card('1')],offset:body.offset,limit:50,total:51,hasMore:body.offset===0,nextOffset:body.offset===0?50:null};}});
  await app.render();await search(app,'검색','NOVEL');await btn(app.root,'다음 결과').onclick();assert.deepEqual(app.calls.at(-1).body,{q:'검색',type:'NOVEL',offset:50});assert.match(app.root.textContent,/작품 51/);
  await btn(app.root,'이전 결과').onclick();assert.equal(app.calls.at(-1).body.offset,0);assert.equal(app.calls.filter(call=>call.action==='save'||call.action==='publish').length,0);
});

test('legacy candidates start unchecked and require an explicit per-work selection',async()=>{
  const app=setup();await app.render();await btn(app.root,'이전 자료 불러오기').onclick();const choice=field(app.root,'이 작품을 새 초안에 선정');assert.equal(choice.checked,false);
  await btn(app.root,'체크한 작품만 초안에 추가').onclick();assert.match(app.root.textContent,/직접 확인한 작품을 체크/);assert.match(app.root.textContent,/선정 작품 · 0개/);
  choice.checked=true;choice.onchange();await btn(app.root,'체크한 작품만 초안에 추가').onclick();assert.match(app.root.textContent,/선정 작품 · 1개/);assert.equal(app.calls.filter(call=>!['get','legacy'].includes(call.action)).length,0);
  reason(app);await btn(app.root,'초안 저장').onclick();assert.equal(app.server.document.selections[0].workId,'3');
});

test('selection ordering, home placement and removal serialize only explicit IDs',async()=>{
  const doc=document();doc.selections=[selection('1'),selection('2',{id:'10000000-0000-4000-8000-000000000002'})];const app=setup({doc});await app.render();
  await btn(app.root,'아래로: 1').onclick();enter(fields(app.root,'홈 노출')[0],'FEATURED');enter(fields(app.root,'추천 문구 (최대 120자)')[0],'직접 고른 추천');reason(app);await btn(app.root,'초안 저장').onclick();
  assert.deepEqual(app.server.document.selections.map(row=>row.workId),['2','1']);assert.equal(app.server.document.selections[0].home,'FEATURED');assert.equal(app.server.document.selections[0].caption,'직접 고른 추천');
  await btn(app.root,'선정 해제: 1').onclick();reason(app);await btn(app.root,'초안 저장').onclick();assert.deepEqual(app.server.document.selections.map(row=>row.workId),['2']);
});

test('selection changes keep keyboard focus visible and advanced editor disclosures open',async()=>{
  const app=setup();await app.render();await search(app);await btn(app.root,'이 작품 선정').onclick();const chosen=all(app.root).find(node=>node.tag==='li'&&node.getAttribute('tabindex')==='-1');assert.equal(chosen.focused,true);assert.equal(chosen.focusOptions.preventScroll,true);
  const settings=all(app.root).find(node=>node.tag==='details'&&node.children[0]?._text==='홈 블록·공지·메뉴·푸터 편집');settings.open=true;settings.ontoggle();await btn(app.root,'공지 추가').onclick();
  assert.equal(all(app.root).find(node=>node.tag==='details'&&node.children[0]?._text==='홈 블록·공지·메뉴·푸터 편집').open,true);
});

test('UI saves a document accepted by the real shared API validator',async()=>{
  const app=setup();await app.render();await search(app);await btn(app.root,'이 작품 선정').onclick();enter(field(app.root,'메뉴 표시명: 추천'),'직접 고른 추천');await btn(app.root,'공지 추가').onclick();enter(field(app.root,'공지 제목'),'이번 주 안내');enter(field(app.root,'공지 연결 경로'),'/recommendations/');reason(app);await btn(app.root,'초안 저장').onclick();
  const saved=app.calls.find(call=>call.action==='save').body.document;assert.equal(validDisplayDocument(saved),true);assert.equal(saved.selections.length,1);assert.equal(saved.menus.find(row=>row.key==='recommendations').label,'직접 고른 추천');
});

test('KST input is converted to UTC independently of the browser timezone and retains untouched seconds',async()=>{
  const doc=document();doc.selections=[selection('1',{startsAt:'2026-11-01T00:00:37.000Z'})];const app=setup({doc});await app.render();
  assert.equal(fields(app.root,'시작 (선택·한국 시간 KST)')[0].value,'2026-11-01T09:00');
  enter(fields(app.root,'종료 (선택·한국 시간 KST)')[0],'2026-11-02T18:30');reason(app);await btn(app.root,'초안 저장').onclick();
  assert.equal(app.server.document.selections[0].startsAt,'2026-11-01T00:00:37.000Z');assert.equal(app.server.document.selections[0].endsAt,'2026-11-02T09:30:00.000Z');
});

test('invalid calendar dates and reversed windows cannot submit a draft',async()=>{
  const doc=document();doc.selections=[selection()];const app=setup({doc});await app.render();const start=fields(app.root,'시작 (선택·한국 시간 KST)')[0];enter(start,'2026-02-30T09:00');reason(app);await btn(app.root,'초안 저장').onclick();assert.equal(app.calls.filter(call=>call.action==='save').length,0);
  enter(start,'2026-11-02T09:00');enter(fields(app.root,'종료 (선택·한국 시간 KST)')[0],'2026-11-01T09:00');await btn(app.root,'초안 저장').onclick();assert.equal(app.calls.filter(call=>call.action==='save').length,0);
});

test('publish requires the saved current revision preview and an explicit reason',async()=>{
  const app=setup({revision:'9007199254740993'});await app.render();reason(app);await btn(app.root,'확인한 초안 발행·예약').onclick();assert.equal(app.calls.filter(call=>call.action==='publish').length,0);
  await btn(app.root,'저장한 초안 미리보기').onclick();assert.equal(btn(app.root,'확인한 초안 발행·예약').disabled,false);
  enter(field(app.root,'발행 방식'),'SCHEDULED');
  enter(field(app.root,'발행 시작 (한국 시간 KST)'),'2026-11-03T15:00');enter(field(app.root,'발행 종료 (선택·한국 시간 KST)'),'2026-11-04T15:00');reason(app);await btn(app.root,'확인한 초안 발행·예약').onclick();
  const sent=app.calls.find(call=>call.action==='publish').body;assert.equal(sent.revision,'9007199254740993');assert.equal(sent.startsAt,'2026-11-03T06:00:00.000Z');assert.equal(sent.endsAt,'2026-11-04T06:00:00.000Z');assert.match(sent.requestId,/^[0-9a-f-]{36}$/);
});

test('immediate publication takes its first-click time after a long editing session and retries that exact time',async()=>{
  let uncertain=true;const app=setup({handler(action){if(action==='publish'&&uncertain)throw Object.assign(Error('NETWORK'),{status:503});}});await app.render();await btn(app.root,'저장한 초안 미리보기').onclick();
  assert.equal(field(app.root,'발행 시작 (한국 시간 KST)').disabled,true);
  const RealDate=Date,clickTime=Date.now()+45*60000;app.c.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clickTime]));}static now(){return clickTime;}};
  reason(app);await btn(app.root,'확인한 초안 발행·예약').onclick();const original=clone(app.calls.find(call=>call.action==='publish').body);assert.equal(original.startsAt,new RealDate(clickTime).toISOString());
  const retryTime=clickTime+20*60000;app.c.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[retryTime]));}static now(){return retryTime;}};
  uncertain=false;await btn(app.root,'같은 요청 다시 확인').onclick();assert.deepEqual(app.calls.filter(call=>call.action==='publish').map(call=>call.body),[original,original]);
});

test('notices are limited to ten and an empty link is a valid text-only notice',async()=>{
  const doc=document();doc.notices=Array.from({length:10},(_,index)=>({id:`30000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,title:'안내 '+index,body:'일반 텍스트',href:'',startsAt:null,endsAt:null,enabled:true}));
  const app=setup({doc});await app.render();assert.equal(btn(app.root,'공지 추가').disabled,true);reason(app);await btn(app.root,'초안 저장').onclick();assert.equal(app.server.document.notices.length,10);assert.equal(app.server.document.notices[0].href,'');
  const tooMany=clone(doc);tooMany.notices.push({...doc.notices[0],id:'30000000-0000-4000-8000-000000000099'});const invalid=setup({doc:tooMany});await invalid.render();assert.equal(btn(invalid.root,'초안 저장'),undefined);
});

test('editing any display document field invalidates preview and publishing at call time',async()=>{
  const app=setup();await app.render();await btn(app.root,'저장한 초안 미리보기').onclick();const oldPublish=btn(app.root,'확인한 초안 발행·예약');enter(field(app.root,'푸터 추가 안내 (최대 300자)'),'수정');reason(app);assert.equal(oldPublish.disabled,true);await oldPublish.onclick();assert.equal(app.calls.filter(call=>call.action==='publish').length,0);
  assert.equal(btn(app.root,'저장한 초안 미리보기').disabled,true);await btn(app.root,'초안 저장').onclick();assert.equal(app.server.revision,'1');assert.equal(btn(app.root,'확인한 초안 발행·예약').disabled,true);
});

test('blocked selection preview displays exclusions and an empty state without substitute works',async()=>{
  const doc=document();doc.selections=[selection()];const app=setup({doc,handler(action,body){if(action==='preview')return {revision:body.revision,at:body.at,public:{ready:true,items:[],home:{hero:null,featured:[]}},excluded:[{selectionId,workId:'1',reason:'WORK_RESTRICTED'}]};}});
  await app.render();await btn(app.root,'저장한 초안 미리보기').onclick();assert.match(app.root.textContent,/WORK_RESTRICTED/);assert.match(app.root.textContent,/다른 인기작으로 자동 대체하지/);assert.equal(app.calls.filter(call=>call.action==='search').length,0);
});

test('preview reflects the server menu/block order and text-only notices/footer',async()=>{
  const app=setup({handler(action,body){if(action==='preview')return {revision:body.revision,at:body.at,public:{ready:true,items:[],home:{hero:null,featured:[]},menus:[{key:'ranking',label:'독자 랭킹',visible:true},{key:'home',label:'우리 홈',visible:true},{key:'novel',label:'숨긴 메뉴',visible:false}],blocks:[{key:'notice',title:'먼저 보는 공지',enabled:true},{key:'ranking',title:'실제 랭킹',enabled:true},{key:'latest',title:'숨긴 블록',enabled:false}],notices:[{title:'공지 제목',body:'<b>일반 텍스트</b>'}],footerNote:'운영 안내'},excluded:[]};}});
  await app.render();await btn(app.root,'저장한 초안 미리보기').onclick();const preview=all(app.root).find(node=>node.getAttribute('tabindex')==='-1'&&node.className==='display-preview');assert(preview);assert.match(preview.textContent,/<b>일반 텍스트<\/b>/);assert.match(preview.textContent,/운영 안내/);assert.doesNotMatch(preview.textContent,/숨긴 메뉴|숨긴 블록/);
  const visible=all(preview).filter(node=>node.tag==='span').map(node=>node._text);assert.deepEqual(visible,['독자 랭킹','우리 홈']);const headings=all(preview).filter(node=>node.tag==='h5').map(node=>node._text);assert.deepEqual(headings.slice(0,2),['먼저 보는 공지','실제 랭킹']);assert.equal(all(preview).filter(node=>node.tag==='b').length,0);
});

test('notices use plain text and only allowlisted paths; protected home/footer cannot be removed',async()=>{
  const app=setup();await app.render();const home=fields(app.root,'이 메뉴 표시')[0];assert.equal(home.disabled,true);
  assert.match(app.root.textContent,/공지·메뉴·추천 문구 등은 일반 텍스트/);assert.match(app.root.textContent,/꺾쇠\(<, >\)와 HTML 태그는 지원하지 않습니다/);
  assert(all(app.root).some(node=>node.tag==='a'&&node.href==='/company/'));assert(all(app.root).some(node=>node.tag==='a'&&node.href==='/policies/privacy/'));
  await btn(app.root,'공지 추가').onclick();enter(field(app.root,'공지 제목'),'<img onerror=boom>');enter(field(app.root,'공지 본문 (일반 텍스트)'),'<script>not executed</script>');enter(field(app.root,'공지 연결 경로'),'javascript:boom');reason(app);await btn(app.root,'초안 저장').onclick();assert.equal(app.calls.filter(call=>call.action==='save').length,0);
  enter(field(app.root,'공지 연결 경로'),'/company/');await btn(app.root,'초안 저장').onclick();assert.equal(app.calls.filter(call=>call.action==='save').length,0);assert.match(app.root.textContent,/전시 문구에 꺾쇠/);assert.equal(app.server.document.notices.length,0);assert.equal(all(app.root).filter(node=>['script','img'].includes(node.tag)).length,0);
  enter(field(app.root,'공지 제목'),'새 운영 안내');enter(field(app.root,'공지 본문 (일반 텍스트)'),'일반 텍스트로 작성한 공지입니다.');await btn(app.root,'초안 저장').onclick();assert.equal(app.calls.filter(call=>call.action==='save').length,1);assert.equal(app.server.document.notices[0].body,'일반 텍스트로 작성한 공지입니다.');
});

test('angle brackets are rejected consistently in every editable display text field',async()=>{
  const doc=document();doc.selections=[selection()];doc.notices=[{id:releaseId,title:'안내',body:'본문',href:'',startsAt:null,endsAt:null,enabled:true}];
  const app=setup({doc});await app.render();reason(app);
  for(const [label,value]of [['추천 문구 (최대 120자)','직접 고른 <추천>'],['블록 제목: 대표 추천','대표 > 추천'],['메뉴 표시명: 추천','추천 < 목록'],['공지 제목','공지 <제목>'],['공지 본문 (일반 텍스트)','본문 1 < 2'],['푸터 추가 안내 (최대 300자)','안내 > 본문']]){
    const input=field(app.root,label),before=input.value;enter(input,value);await btn(app.root,'초안 저장').onclick();assert.equal(app.calls.filter(call=>call.action==='save').length,0,label);assert.match(app.root.textContent,/전시 문구에 꺾쇠/);assert.equal(input.value,value);enter(input,before);
  }
  await btn(app.root,'초안 저장').onclick();assert.equal(app.calls.filter(call=>call.action==='save').length,1);assert.equal(validDisplayDocument(app.server.document),true);
});

test('restore copies only to the draft and stopping uses the explicit release UUID',async()=>{
  const app=setup({releases:[{id:releaseId,startsAt:'2026-10-01T00:00:00Z',endsAt:null,createdAt:'2026-10-01T00:00:00Z',stopped:false,cancelled:false,reason:'기존 발행'}]});await app.render();reason(app);
  await btn(app.root,'이 버전으로 초안 복구').onclick();assert.equal(app.calls.at(-1).action,'restore');assert.equal(app.calls.at(-1).body.releaseId,releaseId);assert.equal(app.calls.filter(call=>call.action==='publish').length,0);assert.equal(app.server.document.footerNote,'복구된 초안');
  reason(app,'현재 발행 중단 검토');await btn(app.root,'이 발행본 게시 중단').onclick();assert.equal(app.calls.at(-1).action,'stop');assert.equal(app.calls.at(-1).body.releaseId,releaseId);
});

test('unknown mutation outcomes retain exact action/body/key across leave and reopen',async()=>{
  let uncertain=true;const app=setup({handler(action){if(action==='save'&&uncertain)throw Object.assign(Error('NETWORK'),{status:503});}});await app.render();enter(field(app.root,'푸터 추가 안내 (최대 300자)'),'원본 변경');reason(app);await btn(app.root,'초안 저장').onclick();const first=clone(app.calls.find(call=>call.action==='save').body);
  assert.equal(field(app.root,'푸터 추가 안내 (최대 300자)').disabled,true);app.c.AdminDisplay.leave();assert.equal(app.root.children.length,0);await app.render();assert(btn(app.root,'같은 요청 다시 확인'));uncertain=false;await btn(app.root,'같은 요청 다시 확인').onclick();
  assert.deepEqual(app.calls.filter(call=>call.action==='save').map(call=>call.body),[first,first]);assert.equal(app.server.document.footerNote,'원본 변경');
});

test('revision conflicts preserve the draft but require explicit latest reload before new edits',async()=>{
  const app=setup({handler(action){if(action==='save')throw Object.assign(Error('DISPLAY_CONFLICT'),{status:409});}});await app.render();enter(field(app.root,'푸터 추가 안내 (최대 300자)'),'보존할 수정');reason(app);await btn(app.root,'초안 저장').onclick();assert.equal(field(app.root,'푸터 추가 안내 (최대 300자)').value,'보존할 수정');assert.equal(btn(app.root,'초안 저장').disabled,true);assert(btn(app.root,'최신 초안 불러오기'));
  await btn(app.root,'최신 초안 불러오기').onclick();assert.equal(field(app.root,'푸터 추가 안내 (최대 300자)').value,'');assert.equal(btn(app.root,'초안 저장').disabled,false);
});

test('same-owner unsaved content survives leaving while logout/reset erases all ownership state',async()=>{
  const app=setup();await app.render();enter(field(app.root,'푸터 추가 안내 (최대 300자)'),'유지할 초안');app.c.AdminDisplay.leave();assert.equal(app.root.children.length,0);await app.render();assert.equal(field(app.root,'푸터 추가 안내 (최대 300자)').value,'유지할 초안');
  app.c.AdminDisplay.reset();await app.render();assert.equal(field(app.root,'푸터 추가 안내 (최대 300자)').value,'');enter(field(app.root,'푸터 추가 안내 (최대 300자)'),'관리자A');app.setActor({userId:'admin-b',accountServiceReady:true,admin:{role:'SUPER_ADMIN',is_active:true}});await app.render();assert.equal(field(app.root,'푸터 추가 안내 (최대 300자)').value,'');
});

test('late reads and writes cannot repopulate a reset or different administrator workspace',async()=>{
  const readGate=deferred(),app=setup({handler(action){if(action==='get')return readGate.promise;}}),rendering=app.render();app.c.AdminDisplay.reset();readGate.resolve(app.get());await rendering;assert.equal(app.root.children.length,0);
  const writeGate=deferred(),writer=setup({handler(action){if(action==='save')return writeGate.promise;}});await writer.render();reason(writer);const saving=btn(writer.root,'초안 저장').onclick();writer.c.AdminDisplay.reset();writeGate.resolve({...writer.get(),saved:true});await saving;assert.equal(writer.root.children.length,0);
});

test('malformed server documents fail closed and never render arbitrary fields or navigation',async()=>{
  const doc=document();doc.menus[0].visible=false;const app=setup({doc});await app.render();assert.equal(btn(app.root,'초안 저장'),undefined);assert.match(app.root.textContent,/확인하지 못했/);
  const dangerous=document();dangerous.notices=[{id:selectionId,title:'안내',body:'내용',href:'//evil.test',startsAt:null,endsAt:null,enabled:true}];const other=setup({doc:dangerous});await other.render();assert.equal(all(other.root).filter(node=>node.tag==='a').length,0);
});

test('display CMS styles parse and remain isolated to the administrator workspace',async()=>{
  const result=await transform(css,{loader:'css'});assert.deepEqual(result.warnings,[]);
  for(const [,selector]of css.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{[^{}]*\}/g)){
    if(selector.trim().startsWith('@'))continue;
    for(const part of selector.trim().split(/,\s*(?![^()]*\))/))assert.match(part,/^#view-admin-cms\s/);
  }
  assert.doesNotMatch(css,/@import|url\(|@font-face|position:\s*fixed|overflow(?:-x)?:\s*hidden/i);
  assert.doesNotMatch(css,/#(?:[a-f\d]{3}){1,2}\b|rgba?\(/i);
});

test('display controls retain readable theme roles, touch targets and keyboard focus',()=>{
  for(const token of ['text-primary','text-secondary','text-strong','border-focus','bg-elevated','control-border'])assert(css.includes('var(--'+token+')'));
  assert.match(css,/\.display-field\s+:is\(input, select, textarea\)\s*\{[^}]*min-height:\s*44px/);
  assert.match(css,/\.display-actions\s+:is\(button, a\)[^{]*\{[^}]*min-height:\s*44px/);
  assert.match(css,/\.display-details\s*>\s*summary\s*\{[^}]*display:\s*list-item[^}]*min-height:\s*44px/);
  assert.match(css,/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--border-focus\)/);
  assert.match(css,/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test('display editing and previews adapt without clipping mobile controls',()=>{
  assert.match(css,/\.display-editor-grid\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  const mobile=css.slice(css.indexOf('@media (max-width: 800px)'));
  assert.match(mobile,/\.display-editor-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(mobile,/\.display-actions\s+:is\(button, a\)\s*\{[^}]*flex:\s*1 1 140px/);
  assert.match(css,/\.display-notice\s*\{[^}]*white-space:\s*pre-wrap/);
});
