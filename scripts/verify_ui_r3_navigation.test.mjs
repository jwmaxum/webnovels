import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const router=await readFile(new URL('../public/js/core/router.js',import.meta.url),'utf8');
const appSource=await readFile(new URL('../public/app.js',import.meta.url),'utf8');

function element(attributes={}){
  const attrs=new Map(Object.entries(attributes)),classes=new Set(),listeners=new Map();
  return {value:'',dataset:{readerRoute:attrs.get('data-reader-route')},classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k)},
    setAttribute:(k,v)=>attrs.set(k,String(v)),getAttribute:k=>attrs.get(k)??null,removeAttribute:k=>attrs.delete(k),
    addEventListener:(name,fn)=>listeners.set(name,fn),focus(){this.focused=true;},listeners};
}
function fixture(path='/home'){
  const nodes=new Map(),links=[],pushes=[],queries=[],filters=[],modals=[],searches=[],events=new Map(),genrePill=element({onclick:"setDiscoverGenreFilter('판타지', this)"});
  let actor={userId:'reader-uuid',reader:{id:'8'}},closed=0;
  for(const id of ['view-home','view-discover','view-mypage','view-reader','view-work-detail','view-creator','view-admin-cms',
    'inputSearchHeader','inputSearchMobile','globalSearchInput','discoverQuery','btnDiscoverSearch'])nodes.set(id,element());
  for(const [key,href]of [['home','/home'],['novel','/discover?type=NOVEL'],['webtoon','/discover?type=WEBTOON'],
    ['ranking','/discover?sort=popular'],['new','/discover?sort=new'],['completed','/discover?status=COMPLETED'],
    ['discover','/discover'],['library','/library']])links.push(element({'data-reader-route':key,href}));
  const context={URL,URLSearchParams,console:{log(){}},currentActiveView:'view-home',lastMainView:'view-home',
    location:new URL(path,'https://app.test'),history:{pushState(_state,_title,path){pushes.push(path);context.location=new URL(path,context.location);}},
    document:{readyState:'loading',body:element(),getElementById:id=>nodes.get(id)||null,querySelector:()=>null,
      querySelectorAll:selector=>selector==='[data-reader-route]'?links:selector==='.main-view'?[...nodes].filter(([id])=>id.startsWith('view-')).map(([,node])=>node):
        selector==='.nav-link, .bottom-nav-item, .cdg-sidebar-item'?links:selector==='#discoverGenreFilters .pill'?[genrePill]:[],addEventListener(){}},
    WebNovelsAuth:{getActor:()=>actor},ReaderDiscovery:{active:()=>true,leave(){},home(){},discover:query=>queries.push(query),filter:(key,value)=>filters.push({key,value})},
    getCurrentCreatorSession:()=>actor?.author,openModal:name=>modals.push(name),showToast(){},scrollTo(){},setTimeout(){},
    closeAllModals:()=>closed++,renderSearchResults:query=>searches.push(query),addEventListener:(name,fn)=>events.set(name,fn),localStorage:{getItem:()=>null}};
  context.window=context;vm.createContext(context);vm.runInContext(router,context,{filename:'router.js'});
  return {c:context,nodes,links,pushes,queries,filters,modals,searches,events,genrePill,closed:()=>closed,setActor:value=>actor=value,
    link:key=>links.find(link=>link.dataset.readerRoute===key),location:path=>context.location=new URL(path,'https://app.test'),
    runApp:()=>vm.runInContext(appSource,context,{filename:'app.js'})};
}
function click(link,extra={}){
  return {currentTarget:link,button:0,prevented:false,preventDefault(){this.prevented=true;this.defaultPrevented=true;},...extra};
}
function submit(value){const input={value},form={elements:{namedItem:name=>name==='q'?input:null}};return {input,event:{currentTarget:form,preventDefault(){this.prevented=true;}}};}

test('reader links keep complete query, repeated tags and native modified-click behavior',()=>{
  const f=fixture(),link=element({href:'/discover?type=WEBTOON&q=KeepCASE&tag=romance&tag=growth&cursor=PAGE_A'}),event=click(link);
  assert.equal(f.c.handleReaderRouteClick(event),false);assert.equal(event.prevented,true);assert.equal(f.closed(),1);
  assert.deepEqual(f.pushes,['/discover?type=WEBTOON&q=KeepCASE&tag=romance&tag=growth&cursor=PAGE_A']);
  assert.equal(f.queries.length,1);assert.equal(f.c.currentActiveView,'view-discover');
  for(const extra of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{defaultPrevented:true}]){
    const modified=click(link,extra);assert.equal(f.c.handleReaderRouteClick(modified),true);assert.equal(modified.prevented,false);
  }
  for(const href of ['https://external.test/discover','javascript:alert(1)','/creator','/admin','/api/v2/catalog','https://user:password@app.test/home']){
    const unsupported=click(element({href}));assert.equal(f.c.handleReaderRouteClick(unsupported),true);assert.equal(unsupported.prevented,false);
  }
  const blank=click(element({href:'/discover?type=WEBTOON',target:'_blank'}));
  assert.equal(f.c.handleReaderRouteClick(blank),true);assert.equal(blank.prevented,false);
  assert.equal(f.pushes.length,1);
});

test('header forms delegate to current discovery filters or create a bounded case-preserving query',()=>{
  const f=fixture('/discover?type=WEBTOON&tag=romance&status=COMPLETED&cursor=OLD'),current=submit('  Case 제목 & 작가  ');
  assert.equal(f.c.submitReaderSearch(current.event),false);assert.equal(current.event.prevented,true);
  assert.deepEqual(f.filters,[{key:'q',value:'Case 제목 & 작가'}]);assert.equal(current.input.value,'Case 제목 & 작가');assert.equal(f.pushes.length,0);
  f.location('/home?type=WEBTOON');const fromHome=submit('  NewCASE  ');f.c.submitReaderSearch(fromHome.event);
  assert.equal(f.c.location.searchParams.get('type'),'WEBTOON');assert.equal(f.c.location.searchParams.get('q'),'NewCASE');
  f.location('/home');const long=submit('x'.repeat(130));f.c.submitReaderSearch(long.event);
  assert.equal(f.c.location.searchParams.get('q').length,100);assert.equal(long.input.value.length,100);
  f.location('/home');f.c.submitReaderSearch(submit('  ').event);assert.equal(f.c.location.searchParams.has('q'),false);
});

test('legacy discovery-off header search opens the existing search flow with literal text',()=>{
  const f=fixture();f.c.ReaderDiscovery.active=()=>false;
  f.c.submitReaderSearch(submit(' <img src=x onerror=1> ').event);
  assert.deepEqual(f.modals,['modalSearch']);assert.deepEqual(f.searches,['<img src=x onerror=1>']);
  assert.equal(f.nodes.get('globalSearchInput').value,'<img src=x onerror=1>');assert.equal(f.nodes.get('globalSearchInput').focused,true);assert.equal(f.pushes.length,0);
});

test('active navigation reflects query priority while mobile explore and header fields remain synchronized',()=>{
  const f=fixture();
  for(const [query,key]of [['?type=WEBTOON','webtoon'],['?type=NOVEL','novel'],['?type=WEBTOON&sort=popular','ranking'],
    ['?type=WEBTOON&sort=new','new'],['?type=NOVEL&status=COMPLETED','completed']]){
    f.location('/discover'+query+'&q=VisibleCASE');f.c.resolveRoute(f.c.location.pathname+f.c.location.search);
    assert.equal(f.link(key).getAttribute('aria-current'),'page');assert.equal(f.link('discover').getAttribute('aria-current'),'page');
    assert.equal(f.links.filter(link=>link.getAttribute('aria-current')==='page').length,2);
    assert.equal(f.nodes.get('inputSearchHeader').value,'VisibleCASE');assert.equal(f.nodes.get('inputSearchMobile').value,'VisibleCASE');
  }
  f.c.switchWebNovelsView('view-reader',null,false);
  assert.equal(f.links.filter(link=>link.getAttribute('aria-current')==='page').length,0);
  assert.equal(f.c.document.body.getAttribute('data-active-view'),'view-reader');assert.equal(f.nodes.get('inputSearchHeader').value,'');
  f.c.navigateTo('/library');assert.equal(f.link('library').getAttribute('aria-current'),'page');assert.equal(f.link('discover').getAttribute('aria-current'),null);
});

test('rejected portal or library entry cannot change the accepted view marker',()=>{
  const f=fixture();f.c.switchWebNovelsView('view-home');f.setActor(null);
  for(const view of ['view-admin-cms','view-creator','view-mypage']){
    f.c.switchWebNovelsView(view);assert.equal(f.c.currentActiveView,'view-home');assert.equal(f.c.document.body.getAttribute('data-active-view'),'view-home');
  }
  f.setActor({userId:'author-uuid',author:{id:'5',status:'APPROVED'}});f.c.switchWebNovelsView('view-creator');
  assert.equal(f.c.document.body.getAttribute('data-active-view'),'view-creator');
  f.c.navigateTo('/home');assert.equal(f.c.document.body.getAttribute('data-active-view'),'view-home');
});

test('popstate restores search text and active type without another history entry',()=>{
  const f=fixture('/discover?type=WEBTOON&q=OriginalCASE&cursor=A_B');f.c.initRouteHandler();
  f.c.navigateTo('/discover?type=NOVEL&q=NewCASE');assert.equal(f.pushes.length,1);
  f.location('/discover?type=WEBTOON&q=OriginalCASE&cursor=A_B');f.events.get('popstate')();
  assert.equal(f.pushes.length,1);assert.equal(f.queries.length,3);assert.equal(f.link('webtoon').getAttribute('aria-current'),'page');
  assert.equal(f.nodes.get('inputSearchMobile').value,'OriginalCASE');assert.equal(new URLSearchParams(f.queries.at(-1)).get('cursor'),'A_B');
});

test('bootstrap binding does not route reader links twice and discover search focuses the real input',()=>{
  const f=fixture();f.runApp();f.c.bindWebNovelsEvents();
  const event=click(f.link('webtoon'));f.c.handleReaderRouteClick(event);f.link('webtoon').listeners.get('click')(event);
  assert.equal(f.queries.length,1);assert.equal(f.c.location.searchParams.get('type'),'WEBTOON');
  assert.equal(f.genrePill.listeners.has('click'),false,'inline genre filter has no duplicate network action');
  f.nodes.get('btnDiscoverSearch').listeners.get('click')();assert.equal(f.nodes.get('discoverQuery').focused,true);assert.equal(f.modals.length,0);
});
