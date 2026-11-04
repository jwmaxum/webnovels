import test from 'node:test';
import assert from 'node:assert/strict';
import {liveCommerceApi} from '../server/live-commerce-api.mjs';
import {projectAllocation} from '../server/live-commerce-allocations.mjs';
import {env,operator,reviewer,setup} from './fixtures/op15-db.mjs';
import {depositInstructions} from '../server/live-commerce-policy.mjs';
const origin='https://site.test';
test('OP15 API gates admin actions, injects current instructions, reauthenticates writes and strips secrets',async()=>{
 const f=await setup();try{
  let current=operator;const calls=[];const rpc=async(name,args)=>{calls.push({name,args});if(name==='author_settlement_registration')return {ok:true};if(name==='op15_commerce_allocations')return f.allocate(args.p_action,args.p_data,args.p_user);return f.call(args.p_role,args.p_action,args.p_data,args.p_user);};
  const remote=async path=>path.startsWith('/auth/v1/token')?Response.json({user:{id:current},access_token:'synthetic'}):new Response(null,{status:204});
  const api=(action,data={},configuration=env,role='SUPER_ADMIN')=>liveCommerceApi({env:configuration,request:new Request(origin+'/api/v2/admin/live-commerce',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action,...data})}),actor:{userId:current,admin:{role,is_active:true}},user:{id:current,email:'synthetic@example.test',email_confirmed_at:'2026-01-01'},rpc,remote});
  const instructions=await depositInstructions(env),order=await f.write('reader','order',{destinationHash:instructions.destinationHash});const deposit=await f.write('admin','deposit',{orderId:order.id,destinationHash:instructions.destinationHash,amount:12000,bankRefHash:'c'.repeat(64),occurredAt:new Date().toISOString(),evidence:await f.evidence()});assert(deposit.id);
  const body={requestId:crypto.randomUUID(),password:'synthetic',kind:'CREDIT',orderId:order.id,sources:[{depositId:deposit.id,amount:10000}],reasonRef:'synthetic-review',reassignmentConfirmed:false};
  await assert.rejects(api('funding-propose',body,{...env,LIVE_MANUAL_COMMERCE_ENABLED:'false'}),e=>e.code==='LIVE_COMMERCE_NOT_ACTIVATED');await assert.rejects(api('funding-propose',body,env,'EDITOR'),e=>e.code==='ADMIN_FORBIDDEN');
  await assert.rejects(api('funding-propose',{...body,destinationHash:'0'.repeat(64)}),e=>e.code==='INVALID_COMMERCE_REQUEST');
  await assert.rejects(api('funding-propose',{...body,sources:[...body.sources,...body.sources]}),e=>e.code==='INVALID_COMMERCE_REQUEST');
  const plan=await api('funding-propose',body);assert(plan.id);const payload=calls.find(x=>x.name==='op15_commerce_allocations'&&x.args.p_action==='funding-propose').args.p_data;assert.equal(payload.destinationHash,instructions.destinationHash);assert(!('password'in payload));
  current=reviewer;assert((await api('funding-review',{requestId:crypto.randomUUID(),password:'synthetic',planId:plan.id,approved:true})).id);
  const list=await api('funding-list',{offset:0});assert.equal(list.deposits[0].available,'2000');assert(!JSON.stringify(list).includes('envelope'));
  const queue=await api('notification-list',{offset:0});assert.equal(queue.deliveryEnabled,false);assert.equal(queue.items.length,1);
  assert.throws(()=>projectAllocation({mode:'TEST',source:'LOCAL_SIMULATED'},'funding-list'));assert.throws(()=>projectAllocation({...queue,deliveryEnabled:true},'notification-list'));
 }finally{await f.db.close();}
});
