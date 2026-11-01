import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parse} from 'parse5';
import {transform} from 'esbuild';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const html=await read('public/index.html'),css=await read('public/css/reader-shell.css'),reader=await read('public/js/reader/reader.js');
const errors=[],tree=parse(html,{onParseError:error=>errors.push(error)}),nodes=[];
function walk(node){if(node.tagName)nodes.push(node);for(const child of node.childNodes||[])walk(child);}walk(tree);
const attr=(node,key)=>node?.attrs?.find(item=>item.name===key)?.value;
const byId=id=>nodes.find(node=>attr(node,'id')===id);
const within=(node,ancestor)=>{for(let parent=node?.parentNode;parent;parent=parent.parentNode)if(parent===ancestor)return true;return false;};

test('reader shell keeps one set of landmarks, real search forms and shareable type navigation',async()=>{
  assert.deepEqual(errors,[]);
  const ids=nodes.map(node=>attr(node,'id')).filter(Boolean);assert.equal(new Set(ids).size,ids.length,'duplicate DOM IDs');
  assert.equal(byId('readerMain').tagName,'main');assert.equal(attr(byId('readerMain'),'tabindex'),'-1');
  const nav=byId('readerPrimaryNav'),allLinks=nodes.filter(node=>node.tagName==='a'&&within(node,nav));
  const testLinks=allLinks.filter(link=>attr(link,'data-points-test-entry')!==undefined);
  assert.equal(testLinks.length,1,'one explicitly gated TEST entry');
  assert.equal(attr(testLinks[0],'hidden'),'','TEST entry is hidden in default HTML');
  assert.equal(attr(testLinks[0],'href'),'/reading-test');
  assert.equal(attr(testLinks[0],'onclick'),'return handleReaderRouteClick(event)');
  const links=allLinks.filter(link=>attr(link,'data-points-test-entry')===undefined);
  assert(links.every(link=>attr(link,'hidden')===undefined),'ordinary navigation remains visible');
  assert.deepEqual(links.map(link=>attr(link,'href')),['/home','/discover?type=NOVEL','/discover?type=WEBTOON','/recommendations','/discover?sort=popular','/discover?sort=new','/discover?status=COMPLETED']);
  assert(allLinks.every(link=>!attr(link,'class')?.split(' ').includes('nav-link')),'generic navigation must not drop queries');
  for(const [formId,inputId]of [['desktopHeaderSearch','inputSearchHeader'],['mobileSearchBarWrap','inputSearchMobile']]){
    const form=byId(formId),input=byId(inputId);assert.equal(form.tagName,'form');assert.equal(attr(form,'action'),'/discover');
    assert.equal(attr(form,'onsubmit'),'submitReaderSearch(event)');assert(within(input,form));assert.equal(attr(input,'name'),'q');
    assert.equal(attr(input,'type'),'search');assert.equal(attr(input,'maxlength'),'100');assert.equal(attr(input,'readonly'),undefined);
    assert(nodes.some(node=>node.tagName==='label'&&attr(node,'for')===inputId));
  }
  const bottom=byId('mobileBottomNav');
  assert.deepEqual(nodes.filter(node=>within(node,bottom)&&['a','button'].includes(node.tagName)&&attr(node,'hidden')===undefined).map(node=>attr(node,'id')),['bnavHome','bnavDiscover','bnavLibrary','bnavRecommendations','bnavMore']);
});

test('home shelves and collapsed filters remain in their own views with sorting always reachable',()=>{
  for(const id of ['recentNovelsSection','webtoonsSection','heroFeaturedSection','sectionContinueReading'])assert(within(byId(id),byId('view-home')),id);
  const details=byId('discoverFilterDashboard');assert.equal(details.tagName,'details');assert(within(details,byId('view-discover')));
  const summary=details.childNodes.find(node=>node.tagName);assert.equal(summary.tagName,'summary');
  assert(!nodes.some(node=>within(node,summary)&&['button','a','input','select','div'].includes(node.tagName)));
  for(const id of ['filterStatusGroup','filterRatingGroup','filterEpRangeGroup','discoverTagFilters'])assert(within(byId(id),details),id);
  for(const id of ['selectDiscoverSort','discoverResultsCount','discoverActiveFilters','btnResetDiscoverFilters']){
    assert(within(byId(id),byId('view-discover')),id);assert(!within(byId(id),details),id+' hidden in collapsed filters');
  }
  assert(nodes.some(node=>within(node,byId('discoverGenreFilters'))&&attr(node,'onclick')?.includes("'로맨스'")));
  assert.equal(attr(byId('continueCardCover'),'src'),undefined,'no mock continuation artwork');
  for(const id of ['genreRecSection','todayFreeSection','goldenBestSection'])assert.equal(attr(byId(id),'hidden'),'');
  for(const id of ['creatorTabsBar','creatorTab-works','adminOperationsShell'])assert(byId(id),'workspace contract '+id);
  assert.doesNotMatch(html,/getElementById\('btnSearchOpen'\)\.click/,'library discovery entry must resolve');
});

test('responsive reader styles parse and preserve workspace, hidden and reader image boundaries',async()=>{
  const result=await transform(css,{loader:'css'});assert.deepEqual(result.warnings,[]);
  assert.match(css,/repeat\(6, minmax\(0, 1fr\)\)/);assert.match(css,/@media \(max-width: 600px\)[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css,/safe-area-inset-bottom/);assert.match(css,/body\.portal-fullscreen-mode :is\(#readerPrimaryNav, #mobileBottomNav/);
  assert.match(css,/body\[data-active-view="view-reader"\] :is\(#mainHeader, #mobileBottomNav/);
  assert.match(css,/body\[data-active-view\] \[hidden\] \{ display: none !important/);
  assert.doesNotMatch(css,/reader-paper|creator-rich-body|\.webtoon-panel|data-user-role/);
  assert.match(css,/:focus-visible/);assert.match(css,/#discoverFilterDashboard > summary \{ display: list-item/);
  assert.match(css,/#discoverFilterDashboard \.filter-row \{[^}]*flex-direction: row/,'mobile flex-basis must remain a width');
  assert.match(css,/body\[data-active-view="view-work-detail"\] \.sticky-bottom-cta \{ bottom: calc\(64px \+ env\(safe-area-inset-bottom/);
  const path=attr(nodes.find(node=>node.tagName==='link'&&attr(node,'href')?.startsWith('/css/reader-shell.css')),'href');
  assert(path?.includes('?v='));await readFile(new URL('../public'+path.split('?')[0],import.meta.url));
});

test('legacy home uses real published chapters, supports both types and does not invent ranking metrics',async()=>{
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.attrs={};this.hidden=false;this.classList={contains:value=>value==='reader-work-grid'};}
    append(...items){this.children.push(...items);}replaceChildren(...items){this.children=[...items];this.textContent='';}
    setAttribute(key,value){this.attrs[key]=value;}getAttribute(key){return key==='href'?this.href:this.attrs[key];}
  }
  const ids=['recentNovelsGrid','webtoonsGrid','recentNovelsHeading','recentWebtoonsHeading','homeCatalogStatus','recentNovelsSection','webtoonsSection',
    'heroFeaturedSection','editorialSpotlightSection','trendingWorksSection','newWorksSection','completedWorksSection','goldenBestSection','todayFreeSection','genreRecSection'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Element()])),routes=[];
  const works=[{id:'11',title:'<img onerror=alert(1)>',author:'실제 작가',contentType:'NOVEL',status:'COMPLETED',episodes:[{id:'91'}]},
    {id:'12',title:'실제 웹툰',contentType:'WEBTOON',episodes:[{id:'92'}]},{id:'13',title:'공개 회차 없음',contentType:'NOVEL',episodes:[]}];
  const context={ReaderDiscovery:{active:()=>false},WEBNOVELS_CONFIG:{webtoonServiceEnabled:true},getPublishedWorks:()=>works,
    getWorkCover:()=>'/covers/actual.webp',getAuthorName:work=>work.author||'작가',navigateTo:path=>routes.push(path),
    document:{getElementById:id=>nodes[id]||null,createElement:tag=>new Element(tag)}};context.window=context;vm.createContext(context);
  const start=reader.indexOf('async function renderHomeWorks()');vm.runInContext(reader.slice(start,reader.indexOf('// --- 2. 탐색',start)),context);
  await context.renderHomeWorks();assert.equal(nodes.recentNovelsGrid.children.length,1);assert.equal(nodes.webtoonsGrid.children.length,1);
  const card=nodes.recentNovelsGrid.children[0];assert.equal(card.children[1].children[0].textContent,works[0].title);
  assert.match(card.children[1].children[2].textContent,/완결 · 공개 1화/);assert.equal(card.children[1].children.length,3);
  card.onclick({button:0,preventDefault(){}});assert.equal(routes[0],'/works/11');
  context.WEBNOVELS_CONFIG.webtoonServiceEnabled=false;await context.renderHomeWorks();assert.match(nodes.webtoonsGrid.textContent,/준비 중/);
  works.length=0;await context.renderHomeWorks();assert.match(nodes.recentNovelsGrid.children[0].textContent,/표시할 작품이 없습니다/);
});

test('changing catalog type keeps the current query through the shared URL filter',()=>{
  const calls=[],context={updateDiscoverTypeControls(){},discoverFilterState:{},ReaderDiscovery:{active:()=>true,filter:(key,value)=>calls.push([key,value])}};
  context.window=context;vm.createContext(context);const start=reader.indexOf('window.setDiscoverType = function');
  vm.runInContext(reader.slice(start,reader.indexOf('\n};',start)+4),context);context.setDiscoverType('WEBTOON');
  assert.deepEqual(calls,[['type','WEBTOON']]);
});
