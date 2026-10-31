import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {parse} from 'parse5';
import {transform} from 'esbuild';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const [html,app,adminSource,css,loader,authUi]=await Promise.all(['public/index.html','public/app.js','public/js/admin/admin-operations.js','public/css/operations-account.css','public/js/core/role-modules.js','public/js/core/auth-ui.js'].map(read));
const attr=(node,key)=>node?.attrs?.find(item=>item.name===key)?.value;
const text=node=>(node?.childNodes||[]).map(child=>child.value||text(child)).join('');
const hasClass=(node,name)=>(attr(node,'class')||'').split(/\s+/).includes(name);
function documentTree(source){const errors=[],tree=parse(source,{onParseError:error=>errors.push(error)}),nodes=[];const walk=node=>{if(node.tagName)nodes.push(node);for(const child of node.childNodes||[])walk(child);};walk(tree);return {errors,nodes,byId:id=>nodes.find(node=>attr(node,'id')===id)};}
const doc=documentTree(html);
const inside=(node,parent)=>{for(let at=node;at;at=at.parentNode)if(at===parent)return true;return false;};

function authFixture(){
 const tabs=doc.nodes.filter(node=>attr(node,'data-auth-tab')).map(node=>{
  const classes=new Set((attr(node,'class')||'').split(/\s+/)),listeners=new Map(),attributes=Object.fromEntries(node.attrs.map(item=>[item.name,item.value]));
  return {dataset:{authTab:attr(node,'data-auth-tab')},hidden:false,disabled:false,tabIndex:Number(attr(node,'tabindex')||0),attributes,listeners,
   classList:{contains:name=>classes.has(name),toggle:(name,on)=>on?classes.add(name):classes.delete(name)},setAttribute(key,value){attributes[key]=String(value);},focus(){focused=this;},addEventListener(name,callback){listeners.set(name,callback);}};
 });
 const panels=doc.nodes.filter(node=>hasClass(node,'auth-form')).map(node=>{const classes=new Set((attr(node,'class')||'').split(/\s+/));return {id:attr(node,'id'),values:Object.fromEntries(doc.nodes.filter(input=>input.tagName==='input'&&inside(input,node)).map(input=>[attr(input,'id'),'preserved '+attr(input,'id')])),classList:{contains:name=>classes.has(name),toggle:(name,on)=>on?classes.add(name):classes.delete(name)}};});
 let focused=null;const begin=app.indexOf('// Auth tabs'),end=app.indexOf("document.getElementById('authForm-login')?.addEventListener('submit'",begin);
 assert(begin>=0&&end>begin,'Auth listener extraction boundary');
 const context={document:{querySelectorAll:selector=>selector==='[data-auth-tab]'?tabs:selector==='.auth-form'?panels:[],getElementById:id=>panels.find(panel=>panel.id===id)},handleMemberLogin:()=>assert.fail('keyboard tests must not authenticate'),handleMemberSignup:()=>assert.fail('keyboard tests must not register')};
 vm.createContext(context);vm.runInContext(app.slice(begin,end),context,{filename:'app.js Auth tabs'});
 return {tabs,panels,focused:()=>focused,select:tab=>tab.listeners.get('click')(),key:(tab,key)=>{let prevented=false;tab.listeners.get('keydown')({key,preventDefault(){prevented=true;}});return prevented;}};
}
function assertSelected(fixture,index){
 fixture.tabs.forEach((tab,i)=>{assert.equal(tab.attributes['aria-selected'],String(i===index));assert.equal(tab.tabIndex,i===index?0:-1);assert.equal(tab.classList.contains('active'),i===index);});
 fixture.panels.forEach(panel=>assert.equal(panel.classList.contains('active'),panel.id==='authForm-'+fixture.tabs[index].dataset.authTab));
}

test('actual auth tab listeners wrap arrows and synchronize selected tab, active panel and focus without clearing forms',()=>{
 const f=authFixture(),before=JSON.stringify(f.panels.map(panel=>panel.values));assert.equal(f.tabs.length,3);
 assert.equal(f.key(f.tabs[0],'ArrowLeft'),true);assertSelected(f,2);assert.equal(f.focused(),f.tabs[2]);
 f.key(f.tabs[2],'ArrowRight');assertSelected(f,0);f.key(f.tabs[0],'ArrowRight');assertSelected(f,1);
 f.key(f.tabs[1],'End');assertSelected(f,2);f.key(f.tabs[2],'Home');assertSelected(f,0);
 f.select(f.tabs[1]);assertSelected(f,1);assert.equal(f.key(f.tabs[1],'Enter'),false);assertSelected(f,1);
 assert.equal(JSON.stringify(f.panels.map(panel=>panel.values)),before);
});

test('auth keyboard excludes hidden and disabled tabs and cannot select them through stale events',()=>{
 const f=authFixture();f.tabs[1].hidden=true;f.key(f.tabs[0],'ArrowRight');assertSelected(f,2);
 f.select(f.tabs[1]);assertSelected(f,2);assert.equal(f.key(f.tabs[1],'ArrowRight'),false);
 f.tabs[2].disabled=true;f.key(f.tabs[0],'End');assertSelected(f,0);f.key(f.tabs[0],'ArrowLeft');assertSelected(f,0);
 f.select(f.tabs[2]);assertSelected(f,0);f.tabs[1].hidden=false;f.key(f.tabs[0],'ArrowRight');assertSelected(f,1);
});

class MenuNode {
 constructor(tag='div'){this.tag=tag;this.children=[];this.textContent='';this.attributes={};this.hidden=false;this.className='';this.classList={add(){}};}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(key,value){this.attributes[key]=String(value);}
 querySelectorAll(tag){return this.children.flatMap(child=>[...(child.tag===tag?[child]:[]),...child.querySelectorAll(tag)]);}
}
function adminFixture(who={userId:'admin-a',accountServiceReady:true,admin:{role:'SUPER_ADMIN',nickname:'운영자'}}){
 const nodes=Object.fromEntries(['adminOperationsContent','adminOperationsShell','adminOperationsNav','view-admin-cms','adminConsoleIdentity'].map(id=>[id,new MenuNode()])),dispatches=[],paths=[];let actor=who;
 const render=(module,root,page,options)=>{dispatches.push({module,page,options});root.replaceChildren();};
 const context={URLSearchParams,document:{getElementById:id=>nodes[id],createElement:tag=>new MenuNode(tag)},WEBNOVELS_CONFIG:{adminOperationsEnabled:false},WebNovelsAuth:{getActor:()=>actor,api:()=>assert.fail('layout navigation must not write or make API requests')},location:{pathname:'/admin'},history:{pushState:(_state,_title,path)=>paths.push(path)},
  AdminConsole:{reset(){},render:(root,page,options)=>render('console',root,page,options)},AdminWorkflow:{active:()=>true,reset(){},render:(root,page,options)=>render('workflow',root,page,options)},AdminRecovery:{active:()=>true,reset(){},render:(root,options)=>render('recovery',root,'recovery',options)},AdminBetaOperations:{reset(){},render:(root,options)=>render('support',root,'beta-operations',options)},VirtualAccounts:{reset(){},render:root=>render('virtual',root,'virtual-accounts')}};
 context.window=context;vm.createContext(context);vm.runInContext(adminSource,context,{filename:'admin-operations.js'});
 return {context,nodes,dispatches,paths,setActor:value=>actor=value,buttons:()=>nodes.adminOperationsNav.querySelectorAll('button'),groups:()=>nodes.adminOperationsNav.children.filter(node=>node.className==='cms-nav-group').map(node=>node.textContent)};
}

test('admin navigation groups actual allowed duties and preserves legacy routes and current-page state',async()=>{
 const f=adminFixture();await f.context.AdminOperations.navigate('dashboard',false);
 assert.deepEqual(f.groups(),['운영 현황·문의','작품·발행 관리','신고·복구','회원·작가','서비스 설정·기록']);assert.equal(f.buttons().length,14);assert.equal(f.buttons().filter(button=>button.attributes['aria-current']==='page').length,1);
 await f.buttons().find(button=>button.textContent==='문의·베타 운영').onclick();assert.equal(f.paths.at(-1),'/admin/beta-operations');assert.equal(f.dispatches.at(-1).module,'support');
 for(const [route,module,page,kind,source] of [['subadmins','console','roles'],['security','workflow','audit'],['episodes','console','episodes'],['authors','workflow','accounts','author'],['creators','workflow','accounts','author'],['users','workflow','accounts','reader'],['review','workflow','cases',undefined,'CONTENT_REVIEW'],['comments','workflow','cases',undefined,'COMMENT_REPORT']]){
  await f.context.AdminOperations.navigate(route,false);const last=f.dispatches.at(-1);assert.equal(last.module,module,route);assert.equal(last.page,page,route);if(kind)assert.equal(last.options.accountKind,kind);if(source)assert.equal(last.options.source,source);
 }
 f.context.AdminOperations.reset();assert.equal(f.nodes.adminOperationsNav.children.length,0);assert.equal(f.nodes.adminConsoleIdentity.textContent,'');assert.equal(f.nodes.adminOperationsShell.hidden,true);
});

test('sub-admin navigation emits only groups and controls permitted by the current actor',async()=>{
 const f=adminFixture({userId:'staff-a',accountServiceReady:true,admin:{role:'SUB_ADMIN',permissions:['CONTENT_METADATA_READ']}});await f.context.AdminOperations.navigate('dashboard',false);
 assert.deepEqual(f.groups(),['작품·발행 관리']);assert.deepEqual(f.buttons().map(button=>button.textContent),['작품·변경 검토','회차 조회']);
 const before=f.dispatches.length;await f.context.AdminOperations.navigate('roles',false);assert.equal(f.dispatches.length,before);assert.match(f.nodes.adminOperationsContent.children.map(node=>node.textContent).join(''),/권한이 없습니다/);
 f.setActor({userId:'staff-a',accountServiceReady:true,admin:{role:'SUB_ADMIN',permissions:['CASE_READ']}});await f.context.AdminOperations.navigate('dashboard',false);assert.deepEqual(f.groups(),['운영 현황·문의','신고·복구']);assert.equal(f.buttons().some(button=>button.textContent==='서브관리자·권한'),false);
});

test('account/support dialogs retain labelled roles, native form boundaries, field labels and policy destinations',async()=>{
 assert.deepEqual(doc.errors,[]);const ids=doc.nodes.map(node=>attr(node,'id')).filter(Boolean);assert.equal(ids.length,new Set(ids).size);
 for(const form of doc.nodes.filter(node=>node.tagName==='form'))assert(!doc.nodes.some(parent=>parent!==form&&parent.tagName==='form'&&inside(form,parent)),'nested form');
 for(const id of ['modalAuth','modalAdminLogin','modalEditProfile','betaSupportModal']){
  const modal=doc.byId(id),dialog=doc.nodes.find(node=>attr(node,'role')==='dialog'&&inside(node,modal));assert(dialog,id);assert.equal(attr(dialog,'aria-modal'),'true');assert(doc.byId(attr(dialog,'aria-labelledby')),'dialog needs an existing heading');
 }
 const tabs=doc.nodes.filter(node=>attr(node,'data-auth-tab'));for(const tab of tabs){const panel=doc.byId(attr(tab,'aria-controls'));assert.equal(attr(tab,'role'),'tab');assert.equal(attr(panel,'role'),'tabpanel');assert.equal(attr(panel,'aria-labelledby'),attr(tab,'id'));}
 for(const id of ['loginEmail','loginPassword','signupNickname','signupEmail','signupPassword','signupPasswordConfirm','authorPenName','authorEmail','authorPassword','authorPasswordConfirm','adminLoginId','adminLoginPw','editProfileNickname'])assert(doc.nodes.some(node=>node.tagName==='label'&&attr(node,'for')===id),'missing visible label '+id);
 assert.equal(attr(doc.byId('editProfileNickname'),'autocomplete'),'nickname');
 const completion=authUi.match(/backdrop\.innerHTML = `([\s\S]*?)`;/);assert(completion);const dynamic=documentTree(completion[1]),dialog=dynamic.nodes.find(node=>attr(node,'role')==='dialog');assert.equal(attr(dialog,'aria-modal'),'true');assert(dynamic.byId(attr(dialog,'aria-labelledby')));assert(dynamic.byId(attr(dialog,'aria-describedby')));
 const policyPaths=['/company/','/policies/terms/','/policies/refund/'];const auth=doc.byId('modalAuth');for(const path of policyPaths)assert(doc.nodes.some(node=>node.tagName==='a'&&attr(node,'href')===path&&inside(node,auth)),'auth policy '+path);
 for(const path of policyPaths){const file=await read('public'+path+'index.html'),policy=documentTree(file);assert.deepEqual(policy.errors,[]);const policyIds=policy.nodes.map(node=>attr(node,'id')).filter(Boolean);assert.equal(policyIds.length,new Set(policyIds).size);for(const destination of policyPaths)assert(policy.nodes.some(node=>node.tagName==='a'&&attr(node,'href')===destination),'policy cross-link '+destination);}
});

test('operations/account CSS parses and scopes responsive hit targets, overflow and static navigation to its work surfaces',async()=>{
 const parsed=await transform(css,{loader:'css',minify:false});assert.deepEqual(parsed.warnings,[]);
 const clean=css.replace(/\/\*[\s\S]*?\*\//g,''),rules=[...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match=>({selector:match[1].trim(),body:match[2]}));
 assert(rules.length>50);for(const rule of rules)assert(/^(?:#view-admin-cms|#modalAuth|#modalEditProfile|#betaSupportModal|:is\(#(?:modalAuth|betaSupportModal|view-admin-cms|view-creator))/.test(rule.selector),'unexpected global rule '+rule.selector);
 assert.doesNotMatch(clean,/(?:^|\n)\s*(?:body|html|:root|\*|button|input|\.modal-dialog|\.btn)\s*[{,]/);assert.doesNotMatch(css,/#(?:[a-f0-9]{3}){1,2}\b|rgba?\(/i);
 assert(rules.some(rule=>rule.selector.includes('.cms-sidebar')&&/position:\s*static/.test(rule.body)));assert(rules.some(rule=>rule.selector.includes('.cms-nav-link')&&/min-height:\s*44px/.test(rule.body)));
 assert(rules.some(rule=>rule.selector.includes('.cms-table-wrap')&&/overflow-x:\s*auto/.test(rule.body)));assert(rules.some(rule=>rule.selector.includes('.modal-dialog')&&/overflow-y:\s*auto/.test(rule.body)&&/100dvh/.test(rule.body)));
 assert(rules.some(rule=>rule.selector.includes('#adminOperationsContent')&&/min-width:\s*0/.test(rule.body)));assert.match(css,/@media\s*\(max-width:\s*600px\)/);assert.match(css,/outline:\s*3px solid var\(--border-focus\)/);
 assert.match(css,/grid-template-columns:\s*minmax\(0,\s*1fr\)/);assert.match(css,/var\(--text-primary\)/);assert.match(css,/var\(--control-border\)/);
});

test('R6 changed assets have explicit local cache versions and preserve compatibility script ordering',async()=>{
 const sources=doc.nodes.filter(node=>node.tagName==='script').map(node=>attr(node,'src')).filter(Boolean),styles=doc.nodes.filter(node=>node.tagName==='link').map(node=>attr(node,'href')).filter(Boolean);
 assert(styles.includes('/css/operations-account.css?v=20261031r6'));
 for(const path of ['/app.js','/js/core/auth-ui.js','/js/core/account-access.js','/js/core/beta-support.js']){assert(sources.includes(path+'?v=20261031r6'),path+' cache');await read('public'+path);}
 assert(sources.includes('/js/core/role-modules.js?v=20261031r10'));
 for(const name of ['admin-console','admin-publication-changes','admin-workflow','admin-beta-operations','admin-operations']){const path='/js/admin/'+name+'.js?v='+(name==='admin-workflow'?'20261031r7':'20261031r6');assert(loader.includes(path),name+' cache');await read('public'+path.split('?')[0]);}
 assert(sources.indexOf('/js/core/auth-session.js?v=136')<sources.indexOf('/js/core/beta-support.js?v=20261031r6'));assert(sources.indexOf('/js/core/beta-support.js?v=20261031r6')<sources.indexOf('/app.js?v=20261031r6'));
 assert(loader.indexOf('/js/admin/admin-beta-operations.js')<loader.indexOf('/js/admin/admin-operations.js'));assert(loader.includes('/js/creator/creator-webtoon.js?v=20261031r10'));assert(loader.includes('/js/creator/creator-editor.js?v=20261031r8'));
});
