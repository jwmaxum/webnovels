import test from 'node:test';
import assert from 'node:assert/strict';
import {createSecureApi} from '../server/secure-api.mjs';
import {accountApi} from '../server/account-api.mjs';
import {normalizeExternalLinks,DISTRIBUTION_HOSTS} from '../server/creator-distribution-api.mjs';
const uid='11111111-1111-4111-8111-111111111111';
const distribution={workId:'10',mode:'UNSET',version:'0',externalLinks:[],declarationVersion:null,declaredAt:null};
const env={P0_API_ENABLED:'true',AUTHOR_WORKS_ENABLED:'true',AUTHOR_DISTRIBUTION_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'};
const data={mode:'NON_EXCLUSIVE',version:'0',externalLinks:['https://novel.munpia.com/123'],rightsConfirmed:true};
function setup({author=true,result={distribution},upstream=200}={}) {
  const calls=[];
  const fetchImpl=async(input,init)=>{
    const path=new URL(input).pathname;
    if(path==='/auth/v1/user')return Response.json({id:uid,email_confirmed_at:'2026-10-08'});
    if(path.endsWith('/p0_migration_status'))return Response.json([{phase:'locked'}]);
    if(path.endsWith('/authors'))return Response.json(author?[{id:'1',status:'APPROVED',auth_user_id:uid}]:[]);
    if(path.endsWith('/readers'))return Response.json([{id:'1',status:'ACTIVE',auth_user_id:uid}]);
    if(path.endsWith('/admin_users'))return Response.json([]);
    if(path.endsWith('/creator_work_distribution')){calls.push({path,body:JSON.parse(init.body)});return upstream===200?Response.json(result):new Response('private upstream information',{status:upstream});}
    if(path.endsWith('/creator_works'))return Response.json({work:{id:'10'},episodes:[]});
    if(path.endsWith('/launch_accounts_ready')||path.endsWith('/launch_author_workspace_ready'))return Response.json(true);
    if(path.endsWith('/launch_account_actor'))return Response.json({userId:uid,...(author?{author:{id:'1',status:'APPROVED'}}:{reader:{id:'1',status:'ACTIVE'}})});
    throw new Error('Unexpected mock route '+path);
  };
  const api=createSecureApi({fetchImpl});
  const request=(suffix='/10/distribution',{method='GET',body,origin='https://app.test',bindings=env,workspace=false}={})=>{
    const req=new Request('https://app.test/api/v2/creator/works'+suffix,{method,headers:{Authorization:'Bearer real.jwt.token',...(origin?{Origin:origin}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    return workspace?accountApi(req,{...bindings,P0_API_ENABLED:'false'},{fetchImpl}):api(req,bindings);
  };
  return {request,calls};
}
test('distribution is separately gated, author-owned, and supported by the private workspace',async()=>{
  for(const workspace of [false,true]) {
    const s=setup();assert.equal((await s.request(undefined,{workspace})).status,200);assert.equal(s.calls.at(-1).body.p_user_id,uid);
    assert.equal(s.calls.at(-1).body.p_work_id,'10');assert.equal(s.calls.at(-1).body.p_action,'get');
    const before=s.calls.length;assert.equal((await s.request(undefined,{workspace,bindings:{...env,AUTHOR_DISTRIBUTION_ENABLED:'false'}})).status,503);assert.equal(s.calls.length,before);
    assert.equal((await setup({author:false}).request(undefined,{workspace})).status,403);
    assert.equal((await s.request(undefined,{workspace,method:'PATCH',body:data})).status,200);
  }
  const s=setup();assert.equal((await s.request('/10')).status,200);
  assert.equal((await (await s.request('/10')).json()).distributionEnabled,true);
  assert.equal((await (await s.request('/10',{bindings:{...env,AUTHOR_DISTRIBUTION_ENABLED:'false'}})).json()).distributionEnabled,false);
});
test('mutations require exact Origin, explicit declaration, decimal version, and a closed allowlist',async()=>{
  const s=setup();const before=s.calls.length;
  for(const origin of [null,'https://evil.test'])assert.equal((await s.request(undefined,{method:'PATCH',body:data,origin})).status,403);
  for(const body of [{...data,author_id:'2'},{...data,rightsConfirmed:false},{...data,mode:'PLUS'},{...data,version:0},{...data,version:'9223372036854775808'},{...data,version:'00'},{}])
    assert.equal((await s.request(undefined,{method:'PATCH',body})).status,400);
  for(const suffix of ['/9223372036854775808/distribution','/10/distribution?author_id=2'])assert.equal((await s.request(suffix)).status,400);
  assert.equal((await s.request(undefined,{method:'POST',body:data})).status,405);assert.equal(s.calls.length,before);
  assert.equal((await s.request('/9007199254740993/distribution',{method:'PATCH',body:{...data,externalLinks:['HTTPS://NOVEL.MUNPIA.COM/123']}})).status,200);
  assert.equal(s.calls.at(-1).body.p_work_id,'9007199254740993');assert.deepEqual(s.calls.at(-1).body.p_data.externalLinks,['https://novel.munpia.com/123']);
});
test('links allow exact supported HTTPS hosts and reject executable/deceptive/unbounded input',()=>{
  const fail=(status,code)=>{throw Object.assign(new Error(code),{status,code});};
  for(const host of Object.keys(DISTRIBUTION_HOSTS))assert.deepEqual(normalizeExternalLinks(['https://'+host+'/작품'],fail),['https://'+host+'/%EC%9E%91%ED%92%88']);
  for(const links of [null,{},[123],[''],['javascript:alert(1)'],['http://novel.munpia.com/1'],['https://novel.munpia.com.evil.test/1'],['https://novel.munpia.com@evil.test/1'],
    ['https://user:pass@novel.munpia.com/1'],['https://novel.munpia.com:443/1'],['https://novel.munpia.com./1'],['https://novel.munpia.com/1\n'],['https://novel.munpia.com\\evil.test/1'],
    ['https://novel.munpia.com/'+'a'.repeat(2048)],Array(6).fill('https://novel.munpia.com/1'),['https://novel.munpia.com/1','HTTPS://NOVEL.MUNPIA.COM/1']])
    assert.throws(()=>normalizeExternalLinks(links,fail),{code:'INVALID_EXTERNAL_LINK'});
  assert.deepEqual(normalizeExternalLinks([],fail),[]);
});
test('RPC conflicts, missing owners and upstream failures retain HTTP errors and mask private details',async()=>{
  for(const [error,status] of [['DISTRIBUTION_CONFLICT',409],['WORK_NOT_FOUND',404],['WORK_RESTRICTED',403]]){
    const response=await setup({result:{error,status}}).request();assert.equal(response.status,status);assert.equal((await response.json()).error,error);
    assert.ok(response.headers.get('X-Request-ID'));
  }
  for(const options of [{upstream:500},{result:{}},{result:null}]){
    const response=await setup(options).request();assert.equal(response.status,503);assert.ok(!(await response.text()).includes('private upstream'));
  }
});
