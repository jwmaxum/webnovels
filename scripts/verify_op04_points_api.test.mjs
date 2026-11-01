import test from 'node:test';
import assert from 'node:assert/strict';
import {pointsTestEnabled,pointsTestApi} from '../server/points-test-api.mjs';

const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',version='33333333-3333-4333-8333-333333333333',quoteId='44444444-4444-4444-8444-444444444444',requestId='55555555-5555-4555-8555-555555555555',panelId='66666666-6666-4666-8666-666666666666';
const enabled={POINTS_TEST_ENABLED:'true',POINTS_TEST_ENVIRONMENT:'TEST',POINTS_TEST_PROVENANCE:'LOCAL_SIMULATED',P0_API_ENABLED:'true'};
const marker={mode:'TEST',provenance:'LOCAL_SIMULATED'},user={id:uid,email_confirmed_at:'2026-11-01T00:00:00Z'},reader={userId:uid,reader:{status:'ACTIVE'}},admin={userId:uid,admin:{is_active:true,role:'SUPER_ADMIN',permissions:[]}};
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
const work=(id='1',contentType='NOVEL')=>({id,title:'시험 작품',author:'시험 작가',contentType});
const pagination=(items=[])=>({...marker,items,offset:0,limit:50,total:items.length,hasMore:false,nextOffset:null});
const state=()=>({...marker,revision:'0',defaults:{freeEpisodes:2,pricePoints:100},works:[],policies:[]});
const quote=()=>({...marker,quote:{id:quoteId,episodeId:'3',workId:'1',versionId:version,priceVersion:other,pricePoints:100,access:'LOCKED',expiresAt:'2026-11-02T01:05:00Z'},balancePoints:1000});
const bought=()=>({...marker,episodeId:'3',access:'OWNED',chargedPoints:100,balancePoints:900,entitlementId:version,replayed:false});
const document=()=>({version:1,paragraphs:[{align:'center',indent:1,runs:[{text:'공개된 본문',bold:true,italic:true,underline:true}]}]});
const novel=()=>({...marker,episodeId:'3',workId:'1',versionId:version,contentType:'NOVEL',title:'시험 3화',contentDocument:document(),content:'공개된 본문',panels:[]});
const webtoon=()=>({...marker,episodeId:'3',workId:'1',versionId:version,contentType:'WEBTOON',title:'시험 3화',contentDocument:null,content:null,panels:[{id:panelId,order:0,width:800,height:4096,format:'webp'}]});
const panel=()=>({...marker,bucket:'authoring-webtoons',path:'webtoon/1/'+other+'/0/'+'a'.repeat(64)+'.webp',mimeType:'image/webp',bytes:null});
function fixture({action='works',isAdmin=false,body,query='',method,env=enabled,who=isAdmin?admin:reader,session=user,result,headers={},remoteResponse,rpcError,customRequest}={}){
  const write=isAdmin||['quote','purchase'].includes(action),verb=method||(write?'POST':'GET');
  const request=customRequest||new Request('https://app.test/api/v2/'+(isAdmin?'admin/':'')+'points-test?action='+action+(query?'&'+query:''),{method:verb,headers:{origin:'https://app.test','content-type':'application/json',...headers},...(!['GET','HEAD'].includes(verb)?{body:typeof body==='string'?body:JSON.stringify(body??{})}:{})});
  const calls=[],storage=[];
  const rpc=async(name,payload)=>{calls.push({name,payload});if(rpcError)throw rpcError;return result??(isAdmin?state():pagination());};
  const remote=async(path,options)=>{storage.push({path,options});return typeof remoteResponse==='function'?remoteResponse():remoteResponse??new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/webp'}});};
  return {request,calls,storage,run:()=>pointsTestApi({request,user:session,actor:who,rpc,remote,fail,env})};
}
async function rejects(options,status,code,{rpcCalls=0,storageCalls=0}={}){const f=fixture(options);await assert.rejects(f.run(),error=>error.status===status&&(!code||error.code===code));assert.equal(f.calls.length,rpcCalls);assert.equal(f.storage.length,storageCalls);return f;}

test('points TEST requires every exact flag, keeps FREE beta closed and never needs a PG key',()=>{
  assert.equal(pointsTestEnabled(enabled),true);assert.equal(pointsTestEnabled(),false);
  for(const key of Object.keys(enabled))for(const value of [undefined,false,true,'TRUE',' true ','LIVE','PROVIDER_TEST'])assert.equal(pointsTestEnabled({...enabled,[key]:value}),false,key+' '+value);
  for(const value of ['true',true])assert.equal(pointsTestEnabled({...enabled,FREE_BETA_ENABLED:value}),false);
  assert.equal(pointsTestEnabled({...enabled,FREE_BETA_ENABLED:'false',TOSS_LIVE_SECRET_KEY:'unused'}),true);
});

test('off or LIVE requests stop before identity, RPC and Storage and never fabricate TEST success',async()=>{
  for(const env of [{},{...enabled,POINTS_TEST_ENVIRONMENT:'LIVE'},{...enabled,POINTS_TEST_PROVENANCE:'PROVIDER_TEST'},{...enabled,FREE_BETA_ENABLED:'true'}])await rejects({env,session:null,who:null},503,'POINTS_TEST_NOT_ACTIVATED');
});

test('reader access requires the same confirmed active Auth identity without trusting profile IDs',async()=>{
  for(const session of [null,{id:[uid],email_confirmed_at:'2026-11-01'}, {...user,is_anonymous:true},{...user,deleted_at:'2026-11-01'},{...user,banned_until:'2999-01-01T00:00:00Z'},{...user,banned_until:'bad'}])await rejects({session},401,'INVALID_SESSION');
  await rejects({session:{id:uid}},403,'EMAIL_CONFIRMATION_REQUIRED');
  for(const who of [null,{...reader,userId:other},{userId:uid},{userId:uid,reader:{status:'BLOCKED'}}])await rejects({who},who?.userId===uid?403:401);
  const f=fixture({who:{...reader,reader:{status:'ACTIVE',id:other}},result:pagination([work()])});await f.run();assert.equal(f.calls[0].payload.p_user,uid);
});

test('only active SUPER_ADMIN may view or change TEST settings, not curation or financial readers',async()=>{
  for(const who of [reader,{...admin,admin:{is_active:false,role:'SUPER_ADMIN'}},{...admin,admin:{is_active:true,role:'ADMIN',permissions:['CURATION_WRITE','SETTLEMENTS_READ']}}])await rejects({isAdmin:true,action:'state',who},403,'ADMIN_FORBIDDEN');
  const f=fixture({isAdmin:true,action:'state'});assert.equal((await f.run()).revision,'0');assert.equal(f.calls[0].payload.p_action,'admin-state');
});

test('methods, query allowlists, duplicate keys and pagination reject before RPC',async()=>{
  for(const options of [{action:'unknown'},{query:'action=works'},{query:'offset=-1'},{query:'offset=100001'},{query:'offset=01'},{query:'offset=0&offset=50'},{query:'userId='+other},{action:'episodes',query:'workId=0'},{action:'content',query:'episodeId=1.5'}])await rejects(options,400);
  await rejects({method:'POST'},405,'METHOD_NOT_ALLOWED');await rejects({action:'quote',method:'GET'},405,'METHOD_NOT_ALLOWED');
  await rejects({isAdmin:true,action:'state',query:'targetUserId='+other},400,'INVALID_QUERY');
});

test('POSTs require exact Origin, JSON, bounded streamed body and allowed fields',async()=>{
  for(const [options,status]of [[{headers:{origin:'https://evil.test'}},403],[{headers:{origin:''}},403],[{headers:{'content-type':'text/plain'}},415],[{body:'{'},400],[{body:' '.repeat(65537)},413],[{body:{episodeId:'3',p_user:other}},400],[{body:{episodeId:'3',balancePoints:100000}},400]])await rejects({action:'quote',...options},status);
  const malformed=new Request('https://app.test/api/v2/points-test?action=quote',{method:'POST',headers:{origin:'https://app.test','content-type':'application/json'},body:new Uint8Array([0xff])});await rejects({action:'quote',customRequest:malformed},400);
});

test('reader works pagination strips bodies, account identity, bank and legacy points fields',async()=>{
  const f=fixture({result:pagination([{...work(),body:'PRIVATE_BODY',auth_user_id:other,bank:'PRIVATE_BANK',points:123}])});const result=await f.run();assert.deepEqual(result.items,[work()]);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|auth_user|bank|points/);
  assert.deepEqual(f.calls[0],{name:'op04_points_test',payload:{p_user:uid,p_action:'works',p_data:{offset:0}}});
  const second=fixture({query:'offset=50',result:{...pagination(),offset:50,total:50}});assert.equal((await second.run()).offset,50);
  await rejects({result:{...pagination(),mode:'LIVE'}},503,'POINTS_TEST_UNAVAILABLE',{rpcCalls:1});
});

test('locked episode metadata stays visible with price but never contains manuscript or panel data',async()=>{
  const ep={id:'3',workId:'1',episodeNumber:3,title:'유료 시험',versionId:version,access:'LOCKED',pricePoints:100,priceVersion:other};
  const f=fixture({action:'episodes',query:'workId=1',result:{...pagination([{...ep,content:'PRIVATE_BODY',panels:[{path:'PRIVATE_PATH'}]}]),work:work()}});const result=await f.run();assert.deepEqual(result.items,[ep]);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|panels|contentDocument/);
  await rejects({action:'episodes',query:'workId=1',result:{...pagination([{...ep,workId:'2'}]),work:work()}},503,'POINTS_TEST_UNAVAILABLE',{rpcCalls:1});
});

test('quotes are server-issued snapshots and client price, owner, expiry and UUID-array aliases reject',async()=>{
  const f=fixture({action:'quote',body:{episodeId:'3'},result:{...quote(),privateOrder:'PRIVATE_ORDER'}});const result=await f.run();assert.deepEqual(result,quote());assert.equal(f.calls[0].payload.p_data.episodeId,'3');
  for(const change of [{pricePoints:0},{targetUserId:other},{expiresAt:'2999-01-01'}])await rejects({action:'quote',body:{episodeId:'3',...change}},400);
  await rejects({action:'purchase',body:{quoteId:[quoteId],requestId}},400);
});

test('purchase forwards the exact quote and request key and replays remain explicit',async()=>{
  const body={quoteId,requestId};
  for(const replayed of [false,true]){const f=fixture({action:'purchase',body,result:{...bought(),replayed,body:'PRIVATE_BODY'}});const result=await f.run();assert.deepEqual(f.calls[0].payload.p_data,body);assert.equal(result.replayed,replayed);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|body/);}
  for(const body of [{quoteId},{quoteId,requestId,userId:uid},{quoteId,requestId,points:1},{quoteId,requestId,episodeId:'3'}])await rejects({action:'purchase',body},400);
});

test('price change, head change, expiry, insufficient funds and exact-key conflicts preserve DB failure',async()=>{
  for(const error of ['PRICE_CHANGED','PUBLICATION_CHANGED','QUOTE_EXPIRED','INSUFFICIENT_POINTS','IDEMPOTENCY_CONFLICT'])await rejects({action:'purchase',body:{quoteId,requestId},result:{error,status:409}},409,error,{rpcCalls:1});
  await rejects({action:'purchase',body:{quoteId,requestId},rpcError:Object.assign(Error('no funds'),{status:409,code:'INSUFFICIENT_POINTS'})},409,'INSUFFICIENT_POINTS',{rpcCalls:1});
  await rejects({action:'purchase',body:{quoteId,requestId},rpcError:Error('PRIVATE_STORAGE_KEY')},503,'POINTS_TEST_UNAVAILABLE',{rpcCalls:1});
  await rejects({action:'purchase',body:{quoteId,requestId},result:{error:'PRIVATE_STORAGE_KEY',status:409}},503,'POINTS_TEST_UNAVAILABLE',{rpcCalls:1});
});

test('enrollment uses explicit enabled, revision, reason and request; no client author/source fields',async()=>{
  const body={workId:'1',enabled:true,revision:'0',reason:'시험 작품 등록',requestId};const f=fixture({isAdmin:true,action:'enroll',body,result:{...state(),saved:true,replayed:false}});assert.equal((await f.run()).saved,true);assert.deepEqual(f.calls[0].payload,{p_user:uid,p_action:'admin-enroll',p_data:body});
  for(const change of [{enabled:1},{revision:0},{reason:'짧'},{authorId:'1'},{requestId:[requestId]}])await rejects({isAdmin:true,action:'enroll',body:{...body,...change}},400);
});

test('policy permits only integer point versions, strict UTC and exact retry fields',async()=>{
  const base={scope:'DEFAULT',targetId:null,points:100,startsAt:'2020-01-01T00:00:00.123456+00:00',revision:'0',reason:'시험 가격 변경',requestId};
  const f=fixture({isAdmin:true,action:'policy',body:base,result:{...state(),saved:true,replayed:true}});assert.equal((await f.run()).replayed,true);assert.deepEqual(f.calls[0].payload.p_data,base,'DB receipt lookup owns freshness, not API wallclock');
  for(const change of [{points:1.5},{points:-1},{points:1000001},{points:'100'},{scope:'USER'},{targetId:'1'},{startsAt:'2026-02-30T00:00:00Z'},{startsAt:'2026-11-01T00:00:00+09:00'},{startsAt:'2026-11-01T24:00:00Z'},{revision:'9223372036854775808'}])await rejects({isAdmin:true,action:'policy',body:{...base,...change}},400);
  const workPolicy=fixture({isAdmin:true,action:'policy',body:{...base,scope:'WORK',targetId:'9007199254740993'},result:state()});await workPolicy.run();assert.equal(workPolicy.calls[0].payload.p_data.targetId,'9007199254740993');
});

test('test credit targets an Auth UUID and never accepts client balance or money data',async()=>{
  const body={targetUserId:other,points:1000,reason:'시험용 포인트 지급',requestId};const f=fixture({isAdmin:true,action:'credit',body,result:{...marker,targetUserId:other,balancePoints:1000,creditedPoints:1000,replayed:false,bank:'PRIVATE_BANK'}});const result=await f.run();assert.equal(result.creditedPoints,1000);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_BANK/);
  for(const change of [{targetUserId:'1'},{targetUserId:[other]},{points:0},{points:1000001},{balancePoints:2000},{amountKrw:1000},{providerReceipt:'success'}])await rejects({isAdmin:true,action:'credit',body:{...body,...change}},400);
});

test('admin state shows current default and disabled enrollments while removing PII or arbitrary markup fields',async()=>{
  const expected={...state(),defaults:{freeEpisodes:2,pricePoints:150},works:[{...work(),enabled:false}],policies:[{id:other,scope:'DEFAULT',targetId:null,points:150,startsAt:'2026-11-02T00:00:00Z',reason:'시험 정책'}]};
  const f=fixture({isAdmin:true,action:'state',result:{...expected,bank:'PRIVATE_BANK',works:[{...expected.works[0],auth_user_id:other}],policies:[{...expected.policies[0],actorEmail:'PRIVATE_EMAIL'}]}});assert.deepEqual(await f.run(),expected);
  await rejects({isAdmin:true,action:'state',result:{...expected,defaults:{freeEpisodes:3,pricePoints:150}}},503,'POINTS_TEST_UNAVAILABLE',{rpcCalls:1});
});

test('wallet projects immutable TEST deltas and rejects contradictory or legacy aggregates',async()=>{
  const ledger=[{id:other,kind:'CREDIT',deltaPoints:1000,createdAt:'2026-11-02T00:00:00Z'},{id:version,kind:'DEBIT',deltaPoints:-100,createdAt:'2026-11-02T00:01:00Z'}];const f=fixture({action:'wallet',result:{...marker,balancePoints:900,ledger,legacyPoints:99000,bank:'PRIVATE_BANK'}});assert.deepEqual(await f.run(),{...marker,balancePoints:900,ledger});
  for(const row of [{...ledger[1],deltaPoints:100},{...ledger[1],deltaPoints:0},{...ledger[0],createdAt:'bad'}])await rejects({action:'wallet',result:{...marker,balancePoints:900,ledger:[row]}},503,'POINTS_TEST_UNAVAILABLE',{rpcCalls:1});
});

test('novel content keeps validated Word formatting and strips all source/storage metadata',async()=>{
  const f=fixture({action:'content',query:'episodeId=3',result:{...novel(),draftId:other,authorBank:'PRIVATE_BANK',bucket:'PRIVATE_BUCKET'}});assert.deepEqual(await f.run(),novel());
  const invalid=novel();invalid.contentDocument.paragraphs[0].runs[0].href='https://evil.test';await rejects({action:'content',query:'episodeId=3',result:invalid},503,'POINTS_TEST_UNAVAILABLE',{rpcCalls:1});
  await rejects({action:'content',query:'episodeId=3',result:{...novel(),episodeId:'4'}},503,'POINTS_TEST_UNAVAILABLE',{rpcCalls:1});
});

test('webtoon content exposes bounded ordered descriptors and no bucket/path/signed URLs',async()=>{
  const value=webtoon();value.panels[0].bucket='PRIVATE_BUCKET';value.panels[0].path='PRIVATE_PATH';value.panels[0].url='https://private.test';const f=fixture({action:'content',query:'episodeId=3',result:value});assert.deepEqual(await f.run(),webtoon());
  for(const row of [{...webtoon().panels[0],width:801},{...webtoon().panels[0],height:4097},{...webtoon().panels[0],order:-1},{...webtoon().panels[0],format:'svg'}])await rejects({action:'content',query:'episodeId=3',result:{...webtoon(),panels:[row]}},503,'POINTS_TEST_UNAVAILABLE',{rpcCalls:1});
});

test('locked, cross-user and old-head panel denials occur before any Storage fetch',async()=>{
  for(const [error,status]of [['EPISODE_LOCKED',403],['CONTENT_NOT_AVAILABLE',404],['TEST_WORK_NOT_FOUND',404]])await rejects({action:'panel',query:'episodeId=3&versionId='+version+'&panelId='+panelId+'&format=webp',result:{error,status}},status,error,{rpcCalls:1});
  await rejects({action:'panel',query:'episodeId=3&versionId='+version+'&panelId='+panelId+'&format=webp',who:{...reader,userId:other},result:panel()},401,'INVALID_SESSION');
});

test('authorized panel uses private service storage and returns only bounded binary headers',async()=>{
  const f=fixture({action:'panel',query:'episodeId=3&versionId='+version+'&panelId='+panelId+'&format=webp',result:panel()});const response=await f.run();assert.ok(response instanceof Response);assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[1,2,3]);assert.equal(response.headers.get('content-type'),'image/webp');assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');assert.equal(f.storage[0].path,'/storage/v1/object/authenticated/'+panel().bucket+'/'+panel().path);assert.equal(f.storage[0].options.method,'GET');assert.doesNotMatch([...response.headers].flat().join(' '),/authoring-webtoons|webtoon\//);
});

test('unsafe Storage metadata, MIME, declared size and streamed overflow fail closed',async()=>{
  const options={action:'panel',query:'episodeId=3&versionId='+version+'&panelId='+panelId+'&format=webp'};
  for(const change of [{bucket:'public'},{path:'../PRIVATE_PATH'},{path:panel().path.replace('webtoon/1/','webtoon/9223372036854775808/')},{path:panel().path.replace('.webp','.png')},{mimeType:'image/svg+xml'},{bytes:8388609},{bytes:undefined}])await rejects({...options,result:{...panel(),...change}},503,'POINTS_TEST_UNAVAILABLE',{rpcCalls:1});
  for(const remoteResponse of [()=>new Response('PRIVATE_ERROR',{status:403}),()=>new Response('<svg>',{headers:{'content-type':'image/svg+xml'}}),()=>new Response(new Uint8Array([1]),{headers:{'content-type':'image/webp','content-length':'8388609'}}),()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8388609));controller.close();}}),{headers:{'content-type':'image/webp'}})])await rejects({...options,result:panel(),remoteResponse},503,'POINTS_TEST_STORAGE_UNAVAILABLE',{rpcCalls:1,storageCalls:1});
  await rejects({...options,result:{...panel(),bytes:4}},503,'POINTS_TEST_STORAGE_UNAVAILABLE',{rpcCalls:1,storageCalls:1});
});

test('upstream malformed DTOs never gain metadata/body access through projection coercions',async()=>{
  for(const result of [{...pagination([work()]),total:2},{...pagination([work()]),items:[{...work(),id:1}]},{...pagination([work()]),items:[{...work(),author:{bank:'PRIVATE'}}]},{...pagination([work()]),provenance:'LIVE'},{...pagination([work()]),items:[{...work(),contentType:'ADULT'}]}])await rejects({result},503,'POINTS_TEST_UNAVAILABLE',{rpcCalls:1});
  await rejects({action:'quote',body:{episodeId:'3'},result:{...quote(),quote:{...quote().quote,id:[quoteId]}}},503,'POINTS_TEST_UNAVAILABLE',{rpcCalls:1});
});

test('actual SQL service-role DTOs drive TEST pricing, purchase, stable rights, current head and protected panel bytes',async()=>{
  const {setup,admin:adminId,reader:readerId,otherReader,uuid}=await import('./fixtures/op04-db.mjs');
  const f=await setup();const storage=[];
  async function run(action,{isAdmin=false,data={},target=readerId}={}){
    const identity=isAdmin?adminId:target,write=isAdmin||['quote','purchase'].includes(action),query=new URLSearchParams({action});
    if(!write)for(const [key,value]of Object.entries(data))query.set(key,String(value));
    const request=new Request('https://app.test/api/v2/'+(isAdmin?'admin/':'')+'points-test?'+query,{method:write?'POST':'GET',headers:{origin:'https://app.test','content-type':'application/json'},...(write?{body:JSON.stringify(data)}:{})});
    const who={userId:identity,...(isAdmin?{admin:{is_active:true,role:'SUPER_ADMIN'}}:{reader:{status:'ACTIVE'}})};
    return pointsTestApi({request,user:{id:identity,email_confirmed_at:'2026-11-01T00:00:00Z'},actor:who,env:enabled,fail,
      rpc:async(name,payload)=>{assert.equal(name,'op04_points_test');await f.db.exec('begin;set local role service_role');try{const result=(await f.db.query('select public.op04_points_test($1,$2,$3) result',[payload.p_user,payload.p_action,JSON.stringify(payload.p_data)])).rows[0].result;await f.db.exec('commit');return result;}catch(error){await f.db.exec('rollback');throw error;}},
      remote:async(path)=>{storage.push(path);return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/webp'}})}});
  }
  try{
    const initial=await run('state',{isAdmin:true});assert.equal(initial.defaults.freeEpisodes,2);assert.equal(initial.defaults.pricePoints,100);assert.equal(initial.works.length,2);
    const works=await run('works');assert.equal(works.total,2);assert.deepEqual(new Set(works.items.map(row=>row.contentType)),new Set(['NOVEL','WEBTOON']));
    const episodes=await run('episodes',{data:{workId:f.novel.id}});assert.deepEqual(episodes.items.map(row=>[row.access,row.pricePoints]),[['MEMBER_FREE',0],['MEMBER_FREE',0],['LOCKED',100]]);
    const first=await run('content',{data:{episodeId:f.novel.episodes[0].id}});assert.equal(first.contentType,'NOVEL');assert.match(first.content,/1화/);
    const third=f.novel.episodes[2];await assert.rejects(run('content',{data:{episodeId:third.id}}),error=>error.status===403&&error.code==='EPISODE_LOCKED');
    const q=await run('quote',{data:{episodeId:third.id}}),purchaseData={quoteId:q.quote.id,requestId:uuid()};await assert.rejects(run('purchase',{data:purchaseData}),error=>error.code==='INSUFFICIENT_POINTS');
    const credited=await run('credit',{isAdmin:true,data:{targetUserId:readerId,points:1000,reason:'SQL API 시험 지급',requestId:uuid()}});assert.equal(credited.balancePoints,1000);
    const purchased=await run('purchase',{data:purchaseData});assert.equal(purchased.chargedPoints,100);assert.equal(purchased.balancePoints,900);
    const replay=await run('purchase',{data:purchaseData});assert.equal(replay.replayed,true);assert.equal(replay.balancePoints,900);
    await assert.rejects(run('purchase',{data:{quoteId:q.quote.id,requestId:uuid()},target:otherReader}),error=>error.status===404&&error.code==='QUOTE_NOT_FOUND');
    assert.equal((await run('wallet')).balancePoints,900);assert.equal((await run('wallet')).ledger.length,2);
    const staleQuote=await run('quote',{data:{episodeId:f.webtoon.episodes[2].id}});const latest=await run('state',{isAdmin:true});
    await run('policy',{isAdmin:true,data:{scope:'DEFAULT',targetId:null,points:200,startsAt:new Date().toISOString(),revision:latest.revision,reason:'SQL API 시험 가격 변경',requestId:uuid()}});
    await assert.rejects(run('purchase',{data:{quoteId:staleQuote.quote.id,requestId:uuid()}}),error=>error.code==='PRICE_CHANGED');
    const replacement=await f.replaceHead(third);const current=await run('content',{data:{episodeId:third.id}});assert.equal(current.versionId,replacement.versionId);
    const ownedQuote=await run('quote',{data:{episodeId:third.id}});assert.equal(ownedQuote.quote.access,'OWNED');const owned=await run('purchase',{data:{quoteId:ownedQuote.quote.id,requestId:uuid()}});assert.equal(owned.chargedPoints,0);assert.equal(owned.balancePoints,900);
    const toon=f.webtoon.episodes[2],toonQuery={episodeId:toon.id,versionId:toon.versionId,panelId:toon.panelId,format:'webp'};await assert.rejects(run('panel',{data:toonQuery}),error=>error.code==='EPISODE_LOCKED');assert.equal(storage.length,0);
    const toonQuote=await run('quote',{data:{episodeId:toon.id}});assert.equal((await run('purchase',{data:{quoteId:toonQuote.quote.id,requestId:uuid()}})).chargedPoints,200);
    const toonContent=await run('content',{data:{episodeId:toon.id}});assert.equal(toonContent.panels.length,1);const image=await run('panel',{data:toonQuery});assert.equal(image.headers.get('cache-control'),'private, no-store');assert.equal((await image.arrayBuffer()).byteLength,3);
    const newToon=await f.replaceHead(toon,{newAsset:true});await assert.rejects(run('panel',{data:toonQuery}),error=>error.code==='CONTENT_NOT_AVAILABLE');assert.equal(storage.length,1);
    const newPanel=await run('panel',{data:{episodeId:toon.id,versionId:newToon.versionId,panelId:newToon.panelId,format:'webp'}});assert.equal((await newPanel.arrayBuffer()).byteLength,3);
    const stateBefore=await run('state',{isAdmin:true});await run('enroll',{isAdmin:true,data:{workId:f.novel.id,enabled:false,revision:stateBefore.revision,reason:'SQL API 시험 해제',requestId:uuid()}});assert.equal((await run('state',{isAdmin:true})).works.find(row=>row.id===f.novel.id).enabled,false);
    await assert.rejects(run('content',{data:{episodeId:third.id}}),error=>error.code==='TEST_WORK_NOT_FOUND');
  }finally{await f.db.close();}
});
