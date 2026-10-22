import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import processor from '../image-worker/worker.mjs';
import {imageProcessorReady,imageInfo,coverImage,panelImage} from '../server/image-processing.mjs';
import {sliceGeometry} from '../server/webtoon-api.mjs';

// In-memory provider double: validates protocol/geometry, not real Cloudflare decoding.
const encode = (width,height,format='image/png') => new TextEncoder().encode(JSON.stringify({width,height,format}));
const imageSecret='a'.repeat(64);
const decode = async stream => {
  const bytes=new Uint8Array(await new Response(stream).arrayBuffer());
  return {...JSON.parse(new TextDecoder().decode(bytes)),fileSize:bytes.length};
};
function harness() {
  const transforms=[],calls=[];let corrupt=false;
  const images={info:decode,input(stream) {
    const source=decode(stream),ops=[];
    return {transform(op){ops.push(op);return this;},async output(options) {
      const info=await source;let width=info.width,height=info.height;
      for(const op of ops) {
        if(op.trim) height-=op.trim.top+op.trim.bottom;
        if(op.width){height=op.height||Math.round(height*op.width/width);width=op.width;}
      }
      transforms.push({ops,options});
      return {response:()=>new Response(encode(corrupt?12001:width,height,options.format))};
    }};
  }};
  return {images,transforms,calls,set corrupt(v){corrupt=v;},env:{IMAGE_PROCESSOR_SHARED_SECRET:imageSecret,IMAGE_PROCESSOR:{fetch:async request=>{
    calls.push({url:request.url,headers:Object.fromEntries(request.headers)});
    return processor.fetch(request,{IMAGES:images,IMAGE_PROCESSOR_SHARED_SECRET:imageSecret});
  }}}};
}
const request=(path,body=encode(800,5000),headers={})=>new Request('https://image-processor.internal'+path,{
  method:'POST',headers:{'Content-Type':'application/octet-stream','X-Image-Processor-Key':imageSecret,...headers},body
});

test('Pages service adapter processes covers and sequential panels without public source URLs or credentials',async()=>{
  const h=harness();assert.equal(imageProcessorReady(h.env,true),true);assert.equal(imageProcessorReady({},true),false);
  const source=encode(800,5000);
  assert.deepEqual(await imageInfo(h.env,source),{format:'image/png',width:800,height:5000,fileSize:source.length});
  const cover=await coverImage(h.env,encode(600,900));assert.equal(cover.headers.get('content-type'),'image/jpeg');
  for(const index of [0,1]) for(const format of ['webp','png']) {
    const response=await panelImage(h.env,source,sliceGeometry(800,5000,index),format);
    const bytes=new Uint8Array(await response.arrayBuffer()),info=await imageInfo(h.env,bytes);
    assert.equal(info.width,800);assert.equal(info.height,index===0?4096:904);assert.equal(info.format,'image/'+format);
  }
  assert.ok(h.transforms.every(row=>row.options.anim===false));
  assert.ok(h.calls.every(row=>new URL(row.url).origin==='https://image-processor.internal' && !row.headers.authorization && !row.headers.apikey));
});

test('binding rejects unsupported operations, oversized payload, wrong dimensions, tampered slicing and unknown query fields',async()=>{
  const h=harness(),run=r=>processor.fetch(r,{IMAGES:h.images,IMAGE_PROCESSOR_SHARED_SECRET:imageSecret});
  assert.equal((await run(new Request('https://public.example/info',{method:'POST',body:'x'}))).status,404);
  assert.equal((await run(new Request('https://image-processor.internal/info'))).status,405);
  assert.equal((await run(request('/remote?url=https://example.test'))).status,404);
  assert.equal((await run(request('/info',encode(10,10),{'Content-Type':'image/svg+xml'}))).status,415);
  assert.equal((await run(request('/info?url=https://example.test'))).status,400);
  assert.equal((await run(request('/cover',encode(599,900)))).status,400);
  assert.equal((await run(request('/cover',new Uint8Array(2097153)))).status,413);
  assert.equal((await run(request('/panel?top=1&bottom=903&width=800&format=png'))).status,400);
  assert.equal((await run(request('/panel?top=0&bottom=904&width=799&format=png'))).status,400);
  assert.equal((await run(request('/panel?top=0&bottom=904&width=800&format=png&url=x'))).status,400);
  assert.equal((await run(request('/panel?top=0&top=0&bottom=904&width=800&format=png'))).status,400);
  assert.equal((await run(request('/panel?top=0&bottom=904&width=800&format=jpeg'))).status,400);
  assert.equal((await run(request('/info',encode(12000,12000)))).status,400);
  assert.equal((await run(request('/info',encode(10,10),{'X-Image-Processor-Key':'b'.repeat(64)}))).status,403);
  assert.equal(h.transforms.length,0);
});

test('unconfigured/provider errors and malformed output fail closed without provider diagnostics',async()=>{
  assert.equal((await processor.fetch(request('/info'),{IMAGE_PROCESSOR_SHARED_SECRET:imageSecret})).status,503);
  await assert.rejects(coverImage({},encode(600,900)),/IMAGE_PROCESSOR_NOT_CONFIGURED/);
  const h=harness();h.corrupt=true;
  await assert.rejects(coverImage(h.env,encode(600,900)),/IMAGE_PROCESSING_FAILED/);
  const error=await processor.fetch(request('/info'),{IMAGE_PROCESSOR_SHARED_SECRET:imageSecret,IMAGES:{input(){},info(){throw Error('private provider diagnostics');}}});
  assert.equal(error.status,503);assert.equal(await error.text(),'{"error":"IMAGE_PROCESSING_FAILED"}');
  await assert.rejects(imageInfo({IMAGE_PROCESSOR_SHARED_SECRET:imageSecret,IMAGE_PROCESSOR:{fetch:async()=>Response.json({width:1,height:1,format:'image/png',fileSize:1})}},encode(1,1)),/IMAGE_PROCESSING_FAILED/);
  await assert.rejects(imageInfo({IMAGE_PROCESSOR_SHARED_SECRET:imageSecret,IMAGE_PROCESSOR:{fetch:async()=>new Response('x'.repeat(2049))}},encode(1,1)),/IMAGE_PROCESSING_FAILED/);
});

test('direct Images binding preserves existing Worker and test integrations; processor config stays private',async()=>{
  const h=harness();const env={IMAGES:h.images};assert.equal(imageProcessorReady(env,true),true);
  assert.equal((await imageInfo(env,encode(800,5000))).width,800);
  assert.equal((await coverImage(env,encode(600,900))).status,200);
  const panel=await panelImage(env,encode(800,5000),sliceGeometry(800,5000,1),'png');
  assert.equal((await decode(panel.body)).height,904);
  const config=await readFile(new URL('../image-worker/wrangler.toml',import.meta.url),'utf8');
  assert.match(config,/workers_dev\s*=\s*false/);assert.match(config,/preview_urls\s*=\s*false/);
  assert.match(config,/\[images\][\s\S]*binding\s*=\s*"IMAGES"/);assert.doesNotMatch(config,/^\s*routes?\s*=/m);
});
