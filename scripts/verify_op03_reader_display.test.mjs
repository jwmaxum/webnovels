import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const source=read('public/js/reader/reader-display.js'),reader=read('public/js/reader/reader.js'),discovery=read('public/js/reader/reader-discovery.js');
const release='11111111-1111-4111-8111-111111111111',noticeId='22222222-2222-4222-8222-222222222222';
const work=(id,extra={})=>({id:String(id),title:'작품 '+id,author:'작가 '+id,content_type:'NOVEL',rating:'ALL',episode_count:10,status:'ONGOING',cover_image:'/covers/'+id+'.webp',...extra});
const blocks=()=>['hero','recommendations','latest','ranking','notice'].map(key=>({key,title:key,enabled:true}));
const menus=()=>['home','novel','webtoon','recommendations','ranking'].map(key=>({key,label:key,visible:true}));
const feed=(extra={})=>({ready:true,revision:release,publication:{id:release,startsAt:'2026-01-01T00:00:00Z',endsAt:null},items:[work(1)],offset:0,limit:24,total:1,hasMore:false,nextOffset:null,home:{hero:work(1),featured:[work(2)]},blocks:blocks(),notices:[],menus:menus(),footerNote:'',...extra});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
class Element{
  constructor(tag,document){this.tagName=tag.toUpperCase();this.document=document;this.children=[];this.attributes={};this.dataset={};this.hidden=false;this._text='';this._id='';this.classes=new Set();this.classList={add:(...values)=>values.forEach(value=>this.classes.add(value)),remove:value=>this.classes.delete(value),contains:value=>this.classes.has(value),toggle:(value,on)=>on?this.classes.add(value):this.classes.delete(value)};}
  set id(value){this._id=String(value);this.document.ids.set(this._id,this);}get id(){return this._id;}
  set className(value){this.classes=new Set(String(value).split(/\s+/));}get className(){return [...this.classes].join(' ');}
  set textContent(value){this._text=String(value??'');this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join(' ');}
  set innerHTML(_value){assert.fail('Display data must never enter innerHTML');}
  append(...children){for(const child of children){if(child.parentElement)child.parentElement.children=child.parentElement.children.filter(item=>item!==child);child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];this._text='';this.append(...children);}
  setAttribute(key,value){this.attributes[key]=String(value);if(key==='id')this.id=value;if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_all,c)=>c.toUpperCase())]=String(value);}
  getAttribute(key){return this.attributes[key]??null;}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(matches(child,selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  focus(){this.document.activeElement=this;}
}
function matches(node,selector){return selector==='[data-reader-route]'?!!node.dataset.readerRoute:selector==='[data-reader-label]'?Object.hasOwn(node.dataset,'readerLabel'):selector.startsWith('.')?node.classes.has(selector.slice(1)):node.tagName===selector.toUpperCase();}
function fixture(handler=()=>feed(),{view='view-recommendations'}={}){
  const document={ids:new Map(),activeElement:null};document.createElement=tag=>new Element(tag,document);document.body=document.createElement('body');
  document.getElementById=id=>document.ids.get(id)||null;document.querySelectorAll=selector=>document.body.querySelectorAll(selector);document.querySelector=selector=>document.body.querySelector(selector);
  const add=(id,tag='div',parent=document.body)=>{const node=document.createElement(tag);node.id=id;parent.append(node);return node;};
  const home=add('view-home'),page=add('view-recommendations'),content=add('readerRecommendationsContent','div',page),display=add('readerDisplayHome','div',home);
  for(const [section,grid]of [['recentNovelsSection','recentNovelsGrid'],['webtoonsSection','webtoonsGrid'],['trendingWorksSection','trendingWorksGrid'],['heroFeaturedSection','cdgHeroSlider'],['editorialSpotlightSection','editorialSpotlightGrid'],['newWorksSection','newWorksGrid'],['completedWorksSection','completedWorksGrid']]){
    const host=add(section,'section',home);add(grid,'div',host);
  }
  for(const id of ['homeCatalogStatus','recentNovelsHeading','recentWebtoonsHeading','homePopularHeading','homeRankingNote','homeRecommendationNote','goldenBestSection','todayFreeSection','genreRecSection','growthHome'])add(id,'div',home);
  document.ids.get('recentNovelsGrid').classList.add('reader-work-grid');
  const readerView=add('view-reader'),box=add('readerRecommendBox','section',readerView);add('readerRecommendHeading','h2',box);add('readerRecommendGrid','div',box);
  const nav=add('publicNav','nav');for(const key of ['home','novel','webtoon','recommendations','ranking','library']){const item=add('menu-'+key,'a',nav);item.dataset.readerRoute=key;item.href='/original/'+key;const span=document.createElement('span');span.textContent='initial-'+key;item.append(span);}
  const protectedLink=add('protectedSupport','button',nav);protectedLink.textContent='고객 지원';
  const footer=add('legalFooter','footer');footer.classList.add('legal-footer');const company=add('companyIdentity','p',footer);company.textContent='기존 회사 정보';const legal=add('refundLink','a',footer);legal.href='/policies/refund/';legal.textContent='환불정책';add('readerDisplayFooterNote','p',footer);
  const requests=[],navigations=[];const context={document,URL,URLSearchParams,Response,Date,currentActiveView:view,location:new URL('https://webnovels.uk/recommendations'),console:{log(){},error(){},warn(){}},navigateTo:path=>navigations.push(path),
    fetch:async(url,init)=>{requests.push({url,init});const result=await handler(new URL(url,'https://webnovels.uk'),requests.length);return result instanceof Response?result:Response.json(result);}};
  context.window=context;vm.createContext(context);vm.runInContext(source,context,{filename:'reader-display.js'});
  return {context,document,nodes:document.ids,content,display,home,nav,footer,company,legal,protectedLink,requests,navigations,ui:context.ReaderDisplay,add};
}
const text=node=>node.textContent;
const links=node=>node.querySelectorAll('a');

test('recommendation page keeps24 server-selected novel/webtoon cards in administrator order beyond8 home positions',async()=>{
  const items=Array.from({length:24},(_value,index)=>work(24-index,{content_type:index%2?'WEBTOON':'NOVEL'})),app=fixture(()=>feed({items,total:50,hasMore:true,nextOffset:24}));
  await app.ui.enter();const cards=links(app.content).filter(item=>item.href.startsWith('/works/'));
  assert.deepEqual(cards.map(item=>item.href),items.map(item=>'/works/'+item.id));assert.equal(cards.length,24);assert.match(text(app.content),/웹툰/);assert.match(text(app.content),/웹소설/);
  assert(links(app.content).some(item=>item.href==='/recommendations?offset=24'));
  assert.equal(app.requests[0].url,'/api/v2/display?offset=0&type=ALL');assert.deepEqual({...app.requests[0].init},{credentials:'omit',cache:'no-store',redirect:'error'});
  assert.equal(app.document.activeElement,app.content);
});

test('type filters stay inside selectedfeed and reset paging while ordinary links preserve browser modifiers',async()=>{
  const app=fixture(()=>feed({items:[work(9,{content_type:'WEBTOON'})],offset:24,total:25}));await app.ui.enter({type:'WEBTOON',offset:24});
  assert.equal(app.requests[0].url,'/api/v2/display?offset=24&type=WEBTOON');const filters=links(app.content).filter(item=>item.href.startsWith('/recommendations'));
  assert(filters.some(item=>item.href==='/recommendations'));assert(filters.some(item=>item.href==='/recommendations?type=NOVEL'));
  const card=links(app.content).find(item=>item.href==='/works/9');let prevented=false;card.onclick({ctrlKey:true,preventDefault(){prevented=true;}});assert.equal(prevented,false);assert.deepEqual(app.navigations,[]);
  card.onclick({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.deepEqual(app.navigations,['/works/9']);
});

test('empty unpublished selections show preparation without catalog or popularity substitution',async()=>{
  const app=fixture(()=>feed({revision:'0',publication:null,items:[],total:0,home:{hero:null,featured:[]}}));
  app.context.ReaderCatalog={home(){assert.fail('manual display must not read fallback recommendations');}};await app.ui.enter();
  assert.match(text(app.content),/선정된 추천 작품을 준비/);assert.equal(links(app.content).filter(item=>item.href.startsWith('/works/')).length,0);
});

test('network errors render a retry and never fill the selected area from unrelated publishedworks',async()=>{
  let fail=true;const app=fixture(()=>{if(fail)throw Error('network');return feed();});app.context.getPublishedWorks=()=>{assert.fail('no alternate catalog');};
  await app.ui.enter();assert.match(text(app.content),/불러오지 못/);assert.equal(links(app.content).filter(item=>item.href.startsWith('/works/')).length,0);
  fail=false;await app.content.querySelector('button').onclick();assert.match(text(app.content),/작품 1/);
});

test('invalid response cards, draft leaks and malformed pagination fail closed',async()=>{
  for(const result of [feed({items:[work(1,{rating:'AGE_19'})]}),feed({items:[work(1,{episode_count:0})]}),feed({items:[work(1,{id:'0'})]}),feed({items:[work(1),work(1)]}),
    feed({publication:null}),feed({items:Array.from({length:25},(_item,index)=>work(index+1))}),feed({hasMore:true,nextOffset:null}),feed({hasMore:true,nextOffset:48}),feed({menus:[...menus(),{key:'admin',label:'관리',visible:true}]})]){
    const app=fixture(()=>result);await app.ui.enter();assert.match(text(app.content),/불러오지 못/);assert.equal(links(app.content).filter(item=>item.href.startsWith('/works/')).length,0);
  }
  const mismatch=fixture(()=>feed());await mismatch.ui.enter({type:'WEBTOON'});assert.match(text(mismatch.content),/불러오지 못/);
});

test('invalid public filter addresses make no request and never forward preview or administrator options',async()=>{
  for(const options of [{type:'ADULT'},{offset:-1},{offset:100001},{offset:'24'}]){const app=fixture();await app.ui.enter(options);assert.equal(app.requests.length,0);assert.match(text(app.content),/주소/);}
  const app=fixture();await app.ui.enter({type:'ALL',offset:0,at:'2099-01-01',draft:true});assert(!app.requests[0].url.includes('at=')&&!app.requests[0].url.includes('draft'));
});

test('home uses the same manualsource independently of discovery and preserves latest/ranking DOM and listeners',async()=>{
  const data=feed({blocks:[{key:'notice',title:'알림',enabled:true},{key:'ranking',title:'독자 순위',enabled:false},{key:'recommendations',title:'직접 선정',enabled:true},{key:'hero',title:'대표',enabled:true},{key:'latest',title:'새 연재',enabled:true}]}),app=fixture(()=>data,{view:'view-home'});
  const novels=app.nodes.get('recentNovelsSection'),grid=app.nodes.get('recentNovelsGrid'),ranking=app.nodes.get('trendingWorksSection');grid.onclick=()=>42;grid.textContent='기존 최신 데이터';
  await app.ui.home();assert.equal(app.requests.length,1);assert.equal(app.nodes.get('readerDisplayLatest').children[0],novels);assert.equal(app.nodes.get('recentNovelsGrid'),grid);assert.equal(grid.onclick(),42);assert.equal(text(grid),'기존 최신 데이터');
  assert.equal(app.nodes.get('readerDisplayRanking').children[0],ranking);assert.equal(app.nodes.get('readerDisplayRanking').hidden,true);
  assert.deepEqual(app.display.children.filter(item=>item.classList.contains('reader-display-block')).map(item=>item.id),['readerDisplayNotices','readerDisplayRanking','readerDisplayFeatured','readerDisplayHero','readerDisplayLatest']);
  assert.match(text(app.nodes.get('readerDisplayHero')),/작품 1/);assert.match(text(app.nodes.get('readerDisplayFeatured')),/작품 2/);
  assert.equal(app.nodes.get('heroFeaturedSection').hidden,true);assert.equal(app.nodes.get('editorialSpotlightSection').hidden,true);
  novels.hidden=false;ranking.hidden=false;app.ui.syncHome();assert.equal(app.nodes.get('readerDisplayRanking').hidden,true);assert.equal(grid.onclick(),42);
});

test('home failure removes previous manual cards and leaves actual public latest data untouched',async()=>{
  let fail=false;const app=fixture(()=>{if(fail)throw Error('network');return feed();},{view:'view-home'});await app.ui.home();assert.match(text(app.nodes.get('readerDisplayHero')),/작품 1/);
  const grid=app.nodes.get('recentNovelsGrid');grid.textContent='진짜 최신 작품';fail=true;await app.ui.home();assert.doesNotMatch(text(app.nodes.get('readerDisplayHero')),/작품 1/);assert.equal(text(grid),'진짜 최신 작품');assert.match(text(app.nodes.get('readerDisplayHomeStatus')),/불러오지 못/);
});

test('menus reorder only approvedreader entries while protecting library, support and legal nodes',async()=>{
  const ordering=menus().reverse();ordering.find(item=>item.key==='novel').visible=false;ordering.find(item=>item.key==='recommendations').label='직접 선정';
  const app=fixture(()=>feed({menus:ordering,footerNote:'<script>footer</script>'}));const originalLegal=[...app.footer.children],library=app.nodes.get('menu-library'),rank=app.nodes.get('menu-ranking');rank.hidden=true;
  await app.ui.enter();assert.deepEqual(app.nav.children.filter(item=>item.dataset.readerRoute!=='library'&&item!==app.protectedLink).map(item=>item.dataset.readerRoute),ordering.map(item=>item.key));
  assert.equal(app.nodes.get('menu-novel').hidden,true);assert.equal(rank.hidden,true,'CMS cannot unhide a structural hidden menu');assert.equal(app.nodes.get('menu-recommendations').querySelector('span').textContent,'직접 선정');
  assert.equal(library.hidden,false);assert.equal(app.protectedLink.textContent,'고객 지원');assert.equal(app.footer.children[0],originalLegal[0]);assert.equal(app.footer.children[1],originalLegal[1]);assert.equal(app.legal.href,'/policies/refund/');assert.equal(app.nodes.get('readerDisplayFooterNote').textContent,'<script>footer</script>');
});

test('direct discovery, work and library entry hydrate public chrome without rendering cards or moving catalog nodes',async()=>{
  for(const view of ['view-discover','view-work-detail','view-mypage']){
    const ordering=menus().reverse();ordering.find(item=>item.key==='webtoon').visible=false;ordering.find(item=>item.key==='recommendations').label='선정 작품';
    const app=fixture(()=>feed({menus:ordering,footerNote:'공개 운영 안내'}),{view}),grid=app.nodes.get('recentNovelsGrid'),originalParent=grid.parentElement;
    const account=app.add('accountMenu','a',app.nav);account.dataset.readerRoute='account';account.textContent='내 계정';account.href='/account';
    const legalNodes=[...app.footer.children];grid.textContent='기존 작품 목록';await app.ui.syncChrome();
    assert.equal(app.requests.length,1);assert.equal(app.requests[0].url,'/api/v2/display?offset=0&type=ALL');
    assert.equal(app.nodes.get('menu-webtoon').hidden,true);assert.equal(app.nodes.get('menu-recommendations').querySelector('span').textContent,'선정 작품');
    assert.deepEqual(app.nav.children.filter(item=>['home','novel','webtoon','recommendations','ranking'].includes(item.dataset.readerRoute)).map(item=>item.dataset.readerRoute),ordering.map(item=>item.key));
    assert.equal(app.nodes.get('readerDisplayFooterNote').textContent,'공개 운영 안내');assert.equal(account.textContent,'내 계정');assert.equal(account.href,'/account');assert.equal(account.hidden,false);
    assert.equal(app.nodes.get('menu-library').hidden,false);assert.equal(app.protectedLink.textContent,'고객 지원');assert.equal(app.footer.children[0],legalNodes[0]);assert.equal(app.footer.children[1],legalNodes[1]);assert.equal(app.legal.href,'/policies/refund/');
    assert.equal(grid.parentElement,originalParent);assert.equal(text(grid),'기존 작품 목록');assert.equal(app.display.children.length,0);assert.equal(text(app.content),'');assert.equal(links(app.nodes.get('readerRecommendGrid')).length,0);
  }
});

test('public chrome ignores late navigation results and only the newest accepted request can update menus',async()=>{
  for(const move of [app=>app.ui.leave('view-discover'),app=>{app.context.currentActiveView='view-admin-cms';},app=>{app.context.location=new URL('https://webnovels.uk/discover?type=WEBTOON');}]){
    const gate=deferred(),app=fixture(()=>gate.promise,{view:'view-discover'});app.context.location=new URL('https://webnovels.uk/discover?type=NOVEL');
    const pending=app.ui.syncChrome();move(app);gate.resolve(feed({footerNote:'늦은 안내',menus:menus().map(item=>({...item,label:'늦은 메뉴'}))}));await pending;
    assert.equal(app.nodes.get('menu-home').querySelector('span').textContent,'initial-home');assert.equal(app.nodes.get('readerDisplayFooterNote').textContent,'');
  }
  const old=deferred();let count=0;const app=fixture(()=>++count===1?old.promise:feed({footerNote:'새 안내'}),{view:'view-mypage'});
  const pending=app.ui.syncChrome();await app.ui.syncChrome();old.resolve(feed({footerNote:'이전 안내'}));await pending;assert.equal(app.nodes.get('readerDisplayFooterNote').textContent,'새 안내');
});

test('chrome-only loading rejects malformed feeds and never runs in home, recommendation, viewer or private views',async()=>{
  for(const view of ['view-home','view-recommendations','view-reader','view-admin-cms','view-creator']){
    const app=fixture(()=>feed(),{view});await app.ui.syncChrome();assert.equal(app.requests.length,0);
  }
  for(const result of [feed({items:[work(1,{rating:'AGE_19'})],footerNote:'노출 금지'}),new Response(null,{status:503})]){
    const app=fixture(()=>result,{view:'view-discover'});await app.ui.syncChrome();assert.equal(app.nodes.get('readerDisplayFooterNote').textContent,'');assert.equal(app.nodes.get('menu-home').querySelector('span').textContent,'initial-home');
  }
});

test('notice content stays literal and only approved public relative paths are rendered',async()=>{
  const app=fixture(()=>feed({notices:[{id:noticeId,title:'<img onerror=1>',body:'<script>alert(1)</script>\n안내',href:'/company/',startsAt:null,endsAt:null,enabled:true}]}),{view:'view-home'});await app.ui.home();
  const notices=app.nodes.get('readerDisplayNotices');assert.match(text(notices),/<img onerror=1>/);assert.match(text(notices),/<script>alert\(1\)<\/script>/);assert.equal(notices.querySelectorAll('img').length,0);assert.equal(links(notices)[0].href,'/company/');
  let prevented=false;links(notices)[0].onclick({preventDefault(){prevented=true;}});assert.equal(prevented,false,'policy/company links use native full-page navigation');
  for(const href of ['javascript:alert(1)','//evil.test','https://evil.test','/admin','/works/1?draft=1','/policies/../admin','/works/0']){
    const unsafe=fixture(()=>feed({notices:[{id:noticeId,title:'안내',body:'본문',href,startsAt:null,endsAt:null,enabled:true}]}),{view:'view-home'});await unsafe.ui.home();assert.match(text(unsafe.nodes.get('readerDisplayHomeStatus')),/불러오지 못/);assert.equal(unsafe.nodes.get('readerDisplayNotices').querySelectorAll('a').length,0);
  }
});

test('disabled and out-of-window notices are not displayed',async()=>{
  const base={id:noticeId,title:'보이면 안됨',body:'본문',href:'/home',startsAt:null,endsAt:null,enabled:true};
  for(const extra of [{enabled:false},{startsAt:'2999-01-01T00:00:00Z'},{endsAt:'2000-01-01T00:00:00Z'}]){const app=fixture(()=>feed({notices:[{...base,...extra}]}),{view:'view-home'});await app.ui.home();assert.equal(app.nodes.get('readerDisplayNotices').hidden,true);assert.doesNotMatch(text(app.nodes.get('readerDisplayNotices')),/보이면 안됨/);}
});

test('plain notices without a destination remain visible without an empty link',async()=>{
  const app=fixture(()=>feed({notices:[{id:noticeId,title:'운영 안내',body:'링크 없는 공지 본문',href:'',startsAt:null,endsAt:null,enabled:true}]}),{view:'view-home'});
  await app.ui.home();const notices=app.nodes.get('readerDisplayNotices');assert.match(text(notices),/링크 없는 공지 본문/);assert.equal(links(notices).length,0);
});

test('cover protocol abuse becomes a neutral placeholder without unrelated cover substitution',async()=>{
  const app=fixture(()=>feed({items:[work(1,{title:'<svg onload=1>',author:'<img>',cover_image:'javascript:alert(1)'})]}));await app.ui.enter();const card=links(app.content).find(item=>item.href==='/works/1');assert.equal(card.querySelectorAll('img').length,0);assert.match(text(card),/표지 준비 중/);assert.match(text(card),/<svg onload=1>/);
});

test('newer page, leave and reset invalidate late public results and menu updates',async()=>{
  const old=deferred();let count=0;const app=fixture(()=>++count===1?old.promise:feed({items:[work(2)]}));const pending=app.ui.enter();await app.ui.enter();old.resolve(feed({items:[work(1)],footerNote:'늦은 값'}));await pending;assert.match(text(app.content),/작품 2/);assert(!links(app.content).some(item=>item.href==='/works/1'));assert.notEqual(app.nodes.get('readerDisplayFooterNote').textContent,'늦은 값');
  const leaving=deferred(),next=fixture(()=>leaving.promise),loading=next.ui.enter();next.ui.leave('view-home');leaving.resolve(feed({footerNote:'떠난 화면'}));await loading;assert.doesNotMatch(text(next.content),/작품 1/);assert.notEqual(next.nodes.get('readerDisplayFooterNote').textContent,'떠난 화면');
  const reset=deferred(),last=fixture(()=>reset.promise),lastLoading=last.ui.enter();last.ui.reset();reset.resolve(feed());await lastLoading;assert.equal(text(last.content),'');
});

test('home leave suppresses late cards and leaves protected catalog nodes in their original identity',async()=>{
  const gate=deferred(),app=fixture(()=>gate.promise,{view:'view-home'}),grid=app.nodes.get('recentNovelsGrid');grid.textContent='계속 남는 공개 목록';const pending=app.ui.home();app.ui.leave('view-discover');gate.resolve(feed());await pending;
  assert.doesNotMatch(text(app.nodes.get('readerDisplayHero')),/작품 1/);assert.equal(app.nodes.get('recentNovelsGrid'),grid);assert.equal(text(grid),'계속 남는 공개 목록');
});

test('viewer recommendations come only from manualfeed and exclude currentwork with stale-session protection',async()=>{
  const app=fixture(()=>feed({items:[work(1),work(2),work(3),work(4),work(5),work(6)],total:6,footerNote:'뷰어 공개 안내'}),{view:'view-reader'});await app.ui.viewer('1');
  assert.deepEqual(links(app.nodes.get('readerRecommendGrid')).map(item=>item.href),['/works/2','/works/3','/works/4','/works/5']);assert.equal(app.nodes.get('readerRecommendHeading').textContent,'관리자 선정 추천');
  assert.equal(app.requests.length,1);assert.equal(app.nodes.get('readerDisplayFooterNote').textContent,'뷰어 공개 안내');assert.equal(app.nodes.get('menu-home').querySelector('span').textContent,'home');
  const gate=deferred(),late=fixture(()=>gate.promise,{view:'view-reader'});let current=true;const pending=late.ui.viewer('1',{isCurrent:()=>current});current=false;gate.resolve(feed());await pending;assert.equal(links(late.nodes.get('readerRecommendGrid')).length,0);
});

test('viewer empty and failed manualfeed never call catalog recommendations or alternate works',async()=>{
  const app=fixture(()=>feed({items:[work(1)],total:1}),{view:'view-reader'});await app.ui.viewer('1');assert.equal(app.nodes.get('readerRecommendBox').hidden,true);
  const fail=fixture(()=>{throw Error('network');},{view:'view-reader'});fail.context.ReaderCatalog={home(){assert.fail('no old flag fallback');}};await fail.ui.viewer('1');assert.match(text(fail.nodes.get('readerRecommendGrid')),/불러오지 못/);assert.equal(links(fail.nodes.get('readerRecommendGrid')).length,0);
});

test('actual legacy and discovery home hooks and viewer route defer manual rendering to the shared module',async()=>{
  const app=fixture(()=>feed(),{view:'view-home'});let home=0,sync=0,viewer=0;
  app.context.ReaderDisplay={home:async()=>{home++;},syncHome:()=>{sync++;},viewer:async()=>{viewer++;}};
  app.context.ReaderDiscovery={active:()=>false};app.context.WEBNOVELS_CONFIG={webtoonServiceEnabled:true};app.context.getPublishedWorks=()=>[];
  app.context.getWorkCover=()=>'/cover.webp';app.context.getAuthorName=()=>'';
  const from=reader.indexOf('async function renderHomeWorks()'),to=reader.indexOf('// --- 2. 탐색',from);vm.runInContext(reader.slice(from,to),app.context);await app.context.renderHomeWorks();assert.equal(home,1);assert.equal(sync,1);
  const viewerFrom=reader.indexOf('async function renderReaderRecommendations('),viewerTo=reader.indexOf('// 🪙 포인트로 회차',viewerFrom);vm.runInContext(reader.slice(viewerFrom,viewerTo),app.context);await app.context.renderReaderRecommendations('1');assert.equal(viewer,1);
});

test('actual discovery home never substitutes old flagged recommendations for the independently loaded display',async()=>{
  const app=fixture(()=>feed({items:[work(11)],home:{hero:work(11),featured:[work(12)]}}),{view:'view-home'});
  const mapped=id=>({...work(id),id:String(id),contentType:'NOVEL',coverUrl:'/cover.webp',episodeCount:10,lastPublishedAt:'2026-01-01',rankingReaders:8});
  app.context.WEBNOVELS_CONFIG={webtoonServiceEnabled:true};app.context.ReaderCatalog={active:()=>true,home:async()=>({sections:{recommended:[mapped(999)],spotlight:[mapped(998)],popular:[mapped(3)],new:[],completed:[],webtoons:[]},ranking:{}}),list:async()=>({works:[mapped(2)]})};
  app.context.GrowthStudio={home(){assert.fail('hidden algorithmic shelves must not load alongside CMS-owned blocks');}};
  vm.runInContext(discovery,app.context,{filename:'reader-discovery.js'});await app.context.ReaderDiscovery.home();
  assert.match(text(app.nodes.get('readerDisplayHero')),/작품 11/);assert.match(text(app.nodes.get('readerDisplayFeatured')),/작품 12/);
  assert.equal(links(app.nodes.get('cdgHeroSlider')).length,0);assert.equal(links(app.nodes.get('editorialSpotlightGrid')).length,0);
  assert.match(text(app.nodes.get('recentNovelsGrid')),/작품 2/);assert.match(text(app.nodes.get('trendingWorksGrid')),/작품 3/);
  assert.equal(app.nodes.get('heroFeaturedSection').hidden,true);assert.equal(app.nodes.get('editorialSpotlightSection').hidden,true);
});

test('published display CSS is scoped, token-based, responsive and keyboard operable',async()=>{
  const css=read('public/css/reader-display.css'),parsed=await transform(css,{loader:'css'});assert.deepEqual(parsed.warnings,[]);
  assert.doesNotMatch(css,/@import|@font-face|url\s*\(|#[a-f\d]{6}\b|rgba?\(/i);assert.match(css,/min-height:\s*44px/);assert.match(css,/:focus-visible/);assert.match(css,/outline:\s*3px solid var\(--border-focus\)/);assert.match(css,/repeat\(2, minmax\(0, 1fr\)\)/);assert.match(css,/reader-display-owned[\s\S]*?#growthHome[\s\S]*?display:\s*none !important/);
  assert.doesNotMatch(css,/overflow(?:-x)?:\s*hidden[^}]*reader-display-grid/);assert.match(css,/\.legal-footer #readerDisplayFooterNote/);
});
