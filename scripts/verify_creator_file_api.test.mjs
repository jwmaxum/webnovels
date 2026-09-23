import test from 'node:test';import assert from 'node:assert/strict';import {creatorFileApi} from '../server/creator-file-api.mjs';
const uid='11111111-1111-4111-8111-111111111111',key='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',draft='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const env={AUTHOR_FILES_ENABLED:'true',AUTHOR_DRAFTS_ENABLED:'true',AUTHOR_WORKS_ENABLED:'true'};
const payload={filename:'1.txt',bytes:Buffer.from('한글').toString('base64'),draftId:draft,title:'제목',content:'한글',order:0,batchId:key};
const file={id:key,bucket:'authoring-originals',key:uid+'/'+key+'/original'};
function setup({denied=false,failedUpload=false,committed=false}={}){
 const calls=[],objects=new Map();
 const db=async(t,q,{body})=>{calls.push({rpc:body.p_action,body});if(denied)return {error:'WORK_NOT_FOUND',status:404};
  if(body.p_action==='prepare')return {state:committed?'COMMITTED':'PREPARED',original:file,derivative:{...file,bucket:'authoring-covers',key:file.key+'/cover'},result:{draft:{id:draft}}};
  if(body.p_action==='commit')return {result:{draft:{id:draft}}};
  if(['read','public-cover'].includes(body.p_action))return {bucket:file.bucket,key:file.key};return {files:[]};};
 const fetchImpl=async(url,init)=>{const path=new URL(url).pathname;calls.push({storage:path,method:init.method,body:init.body});
  if(path.includes('/sign/'))return Response.json({signedURL:'/object/sign/'+file.bucket+'/'+file.key+'?token=test'});
  if(init.method==='POST'){if(failedUpload)return new Response('',{status:503});if(objects.has(path))return new Response('',{status:409});objects.set(path,init.body);return Response.json({});}
  return objects.has(path)?new Response(objects.get(path)):new Response('',{status:404});};
 const run=(action='import',{body=payload,bindings=env,method='POST',origin='https://app.test',id='',who={userId:uid,author:{status:'APPROVED'}}}={})=>creatorFileApi({request:new Request('https://app.test/api/v2/creator/files/'+action+(id?'/'+id:'')+'?workId=10',{method,headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':key},...(method==='POST'?{body:JSON.stringify(body)}:{})}),env:bindings,actor:async()=>who,db,fetchImpl,base:'https://example.supabase.co',serviceHeaders:{apikey:'server-test'},fail:(status,code)=>{throw Object.assign(Error(code),{status,code});}});
 return {calls,run,objects};
}
test('import validates owner before upload and commits only after durable storage acknowledgement',async()=>{
 const s=setup();assert.equal((await s.run()).draft.id,draft);assert.deepEqual(s.calls.map(c=>c.rpc||'storage'),['authorize','prepare','storage','commit']);assert.equal(s.calls[1].body.p_user_id,uid);
 const failure=setup({failedUpload:true});await assert.rejects(failure.run(),e=>e.code==='STORAGE_UPLOAD_FAILED');assert.ok(!failure.calls.some(c=>c.rpc==='commit'));
});
test('unknown upload response retry checks identical immutable bytes; committed request skips storage',async()=>{
 const s=setup();await s.run();await s.run();assert.ok(s.calls.some(c=>c.storage&&c.method===undefined));
 const done=setup({committed:true});await done.run();assert.ok(!done.calls.some(c=>c.storage));
});
test('ownership, role, Origin, feature gates and payload tampering fail before private storage',async()=>{
 const s=setup({denied:true});await assert.rejects(s.run(),e=>e.status===404);assert.ok(!s.calls.some(c=>c.storage));
 await assert.rejects(setup().run('import',{who:{userId:uid,author:null}}),e=>e.status===403);
 await assert.rejects(setup().run('import',{origin:'https://evil.test'}),e=>e.status===403);
 await assert.rejects(setup().run('import',{bindings:{...env,AUTHOR_FILES_ENABLED:'false'}}),e=>e.status===503);
 await assert.rejects(setup().run('import',{body:{...payload,authorId:123}}),e=>e.status===400);
});
test('original download is owner-checked and signed for only 60 seconds; export is authenticated JSON',async()=>{
 const s=setup(),result=await s.run('read',{id:key,method:'GET'});assert.equal(result.expiresIn,60);assert.ok(result.url.startsWith('https://example.supabase.co/storage/v1/object/sign/'));
 assert.equal(JSON.parse(s.calls.find(c=>c.storage).body).expiresIn,60);
 await assert.rejects(setup({denied:true}).run('read',{id:key,method:'GET'}));assert.ok((await s.run('export',{method:'GET'})));
});
test('image processor is mandatory and re-encoding must finish before cover upload/commit',async()=>{
 const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(0x49484452,12);png.writeUInt32BE(600,16);png.writeUInt32BE(900,20);
 const body={filename:'image.png',bytes:png.toString('base64'),cropped:png.toString('base64'),version:'1'};
 await assert.rejects(setup().run('cover',{body}),e=>e.code==='IMAGE_PROCESSOR_NOT_CONFIGURED');
 let processed=false;const bindings={...env,IMAGES:{input(){return {transform(){return {async output(options){assert.equal(options.format,'image/jpeg');processed=true;return {response:()=>new Response(new Uint8Array([255,216,255,217]))};}};}};}}};
 const s=setup();await s.run('cover',{body,bindings});assert.equal(processed,true);assert.equal(s.calls.filter(c=>c.storage&&c.method==='POST').length,2);assert.equal(s.calls.at(-1).rpc,'commit');
});
