import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {parse} from 'parse5';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const [fontSource,reader,position,content,manuscript,html]=await Promise.all(['public/js/reader/reader-fonts.js','public/js/reader/reader.js','public/js/reader/reader-position.js','public/js/reader/reader-content.js','public/js/shared/manuscript-document.js','public/index.html'].map(read));
const openSource=reader.slice(reader.indexOf('window.openReaderDirect = async function'),reader.indexOf('// 회차별 댓글 렌더링',reader.indexOf('window.openReaderDirect = async function')));
const prefsSource=reader.slice(reader.indexOf('const DEFAULT_READER_PREFERENCES'),reader.indexOf('// 기존 함수 하위 호환',reader.indexOf('const DEFAULT_READER_PREFERENCES')));
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const ticks=async()=>{for(let at=0;at<60;at++)await Promise.resolve();};
const version='11111111-1111-4111-8111-111111111111';
const documentSnapshot={version:1,paragraphs:[{align:'center',indent:0,runs:[{text:'제목',bold:true}]},{align:'left',indent:1,runs:[{text:'본문',italic:true},{text:' 밑줄',underline:true}]}]};

// Execute real font activation, preferences, Word renderer, ReaderSession and
// paragraph restoration. DOM, font completions and timers are local substitutes.
function fixture({missingLink=false,missingFonts=false,webtoon=false,check=true,savedVersion=version}={}){
 let c,now=0,timerId=0,actor={userId:'account-a',reader:{id:'profile-a'}},fontsSettled=false,enabled=0,readyReads=0;
 const elements=new Map(),events=new Map(),timers=new Map(),fontGate=gate(),scrolls=[],writes=[],routes=[],calls=[],fontChecks=[],storage=new Map();
 class Element{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attrs=new Map();this.classes=new Set();this.style={};this._text='';this.hidden=false;this.events=new Map();
   this.classList={add:name=>this.classes.add(name),remove:name=>this.classes.delete(name),contains:name=>this.classes.has(name),toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};
  }
  set className(value){this.classes=new Set(String(value).split(/\s+/));}get className(){return [...this.classes].join(' ');}
  set textContent(value){this._text=String(value??'');this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  append(...items){for(const item of items){if(item.tagName==='#FRAGMENT')this.append(...item.children);else{item.parentNode=this;this.children.push(item);}}}
  appendChild(node){this.append(node);return node;}
  replaceChildren(...items){this._text='';this.children=[];this.append(...items);}
  setAttribute(name,value){this.attrs.set(name,String(value));}getAttribute(name){return this.attrs.get(name)??null;}
  addEventListener(type,fn){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(fn);}
  removeEventListener(type,fn){this.events.get(type)?.delete(fn);}
  emit(type){for(const fn of [...(this.events.get(type)||[])])fn({type});}
  querySelectorAll(selector){const output=[];for(const child of this.children){if(selector==='.reader-paragraph'&&child.classes.has('reader-paragraph'))output.push(child);output.push(...child.querySelectorAll(selector));}return output;}
  getBoundingClientRect(){const height=fontsSettled?400:200,index=Number(this.dataset.paragraphIndex)||0,top=100+index*height-(c?.scrollY||0);return {top,bottom:top+height,height};}
  focus(){this.focused=true;}
 }
 const get=id=>{if(id==='readerFontStylesheet'&&missingLink)return null;if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const link=new Element('link');link.rel='stylesheet';link.sheet=null;link._disabled=true;
 Object.defineProperty(link,'disabled',{get:()=>link._disabled,set:value=>{if(link._disabled&&value===false)enabled++;link._disabled=value;}});elements.set('readerFontStylesheet',link);
 const fonts={get ready(){readyReads++;assert(link.sheet,'fonts.ready read before stylesheet loaded');return fontGate.promise;},check:(font,text)=>{fontChecks.push({font,text});return check;}};
 const styles=new Map(),document={getElementById:get,createElement:tag=>new Element(tag),createDocumentFragment:()=>new Element('#fragment'),createTextNode:value=>{const node=new Element('#text');node.textContent=value;return node;},
  querySelector:()=>get('readerContainer'),querySelectorAll:selector=>selector==='#readerBody .reader-paragraph'?get('readerBody').querySelectorAll('.reader-paragraph'):[],
  documentElement:{style:{setProperty:(key,value)=>styles.set(key,value)}},...(missingFonts?{}:{fonts})};
 c={document,AbortController,URL,URLSearchParams,console:{warn(){}},currentActiveView:'view-home',scrollY:0,innerHeight:800,activeWork:null,
  WEBNOVELS_CONFIG:{authorPublishEnabled:true,readerServiceEnabled:true},location:{pathname:'/home',origin:'https://reader.example'},
  history:{pushState(_s,_t,path){routes.push(path);c.location.pathname=path;}},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
  addEventListener(type,fn){if(!events.has(type))events.set(type,new Set());events.get(type).add(fn);},removeEventListener:(type,fn)=>events.get(type)?.delete(fn),
  setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,due:now+ms});return id;},clearTimeout:id=>timers.delete(id),
  scrollTo({top}){c.scrollY=top;scrolls.push(top);},
  switchWebNovelsView(view){c.currentActiveView=view;c.ReaderSession.leave(view);},
  WebNovelsAuth:{getActor:()=>actor,api:async path=>{calls.push(['content',path]);return {versionId:version,episode:{content:'제목\n\n본문 밑줄',contentDocument:documentSnapshot,...(webtoon?{webtoon:{panels:[{id:'panel-a',width:800,height:1200}]}}:{})}};}},
  ReaderCatalog:{active:()=>true,reading:async(id,number)=>{calls.push(['catalog',id,enabled]);return {work:{id,title:'작품 '+id,contentType:webtoon?'WEBTOON':'NOVEL',episodes:[]},episode:{id:String(Number(id)*10+number),episodeNumber:number,title:'회차 '+number,isFree:true},previous:null,next:null};}},
  ReaderHub:{active:()=>false,activity:async()=>({readingHistory:[{workId:'10',episodeNumber:5,position:{versionId:savedVersion,paragraphIndex:1,offset:.5}},{workId:'20',episodeNumber:9,position:{versionId:savedVersion,paragraphIndex:1,offset:.5}}]})},
  ReaderWebtoon:{reset(){},render(node){node.replaceChildren();}},loadEpisodeComments(){},renderReaderRecommendations(){},selectParagraphComment(){},showToast:text=>calls.push(['toast',text]),
  saveReadingProgress:(...args)=>writes.push(args)};
 c.window=c;vm.createContext(c);
 for(const source of [position,manuscript,content,prefsSource,fontSource,openSource])vm.runInContext(source,c);
 c.ReaderPreferencesManager.init();
 return {c,get,link,events,timers,scrolls,writes,routes,calls,fontChecks,styles,
  get enabled(){return enabled;},get readyReads(){return readyReads;},
  loaded(){link.sheet={};link.emit('load');},failed(){link.emit('error');},
  fontsReady(){fontsSettled=true;fontGate.resolve(fonts);},fontsFailed(){fontGate.reject(Error('font failure'));},
  setActor:value=>actor=value,emitScroll(top){c.scrollY=top;for(const fn of [...(events.get('scroll')||[])])fn({type:'scroll'});},
  async advance(ms){now+=ms;for(const [id,timer]of [...timers])if(timer.due<=now){timers.delete(id);timer.fn();}await ticks();}};
}

test('initial HTML keeps the exact reading families disabled, with a local font module before the reader',()=>{
 const tree=parse(html),nodes=[];const walk=node=>{nodes.push(node);for(const child of node.childNodes||[])walk(child);};walk(tree);
 const attr=(node,key)=>node.attrs?.find(item=>item.name===key)?.value;
 const stylesheet=nodes.find(node=>attr(node,'id')==='readerFontStylesheet');assert(stylesheet);assert.equal(attr(stylesheet,'rel'),'stylesheet');assert.equal(attr(stylesheet,'disabled'),'');
 assert.equal(attr(stylesheet,'href'),'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&family=Noto+Serif+KR:wght@400;600;700&display=swap');
 const scripts=nodes.filter(node=>node.tagName==='script').map(node=>attr(node,'src')).filter(Boolean);
 const font=scripts.findIndex(path=>path.startsWith('/js/reader/reader-fonts.js?')),readerIndex=scripts.findIndex(path=>path.startsWith('/js/reader/reader.js?'));
 assert(font>=0&&font<readerIndex);assert(nodes.some(node=>attr(node,'as')==='font'&&attr(node,'href')==='/fonts/suit-v2.0.5/SUIT-Variable.woff2'));
});

test('home initialization, repeated preference apply and nonreader views do not activate reading fonts',()=>{
 const app=fixture();assert.equal(app.enabled,0);assert.equal(app.readyReads,0);
 for(const view of ['view-home','view-discover','view-mypage','view-creator','view-admin-cms']){app.c.currentActiveView=view;app.c.ReaderPreferencesManager.apply();app.c.ReaderFonts.start();}
 assert.equal(app.enabled,0);assert.equal(app.readyReads,0);assert.equal(app.link.disabled,true);assert.equal(app.timers.size,0);
});

test('accepted reader entry enables the stylesheet before fetching content and only once across chapters',async()=>{
 const app=fixture(),first=app.c.openReaderDirect('10',5);await ticks();assert.equal(app.enabled,1);assert.equal(app.calls[0][0],'catalog');assert.equal(app.calls[0][2],1);
 assert.equal(app.get('readerBody').textContent,'제목본문 밑줄');assert.equal(app.readyReads,0);
 app.loaded();await ticks();assert.equal(app.readyReads,1);app.fontsReady();await first;
 const second=app.c.openReaderDirect('20',9);assert.equal(app.get('view-reader').getAttribute('data-reader-font-state'),'PENDING');
 await second;assert.equal(app.enabled,1);assert.equal(app.c.ReaderFonts.state,'LOADED');
 assert.equal(app.link.events.get('load').size,0);assert.equal(app.link.events.get('error').size,0);assert.equal(app.timers.size,0);
});

test('real Word paragraphs restore after settled font geometry without modifying text, marks or reading preferences',async()=>{
 const app=fixture(),opened=app.c.openReaderDirect('10',5);await ticks();const paragraphs=app.get('readerBody').querySelectorAll('.reader-paragraph');
 assert.equal(paragraphs.length,2);assert.equal(paragraphs[0].style.textAlign,'center');assert.equal(paragraphs[0].children[0].tagName,'STRONG');
 assert.equal(paragraphs[1].style.textIndent,'1em');assert.equal(paragraphs[1].children[0].tagName,'EM');assert.equal(paragraphs[1].children[1].tagName,'U');
 assert.deepEqual(app.scrolls,[0]);app.loaded();await ticks();assert.deepEqual(app.scrolls,[0]);
 app.fontsReady();await opened;assert.equal(app.c.scrollY,604,'uses loaded 400px paragraph height, not fallback 200px');
 assert.match(app.get('readerProgressStatus').textContent,/저장한 위치에서/);assert.equal(app.get('view-reader').getAttribute('data-reader-font-state'),'READY');
 assert.deepEqual(app.fontChecks,[{font:'18px "Noto Serif KR"',text:'제목본문 밑줄'}]);
 assert.match(app.styles.get('--reader-font'),/Noto Serif KR/);assert.equal(app.styles.get('--reader-font-size'),'18px');
 await app.advance(1000);assert.equal(app.writes.length,0,'opening/restoring must not fabricate a zero or progress event');
});

test('manual scrolling during a font wait cancels restoration and a later font completion never moves the reader',async()=>{
 const app=fixture(),opened=app.c.openReaderDirect('10',5);await ticks();app.emitScroll(350);await opened;
 assert.equal(app.c.scrollY,350);assert.match(app.get('readerProgressStatus').textContent,/이동한 읽기 위치/);assert.deepEqual(app.scrolls,[0]);
 app.loaded();app.fontsReady();await ticks();assert.deepEqual(app.scrolls,[0]);assert.equal(app.c.scrollY,350);assert.equal(app.writes.length,0);
 assert.equal(app.events.get('scroll').size,1,'only the existing progress listener remains');
});

test('a new chapter cancels the old layout wait before it can restore or replace the new reading state',async()=>{
 const app=fixture(),old=app.c.openReaderDirect('10',5);await ticks();const current=app.c.openReaderDirect('20',9);await ticks();await old;
 assert.equal(app.c.ReaderSession.current.workId,'20');assert.equal(app.get('readerWorkTitle').textContent,'작품 20');
 app.loaded();app.fontsReady();await current;assert.deepEqual(app.routes,['/read/20/9']);assert.equal(app.c.scrollY,604);assert.equal(app.scrolls.filter(top=>top===604).length,1);
 assert.equal(app.events.get('scroll').size,1);assert.equal(app.timers.size,0);assert.equal(app.writes.length,0);
});

test('account change or navigation away aborts waits and releases temporary listeners without stale status or position writes',async()=>{
 for(const change of ['account','route']){
  const app=fixture(),opened=app.c.openReaderDirect('10',5);await ticks();
  if(change==='account'){app.setActor({userId:'account-b',reader:{id:'profile-b'}});app.c.ReaderSession.reset();}else app.c.switchWebNovelsView('view-home');
  await opened;const status=app.get('readerProgressStatus').textContent;app.loaded();app.fontsReady();await ticks();
  assert.deepEqual(app.routes,[]);assert.deepEqual(app.scrolls,[0]);assert.equal(app.get('readerProgressStatus').textContent,status);
  assert.equal(app.events.get('scroll').size,0);assert.equal(app.timers.size,0);assert.equal(app.writes.length,0);
 }
});

test('missing stylesheet and stylesheet errors keep readable fallback and do not claim ready',async()=>{
 for(const mode of ['missing','error']){
  const app=fixture({missingLink:mode==='missing'}),opened=app.c.openReaderDirect('10',5);await ticks();if(mode==='error')app.failed();await opened;
  assert.equal(app.get('readerBody').textContent,'제목본문 밑줄');assert.equal(app.c.scrollY,304);
  assert.equal(app.get('view-reader').getAttribute('data-reader-font-state'),mode==='missing'?'UNAVAILABLE':'ERROR');
  assert.match(app.get('readerProgressStatus').textContent,/글꼴 연결을 확인하지 못해 현재 표시 기준/);assert.equal(app.readyReads,0);assert.equal(app.timers.size,0);
 }
});

test('stylesheet and used-font timeouts are bounded and late loads do not repeat restoration',async()=>{
 for(const phase of ['stylesheet','fonts']){
  const app=fixture(),opened=app.c.openReaderDirect('10',5);await ticks();if(phase==='fonts'){app.loaded();await ticks();}
  await app.advance(2999);assert.equal(app.scrolls.length,1);await app.advance(1);await opened;
  assert.equal(app.get('view-reader').getAttribute('data-reader-font-state'),'TIMEOUT');assert.equal(app.c.scrollY,304);assert.match(app.get('readerProgressStatus').textContent,/글꼴 연결을 확인하지 못해/);
  const before=[...app.scrolls];if(phase==='stylesheet')app.loaded();app.fontsReady();await ticks();assert.deepEqual(app.scrolls,before);assert.equal(app.timers.size,0);
 }
});

test('unsupported, failed and unavailable font faces report fallback instead of ready',async()=>{
 for(const mode of ['unsupported','rejected','face']){
  const app=fixture({missingFonts:mode==='unsupported',check:mode!=='face'}),opened=app.c.openReaderDirect('10',5);await ticks();app.loaded();await ticks();
  if(mode==='rejected')app.fontsFailed();else if(mode==='face')app.fontsReady();await opened;
  assert.equal(app.get('view-reader').getAttribute('data-reader-font-state'),{unsupported:'UNAVAILABLE',rejected:'ERROR',face:'FALLBACK'}[mode]);
  assert.match(app.get('readerProgressStatus').textContent,/글꼴 연결을 확인하지 못해/);assert.equal(app.get('readerBody').textContent,'제목본문 밑줄');assert.equal(app.timers.size,0);
 }
});

test('font checks use the current serif/sans choice and size without changing preference contracts',async()=>{
 const app=fixture(),opened=app.c.openReaderDirect('10',5);await ticks();app.loaded();await ticks();
 app.c.ReaderPreferencesManager.setFontFamily('sans');app.c.ReaderPreferencesManager.changeFontSize(4);app.fontsReady();await opened;
 assert.equal(app.fontChecks.at(-1).font,'22px "Noto Sans KR"');assert.match(app.get('readerPaper').style.fontFamily,/Noto Sans KR/);
 assert.equal(app.c.ReaderPreferencesManager.pref.theme,'theme-light');assert.equal(app.c.ReaderPreferencesManager.pref.paragraphGap,1.2);
});

test('webtoon rendering does not wait on text fonts and immutable version changes still reject saved paragraph offsets',async()=>{
 const webtoon=fixture({webtoon:true});await webtoon.c.openReaderDirect('10',5);assert.equal(webtoon.readyReads,0);assert.equal(webtoon.timers.size,0);assert.equal(webtoon.get('view-reader').getAttribute('data-reader-font-state'),'NOT_NEEDED');
 const app=fixture({savedVersion:'22222222-2222-4222-8222-222222222222'}),opened=app.c.openReaderDirect('10',5);await ticks();app.loaded();app.fontsReady();await opened;
 assert.deepEqual(app.scrolls,[0]);assert.match(app.get('readerProgressStatus').textContent,/공개본이 수정되어/);assert.equal(app.writes.length,0);
});
