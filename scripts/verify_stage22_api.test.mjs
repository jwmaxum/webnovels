import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {growthApi,measurementEnabled,sitemapBucket} from '../server/growth-api.mjs';
import {growthSeo} from '../server/growth-seo.mjs';
import {createSecureApi} from '../server/secure-api.mjs';
import {onRequestGet} from '../functions/api/public-config.js';
import {onRequest as partition} from '../functions/sitemaps/[bucket]/index.xml.js';
import worker from '../scheduler/worker.mjs';
const {assess}=createRequire(import.meta.url)('./audit_stage22_launch.cjs');
const user='22222222-2222-4222-8222-222222222222',receipt='ffffffff-ffff-4fff-8fff-ffffffffffff';
const env={P0_API_ENABLED:'true',GROWTH_SERVICE_ENABLED:'true',GROWTH_MEASUREMENT_ENABLED:'true',AUTHOR_PUBLISH_ENABLED:'true',READER_SERVICE_ENABLED:'true',READER_DISCOVERY_ENABLED:'true',
 SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fixture',GROWTH_CANONICAL_ORIGIN:'https://example.test'};
const who={userId:user,reader:{status:'ACTIVE'}},fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
const work={id:'35',title:'공개',author_id:'1',author:'작가',genre:['판타지'],content_type:'NOVEL',status:'PUBLISHED',rating:'ALL'};
const ep={id:'300',work_id:'35',episode_number:1,title:'회차',status:'PUBLISHED',is_free:true,access_policy:'FREE',versionId:receipt,content:'본문',image_urls:[]};
function api(action,{data,query='',role='reader',settings={},identity=who,result={},headers={}}={}){
 const calls=[];return {calls,promise:growthApi({env:{...env,...settings},actor:async()=>identity,fail,readBody:r=>r.json(),
 request:new Request('https://example.test/api/v2/'+(role==='seo'?'growth/seo':role+'/growth')+'?action='+action+query,
  {method:data?'POST':'GET',headers:{...(data?{origin:'https://example.test','content-type':'application/json'}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})}),
 db:async(route,q,init)=>{calls.push({route,body:init.body});return result;}})};}
const seoFetch=result=>async url=>new URL(url).pathname.endsWith('p0_migration_status')?Response.json([{version:'p0-20260921',phase:'locked'}]):Response.json(result);
test('measurement requires all gates, and public config exposes only opt-in booleans',async()=>{
 for(const key of ['P0_API_ENABLED','GROWTH_SERVICE_ENABLED','GROWTH_MEASUREMENT_ENABLED','AUTHOR_PUBLISH_ENABLED','READER_SERVICE_ENABLED','READER_DISCOVERY_ENABLED'])assert.equal(measurementEnabled({...env,[key]:'false'}),false);
 await assert.rejects(api('viewport',{data:{receiptId:receipt},settings:{GROWTH_MEASUREMENT_ENABLED:'false'}}).promise,{status:503});
 const r=onRequestGet({env:{...env,NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_fixture'}});assert.match(await r.text(),/"growthMeasurementEnabled":true/);
 const off=onRequestGet({env:{...env,GROWTH_MEASUREMENT_ENABLED:'false',NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_fixture'}});assert.match(await off.text(),/"growthMeasurementEnabled":false/);
 assert.equal((await partition({request:new Request('https://example.test/sitemaps/0/index.xml'),env:{},params:{bucket:'0'}})).status,503);
});
test('tracking rejects arbitrary sources/time/identity, wrong method/origin/role and server-derives webtoon scope',async()=>{
 const ok=api('viewport',{data:{receiptId:receipt},result:{recorded:true}});await ok.promise;assert.equal(ok.calls[0].route,'rpc/stage22_growth');assert.equal(ok.calls[0].body.p_user,user);assert.equal(ok.calls[0].body.p_data.webtoon,false);
 for(const data of [{receiptId:receipt,userId:user},{receiptId:'bad'},{receiptId:receipt,timestamp:0}])await assert.rejects(api('viewport',{data}).promise,{status:400});
 for(const data of [{workId:'35',source:'https://private.test'},{workId:35,source:'SHARE'},{workId:'35',source:'SHARE',referrer:'private'}])await assert.rejects(api('referral',{data}).promise,{status:400});
 await assert.rejects(api('referral',{data:{workId:'35',source:'SHARE'},headers:{origin:'https://other.test'}}).promise,{status:403});
 await assert.rejects(api('viewport').promise,{status:405});await assert.rejects(api('viewport',{data:{receiptId:receipt},identity:{userId:user}}).promise,{status:403});
 await assert.rejects(api('viewport',{role:'creator',data:{receiptId:receipt}}).promise,{status:400});
 await assert.rejects(api('viewport',{data:{receiptId:receipt},result:{error:'RATE_LIMITED',status:429}}).promise,{status:429});
 await assert.rejects(api('admin',{role:'admin',identity:{userId:user,admin:{role:'SUPER_ADMIN',is_active:true}},result:{viewportEvidence:Array(61).fill({})}}).promise,{status:503});
});
test('additional consent is explicit and legacy clients/flag-off feeds cannot acquire receipts',async()=>{
 const p={excludedGenres:[],frequency:'OFF',analyticsConsent:true};await api('save-preferences',{data:p}).promise;
 await api('save-preferences',{data:{...p,measurementConsent:true}}).promise;
 await assert.rejects(api('save-preferences',{data:{...p,analyticsConsent:false,measurementConsent:true}}).promise,{status:400});
 await assert.rejects(api('save-preferences',{data:{...p,measurementConsent:true},settings:{GROWTH_MEASUREMENT_ENABLED:'false'}}).promise,{status:400});
 const result={works:[{...work,receiptId:receipt,private:'HIDDEN'}],analyticsConsent:true,measurementConsent:true};
 const on=await api('feed',{data:{},result}).promise;assert.equal(on.works[0].receiptId,receipt);assert.equal(on.works[0].private,undefined);
 const off=api('feed',{data:{},result,settings:{GROWTH_MEASUREMENT_ENABLED:'false'}});assert.equal((await off.promise).works[0].receiptId,undefined);assert.equal(off.calls[0].route,'rpc/stage21_growth');
});
test('first body uses the same authenticated content RPC; flag-off keeps existing content route',async()=>{
 for(const enabled of [true,false]){const calls=[];const fetchImpl=async(url,init)=>{const path=new URL(url).pathname;calls.push({path,body:init?.body?JSON.parse(init.body):null});
  if(path.includes('p0_migration_status'))return Response.json([{version:'p0-20260921',phase:'locked'}]);
  if(path==='/auth/v1/user')return Response.json({id:user,email_confirmed_at:new Date().toISOString()});
  if(path.endsWith('/readers'))return Response.json([{status:'ACTIVE'}]);if(path.endsWith('/authors')||path.endsWith('/admin_users'))return Response.json([]);
  if(path.endsWith('/episodes'))return Response.json([ep]);if(path.endsWith('/works'))return Response.json([work]);return Response.json({episode:ep});};
  const r=await createSecureApi({fetchImpl})(new Request('https://example.test/api/v2/episodes/300/content',{headers:{authorization:'Bearer a.b.c'}}),{...env,GROWTH_MEASUREMENT_ENABLED:String(enabled)});
  assert.equal(r.status,200);assert.equal((await r.json()).episode.content,'본문');const rpc=calls.find(x=>x.path.includes('/rpc/'));
  assert.match(rpc.path,enabled?/stage22_episode_content/:/stage16_episode_content/);if(enabled)assert.deepEqual(rpc.body,{p_user:user,p_episode_id:'300',p_webtoon:false});
 }
});
test('sitemap index uses fixed origin and stable bounded partitions; children enforce bucket membership',async()=>{
 const r=await growthSeo(new Request('https://hostile.test/sitemap.xml'),env,{fetchImpl:seoFetch({partitions:['0','1','9223372036854775']})});
 assert.equal(r.status,200);const xml=await r.text();assert.match(xml,/<sitemapindex/);assert.match(xml,/https:\/\/example.test\/sitemaps\/9223372036854775\/index.xml/);assert.ok(!xml.includes('hostile.test'));
 assert.equal((await growthSeo(new Request('https://example.test/sitemaps/1/index.xml'),env,{bucket:'1',fetchImpl:seoFetch({items:[{id:'1001',title:'한글 & 작품'}]})})).status,200);
 assert.equal((await growthSeo(new Request('https://example.test/sitemaps/0/index.xml'),env,{bucket:'0',fetchImpl:seoFetch({items:[{id:'1001',title:'다른 구간'}]})})).status,503);
 assert.equal((await growthSeo(new Request('https://example.test/sitemaps/0/index.xml'),env,{bucket:'0',fetchImpl:seoFetch({items:[]})})).status,404);
 for(const p of ['01','-1','9223372036854776','x'])assert.equal(sitemapBucket(p),false);
 for(const partitions of [['0','0'],['bad'],Array(50001).fill('0')])await assert.rejects(api('seo',{role:'seo',result:{partitions}}).promise,{status:503});
 await assert.rejects(api('seo',{role:'seo',query:'&workId=1&bucket=0'}).promise,{status:400});
 await assert.rejects(api('seo',{role:'seo',query:'&bucket=0&bucket=1'}).promise,{status:400});
 await assert.rejects(api('feed',{query:'&bucket=0'}).promise,{status:400});
 assert.equal((await growthSeo(new Request('https://example.test/sitemaps/x/index.xml'),env,{bucket:'bad'})).status,404);
});
test('share marker is fixed enum only and canonical/metadata remain escaped',async()=>{
 const r=await growthSeo(new Request('https://example.test/share/35?source=private'),env,{workId:'35',fetchImpl:seoFetch({items:[{id:'35',title:'<script>표식</script>',description:'설명'}]})});
 const html=await r.text();assert.match(html,/href="https:\/\/example.test\/works\/35\?source=share"/);assert.match(html,/<link rel="canonical" href="https:\/\/example.test\/works\/35"/);assert.ok(!html.includes('<script>'));
});
test('measurement cleanup is independent, bounded, disabled by default and has no public trigger',async()=>{
 const saved=globalThis.fetch,calls=[];globalThis.fetch=async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init.body)});return Response.json({});};
 try{await worker.scheduled({},env,{waitUntil(){}});assert.equal(calls.length,3);assert.deepEqual(calls.find(x=>x.url.includes('prune_growth_measurements')).body,{p_limit:20});
  calls.length=0;await worker.scheduled({}, {...env,GROWTH_MEASUREMENT_ENABLED:'false'},{waitUntil(){}});assert.equal(calls.length,2);
  assert.equal((await worker.fetch()).status,404);
 }finally{globalThis.fetch=saved;}
});
test('read-only readiness never converts local verification or missing hosted evidence into GO',()=>{
 const a=assess({management:{ok:true},database:{auth_users:42,linked_authors:30,linked_readers:10,linked_admins:1,legacy_body_conflicts:78},runtime:{healthStatus:503}});
 assert.equal(a.decision,'NO_GO');assert.ok(a.missingMigrations.includes('authoring-018'));assert.ok(a.blockers.includes('LEGACY_BODY_SOURCE_CONFLICT'));
 assert.equal(a.flagsChanged,false);assert.equal(a.actualSqlAppliedByThisAudit,false);assert.equal(a.actualGrowthExperimentStarted,false);assert.equal(a.hostedRestoreAccepted,false);
 const missing=assess({});assert.ok(missing.blockers.includes('DATABASE_AUDIT_UNAVAILABLE'));
});
