// Private service-binding target. Keep workers.dev, preview URLs and public routes disabled.
// No storage credentials, arbitrary URLs, user-selected processing operations, or logging.
const LIMIT = 16777216;
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers:{
  'Content-Type':'application/json', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'
}});
class Rejection extends Error { constructor(status) { super('IMAGE_REQUEST_REJECTED'); this.status=status; } }
const reject = status => {throw new Rejection(status);};
function authorized(request,env) {
  const expected=env.IMAGE_PROCESSOR_SHARED_SECRET,actual=request.headers.get('X-Image-Processor-Key');
  if(!/^[a-f0-9]{64}$/i.test(expected||'') || !/^[a-f0-9]{64}$/i.test(actual||''))return false;
  let difference=0;for(let i=0;i<64;i++)difference|=actual.charCodeAt(i)^expected.charCodeAt(i);
  return difference===0;
}
async function read(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) reject(413);
  const reader=request.body?.getReader(); if(!reader) reject(400);
  const chunks=[]; let size=0;
  for(;;) {
    const {value,done}=await reader.read(); if(done) break;
    size+=value.length; if(size>limit) {await reader.cancel();reject(413);} chunks.push(value);
  }
  if(!size) reject(400);
  const bytes=new Uint8Array(size);let offset=0;
  for(const part of chunks) {bytes.set(part,offset);offset+=part.length;}
  return bytes;
}
const mime = value => value?.startsWith('image/') ? value : 'image/'+value;
async function inspect(env, bytes) {
  const result=await env.IMAGES.info(new Blob([bytes]).stream());
  if(!['image/png','image/jpeg','image/webp'].includes(mime(result?.format)) ||
     !Number.isInteger(result.width) || !Number.isInteger(result.height) || result.width<1 || result.height<1 ||
     result.width>12000 || result.height>12000 || result.width*result.height>12000000 || result.fileSize!==bytes.length) reject(400);
  return {format:mime(result.format),width:result.width,height:result.height,fileSize:result.fileSize};
}
export default {
  async fetch(request, env) {
    try {
      const url=new URL(request.url);
      if(url.origin!=='https://image-processor.internal' || !['/info','/cover','/panel'].includes(url.pathname)) return json({error:'NOT_FOUND'},404);
      if(request.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
      if(!authorized(request,env)) return json({error:'FORBIDDEN'},403);
      if(request.headers.get('content-type')!=='application/octet-stream') reject(415);
      if(!env.IMAGES?.info || !env.IMAGES?.input) return json({error:'IMAGE_PROCESSOR_NOT_CONFIGURED'},503);
      if(url.pathname!=='/panel' && url.search) reject(400);
      if(url.pathname==='/panel' && (['top','bottom','width','format'].some(k=>url.searchParams.getAll(k).length!==1) ||
         [...url.searchParams.keys()].some(k=>!['top','bottom','width','format'].includes(k)))) reject(400);
      const bytes=await read(request,url.pathname==='/cover'?2097152:url.pathname==='/panel'?8388608:LIMIT);
      const info=await inspect(env,bytes);
      if(url.pathname==='/info') return json(info);
      if(!['image/png','image/jpeg'].includes(info.format)) reject(415);
      let pipeline=env.IMAGES.input(new Blob([bytes]).stream()), format, quality;
      if(url.pathname==='/cover') {
        if(info.width!==600 || info.height!==900) reject(400);
        pipeline=pipeline.transform({width:600,height:900,fit:'cover'});format='image/jpeg';quality=85;
      } else {
        const value=k=>{const s=url.searchParams.get(k);if(!/^(0|[1-9]\d{0,4})$/.test(s||''))reject(400);return Number(s);};
        const top=value('top'),bottom=value('bottom'),width=value('width'), output=url.searchParams.get('format');
        const target=Math.min(800,info.width),step=Math.floor(4096*info.width/target);
        if(!['webp','png'].includes(output) || width!==target || top>=info.height || top%step!==0 ||
           bottom!==Math.max(0,info.height-top-step)) reject(400);
        pipeline=pipeline.transform({trim:{top,right:0,bottom,left:0}}).transform({width,fit:'scale-down'});
        format='image/'+output;quality=90;
      }
      const transformed=await pipeline.output({format,quality,anim:false});
      const output=await read(transformed.response(),LIMIT);
      const verified=await inspect(env,output);
      if(verified.format!==format || (url.pathname==='/cover' && (verified.width!==600 || verified.height!==900)) ||
         (url.pathname==='/panel' && (verified.width!==Math.min(800,info.width) || verified.height>4096))) reject(502);
      return new Response(output,{headers:{'Content-Type':format,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    } catch(error) {
      return json({error:error instanceof Rejection?'IMAGE_REQUEST_REJECTED':'IMAGE_PROCESSING_FAILED'},error instanceof Rejection?error.status:503);
    }
  }
};
