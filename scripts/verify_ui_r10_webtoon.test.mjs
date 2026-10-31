import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/js/creator/creator-webtoon.js',import.meta.url),'utf8');
const renderer=await readFile(new URL('../public/js/reader/reader-webtoon.js',import.meta.url),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
const ready=(id,name=id+'.png')=>({id,name,state:'READY',bytes:100,cursor:1,partCount:1,panels:[{id:'panel-'+id,assetId:id,width:800,height:200}]});
const file=(name,type='image/png',size=100)=>({name,type,size});
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const ticks=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};

async function fixture({initial=[],credits={writer:'',artist:'',original:''},readOnly=false,api}={}){
 const nodes=[],calls=[],edits=[];let account='author-a',serial=0;
 const element=(tag='div')=>{
  const node={tag,tagName:tag.toUpperCase(),children:[],attributes:{},style:{},dataset:{},value:'',hidden:false,disabled:false,_text:'',
   append(...children){this.children.push(...children);},replaceChildren(...children){this.children=[...children];this._text='';},
   setAttribute(key,value){this.attributes[key]=String(value);},getAttribute(key){return this.attributes[key]??null;},
   closest(){return group;},after(child){nodes.push(child);},click(){return this.onclick?.();},focus(){},scrollIntoView(){}};
  Object.defineProperty(node,'textContent',{get(){return this._text+this.children.map(child=>child.textContent).join('');},set(value){this._text=String(value);this.children=[];}});
  Object.defineProperty(node,'innerHTML',{set(){assert.fail('Author metadata, filenames and diagnostics must remain text');}});nodes.push(node);return node;
 };
 const group=element(),draft={userId:account,workId:'10',id:'draft-a',revision:'1',snapshot:{webtoon:{schemaVersion:1,assetIds:initial.filter(a=>a.state==='READY').map(a=>a.id),thumbnailAssetId:initial.find(a=>a.state==='READY')?.id||null,credits:copy(credits)}}};
 const context={AbortSignal,Blob,crypto,setTimeout,clearTimeout,
  URL:{createObjectURL:()=> 'blob:fixture-'+(++serial),revokeObjectURL(){}},
  document:{createElement:element,getElementById:id=>nodes.findLast(node=>node.id===id)||null},
  WEBNOVELS_CONFIG:{webtoonServiceEnabled:true},CreatorPublications:{refreshAvailability(){}},
  CreatorDraftEditor:{getFileContext:()=>copy(draft),editWebtoon:manifest=>{draft.snapshot.webtoon=copy(manifest);edits.push(copy(manifest));}},
  WebNovelsAuth:{getActor:()=>({userId:account}),api:async(path,options)=>{
   calls.push({path,options});if(api)return api(path,options,initial);
   if(path.includes('/upload/'))return {asset:ready(path.split('/upload/')[1].split('?')[0],options.body.name)};
   return {assets:copy(initial)};
  }},ReaderWebtoon:{render(){assert.fail('Upload must not implicitly render a preview');}}};
 context.window=context;vm.createContext(context);const content=element();content.id='newEpContent';vm.runInContext(source,context,{filename:'creator-webtoon.js'});
 const mount=()=>context.CreatorWebtoon.mount({content_type:'WEBTOON'},copy(draft),readOnly);await mount();
 const get=id=>context.document.getElementById(id),list=()=>get('creatorWebtoonList'),row=name=>list().children.find(node=>node.children[0].textContent===name);
 return {context,draft,calls,edits,mount,nodes,get,list,row,message:()=>get('creatorWebtoonMessage').textContent,setAccount:value=>account=value};
}

test('participating authors are optional, individually explained and no credit is inferred from account identity',async()=>{
 const app=await fixture(),details=app.nodes.find(n=>n.tag==='details');
 assert.equal(details.open,false);assert.equal(details.children[0].textContent,'참여 작가 (선택)');assert.match(details.textContent,/같은 필명.*별도 원작이 없는.*비워두세요/);
 for(const [key,label,description]of [['writer','글 작가',/스토리·각색·대본/],['artist','그림 작가',/그림을 그린/],['original','원작 작가',/원작을 쓴/]]){
  const input=app.get('creatorWebtoonCredit-'+key),help=app.get(input.getAttribute('aria-describedby'));
  assert.ok(details.children.find(n=>n.tag==='label'&&n.textContent===label));assert.match(help.textContent,description);
  assert.equal(input.value,'');assert.equal(input.required,undefined);assert.equal(input.maxLength,100);assert.equal(input.disabled,false);
 }
 assert.equal(app.edits.length,0);assert.equal(app.calls.length,1);
});

test('editing one participant preserves existing images, thumbnail, other roles and same-person attribution',async()=>{
 const app=await fixture({initial:[ready('a'),ready('b')],credits:{writer:'기존 글',artist:'기존 그림',original:'원작자'}}),before=copy(app.draft.snapshot.webtoon);
 assert.equal(app.nodes.find(n=>n.tag==='details').open,true);
 const writer=app.get('creatorWebtoonCredit-writer');writer.value='공동 필명';writer.oninput();
 const artist=app.get('creatorWebtoonCredit-artist');artist.value='공동 필명';artist.oninput();
 assert.deepEqual(app.draft.snapshot.webtoon,{...before,credits:{writer:'공동 필명',artist:'공동 필명',original:'원작자'}});
 assert.equal(app.calls.length,1,'metadata editing uses the existing draft snapshot path');
});

test('read-only and stale author controls cannot change the draft manifest',async()=>{
 const locked=await fixture({credits:{writer:'보존',artist:'',original:''},readOnly:true});
 for(const key of ['writer','artist','original'])assert.equal(locked.get('creatorWebtoonCredit-'+key).disabled,true);
 const old=locked.get('creatorWebtoonCredit-writer');old.value='차단';old.oninput();assert.equal(locked.edits.length,0);
 const app=await fixture(),field=app.get('creatorWebtoonCredit-writer');app.setAccount('author-b');field.value='이전 계정';field.oninput();assert.equal(app.edits.length,0);
});

test('public and preview credit formatting projects only nonblank own string roles in a stable order',()=>{
 const context=vm.createContext({});context.window=context;vm.runInContext(renderer,context);const format=context.ReaderWebtoon.formatCredits;
 assert.equal(format({artist:'그림',writer:'  글  ',original:'   ',extra:'비공개 필드'}),'글 작가: 글 · 그림 작가: 그림');
 assert.equal(format({writer:'동일인',artist:'동일인',original:'동일인'}),'글 작가: 동일인 · 그림 작가: 동일인 · 원작 작가: 동일인');
 for(const value of [null,undefined,[],42,{},Object.create({writer:'상속 이름'}),{writer:null,artist:42,original:false}])assert.equal(format(value),'');
 assert.equal(format({writer:'<img src=x onerror=1>',original:''}),'글 작가: <img src=x onerror=1>','formatter returns text; callers use textContent');
});

test('preview and public reader use the shared safe formatter without empty role labels',async()=>{
 for(const path of ['public/js/creator/creator-publications.js','public/js/reader/reader.js']){
  const body=await readFile(new URL('../'+path,import.meta.url),'utf8');
  assert.match(body,/textContent=\[window\.ReaderWebtoon\?\.formatCredits\?\./);assert.doesNotMatch(body,/Object\.entries\((?:context\.snapshot\.webtoon|loadedWebtoon)\.credits/);
 }
});

test('a mixed batch retains rejected and failed counts after a later success without losing error rows',async()=>{
 const invalid=file('잘못된.gif','image/gif'),bad=file('<svg onload=1>.png'),good=file('정상.png');
 const app=await fixture({initial:[ready('existing')],api:async(path,options,initial)=>{
  if(path.includes('/upload/')){if(options.body===bad)throw Object.assign(Error('private detail'),{code:'IMAGE_TYPE_MISMATCH'});return {asset:ready(path.split('/upload/')[1].split('?')[0],options.body.name)};}
  return {assets:copy(initial)};
 }});
 await app.context.CreatorWebtoon.select([invalid,bad,good]);
 assert.match(app.message(),/완료된 파일 1개 · 실패 1개 · 건너뜀 1개/);assert.match(app.message(),/JPEG\/PNG.*다시 선택/);
 assert.match(app.row(bad.name).textContent,/확장자.*실제 이미지 형식/);assert.doesNotMatch(app.message(),/private detail/);assert.equal(app.row(bad.name).children[0].tag,'strong');
 assert.equal(app.calls.filter(c=>c.path.includes('/upload/')).length,2);assert.equal(app.draft.snapshot.webtoon.assetIds.length,2);assert.equal(app.draft.snapshot.webtoon.assetIds[0],'existing');
});

test('fully rejected multi-file selections report skipped counts without creating assets or uploads',async()=>{
 const app=await fixture();await app.context.CreatorWebtoon.select([file('움직임.gif','image/gif'),file('과다.png','image/png',8388609)]);
 assert.match(app.message(),/완료된 파일 0개 · 실패 0개 · 건너뜀 2개/);assert.equal(app.list().children.length,0);assert.equal(app.calls.length,1);assert.equal(app.edits.length,0);
});

test('no-progress processing is distinguished from failures and completed files in the final batch message',async()=>{
 const stalled={id:'',name:'중단.png',state:'UPLOADED',bytes:100,cursor:0,partCount:1,panels:[]};
 const app=await fixture({api:async(path,options)=>{
  if(path.includes('/upload/')){const id=path.split('/upload/')[1].split('?')[0];if(options.body.name===stalled.name){stalled.id=id;return {asset:copy(stalled)};}return {asset:ready(id,options.body.name)};}
  if(path.includes('/process/'))return {asset:copy(stalled)};return {assets:[]};
 }});await app.context.CreatorWebtoon.select([file(stalled.name),file('완료.png')]);
 assert.match(app.message(),/완료된 파일 1개 · 실패 0개 · 건너뜀 0개 · 이어서 처리 필요 1개/);
 assert.ok(app.row(stalled.name).children.find(n=>n.textContent==='이어서 처리'));
});

test('cancelling a queued file is counted separately and an old batch cannot overwrite a newer author message',async()=>{
 const pending=gate();const app=await fixture({api:async(path,options)=>path.includes('/upload/')?pending.promise:{assets:[]}});
 const task=app.context.CreatorWebtoon.select([file('첫째.png'),file('취소.png')]);await ticks();await app.row('취소.png').children.find(n=>n.textContent==='업로드 취소').onclick();
 const id=app.calls.find(c=>c.path.includes('/upload/')).path.split('/upload/')[1].split('?')[0];pending.resolve({asset:ready(id,'첫째.png')});await task;
 assert.match(app.message(),/완료된 파일 1개 · 실패 0개 · 건너뜀 0개 · 취소 1개/);
 const late=gate();app.context.WebNovelsAuth.api=async(path,options)=>path.includes('/upload/')?late.promise:{assets:[]};const old=app.context.CreatorWebtoon.select([file('이전1.png'),file('이전2.png')]);await ticks();
 app.context.CreatorWebtoon.reset();app.setAccount('author-b');Object.assign(app.draft,{userId:'author-b',workId:'20',id:'draft-b'});await app.mount();const before=app.message();late.reject(Error('network'));await old;assert.equal(app.message(),before);assert.doesNotMatch(app.list().textContent,/이전[12]/);
});
