import test from 'node:test';
import assert from 'node:assert/strict';
import {env,operator,reviewer,setup} from './fixtures/op14-db.mjs';
import {liveCommerceApi} from '../server/live-commerce-api.mjs';
import {operationReadiness,projectOperation} from '../server/live-commerce-operations.mjs';
import {encryptSettlement,decryptSettlement,settlementFingerprint,settlementKeyReady,settlementKeyStatus} from '../server/author-settlement-crypto.mjs';
import {liveCommercePolicy} from '../server/live-commerce-policy.mjs';
import {buildAuthPatch,summarizeAuthConfig} from './configure_stage35_auth.mjs';
const origin='https://site.test',image={mime:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='};
test('OP14 SMTP preparation preserves the approved custom domain and rejects arbitrary redirect origins',()=>{
 const current={site_url:'https://webnovels.uk',uri_allow_list:'',mailer_autoconfirm:false},patch=buildAuthPatch(current);
 assert.equal(patch.site_url,current.site_url);assert(patch.uri_allow_list.includes('https://webnovels.uk/\\?auth=confirm'));assert(summarizeAuthConfig({...current,...patch}).publicRedirectsReady);
 assert.throws(()=>buildAuthPatch(current,{BETA_AUTH_SITE_URL:'https://evil.test'}),/ORIGIN_NOT_APPROVED/);
});
test('OP14 encryption key rotation retains old reads and stable bank dedupe; missing keys and AAD reject',async()=>{
 const legacy=env.AUTHOR_SETTLEMENT_ENCRYPTION_KEY,rotated={...env,AUTHOR_SETTLEMENT_KEY_VERSION:'v2',AUTHOR_SETTLEMENT_ENCRYPTION_KEYS_JSON:JSON.stringify({v1:legacy,v2:'79'.repeat(32)})},ctx={userId:operator,authorId:'0',revision:'1',purpose:'finance:BANK_DEPOSIT:synthetic'},value={bankReference:'synthetic-ref'},old=await encryptSettlement(value,ctx,env);
 assert(settlementKeyReady(rotated));assert.deepEqual(await decryptSettlement(old,ctx,rotated),value);
 const current=await encryptSettlement(value,ctx,rotated);assert.equal(current.keyVersion,'v2');assert.deepEqual(await decryptSettlement(current,ctx,rotated),value);
 assert.equal(await settlementFingerprint(value,rotated),await settlementFingerprint(value,env));
 await assert.rejects(decryptSettlement(current,ctx,env),/KEY_UNAVAILABLE/);await assert.rejects(decryptSettlement(current,{...ctx,purpose:'wrong'},rotated),/KEY_UNAVAILABLE/);
 for(const ring of [{v2:'79'.repeat(32)},{v1:'78'.repeat(32),v2:'79'.repeat(32)},['bad'],{v1:legacy,v2:'bad'}])assert.equal(settlementKeyReady({...rotated,AUTHOR_SETTLEMENT_ENCRYPTION_KEYS_JSON:JSON.stringify(ring)}),false);
 assert(!JSON.stringify(settlementKeyStatus(rotated)).includes(legacy));
});
test('OP14 readiness separates presence from verified delivery and real-money acceptance',()=>{
 const state=operationReadiness({...env,BETA_SMTP_HOST:'smtp.example.test',BETA_SMTP_PORT:'587',BETA_SMTP_USER:'synthetic',BETA_SMTP_PASS:'synthetic-secret',BETA_SMTP_ADMIN_EMAIL:'noreply@example.test',BETA_SMTP_SENDER_NAME:'synthetic'});
 assert(state.smtp.configurationPresent);assert.equal(state.smtp.deliveryVerified,false);assert.equal(state.realMoneyVerified,false);assert(!JSON.stringify(state).includes('synthetic-secret'));
 assert.throws(()=>projectOperation({mode:'TEST',source:'LOCAL_SIMULATED'},'month-list'));
 assert.throws(()=>projectOperation({mode:'LIVE_MANUAL',source:'BANK_RECONCILED',snapshot:{secret:'unexpected'}},'month-detail'));
});
test('OP14 API validates reproof against the original bank reference, encrypts it and approves independently',async()=>{
 const f=await setup();try{
  const d=await f.deposit(),reference={account:'synthetic-account',reference:'synthetic-bank-ref'};
  // Insert a new source with its authentic synthetic HMAC; existing source rows remain immutable.
  const order=await f.write('reader','order',{destinationHash:'d'.repeat(64)}),proof=await f.evidence();const dep=await f.write('admin','deposit',{orderId:order.id,destinationHash:'d'.repeat(64),amount:10000,bankRefHash:await settlementFingerprint(reference,env),occurredAt:new Date().toISOString(),evidence:proof});assert(dep.id);
  let current=operator;const calls=[];
  const rpc=async(name,args)=>{calls.push({name,args});if(name==='author_settlement_registration')return {ok:true};if(name==='op14_commerce_operations')return f.ops(args.p_action,args.p_data,args.p_user);return f.call(args.p_role,args.p_action,args.p_data,args.p_user);};
  const remote=async path=>path.startsWith('/auth/v1/token')?Response.json({user:{id:current},access_token:'synthetic'}):new Response(null,{status:204});
  const api=(action,data={},configuration=env)=>liveCommerceApi({env:configuration,request:new Request(origin+'/api/v2/admin/live-commerce',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action,...data})}),actor:{userId:current,admin:{role:'SUPER_ADMIN',is_active:true}},user:{id:current,email:'synthetic@example.test',email_confirmed_at:'2026-01-01'},rpc,remote});
  const policy=await liveCommercePolicy(env),data={requestId:crypto.randomUUID(),kind:'DEPOSIT',targetId:dep.id,reasonRef:'synthetic-reproof',password:'synthetic',documentId:crypto.randomUUID(),image,policyHash:policy.hash,policyVersion:policy.version,bankReference:reference.reference,bankAccountId:reference.account,confirmed:true};
  await assert.rejects(api('reproof',{...data,bankReference:'different'}),e=>e.code==='OP14_EVIDENCE_MISMATCH');
  const rotated={...env,AUTHOR_SETTLEMENT_KEY_VERSION:'v2',AUTHOR_SETTLEMENT_ENCRYPTION_KEYS_JSON:JSON.stringify({v1:env.AUTHOR_SETTLEMENT_ENCRYPTION_KEY,v2:'79'.repeat(32)})};
  const saved=await api('reproof',data,rotated);assert(saved.id);assert.equal((await api('reproof',data,rotated)).replayed,true);
  const payload=calls.find(c=>c.args?.p_action==='reproof').args.p_data;assert(!payload.image);assert(!payload.password);assert(!payload.bankReference);
  current=reviewer;assert((await api('review-reproof',{requestId:crypto.randomUUID(),proofId:saved.id,approved:true,password:'synthetic'})).id);
  assert.equal(payload.evidence.envelope.keyVersion,'v2');
  const revealed=await api('reveal',{documentId:data.documentId,password:'synthetic'},rotated);assert.equal(revealed.image.data,image.data);
  assert((await f.write('admin','confirm',{depositId:dep.id},reviewer)).id);
  const ready=await api('operations-readiness');assert.equal(ready.configuration.realMoneyVerified,false);
  const rows=await api('exceptions',{query:'',filter:'ALL',offset:0});assert(rows.items.some(i=>i.id===d.record.id));assert(!JSON.stringify(rows).includes(data.image.data));
  await assert.rejects(api('case-open',{requestId:crypto.randomUUID(),kind:'DEPOSIT',targetId:d.record.id,reasonRef:'private-info <x>',password:'synthetic'}),e=>e.code==='INVALID_COMMERCE_REQUEST');
 }finally{await f.db.close();}
});
