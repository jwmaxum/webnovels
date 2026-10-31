import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {parseFragment} from 'parse5';

const source=await readFile(new URL('../public/js/creator/creator-works.js',import.meta.url),'utf8');
const readiness=await readFile(new URL('../public/js/creator/creator-readiness.js',import.meta.url),'utf8');
const id='9007199254740993';
const work=(extra={})=>({id,title:'연재 시작',description:'작품 소개',genre:['로맨스'],tags:[],content_type:'NOVEL',visibility:'PRIVATE',hasPublicationHistory:false,serial_state:'ONGOING',moderation_state:'CLEAR',trashed_at:null,version:'7',episode_count:0,publication_missing:[],rating:'ALL',rating_confirmed:true,ai_usage_type:'NONE',ai_confirmed:true,...extra});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture({path='/creator/works/'+id+'/settings',responses=[{work:work(),episodes:[]}]}={}){
  const calls=[],drafts=[],files=[],navigations=[],confirms=[],answers=[],storage=new Map();let who={userId:'auth-a',author:{id:'70',status:'APPROVED'}};
  const text=n=>n.nodeName==='#text'?n.value:(n.childNodes||[]).map(text).join('');
  const match=(node,selector)=>{
    if(selector.startsWith('#'))return node.id===selector.slice(1);
    const attribute=selector.match(/^\[([\w-]+)\]$/);if(attribute)return node.attrs.has(attribute[1]);
    const typed=selector.match(/^button\[type="([^"]+)"\]$/);return typed?node.tagName==='button'&&node.attrs.get('type')===typed[1]:node.tagName===selector;
  };
  function element(attrs={},tagName='div'){
    const values=new Map(Object.entries(attrs));return {tagName,attrs:values,children:[],parent:null,id:values.get('id'),value:values.get('value')||'',disabled:values.has('disabled'),textContent:'',
      dataset:Object.fromEntries(Object.entries(attrs).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value])),
      append(...nodes){for(const node of nodes){this.children.push(node);node.parent=this;}},setAttribute(key,value){values.set(key,String(value));},getAttribute:key=>values.get(key)??null,
      focus(){this.focused=true;},closest(selector){let node=this;while(node){if(match(node,selector))return node;node=node.parent;}return null;},
      querySelectorAll(selector){const descendants=[];const walk=node=>{for(const child of node.children){if(selector.split(',').some(s=>match(child,s.trim())))descendants.push(child);walk(child);}};walk(this);return descendants;},querySelector(selector){return this.querySelectorAll(selector)[0]||null;}};
  }
  const root=element(),count=element();Object.defineProperty(root,'innerHTML',{get(){return this.html||'';},set(html){this.html=html;this.children=[];const walk=(n,parent)=>{
    let next=parent;if(n.tagName){next=element(Object.fromEntries(n.attrs.map(a=>[a.name,a.value])),n.tagName);next.textContent=text(n);if(n.tagName==='textarea')next.value=text(n);if(n.tagName==='select'){const options=(n.childNodes||[]).filter(o=>o.tagName==='option'),selected=options.find(o=>o.attrs.some(a=>a.name==='selected'))||options[0];next.value=selected?.attrs.find(a=>a.name==='value')?.value||'';}parent.append(next);}for(const child of n.childNodes||[])walk(child,next);};walk(parseFragment(html),this);}});
  const context={console,crypto:{randomUUID},location:{pathname:path},WEBNOVELS_CONFIG:{authorFilesEnabled:true,webtoonServiceEnabled:true},
    sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    document:{getElementById:key=>key==='creatorWorksContainer'?root:key==='creatorWorksCount'?count:root.querySelector('#'+key),createElement:tag=>element({},tag)},
    FormData:class{constructor(form){return form.querySelectorAll('input,textarea,select').filter(n=>n.attrs.has('name')&&!n.disabled).map(n=>[n.attrs.get('name'),n.value]);}},
    WebNovelsAuth:{getActor:()=>who,api:async(path,options)=>{calls.push({path,options});const response=responses.shift();if(response instanceof Error)throw response;if(response===undefined)throw Error('Unexpected API request');return response;}},
    CreatorDraftEditor:{openWork:async(...args)=>drafts.push(args)},CreatorFiles:{open:(...args)=>files.push(args)},
    navigateTo:path=>navigations.push(path),confirm:message=>{confirms.push(message);return answers.length?answers.shift():true;}};
  context.window=context;vm.createContext(context);vm.runInContext(readiness,context);vm.runInContext(source,context);
  return {context,ui:context.CreatorWorks,root,calls,drafts,files,navigations,confirms,answers,responses,storage,setActor:actor=>who=actor,
    field:key=>root.querySelector('#'+key),submit:write=>root.querySelector('#cwSettings').onsubmit({preventDefault(){},submitter:write?{id:'cwSaveAndWrite'}:null})};
}

test('registration retains title/type-only creation and explains the native three-step sequence',async()=>{
  const app=fixture({path:'/creator/works/new',responses:[{work:work()}]});await app.ui.loadFromRoute();
  assert.match(app.root.innerHTML,/aria-label="연재 시작 순서"/);assert.match(app.root.innerHTML,/aria-current="step">작품 등록/);
  assert.match(app.root.innerHTML,/유형은 변경할 수 없습니다/);await app.ui.create('새 작품');
  assert.deepEqual(JSON.parse(app.calls[0].options.body),{title:'새 작품'});assert.match(app.calls[0].options.headers['Idempotency-Key'],/^[0-9a-f-]{36}$/);
});

test('private settings distinguish publication requirements from optional tags and keep normal saving',async()=>{
  const incomplete=work({description:'',genre:[],rating_confirmed:false,ai_confirmed:false});
  const app=fixture({responses:[{work:incomplete,episodes:[]},{work:incomplete},{work:incomplete,episodes:[]}]});await app.ui.loadFromRoute();
  assert.equal(app.field('cwRating').value,'');assert.equal(app.field('cwAI').value,'');assert.equal(app.field('cwTags').closest('details').attrs.get('class'),'studio-optional');
  assert.match(app.root.innerHTML,/발행 전 필수/);assert.equal(app.field('cwSaveAndWrite').textContent,'저장하고 원고 작성');
  await app.submit(false);const data=JSON.parse(app.calls[1].options.body);assert.equal(data.description,'');assert.deepEqual(data.genre,[]);assert.ok(!Object.hasOwn(data,'rating'));assert.ok(!Object.hasOwn(data,'ai_usage_type'));assert.equal(app.drafts.length,0);
});

test('save-and-write normalizes tags, keeps the exact revision and opens the existing work after confirmed saving',async()=>{
  const app=fixture({responses:[{work:work(),episodes:[]},{work:work({version:'8'})},{work:work({version:'8',tags:['growth']}),episodes:[]}]});await app.ui.loadFromRoute();
  app.field('cwTags').value='성장, 성장';await app.submit(true);
  assert.equal(app.calls[1].options.method,'PATCH');assert.equal(app.calls[1].path,'/api/v2/creator/works/'+id);
  assert.deepEqual(JSON.parse(app.calls[1].options.body),{title:'연재 시작',description:'작품 소개',genre:['로맨스'],rating:'ALL',ai_usage_type:'NONE',tags:['growth'],serial_state:'ONGOING',version:'7'});
  assert.deepEqual(app.drafts,[[id]]);assert.equal(app.calls[2].path,'/api/v2/creator/works/'+id);assert.equal(app.navigations.length,0);
});

test('save-and-write focuses each missing required field without assuming a rating or AI choice',async()=>{
  for(const [field,value,message]of [['cwEditTitle','',/작품명/],['cwDescription',' ',/소개/],['cwGenre','',/장르/],['cwRating','',/이용등급/],['cwAI','',/AI 사용 표기/]]){
    const app=fixture();await app.ui.loadFromRoute();app.field(field).value=value;await app.submit(true);
    assert.equal(app.calls.length,1);assert.equal(app.drafts.length,0);assert.equal(app.field(field).focused,true);assert.equal(app.field(field).getAttribute('aria-invalid'),'true');assert.match(app.field('cwMessage').textContent,message);
  }
});

test('offline and version conflicts keep entered settings and never start a draft',async()=>{
  for(const error of [Error('offline'),Object.assign(Error('conflict'),{code:'WORK_CONFLICT',status:409})]){
    const app=fixture({responses:[{work:work(),episodes:[]},error]});await app.ui.loadFromRoute();app.field('cwDescription').value='보존할 소개';const form=app.field('cwSettings');await app.submit(true);
    assert.equal(app.field('cwSettings'),form);assert.equal(app.field('cwDescription').value,'보존할 소개');assert.equal(app.drafts.length,0);assert.equal(app.field('cwSaveAndWrite').disabled,false);
  }
});

test('a canonical review receipt never becomes a save-and-write success',async()=>{
  const app=fixture({responses:[{work:work(),episodes:[]},{reviewRequired:true},{work:work(),episodes:[]}]});await app.ui.loadFromRoute();await app.submit(true);
  assert.equal(app.drafts.length,0);assert.match(app.field('cwMessage').textContent,/변경 검토 요청/);
});

test('double submission makes one revision update and retains the busy navigation lock',async()=>{
  const saving=deferred(),app=fixture({responses:[{work:work(),episodes:[]},saving.promise,{work:work({version:'8'}),episodes:[]}]});await app.ui.loadFromRoute();
  const originalFieldset=app.field('cwSettings').querySelector('fieldset');assert.equal(originalFieldset.disabled,false);
  const first=app.submit(true);assert.equal(originalFieldset.disabled,true,'the native fieldset blocks typing while PATCH is unresolved');await app.submit(true);await app.field('cwBack').onclick();assert.equal(app.calls.length,2);assert.equal(app.navigations.length,0);assert.equal(app.confirms.length,0);
  saving.resolve({work:work({version:'8'})});await first;assert.deepEqual(app.drafts,[[id]]);
});

test('failed opening preserves the completed save and unlocks only the current settings without repeating PATCH',async()=>{
  const app=fixture({responses:[{work:work(),episodes:[]},{work:work({version:'8'})},{work:work({version:'8'}),episodes:[]}]});await app.ui.loadFromRoute();
  const opening=deferred();app.context.CreatorDraftEditor.openWork=()=>opening.promise.then(()=>{throw Error('editor unavailable');});
  const pending=app.submit(true);await new Promise(resolve=>setImmediate(resolve));const fieldset=app.field('cwSettings').querySelector('fieldset');assert.equal(fieldset.disabled,true,'fresh settings remain locked until the writer resolves');
  opening.resolve();await pending;assert.equal(fieldset.disabled,false);assert.equal(app.calls.filter(call=>call.options?.method==='PATCH').length,1);assert.match(app.field('cwMessage').textContent,/설정은 저장되었습니다.*원고 작성 버튼/);
});

test('late saving and reload replies cannot open a work after actor or epoch changes',async()=>{
  const saving=deferred(),app=fixture({responses:[{work:work(),episodes:[]},saving.promise]});await app.ui.loadFromRoute();const pending=app.submit(true);
  app.setActor({userId:'auth-b',author:{id:'80',status:'APPROVED'}});app.ui.reset();saving.resolve({work:work()});await pending;assert.equal(app.calls.length,2);assert.equal(app.drafts.length,0);
  const reloading=deferred(),other=fixture({responses:[{work:work(),episodes:[]},{work:work()},reloading.promise]});await other.ui.loadFromRoute();const late=other.submit(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(other.calls.length,3);
  other.ui.reset();reloading.resolve({work:work(),episodes:[]});await late;assert.equal(other.drafts.length,0);assert.match(other.root.innerHTML,/작가 로그인/);
});

test('same-account author approval revocation during saving cannot auto-open the writer',async()=>{
  const saving=deferred(),app=fixture({responses:[{work:work(),episodes:[]},saving.promise,{work:work({version:'8'}),episodes:[]}]});
  await app.ui.loadFromRoute();const pending=app.submit(true);
  app.setActor({userId:'auth-a',author:{id:'70',status:'SUSPENDED'}});
  saving.resolve({work:work({version:'8'})});await pending;
  assert.equal(app.drafts.length,0);assert.equal(app.field('cwSaveAndWrite'),null);
});

test('programmatic genre choices are protected on write, back, tabs, cover and reload without relying on input events',async()=>{
  for(const target of ['cwDrafts','cwBack','tab','cwCover','cwReload']){
    const app=fixture();await app.ui.loadFromRoute();const choice=app.root.querySelectorAll('[data-choice-field]').find(node=>node.dataset.choiceField==='genre'&&node.dataset.choiceValue==='판타지');choice.onclick();app.answers.push(false);
    const form=app.field('cwSettings');const button=target==='tab'?app.root.querySelector('[data-detail-tab]'):app.field(target);await button.onclick();
    assert.equal(app.confirms.length,1);assert.equal(app.field('cwSettings'),form);assert.match(app.field('cwGenre').value,/판타지/);assert.equal(app.calls.length,1);assert.equal(app.drafts.length+app.files.length+app.navigations.length,0);assert.match(app.field('cwMessage').textContent,/입력한 작품 정보를 유지/);
  }
});

test('clean settings need no discard prompt; explicit discard permits only the requested navigation',async()=>{
  const clean=fixture();await clean.ui.loadFromRoute();await clean.field('cwDrafts').onclick();assert.equal(clean.confirms.length,0);assert.deepEqual(clean.drafts,[[id]]);
  const changed=fixture();await changed.ui.loadFromRoute();changed.field('cwDescription').value='다른 소개';changed.answers.push(true);await changed.field('cwCover').onclick();assert.equal(changed.confirms.length,1);assert.deepEqual(JSON.parse(JSON.stringify(changed.files)),[[id,{section:'cover'}]]);assert.equal(changed.calls.length,1);
});

test('public history, restricted and trashed settings do not offer or accept save-and-write',async()=>{
  for(const extra of [{hasPublicationHistory:true},{visibility:'PUBLIC',hasPublicationHistory:true},{moderation_state:'RESTRICTED'},{trashed_at:'2026-10-31T00:00:00Z'}]){
    const app=fixture({responses:[{work:work(extra),episodes:[]}]});await app.ui.loadFromRoute();assert.equal(app.field('cwSaveAndWrite'),null);await app.submit(true);assert.equal(app.calls.length,1);assert.equal(app.drafts.length,0);
  }
});

test('stale settings callbacks cannot ask for discard or send writes for a replacement author',async()=>{
  const app=fixture();await app.ui.loadFromRoute();const write=app.field('cwDrafts'),form=app.field('cwSettings');app.field('cwDescription').value='미저장';
  app.setActor(null);app.ui.reset();await write.onclick();await form.onsubmit({preventDefault(){},submitter:{id:'cwSaveAndWrite'}});assert.equal(app.confirms.length,0);assert.equal(app.calls.length,1);assert.equal(app.drafts.length,0);
});
