import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parse,parseFragment} from 'parse5';
import {transform} from 'esbuild';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const accountSource=read('public/js/core/account-access.js'),authSource=read('public/js/core/auth-ui.js');
const walk=(node)=>[node,...(node.childNodes||node.children||[]).flatMap(walk)];
const attr=(node,name)=>node.attrs?.find(item=>item.name===name)?.value;
const hasClass=(node,name)=>(attr(node,'class')||'').split(/\s+/).includes(name);
const inside=(node,parent)=>{for(let at=node;at;at=at.parentNode)if(at===parent)return true;return false;};
const content=node=>hasClass(node,'policy-toc')?'':node.nodeName==='#text'?node.value:(node.childNodes||[]).map(content).join('');
const normalized=node=>content(node).replace(/\s+/g,' ').trim();
const digest=value=>createHash('sha256').update(value).digest('hex');
const deferred=()=>{let resolve,reject;const promise=new Promise((ok,fail)=>{resolve=ok;reject=fail;});return {promise,resolve,reject};};

// Small local DOM substitute: parse actual generated markup, execute production handlers,
// and keep textContent separate from parsed HTML so unsafe rendering cannot pass silently.
function fixture(initialActor=null){
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.attributes=new Map();this.hidden=false;this.disabled=false;this.value='';this._text='';this.className='';
   this.classList={add:name=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),name])].join(' ');},
    remove:name=>{this.className=this.className.split(/\s+/).filter(item=>item!==name).join(' ');},
    contains:name=>this.className.split(/\s+/).includes(name),toggle:(name,on)=>on?this.classList.add(name):this.classList.remove(name)};
  }
  setAttribute(name,value){this.attributes.set(name,String(value));if(['id','class','type','href'].includes(name))this[name==='class'?'className':name]=String(value);if(['hidden','disabled','required'].includes(name))this[name]=true;}
  getAttribute(name){return this.attributes.get(name)??null;}
  focus(){this.focused=true;}
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
  appendChild(node){this.append(node);return node;}
  prepend(node){node.parentNode=this;this.children.unshift(node);}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  querySelectorAll(selector){return walk(this).slice(1).filter(node=>selector==='button[type="submit"]'?node.tagName==='button'&&node.type==='submit':selector.startsWith('.')?node.classList?.contains(selector.slice(1)):node.tagName===selector);}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
  set innerHTML(value){this._text='';this.children=[];for(const node of parseFragment(value).childNodes)this.append(convert(node));}
 }
 function convert(node){const result=new Element(node.tagName||'#text');for(const item of node.attrs||[])result.setAttribute(item.name,item.value);
  if(node.nodeName==='#text')result._text=node.value;for(const child of node.childNodes||[])result.append(convert(child));
  if(node.tagName==='select')result.value=result.children.find(child=>child.tagName==='option')?.getAttribute('value')||'';return result;}
 const body=new Element('body'),get=id=>walk(body).find(node=>node.id===id)||null;
 for(const id of ['view-creator','view-mypage','authorWorkspaceNotice','loginEmail','adminLoginId','adminLoginPw']){const node=new Element(id.includes('Login')||id==='loginEmail'?'input':'section');node.id=id;body.append(node);}
 let actor=initialActor;const calls=[],toasts=[],routes=[],closes=[];
 const loginModal=new Element('div');loginModal.id='modalAuth';loginModal.hidden=true;body.append(loginModal);
 for(const [id,tag] of [['loginPassword','input'],['authLoginStatus','p'],['authTab-login','button']]){
  const node=new Element(tag);node.id=id;loginModal.append(node);
 }
 get('authTab-login').click=()=>calls.push(['select-login']);
 const api={getActor:()=>actor,message:error=>error.message,complete:async(kind,name)=>{calls.push(['complete',kind,name]);},
  completeReaderSignup:async name=>{calls.push(['complete-reader-signup',name]);return '독자 회원가입이 완료되었습니다. 로그인해주세요.';},
  changePassword:async password=>{calls.push(['password',password]);},login:async(email,password)=>{calls.push(['login',email,password]);return actor;},logout:async()=>{calls.push(['logout']);actor=null;},reset:async email=>calls.push(['reset',email])};
 const c={document:{body,getElementById:get,createElement:tag=>new Element(tag)},WebNovelsAuth:api,
  AuthorEnrollment:{mount:node=>calls.push(['mount',node.id]),reset:()=>calls.push(['enrollment-reset'])},
  showToast:message=>toasts.push(message),switchWebNovelsView:id=>routes.push(id),openAccountHome:async()=>routes.push('account-home'),
  handleMemberLogout:()=>calls.push(['member-logout']),
  closeModal:id=>{get(id).hidden=true;closes.push(id);},closeAllModals:()=>{for(const node of walk(body))if(node.classList?.contains('modal-backdrop'))node.hidden=true;},
  openModal:id=>{get(id).hidden=false;},fetch:()=>assert.fail('UI must not create a new network/authentication path')};
 c.window=c;vm.createContext(c);vm.runInContext(accountSource,c);vm.runInContext(authSource,c);
 return {c,api,get,body,calls,toasts,routes,closes,setActor:value=>actor=value,
  submit:()=>get('authCompletionForm').onsubmit({preventDefault(){},target:get('authCompletionForm')})};
}

test('account-only display uses verified workspace gates and removes stale summaries',()=>{
 const app=fixture({userId:'author-auth',accountServiceOnly:true,authorWorkspaceReady:true,author:{id:12,status:'APPROVED',pen_name:'Writer'}});
 assert.equal(app.c.showAccountAccessSummary('view-creator'),false);assert.equal(app.get('authorWorkspaceNotice').hidden,false);
 assert.equal(app.get('view-creator').classList.contains('private-author-workspace'),true);
 app.setActor({userId:'reader-auth',accountServiceOnly:true,authorWorkspaceReady:true,reader:{nickname:'Reader',role:'AUTHOR'}});
 assert.equal(app.c.showAccountAccessSummary('view-creator'),true);assert.equal(app.get('authorWorkspaceNotice').hidden,true);
 assert.equal(app.get('view-creator').classList.contains('private-author-workspace'),false);
 for(const status of ['PENDING','SUSPENDED','REJECTED']){
  app.setActor({accountServiceOnly:true,authorWorkspaceReady:true,author:{status}});
  assert.equal(app.c.showAccountAccessSummary('view-creator'),true);assert.equal(app.get('authorWorkspaceNotice').hidden,true);
 }
 app.setActor(null);assert.equal(app.c.showAccountAccessSummary('view-creator'),false);
 assert.equal(app.get('view-creator').querySelector('.account-access-summary'),null);
 assert.equal(app.c.showAccountAccessSummary('view-admin-cms'),false);
});

test('account summary renders names as text and offers real public policy routes without payment or PASS claims',()=>{
 const name='<img src=x onerror=alert(1)>',app=fixture({accountServiceOnly:true,reader:{nickname:name}});
 assert.equal(app.c.showAccountAccessSummary('view-mypage'),true);
 const summary=app.get('view-mypage').querySelector('.account-access-summary');
 assert(summary.textContent.includes(name));assert.equal(summary.querySelectorAll('img').length,0);
 assert.equal(summary.getAttribute('aria-labelledby'),'accountAccessTitle-view-mypage');
 assert.doesNotMatch(summary.textContent,/PASS.*완료|실명.*완료|결제.*가능/);
 assert.deepEqual(summary.querySelectorAll('a').map(node=>node.href),['/company/','/policies/terms/','/policies/refund/']);
 const buttons=summary.querySelectorAll('button');assert(buttons.every(node=>node.type==='button'));
 buttons[0].onclick();buttons[1].onclick();assert.deepEqual(app.routes,['view-home']);assert.deepEqual(app.calls,[['member-logout']]);
});

test('generated completion dialog keeps labels, live status, policy links and distinct profile/recovery requirements',()=>{
 const app=fixture({userId:'author-auth',author:{id:12,status:'APPROVED',pen_name:'Existing pen'}});app.c.showAuthOnboarding();
 const dialog=walk(app.get('modalAuthCompletion')).find(node=>node.getAttribute('role')==='dialog');
 assert.equal(dialog.getAttribute('aria-labelledby'),'authCompletionTitle');assert.equal(dialog.getAttribute('aria-describedby'),'authCompletionDescription');
 for(const id of ['authCompletionKind','authCompletionName','authNewPassword','authNewPasswordConfirm'])
  assert(walk(dialog).some(node=>node.tagName==='label'&&node.getAttribute('for')===id),id);
 assert.equal(app.get('authCompletionMessage').getAttribute('aria-live'),'polite');assert.equal(app.get('authCompletionMessage').getAttribute('aria-atomic'),'true');
 assert.equal(app.get('authCompletionName').value,'Existing pen');assert.equal(app.get('authCompletionName').readOnly,true);
 assert.equal(app.get('authCompletionName').required,true);assert.equal(app.get('authNewPassword').disabled,true);
 assert.equal(app.get('authCompletionPassword').hidden,true);assert.equal(app.get('authAuthorEnrollment').hidden,false);
 assert.deepEqual(walk(dialog).filter(node=>node.tagName==='a').map(node=>node.href),['/company/','/policies/terms/','/policies/refund/']);
 app.get('authNewPassword').value='old-private-value';app.c.showAuthRecovery();
 assert.equal(app.get('authCompletionProfile').hidden,true);assert.equal(app.get('authCompletionName').disabled,true);
 assert.equal(app.get('authNewPassword').required,true);assert.equal(app.get('authNewPasswordConfirm').required,true);
 assert.equal(app.get('authNewPassword').disabled,false);assert.equal(app.get('authNewPassword').value,'');
 assert.equal(app.get('authAuthorEnrollment').hidden,true);assert.equal(app.calls.at(-1)[0],'enrollment-reset');
});

test('reader completion calls the existing verified Auth path and author completion cannot skip enrollment failures',async()=>{
 const app=fixture();app.c.showAuthOnboarding();const kind=app.get('authCompletionKind');assert.equal(kind.value,'reader');
 app.get('authCompletionName').value='Reader';await app.submit();
 assert.deepEqual(app.calls.find(call=>call[0]==='complete-reader-signup'),['complete-reader-signup','Reader']);
 assert.deepEqual(app.calls.at(-1),['select-login']);assert.deepEqual(app.routes,[]);
 assert.equal(app.get('modalAuthCompletion').hidden,true);assert.equal(app.get('modalAuth').hidden,false);
 assert.match(app.get('authLoginStatus').textContent,/독자 회원가입이 완료/);assert.equal(app.get('loginEmail').focused,true);
 app.c.showAuthOnboarding('author');assert.equal(kind.value,'author');
 app.api.complete=async()=>{throw Error('저작권 동의와 PASS 본인확인을 먼저 완료해주세요.');};
 await app.submit();assert.match(app.get('authCompletionMessage').textContent,/저작권.*PASS/);
 assert.equal(app.get('modalAuthCompletion').hidden,false);assert.equal(app.routes.length,0);
 assert.equal(app.get('authCompletionMessage').classList.contains('auth-form-error'),true);
});

test('completion serializes repeated submits and an older mode cannot overwrite a newly opened recovery panel',async()=>{
 const app=fixture(),pending=deferred();app.api.complete=()=>{app.calls.push(['pending-complete']);return pending.promise;};app.c.showAuthOnboarding('author');
 const first=app.submit();await app.submit();assert.equal(app.calls.filter(call=>call[0]==='pending-complete').length,1);
 assert.equal(app.get('authCompletionForm').getAttribute('aria-busy'),'true');assert.equal(app.get('authCompletionForm').querySelector('button[type="submit"]').disabled,true);
 app.c.showAuthRecovery();assert.equal(app.get('authCompletionForm').querySelector('button[type="submit"]').disabled,false);
 pending.resolve();await first;assert.equal(app.get('authCompletionTitle').textContent,'새 비밀번호 설정');
 assert.equal(app.get('authCompletionMessage').textContent,'');assert.equal(app.get('modalAuthCompletion').hidden,false);
 assert.deepEqual(app.toasts,[]);assert.deepEqual(app.routes,[]);assert.deepEqual(app.closes,[]);
});

test('closed or superseded completion failures do not expose stale errors in the current panel',async()=>{
 for(const reopen of [true,false]){
  const app=fixture(),pending=deferred();app.api.complete=()=>pending.promise;app.c.showAuthOnboarding('author');const first=app.submit();
  if(reopen)app.c.showAuthRecovery();else app.c.closeModal('modalAuthCompletion');
  pending.reject(Error('<img src=x> previous account error'));await first;
  assert(!app.get('authCompletionMessage').textContent.includes('previous account'));assert.deepEqual(app.routes,[]);assert.deepEqual(app.toasts,[]);
 }
});

test('password recovery delegates session checks to Auth, keeps failures visible and clears successful passwords',async()=>{
 const app=fixture();app.c.showAuthRecovery();app.get('authNewPassword').value='new-password';app.get('authNewPasswordConfirm').value='mismatch';
 await app.submit();assert.equal(app.calls.some(call=>call[0]==='password'),false);assert.match(app.get('authCompletionMessage').textContent,/일치하지/);
 app.get('authNewPasswordConfirm').value='new-password';app.api.changePassword=async()=>{throw Error('recovery session required');};
 await app.submit();assert.equal(app.get('modalAuthCompletion').hidden,false);assert.equal(app.get('authCompletionForm').getAttribute('aria-busy'),'false');
 assert.match(app.get('authCompletionMessage').textContent,/recovery session required/);
 app.api.changePassword=async value=>app.calls.push(['password',value]);await app.submit();
 assert.deepEqual(app.calls.find(call=>call[0]==='password'),['password','new-password']);
 assert.equal(app.get('authNewPassword').value,'');assert.equal(app.get('authNewPasswordConfirm').value,'');
 assert.deepEqual(app.routes,[]);assert.equal(app.get('modalAuthCompletion').hidden,true);assert.equal(app.calls.some(call=>call[0]==='complete'),false);
});

test('admin entry still requires the verified admin profile rather than cached role wording',async()=>{
 const app=fixture({userId:'reader-auth',reader:{role:'SUPER_ADMIN'}});app.get('adminLoginId').value='reader@example.test';app.get('adminLoginPw').value='test-value';
 await app.c.handleAdminLoginProcess();assert.deepEqual(app.routes,[]);assert.equal(app.calls.at(-1)[0],'logout');
 app.setActor({userId:'admin-auth',admin:{role:'SUPER_ADMIN'}});await app.c.handleAdminLoginProcess();assert.deepEqual(app.routes,['view-admin-cms']);
});

// R5 legal text and pre-existing links are fixed independently of the redesigned DOM.
// A legal rewrite requires a separate reviewed update rather than silently changing UI snapshots.
const policies=[
 {path:'public/company/index.html',url:'/company/',article:'eaa219af5e94170c1f0fd553a7487452d5c5d121fca180c1317ace981e212363',links:'a0b4576417bf4d0d251468b8ef80c587b22250b9869406e6e331a0001236db2b'},
 {path:'public/policies/terms/index.html',url:'/policies/terms/',article:'8506be4ee73e28120eee961be0787265993c87c2249166a11194c35ae115a700',links:'2bad1a1cc21c96a437db18fc48537548e61c99bdf273957383aa340af6010743'},
 {path:'public/policies/refund/index.html',url:'/policies/refund/',article:'f58327d330bc39b44a6abdfe9f60e0075e8ff41f0c735ddc5e65ebabaddcabf5',links:'e713a2fedf9f6dc83fd4673164110babd52aa8c41549a43a8c6eb97eac404126'}
];
for(const policy of policies)test('policy navigation preserves legal text, public URLs and reachable section anchors: '+policy.url,()=>{
 const errors=[],tree=parse(read(policy.path),{onParseError:error=>errors.push(error)}),nodes=walk(tree);assert.deepEqual(errors,[]);
 const ids=nodes.map(node=>attr(node,'id')).filter(Boolean);assert.equal(ids.length,new Set(ids).size);
 const main=nodes.find(node=>node.tagName==='main'),footer=nodes.find(node=>node.tagName==='footer');
 assert.equal(digest(normalized(main)),policy.article);assert.equal(digest(normalized(footer)),'10c7554372e9f8bd6ac2007281f12eb0362044d7eb277a2c0c8811163fbe57fe');
 const toc=nodes.find(node=>hasClass(node,'policy-toc'));assert(toc);assert.equal(attr(toc,'aria-label'),'이 페이지 목차');
 assert.equal(digest(JSON.stringify(nodes.filter(node=>node.tagName==='a'&&!inside(node,toc)).map(node=>attr(node,'href')))),policy.links);
 assert.equal(attr(main,'tabindex'),'-1');assert(nodes.find(node=>attr(node,'id')===attr(main,'aria-labelledby')));
 const tocLinks=nodes.filter(node=>node.tagName==='a'&&inside(node,toc));assert(tocLinks.length>=3);
 for(const link of tocLinks){const href=attr(link,'href');assert(href.startsWith('#'));assert(nodes.find(node=>attr(node,'id')===href.slice(1)),href);}
 const nav=nodes.find(node=>hasClass(node,'policy-nav')),current=nodes.filter(node=>inside(node,nav)&&attr(node,'aria-current')==='page');
 assert.equal(current.length,1);assert.equal(attr(current[0],'href'),policy.url);
 assert.equal(attr(nodes.find(node=>node.tagName==='link'&&attr(node,'rel')==='canonical'),'href'),'https://webnovels-db4.pages.dev'+policy.url);
 assert(nodes.some(node=>node.tagName==='link'&&attr(node,'href')==='/css/policies.css?v=20261031r6'));
 assert.equal(nodes.filter(node=>node.tagName==='script'||node.tagName==='form').length,0);
});

test('policy CSS parses with readable mobile geometry, keyboard focus and scope isolated from reader/admin screens',async()=>{
 const source=read('public/css/policies.css'),result=await transform(source,{loader:'css'});assert.deepEqual(result.warnings,[]);
 const rules=[...result.code.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([,selector])=>!selector.trim().startsWith('@'));
 for(const [,selector]of rules)for(const part of selector.trim().split(/,\s*(?![^()]*\))/))
  assert(part.trim().startsWith('.policy-page')||part.trim().startsWith('.legal-footer'),'unscoped policy selector: '+part);
 assert.doesNotMatch(source,/@import|url\(|#view-reader|#view-admin|--reader-font|position:\s*fixed/);
 assert.match(source,/:focus-visible[^}]+outline:\s*3px solid var\(--border-focus\)/);
 assert.match(source,/min-height:\s*44px/);assert.match(source,/@media \(max-width: 480px\)/);
 assert.match(source,/\.policy-toc ol\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
 assert.match(source,/overflow-wrap:\s*anywhere/);assert.match(source,/scroll-margin-top:/);
 assert.match(source,/@media print/);assert.match(source,/\.policy-article h2\s*\{\s*break-after:\s*avoid/);
});
