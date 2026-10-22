// Pages supports service bindings; the Images binding itself belongs to a Worker.
// Originals stay private: only bytes, never a user-supplied URL, cross this binding.
const unavailable = () => { throw Error('IMAGE_PROCESSOR_NOT_CONFIGURED'); };
const serviceReady = env => typeof env.IMAGE_PROCESSOR?.fetch === 'function' && /^[a-f0-9]{64}$/i.test(env.IMAGE_PROCESSOR_SHARED_SECRET || '');
export const imageProcessorReady = (env, info = false) =>
  !!(env.IMAGES?.input && (!info || env.IMAGES?.info)) || serviceReady(env);

async function call(env, path, bytes) {
  if (!serviceReady(env)) unavailable();
  const response = await env.IMAGE_PROCESSOR.fetch(new Request('https://image-processor.internal' + path, {
    method: 'POST', headers: {'Content-Type': 'application/octet-stream','X-Image-Processor-Key':env.IMAGE_PROCESSOR_SHARED_SECRET}, body: bytes,
    signal: AbortSignal.timeout(25000), redirect: 'manual'
  }));
  if (!response.ok) throw Error('IMAGE_PROCESSING_FAILED');
  return response;
}

export async function imageInfo(env, bytes) {
  if (env.IMAGES?.info) return env.IMAGES.info(new Blob([bytes]).stream());
  const response = await call(env, '/info', bytes);
  const reader=response.body?.getReader();if(!reader) throw Error('IMAGE_PROCESSING_FAILED');
  const chunks=[];let length=0;
  for(;;) {
    const {value,done}=await reader.read();if(done)break;
    length+=value.length;if(length>2048){await reader.cancel();throw Error('IMAGE_PROCESSING_FAILED');}chunks.push(value);
  }
  const text=await new Blob(chunks).text();
  const value = JSON.parse(text);
  if (!value || !['png','jpeg','webp','image/png','image/jpeg','image/webp'].includes(value.format) ||
      !Number.isInteger(value.width) || !Number.isInteger(value.height) || !Number.isInteger(value.fileSize) ||
      value.width < 1 || value.height < 1 || value.width > 12000 || value.height > 12000 ||
      value.width * value.height > 12000000 || value.fileSize !== bytes.length) throw Error('IMAGE_PROCESSING_FAILED');
  return value;
}

export async function coverImage(env, bytes) {
  if (env.IMAGES?.input) {
    const output = await env.IMAGES.input(new Blob([bytes]).stream())
      .transform({width:600,height:900,fit:'cover'}).output({format:'image/jpeg',quality:85,anim:false});
    return output.response();
  }
  return call(env, '/cover', bytes);
}

export async function panelImage(env, bytes, geometry, format) {
  if (env.IMAGES?.input) {
    const output = await env.IMAGES.input(new Blob([bytes]).stream()).transform({trim:geometry.trim})
      .transform({width:geometry.width,fit:'scale-down'}).output({format:'image/'+format,quality:90,anim:false});
    return output.response();
  }
  return call(env, '/panel?' + new URLSearchParams({top:geometry.trim.top,bottom:geometry.trim.bottom,width:geometry.width,format}), bytes);
}
