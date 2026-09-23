import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

function node() {
  return {hidden:false,disabled:false,checked:false,value:'',textContent:'',classList:{add(){},remove(){}},
    children:[],replaceChildren(...items){this.children=items;this.textContent='';},append(...items){this.children.push(...items);}};
}
test('preview confirms a saved owner revision; lost publish response retries exact key and payload',async()=>{
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);};
  const radio={value:'NOW',checked:true};
  const document={readyState:'complete',getElementById:get,querySelector:()=>radio,
    querySelectorAll:()=>[radio],addEventListener(){}};
  const saved=new Map(),sessionStorage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
  const calls=[],ctx={userId:'user-1',workId:'10',id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    revision:'2',episodeId:null,seq:3,snapshot:{title:'원고',content:'본문\n\n다음',authorComment:'말'}};
  let failOnce=true,marked=false,refreshed=false;
  const window={WebNovelsAuth:{getActor:()=>({userId:'user-1',author:{id:'1'}}),
    api:async(path,options)=>{calls.push({path,options});
      if(path.startsWith('/api/v2/creator/works/'))return {work:{id:'10',title:'작품',description:'소개',rating:'ALL',ai_usage_type:'NONE',publication_missing:[]},episodes:[]};
      if(path.includes('/suggest'))return {episodeNumber:4};
      if(path.includes('/publish/')){if(failOnce){failOnce=false;throw Error('NETWORK');}
        return {publication:{status:'PUBLISHED',episodeId:'300',episodeNumber:4}};}
      return {publications:[]};
    }},
    CreatorDraftEditor:{getFileContext:()=>ctx,preparePublication:async()=>ctx,
      markPublished:async()=>{marked=true;},startNext:async()=>{}},
    ReaderContent:{render:(body,comment,snapshot)=>{body.textContent=snapshot.content;comment.textContent=snapshot.authorComment;}},
    openModal(){},closeModal(){},refreshReaderCatalog:async()=>{refreshed=true;}};
  const crypto={randomUUID:()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
  vm.runInNewContext(await readFile(new URL('../public/js/creator/creator-publications.js',import.meta.url),'utf8'),
    {window,document,sessionStorage,crypto,Date,location:{origin:'https://app.test'},navigator:{}});
  await window.CreatorPublications.open('10');
  assert.equal(get('publicationPreviewBody').textContent,ctx.snapshot.content);
  assert.match(get('publicationSummary').textContent,/서버 원고 버전 2/);
  get('publicationRights').checked=true;
  await Promise.all([get('publicationCommit').onclick(),get('publicationCommit').onclick()]);
  assert.equal(saved.size,1);
  assert.equal(calls.filter(x=>x.path.includes('/publish/')).length,1);
  await get('publicationCommit').onclick();
  const writes=calls.filter(x=>x.path.includes('/publish/'));
  assert.equal(writes.length,2);
  assert.deepEqual(writes.map(x=>x.options.headers['Idempotency-Key']),[crypto.randomUUID(),crypto.randomUUID()]);
  assert.equal(writes[0].options.body,writes[1].options.body);
  assert.equal(saved.size,0);
  assert.equal(marked,true);
  assert.equal(refreshed,true);
  assert.equal(get('publicationResult').hidden,false);
});
