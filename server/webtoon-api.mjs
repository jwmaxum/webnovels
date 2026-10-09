// Private originals, immutable derivatives, resumable one-panel processing. No remote URL input.
import '../public/js/creator/file-image.js';
export const webtoonEnabled=env=>env.WEBTOON_SERVICE_ENABLED==='true' &&
 ['P0_API_ENABLED','AUTHOR_WORKS_ENABLED','AUTHOR_DRAFTS_ENABLED','AUTHOR_FILES_ENABLED','AUTHOR_PUBLISH_ENABLED','READER_SERVICE_ENABLED','READER_DISCOVERY_ENABLED'].every(k=>env[k]==='true');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=x=>typeof x==='string'&&/^[1-9]\d{0,18}$/.test(x)&&BigInt(x)<=9223372036854775807n;
export const imageHash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
export async function readBytes(request,max,fail){
 const reader=request.body?.getReader();if(!reader)fail(400,'BODY_REQUIRED');const chunks=[];let size=0;
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();fail(413,'FILE_TOO_LARGE');}chunks.push(value);}
 if(!size)fail(400,'BODY_REQUIRED');const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}return bytes;
}
export function inspectSource(bytes){
 const info=globalThis.CreatorFileImage.dimensions(bytes,{maxEdge:12000});
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(info.type==='image/png'){
  let end=false;
  for(let pos=8;pos+12<=bytes.length;){const size=view.getUint32(pos),tag=view.getUint32(pos+4);if(pos+12+size>bytes.length)throw Error('IMAGE_INVALID');
   if(tag===0x6163544c)throw Error('STATIC_IMAGE_REQUIRED'); // APNG acTL
   if(tag===0x65584966)throw Error('IMAGE_ORIENTATION_REQUIRED'); // PNG eXIf: export flattened pixels
   pos+=12+size;if(tag===0x49454e44){end=pos===bytes.length;break;}}
  if(!end)throw Error('IMAGE_INVALID');
 }else{
  let pos=2;
  while(pos+4<=bytes.length){if(bytes[pos++]!==255)throw Error('IMAGE_INVALID');while(bytes[pos]===255)pos++;const marker=bytes[pos++];if(marker===218||marker===217)break;
   const size=view.getUint16(pos);if(size<2||pos+size>bytes.length)throw Error('IMAGE_INVALID');
   if(marker===225&&size>=8&&view.getUint32(pos+2)===0x45786966&&view.getUint16(pos+6)===0){
    const base=pos+8,end=pos+size;if(base+8>end)throw Error('IMAGE_INVALID');const order=view.getUint16(base);if(![0x4949,0x4d4d].includes(order))throw Error('IMAGE_INVALID');const little=order===0x4949;
    if(view.getUint16(base+2,little)!==42)throw Error('IMAGE_INVALID');const first=base+view.getUint32(base+4,little);if(first<base+8||first+2>end)throw Error('IMAGE_INVALID');
    const count=view.getUint16(first,little);if(first+2+count*12+4>end)throw Error('IMAGE_INVALID');
    for(let i=0;i<count;i++){const at=first+2+i*12;if(view.getUint16(at,little)===0x112 &&
      (view.getUint16(at+2,little)!==3||view.getUint32(at+4,little)!==1||view.getUint16(at+8,little)!==1))throw Error('IMAGE_ORIENTATION_REQUIRED');}
   }pos+=size;
  }
 }
 return info;
}
export function sliceGeometry(width,height,index){
 const target=Math.min(800,width),step=Math.floor(4096*width/target),top=index*step,sourceHeight=Math.min(step,height-top);
 if(sourceHeight<=0)throw Error('INVALID_PANEL');
 return {width:target,height:Math.max(1,Math.round(sourceHeight*target/width)),trim:{top,right:0,bottom:height-top-sourceHeight,left:0}};
}
export function projectWebtoon(value,episodeId,versionId,fail){
 if(!value||value.schemaVersion!==1||!Array.isArray(value.panels)||!value.panels.length||value.panels.length>300||!UUID.test(versionId||'')||!id(episodeId))fail(503,'WEBTOON_UNAVAILABLE');
 const thumbnailId=value.panels.find(p=>p.assetId===value.thumbnailAssetId)?.id;
 const seen=new Set();const panels=value.panels.map(p=>{
  if(!UUID.test(p.id||'')||seen.has(p.id)||!Number.isInteger(p.width)||p.width<1||p.width>800||!Number.isInteger(p.height)||p.height<1||p.height>4096)fail(503,'WEBTOON_UNAVAILABLE');seen.add(p.id);
  const path='/api/v2/webtoon/images/'+episodeId+'/'+p.id+'?versionId='+versionId;
  return {id:p.id,width:p.width,height:p.height,url:path+'&format=webp',fallbackUrl:path+'&format=png',thumbnail:p.id===thumbnailId};
 });
 const credits={};for(const k of ['writer','artist','original'])if(typeof value.credits?.[k]==='string'&&value.credits[k].length<=100)credits[k]=value.credits[k];
 return {schemaVersion:1,panels,credits};
}
export async function webtoonApi({request,env,actor,db,fetchImpl,base,serviceHeaders,fail}){
 if(!webtoonEnabled(env))fail(503,'WEBTOON_NOT_ACTIVATED');
 const url=new URL(request.url);
 const rpc=async(name,body)=>{const r=await db('rpc/'+name,{}, {method:'POST',body});if(r?.error)fail([400,403,404,409].includes(r.status)?r.status:503,r.error);if(!r)fail(503,'DATABASE_UNAVAILABLE');return r;};
 const storage=(bucket,path,options={})=>fetchImpl(new URL('/storage/v1/object/'+bucket+'/'+path.split('/').map(encodeURIComponent).join('/'),base),{
  ...options,headers:{...serviceHeaders,...options.headers},signal:AbortSignal.timeout(20000)});
 async function sendFile(file,type,attachment=false){
  if(!['authoring-originals','authoring-webtoons'].includes(file.bucket)||!/^webtoon\/[1-9]\d*\/[0-9a-f-]{36}\/(?:source|[0-2]\/[a-f0-9]{64}\.(?:webp|png))$/.test(file.path||''))fail(503,'STORAGE_UNAVAILABLE');
  const response=await storage(file.bucket,file.path);if(!response.ok)fail(503,'STORAGE_UNAVAILABLE');
  return new Response(response.body,{headers:{'Content-Type':type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin',
   ...(attachment?{'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(file.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())}:{})}});
 }
 const publicMatch=url.pathname.match(/^\/api\/v2\/webtoon\/images\/(\d+)\/([^/]+)$/);
 if(publicMatch){
  if(request.method!=='GET')fail(405,'METHOD_NOT_ALLOWED');
  const version=url.searchParams.get('versionId'),format=url.searchParams.get('format');
  if(!id(publicMatch[1])||!UUID.test(publicMatch[2])||!UUID.test(version||'')||!['webp','png'].includes(format)||
   [...url.searchParams.keys()].some(k=>!['versionId','format'].includes(k)||url.searchParams.getAll(k).length!==1))fail(400,'INVALID_QUERY');
  const file=await rpc('stage18_image',{p_episode:publicMatch[1],p_version:version,p_panel:publicMatch[2],p_format:format});
  return sendFile(file,'image/'+format);
 }
 const match=url.pathname.match(/^\/api\/v2\/creator\/webtoon(?:\/(upload|process|cancel|original|panel)\/([^/]+))?$/);
 if(!match)fail(404,'NOT_FOUND');const action=match[1]||'list',assetId=match[2]||null,work=url.searchParams.get('workId');
 if(!id(work)||(assetId&&!UUID.test(assetId))||[...url.searchParams.keys()].some(k=>!['workId','panelId','format'].includes(k)||url.searchParams.getAll(k).length!==1))fail(400,'INVALID_QUERY');
 const who=await actor();if(who.author?.status!=='APPROVED')fail(403,'AUTHOR_REQUIRED');
 const call=(op,data={})=>rpc('creator_webtoon',{p_user:who.userId,p_action:op,p_work:work,p_id:assetId,p_data:data});
 if(request.method==='GET'){
  if(action==='list')return call('list');
  if(action==='original')return sendFile(await call('read-original'),'application/octet-stream',true);
  if(action==='panel'){
   const panel=url.searchParams.get('panelId'),format=url.searchParams.get('format');if(!UUID.test(panel||'')||!['png','webp'].includes(format))fail(400,'INVALID_QUERY');
   return sendFile(await call('read-panel',{panelId:panel,format}),'image/'+format);
  }fail(405,'METHOD_NOT_ALLOWED');
 }
 if(request.method!=='POST'||!['upload','process','cancel'].includes(action))fail(405,'METHOD_NOT_ALLOWED');
 if(request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');
 if(action==='cancel')return call('cancel');
 if(action==='upload'){
  if(request.headers.get('Idempotency-Key')!==assetId)fail(400,'IDEMPOTENCY_KEY_REQUIRED');
  const mime=request.headers.get('content-type');if(!['image/png','image/jpeg'].includes(mime))fail(415,'IMAGE_TYPE_REQUIRED');
  let name;try{name=decodeURIComponent(request.headers.get('X-File-Name')||'');}catch{fail(400,'INVALID_FILENAME');}
  if(!name||name.length>200||/[\x00-\x1f\x7f/\\]/.test(name))fail(400,'INVALID_FILENAME');
  await call('authorize');const bytes=await readBytes(request,8388608,fail);let info;
  try{info=inspectSource(bytes);}catch(e){fail(400,e.message);}
  if(info.type!==mime)fail(400,'IMAGE_TYPE_MISMATCH');
  const digest=await imageHash(bytes),prepared=await call('prepare',{name,sha:digest,bytes:bytes.length,mime,width:info.width,height:info.height});
  if(prepared.asset.state!=='PREPARED')return prepared;
  await put('authoring-originals','webtoon/'+work+'/'+assetId+'/source',bytes,'application/octet-stream',digest);
  return call('uploaded');
 }
 async function put(bucket,path,bytes,mime,digest){
  const response=await storage(bucket,path,{method:'POST',headers:{'Content-Type':mime,'x-upsert':'false'},body:bytes});if(response.ok)return;
  if([400,409].includes(response.status)){const prior=await storage(bucket,path);if(prior.ok&&await imageHash(await readBytes(prior,16777216,fail))===digest)return;}
  fail(503,'STORAGE_UPLOAD_FAILED');
 }
 if(!env.IMAGES?.input||!env.IMAGES?.info)fail(503,'IMAGE_PROCESSOR_NOT_CONFIGURED');
 const job=await call('claim');if(job.asset.state==='READY')return job;
 try{
  const source=await storage('authoring-originals',job.source);if(!source.ok)fail(503,'STORAGE_UNAVAILABLE');
  const bytes=await readBytes(source,8388608,fail);if(await imageHash(bytes)!==job.sha)fail(409,'SOURCE_HASH_MISMATCH');
  const header=inspectSource(bytes),info=await env.IMAGES.info(new Blob([bytes]).stream());
  const mime=value=>value?.startsWith('image/')?value:'image/'+value;
  if(mime(info.format)!==header.type||info.fileSize!==bytes.length||info.width!==header.width||info.height!==header.height||info.width!==job.asset.width||info.height!==job.asset.height)fail(400,'IMAGE_DECODE_MISMATCH');
  const geometry=sliceGeometry(info.width,info.height,job.asset.cursor),hashes={};let finalHeight=null;
  // At most one decoded panel/output is held at a time. Hash paths preserve retry outputs.
  for(const format of ['webp','png']){
   const output=await env.IMAGES.input(new Blob([bytes]).stream()).transform({trim:geometry.trim}).transform({width:geometry.width,fit:'scale-down'})
    .output({format:'image/'+format,quality:90,anim:false});
   const derivative=await readBytes(output.response(),16777216,fail),digest=await imageHash(derivative);
   const actual=await env.IMAGES.info(new Blob([derivative]).stream());
   if(mime(actual.format)!=='image/'+format||actual.width!==geometry.width||!Number.isInteger(actual.height)||actual.height<1||actual.height>4096||Math.abs(actual.height-geometry.height)>1||
    (finalHeight!==null&&finalHeight!==actual.height))fail(503,'IMAGE_OUTPUT_MISMATCH');finalHeight=actual.height;
   await put('authoring-webtoons','webtoon/'+work+'/'+assetId+'/'+job.asset.cursor+'/'+digest+'.'+format,derivative,'image/'+format,digest);hashes[format+'Sha']=digest;
  }
  return await call('part',{lease:job.lease,part:job.asset.cursor,width:geometry.width,height:finalHeight,...hashes});
 }catch(error){await call('fail',{lease:job.lease}).catch(()=>{});if(error.status)throw error;fail(503,'IMAGE_PROCESSING_FAILED');}
}
