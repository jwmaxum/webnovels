import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const path=fileURLToPath(new URL('../public/js/creator/creator-readiness.js',import.meta.url)),source=await readFile(path,'utf8');
function setup(){const window={};vm.runInNewContext(source,{window},{filename:path});return {window,ui:window.CreatorReadiness};}
const work={id:'9007199254740993',publication_missing:[],rating:'ALL',moderation_state:'CLEAR',content_type:'NOVEL'};
const draft={id:'draft-uuid',revision:'3',seq:4,serverSeq:4,snapshot:{title:'title',content:'body'}};
test('guidance distinguishes missing metadata, unsynced draft, rights and feature readiness; covers are optional',()=>{
  const {ui}=setup(),config={authorFilesEnabled:true,authorPublishEnabled:true};
  const items=ui.workItems({...work,publication_missing:['소개','등급']},config);
  assert.equal(items.find(x=>x.label==='작품 정보').state,'pending');assert.match(items[0].detail,/소개, 등급/);
  assert.equal(items.find(x=>x.label==='표지·파일').state,'optional');
  assert.equal(ui.draftItems({...draft,serverSeq:3})[1].state,'pending');assert.equal(ui.draftItems({...draft,conflict:{}})[1].state,'blocked');
  assert.equal(ui.publicationItems(work,draft,false,config).at(-1).state,'pending');
  assert.ok(ui.publicationItems(work,draft,true,config).every(x=>x.state==='done'));
  assert.equal(ui.publicationItems(work,draft,true,{}).find(x=>x.label==='게시 기능').state,'blocked');
  for(const changed of [{rating:'AGE_19'},{content_type:'WEBTOON'},{trashed_at:'date'},{moderation_state:'RESTRICTED'}]){
    assert.equal(ui.workItems({...work,...changed},config).find(x=>x.label==='게시 범위').state,'blocked');
  }
  assert.equal(ui.workItems({...work,publication_missing:undefined},config)[0].state,'pending');
});
test('limited workspace does not advertise publishing or files even when global flags are true; HTML escapes metadata',()=>{
  const {ui,window}=setup();window.WebNovelsAuth={getActor:()=>({authorWorkspaceReady:true})};
  const items=ui.workItems({...work,publication_missing:['<img onerror=bad>']},{authorPublishEnabled:true,authorFilesEnabled:true});
  const html=ui.render(items,true);assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
  assert.equal(items.find(x=>x.label==='표지·파일').action,null);assert.equal(items.find(x=>x.label==='미리보기·게시').action,null);
  assert.doesNotMatch(html,/data-ready-action="files"|data-ready-action="publication"/);
});
test('canonical tags align with server dictionary; unrelated edits preserve legacy and custom values; no silent truncation',async()=>{
  const {ui}=setup(),server=await readFile(new URL('../src/config/tags.ts',import.meta.url),'utf8');
  for(const [slug,label]of ui.tags)assert.ok(server.includes(`slug: '${slug}', label: '${label}'`));assert.equal(ui.tags.length,32);
  assert.deepEqual(Array.from(ui.values('tags','회귀물, growth, My Custom',[])),['regression','growth','My Custom']);
  const legacy=['회귀','My Custom','未知'];assert.deepEqual(Array.from(ui.values('tags',legacy.join(', '),legacy)),legacy);
  assert.deepEqual(Array.from(ui.values('genre','현대 판타지, 무협, 기존장르',[])),['현대 판타지','무협','기존장르']);
  assert.throws(()=>ui.values('genre',Array.from({length:11},(_,i)=>'g'+i).join(','),[]),/INVALID_FIELD/);
});
test('choice buttons preserve custom entries, toggle pressed state and reject the eleventh item',()=>{
  const {ui}=setup(),input={value:'custom'},message={textContent:''};
  const button={dataset:{choiceField:'tags',choiceValue:'growth'},setAttribute(k,v){this[k]=v;}};
  const root={querySelectorAll:()=>[button],querySelector:id=>id==='#cwTags'?input:id==='#cwMessage'?message:null};
  ui.bindChoices(root);button.onclick();assert.equal(input.value,'custom, growth');assert.equal(button['aria-pressed'],true);
  button.onclick();assert.equal(input.value,'custom');assert.equal(button['aria-pressed'],false);
  input.value=Array.from({length:10},(_,i)=>'t'+i).join(', ');const before=input.value;button.onclick();assert.equal(input.value,before);assert.match(message.textContent,/최대 10개/);
  assert.match(ui.choices('tags',['growth']),/data-choice-value="growth" aria-pressed="true"/);
});
test('production script order loads readiness before its callers and offers same-work settings/retry controls',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const loader=await readFile(new URL('../public/js/core/role-modules.js',import.meta.url),'utf8');
  assert.ok(html.indexOf('role-modules.js')>=0 && html.indexOf('role-modules.js')<html.indexOf('router.js'));
  const readiness=loader.indexOf('creator-readiness.js');assert.ok(readiness>=0);
  for(const caller of ['creator-editor.js','creator-publications.js','creator-works.js'])assert.ok(readiness<loader.indexOf(caller));
  assert.match(html,/id="creatorDraftChecklist"/);assert.match(html,/id="btnDraftSettings"/);assert.match(html,/id="publicationRetry"/);
});
