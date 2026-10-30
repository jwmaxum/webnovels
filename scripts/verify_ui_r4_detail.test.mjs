import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const sources=await Promise.all(['reader-catalog.js','reader-discovery.js'].map(async name=>({name,code:await readFile(new URL('../public/js/reader/'+name,import.meta.url),'utf8')})));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const work=(id='10',extra={})=>({id,author_id:'9007199254740993',title:'작품 '+id,author:'실제 작가',genre:['로맨스'],
  content_type:'NOVEL',status:'ONGOING',rating:'ALL',ai_usage_type:'NONE',cover_image:'/covers/actual.webp',episode_count:2,
  description:'작품 소개',firstEpisodeNumber:4,created_at:'2026-10-01T12:00:00Z',first_published_at:'2026-10-02T12:00:00Z',last_published_at:'2026-10-20T12:00:00Z',...extra});
const episode=(number,extra={})=>({id:String(100+number),work_id:'10',episode_number:number,title:'회차 '+number,is_free:true,access_policy:'FREE',status:'PUBLISHED',...extra});
class Element{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this.dataset={};this.value='';this.disabled=false;this._text='';const classes=new Set();
    this.classList={add:(...names)=>names.forEach(name=>classes.add(name)),remove:name=>classes.delete(name),toggle:(name,on)=>on?classes.add(name):classes.delete(name)};}
  set textContent(value){this._text=String(value??'');this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set innerHTML(_){throw Error('Authored HTML is forbidden');}append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){this._text='';this.children=[];this.append(...children);}setAttribute(key,value){this.attrs[key]=String(value);}
  getAttribute(key){return this.attrs[key]??null;}removeAttribute(key){delete this.attrs[key];if(key==='src')delete this.src;}
  focus(){this.focused=true;}remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);}
  querySelectorAll(){return [];}querySelector(){return null;}
}
function fixture(handler){
  const ids=['view-work-detail','detailLoadStatus','detailTitle','detailAuthor','detailGenreBadge','detailRatingBadge','detailAiBadge','detailDescription','detailDates','detailCoverImg',
    'detailPublicationStatus','detailContentType','detailEpisodesHeading','btnDetailReadFirst','btnStickyRead','detailEpisodeList','detailEpisodePager','detailExternalLinks','detailShareLink'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Element()])),head=new Element('head'),description=new Element('meta'),requests=[],pushes=[];
  const context={URL,URLSearchParams,Date,setTimeout,clearTimeout,clearInterval,activeWork:null,location:new URL('https://app.test/home'),
    WEBNOVELS_CONFIG:{readerDiscoveryEnabled:true,webtoonServiceEnabled:true},history:{pushState(_state,_title,path){pushes.push(path);context.location=new URL(path,context.location);}},
    document:{title:'웹노블',head,getElementById:id=>nodes[id]||null,createElement:tag=>new Element(tag),querySelector:selector=>selector==='meta[name="description"]'?description:
      head.children.find(child=>selector===`meta[property="${child.getAttribute('property')}"]`)||null},
    fetch:async(url,init)=>{const parsed=new URL(url,context.location);requests.push({url:parsed,init});return handler(parsed,requests.length);},
    navigateTo(){},switchWebNovelsView:view=>context.ReaderDiscovery.leave(view)};
  context.window=context;vm.createContext(context);for(const source of sources)vm.runInContext(source.code,context,{filename:source.name});
  return {context,nodes,requests,pushes,ui:context.ReaderDiscovery};
}
const ok=value=>Response.json(value);

test('detail uses actual type/status and public chapter numbers with safe authored metadata and real dates',async()=>{
  const app=fixture(url=>ok(url.searchParams.get('action')==='work'?{work:work('10',{title:'<svg onload=1>',author:'<img onerror=1>',description:'<script>body</script>',content_type:'WEBTOON',status:'PAUSED',rating:'AGE_15',ai_usage_type:'ASSISTED'})}:
    {episodes:[episode(4,{title:'<b>실제 4화</b>',published_at:'2026-10-20T12:00:00Z'}),episode(9)],nextCursor:null}));
  await app.ui.detail('10');
  assert.equal(app.nodes.detailTitle.textContent,'<svg onload=1>');assert.equal(app.nodes.detailTitle.children.length,0);
  assert.equal(app.nodes.detailDescription.textContent,'<script>body</script>');assert.equal(app.nodes.detailAuthor.textContent,'작가: <img onerror=1>');
  assert.equal(app.nodes.detailContentType.textContent,'웹툰');assert.equal(app.nodes.detailPublicationStatus.textContent,'휴재');assert.equal(app.nodes.detailAiBadge.textContent,'AI 보조');
  assert.equal(app.nodes.detailRatingBadge.textContent,'15세 이상');assert.match(app.nodes.detailEpisodesHeading.textContent,/공개 회차 · 2화/);
  assert.equal(app.nodes.btnDetailReadFirst.disabled,false);assert.match(app.nodes.btnDetailReadFirst.textContent,/4화/);
  assert.deepEqual(app.nodes.detailEpisodeList.children.map(child=>child.href),['/read/10/4','/read/10/9']);
  assert.match(app.nodes.detailEpisodeList.children[0].textContent,/<b>실제 4화<\/b>무료 · 공개 2026/);
  assert.doesNotMatch(app.nodes.detailEpisodeList.children[1].textContent,/공개일|기록 없음|2026/);
  assert.equal(app.nodes.detailEpisodeList.getAttribute('aria-busy'),'false');assert.equal(app.nodes['view-work-detail'].getAttribute('aria-busy'),'false');
  assert.match(app.nodes.detailLoadStatus.textContent,/표시했습니다/);assert.equal(app.context.activeWork.id,'10');
});

test('switching to a missing work clears old read actions and stale work responses cannot restore them',async()=>{
  const pending=deferred();const app=fixture(url=>url.searchParams.get('workId')==='10'?pending.promise:Response.json({error:'WORK_NOT_FOUND'},{status:404}));
  const old=app.ui.detail('10');assert.equal(app.nodes['view-work-detail'].getAttribute('aria-busy'),'true');assert.match(app.nodes.btnStickyRead.textContent,/확인 중/);
  await app.ui.detail('20');pending.resolve(ok({work:work('10')}));await old;
  assert.equal(app.context.activeWork,null);assert.equal(app.nodes.detailTitle.textContent,'');assert.equal(app.nodes.detailCoverImg.src,undefined);
  assert.equal(app.nodes.btnDetailReadFirst.disabled,true);assert.equal(app.nodes.btnStickyRead.disabled,true);assert.match(app.nodes.btnStickyRead.textContent,/공개 회차 없음/);
  assert.match(app.nodes.detailLoadStatus.textContent,/공개된 작품을 찾을 수 없습니다/);assert.equal(app.nodes.detailEpisodeList.children.some(child=>child.tagName==='BUTTON'),false);
  assert.equal(app.context.document.title,'웹노블');
});

test('no published chapter leaves both read actions disabled without guessing chapter one',async()=>{
  const app=fixture(url=>ok(url.searchParams.get('action')==='work'?{work:work('10',{status:'COMPLETED',episode_count:0,firstEpisodeNumber:null,description:''})}:{episodes:[],nextCursor:null}));
  await app.ui.detail('10');assert.equal(app.nodes.detailPublicationStatus.textContent,'완결');assert.match(app.nodes.detailDescription.textContent,/소개가 없습니다/);
  assert.equal(app.nodes.btnDetailReadFirst.disabled,true);assert.equal(app.nodes.btnStickyRead.disabled,true);assert.match(app.nodes.detailEpisodeList.textContent,/공개된 회차가 없습니다/);
  assert.match(app.nodes.detailLoadStatus.textContent,/공개된 회차가 없습니다/);assert(!app.nodes.detailEpisodeList.children.some(child=>child.href));
});

test('chapter failure is recoverable without losing loaded work metadata or valid first-public action',async()=>{
  let failed=true;const app=fixture(url=>url.searchParams.get('action')==='work'?ok({work:work()}):failed?Response.json({error:'CATALOG_UNAVAILABLE'},{status:503}):ok({episodes:[episode(4)],nextCursor:null}));
  await app.ui.detail('10');assert.equal(app.nodes.detailTitle.textContent,'작품 10');assert.equal(app.nodes.btnDetailReadFirst.disabled,false);
  assert.match(app.nodes.detailLoadStatus.textContent,/회차 목록을 불러오지 못/);assert.equal(app.nodes.detailEpisodeList.getAttribute('aria-busy'),'false');
  failed=false;await app.nodes.detailEpisodePager.children.find(child=>child.tagName==='BUTTON').onclick();
  assert.equal(app.nodes.detailEpisodeList.children[0].href,'/read/10/4');assert.match(app.nodes.detailLoadStatus.textContent,/표시했습니다/);
  assert.equal(app.requests.filter(row=>row.url.searchParams.get('action')==='work').length,1,'retry only the failed chapter list');
});

test('page retry preserves public rows and the opaque cursor, without duplicate appended chapters',async()=>{
  let failed=true;const app=fixture(url=>{
    if(url.searchParams.get('action')==='work')return ok({work:work()});
    if(!url.searchParams.has('cursor'))return ok({episodes:[episode(4)],nextCursor:'Opaque-NEXT_ABC'});
    return failed?Response.json({error:'CATALOG_UNAVAILABLE'},{status:503}):ok({episodes:[episode(9)],nextCursor:null});
  });await app.ui.detail('10');await app.nodes.detailEpisodePager.children[0].onclick();
  assert.deepEqual(app.nodes.detailEpisodeList.children.map(row=>row.href),['/read/10/4']);failed=false;
  await app.nodes.detailEpisodePager.children.find(child=>child.tagName==='BUTTON').onclick();
  assert.deepEqual(app.nodes.detailEpisodeList.children.map(row=>row.href),['/read/10/4','/read/10/9']);
  assert.deepEqual(app.requests.filter(row=>row.url.searchParams.has('cursor')).map(row=>row.url.searchParams.get('cursor')),['Opaque-NEXT_ABC','Opaque-NEXT_ABC']);
});

test('leaving detail suppresses a late chapter result and does not reopen work or share metadata',async()=>{
  const chapters=deferred();const app=fixture(url=>url.searchParams.get('action')==='work'?ok({work:work()}):chapters.promise);
  const pending=app.ui.detail('10');await tick();app.ui.leave('view-home');app.nodes.detailEpisodeList.textContent='다른 화면';
  chapters.resolve(ok({episodes:[episode(4)],nextCursor:null}));await pending;
  assert.equal(app.nodes.detailEpisodeList.textContent,'다른 화면');assert.equal(app.context.document.title,'웹노블');
});
