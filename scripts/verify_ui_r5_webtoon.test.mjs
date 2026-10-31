import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/js/creator/creator-webtoon.js',import.meta.url),'utf8');
const ticks=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const plain=value=>JSON.parse(JSON.stringify(value));
const file=(name='원고.png',size=100)=>({name,type:'image/png',size});
const ready=(id,name=id+'.png')=>({id,name,state:'READY',bytes:100,cursor:1,partCount:1,panels:[{id:'panel-'+id,assetId:id,width:800,height:200} ]});
async function fixture({initial=[ready('a'),ready('b')],api}={}){
 const nodes=[],calls=[],created=[],revoked=[],edits=[],renders=[],availability=[];let account='author-a',sequence=0;
 const element=(tag='div')=>{const n={tag,tagName:tag.toUpperCase(),children:[],attributes:{},style:{},dataset:{},textContent:'',hidden:false,disabled:false,value:'',className:'',
  append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},setAttribute(key,value){this.attributes[key]=String(value);},getAttribute(key){return this.attributes[key]??null;},
  closest(){return group;},after(child){nodes.push(child);},click(){return this.onclick?.();},focus(){},scrollIntoView(){},
  querySelector(selector){const all=[];const visit=n=>{for(const child of n.children){all.push(child);visit(child);}};visit(this);return all.find(child=>selector==='input[type="file"]'&&child.tag==='input'&&child.type==='file')||null;}};nodes.push(n);return n;};
 const group=element(),draft={userId:'author-a',workId:'10',id:'draft-a',revision:'1',snapshot:{title:'웹툰',webtoon:{schemaVersion:1,assetIds:initial.filter(a=>a.state==='READY').map(a=>a.id),thumbnailAssetId:initial.find(a=>a.state==='READY')?.id||null,credits:{writer:'작가'}}}};
 const context=vm.createContext({console,Blob,AbortSignal,setTimeout,clearTimeout,crypto,URL:{createObjectURL(value){const url='blob:thumb-'+(++sequence);created.push({url,value});return url;},revokeObjectURL:url=>revoked.push(url)},
  document:{createElement:element,getElementById:id=>nodes.findLast(n=>n.id===id)||null},WEBNOVELS_CONFIG:{webtoonServiceEnabled:true},
  CreatorDraftEditor:{getFileContext:()=>plain(draft),editWebtoon:m=>{draft.snapshot.webtoon=plain(m);edits.push(plain(m));}},
  CreatorPublications:{refreshAvailability:()=>availability.push(context.CreatorWebtoon?.hasPending())},
  WebNovelsAuth:{getActor:()=>({userId:account}),api:async(path,options)=>{calls.push({path,options});if(api)return api(path,options,initial);if(path.includes('/upload/'))return {asset:ready(path.split('/upload/')[1].split('?')[0],options.body.name)};if(path.includes('/panel/'))return new Blob(['thumbnail']);return {assets:initial};}},
  ReaderWebtoon:{render(root,panels,options){const record={root,panels:plain(panels),options,disposed:false};renders.push(record);root.replaceChildren({tag:'rendered',children:[],textContent:panels.map(p=>p.id).join(',')});return ()=>{record.disposed=true;};}}});
 context.window=context;const content=element();content.id='newEpContent';vm.runInContext(source,context,{filename:'creator-webtoon.js'});
 const mount=()=>context.CreatorWebtoon.mount({content_type:'WEBTOON'},plain(draft),false);await mount();
 const root=()=>context.document.getElementById('creatorWebtoon'),list=()=>context.document.getElementById('creatorWebtoonList'),row=name=>list().children.find(r=>r.children[0].textContent===name);
 const control=(row,label)=>row.children.find(n=>n.tag==='button'&&n.textContent===label);
 return {context,draft,nodes,initial,calls,created,revoked,edits,renders,availability,element,mount,root,list,row,control,setAccount:value=>account=value,uploadInput:()=>root().querySelector('input[type="file"]')};
}

test('queued rows keep safe filenames, numbered order and cached real local thumbnails, revoked on cancel/reset',async()=>{
 const pending=gate();let first=true;
 const app=await fixture({initial:[],api:async(path,options)=>{if(path.includes('/upload/')){if(first){first=false;return pending.promise;}return {asset:ready(path.split('/upload/')[1].split('?')[0],options.body.name)};}return {assets:[]};}});
 const one=file('<img onerror=1>.png'),two=file('두 번째.png');const task=app.context.CreatorWebtoon.select([one,two]);await ticks();
 assert.equal(app.list().children.length,2);assert.equal(app.created.length,2);assert.equal(app.row(one.name).children[0].tag,'strong');assert.equal(app.row(one.name).children[1].textContent,'1');assert.equal(app.row(two.name).children[1].textContent,'2');
 const thumb=app.row(one.name).children.find(n=>n.tag==='img');assert.equal(thumb.loading,'lazy');assert.equal(thumb.decoding,'async');assert.equal(thumb.src,app.created[0].url);assert.equal(thumb.alt,'');assert.equal(thumb.title,one.name);assert.equal(app.created[0].value,one);
 assert.equal(app.list().children.flatMap(row=>row.children).some(n=>n.textContent==='업로드 재시도'),false);
 await app.control(app.row(two.name),'업로드 취소').onclick();assert.deepEqual(app.revoked,[app.created[1].url]);assert.equal(app.created.length,2);
 const id=app.calls.find(c=>c.path.includes('/upload/')).path.split('/upload/')[1].split('?')[0];pending.resolve({asset:ready(id,one.name)});await task;
 assert.equal(app.created.length,2);assert.equal(app.row(one.name).children.find(n=>n.tag==='img').src,app.created[0].url);
 app.context.CreatorWebtoon.reset();assert.equal(new Set(app.revoked).size,2);assert.equal(app.revoked.length,2);
});

test('same File object is deduplicated but distinct same-name files survive; batch and manual retry lock selection and order',async()=>{
 const first=gate(),retry=gate();let uploads=0;
 const app=await fixture({initial:[ready('a')],api:async(path,options,initial)=>{if(path.includes('/upload/')){uploads++;if(uploads===1)return first.promise;if(uploads===3)return retry.promise;return {asset:ready(path.split('/upload/')[1].split('?')[0],options.body.name)};}return {assets:initial};}});
 const same=file('같은 이름.png'),distinct=file('같은 이름.png');const task=app.context.CreatorWebtoon.select([same,same,distinct]);await ticks();
 assert.equal(app.created.length,2);assert.equal(app.list().children.length,3);assert.equal(app.uploadInput().disabled,true);assert.equal(app.root().children.find(n=>n.tag==='label').children[0].disabled,true);
 await app.context.CreatorWebtoon.select([file('차단.png')]);app.context.CreatorWebtoon.move(0,1);assert.equal(app.created.length,2);assert.equal(app.edits.length,0);
 first.reject(Error('network'));await task;assert.equal(uploads,2);assert.equal(app.uploadInput().disabled,false);
 const retryButton=app.list().children.flatMap(row=>row.children).find(n=>n.textContent==='업로드 재시도');assert.ok(retryButton);assert.equal(retryButton.disabled,false);
 const retryTask=retryButton.onclick();await ticks();assert.equal(app.uploadInput().disabled,true);const before=plain(app.draft.snapshot.webtoon.assetIds);
 await app.context.CreatorWebtoon.select([file('다시 차단.png')]);app.context.CreatorWebtoon.move(0,1);assert.deepEqual(app.draft.snapshot.webtoon.assetIds,before);assert.equal(uploads,3);
 const id=app.calls.filter(c=>c.path.includes('/upload/')).at(-1).path.split('/upload/')[1].split('?')[0];retry.resolve({asset:ready(id,same.name)});await retryTask;
 assert.equal(app.uploadInput().disabled,false);assert.equal(app.draft.snapshot.webtoon.assetIds[1],id);assert.equal(app.context.CreatorWebtoon.hasPending(),false);
 assert.equal(app.availability.includes(true),true);assert.equal(app.availability.at(-1),false);
});

test('an old process finally cannot release the new context upload lock for the same server asset ID',async()=>{
 const old=gate(),newer=gate();let processing=0;
 const stored={id:'pending',name:'이전.png',state:'UPLOADED',bytes:100,cursor:0,partCount:1,panels:[]};
 const app=await fixture({initial:[stored],api:async(path,_options,initial)=>path.includes('/process/')?(++processing===1?old.promise:newer.promise):{assets:initial.map(a=>({...a}))}});
 const oldTask=app.control(app.row('이전.png'),'이어서 처리').onclick();await ticks();assert.equal(app.uploadInput().disabled,true);
 await app.mount();const newTask=app.control(app.row('이전.png'),'이어서 처리').onclick();await ticks();assert.equal(processing,2);
 old.resolve({asset:ready('pending','이전.png')});await oldTask;assert.equal(app.uploadInput().disabled,true);assert.equal(app.context.CreatorWebtoon.hasPending(),true);assert.equal(app.edits.length,0);
 newer.resolve({asset:ready('pending','이전.png')});await newTask;assert.equal(app.uploadInput().disabled,false);assert.equal(app.context.CreatorWebtoon.hasPending(),false);assert.deepEqual(app.draft.snapshot.webtoon.assetIds,['pending']);
});

test('server thumbnails are requested explicitly, cached across redraw, and never attach after reset',async()=>{
 const thumb=gate();const app=await fixture({api:async(path,_options,initial)=>path.includes('/panel/')?thumb.promise:{assets:initial}});
 assert.equal(app.calls.filter(call=>call.path.includes('/panel/')).length,0);assert.equal(app.created.length,0);
 const old=app.control(app.row('a.png'),'이미지 확인');const task=old.onclick();await ticks();await old.onclick();assert.equal(app.calls.filter(call=>call.path.includes('/panel/')).length,1);
 thumb.resolve(new Blob(['server image']));await task;assert.equal(app.created.length,1);assert.ok(app.row('a.png').children.some(n=>n.tag==='img'));assert.equal(app.control(app.row('a.png'),'이미지 확인'),undefined);
 app.context.CreatorWebtoon.move(0,1);assert.equal(app.created.length,1);
 const late=gate();app.context.WebNovelsAuth.api=async()=>late.promise;const lateTask=app.control(app.row('b.png'),'이미지 확인').onclick();await ticks();app.context.CreatorWebtoon.reset();late.resolve(new Blob(['late']));await lateTask;
 assert.equal(app.created.length,1);assert.deepEqual(app.revoked,[app.created[0].url]);
});

test('newer preview wins and reordering/reset invalidates pending and rendered preview snapshots',async()=>{
 const app=await fixture(),first=gate(),second=gate(),third=gate();let requests=0;
 app.context.WebNovelsAuth.api=async()=>{requests++;return (requests===1?first:requests===2?second:third).promise;};
 const root=app.element(),older=app.context.CreatorWebtoon.renderPreview(root,plain(app.draft)),newer=app.context.CreatorWebtoon.renderPreview(root,plain(app.draft));
 second.resolve({assets:app.initial});await newer;assert.equal(app.renders.length,1);first.resolve({assets:app.initial});await older;assert.equal(app.renders.length,1);assert.match(root.children[0].textContent,/panel-a,panel-b/);
 app.context.CreatorWebtoon.move(0,1);assert.equal(app.renders[0].disposed,true);assert.equal(app.renders[0].options.valid(),false);assert.equal(root.children.length,0);
 const pending=app.context.CreatorWebtoon.renderPreview(root,plain(app.draft));app.context.CreatorWebtoon.move(0,1);third.resolve({assets:app.initial});await pending;assert.equal(app.renders.length,1);
 const last=gate();app.context.WebNovelsAuth.api=()=>last.promise;const afterReset=app.context.CreatorWebtoon.renderPreview(root,plain(app.draft));app.context.CreatorWebtoon.reset();last.resolve({assets:app.initial});await afterReset;assert.equal(app.renders.length,1);
});

test('interrupted processing waits for an explicit continue when the server makes no progress',async()=>{
 const stored={id:'pending',name:'미완료.png',state:'PROCESSING',bytes:100,cursor:0,partCount:1,panels:[]};let attempts=0;
 const app=await fixture({initial:[stored],api:async(path,_options,initial)=>{if(path.includes('/process/')){attempts++;return {asset:{...stored}};}return {assets:initial};}});
 await app.control(app.row('미완료.png'),'이어서 처리').onclick();await ticks();assert.equal(attempts,1);assert.ok(app.control(app.row('미완료.png'),'이어서 처리'));assert.match(app.context.document.getElementById('creatorWebtoonMessage').textContent,/이어서 처리를 눌러/);assert.equal(app.uploadInput().disabled,false);
});

test('existing image count, original bytes, file size and MIME limits remain enforced',async()=>{
 const count=gate(),app=await fixture({initial:[],api:async(path)=>path.includes('/upload/')?count.promise:{assets:[]}});
 const selection=app.context.CreatorWebtoon.select(Array.from({length:101},(_,i)=>file(i+'.png')));await ticks();assert.equal(app.list().children.length,100);assert.equal(app.calls.filter(c=>c.path.includes('/upload/')).length,1);app.context.CreatorWebtoon.reset();count.resolve({asset:ready('old')});await selection;
 const bytes=gate(),limited=await fixture({initial:[],api:async(path)=>path.includes('/upload/')?bytes.promise:{assets:[]}});
 const large=limited.context.CreatorWebtoon.select(Array.from({length:17},(_,i)=>file(i+'.png',8388608)));await ticks();assert.equal(limited.list().children.length,16);limited.context.CreatorWebtoon.reset();bytes.resolve({asset:ready('old')});await large;
 const invalid=await fixture({initial:[]});await invalid.context.CreatorWebtoon.select([file('과다.png',8388609),{...file('움직임.gif'),type:'image/gif'},file('정상.png')]);assert.equal(invalid.calls.filter(c=>c.path.includes('/upload/')).length,1);assert.equal(invalid.draft.snapshot.webtoon.assetIds.length,1);
});
