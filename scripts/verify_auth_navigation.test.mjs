import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const read = file => readFileSync(file, 'utf8');
const readerSource = ts.createSourceFile('reader.js', read('public/js/reader/reader.js'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const author = () => ({userId:'author-auth-uuid', author:{id:12, status:'APPROVED', pen_name:'Writer'}, reader:null, admin:null, authorWorkspaceReady:true});
const subscriber = () => ({userId:'reader-auth-uuid', author:null, reader:{id:31, status:'ACTIVE', nickname:'Reader'}, admin:null});
const ticks = async () => { for (let i=0; i<100; i++) await Promise.resolve(); };

// Execute the production Auth, router, lazy loader and reader entry functions together.
// SDK responses, DOM elements and script network completion are local substitutes.
function fixture({who=author(), url='/', holdScripts=false, signedIn=true}={}) {
  let serverActor=who, session=signedIn ? {access_token:'test-session'} : null;
  const nodes=new Map(), scripts=[], events=new Map(), toasts=[], routes=[], storage=new Map(), visits=[];
  const element = tag => {
    const classes=new Set(), attributes=new Map(), styles=new Map();
    return {tag, hidden:false, value:'', innerHTML:'', textContent:'', children:[], dataset:{},
      style:{setProperty:(k,v)=>styles.set(k,v), removeProperty:k=>styles.delete(k)},
      classList:{add:k=>classes.add(k), remove:k=>classes.delete(k), contains:k=>classes.has(k), toggle(k,on){if(on)classes.add(k);else classes.delete(k);}},
      setAttribute:(k,v)=>attributes.set(k,v), getAttribute:k=>attributes.get(k),
      append(...children){this.children.push(...children);}, replaceChildren(...children){this.children=children;},
      remove(){}, querySelector(){return null;}, querySelectorAll(){return [];}, addEventListener(){}};
  };
  for (const id of ['view-home','view-creator','view-admin-cms','view-mypage','view-work-detail','view-reader',
    'moduleLoadStatus','userProfileMenu','headerCreatorLink','authorStudioNavigation','linkMoreCreator',
    'loginEmail','loginPassword','modalAuthCompletion','authCompletionTitle','authCompletionProfile',
    'authCompletionPassword','authCompletionName','authCompletionKind','authNewPassword',
    'authNewPasswordConfirm','authCompletionMessage','authCompletionForm','authAuthorEnrollment']) nodes.set(id,element('div'));
  const portals=['headerCreatorLink','authorStudioNavigation','linkMoreCreator'].map(id=>nodes.get(id));
  portals.forEach(n=>n.hidden=true);
  nodes.get('loginEmail').value='writer@example.test'; nodes.get('loginPassword').value='test-password';
  const auth={
    getSession:async()=>({data:{session}}), signOut:async()=>{session=null;return {};},
    signInWithPassword:async()=>{session={access_token:'test-session'};return {data:{session}};},
    onAuthStateChange:fn=>events.set('auth',fn)
  };
  const c={URL, URLSearchParams, console:{log(){},warn(){},error(){}}, setTimeout(){},
    location:new URL(url,'https://app.test'), currentActiveView:'view-home', lastMainView:'view-home', isAdminLoggedIn:false,
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    history:{pushState(_state,_title,url){routes.push(['push',url]);c.location=new URL(url,c.location);},
      replaceState(_state,_title,url){routes.push(['replace',url]);c.location=new URL(url,c.location);}},
    supabaseClient:{auth},initSupabaseAdmin:()=>true,
    fetch:async route=>Response.json(route==='/api/v2/onboarding'?{actor:serverActor}:serverActor),
    document:{readyState:'loading',body:element('body'),getElementById:id=>nodes.get(id)||null,createElement:element,
      querySelectorAll:selector=>selector==='[data-account-portal="creator"]'?portals:selector==='.main-view'?
        [...nodes].filter(([id])=>id.startsWith('view-')).map(([,node])=>node):[],
      head:{appendChild(script){scripts.push(script);if(!holdScripts)queueMicrotask(()=>script.onload());}},addEventListener(){}},
    addEventListener:(name,fn)=>events.set(name,fn), scrollTo(){},showToast:text=>toasts.push(text),openModal(){},closeAllModals(){},closeModal(){},
    escapeHtml:value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),
    CreatorDashboard:{active:()=>!!c.WebNovelsAuth?.getActor()?.authorWorkspaceReady,reset(){}},
    fetchCreatorDashboardData:()=>visits.push('creator'), loadAdminDashboard:()=>visits.push('admin'),
    renderLibraryContent:()=>visits.push('library'), switchCreatorTab:tab=>visits.push(tab),
    openWorkDetailDirect:(id,push)=>visits.push(['work',id,push]),openReaderDirect:(...args)=>visits.push(['read',...args])
  };
  c.window=c;vm.createContext(c);
  const run=file=>vm.runInContext(read(file),c,{filename:path.resolve(file)});
  for (const name of ['handleMemberLogin','getCurrentAuthorSession','getCurrentCreatorSession','updateMemberHeader']) {
    const fn=readerSource.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(fn,name);
    vm.runInContext(fn.getText(readerSource),c,{filename:'reader-entry-'+name+'.js'});
  }
  for (const file of ['auth-session','role-modules','router','auth-ui']) run('public/js/core/'+file+'.js');
  const drain=async()=>{let i=0;while(i<scripts.length){scripts[i++].onload();await ticks();}};
  return {c,nodes,scripts,events,toasts,routes,storage,visits,run,drain,portals,setActor:value=>serverActor=value};
}

test('restored author at the default URL opens the studio instead of subscriber home',async()=>{
  const app=fixture();await app.c.WebNovelsAuth.init();await app.c.initRouteHandler();
  assert.equal(app.c.location.pathname,'/creator');assert.equal(app.c.currentActiveView,'view-creator');
  assert.equal(app.nodes.get('view-creator').classList.contains('active'),true);
  assert.deepEqual(app.routes,[['replace','/creator']]);assert.ok(app.visits.includes('creator'));
  assert.equal(app.c.document.body.getAttribute('data-user-role'),'AUTHOR');
  assert.ok(app.portals.every(n=>!n.hidden));
});

test('reader and admin profiles retain their own default destinations and role module boundaries',async()=>{
  const reader=fixture({who:subscriber()});await reader.c.WebNovelsAuth.init();await reader.c.initRouteHandler();
  assert.equal(reader.c.currentActiveView,'view-home');assert.equal(reader.scripts.length,0);assert.ok(reader.portals.every(n=>n.hidden));
  const admin=fixture({who:{userId:'admin-auth-uuid',admin:{role:'SUPER_ADMIN'},author:null,reader:null}});
  await admin.c.WebNovelsAuth.init();await admin.c.initRouteHandler();
  assert.equal(admin.c.location.pathname,'/admin');assert.equal(admin.c.currentActiveView,'view-admin-cms');
  assert.ok(admin.scripts.every(n=>n.src.includes('/admin/')));assert.ok(admin.portals.every(n=>n.hidden));
});

for (const url of ['/creator/profile','/author/works/12','/home','/library/authors','/works/91','/read/91/4','/?auth=recovery','/#home']) {
  test('session restoration preserves an explicit destination: '+url,async()=>{
    const app=fixture({url});await app.c.WebNovelsAuth.init();await app.c.initRouteHandler();
    assert.equal(app.c.location.pathname+app.c.location.search+app.c.location.hash,url);
    assert.equal(app.routes.length,0);
    if (/^\/(creator|author)/.test(url)) assert.equal(app.c.currentActiveView,'view-creator');
    if (url==='/read/91/4') assert.deepEqual(app.visits.at(-1),['read','91',4,false]);
  });
}

test('password login waits for the studio modules and preserves the requested author subpage',async()=>{
  const app=fixture({url:'/author/works/12',holdScripts:true});let finished=false;
  const pending=app.c.handleMemberLogin().then(()=>finished=true);await ticks();
  assert.ok(app.scripts.length>0);assert.equal(finished,false);assert.equal(app.toasts.includes('로그인되었습니다.'),false);
  await app.drain();await pending;
  assert.equal(app.c.currentActiveView,'view-creator');assert.equal(app.c.location.pathname,'/author/works/12');
  assert.equal(app.toasts.at(-1),'로그인되었습니다.');
});

test('an author with a reader profile still enters the studio without relying on a role label or pen name',async()=>{
  const who=author();who.reader=subscriber().reader;who.author.pen_name='';who.reader.role='WRITER';
  const app=fixture({who,url:'/home'});await app.c.handleMemberLogin();
  assert.equal(app.c.location.pathname,'/creator');assert.equal(app.c.document.body.getAttribute('data-user-role'),'AUTHOR');
});

test('forged cached Author/Creator/Writer labels never expose author navigation or modules',async()=>{
  const app=fixture({who:subscriber()});await app.c.WebNovelsAuth.init();
  for (const role of ['AUTHOR','CREATOR','WRITER']) {
    app.storage.set('webnovels_user',JSON.stringify({role,pen_name:'Forged'}));
    app.c.updateMemberHeader({role,pen_name:'Forged'});
    assert.equal(app.c.document.body.getAttribute('data-user-role'),'READER');assert.ok(app.portals.every(n=>n.hidden));
  }
  await app.c.handleMemberLogin();assert.equal(app.c.location.pathname,'/library');assert.equal(app.scripts.length,0);
});

test('finishing author onboarding opens the same studio route as password login',async()=>{
  const app=fixture();await app.c.WebNovelsAuth.init();app.c.showAuthOnboarding();
  app.c.AuthorEnrollment={complete:async()=>app.c.WebNovelsAuth.validate()};
  app.nodes.get('authCompletionKind').value='author';app.nodes.get('authCompletionName').value='Writer';
  await app.nodes.get('authCompletionForm').onsubmit({preventDefault(){},target:{querySelector:()=>({disabled:false})}});
  assert.equal(app.c.location.pathname,'/creator');assert.equal(app.c.currentActiveView,'view-creator');
});

test('logout during a pending studio entry prevents a late private view and clears its menus',async()=>{
  const app=fixture({holdScripts:true});const pending=app.c.handleMemberLogin();await ticks();
  await app.c.WebNovelsAuth.logout();await app.drain();await pending;
  assert.notEqual(app.c.currentActiveView,'view-creator');assert.equal(app.c.WebNovelsAuth.getActor(),null);
  assert.ok(app.portals.every(n=>n.hidden));assert.equal(app.toasts.includes('로그인되었습니다.'),false);
});

test('a studio module failure remains visible and can be retried without losing the session',async()=>{
  const app=fixture({holdScripts:true});const pending=app.c.handleMemberLogin();await ticks();
  app.scripts[0].onerror();await pending;
  const status=app.nodes.get('moduleLoadStatus');assert.equal(status.hidden,false);
  assert.ok(status.children.some(n=>n.tag==='button'));assert.equal(app.c.WebNovelsAuth.getActor().author.id,12);
  const retry=status.children.find(n=>n.tag==='button').onclick();await ticks();await app.drain();await retry;
  assert.equal(app.c.currentActiveView,'view-creator');assert.equal(status.hidden,true);
});

test('default routing completes before a slow public catalog and never overrides later user navigation',async()=>{
  const app=fixture();let finishCatalog;
  app.c.WebNovelsAdmin={init(){},fetchWorksFromSupabase:()=>new Promise(resolve=>finishCatalog=resolve)};
  const source=ts.createSourceFile('app.js',read('public/app.js'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const bootstrap=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='initWebNovelsApp');
  vm.runInContext(bootstrap.getText(source),app.c);app.c.bindWebNovelsEvents=()=>{};
  const pending=app.c.initWebNovelsApp();await ticks();
  assert.equal(app.c.currentActiveView,'view-creator');assert.equal(typeof finishCatalog,'function');
  app.c.navigateTo('/home');finishCatalog([]);await pending;
  assert.equal(app.c.currentActiveView,'view-home');assert.equal(app.c.location.pathname,'/home');
});

test('a legacy public deep link waits for the catalog instead of resolving against an empty cache',async()=>{
  const app=fixture({url:'/works/91'});let finishCatalog,loaded=false;
  app.c.WebNovelsAdmin={init(){},fetchWorksFromSupabase:()=>new Promise(resolve=>finishCatalog=()=>{loaded=true;resolve([]);})};
  app.c.SAMPLE_WORKS=[];app.c.openWorkDetailDirect=id=>{assert.equal(loaded,true);app.visits.push(['work',id]);};
  const source=ts.createSourceFile('app.js',read('public/app.js'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  vm.runInContext(source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='initWebNovelsApp').getText(source),app.c);
  app.c.bindWebNovelsEvents=()=>{};
  const pending=app.c.initWebNovelsApp();await ticks();assert.equal(app.visits.length,0);
  finishCatalog();await pending;assert.deepEqual(app.visits.filter(Array.isArray),[['work','91']]);
});

test('a portal still loading from the public home wins over delayed bootstrap routing',async()=>{
  const app=fixture({url:'/home',holdScripts:true});let finishCatalog;
  app.c.WebNovelsAdmin={init(){},fetchWorksFromSupabase:()=>new Promise(resolve=>finishCatalog=resolve)};
  const source=ts.createSourceFile('app.js',read('public/app.js'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  vm.runInContext(source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='initWebNovelsApp').getText(source),app.c);
  app.c.bindWebNovelsEvents=()=>{};
  const bootstrap=app.c.initWebNovelsApp();await ticks();
  const entry=app.c.switchWebNovelsView('view-creator');assert.equal(app.c.location.pathname,'/home');
  finishCatalog([]);await bootstrap;await app.drain();await entry;
  assert.equal(app.c.currentActiveView,'view-creator');assert.equal(app.c.location.pathname,'/creator');
});

test('desktop and mobile studio links are initially hidden, point to the existing portal and use the verified actor gate',()=>{
  const html=read('public/index.html');
  for (const id of ['headerCreatorLink','authorStudioNavigation','linkMoreCreator']) {
    const tag=html.match(new RegExp('<[^>]+id="'+id+'"[^>]*>'))?.[0];assert.ok(tag,id);
    assert.match(tag,/data-account-portal="creator"/);assert.match(tag,/\bhidden\b/);
  }
  assert.match(html, /id="headerCreatorLink"[^>]*onclick="handleDirectPortalClick\(event, 'creator'\)"/);
});
