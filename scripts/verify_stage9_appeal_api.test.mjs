import test from 'node:test';
import assert from 'node:assert/strict';
import {stage9AppealApi} from '../server/stage9-appeal-api.mjs';
const who={userId:'11111111-1111-4111-8111-111111111111',author:{status:'APPROVED'}};
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
async function invoke(action,{method='GET',data,identity=who,flag='true'}={}){
  const calls=[];
  const request=new Request('https://example.test/api/v2/appeals?action='+action,{method,
    ...(data?{headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify(data)}:{})});
  const result=await stage9AppealApi({request,env:{ADMIN_OPERATIONS_ENABLED:flag},actor:async()=>identity,
    db:async(route,query,options)=>{calls.push({route,options});return {cases:[]};},
    readBody:async()=>data,fail});
  return {result,calls};
}
test('appeal gate and verified profile are required',async()=>{
  await assert.rejects(invoke('eligible',{flag:'false'}),{code:'ADMIN_OPERATIONS_NOT_ACTIVATED'});
  await assert.rejects(invoke('eligible',{identity:{userId:who.userId}}),{code:'ACCOUNT_REQUIRED'});
  const {calls}=await invoke('eligible');
  assert.equal(calls[0].route,'rpc/stage9_appeal');
  assert.equal(calls[0].options.body.p_user,who.userId);
});
test('submission accepts only source, ID and bounded reason',async()=>{
  const data={source:'CONTENT_REVIEW',sourceId:'33333333-3333-4333-8333-333333333333',reason:'검수 이의 제기'};
  const {calls}=await invoke('submit',{method:'POST',data});
  assert.deepEqual(calls[0].options.body.p_data,data);
  await assert.rejects(invoke('submit',{method:'POST',data:{...data,userId:who.userId}}),{code:'INVALID_APPEAL'});
  await assert.rejects(invoke('submit',{method:'POST',data:{...data,sourceId:'1'}}),{code:'INVALID_APPEAL'});
  await assert.rejects(invoke('submit',{method:'GET'}),{code:'METHOD_NOT_ALLOWED'});
});
