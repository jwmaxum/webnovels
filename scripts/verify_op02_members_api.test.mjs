import test from 'node:test';
import assert from 'node:assert/strict';
import {adminMembersApi} from '../server/admin-members-api.mjs';
import {accountApi} from '../server/account-api.mjs';

const adminId='11111111-1111-4111-8111-111111111111',readerId='22222222-2222-4222-8222-222222222222';
const requestId='33333333-3333-4333-8333-333333333333',version='0:'+'a'.repeat(32);
const superActor={userId:adminId,admin:{is_active:true,role:'SUPER_ADMIN',permissions:[]}};
const caps={canEditPublic:true,canSearchEmail:true,canReadSettlement:true,filters:{work:true,settlement:true,requests:true,activity:true,payments:true,balance:true},sources:{works:true,history:true,rights:false}};
const member=(kind='author')=>({id:kind==='author'?'12':readerId,displayName:kind==='author'?'작가이름':'독자이름',bio:'공개 소개',status:kind==='author'?'APPROVED':'ACTIVE',revision:version,authLinked:true,emailConfirmed:true,maskedEmail:'w***@example.test',createdAt:'2026-10-01T00:00:00Z',workCount:2,pendingRequests:null,settlementState:'PENDING'});
const list=(kind='author')=>({kind,items:[member(kind)],offset:0,limit:50,hasMore:false,nextOffset:null,total:1,capabilities:caps});
const detail=(kind='author')=>({kind,member:member(kind),works:[],requests:[],history:[],rights:[],settlement:{state:'PENDING',bankRegistered:true,applicationStatus:'PENDING'},finance:{state:'PAID',paidTotal:999999},capabilities:caps});
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
function fixture({actor=superActor,method='POST',action='list',body={kind:'author'},url,headers={},result}={}){
  const calls=[],request=new Request(url||'https://app.test/api/v2/admin/members?action='+action,{method,headers:{origin:'https://app.test','content-type':'application/json',...headers},...(method==='GET'?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
  return {calls,run:()=>adminMembersApi({request,user:{id:adminId},actor,rpc:async(name,payload)=>{calls.push({name,payload});return result??(action==='list'?list(body.kind):detail(body.kind));},fail})};
}
const rejected=async(f,status,code)=>{await assert.rejects(f.run(),error=>error.status===status&&(!code||error.code===code));assert.equal(f.calls.length,0);};

test('separate author and reader POST lists use only the authenticated actor and canonical defaults',async()=>{
  for(const kind of ['author','reader']){const f=fixture({body:{kind,q:'  이름  ',offset:50},result:{...list(kind),offset:50}}),r=await f.run();
    assert.equal(r.kind,kind);assert.equal(f.calls[0].name,'admin_member_directory');assert.equal(f.calls[0].payload.p_user,adminId);
    assert.deepEqual(f.calls[0].payload.p_data,{kind,q:'이름',offset:50,createdFrom:'',createdTo:'',status:'ALL',linked:'ALL',activity:'ALL',hasWorks:'ALL',settlement:'ALL',pending:'ALL'});
    assert.equal(r.capabilities.filters.payments,false);assert.equal(r.capabilities.filters.balance,false);
  }
});

test('kind permissions remain separate and read or moderation permissions never allow profile writes',async()=>{
  for(const [permission,kind,denied]of [['CREATOR_MGMT','author','reader'],['USER_MGMT','reader','author']]){
    const actor={userId:adminId,admin:{is_active:true,role:'SUB_ADMIN',permissions:[permission]}},ok=fixture({actor,body:{kind}});await ok.run();
    await rejected(fixture({actor,body:{kind:denied}}),403,'ADMIN_FORBIDDEN');
  }
  for(const permissions of [['ACCOUNTS_READ'],['ACCOUNTS_READ','ACCOUNT_MODERATE']]){
    const actor={userId:adminId,admin:{is_active:true,role:'ADMIN',permissions}};
    await rejected(fixture({actor,action:'update-profile',body:{kind:'author',accountId:'12',revision:version,displayName:'새 필명',bio:'소개',reason:'회원 요청 반영',requestId}}),403,'ADMIN_FORBIDDEN');
  }
  await rejected(fixture({actor:{...superActor,admin:{...superActor.admin,is_active:false}}}),403,'ADMIN_FORBIDDEN');
  await rejected(fixture({actor:{...superActor,userId:readerId}}),403,'ADMIN_FORBIDDEN');
});

test('search is body-only; origin, strict fields, JSON encoding, dates and bounded offsets fail closed',async()=>{
  for(const options of [{method:'GET'},{headers:{origin:'https://evil.test'}},{headers:{'content-type':'text/plain'}},{body:'{bad'},
    {body:{kind:'author',userId:readerId}},{body:{kind:'author',q:'x'.repeat(101)}},{body:{kind:'author',q:'a\u0000b'}},
    {body:{kind:'author',offset:-1}},{body:{kind:'author',offset:100001}},{body:{kind:'author',offset:'50'}},
    {body:{kind:'author',createdFrom:'2026-02-30'}},{body:{kind:'author',createdFrom:'2026-11-02',createdTo:'2026-11-01'}},
    {body:{kind:'author',linked:'UNKNOWN'}},{body:{kind:'reader',hasWorks:'YES'}},{body:{kind:'reader',settlement:'PENDING'}},
    {url:'https://app.test/api/v2/admin/members?action=list&q=private@example.test'},{url:'https://app.test/api/v2/admin/members?action=list&action=list'}]){
    const f=fixture(options);await assert.rejects(f.run(),error=>[400,403,405,415].includes(error.status));assert.equal(f.calls.length,0);
  }
  await rejected(fixture({body:' '.repeat(16001)}),413,'BODY_TOO_LARGE');
});

test('exact email search and settlement filters require their specific read scopes',async()=>{
  const actor={userId:adminId,admin:{is_active:true,role:'ADMIN',permissions:['CREATOR_MGMT']}};
  await rejected(fixture({actor,body:{kind:'author',q:'person@example.test'}}),403,'EMAIL_SEARCH_FORBIDDEN');
  await rejected(fixture({actor,body:{kind:'author',settlement:'REGISTERED'}}),403,'ADMIN_FORBIDDEN');
  const f=fixture({body:{kind:'author',q:'person@example.test',status:'APPROVED',hasWorks:'YES',settlement:'REGISTERED',pending:'YES',activity:'30D',linked:'LINKED',createdFrom:'2026-01-01'}});await f.run();
  assert.equal(f.calls[0].payload.p_data.q,'person@example.test');
});

test('author IDs stay decimal while reader UUID and legacy decimal IDs remain distinct from Auth identities',async()=>{
  for(const [kind,id]of [['author','12'],['reader',readerId],['reader','43']]){
    const r=detail(kind);r.member.id=id;const f=fixture({action:'detail',body:{kind,accountId:id},result:r});assert.equal((await f.run()).member.id,id);
  }
  for(const [kind,id]of [['author',readerId],['author','0'],['reader','not-an-id'],['author','9223372036854775808']])
    await rejected(fixture({action:'detail',body:{kind,accountId:id}}),400,'INVALID_MEMBER_REQUEST');
  const f=fixture({action:'detail',body:{kind:'author',accountId:'13'},result:detail('author')});await assert.rejects(f.run(),error=>error.status===503);
  const upper=fixture({action:'detail',body:{kind:'reader',accountId:'AABBCCDD-2222-4222-8222-222222222222'},result:{...detail('reader'),member:{...member('reader'),id:'aabbccdd-2222-4222-8222-222222222222'}}});
  assert.equal((await upper.run()).member.id,'aabbccdd-2222-4222-8222-222222222222');assert.equal(upper.calls[0].payload.p_data.accountId,'aabbccdd-2222-4222-8222-222222222222');
});

test('support and publication-change metadata retain their separate existing scopes',async()=>{
  const result=detail();result.requests=[{id:'1',kind:'SUPPORT',label:'지원 제목',status:'OPEN'},{id:'2',kind:'PUBLICATION_CHANGE',label:'공개본 수정',status:'PENDING'}];
  result.capabilities={...caps,sources:{...caps.sources,support:true,publicationChanges:true},filters:{...caps.filters,requests:true}};
  for(const [extra,expected]of [['OPERATIONS_READ',[]],['CASE_READ',['SUPPORT']],['CONTENT_REVIEW',['PUBLICATION_CHANGE']]]){
    const actor={userId:adminId,admin:{is_active:true,role:'SUB_ADMIN',permissions:['ACCOUNTS_READ',extra]}};
    const r=await fixture({actor,action:'detail',body:{kind:'author',accountId:'12'},result}).run();
    assert.deepEqual(r.requests.map(row=>row.kind),expected);
    if(!expected.length){assert.equal(r.member.pendingRequests,null);assert.equal(r.capabilities.filters.requests,false);}
    assert.equal(r.capabilities.sources.support,extra==='CASE_READ');assert.equal(r.capabilities.sources.publicationChanges,extra==='CONTENT_REVIEW');
  }
});

test('public profile edit forwards revision, reason and exact retry ID without identity or financial fields',async()=>{
  const body={kind:'author',accountId:'12',revision:version,displayName:'  새필명  ',bio:'새 소개',reason:'  본인 요청 반영  ',requestId};
  const output={saved:true,kind:'author',member:{...member(),displayName:'새필명',revision:'1:'+'b'.repeat(32)},replayed:true};
  const f=fixture({action:'update-profile',body,result:output}),r=await f.run();assert.equal(r.saved,true);assert.equal(r.replayed,true);
  assert.deepEqual(f.calls[0].payload.p_data,{...body,displayName:'새필명',reason:'본인 요청 반영'});
  for(const extra of [{email:'new@example.test'},{auth_user_id:readerId},{status:'SUSPENDED'},{bankAccount:'123'},{points:100}])
    await rejected(fixture({action:'update-profile',body:{...body,...extra}}),400,'INVALID_MEMBER_REQUEST');
  for(const edit of [{revision:'0'},{requestId:'bad'},{displayName:'한'},{displayName:'<script>'},{bio:'x'.repeat(2001)},{reason:'짧'}])
    await rejected(fixture({action:'update-profile',body:{...body,...edit}}),400);
  await rejected(fixture({action:'update-profile',body:{...body,kind:'reader',accountId:readerId}}),400,'INVALID_MEMBER_REQUEST');
});

test('response projection strips credentials, identity and account envelopes, and never promotes TEST money',async()=>{
  const value=detail();value.member={...value.member,password:'secret-fixture',authUserId:readerId,account_number:'PRIVATE_ACCOUNT'};
  value.settlement.account_number='PRIVATE_ACCOUNT';value.settlement.encrypted_profile='PRIVATE_ENVELOPE';
  value.history=[{id:'1',action:'PUBLIC_PROFILE_UPDATE',createdAt:'2026-11-01',reason:'사유',before:{displayName:'이전',account_number:'PRIVATE_ACCOUNT'},after:{displayName:'새 이름',ssn:'PRIVATE_SSN'}}];
  const r=await fixture({action:'detail',body:{kind:'author',accountId:'12'},result:value}).run();
  assert.doesNotMatch(JSON.stringify(r),/secret-fixture|authUserId|PRIVATE_ACCOUNT|PRIVATE_ENVELOPE|PRIVATE_SSN/);
  assert.deepEqual(r.finance,{state:'NOT_CONNECTED',paidTotal:null,netPaidTotal:null,paidPoints:null,bonusPoints:null,latestPayment:null});
  assert.equal(r.settlement.verification,'MANUAL_REVIEW_NOT_PASS_OR_BANK');
  const actor={userId:adminId,admin:{is_active:true,role:'SUB_ADMIN',permissions:['CREATOR_MGMT']}};
  const limited=await fixture({actor,action:'detail',body:{kind:'author',accountId:'12'},result:value}).run();
  assert.equal(limited.capabilities.canEditPublic,false);assert.equal(limited.capabilities.canReadSettlement,false);assert.equal(limited.member.settlementState,null);assert.deepEqual(limited.history,[]);
});

test('malformed or mismatched directory responses fail as service unavailable',async()=>{
  for(const result of [{...list(),kind:'reader'},{...list(),items:Array(51).fill(member())},{...list(),hasMore:true,nextOffset:null},
    {...list(),nextOffset:50},{...list(),items:[{...member(),workCount:{account:'private'}}]}]){
    await assert.rejects(fixture({result}).run(),error=>error.status===503&&error.code==='MEMBER_SERVICE_UNAVAILABLE');
  }
});

test('the account gateway exposes member directory without enabling unrelated P0/Workflow gates',async()=>{
  const calls=[],env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_local_fixture'},request=new Request('https://app.test/api/v2/admin/members?action=list',{method:'POST',headers:{authorization:'Bearer aaa.bbb.ccc',origin:'https://app.test','content-type':'application/json'},body:JSON.stringify({kind:'reader'})});
  const response=await accountApi(request,env,{fetchImpl:async(url,options)=>{
    const target=new URL(url);calls.push({path:target.pathname,body:options.body});
    if(target.pathname==='/auth/v1/user')return Response.json({id:adminId,email_confirmed_at:'2026-10-01'});
    if(target.pathname.endsWith('/launch_accounts_ready'))return Response.json(true);
    if(target.pathname.endsWith('/launch_account_actor'))return Response.json(superActor);
    if(target.pathname.endsWith('/admin_member_directory'))return Response.json(list('reader'));
    throw Error('UNEXPECTED_REMOTE');
  }});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.equal((await response.json()).kind,'reader');assert.equal(calls.filter(call=>call.path.endsWith('/admin_member_directory')).length,1);
  assert.equal(calls.filter(call=>call.path.includes('/auth/v1/admin/')).length,0,'directory never rewrites authentication records');
});
