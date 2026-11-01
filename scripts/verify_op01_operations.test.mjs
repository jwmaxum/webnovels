import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const files=Object.fromEntries(['admin-navigation','admin-operations'].map(name=>[name,readFileSync(new URL('../public/js/admin/'+name+'.js',import.meta.url),'utf8')]));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
class Node{
  constructor(tag='div'){
    this.tag=tag;this.tagName=tag.toUpperCase();this.children=[];this._text='';this.attributes={};this.dataset={};this.value='';this.hidden=false;this.disabled=false;this.events={};
    this.classList={add:(...names)=>this.classes(names,true),remove:(...names)=>this.classes(names,false),contains:name=>(this.className||'').split(/\s+/).includes(name),toggle:(name,force)=>{const yes=force??!this.classList.contains(name);this.classes([name],yes);return yes;}};
  }
  classes(names,add){const classes=new Set((this.className||'').split(/\s+/).filter(Boolean));for(const name of names)add?classes.add(name):classes.delete(name);this.className=[...classes].join(' ');}
  set textContent(value){this._text=String(value??'');this.children=[];}get textContent(){return this._text+this.children.map(node=>node.textContent).join(' ');}
  set innerHTML(_){assert.fail('Shell must use text nodes, never HTML strings');}
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}appendChild(node){this.append(node);return node;}
  replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}
  setAttribute(key,value){this.attributes[key]=String(value);if(key==='id')this.id=String(value);if(key==='class')this.className=String(value);if(key==='href')this.href=String(value);if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}
  getAttribute(key){return this.attributes[key]??null;}removeAttribute(key){delete this.attributes[key];}
  addEventListener(type,handler){(this.events[type]??=[]).push(handler);}removeEventListener(type,handler){this.events[type]=(this.events[type]||[]).filter(item=>item!==handler);}
  async fire(type,extra={}){const event={target:this,currentTarget:this,preventDefault(){},...extra};const result=this['on'+type]?.(event);for(const handler of this.events[type]||[])await handler(event);return result;}
  focus(options){this.focused=true;this.focusOptions=options;this.focusCount=(this.focusCount||0)+1;}contains(node){return node===this||this.children.some(child=>child.contains(node));}
  matches(selector){
    const found=selector.match(/^(?<tag>[a-z]+)?(?<klass>\.[\w-]+)?(?:\[(?<attr>[\w-]+)(?:=["']?(?<value>[^\]"']+)["']?)?\])?$/i);
    if(!found)return selector[0]==='#'&&this.id===selector.slice(1);
    const {tag,klass,attr,value}=found.groups;
    return (!tag||this.tag===tag)&&(!klass||this.classList.contains(klass.slice(1)))&&(!attr||this.getAttribute(attr)!==null)&&(value===undefined||this.getAttribute(attr)===value);
  }
  querySelectorAll(selector){const choices=selector.split(',').map(value=>value.trim());return this.children.flatMap(child=>[...(choices.some(choice=>child.matches(choice))?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
function setup({permissions,operations=true,workflow=true,onModule,handler}={}){
  const ids=['adminOperationsContent','adminOperationsShell','adminOperationsNav','view-admin-cms','adminConsoleIdentity','adminSectionTabs','adminBreadcrumbs','adminWorkspaceHeading','adminWorkspaceDescription','adminGlobalSearch','adminGlobalSearchInput','adminGlobalSearchResults'];
  const nodes=Object.fromEntries(ids.map(id=>{const node=new Node(id==='adminGlobalSearch'?'form':id==='adminGlobalSearchInput'?'input':'div');node.id=id;return [id,node];}));
  nodes.adminGlobalSearchInput.type='search';nodes.adminGlobalSearch.append(nodes.adminGlobalSearchInput);nodes.adminGlobalSearchResults.hidden=true;
  let actor={userId:'admin-a',accountServiceReady:true,admin:{role:permissions?'SUB_ADMIN':'SUPER_ADMIN',permissions:permissions||[],nickname:'운영자'}};
  const calls=[],moduleCalls=[],resetCalls=[],historyCalls=[],legacyCalls=[];
  const location={origin:'https://webnovels.uk',pathname:'/admin',search:'',hash:''};
  const update=(kind,state,title,path)=>{const url=new URL(path,location.origin);Object.assign(location,{pathname:url.pathname,search:url.search,hash:url.hash});historyCalls.push({kind,path:url.pathname+url.search,state});};
  const context={URL,URLSearchParams,Date,location,history:{pushState:(...args)=>update('push',...args),replaceState:(...args)=>update('replace',...args)},
    document:{createElement:tag=>new Node(tag),getElementById:id=>nodes[id]||Object.values(nodes).flatMap(node=>[node,...node.querySelectorAll('[id]')]).find(node=>node.id===id)||null},
    WEBNOVELS_CONFIG:{adminOperationsEnabled:operations,adminWorkflowEnabled:workflow},
    WebNovelsAuth:{getActor:()=>actor,api:async(url,options)=>{calls.push({url,options});return handler?handler(url,options):{works:0,readers:0,authors:0,pendingReviews:0,pendingReports:0,failedSchedules:0,cases:[],accounts:[],appeals:[],events:[]};}},
    switchAdminSubTab:(...args)=>legacyCalls.push(args),loadAdminDashboard:()=>legacyCalls.push(['dashboard'])};
  function module(name,hasPage=true){return {active:()=>true,reset:()=>resetCalls.push(name),render:async(root,pageOrOptions,options)=>{
    const call={name,page:hasPage?pageOrOptions:name,options:hasPage?options:pageOrOptions,root};moduleCalls.push(call);
    if(onModule)await onModule(call);
    if(!call.options?.isCurrent||call.options.isCurrent()){root.replaceChildren();root.textContent='MODULE '+name+' '+call.page;}
  }};}
  Object.assign(context,{AdminWorkflow:{...module('workflow'),active:()=>workflow},AdminConsole:module('console'),AdminRecovery:module('recovery',false),AdminBetaOperations:module('beta',false),VirtualAccounts:module('virtual',false)});
  context.window=context;vm.createContext(context);for(const [name,source]of Object.entries(files))vm.runInContext(source,context,{filename:name+'.js'});
  return {context,nodes,calls,moduleCalls,resetCalls,historyCalls,legacyCalls,api:context.AdminOperations,setActor:value=>{actor=value;},location};
}
const navLinks=app=>app.nodes.adminOperationsNav.querySelectorAll('a,button');
const last=app=>app.moduleCalls.at(-1);
const denied=app=>assert.match(app.nodes.adminOperationsContent.textContent,/권한|접근/);

test('primary navigation has exactly six accessible groups with a single current group',async()=>{
  const app=setup();await app.api.openRoute('/admin/content?tab=works',false);
  const links=navLinks(app);
  assert.equal(links.length,6);
  assert.deepEqual(links.map(node=>node.textContent),['운영 홈','콘텐츠·전시','회원 관리','결제·정산','통합처리함','설정']);
  assert.equal(links.filter(node=>node.getAttribute('aria-current')==='page').length,1);
  assert.equal(links.find(node=>node.getAttribute('aria-current')==='page').textContent,'콘텐츠·전시');
  assert.equal(last(app).page,'works');assert.equal(app.nodes.adminOperationsShell.hidden,false);
  assert.ok(app.nodes.adminConsoleIdentity.textContent.includes('운영자'));
});

test('member kind and sub-tabs are permission filtered while explicit denied routes never fall back',async()=>{
  const app=setup({permissions:['CREATOR_MGMT']});
  await app.api.openRoute('/admin',false);
  assert.equal(last(app).page,'accounts');assert.equal(last(app).options.accountKind,'author');
  assert.deepEqual(navLinks(app).map(node=>node.textContent),['회원 관리']);
  assert.deepEqual(app.nodes.adminSectionTabs.querySelectorAll('a').map(node=>node.textContent),['작가']);
  const count=app.moduleCalls.length;
  await app.api.openRoute('/admin/members?kind=reader',false);
  assert.equal(app.moduleCalls.length,count);assert.equal(app.calls.length,0);denied(app);
  await app.api.openRoute('/admin/users',false);assert.equal(app.moduleCalls.length,count);denied(app);
  await app.api.openRoute('/admin/members',false);assert.equal(last(app).options.accountKind,'author');
  const auditor=setup({permissions:['AUDIT_READ']});await auditor.api.openRoute('/admin/settings',false);
  assert.equal(last(auditor).page,'audit');
  const before=auditor.moduleCalls.length;await auditor.api.openRoute('/admin/settings?tab=roles',false);assert.equal(auditor.moduleCalls.length,before);denied(auditor);
});

test('comment-only reviewers get a working inbox link while explicit other sources stay denied',async()=>{
  const app=setup({permissions:['COMMENT_REPORT']});await app.api.openRoute('/admin/inbox',false);
  assert.equal(last(app).page,'cases');assert.equal(last(app).options.source,'COMMENT_REPORT');
  const primary=navLinks(app).find(node=>node.textContent==='통합처리함');assert.ok(primary);
  assert.equal(new URL(primary.href,app.location.origin).searchParams.get('source'),'COMMENT_REPORT');
  const cases=app.nodes.adminSectionTabs.querySelectorAll('a').find(node=>node.href.includes('tab=cases'));
  assert.equal(new URL(cases.href,app.location.origin).searchParams.get('source'),'COMMENT_REPORT');
  const count=app.moduleCalls.length;await app.api.openRoute('/admin/inbox?tab=cases&source=CONTENT_REVIEW',false);
  assert.equal(app.moduleCalls.length,count);denied(app);
});

test('navigation delivers supported safe route filters to the matching leaf module only',async()=>{
  const app=setup();
  await app.api.openRoute('/admin/inbox?tab=cases&source=COMMENT_REPORT&offset=20&workId=10',false);
  assert.equal(last(app).page,'cases');assert.equal(last(app).options.source,'COMMENT_REPORT');
  assert.equal(last(app).options.workId,undefined,'an unsupported API filter is not forwarded');
  await app.api.openRoute('/admin/members?kind=author&offset=50',false);
  assert.equal(last(app).page,'accounts');assert.equal(last(app).options.accountKind,'author');assert.equal(String(last(app).options.offset),'50');
  await app.api.openRoute('/admin/settings?tab=audit&target=WORK%3A10&offset=50',false);
  assert.equal(last(app).page,'audit');assert.equal(last(app).options.target,'WORK:10');assert.equal(String(last(app).options.offset),'50');
  await app.api.openRoute('/admin/content?tab=works',false);
  assert.equal(last(app).page,'works');assert.equal(last(app).options.target,undefined);assert.equal(last(app).options.accountKind,undefined);
});

test('leaf workflow links navigate through canonical routes with supported filters',async()=>{
  const app=setup();await app.api.openRoute('/admin/content?tab=works',false);
  assert.equal(typeof last(app).options.onNavigate,'function');
  await last(app).options.onNavigate('audit',{target:'WORK:10',offset:50});
  assert.equal(last(app).page,'audit');assert.equal(last(app).options.target,'WORK:10');assert.equal(last(app).options.offset,50);
  assert.equal(app.historyCalls.at(-1).path,'/admin/settings?tab=audit&target=WORK%3A10&offset=50');
  await app.api.refresh();assert.equal(last(app).options.target,'WORK:10');assert.equal(last(app).options.offset,50);
});

test('legacy routes replace canonical URLs and ordinary changes push one canonical history entry',async()=>{
  const app=setup();Object.assign(app.location,{pathname:'/admin/comments',search:'?caseId=10'});
  await app.api.openRoute('/admin/comments?caseId=10',false);
  assert.equal(last(app).page,'cases');assert.equal(last(app).options.source,'COMMENT_REPORT');
  assert.ok(app.historyCalls.some(call=>call.kind==='replace'&&call.path==='/admin/inbox?tab=cases&source=COMMENT_REPORT&caseId=10'));
  app.historyCalls.length=0;
  await app.api.navigate('authors');assert.equal(last(app).page,'accounts');assert.equal(last(app).options.accountKind,'author');
  assert.equal(app.historyCalls.filter(call=>call.kind==='push').length,1);
  assert.equal(app.historyCalls.at(-1).path,'/admin/members?kind=author');
  await app.api.refresh();assert.equal(app.historyCalls.filter(call=>call.kind==='push').length,1);
});

test('dashboard loader from a non-admin page opens the default accessible admin screen',async()=>{
  const app=setup();Object.assign(app.location,{pathname:'/library',search:'?q=private'});
  await app.context.loadAdminDashboard();
  assert.match(app.nodes.adminOperationsContent.textContent,/운영 현황/);
  assert.doesNotMatch(app.nodes.adminOperationsContent.textContent,/초기 운영 범위/);
  assert.equal(app.historyCalls.at(-1).path,'/admin');assert.equal(app.historyCalls.at(-1).kind,'replace');
  assert.equal(app.calls.length,1);assert.equal(new URL(app.calls[0].url,app.location.origin).searchParams.get('action'),'dashboard');
  assert.equal(app.legacyCalls.length,0);
  const author=setup({permissions:['CREATOR_MGMT']});author.location.pathname='/library';
  await author.context.loadAdminDashboard();
  assert.equal(last(author).page,'accounts');assert.equal(last(author).options.accountKind,'author');
  assert.equal(author.historyCalls.at(-1).path,'/admin/members?kind=author');
});

test('group-only inbox source and offset survive canonical default selection and dashboard reload',async()=>{
  const app=setup();await app.api.openRoute('/admin/inbox?source=REPORT&offset=25',false);
  assert.equal(last(app).page,'cases');assert.equal(last(app).options.source,'REPORT');assert.equal(last(app).options.offset,25);
  const canonical='/admin/inbox?tab=cases&source=REPORT&offset=25';
  assert.equal(app.historyCalls.at(-1).path,canonical);
  app.historyCalls.length=0;await app.context.loadAdminDashboard();
  assert.equal(last(app).page,'cases');assert.equal(last(app).options.source,'REPORT');assert.equal(last(app).options.offset,25);
  assert.equal(app.location.pathname+app.location.search,canonical);assert.equal(app.historyCalls.length,0);
});

test('user navigation focuses the stable workspace while route restoration leaves focus untouched',async()=>{
  const app=setup();const workspace=app.nodes.adminOperationsContent;
  await app.api.openRoute('/admin/content?tab=works',false);assert.equal(workspace.focusCount,undefined);
  await app.api.openRoute('/admin/settings?tab=audit',true);
  assert.equal(app.nodes.adminOperationsContent,workspace);assert.equal(workspace.focusCount,1);assert.equal(workspace.focusOptions.preventScroll,true);
  await app.api.openRoute('/admin/content?tab=works',false);assert.equal(workspace.focusCount,1);
});

test('invalid routes do not call modules, backend, or unsafe navigation',async()=>{
  const app=setup();
  for(const path of ['/admin/unknown','/admin/content?tab=missing','https://evil.example/admin/works','/admin/works?workId=-1','/admin/members?kind=admin']){
    await app.api.openRoute(path,false);
    assert.equal(app.moduleCalls.length,0,path);assert.equal(app.calls.length,0,path);assert.equal(app.historyCalls.length,0,path);
    assert.match(app.nodes.adminOperationsContent.textContent,/경로|화면|메뉴|주소/);
  }
});

test('unimplemented finance and policy tabs show preparation without calling fake backend actions',async()=>{
  const app=setup();
  for(const path of ['/admin/finance?tab=payments','/admin/finance?tab=refunds','/admin/finance?tab=reconciliation','/admin/content?tab=pages']){
    await app.api.openRoute(path,false);
    assert.equal(app.moduleCalls.length,0,path);assert.equal(app.calls.length,0,path);
    assert.match(app.nodes.adminOperationsContent.textContent,/준비|예정|개발/);
  }
  await app.api.openRoute('/admin/finance?tab=payouts',false);assert.equal(last(app).page,'settlements');
});

test('menu finder works locally with text-only output and never searches account records',async()=>{
  const app=setup();await app.api.openRoute('/admin/content?tab=works',false);
  const finder=app.nodes.adminGlobalSearchInput,form=app.nodes.adminGlobalSearch;
  assert.equal(typeof form.onsubmit,'function','the local menu finder is wired');
  const count=app.moduleCalls.length;
  finder.value='작가';await form.fire('submit');
  assert.match(app.nodes.adminGlobalSearchResults.textContent,/작가/);
  assert.equal(app.calls.length,0);assert.equal(app.moduleCalls.length,count);
  finder.value='<img onerror=1>';await form.fire('submit');
  assert.match(app.nodes.adminGlobalSearchResults.textContent,/일치하는 메뉴가 없습니다/);
  assert.equal(app.calls.length,0);assert.equal(app.moduleCalls.length,count);
  assert.ok(!app.historyCalls.some(call=>call.path.includes('onerror')));
  const author=setup({permissions:['CREATOR_MGMT']});await author.api.openRoute('/admin/members',false);
  author.nodes.adminGlobalSearchInput.value='독자';await author.nodes.adminGlobalSearch.fire('submit');
  assert.equal(author.nodes.adminGlobalSearchResults.querySelectorAll('a').length,0);
});

test('reset clears shell, menus, identity and invalidates every delegated read',async()=>{
  const waiting=deferred();const app=setup({onModule:()=>waiting.promise});
  const pending=app.api.openRoute('/admin/content?tab=works',false);
  assert.equal(last(app).options.isCurrent(),true);
  app.api.reset();assert.equal(last(app).options.isCurrent(),false);
  waiting.resolve();await pending;
  assert.equal(app.nodes.adminOperationsContent.textContent,'');assert.equal(app.nodes.adminOperationsNav.children.length,0);
  assert.equal(app.nodes.adminSectionTabs.children.length,0);assert.equal(app.nodes.adminBreadcrumbs.children.length,0);
  assert.equal(app.nodes.adminGlobalSearchInput.value,'');assert.equal(app.nodes.adminGlobalSearchResults.children.length,0);
  assert.equal(app.nodes.adminConsoleIdentity.textContent,'');assert.equal(app.nodes.adminOperationsShell.hidden,true);
  for(const name of ['recovery','beta','virtual','console','workflow'])assert.ok(app.resetCalls.includes(name),name);
});

test('navigation and actor changes suppress stale module responses',async()=>{
  const waiting=deferred();const app=setup({onModule:call=>call.page==='works'?waiting.promise:undefined});
  const first=app.api.openRoute('/admin/content?tab=works',false);const previous=last(app);
  await app.api.openRoute('/admin/settings?tab=audit',false);assert.equal(previous.options.isCurrent(),false);
  waiting.resolve();await first;assert.match(app.nodes.adminOperationsContent.textContent,/audit/);assert.doesNotMatch(app.nodes.adminOperationsContent.textContent,/works/);
  const delayed=deferred(),other=setup({onModule:()=>delayed.promise});const loading=other.api.openRoute('/admin/content?tab=works',false);
  const call=last(other);other.setActor({userId:'admin-b',admin:{role:'SUPER_ADMIN'}});assert.equal(call.options.isCurrent(),false);
  other.api.reset();delayed.resolve();await loading;assert.equal(other.nodes.adminOperationsContent.textContent,'');
});

test('late internal dashboard reads cannot overwrite a newer leaf or repopulate a reset shell',async()=>{
  const waiting=deferred(),app=setup({handler:()=>waiting.promise});
  const first=app.api.openRoute('/admin',false);assert.equal(app.calls.length,1);
  await app.api.openRoute('/admin/content?tab=works',false);waiting.resolve({works:777});await first;
  assert.match(app.nodes.adminOperationsContent.textContent,/workflow works/);assert.doesNotMatch(app.nodes.adminOperationsContent.textContent,/777/);
  const delayed=deferred(),other=setup({handler:()=>delayed.promise});const loading=other.api.openRoute('/admin',false);
  other.api.reset();delayed.resolve({works:999});await loading;
  assert.equal(other.nodes.adminOperationsContent.textContent,'');assert.equal(other.nodes.adminOperationsShell.hidden,true);
});

test('inactive administrator metadata does not grant access to any screen',async()=>{
  const app=setup();app.setActor({userId:'admin-a',accountServiceReady:true,admin:{role:'SUPER_ADMIN',is_active:false}});
  await app.api.openRoute('/admin/content?tab=works',false);
  assert.equal(app.moduleCalls.length,0);assert.equal(app.calls.length,0);assert.equal(navLinks(app).length,0);denied(app);
});
