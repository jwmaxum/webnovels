import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const filename=name=>fileURLToPath(new URL('../public/js/reader/'+name,import.meta.url));
const reader=await read('public/js/reader/reader.js');
const position=await read('public/js/reader/reader-position.js');
const continuation=await read('public/js/reader/continue-reading.js');
const hub=await read('public/js/reader/reader-hub.js');
const open=reader.slice(reader.indexOf('window.openReaderDirect = async function'),reader.indexOf('// 회차별 댓글 렌더링'));
const save=reader.slice(reader.indexOf('async function saveReadingProgress'),reader.indexOf('async function toggleFavoriteWork'));
const comments=reader.slice(reader.indexOf('window.loadEpisodeComments = async function'),reader.indexOf('window.handleReaderCommentSubmit = async function'));
const recommendations=reader.slice(reader.indexOf('async function renderReaderRecommendations'),reader.indexOf('// 🪙 포인트로 회차'));
const submit=reader.slice(reader.indexOf('window.handleReaderCommentSubmit = async function'),reader.indexOf('// [Global Window Namespace Exports for Reader]'));
const version='11111111-1111-4111-8111-111111111111';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const ticks=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

function fixture() {
  let account='reader-a',id=0;
  const nodes=new Map(),events=new Map(),timers=new Map(),writes=[],paths=[],toasts=[],requests=[];
  function element(tag='div') {
    return {tag,children:[],dataset:{},style:{},attributes:{},textContent:'',innerHTML:'',hidden:false,disabled:false,
      classList:{contains:()=>false,add(){},remove(){}},
      append(...items){this.children.push(...items);},appendChild(item){this.children.push(item);},
      replaceChildren(...items){this.children=items;this.textContent='';this.innerHTML='';},
      setAttribute(name,value){this.attributes[name]=String(value);},removeAttribute(name){delete this.attributes[name];},
      getAttribute(name){return name==='data-paragraph-index'?this.dataset.paragraphIndex:this.attributes[name];},
      addEventListener(name,fn){this[name]=fn;},focus(){},remove(){},
      querySelector(){return null;},querySelectorAll(selector){return selector==='.reader-paragraph'?this.children.filter(x=>x.className==='reader-paragraph'):[];},
      getBoundingClientRect(){return {top:200-context.scrollY,bottom:2200-context.scrollY,height:2000};}};
  }
  const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const works={};
  for(const workId of ['10','20'])works[workId]={id:workId,title:'작품 '+workId,genre:['판타지'],rating:'ALL',episodes:[],contentType:'NOVEL'};
  const context={console:{warn(){}},URL,URLSearchParams,TextEncoder,Uint8Array,Math,Number,Date,Promise,Map,Set,
    document:{getElementById:node,createElement:element,createTextNode:text=>({textContent:text}),querySelectorAll:selector=>selector.includes('reader-paragraph')?node('readerBody').children:[],querySelector:()=>null},
    WEBNOVELS_CONFIG:{authorPublishEnabled:true,readerServiceEnabled:true,readerDiscoveryEnabled:true},
    location:{origin:'https://reader.test',pathname:'/home'},history:{pushState(value,title,path){paths.push(path);context.location.pathname=path;}},
    currentActiveView:'view-home',activeWork:null,activeEpisodeId:null,scrollY:0,innerHeight:800,
    scrollTo({top}){context.scrollY=top;},setTimeout(fn){const key=++id;timers.set(key,fn);return key;},clearTimeout(key){timers.delete(key);},
    addEventListener(name,fn){events.set(name,fn);},removeEventListener(name,fn){if(events.get(name)===fn)events.delete(name);},
    showToast:message=>toasts.push(message),loadEpisodeComments(){},renderReaderRecommendations(){},
    switchWebNovelsView(view){context.ReaderSession.leave(view);context.currentActiveView=view;},
    selectParagraphComment(){},renderCdgWorkCardHtml:work=>`<article>${work.title}</article>`,escapeReaderHtml:value=>String(value??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),
    getPublishedWorks(){throw Error('full catalog must not be used');},getWorkCover:()=>'/cover.png',
    localStorage:{getItem:()=>null},ReaderPreferencesManager:{apply(){}},
    ReaderCatalog:{active:()=>true,async reading(workId,number){
      requests.push({workId,number});const epNumber=Number(number);
      return {work:{...works[workId],episodes:[]},episode:{id:String(Number(workId)*10+epNumber),episodeNumber:epNumber,title:'회차 '+epNumber,isFree:true},
        previous:epNumber===2?null:{episodeNumber:epNumber===5?2:5},next:epNumber===9?null:{episodeNumber:epNumber===2?5:9}};
    },async work(id){return {...works[id],episodes:[]};},async home(){return {sections:{recommended:[]}};}},
    ReaderHub:{active:()=>true,activity:async()=>({readingHistory:[],favorites:[],subscriptions:[]}),change:async(action,ids,data)=>{writes.push({account,action,ids,data});}},
    WebNovelsAuth:{getActor:()=>account?{userId:account,reader:{id:account}}:null,api:async path=>({versionId:version,episode:{content:'첫 문단\n\n둘째 문단'}})},
    fetch:async()=>({ok:true,json:async()=>({versionId:version,episode:{content:'익명 본문'}})}),
    ReaderContent:{render(body,comment,snapshot){body.replaceChildren();snapshot.content.split('\n\n').forEach((text,index)=>{
      const p=element('p');p.className='reader-paragraph';p.textContent=text;p.dataset.paragraphIndex=String(index);
      p.getBoundingClientRect=()=>({top:200+index*1000-context.scrollY,bottom:1200+index*1000-context.scrollY,height:1000});body.append(p);
    });}}
  };
  context.window=context;vm.createContext(context);
  vm.runInContext(position,context,{filename:filename('reader-position.js')});
  vm.runInContext(save+'\n'+open+'\n'+recommendations,context);
  return {context,nodes,node,events,timers,writes,paths,toasts,requests,setAccount:value=>{account=value;},
    async scroll(top){context.scrollY=top;events.get('scroll')?.();const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());await ticks();},
    async runTimers(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());await ticks();}};
}

test('published gaps drive navigation and opening never writes a zero or loads the full catalog',async()=>{
  const f=fixture();await f.context.openReaderDirect('10',5);
  assert.equal(f.writes.length,0);assert.equal(f.paths.at(-1),'/read/10/5');
  assert.equal(f.node('btnPrevEp').attributes['aria-label'],'2화로 이동');
  f.node('btnNextEp').onclick();await ticks();assert.equal(f.context._currentReadingEpNum,9);
  assert.equal(f.node('btnNextEp').disabled,true);assert.equal(f.paths.at(-1),'/read/10/9');
  await f.context.openReaderDirect('10',2,false);assert.equal(f.node('btnPrevEp').disabled,true);
  assert.equal(f.paths.length,2);
});

test('body-only progress ignores comments and saves an immutable paragraph location after movement',async()=>{
  const f=fixture();await f.context.openReaderDirect('10',5);
  f.context.document.documentElement={scrollHeight:100000};await f.scroll(600);
  assert.equal(f.writes[0].data.progress,60);
  assert.equal(f.writes[0].data.position.versionId,version);
  assert.equal(f.writes[0].data.position.paragraphIndex,0);
  assert.equal(f.writes[0].data.position.offset,0.496);
  await f.scroll(1400);assert.equal(f.writes.at(-1).data.progress,100);
});

test('resume restores only the same episode and publication without creating an initial progress write',async()=>{
  const f=fixture();f.context.ReaderHub.activity=async()=>({readingHistory:[{workId:'10',episodeNumber:5,progress:90,
    position:{versionId:version,paragraphIndex:1,offset:0.25}}]});
  await f.context.openReaderDirect('10',5);assert.equal(f.context.scrollY,1354);assert.equal(f.writes.length,0);
  await f.context.openReaderDirect('10',9);assert.equal(f.context.scrollY,0);
  f.context.WebNovelsAuth.api=async()=>({versionId:'22222222-2222-4222-8222-222222222222',episode:{content:'수정 본문'}});
  await f.context.openReaderDirect('10',5);assert.equal(f.context.scrollY,0);assert.ok(f.toasts.some(text=>text.includes('공개본이 수정')));
  f.toasts.length=0;f.context.ReaderHub.activity=async()=>({readingHistory:[{workId:'10',episodeNumber:5,progress:90,position:null,positionChanged:true}]});
  await f.context.openReaderDirect('10',5);assert.ok(f.toasts.some(text=>text.includes('공개본이 수정')));assert.equal(f.writes.length,0);
});

test('late content cannot replace a newer chapter or return after leaving the reader',async()=>{
  const f=fixture(),slow=deferred();f.context.WebNovelsAuth.api=path=>path.includes('/105/')?slow.promise:Promise.resolve({versionId:version,episode:{content:'새 본문'}});
  const first=f.context.openReaderDirect('10',5);await ticks();await f.context.openReaderDirect('20',9);
  slow.resolve({versionId:version,episode:{content:'이전 본문'}});await first;
  assert.equal(f.context._currentReadingWorkId,'20');assert.equal(f.node('readerBody').children[0].textContent,'새 본문');assert.equal(f.paths.length,1);
  const other=deferred();f.context.WebNovelsAuth.api=()=>other.promise;const pending=f.context.openReaderDirect('10',2);await ticks();
  f.context.ReaderSession.leave('view-home');other.resolve({versionId:version,episode:{content:'이탈한 본문'}});await pending;
  assert.equal(f.node('readerBody').children.length,0);assert.equal(f.paths.length,1);
});

test('anonymous-to-account transition and delayed scroll timers cannot write into another session',async()=>{
  const f=fixture(),slow=deferred();f.setAccount(null);f.context.fetch=()=>slow.promise;
  const pending=f.context.openReaderDirect('10',2);await ticks();f.setAccount('reader-b');
  slow.resolve({ok:true,json:async()=>({versionId:version,episode:{content:'이전 익명 본문'}})});await pending;
  assert.equal(f.node('readerBody').children.length,0);assert.equal(f.writes.length,0);
  await f.context.openReaderDirect('20',5);f.context.scrollY=600;f.events.get('scroll')();
  assert.equal(f.timers.size,1);f.context.ReaderSession.leave('view-home');assert.equal(f.timers.size,0);await f.runTimers();assert.equal(f.writes.length,0);
});

test('progress writes serialize latest location and discard queued writes after account change',async()=>{
  const f=fixture(),slow=deferred();let calls=0;
  f.context.ReaderHub.change=async(action,ids,data)=>{f.writes.push({ids,data});if(++calls===1)await slow.promise;};
  await f.context.openReaderDirect('10',5);await f.scroll(300);await f.scroll(500);await f.scroll(700);
  assert.equal(f.writes.length,1);slow.resolve();await ticks();assert.equal(f.writes.length,2);assert.equal(f.writes[1].data.progress,65);
  const next=deferred();f.context.ReaderHub.change=async()=>{calls++;await next.promise;};await f.scroll(800);await f.scroll(900);
  f.setAccount('reader-b');next.resolve();await ticks();assert.equal(calls,3);
});

test('comments and paragraph hashing cannot mutate the next chapter',async()=>{
  const f=fixture();vm.runInContext(comments,f.context);
  const slow=deferred();f.context.ReaderHub.api=()=>slow.promise;f.context.crypto={subtle:{digest:async()=>new Uint8Array(32).buffer}};
  await f.context.openReaderDirect('10',5);
  f.context.ReaderHub.api=async()=>({comments:[],versionId:version});await f.context.openReaderDirect('20',9);await ticks();
  const expected=f.node('readerCommentsList').innerHTML;
  slow.resolve({comments:[{id:'1',content:'다른 회차의 댓글',created_at:'2026-10-09'}],versionId:'old'});await ticks();
  assert.equal(f.node('readerCommentsList').innerHTML,expected);assert.equal(f.context._currentContentVersionId,version);
  const hash=deferred();f.context.crypto.subtle.digest=()=>hash.promise;
  const pending=f.context.loadEpisodeComments('20','209');await ticks();f.context.ReaderSession.leave('view-home');
  hash.resolve(new Uint8Array(32).buffer);await pending;assert.equal(f.node('readerCommentsList').innerHTML,'');
});

test('home continue skips withdrawn episodes, reports network failures, and supports keyboard retry',async()=>{
  const f=fixture();vm.runInContext(continuation,f.context,{filename:filename('continue-reading.js')});
  f.context.ReaderHub.activity=async()=>({readingHistory:[{workId:'10',episodeNumber:2,progress:80},{workId:'20',episodeNumber:9,progress:45}]});
  const original=f.context.ReaderCatalog.reading;
  f.context.ReaderCatalog.reading=async(id,number)=>{if(id==='10')throw Object.assign(Error('NOT_FOUND'),{status:404});return original(id,number);};
  await f.context.renderContinueReadingHome();assert.equal(f.node('continueCardTitle').textContent,'작품 20');assert.equal(f.node('continueCardPct').textContent,'현재 회차 45%');
  f.node('continueReadingCardHome').onkeydown({key:'Enter',preventDefault(){}});await ticks();assert.equal(f.context._currentReadingWorkId,'20');
  f.context.ReaderCatalog.reading=async()=>{throw Error('NETWORK');};await f.context.renderContinueReadingHome();
  assert.equal(f.node('continueCardPct').textContent,'다시 시도');assert.equal(f.node('sectionContinueReading').style.display,'');
  const wait=deferred();f.context.ReaderHub.activity=()=>wait.promise;const late=f.context.renderContinueReadingHome();f.setAccount('reader-b');
  wait.resolve({readingHistory:[]});await late;assert.equal(f.node('sectionContinueReading').style.display,'none');
});

test('library resolves uncached public works and renders stored names as text',async()=>{
  const f=fixture();f.context.ReaderHub.activity=async()=>({readingHistory:[{workId:'20',episodeNumber:9,progress:12}],favorites:['10'],subscriptions:[{name:'<img onerror=1>'}]});
  await f.context.ReaderLibrary.render();
  assert.match(f.node('libraryContinueList').children[0].children[1].textContent,/12%/);
  assert.equal(f.node('libraryFavoritesList').children[0].textContent,'작품 10');
  assert.equal(f.node('libraryCreatorsList').children[0].textContent,'<img onerror=1>');
});

test('same-account activity responses and pre-mutation snapshots cannot overwrite a newer cache',async()=>{
  const f=fixture(),requests=[];f.context.WebNovelsAuth.api=async(path,options)=>{
    if(options)return {saved:true};const item=deferred();requests.push(item);return item.promise;
  };vm.runInContext(hub,f.context,{filename:filename('reader-hub.js')});
  const older=f.context.ReaderHub.activity(true),newer=f.context.ReaderHub.activity(true);
  requests[1].resolve({readingHistory:[{progress:80}]});await newer;
  requests[0].resolve({readingHistory:[{progress:10}]});await assert.rejects(older,/ACTIVITY_CHANGED/);
  assert.equal(f.context.ReaderHub.cached.readingHistory[0].progress,80);
  const stale=f.context.ReaderHub.activity(true);await f.context.ReaderHub.change('progress',{workId:'10',episodeId:'105'},{progress:90});
  requests[2].resolve({readingHistory:[{progress:80}]});await assert.rejects(stale,/ACTIVITY_CHANGED/);assert.equal(f.context.ReaderHub.cached,null);
  const beforeReset=f.context.ReaderHub.activity(true);f.context.ReaderHub.reset();f.context.ReaderHub.activity().catch(()=>{});
  requests[3].resolve({readingHistory:[]});await assert.rejects(beforeReset,/SESSION_CHANGED/);
});

test('incomplete webtoon images do not report artificial completion',()=>{
  const f=fixture(),body=f.node('readerWebtoonViewer');body.querySelectorAll=()=>[{complete:false,naturalHeight:0}];
  assert.equal(f.context.ReaderPosition.measure(body,version,true),null);
});

test('late editorial recommendations and comment writes cannot affect another reading session',async()=>{
  const f=fixture(),recommendation=deferred();
  f.context.ReaderCatalog.home=()=>recommendation.promise;await f.context.openReaderDirect('10',5);
  f.context.ReaderSession.leave('view-home');f.node('readerRecommendGrid').textContent='다른 화면';
  recommendation.resolve({sections:{recommended:[{id:'20',title:'늦은 추천'}]}});await ticks();
  assert.equal(f.node('readerRecommendGrid').textContent,'다른 화면');
  f.context.ReaderCatalog.home=async()=>({sections:{recommended:[]}});await f.context.openReaderDirect('10',5);
  vm.runInContext(submit,f.context);const hash=deferred();f.context.crypto={subtle:{digest:()=>hash.promise}};
  f.node('readerCommentInput').value='기존 댓글';f.context._paragraphComment={paragraphIndex:0,paragraphText:'첫 문단'};
  const pending=f.context.handleReaderCommentSubmit('10','105');f.context.ReaderSession.leave('view-home');
  hash.resolve(new Uint8Array(32).buffer);await pending;assert.equal(f.writes.length,0);
  await f.context.openReaderDirect('20',9);const response=deferred();f.context.ReaderHub.change=()=>response.promise;
  f.node('replyText-1').value='보낸 답글';const reply=f.context.handleReaderReplySubmit('20','209','1');
  f.context.ReaderSession.leave('view-home');f.node('replyText-1').value='새 화면의 글';response.resolve({saved:true});await reply;
  assert.equal(f.node('replyText-1').value,'새 화면의 글');
});

test('continue action loads an uncached destination and compatibility comment action never guesses an ID',async()=>{
  const f=fixture();vm.runInContext(continuation,f.context,{filename:filename('continue-reading.js')});
  f.context.ReaderHub.activity=async()=>({readingHistory:[{workId:'20',episodeNumber:9,progress:40}]});
  await f.context.ContinueReading.open();assert.equal(f.context._currentReadingWorkId,'20');
  assert.equal(f.context._currentReadingEpNum,9);
  // Extract the whole classic-script assignment while preserving the public compatibility name.
  const start=reader.indexOf('window.submitReaderComment = function');
  const end=reader.indexOf('\n};',start)+4;
  vm.runInContext(reader.slice(start,end),f.context);
  f.context.ReaderSession.reset();f.context.handleReaderCommentSubmit=()=>assert.fail('missing reader session must not submit');
  f.context.submitReaderComment();assert.ok(f.toasts.some(text=>text.includes('공개 회차를 먼저')));
});

test('position saves expose pending, success and recoverable failure without automatic retry',async()=>{
  const f=fixture(),save=deferred();let calls=0;
  f.context.ReaderHub.change=async()=>{calls++;return save.promise;};
  await f.context.openReaderDirect('10',5);await f.scroll(300);
  assert.match(f.node('readerProgressStatus').textContent,/저장하는 중/);
  assert.equal(f.node('readerProgressStatus').attributes['aria-live'],'polite');
  await f.scroll(400);save.reject(Error('NETWORK'));await ticks();
  assert.match(f.node('readerProgressStatus').textContent,/저장하지 못했습니다/);assert.equal(calls,1);
  f.context.ReaderHub.change=async()=>{calls++;return {saved:true};};await f.scroll(500);
  assert.match(f.node('readerProgressStatus').textContent,/저장했습니다/);assert.equal(calls,2);
  assert.equal(f.toasts.length,0);
});

test('changed publication blocks further position writes until the chapter is reopened',async()=>{
  const f=fixture();let calls=0;
  f.context.ReaderHub.change=async()=>{calls++;throw Object.assign(Error('changed'),{code:'POSITION_VERSION_CHANGED'});};
  await f.context.openReaderDirect('10',5);await f.scroll(300);
  assert.equal(f.context.ReaderSession.current.positionBlocked,true);
  assert.match(f.node('readerProgressStatus').textContent,/회차를 다시 열어주세요/);
  await f.scroll(600);assert.equal(calls,1);
  f.context.ReaderHub.change=async()=>{calls++;return {saved:true};};await f.context.openReaderDirect('10',5);
  assert.equal(f.context.ReaderSession.current.positionBlocked,false);await f.scroll(700);assert.equal(calls,2);
  f.context.ReaderSession.reset();assert.equal(f.node('readerProgressStatus').textContent,'');
});
