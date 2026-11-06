import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const sources = await Promise.all(['reader-catalog.js','reader-discovery.js'].map(async name => ({name,code:await readFile(new URL('../public/js/reader/'+name,import.meta.url),'utf8')})));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const work = (id='10',extra={}) => ({id,title:'작품 '+id,author:'작가',author_id:'99',genre:['로맨스'],content_type:'NOVEL',cover_image:'/covers/'+id+'.webp',status:'ONGOING',rating:'ALL',episode_count:10,last_published_at:'2026-10-31T00:00:00Z',...extra});
const home = (sections={}) => ({sections:{recommended:[],spotlight:[],popular:[],new:[],completed:[],webtoons:[],...sections},ranking:{periodDays:7,minSample:5,asOf:'2026-10-31T00:00:00Z'}});
class Element {
  constructor(tag='div') {this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.dataset={};this.hidden=false;this.value='';this._text='';const classes=new Set();this.classList={add:(...items)=>items.forEach(item=>classes.add(item)),remove:item=>classes.delete(item),contains:item=>classes.has(item),toggle:(item,enabled)=>{const value=enabled??!classes.has(item);value?classes.add(item):classes.delete(item);return value;}};}
  set textContent(value){this._text=String(value??'');this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set innerHTML(_){throw Error('Authored data must use text nodes');}
  append(...children){for(const child of children.filter(Boolean)){child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){this._text='';this.children=[];this.append(...children);}
  setAttribute(key,value){this.attributes[key]=String(value);}
  getAttribute(key){return this.attributes[key]??null;}
  removeAttribute(key){delete this.attributes[key];}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  querySelectorAll(selector){const result=[];const visit=el=>{for(const child of el.children){if(selector==='button'&&child.tagName==='BUTTON'||selector==='[data-discover-tag]'&&child.dataset.discoverTag)result.push(child);visit(child);}};visit(this);return result;}
}
function setup(handler,{webtoon=true}={}) {
  const ids=['recentNovelsSection','recentNovelsGrid','homeCatalogStatus','heroFeaturedSection','cdgHeroSlider','editorialSpotlightSection','editorialSpotlightGrid','trendingWorksSection','trendingWorksGrid','newWorksSection','newWorksGrid','completedWorksSection','completedWorksGrid','webtoonsSection','webtoonsGrid','todayFreeSection','todayFreeGrid','genreRecSection','genreWorksGrid','goldenBestSection','homeRankingNote','homeRecommendationNote',
    'discoverActiveFilters','discoverWorksGrid','discoverPager','discoverResultsCount','discoverQueryStatus','discoveryRankingNote','selectDiscoverSort','discoverQuery','discoverType','inputSearchHeader','inputSearchMobile','discoverGenreFilters','filterStatusGroup','filterEpRangeGroup','filterRatingGroup','discoverTagFilters','activeTagsCounter'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Element()])),description=new Element('meta'),head=new Element('head'),requests=[],navigations=[],events=new Map();
  let navSyncs=0;
  const context={URL,URLSearchParams,Date,Response,clearInterval(){},setTimeout,clearTimeout,WEBNOVELS_CONFIG:{readerDiscoveryEnabled:true,webtoonServiceEnabled:webtoon},location:new URL('https://app.test/home'),
    addEventListener(type,callback){if(!events.has(type))events.set(type,[]);events.get(type).push(callback);},
    dispatchEvent(event){for(const callback of events.get(event.type)||[])callback(event);},
    document:{title:'webnovels',head,getElementById:id=>nodes[id]||null,createElement:tag=>new Element(tag),querySelector:selector=>selector==='meta[name="description"]'?description:null},
    fetch:async(url,init)=>{const parsed=new URL(url,'https://app.test');requests.push({url:parsed,init});return handler(parsed,requests.length);},
    navigateTo:path=>{navigations.push(path);context.location=new URL(path,context.location);},syncReaderNavigation(){navSyncs++;}};
  context.window=context;vm.createContext(context);for(const source of sources)vm.runInContext(source.code,context,{filename:source.name});
  const visibleCards=()=>[['heroFeaturedSection','cdgHeroSlider'],['editorialSpotlightSection','editorialSpotlightGrid'],['recentNovelsSection','recentNovelsGrid'],['webtoonsSection','webtoonsGrid'],['trendingWorksSection','trendingWorksGrid'],['newWorksSection','newWorksGrid'],['completedWorksSection','completedWorksGrid']].filter(([section])=>!nodes[section].hidden).flatMap(([,grid])=>nodes[grid].children.filter(item=>item.tagName==='A'));
  return {context,nodes,requests,navigations,ui:context.ReaderDiscovery,visibleCards,navSyncs:()=>navSyncs};
}
const reply = value => Response.json(value);

test('one actual work is shown once across home shelves and no invented ranking or episode route is emitted',async()=>{
  const item=work('10',{title:'<img onerror=alert(1)>',author:'<script>author</script>',status:'COMPLETED'});
  const app=setup(url=>reply(url.searchParams.get('action')==='home'?home({recommended:[item,item],spotlight:[item],popular:[item],new:[item],completed:[item]}):{works:[item]}));
  await app.ui.home();
  assert.deepEqual(app.visibleCards().map(card=>card.href),['/works/10']);
  assert.equal(app.nodes.cdgHeroSlider.children[0].classList.contains('discovery-featured'),true);
  assert.match(app.visibleCards()[0].textContent,/<img onerror=alert\(1\)>/);
  assert.match(app.visibleCards()[0].textContent,/전체이용가/);
  assert.doesNotMatch(app.visibleCards()[0].textContent,/독자 \d+명/);
  for(const id of ['editorialSpotlightSection','trendingWorksSection','newWorksSection','completedWorksSection','todayFreeSection','genreRecSection','goldenBestSection'])assert.equal(app.nodes[id].hidden,true,id);
  const latest=app.requests.find(row=>row.url.searchParams.get('action')==='list').url.searchParams;
  assert.equal(latest.get('type'),'NOVEL');assert.equal(latest.get('sort'),'latest');assert.equal(latest.get('limit'),'6');
  assert.ok(app.requests.every(row=>row.init.credentials==='omit'&&row.init.cache==='no-store'));
});

test('locale change preserves the submitted query and draft input while dropping the old locale cursor',async()=>{
  const app=setup(()=>reply({works:[work('10',{localization:{locale:'en',title:'A published story'}})],nextCursor:null}));
  const {context,nodes}=app;
  context.currentActiveView='view-discover';
  context.location=new URL('https://app.test/discover?type=NOVEL&q=cat&tag=romance&cursor=OLD');
  context.history={state:{route:'discover'},replaceState(state,title,path){context.location=new URL(path,context.location);}};
  context.CustomEvent=class{constructor(type){this.type=type;}};
  context.document.documentElement={lang:'ko'};
  context.document.querySelectorAll=()=>[];
  for(const file of ['reader-feature-messages.js','reader-i18n.js']){
    const code=await readFile(new URL('../public/js/core/'+file,import.meta.url),'utf8');
    vm.runInContext(code,context,{filename:file});
  }
  await app.ui.discover();
  nodes.discoverQuery.value='not submitted';
  assert.equal(context.ReaderI18n.setLocale('en'),true);
  await tick();
  const query=app.requests.at(-1).url.searchParams;
  assert.equal(query.get('type'),'NOVEL');assert.equal(query.get('q'),'cat');assert.equal(query.get('tag'),'romance');
  assert.equal(query.has('cursor'),false);assert.equal(context.location.searchParams.has('cursor'),false);
  assert.equal(context.location.pathname,'/discover');assert.equal(nodes.discoverQuery.value,'not submitted');
  assert.equal(app.navigations.length,0,'locale does not add history navigation');
  assert.equal(nodes.discoverWorksGrid.children[0].href,'/works/10');
  assert.match(nodes.discoverWorksGrid.textContent,/A published story/);
  assert.match(nodes.discoverResultsCount.textContent,/1 work on this page/);
});

test('primary shelves show explicit empty states while optional empty shelves are omitted',async()=>{
  const app=setup(url=>reply(url.searchParams.get('action')==='home'?home():{works:[]}));
  await app.ui.home();
  assert.equal(app.nodes.recentNovelsSection.hidden,false);assert.equal(app.nodes.webtoonsSection.hidden,false);
  assert.match(app.nodes.recentNovelsGrid.textContent,/아직 공개된 웹소설이 없습니다/);
  assert.match(app.nodes.webtoonsGrid.textContent,/아직 공개된 웹툰이 없습니다/);
  assert.equal(app.nodes.heroFeaturedSection.hidden,true);assert.equal(app.nodes.homeCatalogStatus.hidden,true);
  assert.equal(app.nodes.recentNovelsGrid.getAttribute('aria-busy'),'false');assert.equal(app.nodes.webtoonsGrid.getAttribute('aria-busy'),'false');
});

test('type-specific primary shelves keep novel and webtoon works distinct with a maximum of six cards',async()=>{
  const novels=Array.from({length:8},(_,i)=>work(String(10+i))),webtoons=Array.from({length:8},(_,i)=>work(String(30+i),{content_type:'WEBTOON'}));
  const app=setup(url=>reply(url.searchParams.get('action')==='home'?home({webtoons,popular:[novels[0],webtoons[0],work('99',{ranking_readers:8})]}):{works:novels}));
  await app.ui.home();
  assert.equal(app.nodes.recentNovelsGrid.children.length,6);assert.equal(app.nodes.webtoonsGrid.children.length,6);
  assert.equal(new Set(app.visibleCards().map(card=>card.href)).size,app.visibleCards().length);
  assert.match(app.nodes.webtoonsGrid.textContent,/웹툰/);assert.match(app.nodes.trendingWorksGrid.textContent,/최근 7일 독자 8명/);
});

test('summary failure preserves successful latest novels and provides a retry without stale optional cards',async()=>{
  let failed=false;
  const app=setup(url=>{if(url.searchParams.get('action')==='list')return reply({works:[work('20')]});if(failed)throw Error('network');return reply(home({recommended:[work('10')]}));});
  await app.ui.home();assert.match(app.nodes.cdgHeroSlider.textContent,/작품 10/);
  failed=true;await app.ui.home();
  assert.equal(app.nodes.heroFeaturedSection.hidden,true);assert.doesNotMatch(app.nodes.cdgHeroSlider.textContent,/작품 10/);
  assert.match(app.nodes.recentNovelsGrid.textContent,/작품 20/);assert.match(app.nodes.homeCatalogStatus.textContent,/다시 시도/);assert.match(app.nodes.webtoonsGrid.textContent,/불러오지 못/);
});

test('latest-only failure retains editorial and webtoon shelves and a recoverable latest error',async()=>{
  const app=setup(url=>{if(url.searchParams.get('action')==='list')throw Error('latest unavailable');return reply(home({recommended:[work('10')],webtoons:[work('30',{content_type:'WEBTOON'})]}));});
  await app.ui.home();
  assert.match(app.nodes.cdgHeroSlider.textContent,/작품 10/);assert.match(app.nodes.webtoonsGrid.textContent,/작품 30/);assert.match(app.nodes.recentNovelsGrid.textContent,/다시 시도/);
  assert.equal(app.nodes.homeCatalogStatus.hidden,true);assert.equal(app.nodes.recentNovelsGrid.getAttribute('aria-busy'),'false');
});

test('newer home or leaving home invalidates all delayed summary and latest results',async()=>{
  const firstHome=deferred(),firstLatest=deferred();let homes=0,lists=0;
  const app=setup(url=>url.searchParams.get('action')==='home'?(++homes===1?firstHome.promise:reply(home())):(++lists===1?firstLatest.promise:reply({works:[work('20')]})));
  const old=app.ui.home();await app.ui.home();firstHome.resolve(reply(home({recommended:[work('10')]})));firstLatest.resolve(reply({works:[work('10')]}));await old;
  assert.doesNotMatch(app.visibleCards().map(card=>card.textContent).join(''),/작품 10/);assert.match(app.nodes.recentNovelsGrid.textContent,/작품 20/);
  const pending=deferred();app.context.ReaderCatalog=Object.freeze({...app.context.ReaderCatalog,home:()=>pending.promise,list:()=>pending.promise});
  const leaving=app.ui.home();app.ui.leave('view-discover');pending.resolve({sections:home().sections,works:[{id:'40',title:'늦은 작품',contentType:'NOVEL'}]});await leaving;
  assert.doesNotMatch(app.nodes.recentNovelsGrid.textContent,/늦은 작품/);assert.equal(app.nodes.heroFeaturedSection.hidden,true);
});

test('filter chips remove one condition, retain webtoon/query/other tags, drop cursor, and use safe labels',async()=>{
  const app=setup(()=>reply({works:[],nextCursor:null}));
  await app.ui.discover('?type=WEBTOON&q=%3Csvg%20onload%3D1%3E&genre=로맨스&tag=romance&tag=growth&sort=popular&cursor=OPAQUE');
  assert.equal(app.nodes.inputSearchHeader.value,'<svg onload=1>');assert.equal(app.nodes.inputSearchMobile.value,'<svg onload=1>');assert.equal(app.navSyncs(),1);
  assert.match(app.nodes.discoverActiveFilters.textContent,/<svg onload=1>/);
  const genre=app.nodes.discoverActiveFilters.children.find(child=>child.textContent.startsWith('장르:'));genre.onclick();
  let query=new URL(app.navigations.at(-1),'https://app.test').searchParams;
  assert.equal(query.get('type'),'WEBTOON');assert.equal(query.get('q'),'<svg onload=1>');assert.equal(query.has('genre'),false);assert.equal(query.has('cursor'),false);assert.deepEqual(query.getAll('tag'),['romance','growth']);
  const growth=app.nodes.discoverActiveFilters.children.find(child=>child.textContent.startsWith('#growth'));growth.onclick();
  query=new URL(app.navigations.at(-1),'https://app.test').searchParams;assert.deepEqual(query.getAll('tag'),['romance']);assert.equal(query.get('genre'),'로맨스');assert.equal(query.get('sort'),'popular');
  assert.equal(app.nodes.discoverWorksGrid.getAttribute('aria-busy'),'false');
});

test('empty discovery reset preserves selected type and disabled webtoon uses service preparation text',async()=>{
  const app=setup(()=>reply({works:[],nextCursor:null}));
  await app.ui.discover('?type=WEBTOON&q=none');app.nodes.discoverWorksGrid.children.find(child=>child.tagName==='BUTTON').onclick();
  assert.equal(app.navigations.at(-1),'/discover?type=WEBTOON');
  const disabled=setup(()=>reply({works:[],nextCursor:null}),{webtoon:false});
  await disabled.ui.discover('?type=WEBTOON');assert.match(disabled.nodes.discoverWorksGrid.textContent,/준비 중/);assert.equal(disabled.nodes.discoverWorksGrid.children.some(child=>child.tagName==='BUTTON'),false);
  await disabled.ui.home();assert.match(disabled.nodes.webtoonsGrid.textContent,/준비 중/);assert.equal(disabled.nodes.webtoonsGrid.getAttribute('aria-busy'),'false');
});

test('in-flight discovery busy state and stale result cannot overwrite a later query',async()=>{
  const pending=deferred();let calls=0;const app=setup(()=>++calls===1?pending.promise:reply({works:[work('20')],nextCursor:null}));
  const old=app.ui.discover('?q=old');assert.equal(app.nodes.discoverWorksGrid.getAttribute('aria-busy'),'true');
  await app.ui.discover('?q=new');pending.resolve(reply({works:[work('10')],nextCursor:null}));await old;await tick();
  assert.match(app.nodes.discoverWorksGrid.textContent,/작품 20/);assert.doesNotMatch(app.nodes.discoverWorksGrid.textContent,/작품 10/);assert.equal(app.nodes.discoverWorksGrid.getAttribute('aria-busy'),'false');
});
