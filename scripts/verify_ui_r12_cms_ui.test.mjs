import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {parseFragment} from 'parse5';

const source=await readFile(new URL('../public/js/creator/creator-operations.js',import.meta.url),'utf8');
const worksSource=await readFile(new URL('../public/js/creator/creator-works.js',import.meta.url),'utf8');
const wid='9007199254740993',eid='9007199254740995';
const row=(extra={})=>({id:eid,episode_number:1,title:'발행한 회차',status:'PUBLISHED',has_head:true,member_read_count:'9007199254740997',published_at:'2026-11-01T01:00:00Z',schedule_status:null,...extra});
const episode=(extra={})=>({...row(),workId:wid,contentType:'NOVEL',versionId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',content:'발행한 본문',authorComment:'발행한 작가의 말',...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(responses=[{episodes:[row()]}]){
  class Element{
    constructor(tagName='div',attrs={}){this.tagName=tagName;this.attrs=new Map(Object.entries(attrs));this.childNodes=[];this.dataset={};this.style={};this.isConnected=true;this.hidden=Object.hasOwn(attrs,'hidden');this.disabled=Object.hasOwn(attrs,'disabled');this.value=attrs.value||'';for(const[key,value]of Object.entries(attrs))this.setAttribute(key,value);}
    setAttribute(key,value){this.attrs.set(key,String(value));if(key==='class')this.className=String(value);if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}
    getAttribute(key){return this.attrs.get(key)??null;}
    get textContent(){return this.ownText!==undefined?this.ownText:this.childNodes.map(child=>child.textContent).join('');}
    set textContent(value){this.ownText=String(value);this.childNodes=[];}
    append(...nodes){if(this.ownText!==undefined){if(this.ownText)this.childNodes.push(new Element('#text'));if(this.childNodes.length)this.childNodes[0].textContent=this.ownText;delete this.ownText;}for(const node of nodes){this.childNodes.push(node);node.parentNode=this;}}
    replaceChildren(...nodes){delete this.ownText;this.childNodes=[];this.append(...nodes);}
    set innerHTML(html){this.html=html;this.replaceChildren();const convert=parsed=>{const element=new Element(parsed.tagName||'#text',Object.fromEntries((parsed.attrs||[]).map(a=>[a.name,a.value])));if(parsed.nodeName==='#text')element.textContent=parsed.value;else element.append(...(parsed.childNodes||[]).map(convert));if(element.tagName==='select')element.value=element.querySelector('option')?.getAttribute('value')||'';return element;};this.append(...parseFragment(html).childNodes.map(convert));}
    get innerHTML(){return this.html||'';}
    querySelectorAll(selector){const all=[];const matches=node=>selector[0]==='#'?node.getAttribute('id')===selector.slice(1):selector[0]==='.'?String(node.className||'').split(' ').includes(selector.slice(1)):selector[0]==='['?node.getAttribute(selector.slice(1,-1))!==null:node.tagName===selector;const walk=node=>{for(const child of node.childNodes){if(matches(child))all.push(child);walk(child);}};walk(this);return all;}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    focus(){this.focused=true;}
    scrollIntoView(){this.scrolled=true;}
  }
  let actor={userId:'verified-author-a',author:{id:'70',status:'APPROVED'}};
  const root=new Element(),calls=[],rendered=[],toons=[],opened=[],publications=[];
  const context={URLSearchParams,crypto:{randomUUID},location:{pathname:'/creator/works/'+wid},WEBNOVELS_CONFIG:{authorOperationsEnabled:true},
    document:{createElement:tag=>new Element(tag),getElementById:id=>root.querySelector('#'+id)},
    WebNovelsAuth:{getActor:()=>actor,api:async(path,options)=>{calls.push({path,options});const value=responses.shift();if(value instanceof Error)throw value;return await value;}},
    ReaderContent:{render:(body,comment,snapshot)=>{rendered.push(snapshot);body.textContent=snapshot.content;comment.textContent=snapshot.authorComment;}},
    ReaderWebtoon:{formatCredits:()=> '글 작가: 크레딧',render:(body,panels,options)=>{const state={panels,options,disposed:false};toons.push(state);body.textContent='발행한 그림';return()=>{state.disposed=true;};}},
    CreatorPublications:{open:async(...args)=>publications.push(args)},CreatorDraftEditor:{openWork:async(...args)=>opened.push(args)},confirm:()=>true};
  context.window=context;vm.createContext(context);vm.runInContext(source,context);
  return {root,calls,rendered,toons,opened,publications,responses,context,setActor:value=>actor=value,ui:context.CreatorOperations};
}

test('episode CMS is a semantic table with exact large counts, dates, accessible title actions and no invented count on absent data',async()=>{
  const app=fixture([{episodes:[row({title:'<script>악성 제목</script>'}),row({id:'2',episode_number:2,status:'DRAFT',has_head:false,member_read_count:null,published_at:null})]}]);
  await app.ui.episodes(app.root,wid);assert.equal(app.calls[0].path,'/api/v2/creator/works/'+wid+'/episodes');
  const table=app.root.querySelector('table');assert.equal(table.getAttribute('aria-describedby'),'coEpisodeMetricHelp');assert.equal(table.querySelectorAll('th').length,5);
  const rows=app.root.querySelector('#coEpisodeRows').childNodes;assert.equal(rows.length,2);assert.match(rows[0].textContent,/9,007,199,254,740,997/);assert.match(rows[0].textContent,/2026/);
  assert.match(rows[1].textContent,/확인 필요/);assert.match(rows[1].textContent,/발행 기록 없음/);assert.equal(app.root.querySelectorAll('script').length,0);
  assert.match(rows[0].querySelector('button').getAttribute('aria-label'),/발행한 본문 보기/);assert.match(app.root.querySelector('#coEpisodeMetricHelp').textContent,/비회원 열람은 포함하지 않습니다/);
});

test('clicking a novel episode reads the published snapshot and Word document without creating or loading any editing draft',async()=>{
  const document={version:1,paragraphs:[{align:'center',indent:0,runs:[{text:'발행한 본문',bold:true}]}]};
  const app=fixture([{episodes:[row()]},{episode:episode({contentDocument:document})}]);await app.ui.episodes(app.root,wid);
  const opener=app.root.querySelector('.studio-episode-title');await opener.onclick();
  assert.equal(app.calls[1].path,'/api/v2/creator/works/'+wid+'/episodes/'+eid);assert.deepEqual(app.rendered,[episode({contentDocument:document})]);assert.deepEqual(app.opened,[]);assert.deepEqual(app.publications,[]);
  assert.equal(app.root.querySelector('#coPublishedPreview').hidden,false);assert.equal(app.root.querySelector('#coPublishedPreview').focused,true);assert.match(app.root.querySelector('#coPublishedMeta').textContent,/읽기 전용/);
  app.root.querySelector('#coPublishedClose').onclick();assert.equal(app.root.querySelector('#coPublishedPreview').hidden,true);assert.equal(opener.focused,true);
});

test('webtoon read uses frozen panel order and authenticated owner image endpoint, and closes/disposes on reset',async()=>{
  const panels=[{id:'panel-2',assetId:'asset-2',width:800,height:1000},{id:'panel-1',assetId:'asset-1',width:800,height:1000}];
  const app=fixture([{episodes:[row()]},{episode:episode({contentType:'WEBTOON',content:'',webtoon:{schemaVersion:1,panels,credits:{writer:'크레딧'}}})},new Blob(['image'])]);
  await app.ui.episodes(app.root,wid);await app.root.querySelector('.studio-episode-title').onclick();assert.deepEqual(app.toons[0].panels,panels);
  const signal=new AbortController().signal;await app.toons[0].options.load(panels[0],'png',signal);
  assert.equal(app.calls[2].path,'/api/v2/creator/webtoon/panel/asset-2?workId='+wid+'&panelId=panel-2&format=png');assert.equal(app.calls[2].options.responseType,'blob');assert.equal(app.calls[2].options.signal,signal);
  app.ui.reset();assert.equal(app.toons[0].disposed,true);assert.equal(app.toons[0].options.valid(),false);
});

test('a delayed published response cannot cross account changes, newer selection, reset or revoked author status',async()=>{
  for(const change of [app=>app.setActor({userId:'different-author',author:{id:'70',status:'APPROVED'}}),app=>app.ui.reset(),app=>app.setActor({userId:'verified-author-a',author:{id:'70',status:'SUSPENDED'}})]){
    const waiting=deferred(),app=fixture([{episodes:[row()]},waiting.promise]);await app.ui.episodes(app.root,wid);const opening=app.root.querySelector('.studio-episode-title').onclick();change(app);waiting.resolve({episode:episode()});await opening;
    assert.deepEqual(app.rendered,[]);assert.equal(app.root.querySelector('#coPublishedPreview').hidden,true);
  }
  const old=deferred(),app=fixture([{episodes:[row(),row({id:'2',episode_number:2})]},old.promise,{episode:episode({id:'2',episode_number:2,content:'두 번째 발행본'})}]);
  await app.ui.episodes(app.root,wid);const titles=app.root.querySelectorAll('.studio-episode-title'),first=titles[0].onclick();await titles[1].onclick();old.resolve({episode:episode()});await first;
  assert.equal(app.rendered.length,1);assert.equal(app.rendered[0].id,'2');assert.match(app.root.querySelector('#coPublishedBody').textContent,/두 번째/);
});

test('editing is an explicit separate POST, prevents duplicate clicks and retains the same request identity after lost response',async()=>{
  const waiting=deferred(),app=fixture([{episodes:[row()]},waiting.promise,{draft:{id:'verified-draft-id',workId:wid}}]);await app.ui.episodes(app.root,wid);
  const edit=app.root.querySelector('#coEpisodeRows').childNodes[0].querySelectorAll('button').find(button=>button.textContent==='수정 원고 작성');
  const first=edit.onclick();await edit.onclick();assert.equal(app.calls.length,2);waiting.reject(Error('NETWORK_UNAVAILABLE'));await first;assert.equal(edit.disabled,false);
  await edit.onclick();assert.equal(app.calls[1].options.body,app.calls[2].options.body);assert.equal(app.calls[1].options.headers['Idempotency-Key'],app.calls[2].options.headers['Idempotency-Key']);assert.equal(app.calls[2].options.method,'POST');assert.deepEqual(app.opened,[[wid,'verified-draft-id']]);
  assert.match(app.root.querySelector('#coEpisodeMessage').textContent,/승인 전까지 발행본은 유지됩니다/);assert.ok(!app.calls.some(call=>/publications\/publish/.test(call.path)));
});

test('all episodes stay searchable while only 50 rows render, navigation is bounded and filters reset page',async()=>{
  const entries=Array.from({length:121},(_,i)=>row({id:String(i+1),episode_number:i+1,title:i===120?'마지막 회차':'연재'})),app=fixture([{episodes:entries}]);await app.ui.episodes(app.root,wid);
  const rows=()=>app.root.querySelector('#coEpisodeRows').childNodes;assert.equal(rows().length,50);assert.equal(app.root.querySelector('#coEpisodePrevious').disabled,true);
  app.root.querySelector('#coEpisodeNext').onclick();assert.equal(rows()[0].querySelector('button').textContent,'51화 · 연재');app.root.querySelector('#coEpisodeNext').onclick();assert.equal(rows().length,21);assert.equal(app.root.querySelector('#coEpisodeNext').disabled,true);
  app.root.querySelector('#coEpisodeSearch').value='마지막';app.root.querySelector('#coEpisodeSearch').oninput();assert.equal(rows().length,1);assert.match(rows()[0].textContent,/121화/);assert.match(app.root.querySelector('#coEpisodePage').textContent,/1회차 · 1 \/ 1/);
});

test('load errors remain retryable errors rather than false empty success, and published errors keep private content hidden',async()=>{
  const failed=fixture([Error('DATABASE_UNAVAILABLE')]);await failed.ui.episodes(failed.root,wid);assert.match(failed.root.textContent,/회차를 불러오지 못했습니다/);assert.doesNotMatch(failed.root.textContent,/해당 회차가 없습니다/);
  const app=fixture([{episodes:[row()]},Error('PUBLICATION_NOT_FOUND')]);await app.ui.episodes(app.root,wid);await app.root.querySelector('.studio-episode-title').onclick();assert.equal(app.root.querySelector('#coPublishedPreview').hidden,true);assert.match(app.root.querySelector('#coEpisodeMessage').textContent,/발행본을 불러오지 못했습니다/);
});

test('work title enters the management workspace while draft and settings stay distinct controls',()=>{
  const context={window:null,location:{pathname:'/creator/works'},document:{getElementById:()=>null},WebNovelsAuth:{getActor:()=>({userId:'a',author:{id:'7',status:'APPROVED'}})}};context.window=context;vm.createContext(context);vm.runInContext(worksSource,context);
  const card=context.CreatorWorks.renderCard({id:wid,title:'<작품>',content_type:'WEBTOON',moderation_state:'CLEAR',episode_count:2});const parsed=parseFragment(card);let button;
  const walk=node=>{if(node.tagName==='button'&&node.attrs.some(a=>a.name==='data-open-work-id'))button=node;for(const child of node.childNodes||[])walk(child);};walk(parsed);
  assert.equal(button.attrs.find(a=>a.name==='data-open-work-id').value,wid);assert.match(card,/회차와 열람수 관리/);assert.match(card,/data-write-work-id/);assert.match(card,/data-work-id/);assert.ok(!card.includes('<작품>'));
});
