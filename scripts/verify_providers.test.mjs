import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmTossPayment } from '../server/providers/toss.mjs';
import { verifyPortOneIdentity } from '../server/providers/portone-identity.mjs';

const payment = () => ({ order: { id: 'order-server-0001', auth_user_id: 'user-a', status: 'APPROVING', amount_krw: 5000, currency: 'KRW' }, actorId: 'user-a', paymentKey: 'payment-provider-1', clientAmount: 5000, secretKey: 'test_sk_private', mode: 'TEST' });
const receipt = () => ({ orderId: 'order-server-0001', paymentKey: 'payment-provider-1', totalAmount: 5000, status: 'DONE', currency: 'KRW', approvedAt: '2026-09-21T00:00:00Z' });
test('Toss rejects wrong owner, changed amount and unreserved order before provider call', async () => {
  for (const mutate of [p=>{p.actorId='user-b';},p=>{p.clientAmount=1;},p=>{p.order.status='PENDING';},p=>{p.order.amount_krw=1.5;}]) {
    const p=payment();mutate(p);await assert.rejects(confirmTossPayment(p,async()=>{assert.fail('provider must not be called');}));
  }
});
test('Toss makes real request with server amount and stable idempotency key', async () => {
  const calls=[]; const fetcher=async(url,init)=>{calls.push({url,init});return Response.json(receipt());};
  await confirmTossPayment(payment(),fetcher);await confirmTossPayment(payment(),fetcher);
  assert.equal(calls[0].url,'https://api.tosspayments.com/v1/payments/confirm');
  assert.equal(calls[0].init.headers['Idempotency-Key'],calls[1].init.headers['Idempotency-Key']);
  assert.equal(JSON.parse(calls[0].init.body).amount,5000);
});
test('example keys never generate fabricated payment success', async () => {
  const p=payment();p.secretKey='test_sk_docs_example';await assert.rejects(confirmTossPayment(p),/CONFIGURATION_REQUIRED/);
});
test('mismatched payment response and uncertain timeout cannot finalize order', async () => {
  for (const changes of [{totalAmount:1},{orderId:'other'},{paymentKey:'other'},{currency:'USD'},{status:'WAITING_FOR_DEPOSIT'}]) await assert.rejects(confirmTossPayment(payment(),async()=>Response.json({...receipt(),...changes})),/MISMATCH/);
  await assert.rejects(confirmTossPayment(payment(),async()=>{throw new Error('network timeout');}),/RESULT_UNKNOWN/);
});

const identity = () => ({ attempt:{id:'identity-random-00000001',auth_user_id:'user-a',status:'PENDING',created_at:'2026-09-21T00:00:00Z',expires_at:'2026-09-21T00:10:00Z'},actorId:'user-a',apiSecret:'secret',storeId:'store-id',channelKey:'channel-id',mode:'TEST',now:Date.parse('2026-09-21T00:05:00Z') });
const verified = () => ({ id:'identity-random-00000001',status:'VERIFIED',verifiedAt:'2026-09-21T00:03:00Z',channel:{key:'channel-id',type:'TEST'},verifiedCustomer:{birthDate:'1990-01-01',name:'not returned',phoneNumber:'not returned'} });
test('PortOne requires user-bound unexpired attempt', async () => {
  for(const mutate of [p=>{p.actorId='user-b';},p=>{p.attempt.status='VERIFIED';},p=>{p.attempt.expires_at='2026-01-01';}]){const p=identity();mutate(p);await assert.rejects(verifyPortOneIdentity(p,async()=>{assert.fail('provider must not be called');}));}
});
test('PortOne server lookup uses configured store and never returns name, phone or CI', async () => {
  const result=await verifyPortOneIdentity(identity(),async(url,init)=>{assert.equal(url.searchParams.get('storeId'),'store-id');assert.equal(init.headers.Authorization,'PortOne secret');return Response.json(verified());});
  assert.deepEqual(Object.keys(result).sort(),['authUserId','verificationId','verifiedAt','verifiedBirthDate']);
});
test('identity success flag without verified provider DOB cannot grant adulthood', async () => {
  for(const changes of [{status:'READY'},{id:'other'},{channel:{key:'other',type:'TEST'}},{channel:{key:'channel-id',type:'LIVE'}},{verifiedCustomer:{birthDate:'2000-02-30'}},{verifiedCustomer:{}},{verifiedAt:'2020-01-01'}])await assert.rejects(verifyPortOneIdentity(identity(),async()=>Response.json({...verified(),...changes})));
});
