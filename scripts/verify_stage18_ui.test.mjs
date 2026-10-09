import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';
const load=async(context,name)=>{const path=fileURLToPath(new URL('../public/js/'+name,import.meta.url));vm.runInContext(await readFile(path,'utf8'),context,{filename:path});};
const ticks=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const plain=x=>JSON.parse(JSON.stringify(x));
function dom(){
 const nodes=[],events=new Map(),frames=new Map(),revoked=[],created=[];let sequence=0,account='author-a';
 const element=(tag='div')=>{const n={tag,children:[],dataset:{},style:{},attributes:{},hidden:false,value:'',className:'',
  append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];if(k==='src')this.src='';},
  getBoundingClientRect(){const top=Number(this.dataset.panelIndex||0)*100-context.scrollY;return {top,bottom:top+100,height:100};},
  closest(){return group;},after(child){nodes.push(child);},click(){this.onclick?.();},
  querySelectorAll(selector){return selector==='.webtoon-panel'?this.children.filter(c=>c.className==='webtoon-panel'):selector==='img'?this.children.flatMap(c=>c.children.filter(c=>c.tag==='img')):[];}};nodes.push(n);return n;};
 const group=element();const context=vm.createContext({console,Blob,AbortController,AbortSignal,URLSearchParams,crypto,setTimeout,clearTimeout,
  innerHeight:300,scrollY:0,URL:{createObjectURL:()=>{const url='blob:test-'+(++sequence);created.push(url);return url;},revokeObjectURL:u=>revoked.push(u)},
  document:{createElement:element,getElementById:id=>nodes.find(n=>n.id===id)||null},
  requestAnimationFrame:fn=>{frames.set(++sequence,fn);return sequence;},cancelAnimationFrame:id=>frames.delete(id),
  addEventListener:(k,fn)=>{if(!events.has(k))events.set(k,new Set());events.get(k).add(fn);},removeEventListener:(k,fn)=>events.get(k)?.delete(fn),
  scrollTo:({top})=>context.scrollY=top,WebNovelsAuth:{getActor:()=>({userId:account})}});context.window=context;
 const flush=async()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn());await ticks();};
 return {context,element,nodes,group,revoked,created,flush,events,setAccount:a=>account=a,emit:k=>events.get(k)?.forEach(fn=>fn())};
}

test('DraftEngine snapshots deep-copy ordered images and preserve the exact pending request while edits continue',async()=>{
 const c=vm.createContext({crypto,console}),writes=[],backups=[],held=gate();await load(c,'creator/draft-engine.js');
 const store={save:async()=>{},backup:async(_c,value)=>backups.push(plain(value))};
 let fail=true;const engine=new c.DraftEngine({store,uuid:()=>crypto.randomUUID(),api:async(action,args)=>{
  writes.push(plain(args));if(fail){await held.promise;throw Error('response lost');}return {draft:{revision:'1',...args.data}};}});
 await engine.open('owner','10');const original={schemaVersion:1,assetIds:['a','b'],thumbnailAssetId:'a',credits:{writer:'작가'}};
 engine.edit({title:'웹툰',content:'',authorComment:'후기',webtoon:original});original.assetIds.reverse();assert.deepEqual(plain(engine.current.snapshot.webtoon.assetIds),['a','b']);
 const first=engine.sync();await ticks();engine.edit({...engine.current.snapshot,webtoon:{...engine.current.snapshot.webtoon,assetIds:['b','a']}});held.resolve();await assert.rejects(first);
 fail=false;await engine.sync();assert.deepEqual(writes[0],writes[1]);assert.deepEqual(plain(engine.current.snapshot.webtoon.assetIds),['b','a']);assert.ok(engine.current.serverSeq<engine.current.seq);
 await engine.replace({...engine.current.snapshot,webtoon:{...engine.current.snapshot.webtoon,credits:{artist:'새 그림'}}});assert.ok(backups.some(b=>b.webtoon.credits.writer==='작가'));
});
test('viewer reserves all panel dimensions but bounds fetches and resident blobs; leaving drops late responses',async()=>{
 const s=dom();await load(s.context,'reader/reader-webtoon.js');const root=s.element(),requests=[];
 const panels=Array.from({length:20},(_,i)=>({id:String(i),width:800,height:100}));
 s.context.ReaderWebtoon.render(root,panels,{load:(panel,format)=>{const g=gate();requests.push({panel,format,...g});return g.promise;}});await s.flush();
 assert.equal(root.children.length,20);assert.equal(root.children[0].style.aspectRatio,'800/100');assert.equal(requests.length,3);
 requests.slice().forEach(g=>g.resolve(new Blob(['test'])));await ticks();assert.equal(requests.length,5);
 requests.slice(3).forEach(g=>g.resolve(new Blob(['test'])));await ticks();root.children.forEach(n=>n.children[0].onload?.());assert.equal(s.created.length,5);
 s.context.scrollY=1500;s.emit('scroll');await s.flush();assert.ok(s.revoked.length>=5);assert.equal(requests.length,8);
 s.context.ReaderWebtoon.reset();requests.slice(5).forEach(g=>g.resolve(new Blob(['late'])));await ticks();assert.equal(s.created.length,5);assert.equal(s.events.get('scroll').size,0);
});
test('viewer retries only the failed image and uses PNG when WebP cannot decode',async()=>{
 const s=dom();await load(s.context,'reader/reader-webtoon.js');const root=s.element(),calls=[];let failure=true;
 s.context.ReaderWebtoon.render(root,[{id:'1',width:800,height:100}],{load:async(p,f)=>{calls.push([p.id,f]);if(failure)throw Error('network');return new Blob(['image']);}});await s.flush();
 assert.equal(root.children[0].children[1].hidden,false);s.emit('scroll');await s.flush();assert.equal(calls.length,1);
 failure=false;root.children[0].children[1].onclick();await ticks();root.children[0].children[0].onerror();await ticks();
 assert.deepEqual(calls,[['1','webp'],['1','webp'],['1','png']]);root.children[0].children[0].onload();assert.equal(root.children[0].dataset.loaded,'true');s.context.ReaderWebtoon.reset();
});
test('image positions restore reserved geometry yet placeholders cannot report completion',async()=>{
 const s=dom();await load(s.context,'reader/reader-position.js');const root=s.element();root.getBoundingClientRect=()=>({top:0,height:1000,bottom:1000});
 const a=s.element();a.className='webtoon-panel';a.dataset={panelIndex:'0',loaded:'false'};root.append(a);const version=crypto.randomUUID();
 assert.equal(s.context.ReaderPosition.measure(root,version,true),null);a.dataset.loaded='true';const m=s.context.ReaderPosition.measure(root,version,true);assert.equal(m.position.panelIndex,0);assert.ok(!('paragraphIndex' in m.position));
 assert.equal(s.context.ReaderPosition.restore(root,{versionId:version,panelIndex:0,offset:0.5},version),'RESTORED');
 assert.equal(s.context.ReaderPosition.restore(root,{versionId:'old',panelIndex:0,offset:0.5},version),'VERSION_CHANGED');
});
async function creator({api}={}){
 const s=dom(),context={userId:'author-a',workId:'10',id:'draft-a',snapshot:{title:'제목',content:'',authorComment:'',webtoon:{schemaVersion:1,assetIds:['a','b'],thumbnailAssetId:'a',credits:{writer:'글'}}}};
 const edits=[],calls=[],ready=['a','b'].map(id=>({id,name:id+'.png',state:'READY',bytes:10,cursor:1,partCount:1,panels:[{id:'panel-'+id,assetId:id,width:800,height:100}]}));
 s.context.WEBNOVELS_CONFIG={webtoonServiceEnabled:true};s.context.CreatorDraftEditor={getFileContext:()=>plain(context),editWebtoon:m=>{context.snapshot.webtoon=plain(m);edits.push(plain(m));}};
 s.context.WebNovelsAuth.api=async(path,options)=>{calls.push({path,options});if(api)return api(path,options,ready);return {assets:ready};};
 const content=s.element();content.id='newEpContent';await load(s.context,'reader/reader-webtoon.js');await load(s.context,'creator/creator-webtoon.js');
 await s.context.CreatorWebtoon.mount({content_type:'WEBTOON'},context,false);return {...s,draft:context,edits,calls,ready};
}
test('creator order controls update the same draft manifest, and preview fetches only authenticated panel endpoints',async()=>{
 const s=await creator();s.context.CreatorWebtoon.move(0,1);assert.deepEqual(s.edits.at(-1).assetIds,['b','a']);assert.equal(s.edits.at(-1).thumbnailAssetId,'a');assert.equal(s.edits.at(-1).credits.writer,'글');
 const root=s.element();await s.context.CreatorWebtoon.renderPreview(root,plain(s.draft));await s.flush();
 assert.ok(s.calls.some(c=>c.path.includes('/creator/webtoon/panel/b?workId=10&panelId=panel-b&format=webp')&&c.options.responseType==='blob'));
 s.context.CreatorWebtoon.reset();s.context.ReaderWebtoon.reset();assert.equal(s.group.hidden,true);
});
test('creator account change during upload never attaches the late file to another draft',async()=>{
 const hold=gate();const s=await creator({api:async(path,_o,ready)=>path.includes('/upload/')?hold.promise:{assets:ready}});
 const task=s.context.CreatorWebtoon.select([{name:'원고.png',type:'image/png',size:100}]);await ticks();
 s.setAccount('another-author');s.context.CreatorWebtoon.reset();hold.resolve({asset:{id:'new',state:'READY',bytes:100,panels:[]}});await task;
 assert.equal(s.edits.length,0);assert.deepEqual(s.draft.snapshot.webtoon.assetIds,['a','b']);
});

test('creator cancel while upload response is in flight prevents late READY attachment',async()=>{
 const hold=gate();const s=await creator({api:async(path,_o,ready)=>path.includes('/upload/')?hold.promise:path.includes('/cancel/')?{asset:{state:'CANCELLED'}}:{assets:ready}});
 const task=s.context.CreatorWebtoon.select([{name:'취소.png',type:'image/png',size:100}]);await ticks();assert.equal(s.context.CreatorWebtoon.hasPending(),true);
 const list=s.nodes.find(n=>n.id==='creatorWebtoonList'),row=list.children.find(n=>n.children[0].textContent==='취소.png');assert.ok(row);
 await row.children.find(n=>n.tag==='button'&&n.textContent==='업로드 취소').onclick();
 hold.resolve({asset:{id:'late-id',state:'READY',bytes:100,panels:[]}});await task;assert.equal(s.edits.length,0);assert.equal(s.context.CreatorWebtoon.hasPending(),false);
});
