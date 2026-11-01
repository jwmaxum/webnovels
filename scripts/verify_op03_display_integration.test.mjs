import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse} from 'parse5';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const code={router:read('public/js/core/router.js'),navigation:read('public/js/admin/admin-navigation.js'),operations:read('public/js/admin/admin-operations.js')};
const plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
class Element{
  constructor(tag='div',attrs={}){this.tag=tag;this.children=[];this.attrs={...attrs};this.dataset={};this.hidden=false;this._text='';this.value='';this.classes=new Set();
    for(const [key,value]of Object.entries(attrs))if(key==='data-reader-route')this.dataset.readerRoute=value;
    this.classList={add:(...names)=>names.forEach(name=>this.classes.add(name)),remove:(...names)=>names.forEach(name=>this.classes.delete(name)),contains:name=>this.classes.has(name)};}
  set textContent(value){this._text=String(value??'');this.children=[];}get textContent(){return this._text+' '+this.children.map(child=>child.textContent).join(' ');}
  set innerHTML(_){assert.fail('shell integration uses native text nodes');}
  append(...children){this.children.push(...children);}replaceChildren(...children){this._text='';this.children=[...children];}
  setAttribute(key,value){this.attrs[key]=String(value);}getAttribute(key){return this.attrs[key]??null;}removeAttribute(key){delete this.attrs[key];}
  querySelectorAll(selector){const tags=selector.split(',').map(value=>value.trim());return this.children.flatMap(child=>[...(tags.includes(child.tag)?[child]:[]),...child.querySelectorAll(selector)]);}
  focus(){this.focused=true;}
}
function fixture({permissions=['CURATION_WRITE'],hold,workflow=false}={}){
  const ids=['view-home','view-discover','view-recommendations','view-mypage','view-reader','view-work-detail','view-creator','view-admin-cms','readerRecommendationsContent',
    'adminOperationsContent','adminOperationsShell','adminOperationsNav','adminConsoleIdentity','adminSectionTabs','adminBreadcrumbs','adminWorkspaceHeading','adminWorkspaceDescription','adminGlobalSearch','adminGlobalSearchInput','adminGlobalSearchResults'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Element()])),links=['home','novel','webtoon','recommendations','ranking','discover','library'].map(key=>new Element('a',{'data-reader-route':key,href:key==='recommendations'?'/recommendations':'/'+key}));
  let who={userId:'operator-auth',accountServiceReady:true,admin:{role:'SUB_ADMIN',is_active:true,permissions}},sequence=0,host,left=0,resets=0;
  const displays=[],legacy=[],publicEntries=[],publicLeaves=[],pushes=[],events=new Map();
  const context={URL,URLSearchParams,Date,currentActiveView:'view-admin-cms',lastMainView:'view-home',location:new URL('/admin','https://webnovels.uk'),console:{log(){}},
    history:{pushState(_state,_title,path){pushes.push(path);context.location=new URL(path,context.location);},replaceState(_state,_title,path){context.location=new URL(path,context.location);}},
    document:{readyState:'loading',body:new Element('body'),createElement:tag=>new Element(tag),getElementById:id=>nodes[id]||null,querySelector:()=>null,
      querySelectorAll:selector=>selector==='[data-reader-route]'?links:selector==='.main-view'?ids.filter(id=>id.startsWith('view-')).map(id=>nodes[id]):[],addEventListener(){}},
    WEBNOVELS_CONFIG:{adminOperationsEnabled:false,adminWorkflowEnabled:workflow},WebNovelsAuth:{getActor:()=>who,api(){assert.fail('shell must delegate display, not write old flags');}},
    switchAdminSubTab(){},loadAdminDashboard(){},scrollTo(){},getCurrentCreatorSession:()=>null,addEventListener:(key,fn)=>events.set(key,fn),closeAllModals(){},
    AdminDisplay:{leave(){left++;sequence++;host?.replaceChildren();host=null;},reset(){resets++;sequence++;host?.replaceChildren();host=null;},
      async render(root,options){host=root;const generation=++sequence,owner=who?.userId;displays.push({options});if(hold)await hold();if(generation===sequence&&who?.userId===owner&&options.isCurrent())root.textContent='PRIVATE DISPLAY DRAFT';}},
    AdminWorkflow:{active:()=>workflow,reset(){},async render(root,page){legacy.push(page);root.textContent=page;}},
    AdminConsole:{reset(){},async render(root,page){legacy.push(page);root.textContent=page;}},
    AdminRecovery:{active:()=>false,reset(){},leave(){}},AdminBetaOperations:{reset(){}},VirtualAccounts:{reset(){}},
    ReaderDiscovery:{active:()=>false,leave(){}},ReaderDisplay:{leave:view=>publicLeaves.push(view),enter:options=>publicEntries.push(plain(options))}};
  context.window=context;vm.createContext(context);
  for(const [name,source]of Object.entries({navigation:code.navigation,operations:code.operations,router:code.router}))vm.runInContext(source,context,{filename:name+'.js'});
  return {c:context,nodes,links,displays,legacy,publicEntries,publicLeaves,pushes,events,api:context.AdminOperations,setActor:value=>who=value,get left(){return left;},get resets(){return resets;}};
}

test('curation authority reaches the new CMS without enabling the old Workflow gate',async()=>{
  const app=fixture();await app.api.openRoute('/admin/content?tab=curation',false);
  assert.equal(app.displays.length,1);assert.deepEqual(app.legacy,[]);assert.match(app.nodes.adminOperationsContent.textContent,/PRIVATE DISPLAY DRAFT/);
  const current=app.nodes.adminSectionTabs.querySelectorAll('a').find(node=>node.getAttribute('aria-current')==='page');assert.match(current.textContent,/추천/);
  await app.api.openRoute('/admin/curation',false);assert.equal(app.displays.length,2);assert.equal(app.c.location.pathname+app.c.location.search,'/admin/content?tab=curation');
  const legacyEnabled=fixture({workflow:true});await legacyEnabled.api.openRoute('/admin/content?tab=curation',false);assert.equal(legacyEnabled.displays.length,1);assert.deepEqual(legacyEnabled.legacy,[]);
});

test('metadata-only administrators cannot read a display draft or obtain its menu',async()=>{
  const app=fixture({permissions:['CONTENT_METADATA_READ']});await app.api.openRoute('/admin/content?tab=curation',false);
  assert.equal(app.displays.length,0);assert.match(app.nodes.adminOperationsContent.textContent,/권한/);
  assert(app.nodes.adminSectionTabs.querySelectorAll('a').every(node=>!node.href.includes('tab=curation')));
});

test('admin navigation, departure, actor changes and reset suppress late private display drafts',async()=>{
  const gate=deferred(),app=fixture({hold:()=>gate.promise}),pending=app.api.openRoute('/admin/content?tab=curation',false);
  const old=app.displays[0];app.c.switchWebNovelsView('view-home',null,false);assert.equal(old.options.isCurrent(),false);gate.resolve();await pending;
  assert.doesNotMatch(app.nodes.adminOperationsContent.textContent,/PRIVATE DISPLAY DRAFT/);assert(app.left>=2);
  app.c.currentActiveView='view-admin-cms';await app.api.openRoute('/admin/content?tab=curation',false);const latest=app.displays.at(-1);
  app.setActor({userId:'different-auth',accountServiceReady:true,admin:{role:'SUB_ADMIN',is_active:true,permissions:['CURATION_WRITE']}});assert.equal(latest.options.isCurrent(),false);
  app.api.reset();assert.equal(app.resets,1);assert.equal(app.nodes.adminOperationsContent.textContent.trim(),'');assert.equal(app.nodes.adminOperationsShell.hidden,true);
});

test('recommendation routes preserve type and page, select native navigation and never request a preview',()=>{
  const app=fixture();app.setActor(null);app.c.navigateTo('/recommendations?type=WEBTOON&offset=24');
  assert.equal(app.c.currentActiveView,'view-recommendations');assert.deepEqual(app.publicEntries,[{type:'WEBTOON',offset:24}]);
  assert.equal(app.links.find(node=>node.dataset.readerRoute==='recommendations').getAttribute('aria-current'),'page');
  assert.equal(app.links.filter(node=>node.getAttribute('aria-current')==='page').length,1);assert.equal(app.publicLeaves.at(-1),'view-recommendations');
  assert.deepEqual(app.pushes,['/recommendations?type=WEBTOON&offset=24']);
  app.c.resolveRoute('/recommendations?type=NOVEL&offset=0');assert.deepEqual(app.publicEntries.at(-1),{type:'NOVEL',offset:0});assert.equal(app.pushes.length,1);
  const invalid=['type=AGE_19','offset=01','offset=-1','offset=1.5','offset=100001','at=2099-01-01','draft=true','preview=1','q=any','type=ALL&type=NOVEL','offset=0&offset=24'];
  const before=app.publicEntries.length;for(const query of invalid){app.c.resolveRoute('/recommendations?'+query);assert.equal(app.publicEntries.length,before,query);assert.match(app.nodes.readerRecommendationsContent.textContent,/주소/);}
});

test('recommendation anchors preserve normal browser modified and external-link behavior',()=>{
  const app=fixture(),link=app.links.find(node=>node.dataset.readerRoute==='recommendations');link.setAttribute('href','/recommendations?type=NOVEL&offset=48');
  const click=extra=>({currentTarget:link,button:0,preventDefault(){this.prevented=true;},...extra});
  const event=click();assert.equal(app.c.handleReaderRouteClick(event),false);assert.equal(event.prevented,true);assert.deepEqual(app.publicEntries,[{type:'NOVEL',offset:48}]);
  for(const extra of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{defaultPrevented:true}]){const native=click(extra);assert.equal(app.c.handleReaderRouteClick(native),true);assert.equal(native.prevented,undefined);}
  for(const href of ['https://other.test/recommendations','javascript:alert(1)','https://user:pass@webnovels.uk/recommendations','/admin/content']){link.setAttribute('href',href);const native=click();assert.equal(app.c.handleReaderRouteClick(native),true);assert.equal(native.prevented,undefined);}
  assert.equal(app.publicEntries.length,1);
});

test('display integration ships unique labelled workspaces, protected legal nodes and versioned dependency order',()=>{
  const errors=[],tree=parse(read('public/index.html'),{onParseError:error=>errors.push(error)}),nodes=[];
  const walk=node=>{if(node.tagName)nodes.push(node);for(const child of node.childNodes||[])walk(child);};walk(tree);
  const attr=(node,key)=>node?.attrs?.find(item=>item.name===key)?.value,byId=id=>nodes.find(node=>attr(node,'id')===id);
  const inside=(node,parent)=>{for(let at=node;at;at=at.parentNode)if(at===parent)return true;return false;};
  const text=node=>(node?.childNodes||[]).map(child=>child.value||text(child)).join('');
  assert.deepEqual(errors,[]);const ids=nodes.map(node=>attr(node,'id')).filter(Boolean);assert.equal(new Set(ids).size,ids.length);
  for(const id of ['readerDisplayHome','readerRecommendationsContent','readerDisplayFooterNote','adminOperationsContent'])assert(byId(id),id);
  assert(inside(byId('readerDisplayHome'),byId('view-home')));assert(inside(byId('readerRecommendationsContent'),byId('view-recommendations')));
  assert.equal(attr(byId('readerRecommendationsContent'),'tabindex'),'-1');assert(attr(byId('readerRecommendationsContent'),'aria-label'));
  for(const form of nodes.filter(node=>node.tagName==='form'))assert(!nodes.some(parent=>parent!==form&&parent.tagName==='form'&&inside(form,parent)),'nested form');
  const footer=nodes.find(node=>(attr(node,'class')||'').split(' ').includes('legal-footer'));assert(inside(byId('readerDisplayFooterNote'),footer));
  const footerLinks=nodes.filter(node=>node.tagName==='a'&&inside(node,footer)).map(node=>attr(node,'href'));
  for(const href of ['/company/','/policies/terms/','/policies/refund/','/policies/settlement/','tel:01021432120','mailto:bazier.stage@gmail.com'])assert(footerLinks.includes(href),href);
  for(const value of ['(주)얼토당토','성재원','555-81-02749','서울특별시 송파구 중대로 192, 201-18호'])assert(text(footer).includes(value));
  assert(nodes.some(node=>attr(node,'data-beta-support-open')!==undefined),'existing support entry remains');
  for(const id of ['readerPrimaryNav','mobileBottomNav'])assert(nodes.some(node=>node.tagName==='a'&&attr(node,'href')==='/recommendations'&&inside(node,byId(id))),id+' recommendations');
  const sources=nodes.filter(node=>node.tagName==='script').map(node=>attr(node,'src')),styles=nodes.filter(node=>node.tagName==='link').map(node=>attr(node,'href')),loader=read('public/js/core/role-modules.js');
  assert(sources.indexOf('/js/reader/reader-catalog.js?v=117')<sources.indexOf('/js/reader/reader-display.js?v=20261101op03'));
  assert(sources.indexOf('/js/reader/reader-display.js?v=20261101op03')<sources.indexOf('/js/reader/reader-discovery.js?v=20261101op03'));
  for(const path of ['/js/core/role-modules.js','/js/core/router.js','/js/reader/reader.js'])assert(sources.includes(path+'?v=20261101op03'));
  for(const path of ['/css/admin-display.css','/css/reader-display.css'])assert(styles.includes(path+'?v=20261101op03'));
  assert(loader.indexOf('/admin-display.js?v=20261101op03')<loader.indexOf('/admin-operations.js?v=20261101op03'));
  assert(loader.includes('/admin-console.js?v=20261101op03'));assert(loader.includes('/admin-members.js?v=20261101op02b'));
});
