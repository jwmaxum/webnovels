import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../scheduler/worker.mjs';

test('cron invokes service-only scheduler RPC and exposes no HTTP trigger',async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,init)=>{calls.push({url:String(url),init});return Response.json({published:1,failedOrRetrying:0});};
  try {
    const env={AUTHOR_PUBLISH_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'};
    await worker.scheduled({},env,{waitUntil(){}});
    assert.equal(calls.length,1);
    assert.equal(new URL(calls[0].url).pathname,'/rest/v1/rpc/run_creator_schedules');
    assert.equal(calls[0].init.headers.apikey,'sb_secret_test');
    assert.deepEqual(JSON.parse(calls[0].init.body),{p_limit:20});
    assert.equal((await worker.fetch()).status,404);
    await worker.scheduled({},{...env,AUTHOR_PUBLISH_ENABLED:'false'},{waitUntil(){}});
    assert.equal(calls.length,1);
  } finally {globalThis.fetch=original;}
});
