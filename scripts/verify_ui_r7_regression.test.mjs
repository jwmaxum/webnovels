import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {parse,parseFragment} from 'parse5';
import ts from 'typescript';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const paths=['public/index.html','public/js/core/auth-session.js','public/js/reader/reader-hub.js','public/js/reader/reader-position.js','public/js/reader/reader-catalog.js','public/js/reader/continue-reading.js','public/js/core/beta-support.js','public/js/reader/reader.js','public/js/admin/admin-workflow.js'];
const [html,auth,hub,position,catalog,continuation,support,reader,workflow]=await Promise.all(paths.map(read));
const ast=ts.createSourceFile('reader.js',reader,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const readerFunctions=['escapeReaderHtml','window.loadEpisodeComments =','window.handleReaderCommentSubmit =','window.handleReaderReplySubmit =','window.submitReaderComment ='].map(name=>{
 const statement=ast.statements.find(node=>name.startsWith('window.')?ts.isExpressionStatement(node)&&node.getText(ast).startsWith(name):ts.isFunctionDeclaration(node)&&node.name?.text===name);
 assert(statement,'missing real reader function '+name);return statement.getText(ast);
}).join('\n');
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const ticks=async()=>{for(let i=0;i<70;i++)await Promise.resolve();};
const caseId=who=>who==='a'?'3d80dc4b-0aa0-4e41-8da2-bdd5acc2daf1':'3d80dc4b-0aa0-4e41-8da2-bdd5acc2daf2';
const caseRow=who=>({id:caseId(who),title:'문의-'+who,category:'QUESTION',status:'OPEN',revision:'1',createdAt:'2026-10-31T00:00:00Z',updatedAt:'2026-10-31T00:00:00Z',replyCount:0,reopenCount:0});
const caseDetail=who=>({case:caseRow(who),messages:[{id:'m-'+who,authorKind:'USER',kind:'CREATED',message:'비공개 문의-'+who,createdAt:'2026-10-31T00:00:00Z'}]});
const activity=who=>({readingHistory:[{workId:who==='a'?'10':'20',episodeNumber:5,progress:who==='a'?37:62}],favorites:[who==='a'?'10':'20'],subscriptions:[{name:'구독 작가-'+who}],preferences:{}});
const actor=who=>({userId:'account-'+who,reader:{id:'profile-'+who,nickname:'같은 표시 이름'},author:null,admin:null});
const text=node=>node.textContent;
const button=(root,label)=>root.querySelectorAll('button').find(node=>node.textContent.trim()===label);
const field=(root,name)=>root.querySelectorAll('input,select,textarea').find(node=>node.name===name);
const submit=form=>form.onsubmit({preventDefault(){}});

// The DOM tree includes the real entry point AND parsed runtime comments. A flat
// ID map would hide duplicate controls and cannot model getElementById's first match.
function fixture(handler=()=>undefined){
 let document,context,listener,session={access_token:'fixture-a'},serial=0;
 const calls=[],opens=[],storage=new Map(),timers=[];
 class Element {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs=new Map();this.className='';this._text='';this.value='';this.hidden=false;this.disabled=false;this.checked=false;this.style={};this.dataset={};this.events=new Map();
   this.classList={contains:name=>this.className.split(/\s+/).includes(name),add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...names])].join(' ');},remove:(...names)=>{this.className=this.className.split(/\s+/).filter(name=>!names.includes(name)).join(' ');},toggle:(name,on)=>{const selected=on??!this.classList.contains(name);selected?this.classList.add(name):this.classList.remove(name);return selected;}};
  }
  setAttribute(key,value){value=String(value);this.attrs.set(key,value);if(['id','type','name','href','src'].includes(key))this[key]=value;if(key==='class')this.className=value;if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=value;if(['hidden','disabled','checked'].includes(key))this[key]=true;}
  getAttribute(key){return this.attrs.get(key)??null;}
  removeAttribute(key){this.attrs.delete(key);if(key==='src')delete this.src;}
  append(...children){for(const child of children){this.children.push(child);child.parentNode=this;}}
  appendChild(child){this.append(child);return child;}
  replaceChildren(...children){this.children.forEach(child=>child.parentNode=null);this.children=[];this._text='';this.append(...children);}
  set textContent(value){this.replaceChildren();this._text=String(value??'');}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set innerHTML(value){this.replaceChildren();for(const child of parseFragment(value).childNodes)this.append(convert(child));}
  get isConnected(){return this===document.body||!!this.parentNode?.isConnected;}
  matches(selector){
   if(selector.startsWith('#'))return this.id===selector.slice(1);
   if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));
   const attribute=selector.match(/^(\w+)?\[([^=\]]+)(?:="([^"]*)")?\]$/);
   if(attribute)return (!attribute[1]||this.tagName===attribute[1].toUpperCase())&&(attribute[3]===undefined?this.attrs.has(attribute[2]):this.getAttribute(attribute[2])===attribute[3]);
   return this.tagName===selector.toUpperCase();
  }
  closest(selector){return this.matches(selector)?this:this.parentNode?.closest(selector)||null;}
  querySelectorAll(selector){const matches=node=>selector.split(',').some(part=>{const pieces=part.trim().split(/\s+/);if(!node.matches(pieces.at(-1)))return false;let parent=node.parentNode;for(let i=pieces.length-2;i>=0;i--){while(parent&&!parent.matches(pieces[i]))parent=parent.parentNode;if(!parent)return false;parent=parent.parentNode;}return true;});return walk(this).slice(1).filter(matches);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  contains(node){return walk(this).includes(node);}
  focus(){document.activeElement=this;}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}
  addEventListener(name,callback){this.events.set(name,callback);}
  scrollIntoView(){}
 }
 const walk=node=>[node,...node.children.flatMap(walk)];
 function convert(astNode){const node=new Element(astNode.tagName||'#text');for(const attr of astNode.attrs||[])node.setAttribute(attr.name,attr.value);if(astNode.nodeName==='#text')node._text=astNode.value;for(const child of astNode.childNodes||[])node.append(convert(child));if(node.tagName==='SELECT')node.value=node.children.find(child=>child.tagName==='OPTION')?.getAttribute('value')||'';return node;}
 const tree=parse(html),bodyAst=tree.childNodes.find(node=>node.tagName==='html').childNodes.find(node=>node.tagName==='body'),body=convert(bodyAst);
 document={body,activeElement:body,createElement:tag=>new Element(tag),getElementById:id=>walk(body).find(node=>node.id===id)||null,querySelectorAll:selector=>body.querySelectorAll(selector),querySelector:selector=>body.querySelector(selector),addEventListener(){}};
 const sdk={getSession:async()=>({data:{session}}),signOut:async()=>{session=null;listener?.('SIGNED_OUT',null);return {};},signInWithPassword:async({email})=>{session={access_token:email.startsWith('b@')?'fixture-b':'fixture-a'};return {};},refreshSession:async()=>({data:{session}}),onAuthStateChange:callback=>{listener=callback;return {};}};
 const comments=[{id:'301',nickname:'<img src=x onerror=1>',content:'안전한 원본 댓글 <svg onload=1>',created_at:'2026-10-31T00:00:00Z',likes_count:0},{id:'302',parent_id:'301',nickname:'답글 독자',content:'기존 답글',created_at:'2026-10-31T00:00:00Z',likes_count:0}];
 context={document,URL,URLSearchParams,Blob,Response,AbortSignal,TextEncoder,Uint8Array,console:{log(){},warn(){},error(){}},location:{origin:'https://app.test',search:'',pathname:'/home'},crypto:{randomUUID:()=>`3d80dc4b-0aa0-4e41-8da2-${String(++serial).padStart(12,'0')}`,subtle:crypto.subtle},
  supabaseClient:{auth:sdk},initSupabaseAdmin:()=>true,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  setTimeout:callback=>{timers.push(callback);return timers.length;},clearTimeout(){},WEBNOVELS_CONFIG:{readerServiceEnabled:true,readerDiscoveryEnabled:true,authorPublishEnabled:true,publicBetaEnabled:false},
  ReaderPreferencesManager:{reset(){},syncRemote(){}},getWorkCover:work=>work.coverUrl||'/cover.webp',openReaderDirect:(...args)=>opens.push(args),showToast(){},activeWork:null,
  fetch:async(path,options={})=>{const url=new URL(path,'https://app.test'),who=options.headers?.Authorization==='Bearer fixture-a'?'a':options.headers?.Authorization==='Bearer fixture-b'?'b':null,call={path,url,who,method:options.method||'GET',payload:options.body?JSON.parse(options.body):null,credentials:options.credentials};calls.push(call);
   const custom=handler(call);if(custom!==undefined)return custom;
   if(url.pathname==='/api/v2/me')return Response.json(actor(who));
   if(url.pathname==='/api/v2/reader/hub')return Response.json(call.method==='POST'?{saved:true}:url.searchParams.get('action')==='comments'?{comments,versionId:'11111111-1111-4111-8111-111111111111'}:activity(who));
   if(url.pathname==='/api/v2/support')return Response.json(url.searchParams.get('action')==='list'?{items:[caseRow(who)],nextOffset:null}:caseDetail(who));
   if(url.pathname==='/api/v2/catalog'){const id=url.searchParams.get('workId'),work={id,title:'공개 작품 '+id,author:'공개 작가',author_id:'9007199254740993',genre:['로맨스'],content_type:'NOVEL',rating:'ALL',status:'PUBLISHED',episode_count:2,cover_image:'/covers/'+id+'.webp'};return Response.json(url.searchParams.get('action')==='work'?{work}:{episode:{id:'105',work_id:id,episode_number:5,title:'공개 5화',is_free:true},previous:null,next:null});}
   assert.fail('Unexpected offline fixture request '+url.pathname);
  }};
 context.window=context;vm.createContext(context);for(const [name,source] of [['auth-session',auth],['reader-hub',hub],['reader-position',position],['reader-catalog',catalog],['continue-reading',continuation],['beta-support',support]])vm.runInContext(source,context,{filename:name+'.js'});
 vm.runInContext(readerFunctions,context,{filename:'real reader comment functions'});
 return {c:context,document,calls,opens,storage,get:document.getElementById,all:()=>walk(body),async init(){await context.WebNovelsAuth.init();},async loginB(){await context.WebNovelsAuth.login('b@example.test','fixture-password');},event(event,who){if(who)session={access_token:'fixture-'+who};listener(event,who?{user:{id:'account-'+who}}:null);},async flushTimers(){while(timers.length)await timers.shift()();await ticks();},setReading(){const token=context.ReaderSession.begin('9007199254740993',5);token.episode={id:'105',episodeNumber:5};token.versionId='11111111-1111-4111-8111-111111111111';context.activeWork={id:token.workId,episodes:[token.episode]};context._currentReadingWorkId=token.workId;context._currentReadingEpNum=5;return token;}};
}

test('actual Auth logout/login clears reader and support modules and rejects late account-A reads before same-name account B renders',async()=>{
 const activityGate=gate(),detailGate=gate();let delay=false;
 const app=fixture(call=>delay&&call.who==='a'&&call.path.includes('action=activity')?activityGate.promise:delay&&call.who==='a'&&call.path.includes('action=detail')?detailGate.promise:undefined);await app.init();
 await app.c.ReaderLibrary.render();await app.c.ContinueReading.render();const session=app.setReading();app.get('readerBody').textContent='회차 본문';
 const root=app.get('betaSupportContent');await app.c.BetaSupport.render(root);delay=true;const oldDetail=button(root,'문의-a').onclick(),oldLibrary=app.c.ReaderLibrary.render();await ticks();
 await app.c.WebNovelsAuth.logout();assert.equal(root.children.length,0);assert.equal(app.get('readerBody').textContent,'');assert.equal(app.get('libraryContinueList').children.length,0);assert.equal(app.get('sectionContinueReading').style.display,'none');assert.equal(app.c.ReaderSession.valid(session),false);assert.equal(app.c.ReaderHub.cached,null);
 await app.loginB();await app.c.ReaderLibrary.render();activityGate.resolve(Response.json(activity('a')));detailGate.resolve(Response.json(caseDetail('a')));await Promise.all([oldDetail,oldLibrary]);
 assert.equal(app.c.WebNovelsAuth.getActor().userId,'account-b');assert.match(text(app.get('libraryContinueList')),/공개 작품 20/);assert.doesNotMatch(text(app.get('libraryContinueList')),/공개 작품 10/);assert.match(text(app.get('libraryCreatorsList')||app.get('libraryAuthorsList')),/구독 작가-b/);assert.equal(root.children.length,0);assert.equal(app.calls.filter(call=>call.method==='POST').length,0);
});

test('actual Auth client and support form retain one B retry receipt while an earlier A write completes after account change',async()=>{
 const oldWrite=gate(),newWrite=gate();let bWrites=0;
 const app=fixture(call=>call.url.pathname==='/api/v2/support'&&call.method==='POST'?(call.who==='a'?oldWrite.promise:++bWrites===1?newWrite.promise:Response.json({...caseDetail('b'),replayed:true})):undefined);await app.init();
 const root=app.get('betaSupportContent');await app.c.BetaSupport.render(root);button(root,'새 문의').onclick();const oldForm=root.querySelector('form');field(oldForm,'title').value='이전 계정 문의';field(oldForm,'message').value='계정 A의 미전송 내용';const savingA=submit(oldForm);await ticks();
 await app.c.WebNovelsAuth.logout();assert.equal(field(oldForm,'message').value,'');await app.loginB();await app.c.BetaSupport.render(root);button(root,'새 문의').onclick();const form=root.querySelector('form');field(form,'title').value='현재 계정 문의';field(form,'message').value='계정 B의 문의 내용';const savingB=submit(form);await ticks();
 oldWrite.resolve(Response.json(caseDetail('a')));await savingA;assert.equal(form.getAttribute('aria-busy'),'true');assert.equal(button(form,'문의 접수').disabled,true);newWrite.reject(new TypeError('offline'));await savingB;
 const writes=app.calls.filter(call=>call.method==='POST');assert.equal(writes.length,2);assert.notEqual(writes[0].payload.requestId,writes[1].payload.requestId);assert.deepEqual(writes.map(call=>call.who),['a','b']);
 await button(form,'같은 요청 다시 보내기').onclick();const retried=app.calls.filter(call=>call.method==='POST');assert.equal(retried.length,3);assert.deepEqual(retried[1].payload,retried[2].payload);assert.equal(retried[2].who,'b');assert.match(text(root),new RegExp(caseId('b')));assert.doesNotMatch(text(root),/비공개 문의-a/);
});

test('real SDK same-user sign-in preserves unsent support fields; a different user clears them before deferred validation',async()=>{
 const app=fixture();await app.init();const root=app.get('betaSupportContent');await app.c.BetaSupport.render(root);button(root,'새 문의').onclick();const form=root.querySelector('form');field(form,'title').value='작성 중 문의';field(form,'message').value='유지할 비공개 입력';
 app.event('SIGNED_IN','a');assert.equal(field(form,'message').value,'유지할 비공개 입력');assert.equal(root.querySelector('form'),form);await app.flushTimers();assert.equal(root.querySelector('form'),form);
 app.event('SIGNED_IN','b');assert.equal(field(form,'message').value,'');assert.equal(root.children.length,0);assert.equal(app.c.WebNovelsAuth.getActor(),null);await app.flushTimers();assert.equal(app.c.WebNovelsAuth.getActor().userId,'account-b');assert.equal(root.children.length,0);
});

test('real runtime comments mounted into shipped HTML have one labelled composer and submit the field the reader actually typed',async()=>{
 const app=fixture();await app.init();app.setReading();await app.c.loadEpisodeComments('9007199254740993','105');
 const composers=app.all().filter(node=>node.id==='readerCommentInput');assert.equal(composers.length,1,'static and dynamic composers must not shadow each other');const input=composers[0];assert.equal(input.tagName,'TEXTAREA');assert(app.document.querySelector('label[for="readerCommentInput"]'));
 assert.equal(app.all().filter(node=>node.id==='btnSubmitComment').length,1);const ids=app.all().map(node=>node.id).filter(Boolean);assert.equal(ids.length,new Set(ids).size,'runtime comments must not add duplicate IDs');
 const list=app.get('readerCommentsList');assert.equal(list.querySelectorAll('svg,img').length,0);assert.match(text(list),/<img src=x onerror=1>/);
 input.value='실제 화면에서 작성한 댓글';await vm.runInContext(app.get('btnSubmitComment').getAttribute('onclick'),app.c);await ticks();
 const sent=app.calls.find(call=>call.method==='POST'&&call.url.searchParams.get('action')==='comment');assert(sent,'the visible composer must dispatch its own text');assert.equal(sent.payload.content,'실제 화면에서 작성한 댓글');assert.equal(sent.url.searchParams.get('workId'),'9007199254740993');assert.equal(sent.url.searchParams.get('episodeId'),'105');
});

test('runtime reply fields remain distinct from the episode composer and late account changes cannot submit a stale comment',async()=>{
 const app=fixture();await app.init();app.setReading();await app.c.loadEpisodeComments('9007199254740993','105');app.get('readerCommentInput').value='보내지 않은 회차 댓글';const reply=app.get('replyText-301');assert(app.document.querySelector('label[for="replyText-301"]'));reply.value='답글 입력창의 내용';
 await app.c.handleReaderReplySubmit('9007199254740993','105','301');const posts=app.calls.filter(call=>call.method==='POST');assert.equal(posts.length,1);assert.equal(posts[0].payload.content,'답글 입력창의 내용');assert.equal(posts[0].payload.parentId,'301');
 await app.c.WebNovelsAuth.logout();await app.c.handleReaderCommentSubmit('9007199254740993','105');await app.c.handleReaderReplySubmit('9007199254740993','105','301');assert.equal(app.calls.filter(call=>call.method==='POST').length,1);
});

test('actual work management offers only authorized current-session navigation to the existing publication review queue',async()=>{
 const app=fixture(),requests=[],navigations=[];let current=true,who={userId:'review-admin',admin:{role:'SUB_ADMIN',is_active:true,permissions:['CONTENT_METADATA_READ','CONTENT_REVIEW']}};
 app.c.WEBNOVELS_CONFIG.adminWorkflowEnabled=true;
 app.c.WebNovelsAuth={getActor:()=>who,api:async(path,options)=>{assert.equal(options,undefined,'opening the review queue must not write');requests.push(new URL(path,'https://app.test'));return {works:[]};}};
 app.c.AdminOperations={navigate:page=>navigations.push(page)};vm.runInContext(workflow,app.c,{filename:'admin-workflow.js'});
 const root=app.get('adminOperationsContent');await app.c.AdminWorkflow.render(root,'works',{isCurrent:()=>current});
 const entry=button(root,'공개본 변경 검토 열기');assert(entry);assert.match(text(root),/신규 회차의 최초 발행은 작가가 직접/);entry.onclick();assert.deepEqual(navigations,['cases']);assert.equal(requests[0].searchParams.get('action'),'work-list');
 who={...who,admin:{...who.admin,permissions:['CONTENT_METADATA_READ']}};entry.onclick();assert.deepEqual(navigations,['cases']);
 await app.c.AdminWorkflow.render(root,'works',{isCurrent:()=>current});assert.equal(button(root,'공개본 변경 검토 열기'),undefined);
 who={...who,admin:{...who.admin,permissions:['CONTENT_METADATA_READ','CONTENT_REVIEW']}};entry.onclick();assert.deepEqual(navigations,['cases'],'superseded work view cannot navigate');
 await app.c.AdminWorkflow.render(root,'works',{isCurrent:()=>current});const latest=button(root,'공개본 변경 검토 열기');current=false;latest.onclick();assert.deepEqual(navigations,['cases']);current=true;who={...who,userId:'another-admin'};latest.onclick();assert.deepEqual(navigations,['cases']);
 app.c.AdminWorkflow.reset();latest.onclick();assert.deepEqual(navigations,['cases']);assert(requests.every(request=>request.pathname==='/api/v2/admin/workflow'&&request.searchParams.get('action')==='work-list'));
});
