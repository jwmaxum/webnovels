import test from 'node:test';
import assert from 'node:assert/strict';
import {siteDisplayAdminApi,siteDisplayPublicApi,validDisplayDocument} from '../server/site-display-api.mjs';
import {accountApi} from '../server/account-api.mjs';
import {adminConsoleApi} from '../server/admin-console-api.mjs';
import {stage16Catalog} from '../server/stage16-api.mjs';
const userId='11111111-1111-4111-8111-111111111111',selectionId='22222222-2222-4222-8222-222222222222',releaseId='33333333-3333-4333-8333-333333333333';
const actor={userId,admin:{is_active:true,role:'SUPER_ADMIN',permissions:[]}},fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
const doc=()=>({selections:[],blocks:['hero','recommendations','latest','ranking','notice'].map(key=>({key,enabled:true,title:key})),menus:['home','novel','webtoon','recommendations','ranking'].map(key=>({key,label:key,visible:true})),notices:[],footerNote:''});
const work=(id='1',type='NOVEL')=>({id,title:'실제 작품',author:'필명',author_id:'2',cover_image:null,genre:['로맨스'],tags:[],status:'PUBLISHED',content_type:type,rating:'ALL',episode_count:3,firstEpisodeNumber:1,selectionId,caption:'선정 문구'});
const feed=()=>({ready:true,revision:'0',publication:null,items:[],home:{hero:null,featured:[]},offset:0,limit:24,total:0,hasMore:false,nextOffset:null,...doc()});
const published=()=>({...feed(),revision:releaseId,publication:{id:releaseId,startsAt:'2026-01-01T00:00:00Z',endsAt:null},items:[work()],total:1,home:{hero:work(),featured:[work('2','WEBTOON')]}});
const state=()=>({ready:true,draft:{revision:'0',document:doc()},selectionCards:[],releases:[],capabilities:{canEdit:true},legacyAvailable:false});
function admin({action='get',body={},who=actor,result=state(),headers={},method='POST',url}={}){
  const calls=[],request=new Request(url||'https://app.test/api/v2/admin/display?action='+action,{method,headers:{origin:'https://app.test','content-type':'application/json',...headers},...(method==='GET'?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
  return {calls,run:()=>siteDisplayAdminApi({request,user:{id:userId},actor:who,rpc:async(name,payload)=>{calls.push({name,payload});return result;},fail})};
}
async function rejected(f,status){await assert.rejects(f.run(),error=>error.status===status);assert.equal(f.calls.length,0);}

test('only current authenticated curation administrators can access drafts and mutations',async()=>{
  for(const who of [null,{...actor,userId:releaseId},{userId,admin:{is_active:false,role:'SUPER_ADMIN'}},{userId,admin:{is_active:true,role:'SUB_ADMIN',permissions:['CONTENT_METADATA_READ']}}])await rejected(admin({who}),403);
  const f=admin({who:{userId,admin:{is_active:true,role:'SUB_ADMIN',permissions:['CURATION_WRITE']}}});await f.run();assert.equal(f.calls[0].name,'admin_site_display');assert.equal(f.calls[0].payload.p_user,userId);
});
test('strict POST, origin, body bounds, actions and query allowlists protect private display data',async()=>{
  for(const [options,status]of [[{method:'GET'},405],[{headers:{origin:'https://evil.test'}},403],[{headers:{'content-type':'text/plain'}},415],[{body:'{bad'},400],[{body:{p_user:releaseId}},400],[{body:' '.repeat(262145)},413],[{action:'delete'},400],[{url:'https://app.test/api/v2/admin/display?action=get&at=2999-01-01'},400],[{url:'https://app.test/api/v2/admin/display?action=get&action=get'},400]])await rejected(admin(options),status);
});
test('manual document keeps unique work IDs, bounded home slots and only fixed public paths',()=>{
  const selected={id:selectionId,workId:'1',home:'HERO',startsAt:null,endsAt:null,enabled:true,caption:'선정 문구'};
  const good={...doc(),selections:[selected],notices:[{id:releaseId,title:'운영 공지',body:'본문',href:'',startsAt:null,endsAt:null,enabled:true}]};assert.equal(validDisplayDocument(good),true);
  for(const row of [{...good,footerNote:'<script>'},{...good,notices:[{...good.notices[0],body:'앞 > 뒤'}]}])assert.equal(validDisplayDocument(row),false);
  for(const value of [{...good,selections:[selected,{...selected,id:userId}]},{...good,selections:[{...selected,workId:'0'}]},{...good,menus:good.menus.map(row=>row.key==='home'?{...row,visible:false}:row)},{...good,blocks:[...good.blocks,good.blocks[0]]},{...good,notices:[{...good.notices[0],href:'https://evil.test'}]},{...good,notices:[{...good.notices[0],href:'/admin'}]},{...good,selections:[selected,{...selected,id:userId,workId:'2'}]},{...good,footerNote:'x'.repeat(301)}])assert.equal(validDisplayDocument(value),false);
});
test('draft save passes exact revision, reason and request key without choosing works automatically',async()=>{
  const document={...doc(),selections:[{id:selectionId,workId:'1',home:'NONE',startsAt:null,endsAt:null,enabled:true,caption:''}]},body={revision:'0',document,reason:'관리자 직접 선정',requestId:userId};
  const f=admin({action:'save',body,result:{...state(),saved:true,replayed:true}});const result=await f.run();assert.deepEqual(f.calls[0].payload.p_data,body);assert.equal(result.saved,true);assert.equal(result.replayed,true);
  for(const edit of [{reason:'짧'},{requestId:'bad'},{revision:'9223372036854775808'},{document:{...doc(),html:'<script>'}}])await rejected(admin({action:'save',body:{...body,...edit}}),400);
});
test('private draft preview may contain unpublished selections while anonymous projection may not',async()=>{
  const draft={...feed(),items:[work()],total:1,notices:[{id:releaseId,title:'초안',body:'공개 전',href:'',startsAt:null,endsAt:null,enabled:true}]};
  const f=admin({action:'preview',body:{revision:'0',at:'2026-11-01T00:00:00.123456+00:00'},result:{revision:'0',at:'2026-11-01T00:00:00.123456+00:00',public:draft,excluded:[]}});assert.equal((await f.run()).public.items.length,1);
  await assert.rejects(siteDisplayPublicApi({request:new Request('https://app.test/api/v2/display'),rpc:async()=>draft,fail}),error=>error.status===503);
});
test('public endpoint accepts pagination/types only and never a draft, future clock or work search',async()=>{
  for(const query of ['at=2999-01-01','draft=1','action=preview','q=anotherwork','offset=-1','offset=100001','offset=0&offset=24','type=ADULT']){
    let calls=0;await assert.rejects(siteDisplayPublicApi({request:new Request('https://app.test/api/v2/display?'+query),rpc:async()=>{calls++;return feed();},fail}),error=>error.status===400);assert.equal(calls,0);
  }
  let payload;const result=await siteDisplayPublicApi({request:new Request('https://app.test/api/v2/display?type=WEBTOON&offset=24'),rpc:async(_name,value)=>{payload=value;return {...feed(),offset:24};},fail});assert.equal(result.items.length,0);assert.deepEqual(payload,{p_data:{offset:24,type:'WEBTOON'}});
});
test('public cards preserve both formats and strip arbitrary bodies, Auth and financial fields',async()=>{
  const value=published();value.items=[{...work(),body:'PRIVATE_BODY',auth_user_id:userId,bank:'PRIVATE_BANK'},work('2','WEBTOON')];value.total=2;
  const result=await siteDisplayPublicApi({request:new Request('https://app.test/api/v2/display'),rpc:async()=>value,fail});assert.equal(result.items[1].content_type,'WEBTOON');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_BODY|PRIVATE_BANK|auth_user_id/);assert.equal(result.items[0].is_top_recommended,false);
  for(const change of [{...value,items:[{...work(),rating:'AGE_19'}]},{...value,items:[{...work(),title:{bank:'secret'}}]},{...value,publication:null}])await assert.rejects(siteDisplayPublicApi({request:new Request('https://app.test/api/v2/display'),rpc:async()=>change,fail}),error=>error.status===503);
});
test('publish accepts exact old timestamps for receipt retry but rejects malformed UTC dates before RPC',async()=>{
  const body={revision:'0',startsAt:'2020-01-01T00:00:00.123456+00:00',endsAt:null,reason:'동일 요청 확인',requestId:userId};
  const f=admin({action:'publish',body,result:{...state(),saved:true,replayed:true}});await f.run();assert.deepEqual(f.calls[0].payload.p_data,body,'DB receipt lookup, not API wallclock, owns retry eligibility');
  for(const startsAt of ['2026-02-30T00:00:00Z','2026-01-01T00:00:00+09:00','bad'])await rejected(admin({action:'publish',body:{...body,startsAt}}),400);
});
test('account gateway exposes published display without login or P0 activation',async()=>{
  const seen=[],response=await accountApi(new Request('https://app.test/api/v2/display'),{SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_local_fixture'},{fetchImpl:async(url)=>{
    const target=new URL(url);seen.push(target.pathname);if(target.pathname.endsWith('/launch_accounts_ready'))return Response.json(true);if(target.pathname.endsWith('/site_display_public'))return Response.json(feed());throw Error('AUTH_MUST_NOT_BE_CALLED');
  }});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).publication,null);assert.equal(seen.some(path=>path.startsWith('/auth/')),false);
});
test('legacy Console writes route to new CMS when installed without calling former writer',async()=>{
  const calls=[];await assert.rejects(adminConsoleApi({request:new Request('https://app.test/api/v2/admin/console?action=curation-update',{method:'POST',headers:{origin:'https://app.test','content-type':'application/json'},body:JSON.stringify({workId:'1',revision:'0',flags:{is_top_recommended:true,is_popular_work:false,is_new_work:false},reason:'선정 변경'})}),user:{id:userId},actor,rpc:async(name)=>{calls.push(name);return true;},fail,env:{}}),error=>error.status===409&&error.code==='SITE_DISPLAY_REQUIRED');assert.deepEqual(calls,['site_display_ready']);
});
test('catalog home uses the new manual source and an empty selection never refills old flags',async()=>{
  const row=work(),ranking={periodDays:7,minSample:5,metric:'uniqueReaders',asOf:new Date().toISOString()},calls=[];
  const result=await stage16Catalog({url:new URL('https://app.test/api/v2/catalog?action=home'),env:{READER_DISCOVERY_ENABLED:'true',AUTHOR_PUBLISH_ENABLED:'true',READER_SERVICE_ENABLED:'true'},db:async(name)=>{calls.push(name);if(name==='rpc/stage16_catalog')return {sections:{recommended:[row],popular:[],new:[],completed:[]},ranking};if(name==='rpc/site_display_ready')return true;if(name==='rpc/site_display_public')return feed();throw Error('NO_OLD_PLACEMENT_SOURCE');},fail});assert.deepEqual(result.sections.recommended,[]);assert.deepEqual(result.sections.spotlight,[]);assert.equal(calls.includes('rpc/stage17_editorial'),false);
});
