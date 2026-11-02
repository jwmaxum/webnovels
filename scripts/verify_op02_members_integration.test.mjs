import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse} from 'parse5';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sources=Object.fromEntries(['admin-navigation','admin-operations'].map(name=>[name,read('public/js/admin/'+name+'.js')]));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
class Node{
  constructor(tag='div'){this.tag=tag;this.children=[];this.attributes={};this.dataset={};this.value='';this.hidden=false;this._text='';this.names=new Set();
    this.classList={add:(...names)=>names.forEach(name=>this.names.add(name)),remove:(...names)=>names.forEach(name=>this.names.delete(name)),contains:name=>this.names.has(name)};}
  set textContent(value){this._text=String(value??'');this.children=[];}get textContent(){return this._text+' '+this.children.map(node=>node.textContent).join(' ');}
  set innerHTML(_){assert.fail('member shell must use native text nodes');}
  append(...children){this.children.push(...children);}replaceChildren(...children){this._text='';this.children=[...children];}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}removeAttribute(key){delete this.attributes[key];}
  querySelectorAll(selector){const names=selector.split(',').map(item=>item.trim());return this.children.flatMap(child=>[...(names.includes(child.tag)?[child]:[]),...child.querySelectorAll(selector)]);}
  focus(){this.focused=true;}
}
function setup({permissions,hold}={}){
  const ids=['adminOperationsContent','adminOperationsShell','adminOperationsNav','adminConsoleIdentity','adminSectionTabs','adminBreadcrumbs','adminWorkspaceHeading','adminWorkspaceDescription','adminGlobalSearch','adminGlobalSearchInput','adminGlobalSearchResults','view-admin-cms','view-home'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Node()]));
  let actor={userId:'admin-a',accountServiceReady:true,admin:{role:permissions?'SUB_ADMIN':'SUPER_ADMIN',permissions:permissions||[],is_active:true,nickname:'운영자'}};
  const calls=[],otherCalls=[],history=[],filters=new Map();let left=0,resets=0,sequence=0,host;
  const location=new URL('/admin','https://webnovels.uk');
  const context={URL,URLSearchParams,Date,location,console:{log(){}},currentActiveView:'view-admin-cms',lastMainView:'view-home',
    document:{body:new Node('body'),createElement:tag=>new Node(tag),getElementById:id=>nodes[id]||null,querySelectorAll:()=>[],querySelector:()=>null},
    history:{pushState(_state,_title,path){history.push({kind:'push',path});location.href=new URL(path,location).href;},replaceState(_state,_title,path){history.push({kind:'replace',path});location.href=new URL(path,location).href;}},
    WEBNOVELS_CONFIG:{adminOperationsEnabled:true,adminWorkflowEnabled:true},WebNovelsAuth:{getActor:()=>actor,api(){assert.fail('root must delegate members to AdminMembers, not an old accounts API');}},
    addEventListener(){},scrollTo(){},switchAdminSubTab(){},loadAdminDashboard(){},
    AdminMembers:{active:()=>true,leave(){left++;sequence++;host?.replaceChildren();host=null;},reset(){resets++;sequence++;host?.replaceChildren();host=null;filters.clear();},
      async render(root,options){host=root;const owner=actor.userId,token=++sequence;const call={options};calls.push(call);
        if(!filters.has(options.kind))filters.set(options.kind,{q:'',offset:0});call.filters=filters.get(options.kind);
        if(hold)await hold(call);if(token===sequence&&actor.userId===owner&&options.isCurrent()){root.replaceChildren();root.textContent='MEMBERS '+options.kind+' '+(options.accountId||'list');}}},
    AdminWorkflow:{active:()=>true,reset(){},async render(root,page){otherCalls.push(page);root.textContent=page;}},
    AdminConsole:{reset(){},async render(root,page){otherCalls.push(page);root.textContent=page;}},
    AdminRecovery:{active:()=>true,reset(){},leave(){}},AdminBetaOperations:{reset(){}},VirtualAccounts:{reset(){}}};
  context.window=context;vm.createContext(context);
  for(const [name,source]of Object.entries(sources))vm.runInContext(source,context,{filename:name+'.js'});
  return {context,nodes,calls,otherCalls,history,filters,location,api:context.AdminOperations,setActor:value=>actor=value,get left(){return left;},get resets(){return resets;}};
}
const last=app=>app.calls.at(-1);

test('OP-02 assets retain compatibility ordering and native separate member destinations',()=>{
  const html=read('public/index.html'),loader=read('public/js/core/role-modules.js'),all=[];
  const walk=node=>{all.push(node);for(const child of node.childNodes||[])walk(child);};walk(parse(html));
  const attr=(node,key)=>node.attrs?.find(item=>item.name===key)?.value;
  const styles=all.filter(node=>node.tagName==='link').map(node=>attr(node,'href'));
  assert(styles.indexOf('/css/admin-members.css?v=20261101op02')>styles.indexOf('/css/admin-shell.css?v=20261101op01'));
  for(const name of ['admin-navigation','admin-members','admin-operations'])assert(loader.includes('/js/admin/'+name+'.js?v='+(name==='admin-navigation'?'20261101op02':name==='admin-operations'?'20261102op07':'20261101op02b')));
  assert(loader.indexOf('/admin-navigation.js?')<loader.indexOf('/admin-members.js?'));
  assert(loader.indexOf('/admin-members.js?')<loader.indexOf('/admin-operations.js?'));
  for(const name of ['role-modules','router'])assert(html.includes('/js/core/'+name+'.js?v='+(name==='role-modules'?'20261102op08':'20261102op07')));
  const navigation={window:{location:{origin:'https://webnovels.uk'}},URL,URLSearchParams};vm.runInNewContext(sources['admin-navigation'],navigation);
  const memberGroup=navigation.window.AdminNavigation.groups(()=>true).find(group=>group.key==='members');
  assert.deepEqual(Array.from(memberGroup.tabs,item=>[item.kind,item.href]),[['reader','/admin/members?kind=reader'],['author','/admin/members?kind=author']]);
});

test('author and reader tabs delegate one distinct kind without using old account renderers',async()=>{
  const app=setup();await app.api.openRoute('/admin/members?kind=author',false);
  assert.equal(last(app).options.kind,'author');assert.equal(last(app).options.accountId,undefined);assert.deepEqual(app.otherCalls,[]);
  const tabs=app.nodes.adminSectionTabs.querySelectorAll('a');
  assert.deepEqual(tabs.map(node=>node.textContent.trim()),['독자','작가']);
  assert.equal(tabs.find(node=>node.getAttribute('aria-current')==='page').textContent.trim(),'작가');
  await tabs[0].onclick({preventDefault(){}});
  assert.equal(last(app).options.kind,'reader');assert.deepEqual(app.otherCalls,[]);
  assert.equal(app.location.pathname+app.location.search,'/admin/members?kind=reader');
});

test('same-kind profile detail and return callbacks use canonical safe IDs and no record query',async()=>{
  const app=setup();await app.api.openRoute('/admin/members?kind=author&q=private%40example.com',false);
  await last(app).options.onNavigate({kind:'author',accountId:'17'});
  assert.equal(last(app).options.kind,'author');assert.equal(last(app).options.accountId,'17');
  assert.equal(app.history.at(-1).path,'/admin/members?kind=author&accountId=17');
  const count=app.calls.length;await last(app).options.onNavigate({kind:'reader',accountId:'17'});
  assert.equal(app.calls.length,count,'a member detail callback cannot switch its owning kind');
  await last(app).options.onNavigate({kind:'author'});
  assert.equal(last(app).options.accountId,undefined);assert.equal(app.history.at(-1).path,'/admin/members?kind=author');
  const readerId='7c45f9df-44f3-4c10-9dfe-7887464bf927';
  await app.api.openRoute('/admin/members?kind=reader&accountId='+readerId,false);
  assert.equal(last(app).options.kind,'reader');assert.equal(last(app).options.accountId,readerId);
  assert(app.history.every(item=>!item.path.includes('private')&&!item.path.includes('q=')));
});

test('explicit reader and default-kind detail links stay denied for author-only administrators',async()=>{
  const app=setup({permissions:['CREATOR_MGMT']});
  await app.api.openRoute('/admin/members',false);assert.equal(last(app).options.kind,'author');
  assert.deepEqual(app.nodes.adminSectionTabs.querySelectorAll('a').map(node=>node.textContent.trim()),['작가']);
  const count=app.calls.length;
  for(const path of ['/admin/members?kind=reader&accountId=17','/admin/users?accountId=17','/admin/members?accountId=17']){
    await app.api.openRoute(path,false);assert.equal(app.calls.length,count,path);assert.match(app.nodes.adminOperationsContent.textContent,/권한|접근/);
  }
  await app.api.openRoute('/admin/authors?accountId=17',false);assert.equal(last(app).options.accountId,'17');assert.equal(last(app).options.kind,'author');
});

test('ordinary tab and detail navigation leaves the module without erasing independent search memory',async()=>{
  const app=setup();await app.api.openRoute('/admin/members?kind=author',false);
  last(app).filters.q='author-private-search';last(app).filters.offset=50;
  await app.api.openRoute('/admin/members?kind=reader',false);last(app).filters.q='reader-private-search';
  await app.api.openRoute('/admin/content?tab=works',false);
  await app.api.openRoute('/admin/members?kind=author&accountId=17',false);
  assert.equal(last(app).filters.q,'author-private-search');assert.equal(last(app).filters.offset,50);
  await last(app).options.onNavigate({kind:'author'});assert.equal(last(app).filters.offset,50);
  await app.api.openRoute('/admin/members?kind=reader',false);assert.equal(last(app).filters.q,'reader-private-search');
  assert.equal(app.resets,0);assert(app.left>=5);assert(app.history.every(item=>!item.path.includes('private-search')));
});

test('leaving a member route, reset and actor changes invalidate private reads and detached callbacks',async()=>{
  const gate=deferred(),app=setup({hold:call=>call.options.kind==='author'?gate.promise:undefined});
  const loading=app.api.openRoute('/admin/members?kind=author&accountId=17',false),old=last(app);
  await app.api.openRoute('/admin/members?kind=reader',false);assert.equal(old.options.isCurrent(),false);
  const before=app.calls.length;await old.options.onNavigate({kind:'author',accountId:'18'});assert.equal(app.calls.length,before);
  gate.resolve();await loading;assert.match(app.nodes.adminOperationsContent.textContent,/MEMBERS reader/);
  const previous=last(app);app.setActor({userId:'admin-b',accountServiceReady:true,admin:{role:'SUPER_ADMIN',is_active:true}});
  assert.equal(previous.options.isCurrent(),false);await previous.options.onNavigate({kind:'reader',accountId:'17'});assert.equal(app.calls.length,before);
  app.api.reset();assert.equal(app.resets,1);assert.equal(app.filters.size,0);assert.equal(app.nodes.adminOperationsContent.textContent.trim(),'');assert.equal(app.nodes.adminOperationsShell.hidden,true);
});

test('router departure clears the member workspace without discarding the tab search state',async()=>{
  const app=setup();await app.api.openRoute('/admin/members?kind=author',false);last(app).filters.q='kept-on-return';
  vm.runInContext(read('public/js/core/router.js'),app.context,{filename:'router.js'});
  const before=app.left;app.context.switchWebNovelsView('view-home',null,false);
  assert.equal(app.left,before+1);assert.equal(app.resets,0);assert.equal(app.filters.get('author').q,'kept-on-return');
  assert.equal(app.nodes.adminOperationsContent.textContent.trim(),'');assert.equal(app.context.currentActiveView,'view-home');
  const previous=last(app),beforeCallbacks=app.otherCalls.length;await previous.options.onUnavailable();
  assert.equal(previous.options.isCurrent(),false);assert.equal(app.otherCalls.length,beforeCallbacks,'detached fallback cannot restore a hidden workspace');
});

test('directory readiness fallback preserves same-kind existing inventory and never executes after navigation',async()=>{
  const app=setup();await app.api.openRoute('/admin/members?kind=author',false);
  const author=last(app);await author.options.onUnavailable();assert.deepEqual(app.otherCalls,['accounts']);
  assert.match(app.nodes.adminOperationsContent.textContent,/기존 회원 조회/);assert.equal(app.resets,0);
  await app.api.openRoute('/admin/members?kind=reader',false);
  const count=app.otherCalls.length;await author.options.onUnavailable();assert.equal(app.otherCalls.length,count);
  app.context.AdminWorkflow.active=()=>false;await last(app).options.onUnavailable();assert.equal(app.otherCalls.length,count+1);
  assert.equal(last(app).options.kind,'reader');assert.equal(app.location.search,'?kind=reader');
});

test('member detail retains access to existing support tools with a return to independent search state',async()=>{
  const app=setup();await app.api.openRoute('/admin/members?kind=author&accountId=17',false);
  const author=last(app);author.filters.q='kept-filter';await author.options.onLegacyManage();
  assert.deepEqual(app.otherCalls,['accounts']);assert.equal(app.resets,0);assert.doesNotMatch(app.nodes.adminOperationsContent.textContent,/연결 준비/);
  const back=app.nodes.adminOperationsContent.querySelectorAll('a').find(node=>node.textContent.trim()==='회원 검색으로 돌아가기');assert(back);
  await back.onclick({preventDefault(){}});assert.equal(last(app).options.kind,'author');assert.equal(last(app).options.accountId,undefined);assert.equal(last(app).filters.q,'kept-filter');
  await app.api.openRoute('/admin/members?kind=reader',false);const count=app.otherCalls.length;
  await author.options.onLegacyManage();assert.equal(app.otherCalls.length,count,'old controls cannot open a different kind workspace');
});
