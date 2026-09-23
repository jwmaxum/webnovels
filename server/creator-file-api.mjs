import '../public/js/creator/file-image.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const decimal=x=>typeof x==='string'&&/^[1-9]\d{0,18}$/.test(x)&&BigInt(x)<=9223372036854775807n;
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
async function limited(request,limit,fail){
 const reader=request.body?.getReader();if(!reader)fail(400,'BODY_REQUIRED');let length=0;const chunks=[];
 while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();fail(413,'FILE_TOO_LARGE');}chunks.push(value);}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
export async function creatorFileApi({request,env,actor,db,fetchImpl,base,serviceHeaders,fail}){
 if(env.AUTHOR_FILES_ENABLED!=='true'||env.AUTHOR_DRAFTS_ENABLED!=='true'||env.AUTHOR_WORKS_ENABLED!=='true')fail(503,'AUTHOR_FILES_NOT_ACTIVATED');
 const url=new URL(request.url),match=url.pathname.match(/^\/api\/v2\/creator\/files(?:\/(import|cover|export|read|cancel|public-cover)(?:\/([^/]+))?)?$/);
 if(!match)fail(404,'NOT_FOUND');const action=match[1]||'list',id=match[2]||null,workId=url.searchParams.get('workId');
 if(Boolean(id)!==['read','cancel','public-cover'].includes(action))fail(404,'NOT_FOUND');
 if([...url.searchParams.keys()].some(k=>k!=='workId')||(action!=='public-cover'&&!decimal(workId))||(id&&!UUID.test(id)))fail(400,'INVALID_ID');
 const publicRead=action==='public-cover';if(publicRead&&(!id||request.method!=='GET'))fail(404,'NOT_FOUND');
 const who=publicRead?null:await actor();if(!publicRead&&who.author?.status!=='APPROVED')fail(403,'AUTHOR_REQUIRED');
 const rpc=async(op,data={},key=id)=>{
  const r=await db('rpc/creator_files',{}, {method:'POST',body:{p_user_id:who?.userId||null,p_action:op,p_work_id:workId,p_id:key,p_data:data}});
  if(r?.error)fail([400,403,404,409,503].includes(r.status)?r.status:503,r.error);if(!r)fail(503,'DATABASE_UNAVAILABLE');return r;
 };
 const storage=async(path,options={})=>fetchImpl(new URL('/storage/v1/'+path,base),{...options,headers:{...serviceHeaders,...options.headers},signal:AbortSignal.timeout(15000)});
 const objectPath=file=>file.bucket+'/'+file.key.split('/').map(encodeURIComponent).join('/');
 if(request.method==='GET'){
  if(action==='list')return rpc('list');if(action==='export')return rpc('export');
  if(['read','public-cover'].includes(action)&&id){
    const file=await rpc(action);if(publicRead){const r=await storage('object/'+objectPath(file));if(!r.ok)fail(503,'STORAGE_UNAVAILABLE');return new Response(r.body,{headers:{'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
    const r=await storage('object/sign/'+objectPath(file),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:60})});
    if(!r.ok)fail(503,'STORAGE_UNAVAILABLE');const value=await r.json(),path=value.signedURL||value.signedUrl;
    if(typeof path!=='string'||!path.startsWith('/object/sign/'))fail(503,'STORAGE_UNAVAILABLE');
    return {url:new URL('/storage/v1'+path,base).href,expiresIn:60};
  }fail(405,'METHOD_NOT_ALLOWED');
 }
 if(request.method!=='POST'||!['import','cover','cancel'].includes(action))fail(405,'METHOD_NOT_ALLOWED');
 if(request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');
 if(action==='cancel'&&id)return rpc('cancel');
 if(id)fail(404,'NOT_FOUND');const key=request.headers.get('Idempotency-Key');if(!UUID.test(key||''))fail(400,'IDEMPOTENCY_KEY_REQUIRED');
 if(!request.headers.get('content-type')?.includes('application/json'))fail(415,'JSON_REQUIRED');
 let body;try{body=JSON.parse(new TextDecoder().decode(await limited(request,9000000,fail)));}catch(e){if(e.status)throw e;fail(400,'INVALID_JSON');}
 const allowed=action==='import'?['filename','bytes','draftId','title','content','order','batchId']:['filename','bytes','cropped','version'];
 if(!body||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k))||typeof body.filename!=='string'||body.filename.length>255)fail(400,'INVALID_FIELD');
 function decode(value,max){if(typeof value!=='string'||value.length>Math.ceil(max/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))fail(400,'INVALID_FILE');let bytes;try{bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));}catch{fail(400,'INVALID_FILE');}if(!bytes.length||bytes.length>max)fail(413,'FILE_TOO_LARGE');return bytes;}
 const original=decode(body.bytes,action==='import'?2097152:4194304);
 // Verify ownership before any external storage or image processing.
 await rpc('authorize');let derivative=null;
 const payload={kind:action==='import'?'IMPORT':'COVER',filename:body.filename,sha256:await sha(original),size:original.length};
 if(action==='import'){
  if(!UUID.test(body.draftId||'')||!UUID.test(body.batchId||'')||typeof body.title!=='string'||body.title.length>200||typeof body.content!=='string'||body.content.length>200000||!Number.isInteger(body.order)||body.order<0||body.order>99)fail(400,'INVALID_FIELD');
  if(!/\.(txt|docx)$/i.test(body.filename))fail(400,'FILE_TYPE_UNSUPPORTED');
  if(/\.docx$/i.test(body.filename)&&!(original[0]===80&&original[1]===75&&original[2]===3&&original[3]===4))fail(400,'DOCX_SIGNATURE_INVALID');
  Object.assign(payload,{draftId:body.draftId,title:body.title,content:body.content,order:body.order,batchId:body.batchId});
 }else{
  if(!decimal(body.version))fail(400,'INVALID_VERSION');
  if(!env.IMAGES?.input)fail(503,'IMAGE_PROCESSOR_NOT_CONFIGURED');
  const cropped=decode(body.cropped,2097152);let info;
  try{globalThis.CreatorFileImage.dimensions(original);info=globalThis.CreatorFileImage.dimensions(cropped);}catch(e){fail(400,e.message);}
  if(info.width!==600||info.height!==900)fail(400,'COVER_CROP_REQUIRED');
  try{const output=await env.IMAGES.input(new Blob([cropped]).stream()).transform({width:600,height:900,fit:'cover'}).output({format:'image/jpeg',quality:85,anim:false});derivative=await limited(output.response(),2097152,fail);}catch(e){if(e.status)throw e;fail(503,'IMAGE_PROCESSING_FAILED');}
  Object.assign(payload,{version:body.version,derivativeSha:await sha(derivative),derivativeSize:derivative.length});
 }
 const prepared=await rpc('prepare',payload,key);if(prepared.state==='COMMITTED')return prepared.result;if(prepared.state==='ABANDONED')fail(409,'IMPORT_CANCELLED');
 async function put(file,bytes,type){
  const r=await storage('object/'+objectPath(file),{method:'POST',headers:{'Content-Type':type,'x-upsert':'false'},body:bytes});
  if(r.ok)return;
  // Unknown previous outcome may have already uploaded this exact immutable object.
  if([400,409].includes(r.status)){const prior=await storage('object/'+objectPath(file));if(prior.ok&&await sha(await limited(prior,4194304,fail))===await sha(bytes))return;}
  fail(503,'STORAGE_UPLOAD_FAILED');
 }
 await put(prepared.original,original,'application/octet-stream');
 if(derivative)await put(prepared.derivative,derivative,'image/jpeg');
 return (await rpc('commit',{},key)).result;
}
