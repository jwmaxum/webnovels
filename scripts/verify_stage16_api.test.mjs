import test from 'node:test';
import assert from 'node:assert/strict';
import {stage8Api} from '../server/stage8-api.mjs';
import {createSecureApi} from '../server/secure-api.mjs';

const user='22222222-2222-4222-8222-222222222222',version='ffffffff-ffff-4fff-8fff-ffffffffffff';
const env={AUTHOR_PUBLISH_ENABLED:'true',READER_SERVICE_ENABLED:'true',READER_DISCOVERY_ENABLED:'true'};
const who={userId:user,reader:{status:'ACTIVE'}};
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
const work={id:'9223372036854775807',author_id:'1',title:'본문 <script>',author:'작가',genre:['판타지'],
  tags:['성장'],content_type:'NOVEL',status:'PUBLISHED',rating:'ALL',episode_count:2,
  ranking_readers:6,description:'소개',firstEpisodeNumber:3};
const episode={id:'100',work_id:work.id,episode_number:3,title:'3화',status:'PUBLISHED',is_free:true,
  access_policy:'FREE',versionId:version};
const ranking={periodDays:7,minSample:5,asOf:new Date().toISOString(),metric:'uniqueReaders'};
async function invoke(query,{method='GET',data,result={works:[work],nextCursor:null,ranking},settings=env,identity=who}={}) {
  const calls=[];
  const request=new Request('https://example.test'+query,{method,...(data?{
    headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify(data)}:{})});
  const output=await stage8Api({request,env:settings,actor:async()=>identity,fail,readBody:async()=>data,
    db:async(route,params,options)=>{calls.push({route,options});return result;}});
  return {output,calls};
}

test('discovery is additive, service RPC only, and requires every rollout gate',async()=>{
  const {output,calls}=await invoke('/api/v2/catalog?action=list',{identity:null});
  assert.equal(calls[0].route,'rpc/stage16_catalog');assert.equal(output.works[0].id,work.id);
  assert.equal(output.works[0].description,undefined);
  assert.equal(calls[0].options.body.p_query.limit,24);
  for(const name of Object.keys(env))await assert.rejects(invoke('/api/v2/catalog?action=home',
    {settings:{...env,[name]:'false'}}),{status:503});
  const legacy=await invoke('/api/v2/catalog',{settings:{...env,READER_DISCOVERY_ENABLED:'false'},
    result:{works:[work],episodes:[episode]}});
  assert.equal(legacy.calls[0].route,'rpc/stage8_catalog');assert.equal(legacy.output.works[0].id,work.id);
  await assert.rejects(invoke('/api/v2/catalog?action=list',{method:'POST'}),{status:405});
});
test('query validation bounds parameters, preserves bigint IDs, and canonicalizes tags/sort',async()=>{
  const {calls}=await invoke('/api/v2/catalog?action=list&q=%25_%5C&tag=b&tag=a&tag=a&sort=views&limit=50');
  assert.equal(calls[0].options.body.p_query.q,'%_\\');
  assert.deepEqual(calls[0].options.body.p_query.tags,['a','b']);assert.equal(calls[0].options.body.p_query.sort,'popular');
  for(const query of ['action=none','action=list&limit=51','action=list&limit=00','action=list&cursor=x',
    'action=list&sort=raw_sql','action=list&action=home','action=work&workId=9223372036854775808',
    'action=work&workId=01','action=home&workId=10','action=chapter&workId=10&episodeNumber=2147483648',
    'action=list&type=VIDEO','action=list&role=admin','action=list&q='+encodeURIComponent('x'.repeat(101))]) {
    await assert.rejects(invoke('/api/v2/catalog?'+query),{status:400},query);
  }
});
test('cursor binds filters/action/work, retains asOf, and tolerates a changed page size',async()=>{
  const first=await invoke('/api/v2/catalog?action=list&q=hello&limit=1',
    {result:{works:[work],ranking,nextCursor:{key:'10.000001',id:work.id}}});
  const cursor=encodeURIComponent(first.output.nextCursor);
  const next=await invoke('/api/v2/catalog?action=list&q=hello&limit=2&cursor='+cursor);
  assert.deepEqual(next.calls[0].options.body.p_query.cursor,{key:'10.000001',id:work.id});
  assert.equal(next.calls[0].options.body.p_query.asOf,ranking.asOf);
  await assert.rejects(invoke('/api/v2/catalog?action=list&q=changed&cursor='+cursor),{code:'INVALID_CURSOR'});
  await assert.rejects(invoke('/api/v2/catalog?action=episodes&workId=10&cursor='+cursor),{code:'INVALID_CURSOR'});
  const page=await invoke('/api/v2/catalog?action=episodes&workId='+work.id,{result:{episodes:[episode],
    asOf:ranking.asOf,nextCursor:{key:'3',id:'100'}}});
  await assert.rejects(invoke('/api/v2/catalog?action=episodes&workId=10&cursor='+encodeURIComponent(page.output.nextCursor)),
    {code:'INVALID_CURSOR'});
});
test('dedicated detail projection exposes verified public links without private declaration fields',async()=>{
  const distribution={mode:'NON_EXCLUSIVE',externalLinks:['https://www.munpia.com/a'],version:'91',
    declarationVersion:'private',declaredAt:'private'};
  const {output}=await invoke('/api/v2/catalog?action=work&workId='+work.id,
    {result:{work:{...work,distribution,privateAuthorId:user,content:'secret'}}});
  assert.deepEqual(output.work.distribution,{mode:'NON_EXCLUSIVE',externalLinks:[{label:'문피아',url:'https://www.munpia.com/a'}]});
  assert.equal(output.work.firstEpisodeNumber,3);assert.equal(output.work.description,'소개');
  assert.equal(output.work.content,undefined);assert.equal(output.work.privateAuthorId,undefined);
  for(const unsafe of ['https://evil.test/a','https://www.munpia.com.evil.test/a','https://user@www.munpia.com/a',
    'https://www.munpia.com:443/a','https://www.munpia.com\\evil.test/a','javascript:alert(1)']) {
    const unsafeResult=await invoke('/api/v2/catalog?action=work&workId='+work.id,
      {result:{work:{...work,distribution:{...distribution,externalLinks:[unsafe]}}}});
    assert.deepEqual(unsafeResult.output.work.distribution.externalLinks,[]);
  }
  const exclusive=await invoke('/api/v2/catalog?action=work&workId='+work.id,
    {result:{work:{...work,distribution:{...distribution,mode:'EXCLUSIVE_INTEREST'}}}});
  assert.equal(exclusive.output.work.distribution,null);
});
test('home and chapter project bounded public metadata; unsafe upstream data fail closed',async()=>{
  const sections={recommended:[work],popular:[work],new:[work],completed:[]};
  const home=await invoke('/api/v2/catalog?action=home',{result:{sections,ranking}});
  assert.deepEqual(home.output.ranking,ranking);assert.equal(home.output.sections.new[0].episodes,undefined);
  const chapter=await invoke('/api/v2/catalog?action=chapter&workId='+work.id+'&episodeNumber=3',
    {result:{episode:{...episode,content:'private'},previous:null,next:{...episode,id:'101',episode_number:8}}});
  assert.equal(chapter.output.next.episode_number,8);assert.equal(chapter.output.episode.content,undefined);
  await assert.rejects(invoke('/api/v2/catalog?action=list',{result:{works:[{...work,rating:'AGE_19'}],ranking}}),
    {code:'CATALOG_UNAVAILABLE'});
  await assert.rejects(invoke('/api/v2/catalog?action=episodes&workId='+work.id,
    {result:{episodes:[{...episode,access_policy:'PAID'}],nextCursor:null}}),{code:'CATALOG_UNAVAILABLE'});
  const small=await invoke('/api/v2/catalog?action=list',{result:{works:[{...work,ranking_readers:4}],ranking,nextCursor:null}});
  assert.equal(small.output.works[0].ranking_readers,null);
  await assert.rejects(invoke('/api/v2/catalog?action=work&workId=10',
    {result:{error:'WORK_NOT_FOUND',status:404}}),{status:404});
});
test('position validation and activity dispatch never trust a request identity or fall back after RPC failure',async()=>{
  const path='/api/v2/reader/hub?action=progress&workId=10&episodeId=100';
  const position={versionId:version,paragraphIndex:1,offset:0.125};
  const {calls}=await invoke(path,{method:'POST',data:{progress:80,position},result:{saved:true}});
  assert.equal(calls[0].route,'rpc/stage16_reader');assert.equal(calls[0].options.body.p_user,user);
  assert.deepEqual(calls[0].options.body.p_data.position,position);
  for(const value of [{...position,offset:2},{...position,paragraphIndex:-1},{...position,paragraphIndex:1.5},
    {...position,versionId:'f'.repeat(36)},{...position,userId:user},null]) {
    await assert.rejects(invoke(path,{method:'POST',data:{progress:80,position:value}}),{code:'INVALID_POSITION'});
  }
  await assert.rejects(invoke(path,{method:'POST',data:{progress:80,position,userId:user}}),{code:'INVALID_FIELD'});
  await assert.rejects(invoke(path,{method:'POST',data:{progress:80,position},settings:{...env,READER_DISCOVERY_ENABLED:'false'}}),
    {code:'INVALID_FIELD'});
  const activity=await invoke('/api/v2/reader/hub?action=activity',{result:{readingHistory:[]}});
  assert.equal(activity.calls[0].route,'rpc/stage16_reader');
  await assert.rejects(invoke(path,{method:'POST',data:{progress:80,position},
    result:{error:'POSITION_VERSION_CHANGED',status:409}}),{status:409});
});
test('discovery body reads current immutable publication with version and omits private RPC data',async()=>{
  const calls=[];
  const bindings={...env,P0_API_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test_only'};
  const api=createSecureApi({fetchImpl:async(input,init)=>{
    const url=new URL(input),table=url.pathname.split('/').pop();calls.push(table);
    if(table==='launch_accounts_ready')return Response.json(false);
    if(table==='p0_migration_status')return Response.json([{phase:'locked'}]);
    if(table==='episodes')return Response.json([{...episode,id:'100',work_id:work.id}]);
    if(table==='works')return Response.json([work]);
    if(table==='stage16_episode_content')return Response.json({episode:{...episode,content:'한글 본문',
      author_comment:'작가의 말',image_urls:[],authorDeclaration:'private'}});
    throw Error('Unexpected '+table);
  }});
  const response=await api(new Request('https://example.test/api/v2/episodes/100/content'),bindings);
  assert.equal(response.status,200);const data=await response.json();
  assert.equal(data.episode.versionId,version);assert.equal(data.episode.content,'한글 본문');
  assert.equal(data.episode.authorDeclaration,undefined);assert.equal(calls.includes('secure_episode_contents'),false);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
});

test('authors reading their public work also use the immutable head; RPC errors never fall back to private mirror',async()=>{
  const bindings={...env,P0_API_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test_only'};
  let failed=false;
  const calls=[];
  const api=createSecureApi({fetchImpl:async(input)=>{
    const url=new URL(input),table=url.pathname.split('/').pop();calls.push(table);
    if(table==='launch_accounts_ready')return Response.json(false);
    if(url.pathname==='/auth/v1/user')return Response.json({id:user,email_confirmed_at:'2026-01-01'});
    if(table==='p0_migration_status')return Response.json([{phase:'locked'}]);
    if(table==='readers')return Response.json([{id:'2',auth_user_id:user,status:'ACTIVE'}]);
    if(table==='authors')return Response.json([{id:'1',auth_user_id:user,status:'APPROVED'}]);
    if(table==='admin_users')return Response.json([]);
    if(table==='episodes')return Response.json([episode]);
    if(table==='works')return Response.json([work]);
    if(table==='stage16_episode_content')return Response.json(failed?{error:'EPISODE_NOT_FOUND',status:404}:
      {episode:{...episode,content:'현재 공개본',image_urls:[]}});
    throw Error('Unexpected '+table);
  }});
  const request=()=>api(new Request('https://example.test/api/v2/episodes/100/content',{
    headers:{Authorization:'Bearer header.payload.signature'}}),bindings);
  const response=await request();assert.equal(response.status,200);assert.equal((await response.json()).episode.versionId,version);
  failed=true;assert.equal((await request()).status,404);
  assert.equal(calls.includes('secure_episode_contents'),false);
});
