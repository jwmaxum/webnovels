import test,{before,after} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {setup,admin,reader} from './fixtures/stage17-db.mjs';
import {webtoonApi,inspectSource,sliceGeometry,projectWebtoon,webtoonEnabled} from '../server/webtoon-api.mjs';
import {publicContent,validReadingPosition} from '../server/stage16-api.mjs';
import {creatorWorkApi} from '../server/creator-work-api.mjs';
const flags=Object.fromEntries(['WEBTOON_SERVICE_ENABLED','P0_API_ENABLED','AUTHOR_WORKS_ENABLED','AUTHOR_DRAFTS_ENABLED','AUTHOR_FILES_ENABLED','AUTHOR_PUBLISH_ENABLED','READER_SERVICE_ENABLED','READER_DISCOVERY_ENABLED'].map(k=>[k,'true']));
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});},uid=()=>crypto.randomUUID();let pg;
before(async()=>{({db:pg}=await setup());await pg.exec(await readFile(new URL('../database/authoring/015_webtoon.sql',import.meta.url),'utf8'));});after(async()=>pg?.close());
function png(width=800,height=5000,tag){
 const result=Buffer.alloc(tag?57:45);Buffer.from([137,80,78,71,13,10,26,10]).copy(result);result.writeUInt32BE(13,8);result.write('IHDR',12);result.writeUInt32BE(width,16);result.writeUInt32BE(height,20);result[24]=8;result[25]=6;
 if(tag)result.write(tag,37);result.write('IEND',tag?49:37);return result;
}
const rpc=async(name,args)=>(await pg.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args)).rows[0].result;
async function harness(){
 const work=(await rpc('creator_works',[admin,'create',null,JSON.stringify({title:'웹툰',contentType:'WEBTOON'}),uid()])).work.id;
 const calls=[],objects=new Map(),transforms=[];let storageFailure=false,decodeFailure=false,partResponseLost=false,cancelDuringOutput=false;
 const db=async(name,_q,{body:b})=>{
  calls.push({rpc:name,action:b.p_action});let result;
  if(name==='rpc/creator_webtoon')result=await rpc('creator_webtoon',[b.p_user,b.p_action,b.p_work,b.p_id,JSON.stringify(b.p_data)]);
  else if(name==='rpc/stage18_image')result=await rpc('stage18_image',[b.p_episode,b.p_version,b.p_panel,b.p_format]);else throw Error(name);
  if(b.p_action==='part'&&partResponseLost){partResponseLost=false;throw Error('RESPONSE_LOST');}return result;
 };
 const fetchImpl=async(url,options)=>{calls.push({storage:new URL(url).pathname,method:options.method});const path=new URL(url).pathname;
  assert.equal(new URL(url).origin,'https://example.supabase.co');assert.equal(options.headers.apikey,'test-only-service');
  if(options.method==='POST'){if(storageFailure){storageFailure=false;return new Response('',{status:503});}if(objects.has(path))return new Response('',{status:409});objects.set(path,options.body);return new Response('');}
  return objects.has(path)?new Response(objects.get(path)):new Response('',{status:404});
 };
 const images={info:async stream=>{const bytes=new Uint8Array(await new Response(stream).arrayBuffer());if(decodeFailure)throw Error('decoder unavailable');
  if(bytes[0]===137){const info=inspectSource(bytes);return {format:info.type,fileSize:bytes.length,width:info.width,height:info.height};}return JSON.parse(new TextDecoder().decode(bytes));},
  input(){const operations=[];return {transform(options){operations.push(options);return this;},async output(options){transforms.push({operations,options});
   if(cancelDuringOutput){cancelDuringOutput=false;const id=[...objects.keys()][0].split('/').at(-2);await rpc('creator_webtoon',[admin,'cancel',work,id,'{}']);}
   const trim=operations[0].trim;const bytes=new TextEncoder().encode(JSON.stringify({format:options.format,width:operations[1].width,height:5000-trim.top-trim.bottom}));return {response:()=>new Response(bytes)};}};}};
 const run=(action,id,{method=action==='list'?'GET':'POST',body,who=admin,bindings={},query='',headers={},path}={})=>webtoonApi({request:new Request(path||'https://app.test/api/v2/creator/webtoon'+(action==='list'?'':'/'+action+'/'+id)+'?workId='+work+query,
  {method,headers:{Origin:'https://app.test','Idempotency-Key':id||'','Content-Type':'image/png','X-File-Name':encodeURIComponent('원본.png'),...headers},...(body?{body}:{})}),env:{...flags,IMAGES:images,...bindings},
  actor:async()=>({userId:who,author:{id:who===admin?'1':'2',status:'APPROVED'}}),db,fetchImpl,base:'https://example.supabase.co',serviceHeaders:{apikey:'test-only-service'},fail});
 return {work,run,calls,objects,transforms,set storageFailure(v){storageFailure=v;},set decodeFailure(v){decodeFailure=v;},set partResponseLost(v){partResponseLost=v;},set cancelDuringOutput(v){cancelDuringOutput=v;}};
}
test('image policy rejects APNG, truncated PNG, huge pixels, unsupported MIME and keeps unscaled short sources',()=>{
 assert.deepEqual(inspectSource(png(690,500)),{width:690,height:500,type:'image/png'});
 assert.throws(()=>inspectSource(png(800,5000,'acTL')),/STATIC_IMAGE_REQUIRED/);assert.throws(()=>inspectSource(png(800,5000,'eXIf')),/IMAGE_ORIENTATION_REQUIRED/);
 assert.throws(()=>inspectSource(png(12000,12000)),/IMAGE_PIXEL_LIMIT/);assert.throws(()=>inspectSource(png().subarray(0,24)),/IMAGE_INVALID/);
 assert.deepEqual(sliceGeometry(690,500,0),{width:690,height:500,trim:{top:0,right:0,bottom:0,left:0}});
 assert.equal(sliceGeometry(800,8193,2).height,1);assert.equal(sliceGeometry(1600,10000,1).height,904);
});
test('gate, ownership, Origin and unsupported user data fail before storage; payload is streamed with a cap',async()=>{
 const s=await harness(),id=uid();assert.equal(webtoonEnabled(flags),true);
 for(const flag of Object.keys(flags))await assert.rejects(s.run('upload',id,{body:png(),bindings:{[flag]:'false'}}),e=>e.code==='WEBTOON_NOT_ACTIVATED');
 await assert.rejects(s.run('upload',id,{body:png(),who:reader}),e=>e.status===404);
 await assert.rejects(s.run('upload',id,{body:png(),headers:{Origin:'https://evil.test'}}),e=>e.status===403);
 await assert.rejects(s.run('upload',id,{body:png(),query:'&url=https://evil.test/source.png'}),e=>e.status===400);
 await assert.rejects(s.run('upload',id,{body:png(),headers:{'Content-Type':'image/svg+xml'}}),e=>e.status===415);
 await assert.rejects(s.run('upload',id,{body:new Uint8Array(8388609)}),e=>e.status===413);assert.ok(!s.calls.some(c=>c.storage));
});
test('unknown original upload and lost panel commit resume without duplicate objects or replacing original bytes',async()=>{
 const s=await harness(),id=uid();s.storageFailure=true;await assert.rejects(s.run('upload',id,{body:png()}),e=>e.code==='STORAGE_UPLOAD_FAILED');
 assert.equal((await s.run('upload',id,{body:png()})).asset.state,'UPLOADED');const original=[...s.objects.values()][0];
 assert.equal((await s.run('upload',id,{body:png()})).asset.state,'UPLOADED');s.partResponseLost=true;await assert.rejects(s.run('process',id));
 const list=await s.run('list');assert.equal(list.assets[0].cursor,1);assert.equal((await s.run('process',id)).asset.state,'READY');
 assert.equal(s.objects.size,5);assert.deepEqual([...s.objects.values()][0],original);
 assert.deepEqual(s.transforms.map(t=>t.operations[0].trim.top),[0,0,4096,4096]);assert.ok(s.transforms.every(t=>t.options.anim===false));
 const privateImage=(await s.run('list')).assets[0].panels[0].id;
 const response=await s.run('panel',id,{method:'GET',query:'&panelId='+privateImage+'&format=webp'});assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.headers.get('content-type'),'image/webp');
 const source=await s.run('original',id,{method:'GET'});assert.match(source.headers.get('content-disposition'),/^attachment;/);assert.deepEqual(new Uint8Array(await source.arrayBuffer()),new Uint8Array(png()));
});
test('decoder failure remains retryable; cancel during transform prevents READY commit and manifest inclusion',async()=>{
 const s=await harness(),id=uid();await s.run('upload',id,{body:png()});s.decodeFailure=true;await assert.rejects(s.run('process',id),e=>e.code==='IMAGE_PROCESSING_FAILED');
 assert.equal((await s.run('list')).assets[0].state,'FAILED');s.decodeFailure=false;s.cancelDuringOutput=true;
 await assert.rejects(s.run('process',id),e=>e.code==='ASSET_CANCELLED');assert.equal((await s.run('list')).assets[0].state,'CANCELLED');
});
test('public images serve only the current free head and withdrawal rejects the same URL before storage',async()=>{
 const s=await harness(),id=uid();await s.run('upload',id,{body:png()});await s.run('process',id);await s.run('process',id);const a=(await s.run('list')).assets[0];
 const path='https://app.test/api/v2/webtoon/images/100/'+a.panels[0].id+'?versionId='+uid()+'&format=webp';const count=s.calls.filter(c=>c.storage).length;
 await assert.rejects(s.run('panel',id,{method:'GET',path}),e=>e.status===404);assert.equal(s.calls.filter(c=>c.storage).length,count);
 await pg.query("update works set description='소개',genre=array['판타지'] where id=$1",[s.work]);await pg.query('update authoring.work_state set rating_confirmed=true,ai_confirmed=true where work_id=$1',[s.work]);
 const draft=uid(),manifest={schemaVersion:1,assetIds:[id],thumbnailAssetId:id,credits:{artist:'그림'}};
 await rpc('creator_drafts',[admin,'save',s.work,draft,JSON.stringify({title:'1화',content:'',authorComment:'후기',expectedRevision:'0',webtoon:manifest}),uid()]);
 const published=await rpc('creator_publications_v18',[admin,'publish',s.work,draft,null,JSON.stringify({revision:'1',episodeNumber:1,mode:'NOW',rightsConfirmed:true}),uid()]);
 const content=publicContent(await rpc('stage18_episode_content',[published.publication.episodeId]),fail,flags);
 const publicPath='https://app.test'+content.episode.webtoon.panels[0].url;
 const response=await s.run('panel',id,{method:'GET',path:publicPath,who:reader});assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.headers.get('content-type'),'image/webp');assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');
 assert.ok(!JSON.stringify(content).includes('authoring-webtoons'));
 await pg.query("update authoring.work_state set visibility='PRIVATE' where work_id=$1",[s.work]);await pg.query("update works set status='DRAFT' where id=$1",[s.work]);
 const fetched=s.calls.filter(c=>c.storage).length;await assert.rejects(s.run('panel',id,{method:'GET',path:publicPath}),e=>e.status===404);assert.equal(s.calls.filter(c=>c.storage).length,fetched);
});
test('public projection emits only app URLs and whitelisted metadata; NOVEL and panel positions cannot be confused',()=>{
 const version=uid(),p=uid();const m=projectWebtoon({schemaVersion:1,credits:{writer:'<script>','secret':'drop'},panels:[{id:p,assetId:'private',width:800,height:200,bucket:'secret'}],thumbnailAssetId:'private'},'100',version,fail);
 assert.ok(!JSON.stringify(m).includes('secret'));assert.match(m.panels[0].url,/^\/api\/v2\/webtoon\/images\/100\//);assert.equal(m.panels[0].thumbnail,true);
 assert.equal(validReadingPosition({versionId:version,panelIndex:0,offset:0.5},true),true);assert.equal(validReadingPosition({versionId:version,panelIndex:0,offset:0.5}),false);
 assert.throws(()=>projectWebtoon({schemaVersion:1,panels:[{id:p,width:900,height:1}]},'100',version,fail));
});
test('create API only accepts webtoon type with all launch gates enabled',async()=>{
 let body;const request=()=>new Request('https://app.test/api/v2/creator/works',{method:'POST',headers:{Origin:'https://app.test','Idempotency-Key':uid()},body:JSON.stringify({title:'웹툰',contentType:'WEBTOON'})});
 const args={actor:async()=>({userId:admin,author:{status:'APPROVED'}}),readBody:r=>r.json(),fail,db:async(_a,_b,o)=>{body=o.body;return {work:{id:'10'}};}};
 await assert.rejects(creatorWorkApi({...args,request:request(),env:{AUTHOR_WORKS_ENABLED:'true'}}),e=>e.code==='FIELD_NOT_ALLOWED');
 await creatorWorkApi({...args,request:request(),env:flags});assert.equal(body.p_data.contentType,'WEBTOON');assert.equal(body.p_user_id,admin);
});
