import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../public/js/creator/creator-works.js',import.meta.url),'utf8');
const work={id:'30',title:'제목',description:'',genre:[],tags:[],rating:'ALL',ai_usage_type:'NONE',visibility:'PRIVATE',serial_state:'ONGOING',moderation_state:'CLEAR',version:'1',publication_missing:['소개'],episode_count:0};
function setup({storage=new Map(),path='/creator/works',responses=[]}={}){
  const children=new Map(),calls=[];let actor={userId:'user-a',author:{id:1}};
  const node=id=>{if(!children.has(id))children.set(id,{id,textContent:'',disabled:false});return children.get(id);};
  const root={html:'',set innerHTML(value){this.html=value;children.clear();},get innerHTML(){return this.html;},
    querySelector(selector){if(selector.startsWith('#')&&this.html.includes('id="'+selector.slice(1)+'"'))return node(selector.slice(1));return null;},querySelectorAll(){return [];}};
  const count={textContent:''};
  const context={console,crypto:{randomUUID},location:{pathname:path},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    document:{getElementById:id=>id==='creatorWorksContainer'?root:id==='creatorWorksCount'?count:node(id)},
    WebNovelsAuth:{getActor:()=>actor,api:async(path,options)=>{calls.push({path,options});const response=responses.shift();if(response instanceof Error)throw response;return response||{works:[],nextCursor:null};}},
    FormData:class{constructor(form){return form.values||[];}},confirm:()=>true,navigateTo:()=>{}};
  context.window=context;vm.createContext(context);vm.runInContext(source,context);
  return {ui:context.CreatorWorks,context,root,count,storage,calls,node,responses,setActor:v=>{actor=v;}};
}
test('empty list differs from unavailable; retry restores real list and cursor appends',async()=>{
  const s=setup({responses:[{works:[],nextCursor:null},new Error('offline'),{works:[work],nextCursor:'30'},{works:[{...work,id:'31'}],nextCursor:null}]});
  await s.ui.loadFromRoute();assert.match(s.root.innerHTML,/첫 작품 등록하기/);
  await s.ui.loadFromRoute();assert.match(s.root.innerHTML,/role="alert"/);assert.doesNotMatch(s.root.innerHTML,/첫 작품 등록하기/);assert.equal(s.count.textContent,'목록 확인 실패');
  await s.root.querySelector('#cwRetry').onclick();assert.match(s.root.innerHTML,/cwMore/);
  await s.root.querySelector('#cwMore').onclick();assert.match(s.root.innerHTML,/data-work-id="30"/);assert.match(s.root.innerHTML,/data-work-id="31"/);
  assert.equal(s.calls.at(-1).path,'/api/v2/creator/works?filter=all&after=30');
});
test('uncertain create persists same key/title across reload; success permits a distinct same-title work',async()=>{
  const storage=new Map();const first=setup({storage,responses:[new Error('lost reply')]});
  await assert.rejects(first.ui.create('같은제목'));const initial=first.calls[0].options;
  const second=setup({storage,responses:[{work},{work:{...work,id:'31'}}]});
  await second.ui.create('수정한제목');assert.equal(second.calls[0].options.headers['Idempotency-Key'],initial.headers['Idempotency-Key']);assert.equal(second.calls[0].options.body,initial.body);assert.equal(storage.size,0);
  await second.ui.create('같은제목');assert.notEqual(second.calls[1].options.headers['Idempotency-Key'],initial.headers['Idempotency-Key']);
});
test('titles and descriptions escaped; default cover uses title; no administrator form dependency',()=>{
  const s=setup();const attack={...work,title:'<img src=x onerror=alert(1)>',description:'</textarea><script>bad</script>',cover_image:'javascript:alert(1)'};
  assert.doesNotMatch(s.ui.renderCard(attack),/<img src=x/);assert.match(s.ui.renderCard(attack),/cw-default-cover/);
  const html=s.ui.renderDetail(attack,[],'settings');assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(source,/openAdminCreateWorkModal|handleAdminCreateWorkSubmit|SAMPLE_WORKS|createWorkInDB/);
});
test('detail URL uses server ID; conflict keeps form content and requires explicit reload',async()=>{
  const conflict=Object.assign(new Error('conflict'),{code:'WORK_CONFLICT',status:409});
  const s=setup({path:'/creator/works/9007199254740993/settings',responses:[{work:{...work,id:'9007199254740993'},episodes:[]},conflict]});
  await s.ui.loadFromRoute();assert.equal(s.calls[0].path,'/api/v2/creator/works/9007199254740993');
  const form=s.root.querySelector('#cwSettings');form.values=[['title','내 수정'],['description','유지할 소개'],['genre','판타지'],['tags','성장, 성장'],['rating',''],['ai_usage_type',''],['serial_state','HIATUS']];
  const html=s.root.innerHTML;await form.onsubmit({preventDefault(){}});
  assert.equal(s.root.innerHTML,html);assert.match(s.node('cwMessage').textContent,/입력 내용은 유지/);
  const data=JSON.parse(s.calls[1].options.body);assert.equal(data.version,'1');assert.equal(data.description,'유지할 소개');assert.deepEqual(data.tags,['성장']);assert.ok(!('rating'in data));
});
test('late list response after account change cannot populate private UI',async()=>{
  const s=setup();let resolve;s.context.WebNovelsAuth.api=()=>new Promise(r=>{resolve=r;});
  const pending=s.ui.loadFromRoute();s.setActor(null);s.ui.reset();resolve({works:[work],nextCursor:null});await pending;
  assert.match(s.root.innerHTML,/작가 로그인/);assert.doesNotMatch(s.root.innerHTML,/data-work-id/);
});
test('saved metadata is also escaped in the existing reader catalog card',async()=>{
  const source=await readFile(new URL('../public/js/reader/reader.js',import.meta.url),'utf8');
  const ast=ts.createSourceFile('reader.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='renderCdgWorkCardHtml');
  const context={getWorkCover:()=>'/cover.png',getAuthorName:()=>'',escapeHtml:value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
  vm.createContext(context);vm.runInContext(fn.getText(ast),context);
  const html=context.renderCdgWorkCardHtml({id:1,title:'" onmouseover="bad <img src=x>',genre:'<script>bad</script>'});
  assert.doesNotMatch(html,/title="" onmouseover=/);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;img src=x&gt;/);
});
