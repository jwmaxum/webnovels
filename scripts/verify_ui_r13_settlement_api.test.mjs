import test from 'node:test';
import assert from 'node:assert/strict';
import {authorSettlementApi,validateSettlementImage} from '../server/author-settlement-api.mjs';
import {accountApi} from '../server/account-api.mjs';
import {authorDashboardApi} from '../server/author-dashboard-api.mjs';
import {decryptSettlement} from '../server/author-settlement-crypto.mjs';
import {settlementPolicy} from '../server/author-settlement-policy.mjs';
const owner='11111111-1111-4111-8111-111111111111',admin='22222222-2222-4222-8222-222222222222';
const image={mime:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='};
const configuration={AUTHOR_SETTLEMENT_REGISTRATION_ENABLED:'true',AUTHOR_SETTLEMENT_ENCRYPTION_KEY:'ab'.repeat(32),AUTHOR_SETTLEMENT_KEY_VERSION:'v1',AUTHOR_SETTLEMENT_PRIVACY_REVIEWED:'true',AUTHOR_SETTLEMENT_TRANSFER_NOTICE_VERSION:'approved-notice-v1',AUTHOR_SETTLEMENT_TRANSFER_NOTICE_TEXT:'Synthetic final overseas processing notice for local verification only. '.repeat(8)};
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
async function fixture(options={}){
 const env={...configuration,...options.env},policy=await settlementPolicy(env),calls=[],sessions=[],state={application:null,encrypted:null},auth={passwordFailure:false,sessionUser:null,factors:[],currentFactors:[]};
 let actor={userId:owner,author:{id:'9007199254740993',status:'APPROVED'}},user={id:owner,email:'owned@example.test'};
 const rpc=async(name,data)=>{
  calls.push({name,data});if(name==='author_settlement_registration'){
   const action=data.p_action;if(action==='get')return {application:state.application};if(action==='admin-list')return {applications:[],total:0,pageSize:30,offset:0};
   if(action==='attempt'||action==='admin-attempt')return {ok:true};
   if(action==='submit'){
    state.application={authorId:actor.author.id,revision:'1',status:'PENDING',applicantType:data.p_data.applicantType,documentType:data.p_data.documentType,documentAvailable:true};
    state.encrypted={...data.p_data,userId:user.id,authorId:actor.author.id,revision:'1'};return {ok:true,application:state.application};
   }
   if(action==='reveal')return {application:state.application,encrypted:state.encrypted};
   if(action==='review')return {ok:true,application:{...state.application,revision:'2',status:data.p_data.decision,documentAvailable:false}};
   if(action==='bank-delete')return {ok:true,bank:null};
   return {ok:true};
  }return {ok:true};
 };
 const remote=async(path,options)=>{
  if(path.startsWith('/auth/v1/token')){
   const credentials=JSON.parse(options.body);assert.equal(credentials.email,user.email);sessions.push(credentials.password);
   return auth.passwordFailure?Response.json({}, {status:403}):Response.json({user:{id:auth.sessionUser||user.id,factors:auth.factors},access_token:'short-lived-check-session'});
  }
  if(path.startsWith('/auth/v1/logout')){assert.match(path,/scope=local/);assert.equal(options.headers.Authorization,'Bearer short-lived-check-session');sessions.push('revoked');return new Response(null,{status:204});}
  throw Error('UNEXPECTED_REMOTE');
 };
 const invoke=async(path='/api/v2/creator/settlement',body,headers={},key=crypto.randomUUID())=>{
  const request=new Request('https://app.test'+path,{method:body===undefined?'GET':'POST',headers:{Origin:'https://app.test','Content-Type':'application/json','Idempotency-Key':key,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  try{return {status:200,data:await authorSettlementApi({request,env,actor,user:{...user,factors:auth.currentFactors},rpc,remote,fail,ready:true}),request};}
  catch(error){return {status:error.status||503,data:{error:error.code||error.message},request};}
 };
 const details=()=>({revision:'0',applicantType:'INDIVIDUAL',legalName:'Synthetic Person',birthDate:'2000-01-02',postalCode:'00000',address:'Synthetic address',addressDetail:'Synthetic unit',companyName:'',businessNumber:'',documentType:'RESIDENT_CARD',identityImage:{...image},businessImage:null,privacyConsent:true,redactionConfirmed:true,policyVersion:policy.version,policyHash:policy.hash,transferConsent:true,transferNoticeVersion:policy.transferNoticeVersion,transferNoticeHash:policy.transferNoticeHash,password:'synthetic-current-password'});
 return {env,policy,calls,sessions,state,auth,invoke,details,rpc,remote,setActor(value){actor=value;user={id:value.userId,email:value.admin?'admin@example.test':'owned@example.test'};}};
}
test('new collection fails closed before consuming a body until both legal review and a final overseas notice exist',async()=>{
 for(const env of [{AUTHOR_SETTLEMENT_PRIVACY_REVIEWED:'false'},{AUTHOR_SETTLEMENT_TRANSFER_NOTICE_VERSION:''},{AUTHOR_SETTLEMENT_TRANSFER_NOTICE_VERSION:'draft-v1'},{AUTHOR_SETTLEMENT_TRANSFER_NOTICE_TEXT:'short'}]){
  const f=await fixture({env}),read=await f.invoke();assert.equal(read.data.enabled,true);assert.equal(read.data.collectionEnabled,false);
  const sent=await f.invoke(undefined,f.details());assert.equal(sent.status,503);assert.equal(sent.data.error,'PRIVACY_TRANSFER_NOT_READY');assert.equal(sent.request.bodyUsed,false);assert.equal(f.sessions.length,0);
  assert.equal((await f.invoke('/api/v2/creator/settlement/withdraw',{revision:'1',password:'synthetic-password'})).status,200);
 }
});
test('unknown identifiers, malformed input, missing consent and origin errors cannot reach reauthentication or the DB mutation',async()=>{
 const f=await fixture();
 for(const delta of [{rrn:'not-accepted'},{legalName:'123456-1234567'},{birthDate:'2026-02-30'},{privacyConsent:false},{transferConsent:false},{transferNoticeHash:'0'.repeat(64)},{postalCode:'1234'}]){
  assert.equal((await f.invoke(undefined,{...f.details(),...delta})).status,400);
 }
 assert.equal((await f.invoke(undefined,f.details(),{Origin:'https://other.test'})).status,403);
 assert.equal((await f.invoke(undefined,f.details(),{},'invalid-key')).status,400);
 assert.equal(f.sessions.length,0);assert.equal(f.calls.filter(call=>call.data.p_action==='submit').length,0);
});
test('submissions encrypt exact allowlisted owner-bound details and images; logical retries ignore password and nonce differences',async()=>{
 const f=await fixture(),key=crypto.randomUUID(),body=f.details();assert.equal((await f.invoke(undefined,body,{},key)).status,200);
 const sent=f.calls.find(call=>call.data.p_action==='submit').data;
 assert.equal(sent.p_user,owner);assert.equal(sent.p_author,null);assert.equal(sent.p_key,key);assert.doesNotMatch(JSON.stringify(sent),/Synthetic Person|Synthetic address|synthetic-current-password|iVBOR/);
 const context={userId:owner,authorId:'9007199254740993',revision:'1'};
 assert.equal((await decryptSettlement(sent.p_data.profileEnvelope,{...context,purpose:'profile'},f.env)).legalName,'Synthetic Person');
 assert.deepEqual(await decryptSettlement(sent.p_data.identityEnvelope,{...context,purpose:'identity-image'},f.env),image);
 const second=await f.invoke(undefined,{...body,password:'different-valid-password'}, {},key);assert.equal(second.status,200);
 const retry=f.calls.filter(call=>call.data.p_action==='submit').at(-1).data;
 assert.equal(sent.p_data.requestFingerprint,retry.p_data.requestFingerprint);assert.notEqual(sent.p_data.identityEnvelope.iv,retry.p_data.identityEnvelope.iv);assert.deepEqual(f.sessions,['synthetic-current-password','revoked','different-valid-password','revoked']);
 const summary=await f.invoke();assert.doesNotMatch(JSON.stringify(summary.data),/Synthetic Person|Synthetic address|ciphertext|iVBOR/);
});
test('business evidence is required for sole proprietors and corporations without collecting personal national IDs',async()=>{
 for(const applicantType of ['SOLE_PROPRIETOR','CORPORATION']){
  const f=await fixture(),body={...f.details(),applicantType,companyName:'Synthetic company',businessNumber:'000-00-00000'};
  assert.equal((await f.invoke(undefined,body)).status,400);
  assert.equal((await f.invoke(undefined,{...body,businessImage:image})).status,200);
  const sent=f.calls.find(call=>call.data.p_action==='submit').data.p_data;assert.ok(sent.businessEnvelope);assert.equal(sent.applicantType,applicantType);
 }
});
test('failed or mismatched password sessions and enrolled MFA fail closed without writing PII',async()=>{
 for(const setting of [{passwordFailure:true},{sessionUser:admin},{factors:[{status:'verified'}]},{currentFactors:[{status:'verified'}]}]){
  const f=await fixture();Object.assign(f.auth,setting);const response=await f.invoke(undefined,f.details());
  assert.equal(response.status,403);assert.equal(response.data.error,'SETTLEMENT_REAUTH_REQUIRED');
  assert.equal(f.calls.filter(call=>call.data.p_action==='submit').length,0);
  if(setting.currentFactors){assert.equal(f.calls.length,0);assert.equal(f.sessions.length,0);}
  else{assert.equal(f.calls[0].data.p_action,'attempt');if(!setting.passwordFailure)assert.equal(f.sessions.at(-1),'revoked');}
 }
});
test('only a reauthenticated super admin receives audited decrypted documents for the exact selected revision',async()=>{
 const f=await fixture();await f.invoke(undefined,f.details());
 const path='/api/v2/admin/settlements/identity/9007199254740993/reveal';
 f.setActor({userId:admin,admin:{is_active:true,role:'SUB_ADMIN',permissions:['AUTHOR_SETTLEMENT']}});
 assert.equal((await f.invoke(path,{revision:'1',reason:'Manual review of masked evidence',password:'current-admin-password'})).status,403);
 f.setActor({userId:admin,admin:{is_active:true,role:'SUPER_ADMIN'}});
 const shown=await f.invoke(path,{revision:'1',reason:'Manual review of masked evidence',password:'current-admin-password'});
 assert.equal(shown.status,200,JSON.stringify(shown.data));assert.equal(shown.data.details.legalName,'Synthetic Person');assert.deepEqual(shown.data.details.identityImage,image);assert.equal(shown.data.encrypted,undefined);
 const access=f.calls.find(call=>call.data.p_action==='reveal').data;assert.match(access.p_data.reasonFingerprint,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(access),/Manual review|current-admin-password/);
 assert.equal((await f.invoke(path,{revision:'2',reason:'Manual review of masked evidence',password:'current-admin-password'})).status,503);
 assert.equal((await f.invoke(path,{revision:'1',reason:'123456-1234567',password:'current-admin-password'})).status,400);
});
test('review and private bank deletion retain logical UUID keys and remain available when new collection is closed',async()=>{
 const f=await fixture({env:{AUTHOR_SETTLEMENT_PRIVACY_REVIEWED:'false'}}),key=crypto.randomUUID();
 const removed=await f.invoke('/api/v2/creator/settlement/bank/delete',{revision:'4',password:'current-author-password'}, {},key);
 assert.equal(removed.status,200);assert.deepEqual(removed.data,{ok:true,bank:null});assert.equal(f.calls.at(-1).data.p_action,'bank-delete');assert.equal(f.calls.at(-1).data.p_key,key);
 f.setActor({userId:admin,admin:{is_active:true,role:'SUPER_ADMIN'}});
 const reviewed=await f.invoke('/api/v2/admin/settlements/identity/9007199254740993/review',{revision:'1',decision:'NEEDS_CHANGES',note:'Please provide a readable masked document',password:'admin-password'}, {},key);
 assert.equal(reviewed.status,200);assert.equal(f.calls.at(-1).data.p_action,'review');assert.equal(f.calls.at(-1).data.p_key,key);
});
test('image validation bounds pixels and bytes, rejects spoofed formats and source metadata',()=>{
 assert.deepEqual(validateSettlementImage(image),image);
 for(const value of [{...image,mime:'image/svg+xml'},{...image,data:'a'.repeat(204804)},{...image,data:'data:image/png;base64,'+image.data},{...image,extra:'forbidden'}])assert.throws(()=>validateSettlementImage(value),/INVALID_SETTLEMENT_IMAGE/);
 const bytes=Uint8Array.from(atob(image.data),c=>c.charCodeAt(0)),altered=bytes.slice();altered[16]=127;
 assert.throws(()=>validateSettlementImage({...image,data:Buffer.from(altered).toString('base64')}),/INVALID_SETTLEMENT_IMAGE/);
 const bad=bytes.slice();bad.set([101,88,73,102],37);assert.throws(()=>validateSettlementImage({...image,data:Buffer.from(bad).toString('base64')}),/INVALID_SETTLEMENT_IMAGE/);
});
test('the account router exposes only authenticated no-store JSON and preserves the default beta bank rejection',async()=>{
 const response=await accountApi(new Request('https://app.test/api/v2/creator/settlement'),{SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_synthetic'},{fetchImpl:async url=>new URL(url).pathname.endsWith('launch_accounts_ready')?Response.json(true):Response.json({})});
 assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'no-store');
 const f=await fixture({env:{FREE_BETA_ENABLED:'true',AUTHOR_SETTLEMENT_PRIVACY_REVIEWED:'false'}});
 const request=new Request('https://app.test/api/v2/creator/dashboard?action=save-bank',{method:'POST',headers:{Origin:'https://app.test','Content-Type':'application/json'},body:JSON.stringify({any:'must-not-be-consumed'})});
 await assert.rejects(authorDashboardApi({request,env:f.env,actor:{author:{id:'1',status:'APPROVED'}},user:{id:owner},rpc:f.rpc,remote:f.remote,fail,ready:true}),error=>error.code==='PRIVACY_TRANSFER_NOT_READY');assert.equal(request.bodyUsed,false);
});
test('trusted current-user MFA blocks bank registration even if a password response omits its factors',async()=>{
 const f=await fixture(),policy=f.policy;
 const request=new Request('https://app.test/api/v2/creator/dashboard?action=save-bank',{method:'POST',headers:{Origin:'https://app.test','Content-Type':'application/json'},body:JSON.stringify({revision:'0',bankName:'Synthetic bank',holder:'Synthetic holder',accountNumber:'000000001234',password:'current-password',consent:true,policyVersion:policy.version,policyHash:policy.hash,transferConsent:true,transferNoticeVersion:policy.transferNoticeVersion,transferNoticeHash:policy.transferNoticeHash})});
 await assert.rejects(authorDashboardApi({request,env:{...f.env,FREE_BETA_ENABLED:'true'},actor:{author:{id:'1',status:'APPROVED'}},user:{id:owner,email:'owned@example.test',factors:[{status:'verified'}]},rpc:f.rpc,remote:f.remote,fail,ready:true}),error=>error.code==='BANK_REAUTH_REQUIRED');
 assert.equal(f.sessions.length,0);assert.equal(f.calls.length,0);
});
