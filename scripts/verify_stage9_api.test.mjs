import test from 'node:test';
import assert from 'node:assert/strict';
import {stage9Api} from '../server/stage9-api.mjs';

const who={userId:'11111111-1111-4111-8111-111111111111',admin:{role:'SUPER_ADMIN',is_active:true}};
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
async function invoke(path,{method='GET',data,identity=who,flag='true',roleFlag='true',origin='https://example.test'}={}){
  const calls=[];
  const request=new Request('https://example.test'+path,{method,
    ...(data?{headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)}:{})});
  const result=await stage9Api({request,env:{ADMIN_OPERATIONS_ENABLED:flag,ADMIN_ROLE_CHANGES_ENABLED:roleFlag},actor:async()=>identity,
    db:async(route,query,options)=>{calls.push({route,options});return {works:[]};},
    readBody:async()=>data,fail});
  return {result,calls};
}
test('rollout gate and actor check precede operational reads',async()=>{
  await assert.rejects(invoke('/api/v2/admin/operations',{flag:'false'}),{code:'ADMIN_OPERATIONS_NOT_ACTIVATED'});
  await assert.rejects(invoke('/api/v2/admin/operations',{identity:{userId:who.userId}}),{code:'ADMIN_REQUIRED'});
  const {calls}=await invoke('/api/v2/admin/operations?action=work-list');
  assert.equal(calls[0].route,'rpc/stage9_admin');
  assert.deepEqual(calls[0].options.body,{p_user:who.userId,p_action:'work-list',p_data:{}});
});
test('case source and mutation fields are fixed before service RPC',async()=>{
  const {calls}=await invoke('/api/v2/admin/operations?action=cases&source=CONTENT_REVIEW');
  assert.deepEqual(calls[0].options.body.p_data,{source:'CONTENT_REVIEW'});
  assert.equal((await invoke('/api/v2/admin/operations?action=appeals')).calls[0].options.body.p_action,'appeals');
  await assert.rejects(invoke('/api/v2/admin/operations?action=cases&source=ALL'),{code:'INVALID_CASE_SOURCE'});
  await assert.rejects(invoke('/api/v2/admin/operations?action=dashboard&secret=1'),{code:'INVALID_QUERY'});
  await assert.rejects(invoke('/api/v2/admin/operations?action=moderate',{method:'POST',
    data:{workId:'10',version:'1',decision:'RESTRICT',reason:'정책 위반',body:'unsafe'}}),{code:'INVALID_MODERATION'});
  await assert.rejects(invoke('/api/v2/admin/operations?action=moderate',{method:'POST',origin:'https://evil.test',
    data:{workId:'10',version:'1',decision:'RESTRICT',reason:'정책 위반'}}),{code:'ORIGIN_REQUIRED'});
  const mutation=await invoke('/api/v2/admin/operations?action=curate',{method:'POST',data:{
    workId:'10',version:'1',flag:'is_top_recommended',enabled:true,reason:'편집 선정'}});
  assert.equal(mutation.calls[0].options.body.p_action,'curate');
  await assert.rejects(invoke('/api/v2/admin/operations?action=role-update',{method:'POST',data:{
    adminId:'33333333-3333-4333-8333-333333333333',permissions:['CONTENT_WRITE'],reason:'권한 변경'}}),
  {code:'INVALID_PERMISSIONS'});
  const role=await invoke('/api/v2/admin/operations?action=role-update',{method:'POST',data:{
    adminId:'33333333-3333-4333-8333-333333333333',permissions:['AUDIT_READ'],reason:'감사 담당'}});
  assert.equal(role.calls[0].options.body.p_action,'role-update');
  await assert.rejects(invoke('/api/v2/admin/operations?action=role-update',{method:'POST',roleFlag:'false',data:{
    adminId:'33333333-3333-4333-8333-333333333333',permissions:['AUDIT_READ'],reason:'감사 담당'}}),
  {code:'ADMIN_ROLE_CHANGES_NOT_ACTIVATED'});
  await assert.rejects(invoke('/api/v2/admin/operations?action=account-moderate',{method:'POST',data:{
    kind:'reader',accountId:'1',decision:'SUSPEND',reason:'규정 위반'}}),{code:'INVALID_ACCOUNT'});
  const account=await invoke('/api/v2/admin/operations?action=account-moderate',{method:'POST',data:{
    kind:'author',accountId:'2',decision:'SUSPEND',reason:'규정 위반'}});
  assert.equal(account.calls[0].options.body.p_action,'account-moderate');
  const appeal=await invoke('/api/v2/admin/operations?action=appeal-resolve',{method:'POST',data:{
    appealId:'33333333-3333-4333-8333-333333333333',decision:'ACCEPT',reason:'재검토 수용'}});
  assert.equal(appeal.calls[0].options.body.p_action,'appeal-resolve');
});
