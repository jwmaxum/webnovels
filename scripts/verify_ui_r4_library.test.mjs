import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/js/reader/reader-position.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const error=status=>Object.assign(Error(status===404?'WORK_NOT_FOUND':'CATALOG_UNAVAILABLE'),{status});
class Element{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this._text='';}
  set textContent(value){this._text=String(value??'');this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set innerHTML(_){throw Error('Stored names must not become HTML');}append(...children){this.children.push(...children);}replaceChildren(...children){this._text='';this.children=[...children];}
  setAttribute(key,value){this.attrs[key]=String(value);}getAttribute(key){return this.attrs[key]??null;}
}
function fixture(data={readingHistory:[],favorites:[],subscriptions:[]}){
  let account='reader-a',activity=async()=>data;const requests=[],opens=[],nodes=Object.fromEntries(['libraryContinueList','libraryFavoritesList','libraryAuthorsList','libraryLoadStatus','statReadingCount','statFavoriteCount','statAuthorCount','statCreatorCount'].map(id=>[id,new Element()]));
  const context={Math,Number,Date,Set,Map,Promise,WebNovelsAuth:{getActor:()=>account?{userId:account,reader:{id:'profile-'+account}}:null},
    document:{getElementById:id=>nodes[id]||null,createElement:tag=>new Element(tag)},ReaderHub:{activity:()=>activity()},
    ReaderCatalog:{active:()=>true,async work(id){requests.push({action:'work',id});return {id:String(id),title:'작품 '+id};},async reading(id,number){requests.push({action:'reading',id,number});return {work:{id:String(id),title:'작품 '+id},episode:{episodeNumber:Number(number)}};}},
    openReaderDirect:(id,number)=>opens.push({id,number}),openWorkDetailDirect:id=>opens.push({id}),getPublishedWorks(){throw Error('No full catalog fallback');}};
  context.window=context;vm.createContext(context);vm.runInContext(source,context,{filename:'reader-position.js'});
  return {context,nodes,requests,opens,library:context.ReaderLibrary,setAccount:value=>account=value,setActivity:value=>activity=value};
}

test('favorites-only pagination is reachable inside its own panel and actual author count is synchronized',async()=>{
  const app=fixture({readingHistory:[],favorites:Array.from({length:25},(_,i)=>String(10+i)),subscriptions:[{name:'비즈피어'},{name:'작가 2'}]});
  await app.library.render();assert.equal(app.nodes.libraryFavoritesList.children.length,21);assert.equal(app.nodes.libraryContinueList.children.length,1);
  assert.equal(app.nodes.statFavoriteCount.textContent,'25');assert.equal(app.nodes.statAuthorCount.textContent,'2');assert.equal(app.nodes.statCreatorCount.textContent,'2');
  const more=app.nodes.libraryFavoritesList.children.at(-1);assert.match(more.textContent,/더 보기/);await more.onclick();
  assert.equal(app.nodes.libraryFavoritesList.children.length,25);assert(!app.nodes.libraryFavoritesList.children.some(child=>child.textContent.includes('더 보기')));
  app.nodes.libraryFavoritesList.children.at(-1).onclick();assert.equal(app.opens.at(-1).id,'34');assert.equal(app.nodes.libraryFavoritesList.getAttribute('aria-busy'),'false');
});

test('favorite 503 preserves loaded reading and author panels and uses unknown counts until retry succeeds',async()=>{
  const app=fixture({readingHistory:[{workId:'10',episodeNumber:9,progress:42}],favorites:['20'],subscriptions:[{name:'실제 작가'}]});
  let fail=true;const original=app.context.ReaderCatalog.work;app.context.ReaderCatalog.work=async id=>{if(fail)throw error(503);return original(id);};
  await app.library.render();assert.equal(app.nodes.libraryContinueList.children[0].children[0].textContent,'작품 10');
  assert.match(app.nodes.libraryContinueList.children[0].children[1].textContent,/9화 · 현재 회차 42%/);assert.match(app.nodes.libraryAuthorsList.textContent,/실제 작가/);
  assert.match(app.nodes.libraryFavoritesList.textContent,/불러오지 못했습니다/);assert.equal(app.nodes.statFavoriteCount.textContent,'—');assert.equal(app.nodes.statReadingCount.textContent,'1');
  assert.match(app.nodes.libraryLoadStatus.textContent,/일부 서재 목록/);fail=false;
  await app.nodes.libraryFavoritesList.children.find(child=>child.tagName==='BUTTON').onclick();
  assert.equal(app.nodes.libraryFavoritesList.children[0].textContent,'작품 20');assert.equal(app.nodes.statFavoriteCount.textContent,'1');
});

test('reading 503 does not turn a valid favorites or subscriptions list into a failure',async()=>{
  const app=fixture({readingHistory:[{workId:'10',episodeNumber:4}],favorites:['20'],subscriptions:[{name:'작가'}]});
  app.context.ReaderCatalog.reading=async()=>{throw error(503);};await app.library.render();
  assert.match(app.nodes.libraryContinueList.textContent,/이어보기 목록을 불러오지 못/);assert.equal(app.nodes.statReadingCount.textContent,'—');
  assert.equal(app.nodes.libraryFavoritesList.children[0].textContent,'작품 20');assert.equal(app.nodes.statFavoriteCount.textContent,'1');assert.equal(app.nodes.statAuthorCount.textContent,'1');
});

test('withdrawn or forbidden entries stay out of public rows while more pages remain reachable',async()=>{
  const app=fixture({readingHistory:[{workId:'10',episodeNumber:4},{workId:'20',episodeNumber:9,progress:70}],favorites:['10','20'],subscriptions:[]});
  const reading=app.context.ReaderCatalog.reading,work=app.context.ReaderCatalog.work;
  app.context.ReaderCatalog.reading=async(id,number)=>{if(id==='10')throw error(403);return reading(id,number);};
  app.context.ReaderCatalog.work=async id=>{if(id==='10')throw error(404);return work(id);};
  await app.library.render(1);assert.match(app.nodes.libraryContinueList.textContent,/이어볼 수 있는 공개 회차가 없습니다/);
  assert.match(app.nodes.libraryFavoritesList.textContent,/등록된 공개 관심 작품이 없습니다/);
  const more=app.nodes.libraryContinueList.children.at(-1);assert.match(more.textContent,/더 보기/);await more.onclick();
  assert.equal(app.nodes.libraryContinueList.children[0].children[0].textContent,'작품 20');app.nodes.libraryContinueList.children[0].onclick();
  assert.deepEqual(app.opens.at(-1),{id:'20',number:9});assert.equal(app.nodes.libraryFavoritesList.children[0].textContent,'작품 20');
});

test('a newer account render and reset cannot be overwritten or acted on by an older activity response',async()=>{
  const app=fixture({readingHistory:[],favorites:['20'],subscriptions:[]});const pending=deferred();let calls=0;
  app.setActivity(()=>++calls===1?pending.promise:Promise.resolve({readingHistory:[],favorites:['20'],subscriptions:[{name:'새 계정 작가'}]}));
  const old=app.library.render();assert.equal(app.nodes.libraryFavoritesList.getAttribute('aria-busy'),'true');assert.equal(app.nodes.statFavoriteCount.textContent,'—');
  app.setAccount('reader-b');await app.library.render();pending.resolve({readingHistory:[],favorites:['10'],subscriptions:[{name:'이전 계정 작가'}]});await old;
  assert.equal(app.nodes.libraryFavoritesList.children[0].textContent,'작품 20');assert.doesNotMatch(app.nodes.libraryAuthorsList.textContent,/이전/);
  const staleButton=app.nodes.libraryFavoritesList.children[0];app.library.reset();staleButton.onclick();assert.equal(app.opens.length,0);
  assert.equal(app.nodes.libraryFavoritesList.children.length,0);assert.equal(app.nodes.statAuthorCount.textContent,'—');assert.equal(app.nodes.libraryLoadStatus.textContent,'');
});

test('same-account late catalog rows cannot replace a newer render',async()=>{
  const app=fixture();const pending=deferred();let calls=0;
  app.setActivity(async()=>({readingHistory:[],favorites:[++calls===1?'10':'20'],subscriptions:[]}));
  const original=app.context.ReaderCatalog.work;app.context.ReaderCatalog.work=id=>id==='10'?pending.promise:original(id);
  const old=app.library.render();await tick();await app.library.render();pending.resolve({id:'10',title:'늦은 이전 작품'});await old;
  assert.equal(app.nodes.libraryFavoritesList.children[0].textContent,'작품 20');assert.equal(app.nodes.statFavoriteCount.textContent,'1');
});

test('login, empty activity and activity failure are distinct and stored labels remain plain text',async()=>{
  const app=fixture();app.setAccount(null);await app.library.render();assert.match(app.nodes.libraryLoadStatus.textContent,/로그인 후/);assert.equal(app.nodes.statFavoriteCount.textContent,'—');
  app.setAccount('reader-a');await app.library.render();assert.match(app.nodes.libraryContinueList.textContent,/아직 읽은 작품이 없습니다/);assert.match(app.nodes.libraryFavoritesList.textContent,/등록된 공개 관심 작품이 없습니다/);assert.equal(app.nodes.statFavoriteCount.textContent,'0');
  app.setActivity(async()=>{throw error(503);});await app.library.render();assert.match(app.nodes.libraryLoadStatus.textContent,/불러오지 못/);assert.equal(app.nodes.statAuthorCount.textContent,'—');
  app.setActivity(async()=>({readingHistory:[],favorites:['10'],subscriptions:[{name:'<img onerror=1>'}]}));
  app.context.ReaderCatalog.work=async()=>({id:'10',title:'<svg onload=1>'});await app.library.render();
  assert.equal(app.nodes.libraryFavoritesList.children[0].textContent,'<svg onload=1>');assert.equal(app.nodes.libraryFavoritesList.children[0].children.length,0);
  assert.equal(app.nodes.libraryAuthorsList.children[0].textContent,'<img onerror=1>');assert.equal(app.nodes.libraryAuthorsList.children[0].children.length,0);
});

test('discovery-off library resolves only the existing public cache without requesting an inactive catalog',async()=>{
  const app=fixture({readingHistory:[{workId:'10',episodeNumber:4,progress:25}],favorites:['10'],subscriptions:[]});
  app.context.ReaderCatalog.active=()=>false;app.context.ReaderCatalog.work=()=>assert.fail('inactive catalog cannot be requested');
  app.context.getPublishedWorks=()=>[{id:'10',title:'기존 공개 작품',episodes:[{episodeNumber:4}]}];await app.library.render();
  assert.equal(app.nodes.libraryFavoritesList.children[0].textContent,'기존 공개 작품');assert.equal(app.nodes.libraryContinueList.children[0].children[0].textContent,'기존 공개 작품');
});
