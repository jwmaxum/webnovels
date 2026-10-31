import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {auditDelivery,inventoryDelivery,htmlReferences,headerSummary,normalizeNewlines,validateOrigin} from './audit_ui_delivery.mjs';

const origin='https://webnovels-db4.pages.dev',root=resolve('scratch','ui-delivery-fixture');
const headers={
 'content-type':'text/html; charset=utf-8','cache-control':'no-cache','x-content-type-options':'nosniff',
 'x-frame-options':'DENY','referrer-policy':'strict-origin-when-cross-origin',
 'content-security-policy':"base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
 'content-security-policy-report-only':"script-src 'self'; script-src-attr 'none'"
};
function files(contents){
 const map=new Map(Object.entries(contents).map(([path,value])=>[path,Buffer.from(value)]));
 return {root,pages:['/'],read:async path=>{
  const key='/'+relative(root,path).replaceAll('\\','/');assert(!key.includes('..'),'escaped public root');
  if(!map.has(key))throw Error('NOT_FOUND');return map.get(key);
 },map};
}
const response=(body='',extra={},status=200)=>new Response(body,{status,headers:{...headers,...extra}});

test('default offline inventory reuses existing source references without any HTTP or configuration access',async()=>{
 const fixture=files({'/index.html':'<!doctype html><script src="/js/core/role-modules.js?v=1"></script><script src="/api/public-config.js"></script><script src="/supabase-public-config.js?v=1"></script><link rel="preload" as="font" href="/fonts/main.woff2"><link rel="stylesheet" href="/css/main.css?v=2"><link rel="stylesheet" href="https://fonts.googleapis.com/css?family=PrivateQueryValue">',
  '/js/core/role-modules.js':"const groups={admin:['/js/admin/admin.js?v=3']};",'/js/admin/admin.js':'window.admin=true;',
  '/css/main.css':"@font-face{src:url('/fonts/main.woff2')}",'/fonts/main.woff2':Buffer.from([1,2,3])});
 const report=await auditDelivery({...fixture,fetchImpl:()=>assert.fail('offline inventory made an HTTP request')});
 assert.equal(report.mode,'offline');assert.equal(report.summary.resources,5);assert.equal(report.findings.length,0);
 assert.equal(report.assets.filter(item=>item.kind==='woff2').length,1);assert(report.assets.find(item=>item.path==='/js/admin/admin.js?v=3').sources.includes('lazy-role'));
 assert.equal(report.documents[0].skipped.filter(reason=>reason==='CONFIG_OR_API_EXCLUDED').length,2);
 assert.deepEqual(report.documents[0].external,[{host:'fonts.googleapis.com',role:'stylesheet',blocking:true}]);
 assert(!JSON.stringify(report).includes('PrivateQueryValue'));assert(!report.assets.some(item=>/config|api\//.test(item.path)));
});

test('origin and asset parsing reject credentials, APIs, private endpoints, traversal and unexpected query values',async()=>{
 for(const value of ['http://webnovels-db4.pages.dev','https://user:pass@webnovels-db4.pages.dev','https://127.0.0.1','https://[::1]','https://localhost','https://metadata.google.internal','https://app.test','https://webnovels-db4.pages.dev/api','https://webnovels-db4.pages.dev/?token=PRIVATE','https://webnovels-db4.pages.dev:8443']){
  assert.throws(()=>validateOrigin(value),/INVALID_PUBLIC_ORIGIN/);
  await assert.rejects(auditDelivery({origin:value,fetchImpl:()=>assert.fail('invalid origin dispatched')}),/INVALID_PUBLIC_ORIGIN/);
 }
 assert.equal(validateOrigin(origin+'/'),origin);
 const refs=htmlReferences('<script src="/js/%2e%2e/secret.js"></script><script src="/js/../secret.js"></script><script src="/js/main.js?token=PRIVATE"></script><script src="/api/private.js"></script><script src="//user:pass@external.example/x.js"></script><script src="/js/main.js?v=ok"></script>');
 assert.deepEqual(refs.local.map(item=>item.path),['/js/main.js?v=ok']);assert.equal(refs.skipped.length,5);assert(!JSON.stringify(refs).includes('PRIVATE'));
});

test('disabled stylesheet declarations remain inventoried without being labelled initially blocking',()=>{
 // Static HTML metadata only. Actual request absence is measured in browser
 // resource entries, never inferred as a network result by this parser test.
 const refs=htmlReferences('<link rel="stylesheet" disabled href="https://fonts.googleapis.com/css?family=Noto"><link rel="stylesheet" href="/css/enabled.css"><link rel="stylesheet" disabled="false" href="/css/disabled.css">');
 assert.deepEqual(refs.external,[{host:'fonts.googleapis.com',role:'stylesheet',blocking:false}]);
 assert.deepEqual(refs.local.map(item=>({path:item.path,blocking:item.blocking})),[{path:'/css/enabled.css',blocking:true},{path:'/css/disabled.css',blocking:false}]);
});

test('newline comparison preserves all bytes except CR immediately before LF, including binary font bytes',async()=>{
 assert.deepEqual(normalizeNewlines(Buffer.from([0,255,13,10,13,7])),Buffer.from([0,255,10,13,7]));
 const html='<!doctype html>\n<link rel="stylesheet" href="/css/main.css?v=1"><link rel="preload" as="font" href="/fonts/main.woff2">\n';
 const fixture=files({'/index.html':html,'/css/main.css':'a {\ncolor:red;\n}\n','/fonts/main.woff2':Buffer.from([13,10])});
 const calls=[],report=await auditDelivery({...fixture,origin,fetchImpl:async(url,options)=>{
  const key=url.pathname+url.search;calls.push([key,options]);
  if(url.pathname==='/')return response(html.replaceAll('\n','\r\n'));
  if(url.pathname.endsWith('.css'))return response('a {\r\ncolor:red;\r\n}\r\n',{'content-type':'text/css'});
  return response(Buffer.from([10]),{'content-type':'font/woff2'});
 }});
 assert.equal(report.assets.find(item=>item.path==='/').matchesLocal,true);assert.equal(report.assets.find(item=>item.kind==='css').matchesLocal,true);
 assert.equal(report.assets.find(item=>item.kind==='woff2').matchesLocal,false);assert(report.findings.some(item=>item.code==='DEPLOYED_CONTENT_DIFFERS'));
 assert(calls.every(([,options])=>options.method==='GET'&&options.redirect==='manual'&&options.credentials==='omit'&&!Object.keys(options.headers).some(key=>/authorization|cookie|apikey/i.test(key))));
});

test('compression metadata reports actual Content-Length only and never invents gzip/Brotli transfer sizes',async()=>{
 const fixture=files({'/index.html':'<!doctype html><script src="/js/a.js"></script><script src="/js/b.js"></script>','/js/a.js':'a();','/js/b.js':'b();'});
 const report=await auditDelivery({...fixture,origin,fetchImpl:async url=>url.pathname==='/'?response(fixture.map.get('/index.html'),{'content-encoding':'br','content-length':'41'}):
  response(url.pathname.endsWith('a.js')?'a();':'b();',{'content-type':'text/javascript','content-encoding':'gzip',...(url.pathname.endsWith('a.js')?{'content-length':'24'}:{})})});
 assert.equal(report.assets[0].remote.encodedBytesFromContentLength,41);assert.equal(report.assets[0].remote.decodedBytes,fixture.map.get('/index.html').length);
 assert.equal(report.assets.find(item=>item.path==='/js/a.js').remote.encodedBytesFromContentLength,24);
 assert.equal(report.assets.find(item=>item.path==='/js/b.js').remote.encodedBytesFromContentLength,null);
 assert.equal(report.summary.compressedLengthReported,2);
 assert.match(report.measurement,/no browser paint/);
});

test('enforced document protections and report-only script policy are reported separately',()=>{
 const result=headerSummary(new Headers(headers));assert.equal(result.csp.scriptControlEnforced,false);assert.equal(result.csp.scriptControlReportOnly,true);
 assert.equal(result.csp.baseRestricted,true);assert.equal(result.csp.objectNone,true);assert.equal(result.csp.frameAncestorsNone,true);assert.equal(result.cache.revalidates,true);
 const explicit=headerSummary(new Headers({'content-security-policy':"default-src 'self'",'cache-control':'public, max-age=31536000, immutable'}));
 assert.equal(explicit.csp.scriptControlEnforced,true);assert.equal(explicit.csp.scriptControlReportOnly,false);assert.equal(explicit.cache.maxAge,31536000);assert.equal(explicit.cache.immutable,true);
});

test('CSP baseline checks reject widened source lists and fail closed for combined policies',()=>{
 for(const policy of [
  "base-uri 'self' https://example.com; object-src 'none' https://example.com; frame-ancestors 'none' https://example.com",
  "base-uri 'self'; object-src 'none'; frame-ancestors 'none', base-uri https://example.com"
 ]){
  const csp=headerSummary(new Headers({'content-security-policy':policy})).csp;
  assert.equal(csp.baseRestricted,false);assert.equal(csp.objectNone,false);assert.equal(csp.frameAncestorsNone,false);
 }
 const strict=headerSummary(new Headers({'content-security-policy':"base-uri 'none'; object-src 'none'; frame-ancestors 'none'"})).csp;
 assert.equal(strict.baseRestricted,true);assert.equal(strict.objectNone,true);assert.equal(strict.frameAncestorsNone,true);
});

test('reference drift includes version and script-order differences without fetching the deployed-only assets',async()=>{
 const html='<!doctype html><script src="/js/a.js?v=2"></script><script src="/js/b.js?v=1"></script>',fixture=files({'/index.html':html,'/js/a.js':'a();','/js/b.js':'b();'}),calls=[];
 const report=await auditDelivery({...fixture,origin,fetchImpl:async url=>{
  calls.push(url.pathname+url.search);return response(url.pathname==='/'?html.replace('/js/a.js?v=2','/js/old.js?v=1'):url.pathname.endsWith('a.js')?'a();':'b();',url.pathname==='/'?{}:{'content-type':'application/javascript'});
 }});
 const entry=report.assets[0];assert.deepEqual(entry.referenceDifferences.localOnly,['/js/a.js?v=2']);assert.deepEqual(entry.referenceDifferences.deployedOnly,['/js/old.js?v=1']);
 assert.equal(entry.referenceDifferences.orderMatches,false);assert(!calls.some(path=>path.includes('old.js')));assert(report.findings.some(item=>item.code==='DOCUMENT_REFERENCES_DIFFER'));
 const swapped=await auditDelivery({...fixture,origin,fetchImpl:async url=>response(url.pathname==='/'?'<!doctype html><script src="/js/b.js?v=1"></script><script src="/js/a.js?v=2"></script>':url.pathname.endsWith('a.js')?'a();':'b();',url.pathname==='/'?{}:{'content-type':'text/javascript'})});
 assert.equal(swapped.assets[0].referenceDifferences.localOnly.length,0);assert.equal(swapped.assets[0].referenceDifferences.orderMatches,false);
});

test('SRI is checked against actual asset bytes while bad MIME and missing headers remain visible',async()=>{
 const script='window.safe=true;',sri='sha384-'+createHash('sha384').update(script).digest('base64');
 const fixture=files({'/index.html':`<!doctype html><script src="/js/a.js" integrity="${sri}"></script>`,'/js/a.js':script});
 const local=await inventoryDelivery(fixture);assert.equal(local.findings.length,0);
 const report=await auditDelivery({...fixture,origin,fetchImpl:async url=>url.pathname==='/'?response(fixture.map.get('/index.html')):new Response('window.safe=false;',{headers:{'content-type':'text/html'}})});
 for(const code of ['DEPLOYED_CONTENT_DIFFERS','DEPLOYED_INTEGRITY_MISMATCH','CONTENT_TYPE_MISMATCH','NOSNIFF_MISSING'])assert(report.findings.some(item=>item.code===code),code);
});

test('network/server retries are bounded, redirects are never followed and large decoded bodies stop without retry',async()=>{
 const fixture=files({'/index.html':'<!doctype html>'});let attempts=0;
 const outage=await auditDelivery({...fixture,origin,fetchImpl:async()=>{attempts++;return response('',{},503);}});assert.equal(attempts,2);assert.equal(outage.assets[0].remote.attempts,2);
 attempts=0;const network=await auditDelivery({...fixture,origin,fetchImpl:async()=>{attempts++;throw Error('untrusted provider details');}});
 assert.equal(attempts,2);assert.equal(network.assets[0].remote.error,'PUBLIC_FETCH_UNAVAILABLE');assert(!JSON.stringify(network).includes('untrusted provider'));
 attempts=0;const redirect=await auditDelivery({...fixture,origin,fetchImpl:async(_url,options)=>{attempts++;assert.equal(options.redirect,'manual');return response('',{location:'https://private.example/?token=PRIVATE'},302);}});
 assert.equal(attempts,1);assert.equal(redirect.assets[0].remote.error,'REDIRECT_NOT_FOLLOWED');assert(!JSON.stringify(redirect).includes('PRIVATE'));
 attempts=0;const large=await auditDelivery({...fixture,origin,maxBytes:4,fetchImpl:async()=>{attempts++;return response('12345');}});
 assert.equal(attempts,1);assert.equal(large.assets[0].remote.error,'RESPONSE_BODY_LIMIT');
});

test('asset inventory budget fails explicitly and worker concurrency stays capped at four',async()=>{
 const html='<!doctype html>'+Array.from({length:8},(_,i)=>`<script src="/js/${i}.js"></script>`).join(''),fixture=files({'/index.html':html,...Object.fromEntries(Array.from({length:8},(_,i)=>['/js/'+i+'.js','x();']))});
 await assert.rejects(inventoryDelivery({...fixture,maxAssets:3}),/ASSET_LIMIT_EXCEEDED/);
 let inFlight=0,maximum=0;
 const report=await auditDelivery({...fixture,origin,concurrency:99,fetchImpl:async url=>{inFlight++;maximum=Math.max(maximum,inFlight);await new Promise(resolve=>setImmediate(resolve));inFlight--;
  return response(url.pathname==='/'?html:'x();',url.pathname==='/'?{}:{'content-type':'text/javascript'});
 }});
 assert.equal(report.summary.liveChecked,9);assert(maximum<=4);assert(maximum>1);
});

test('selective rechecks fetch only known inventory resources and distinguish unavailable from checked bytes',async()=>{
 const fixture=files({'/index.html':'<!doctype html><script src="/js/a.js?v=1"></script><link rel="preload" as="font" href="/fonts/main.woff2">','/js/a.js':'a();','/fonts/main.woff2':Buffer.from([1,2,3])}),calls=[];
 const report=await auditDelivery({...fixture,origin,onlyPaths:['/js/a.js?v=1'],fetchImpl:async url=>{calls.push(url.pathname+url.search);return response('a();',{'content-type':'text/javascript'});}});
 assert.equal(report.scope,'selected-resources');assert.deepEqual(calls,['/js/a.js?v=1']);assert.equal(report.summary.resources,3);assert.equal(report.summary.requested,1);assert.equal(report.summary.liveChecked,1);assert.equal(report.summary.matched,1);
 await assert.rejects(auditDelivery({...fixture,origin,onlyPaths:['/api/private.js'],fetchImpl:()=>assert.fail('unknown selection dispatched')}),/UNKNOWN_INVENTORY_RESOURCE/);
 await assert.rejects(auditDelivery({...fixture,onlyPaths:['/js/a.js?v=1']}),/INVALID_RESOURCE_SELECTION/);
 const failed=await auditDelivery({...fixture,origin,onlyPaths:['/js/a.js?v=1'],fetchImpl:async()=>{throw Error('offline');}});
 assert.equal(failed.summary.requested,1);assert.equal(failed.summary.liveChecked,0);assert.equal(failed.summary.unavailable,1);assert.equal(failed.summary.matched,0);
});
