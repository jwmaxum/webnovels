import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/js/creator/creator-webtoon.js',import.meta.url),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
const ready=(id,name=id+'.jpg')=>({id,name,state:'READY',bytes:100,cursor:1,partCount:1,panels:[{id:'panel-'+id,assetId:id,width:800,height:200}]});
const file=(name,type='image/png')=>({name,type,size:100});
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const ticks=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};

async function fixture({initial=[ready('existing-a'),ready('existing-b')],upload}={}){
 const nodes=[],calls=[],edits=[];let account='author-a',serial=0;
 const element=(tag='div')=>{
  const node={tag,tagName:tag.toUpperCase(),children:[],attributes:{},style:{},dataset:{},value:'',hidden:false,disabled:false,_text:'',
   append(...children){this.children.push(...children);},replaceChildren(...children){this.children=[...children];this._text='';},
   setAttribute(key,value){this.attributes[key]=String(value);},getAttribute(key){return this.attributes[key]??null;},
   closest(){return group;},after(child){nodes.push(child);},click(){return this.onclick?.();},focus(){},scrollIntoView(){},
   querySelector(selector){const visit=node=>node.children.flatMap(child=>[child,...visit(child)]);return visit(this).find(child=>selector==='input[type="file"]'&&child.tag==='input'&&child.type==='file')||null;}};
  Object.defineProperty(node,'textContent',{get(){return this._text+this.children.map(child=>child.textContent).join('');},set(value){this._text=String(value);this.children=[];}});
  Object.defineProperty(node,'innerHTML',{set(){assert.fail('Uploaded filenames and errors must remain text');}});nodes.push(node);return node;
 };
 const group=element(),draft={userId:account,workId:'10',id:'draft-a',revision:'1',snapshot:{webtoon:{schemaVersion:1,assetIds:initial.map(asset=>asset.id),thumbnailAssetId:initial[0]?.id||null,credits:{writer:'작가',artist:'그림'}}}};
 const context={AbortSignal,Blob,crypto,setTimeout,clearTimeout,
  URL:{createObjectURL:()=> 'blob:fixture-'+(++serial),revokeObjectURL(){}},
  document:{createElement:element,getElementById:id=>nodes.findLast(node=>node.id===id)||null},
  WEBNOVELS_CONFIG:{webtoonServiceEnabled:true},CreatorPublications:{refreshAvailability(){}},
  CreatorDraftEditor:{getFileContext:()=>copy(draft),editWebtoon:manifest=>{draft.snapshot.webtoon=copy(manifest);edits.push(copy(manifest));}},
  WebNovelsAuth:{getActor:()=>({userId:account}),api:async(path,options)=>{
   calls.push({path,options});
   if(path.includes('/upload/')){const id=path.split('/upload/')[1].split('?')[0];return upload?upload({path,id,options}):{asset:ready(id,options.body.name)};}
   assert(!path.includes('/process/'),'rejected source must never enter processing');return {assets:copy(initial)};
  }},ReaderWebtoon:{render(){assert.fail('Uploading must not implicitly render a preview');}}};
 context.window=context;vm.createContext(context);const content=element();content.id='newEpContent';vm.runInContext(source,context,{filename:'creator-webtoon.js'});
 const mount=()=>context.CreatorWebtoon.mount({content_type:'WEBTOON'},copy(draft),false);await mount();
 const list=()=>context.document.getElementById('creatorWebtoonList'),row=name=>list().children.find(node=>node.children[0].textContent===name);
 return {context,draft,calls,edits,mount,list,row,message:()=>context.document.getElementById('creatorWebtoonMessage').textContent,setAccount:value=>account=value};
}
const mismatch=()=>Object.assign(Error('server validation rejected source'),{code:'IMAGE_TYPE_MISMATCH',status:400});

test('actual uploader names a MIME mismatch and explains JPEG/PNG re-save and reselection while preserving completed assets',async()=>{
 const app=await fixture({upload:()=>{throw mismatch();}}),original=copy(app.draft.snapshot.webtoon),selected=file('확장자가 다른 원고.png');
 await app.context.CreatorWebtoon.select([selected]);
 const message=app.message();assert(message.includes(selected.name));assert.match(message,/확장자.*실제 이미지 형식/);assert.match(message,/\.jpg\/\.jpeg/);assert.match(message,/\.png/);assert.match(message,/다시 저장.*다시 선택/);assert.doesNotMatch(message,/연결 상태/);
 assert(app.row(selected.name).textContent.includes(message));assert.deepEqual(app.draft.snapshot.webtoon,original);assert.equal(app.edits.length,0);
 assert.equal(app.row('existing-a.jpg').children.some(node=>node.textContent.includes('완료')),true);assert.equal(app.row('existing-b.jpg').children.some(node=>node.textContent.includes('완료')),true);
 const sent=app.calls.find(call=>call.path.includes('/upload/'));assert.equal(sent.options.body,selected);assert.equal(sent.options.headers['Content-Type'],'image/png','the UI must not disguise the source MIME or bypass server validation');
});

test('a later successful file and reorder do not erase another row source error or disturb its safe filename and completed order',async()=>{
 const bad=file('<svg onload=1>.png'),good=file('정상 원고.jpg','image/jpeg');
 const app=await fixture({upload:({id,options})=>{if(options.body===bad)throw mismatch();return {asset:ready(id,options.body.name)};}});
 await app.context.CreatorWebtoon.select([bad,good]);
 assert.match(app.message(),/이미지 처리가 완료/);assert.match(app.row(bad.name).textContent,/\.jpg\/\.jpeg.*다시 저장.*다시 선택/);assert.equal(app.row(bad.name).children[0].tag,'strong');
 const goodId=app.calls.filter(call=>call.path.includes('/upload/')).at(-1).path.split('/upload/')[1].split('?')[0];
 assert.deepEqual(app.draft.snapshot.webtoon.assetIds,['existing-a','existing-b',goodId]);assert.equal(app.draft.snapshot.webtoon.thumbnailAssetId,'existing-a');
 app.context.CreatorWebtoon.move(1,0);assert.deepEqual(app.draft.snapshot.webtoon.assetIds,['existing-b','existing-a',goodId]);
 assert(app.row(bad.name).textContent.includes(bad.name));assert.match(app.row(bad.name).textContent,/확장자.*실제 이미지 형식/);assert.equal(app.row(bad.name).children.some(node=>node.tag==='svg'),false);
});

test('invalid-image and filename failures remain actionable source-specific rows instead of transport retry instructions',async()=>{
 for(const [code,expected]of [['IMAGE_INVALID',/이미지 파일을 읽을 수 없습니다.*다시 저장.*다시 선택/],['INVALID_FILENAME',/파일 이름.*200자.*다시 선택/]]){
  const app=await fixture({initial:[],upload:()=>{throw Object.assign(Error('private server diagnostics'),{code,status:400});}}),selected=file(code+'.png');
  await app.context.CreatorWebtoon.select([selected]);assert.match(app.row(selected.name).textContent,expected);assert(app.message().includes(selected.name));assert.doesNotMatch(app.message(),/private server diagnostics|연결 상태/);assert.deepEqual(app.draft.snapshot.webtoon.assetIds,[]);
 }
});

test('an old source validation failure cannot write its filename or advice into a newer author draft',async()=>{
 const pending=gate();let attempts=0;
 const app=await fixture({initial:[],upload:({id,options})=>++attempts===1?pending.promise:{asset:ready(id,options.body.name)}});
 const old=app.context.CreatorWebtoon.select([file('이전 계정 원고.png')]);await ticks();app.context.CreatorWebtoon.reset();app.setAccount('author-b');Object.assign(app.draft,{userId:'author-b',workId:'20',id:'draft-b'});await app.mount();
 await app.context.CreatorWebtoon.select([file('현재 원고.jpg','image/jpeg')]);const currentMessage=app.message(),currentManifest=copy(app.draft.snapshot.webtoon);
 pending.reject(mismatch());await old;assert.equal(app.message(),currentMessage);assert.deepEqual(app.draft.snapshot.webtoon,currentManifest);assert.equal(app.row('이전 계정 원고.png'),undefined);assert.doesNotMatch(app.list().textContent,/이전 계정|확장자.*실제 이미지/);
});
