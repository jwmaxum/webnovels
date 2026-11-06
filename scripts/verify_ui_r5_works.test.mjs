import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {parseFragment} from 'parse5';

const source=await readFile(new URL('../public/js/creator/creator-works.js',import.meta.url),'utf8');
const work=(extra={})=>({id:'9007199254740993',title:'실제 작품',description:'소개',genre:['로맨스'],tags:['romance'],content_type:'NOVEL',
  visibility:'PRIVATE',serial_state:'ONGOING',moderation_state:'CLEAR',version:'7',episode_count:3,publication_missing:[],rating:'ALL',rating_confirmed:true,ai_usage_type:'NONE',ai_confirmed:true,...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture({path='/creator/works',responses=[]}={}){
  const all=[],calls=[],drafts=[],files=[],publications=[],navigations=[],confirms=[],storage=new Map();let who={userId:'auth-a',author:{id:'70',status:'APPROVED'}};
  const text=node=>node.nodeName==='#text'?node.value:(node.childNodes||[]).map(text).join('');
  function element(attrs={},tagName='div'){
    const values=new Map(Object.entries(attrs));return {tagName,values,dataset:Object.fromEntries(Object.entries(attrs).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value])),
      textContent:'',disabled:values.has('disabled'),value:values.get('value')||'',getAttribute:key=>values.get(key)??null,setAttribute:(key,value)=>values.set(key,String(value)),
      append(...children){this.children=(this.children||[]).concat(children);},focus(){this.focused=true;}};
  }
  function matches(node,selector){
    if(selector.startsWith('#'))return node.getAttribute('id')===selector.slice(1);
    const attr=selector.match(/^\[([\w-]+)\]$/);if(attr)return node.getAttribute(attr[1])!==null;
    const typed=selector.match(/^button\[type="([^"]+)"\]$/);return typed?node.tagName==='button'&&node.getAttribute('type')===typed[1]:node.tagName===selector;
  }
  const root={html:'',attrs:{},children:[],set innerHTML(html){this.html=html;all.length=0;this.children=[];const walk=node=>{
    if(node.tagName){const item=element(Object.fromEntries(node.attrs.map(attr=>[attr.name,attr.value])),node.tagName);item.textContent=text(node);all.push(item);}
    for(const child of node.childNodes||[])walk(child);
  };walk(parseFragment(html));},get innerHTML(){return this.html;},setAttribute(key,value){this.attrs[key]=String(value);},getAttribute(key){return this.attrs[key]??null;},append(node){this.children.push(node);},
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;},querySelectorAll(selector){return all.filter(node=>selector.split(',').some(part=>matches(node,part.trim())));}};
  const count=element(),other=new Map(),context={console,crypto:{randomUUID},location:{pathname:path},WEBNOVELS_CONFIG:{authorFilesEnabled:true,webtoonServiceEnabled:true},
    sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    document:{getElementById:id=>id==='creatorWorksContainer'?root:id==='creatorWorksCount'?count:root.querySelector('#'+id)||other.get(id)||null,createElement:tag=>element({},tag)},
    WebNovelsAuth:{getActor:()=>who,api:async(path,options)=>{calls.push({path,options});const value=responses.shift();if(value instanceof Error)throw value;return value||{works:[],nextCursor:null};}},
    CreatorDraftEditor:{openWork:async(...args)=>drafts.push(args)},CreatorFiles:{open:(...args)=>files.push(args)},CreatorPublications:{open:async(...args)=>publications.push(args)},
    FormData:class{constructor(form){return form.formValues||[];}},confirm:message=>{confirms.push(message);return true;},navigateTo:path=>navigations.push(path)};
  context.window=context;vm.createContext(context);vm.runInContext(source,context,{filename:'creator-works.js'});
  return {context,root,count,calls,drafts,files,publications,navigations,confirms,responses,storage,ui:context.CreatorWorks,setActor:actor=>who=actor,setPath:path=>context.location.pathname=path};
}
const settingsValues=()=>[['title','수정 제목'],['description','수정 소개'],['genre','로맨스'],['tags','romance'],['rating','ALL'],['ai_usage_type','NONE'],['serial_state','ONGOING']];

test('real work card enters the existing draft chooser with exact bigint identity and exposes settings separately',async()=>{
  const app=fixture({responses:[{works:[work({content_type:'WEBTOON',cover_image:'/covers/real.webp'})],nextCursor:null}]});await app.ui.loadFromRoute();
  assert.match(app.root.innerHTML,/웹툰 · 비공개 \/ 초안 · 연재 중 · 등록 회차 3개/);
  await app.root.querySelector('[data-write-work-id]').onclick();assert.deepEqual(app.drafts,[['9007199254740993']],'no fresh flag or silent new draft');
  app.root.querySelector('[data-work-id]').onclick();assert.equal(app.navigations.at(-1),'/creator/works/9007199254740993/settings');
  app.root.querySelector('[data-open-work-id]').onclick();assert.equal(app.navigations.at(-1),'/creator/works/9007199254740993');
  assert.equal(app.root.getAttribute('aria-busy'),'false');assert.equal(app.calls.length,1);
});

test('detail keeps one direct write action on settings and cover uses the existing work-owned upload entry',async()=>{
  const app=fixture({path:'/creator/works/9007199254740993/settings',responses:[{work:work(),episodes:[]}]});await app.ui.loadFromRoute();
  assert.equal(app.root.querySelectorAll('#cwDrafts').length,1);await app.root.querySelector('#cwDrafts').onclick();app.root.querySelector('#cwCover').onclick();
  assert.deepEqual(app.drafts,[['9007199254740993']]);assert.deepEqual(JSON.parse(JSON.stringify(app.files)),[['9007199254740993',{section:'cover'}]]);
  assert.match(app.root.innerHTML,/studio-work-actions/);assert.match(app.root.innerHTML,/<details class="studio-work-more"/);
});

test('published settings and removal are review requests while the original PATCH, POST and revision payloads remain intact',async()=>{
  const published=work({visibility:'PUBLIC',hasPublicationHistory:true});
  const app=fixture({path:'/creator/works/9007199254740993/settings',responses:[{work:published,episodes:[]},{reviewRequired:true},{work:published,episodes:[]},{reviewRequired:true},{work:published,episodes:[]}]});
  await app.ui.loadFromRoute();assert.equal(app.root.querySelector('button[type="submit"]').textContent,'수정 검토 요청');
  assert.equal(app.root.querySelector('#cwTrash').textContent,'삭제 검토 요청');assert.equal(app.root.querySelector('#cwPrivate').textContent,'공개 중단 검토 요청');
  const form=app.root.querySelector('#cwSettings');form.formValues=settingsValues();await form.onsubmit({preventDefault(){}});
  assert.equal(app.calls[1].options.method,'PATCH');assert.equal(app.calls[1].path,'/api/v2/creator/works/9007199254740993');
  assert.deepEqual(JSON.parse(app.calls[1].options.body),{title:'수정 제목',description:'수정 소개',genre:['로맨스'],tags:['romance'],rating:'ALL',ai_usage_type:'NONE',serial_state:'ONGOING',version:'7'});
  await app.root.querySelector('#cwTrash').onclick();assert.match(app.confirms.at(-1),/삭제 검토를 요청할까요\? 승인 전까지 기존 공개본은 유지/);
  assert.equal(app.calls[3].options.method,'POST');assert.equal(app.calls[3].path,'/api/v2/creator/works/9007199254740993/trash');assert.deepEqual(JSON.parse(app.calls[3].options.body),{version:'7'});
  assert.match(app.root.querySelector('#cwMessage').textContent,/검토 요청을 접수/);
});

test('private publication history still requires review; private drafts and trash restoration retain normal labels',()=>{
  const app=fixture();const publicHistory=app.ui.renderDetail(work({visibility:'PRIVATE',hasPublicationHistory:true}),[],'settings');
  assert.match(publicHistory,/>수정 검토 요청</);assert.match(publicHistory,/>삭제 검토 요청</);
  const draft=app.ui.renderDetail(work({episode_count:10,hasPublicationHistory:false}),[],'settings');
  assert.match(draft,/>설정 저장</);assert.match(draft,/>휴지통으로 이동</);assert.doesNotMatch(draft,/>삭제 검토 요청</,'episode count alone cannot infer publication');
  assert.match(app.ui.renderDetail(work({trashed_at:'2026-10-31T00:00:00Z',hasPublicationHistory:false}),[],'settings'),/>비공개로 복구</);
});

test('restricted and trashed works do not expose an enabled writing or cover action',async()=>{
  for(const extra of [{trashed_at:'2026-10-31T00:00:00Z'},{moderation_state:'RESTRICTED'}]){
    const app=fixture({path:'/creator/works/9007199254740993',responses:[{work:work(extra),episodes:[]}]});await app.ui.loadFromRoute();
    assert.equal(app.root.querySelector('#cwDrafts').disabled,true);assert.equal(app.root.querySelector('#cwCover').disabled,true);
    await app.root.querySelector('#cwDrafts').onclick();await app.root.querySelector('#cwCover').onclick();assert.equal(app.drafts.length,0);assert.equal(app.files.length,0);
  }
});

test('a previous actor cannot use stale write, settings or mutation callbacks despite an identical pen name',async()=>{
  const app=fixture({path:'/creator/works/9007199254740993/settings',responses:[{work:work(),episodes:[]}]});await app.ui.loadFromRoute();
  const write=app.root.querySelector('#cwDrafts'),form=app.root.querySelector('#cwSettings'),trash=app.root.querySelector('#cwTrash');form.formValues=settingsValues();
  app.setActor({userId:'auth-b',author:{id:'90',status:'APPROVED',pen_name:'실제 작가'}});app.ui.reset();
  await write.onclick();await form.onsubmit({preventDefault(){}});await trash.onclick();assert.equal(app.drafts.length,0);assert.equal(app.calls.length,1);assert.equal(app.confirms.length,0);
  assert.match(app.root.innerHTML,/작가 로그인이 필요/);assert.equal(app.root.getAttribute('aria-busy'),'false');
});

test('failed and stale list loads never become an empty success or overwrite the current author',async()=>{
  const app=fixture({responses:[Object.assign(Error('offline'),{code:'DATABASE_UNAVAILABLE'})]});await app.ui.loadFromRoute();
  assert.match(app.root.innerHTML,/role="alert"/);assert.doesNotMatch(app.root.innerHTML,/첫 작품 등록하기/);assert.equal(app.count.textContent,'목록 확인 실패');
  const pending=deferred();app.responses.push(pending.promise);const old=app.ui.loadFromRoute();app.setActor(null);app.ui.reset();pending.resolve({works:[work()],nextCursor:null});await old;
  assert.match(app.root.innerHTML,/작가 로그인/);assert.doesNotMatch(app.root.innerHTML,/data-work-id/);assert.equal(app.root.getAttribute('aria-busy'),'false');
});

test('authored strings remain escaped and both work types stay available independently of previous publications',async()=>{
  const app=fixture({path:'/creator/works/new',responses:[{required:false}]});app.context.WEBNOVELS_CONFIG.webtoonServiceEnabled=false;
  app.setActor({userId:'auth-a',author:{id:'70',status:'APPROVED'},multiFormatWorksEnabled:true,authorWorkspaceReady:true});await app.ui.loadFromRoute();
  assert.match(app.root.innerHTML,/<option value="NOVEL"/);assert.match(app.root.innerHTML,/<option value="WEBTOON"/);assert.match(app.root.innerHTML,/기존 작품의 발행 이력과 관계없이/);
  const html=app.ui.renderCard(work({title:'"><script>attack()</script>',cover_image:'javascript:attack()',episode_count:null}));
  assert.doesNotMatch(html,/<script>|src="javascript:/);assert.match(html,/&lt;script&gt;/);assert.match(html,/등록 회차 확인 필요/);
  assert.doesNotMatch(app.ui.renderDetail(work({description:'</textarea><script>attack()</script>'}),[],'settings'),/<script>/);
});
