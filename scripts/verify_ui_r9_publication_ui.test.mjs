import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/js/creator/creator-publications.js',import.meta.url),'utf8');
const receipt='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',copy=value=>JSON.parse(JSON.stringify(value));
const gate=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};

function fixture(options={}){
 const {review=true,webtoon=false,publishError=null,pending=null}=options;
 const changeId=Object.prototype.hasOwnProperty.call(options,'changeId')?options.changeId:receipt;
 const nodes=new Map(),calls=[],routes=[],closed=[],saved=new Map();let serial=0,marks=0;
 let who={userId:'author-a',author:{id:'9007199254740993',status:'APPROVED'}};
 const element=(tag='div')=>({tagName:tag.toUpperCase(),hidden:false,disabled:false,value:'',children:[],_text:'',classList:{add(){},remove(){}},
  replaceChildren(...children){this.children=children;this._text='';},append(...children){this.children.push(...children);},
  set textContent(value){this._text=String(value);this.children=[];},get textContent(){return this._text+this.children.map(child=>child.textContent).join('');},
  set innerHTML(value){if(this===nodes.get('publicationMessage'))assert.fail('Review data must remain inert text');this.replaceChildren();this._text=String(value);},
  setAttribute(name,value){this[name]=String(value);},focus(){},scrollIntoView(){}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const radios=['NOW','SCHEDULED'].map(value=>{const radio=element('input');radio.value=value;return radio;});
 for(const radio of radios){let checked=radio.value==='NOW';Object.defineProperty(radio,'checked',{get:()=>checked,set:value=>{checked=!!value;if(checked)for(const other of radios)if(other!==radio)other.checked=false;}});}
 const draft={userId:'author-a',workId:'10',id:'11111111-2222-4333-8444-555555555555',revision:'3',seq:7,
  episodeId:review?'700':null,hasPublicationHistory:review,snapshot:{title:'수정한 원고',content:'안전한 후보 본문',authorComment:'작가의 말',
   ...(webtoon?{webtoon:{assetIds:['asset-a'],credits:{writer:'작가'}}}:{})}};
 const c={URL,Date,console,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`},
  document:{readyState:'complete',getElementById:get,createElement:element,querySelectorAll:()=>radios,
   querySelector:selector=>selector.includes(':checked')?radios.find(r=>r.checked):radios.find(r=>r.value===(selector.includes('SCHEDULED')?'SCHEDULED':'NOW')),addEventListener(){}},
  sessionStorage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)},
  WEBNOVELS_CONFIG:{authorPublishEnabled:true,webtoonServiceEnabled:true},
  openModal:id=>{get(id).hidden=false;},closeModal:id=>{closed.push(id);get(id).hidden=true;},navigateTo:path=>routes.push(path),
  ReaderContent:{render(root,comment,value){root.textContent=value.content;comment.textContent=value.authorComment;}},
  ReaderWebtoon:{destroy(){}},CreatorWebtoon:{renderPreview:async root=>{root.textContent='안전한 웹툰 미리보기';}},
  CreatorReadiness:{publicationItems:()=>[],render:()=>''},
  CreatorDraftEditor:{getFileContext:()=>copy(draft),preparePublication:async()=>copy(draft),
   getUiState:()=>({hasDraft:true,readOnly:false,conflict:false,composing:false,pendingImages:false,editingPublished:review}),
   markPublished:async()=>{marks++;},refreshPublicationState:async()=>{marks++;}},
  WebNovelsAuth:{getActor:()=>who,api:async(path,options)=>{
   calls.push({path,options});
   if(path.startsWith('/api/v2/creator/works/'))return {work:{id:'10',title:'내 작품',rating:'ALL',ai_usage_type:'GENERATED',description:'소개',publication_missing:[]},episodes:review?[{id:'700',episode_number:1}]:[]};
   if(path.includes('/suggest'))return {episodeNumber:1};
   if(path.includes('/publish/')){if(pending)return pending.promise;if(publishError)throw publishError;return {reviewRequired:true,...(changeId===undefined?{}:{changeId})};}
   if(path.startsWith('/api/v2/creator/publications'))return {publications:[]};
   throw Error('Unexpected fixture endpoint');
  }}};
 c.window=c;vm.createContext(c);vm.runInContext(source,c,{filename:'creator-publications.js'});
 return {c,get,calls,routes,closed,radios,marks:()=>marks,setActor:value=>{who=value;},
  async submit(){get('publicationRights').checked=true;await get('publicationCommit').onclick();},
  link:()=>get('publicationMessage').children.find(child=>child.tagName==='A')};
}

function clickEvent(extra={}){return {defaultPrevented:false,button:0,preventDefault(){this.defaultPrevented=true;},...extra};}

for(const webtoon of [false,true])test(`${webtoon?'webtoon':'novel'} review receipt links to its owner settings without pretending the candidate was published`,async()=>{
 const f=fixture({webtoon});await f.c.CreatorPublications.open('10');await f.submit();
 assert.match(f.get('publicationMessage').textContent,/승인 전까지 기존 공개본이 유지/);assert.match(f.get('publicationMessage').textContent,new RegExp(receipt));
 const link=f.link();assert.equal(link.textContent,'검토 현황 확인');assert.equal(link.href,'/creator/works/10/settings');
 assert.equal(f.get('publicationDraftPanel').hidden,true);assert.equal(f.marks(),0);
 const submitted=f.calls.find(call=>call.path.includes('/publish/'));assert.deepEqual(JSON.parse(submitted.options.body),{revision:'3',episodeNumber:1,mode:'NOW',rightsConfirmed:true});
 assert.equal(f.calls.some(call=>call.path.includes('/admin/')),false);
 const event=clickEvent();assert.equal(link.onclick(event),false);assert.equal(event.defaultPrevented,true);assert.deepEqual(f.routes,['/creator/works/10/settings']);assert.deepEqual(f.closed,['modalCreatorPublication']);
});

test('missing or malformed review receipt keeps a usable inert link and no account identifiers',async()=>{
 for(const changeId of [undefined,null,42,'<img src=x onerror=alert(1)>']){
  const f=fixture({changeId});await f.c.CreatorPublications.open('10');await f.submit();assert(f.link());assert.match(f.get('publicationMessage').textContent,/검토 현황 확인/);
  assert.doesNotMatch(f.get('publicationMessage').textContent,/author-a|9007199254740993|<img|요청 번호/);assert.equal(f.marks(),0);
 }
});

test('modified and middle clicks retain native new-tab behavior for the current author',async()=>{
 const f=fixture();await f.c.CreatorPublications.open('10');await f.submit();
 for(const extra of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true}]){const event=clickEvent(extra);assert.equal(f.link().onclick(event),undefined);assert.equal(event.defaultPrevented,false);}
 const middle=clickEvent({button:1});assert.equal(f.link().onauxclick(middle),undefined);assert.equal(middle.defaultPrevented,false);
 assert.deepEqual(f.routes,[]);assert.deepEqual(f.closed,[]);
});

test('stale author, revoked author and reset callbacks cannot navigate or open the old link in another tab',async()=>{
 for(const change of ['account','role','reset']){
  const f=fixture();await f.c.CreatorPublications.open('10');await f.submit();const link=f.link();
  if(change==='account')f.setActor({userId:'another-author',author:{id:'200',status:'APPROVED'}});
  if(change==='role')f.setActor({userId:'author-a',author:{id:'9007199254740993',status:'SUSPENDED'}});
  if(change==='reset')f.c.CreatorPublications.reset();
  const event=clickEvent({ctrlKey:true});assert.equal(link.onclick(event),false);assert.equal(event.defaultPrevented,true);assert.deepEqual(f.routes,[]);
  const middle=clickEvent({button:1});assert.equal(link.onauxclick(middle),false);assert.equal(middle.defaultPrevented,true);
 }
});

test('reopening a preview clears the old receipt and invalidates its saved click handler',async()=>{
 const f=fixture();await f.c.CreatorPublications.open('10');await f.submit();const link=f.link();await f.c.CreatorPublications.open('10',{preview:true});assert.equal(f.link(),undefined);
 const event=clickEvent();assert.equal(link.onclick(event),false);assert.equal(event.defaultPrevented,true);assert.deepEqual(f.routes,[]);
});

test('late review responses after account reset do not render a receipt or mark a draft published',async()=>{
 const pending=gate(),f=fixture({pending});await f.c.CreatorPublications.open('10');const submitting=f.submit();await new Promise(resolve=>setImmediate(resolve));
 f.setActor({userId:'another-author',author:{id:'200',status:'APPROVED'}});f.c.CreatorPublications.reset();pending.resolve({reviewRequired:true,changeId:receipt});await submitting;
 assert.equal(f.link(),undefined);assert.equal(f.get('publicationMessage').textContent,'');assert.equal(f.marks(),0);assert.deepEqual(f.routes,[]);
});

test('server schedule rejection explains the actual time window and selected timezone',async()=>{
 const f=fixture({review:false,publishError:Object.assign(Error('INVALID_SCHEDULE'),{code:'INVALID_SCHEDULE'})});await f.c.CreatorPublications.open('10',{mode:'SCHEDULED'});
 f.get('publicationDueAt').value='2030-01-01T12:00';f.get('publicationTimezone').value='Asia/Seoul';await f.submit();
 assert.match(f.get('publicationMessage').textContent,/2분.*1년.*표시 시간대/);assert.equal(f.link(),undefined);assert.equal(f.marks(),0);
});

test('malformed local schedule gets the same actionable advice before sending a publication',async()=>{
 const f=fixture({review:false});await f.c.CreatorPublications.open('10',{mode:'SCHEDULED'});f.get('publicationDueAt').value='not-a-date';f.get('publicationTimezone').value='Asia/Seoul';await f.submit();
 assert.match(f.get('publicationMessage').textContent,/2분.*1년.*표시 시간대/);assert.equal(f.calls.some(call=>call.path.includes('/publish/')),false);assert.equal(f.marks(),0);
});
