import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {parse} from 'parse5';
import {transform} from 'esbuild';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const reader=await read('public/js/reader/reader.js'),app=await read('public/app.js'),router=await read('public/js/core/router.js'),html=await read('public/index.html'),css=await read('public/css/reader-experience.css');
const errors=[],dom=parse(html,{onParseError:error=>errors.push(error)}),all=[];
const visit=node=>{if(node.tagName)all.push(node);for(const child of node.childNodes||[])visit(child);};visit(dom);
const attr=(node,key)=>node?.attrs?.find(a=>a.name===key)?.value,byId=id=>all.find(node=>attr(node,'id')===id);
const contains=(root,node)=>{for(let at=node;at;at=at.parentNode)if(at===root)return true;return false;};
class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.attrs={};this.style={};this.dataset={};this._text='';this.hidden=false;this.disabled=false;this.listeners=new Map();this.classes=new Set();this.classList={add:k=>this.classes.add(k),remove:k=>this.classes.delete(k),contains:k=>this.classes.has(k),toggle:(k,on)=>on?this.classes.add(k):this.classes.delete(k)};}
  set textContent(value){this._text=String(value??'');this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set innerHTML(_){throw Error('Reader authored text must not become HTML');}
  append(...children){this.children.push(...children);}replaceChildren(...children){this._text='';this.children=[...children];}
  setAttribute(key,value){this.attrs[key]=String(value);}getAttribute(key){return key==='href'?this.href:this.attrs[key]??null;}removeAttribute(key){delete this.attrs[key];}
  addEventListener(key,fn){this.listeners.set(key,fn);}focus(){this.focused=true;}
}
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(){
  const nodes=new Map(),details=[],paths=[],toasts=[],writes=[];let generation=0,current=null;
  const node=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  const context={URL,URLSearchParams,console:{warn(){}},Map,Set,Date,Math,Number,Promise,
    document:{getElementById:node,createElement:tag=>new Element(tag),querySelector:()=>null,querySelectorAll:()=>[]},
    WEBNOVELS_CONFIG:{authorPublishEnabled:true,readerServiceEnabled:true},currentActiveView:'view-reader',activeWork:null,
    location:{pathname:'/read/10/5',origin:'https://reader.test'},history:{pushState(_s,_t,path){paths.push(path);}},
    WebNovelsAuth:{getActor:()=>null},ReaderCatalog:{active:()=>true,async reading(id,number){return {work:{id,title:'작품 '+id,contentType:'NOVEL',episodes:[]},episode:{id:'105',episodeNumber:number,title:'실제 회차',isFree:true},previous:{episodeNumber:2},next:{episodeNumber:9}};},async home(){return {sections:{recommended:[]}};}},
    ReaderSession:{begin(id,number){current={generation:++generation,workId:id,episodeNumber:number};return current;},valid:s=>s===current&&s.generation===generation,get current(){return current;},leave(){current=null;}},
    ReaderContent:{render(body,comment,snapshot){body.textContent=snapshot.content;comment.textContent=snapshot.authorComment;}},
    ReaderPreferencesManager:{apply(){}},ReaderPosition:{restore:()=> 'NONE'},
    fetch:async()=>({ok:true,json:async()=>({versionId:'11111111-1111-4111-8111-111111111111',episode:{content:'원본 본문'}})}),
    switchWebNovelsView:view=>context.currentActiveView=view,openWorkDetailDirect:id=>details.push(String(id)),
    showToast:text=>toasts.push(text),loadEpisodeComments(){},renderReaderRecommendations(){},selectParagraphComment(){},
    scrollTo(){},addEventListener(){},removeEventListener(){},setTimeout(){},clearTimeout(){},
    getPublishedWorks:()=>[],getWorkCover:()=>'/cover.webp',getAuthorName:work=>work.author||'작가',localStorage:{getItem:()=>null,setItem(){}},ReaderHub:{active:()=>false,change:(...args)=>writes.push(args)}};
  context.window=context;vm.createContext(context);
  const start=reader.indexOf('window.openReaderDirect = async function');vm.runInContext(reader.slice(start,reader.indexOf('// 회차별 댓글 렌더링',start)),context);
  return {c:context,node,nodes,details,paths,toasts,writes};
}

test('detail/library/reader markup has unique IDs, real labels and no mock profile or cover',()=>{
  assert.deepEqual(errors,[]);const ids=all.map(n=>attr(n,'id')).filter(Boolean);assert.equal(new Set(ids).size,ids.length);
  for(const id of ['btnDetailReadFirst','btnStickyRead'])assert.equal(attr(byId(id),'disabled'),'');
  assert.equal(byId('detailSynopsis').tagName,'details');assert.equal(attr(byId('detailSynopsis'),'open'),'');
  assert(contains(byId('detailSynopsis'),byId('detailDescription')));assert.equal(attr(byId('detailCoverImg'),'src'),undefined);
  const text=node=>(node.childNodes||[]).map(child=>child.value||text(child)).join('');
  assert.equal(text(byId('myEmail')),'');assert.equal(text(byId('myNickname')),'회원 정보 확인 중');
  assert.equal(attr(byId('btnReaderSettings'),'aria-label'),'읽기 환경 설정');assert.equal(attr(byId('btnStickyHeart'),'aria-label'),'관심 작품 등록');
  for(const name of ['continue','favorites','authors','appeals']){
    const tab=byId('library-tab-'+name),panel=byId('libraryTab-'+name);assert.equal(attr(tab,'role'),'tab');assert.equal(attr(tab,'aria-controls'),attr(panel,'id'));assert.equal(attr(panel,'aria-labelledby'),attr(tab,'id'));
  }
  assert.equal(byId('readerRecommendHeading').childNodes[0].value,'편집 추천');assert.doesNotMatch(html,/이 작품과 함께 많이 본/);
});

test('reading layout uses document scroll, keeps manuscript properties and reserves uncropped webtoon geometry',async()=>{
  assert.deepEqual((await transform(css,{loader:'css'})).warnings,[]);
  assert.match(css,/#view-reader\.full-screen-reader \{[^}]*position: relative;[^}]*inset: auto;[^}]*overflow: visible/);
  assert.match(css,/body\[data-active-view="view-reader"\] :is\(\.legal-footer, #freeBetaNotice, #serviceStatus\) \{ display: none !important/);
  assert.doesNotMatch(css,/#readerBody|\.reader-paragraph|--reader-(?:font|line-height|paragraph-gap)\s*:/);
  assert.match(css,/#view-reader \.reader-container \{ max-width: 760px/);assert.match(css,/#view-reader #readerWebtoonViewer \{ max-width: 800px; width: 100%/);
  assert.doesNotMatch(css,/\.webtoon-panel img[^}]*object-fit:\s*cover/);
  assert.match(css,/\.webtoon-panel:has\(button:not\(\[hidden\]\)\) \.webtoon-panel-status[^}]*clip-path: inset\(50%\)/,'error text must not overlap the retry control');
  assert.match(css,/\n\.webtoon-panel-status \{ position: absolute/,'shared author preview status must not alter reserved panel geometry');
  assert.match(css,/\.webtoon-panel:has\(button:not\(\[hidden\]\)\) \{ overflow: visible/,'short failed cuts must not clip the retry target');
  assert(html.includes('/css/reader-experience.css?v=20261031r4'));
});

test('chapter loading errors provide a guarded retry and actual gap neighbours stay authoritative',async()=>{
  const f=fixture();f.c.currentActiveView='view-home';let failed=true;const original=f.c.ReaderCatalog.reading;
  f.c.ReaderCatalog.reading=(...args)=>failed?Promise.reject(Object.assign(Error('NOT_FOUND'),{status:404})):original(...args);
  await f.c.openReaderDirect('10',5);assert.match(f.node('readerChapterStatus').textContent,/공개된 회차를 찾을 수 없습니다/);
  assert.equal(f.c.currentActiveView,'view-reader','first load failure must show the retry surface');
  assert.equal(f.node('view-reader').getAttribute('aria-busy'),'false');assert.equal(f.node('btnNextEp').disabled,true);
  failed=false;await f.node('readerChapterStatus').children[1].onclick();assert.equal(f.node('readerBody').textContent,'원본 본문');
  f.node('btnReaderEpisodeList').onclick();assert.deepEqual(f.details,['10']);f.node('btnNextEp').onclick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.c.ReaderSession.current.episodeNumber,9);assert.equal(f.writes.length,0);
  const old=f.node('btnReaderEpisodes').onclick;f.c.ReaderSession.leave();old();assert.deepEqual(f.details,['10']);
});

test('late failed chapter requests cannot replace newer reading status or restore old retry actions',async()=>{
  const f=fixture(),late=defer(),original=f.c.ReaderCatalog.reading;f.c.ReaderCatalog.reading=(id,n)=>id==='10'?late.promise:original(id,n);
  const old=f.c.openReaderDirect('10',5);await f.c.openReaderDirect('20',9);late.reject(Error('network'));await old;
  assert.equal(f.node('readerChapterStatus').hidden,true);assert.equal(f.node('readerWorkTitle').textContent,'작품 20');assert.equal(f.node('view-reader').getAttribute('aria-busy'),'false');
});

test('recommendations reflect editorial source, safe text, distinct work IDs and modified link clicks',async()=>{
  const f=fixture(),token=f.c.ReaderSession.begin('10',5);f.c.getAuthorName=work=>work.author;
  f.c.ReaderCatalog.home=async()=>({sections:{recommended:[{id:'10',title:'현재 작품'},{id:'20',title:'<img onerror=1>',author:'<svg onload=1>',coverUrl:'/actual.webp'},{id:'20',title:'중복'}]}});
  const start=reader.indexOf('async function renderReaderRecommendations');vm.runInContext(reader.slice(start,reader.indexOf('// 🪙 포인트로 회차',start)),f.c);
  await f.c.renderReaderRecommendations('10');const card=f.node('readerRecommendGrid').children[0];assert.equal(f.node('readerRecommendGrid').children.length,1);
  assert.equal(card.children[1].textContent,'<img onerror=1>');assert.equal(card.children[2].textContent,'<svg onload=1>');assert.equal(card.href,'/works/20');
  let prevented=false;card.onclick({ctrlKey:true,preventDefault(){prevented=true;}});assert.equal(prevented,false);
  card.onclick({preventDefault(){prevented=true;}});assert.deepEqual(f.details,['20']);assert(f.c.ReaderSession.valid(token));
  f.c.ReaderCatalog.home=async()=>({sections:{recommended:[]}});await f.c.renderReaderRecommendations('10');assert.equal(f.node('readerRecommendBox').hidden,true);
});

test('every theme and reader preference still reaches the original paper and Word paragraph presentation',()=>{
  const f=fixture(),props=new Map(),paragraph=new Element();paragraph.dataset.paragraphIndex='7';
  f.c.document.documentElement={style:{setProperty:(key,value)=>props.set(key,value)}};f.c.document.querySelectorAll=selector=>selector==='#readerBody .reader-paragraph'?[paragraph]:[];
  const start=reader.indexOf('const DEFAULT_READER_PREFERENCES');vm.runInContext(reader.slice(start,reader.indexOf('// 기존 함수 하위 호환',start)),f.c);
  const prefs=f.c.ReaderPreferencesManager;
  for(const theme of ['theme-light','theme-dark','theme-oled','theme-sepia']){prefs.setTheme(theme);assert(f.node('view-reader').classList.contains(theme));}
  prefs.setFontFamily('sans');prefs.changeFontSize(4);prefs.setLineHeight(2.2);prefs.setPaddingX(36);prefs.setParagraphGap(1.6);
  assert.match(f.node('readerPaper').style.fontFamily,/Noto Sans KR/);assert.equal(f.node('readerPaper').style.fontSize,'22px');assert.equal(f.node('readerPaper').style.paddingLeft,'36px');
  assert.equal(paragraph.style.marginBottom,'1.6em');assert.equal(paragraph.dataset.paragraphIndex,'7');assert.equal(props.get('--reader-line-height'),'2.2');
});

test('library tabs support keyboard selection, skip hidden tabs, and persist their semantic URL',()=>{
  const f=fixture(),tabs=['continue','favorites','authors','appeals'].map(name=>{const el=new Element('button');el.dataset.libraryTab=name;el.hidden=name==='appeals';return el;});
  f.c.location={pathname:'/library',origin:'https://reader.test'};f.c.document.querySelectorAll=selector=>selector==='[data-library-tab]'?tabs:selector==='.library-tab-panel'?tabs.map(tab=>f.node('libraryTab-'+tab.dataset.libraryTab)):[];
  f.c.document.addEventListener=()=>{};f.c.document.readyState='loading';f.c.WebNovelsAuth={};
  vm.runInContext(app,f.c);f.c.bindWebNovelsEvents();tabs[0].listeners.get('keydown')({key:'ArrowRight',preventDefault(){}});
  assert.equal(tabs[1].getAttribute('aria-selected'),'true');assert.equal(tabs[1].tabIndex,0);assert.equal(tabs[0].tabIndex,-1);assert.equal(f.paths.at(-1),'/library/favorites');
  tabs[1].listeners.get('keydown')({key:'End',preventDefault(){}});assert.equal(tabs[2].getAttribute('aria-selected'),'true');assert.equal(f.paths.at(-1),'/library/authors');
});

test('legacy detail enables only the actual first public chapter and does not mislabel 15+ as adult',()=>{
  const f=fixture(),work={id:'10',title:'기존 공개 작품',author:'실제 작가',rating:'AGE_15',aiUsageType:'NONE',genre:'로맨스',contentType:'NOVEL',episodes:[{episodeNumber:9,title:'아홉화'},{episodeNumber:4,title:'첫 공개화'}]};
  f.c.ReaderDiscovery={active:()=>false};f.c.ReaderHub={active:()=>false};f.c.getPublishedWorks=()=>[work];f.c.updateFavoriteButtons=()=>{};f.c.updateSubscribeButtons=()=>{};
  const start=reader.indexOf('window.openWorkDetailDirect = function');vm.runInContext(reader.slice(start,reader.indexOf('\n};',start)+4),f.c);
  f.c.openWorkDetailDirect('10',false);assert.equal(f.node('btnDetailReadFirst').disabled,false);assert.match(f.node('btnDetailReadFirst').textContent,/4화/);
  assert.equal(f.node('detailRatingBadge').textContent,'15세 이상');assert.equal(f.node('detailEpisodeList').children[0].href,'/read/10/4');
});

test('library route restoration keeps aliases and never pushes history or selects after leaving',()=>{
  const f=fixture(),tabs=['continue','favorites','authors'].map(name=>{const el=new Element('button');el.dataset.libraryTab=name;return el;}),timers=[];
  f.c.document.querySelectorAll=selector=>selector==='[data-library-tab]'?tabs:[];f.c.document.addEventListener=()=>{};f.c.document.readyState='loading';
  f.c.currentActiveView='view-mypage';f.c.location={pathname:'/library/creators',search:'',origin:'https://reader.test'};f.c.routeRevision=3;f.c.setTimeout=fn=>timers.push(fn);
  vm.runInContext(app,f.c);f.c.bindWebNovelsEvents();
  const start=router.indexOf('function openLibraryTabDirect');vm.runInContext(router.slice(start,router.indexOf('window.openLibraryTabDirect =',start)),f.c);
  f.c.openLibraryTabDirect('authors',false);timers.shift()();assert.equal(f.paths.length,0);assert.equal(tabs[2].getAttribute('aria-selected'),'true');
  f.c.openLibraryTabDirect('favorites',false);f.c.routeRevision++;f.c.currentActiveView='view-home';f.c.location.pathname='/home';timers.shift()();
  assert.equal(f.paths.length,0);assert.equal(tabs[2].getAttribute('aria-selected'),'true');assert.notEqual(tabs[1].getAttribute('aria-selected'),'true');
});
