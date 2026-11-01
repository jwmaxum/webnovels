import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {settlementKeyReady,encryptSettlement,decryptSettlement,settlementFingerprint} from '../server/author-settlement-crypto.mjs';
import {settlementPolicy,settlementTransferNoticeReady} from '../server/author-settlement-policy.mjs';
const env={AUTHOR_SETTLEMENT_ENCRYPTION_KEY:'ab'.repeat(32),AUTHOR_SETTLEMENT_KEY_VERSION:'v1'};
const context={userId:'11111111-1111-4111-8111-111111111111',authorId:'9007199254740993',revision:'7',purpose:'profile'};
test('dedicated settlement key fails closed and cannot use Supabase or provider credentials as fallback',async()=>{
 for(const value of [{},{...env,AUTHOR_SETTLEMENT_ENCRYPTION_KEY:'short'},{...env,AUTHOR_SETTLEMENT_KEY_VERSION:'v2'},{SUPABASE_SERVICE_ROLE_KEY:'service-only',PROVIDER_SETTINGS_MASTER_KEY:'ab'.repeat(32)}]){
  assert.equal(settlementKeyReady(value),false);await assert.rejects(encryptSettlement({value:'synthetic'},context,value),/SETTLEMENT_KEY_REQUIRED/);
 }
 assert.equal(settlementKeyReady(env),true);
});
test('fresh AES-GCM nonces bind encrypted values to exact account, author, revision, purpose and key',async()=>{
 const secret={legalName:'Synthetic applicant',address:'Synthetic address',businessNumber:'0000000000'};
 const a=await encryptSettlement(secret,context,env),b=await encryptSettlement(secret,context,env);
 assert.notEqual(a.iv,b.iv);assert.notEqual(a.ciphertext,b.ciphertext);assert.doesNotMatch(JSON.stringify(a),/Synthetic|0000000000/);
 assert.deepEqual(await decryptSettlement(a,context,env),secret);
 for(const delta of [{userId:'other-account'},{authorId:'2'},{revision:'8'},{purpose:'identity-image'}])await assert.rejects(decryptSettlement(a,{...context,...delta},env),/SETTLEMENT_KEY_UNAVAILABLE/);
 await assert.rejects(decryptSettlement(a,context,{...env,AUTHOR_SETTLEMENT_ENCRYPTION_KEY:'cd'.repeat(32)}),/SETTLEMENT_KEY_UNAVAILABLE/);
 await assert.rejects(decryptSettlement({...a,keyVersion:'v2'},context,env),/SETTLEMENT_KEY_UNAVAILABLE/);
 await assert.rejects(decryptSettlement({...a,ciphertext:(a.ciphertext[0]==='A'?'B':'A')+a.ciphertext.slice(1)},context,env),/SETTLEMENT_KEY_UNAVAILABLE/);
});
test('HMAC fingerprints are deterministic within a logical request and unlinkable across keys or business payload changes',async()=>{
 const value={actor:'synthetic',revision:'1',legalName:'Synthetic applicant'};
 assert.equal(await settlementFingerprint(value,env),await settlementFingerprint(value,env));
 assert.notEqual(await settlementFingerprint(value,env),await settlementFingerprint({...value,revision:'2'},env));
 assert.notEqual(await settlementFingerprint(value,env),await settlementFingerprint(value,{...env,AUTHOR_SETTLEMENT_ENCRYPTION_KEY:'cd'.repeat(32)}));
});
test('base policy is pinned in SQL while final transfer notices have environment-specific hashes and no cross-environment cache',async()=>{
 const draft=await settlementPolicy(env),finalEnv={...env,AUTHOR_SETTLEMENT_TRANSFER_NOTICE_VERSION:'approved-v1',AUTHOR_SETTLEMENT_TRANSFER_NOTICE_TEXT:'Synthetic final notice used only in local verification. '.repeat(8)};
 assert.equal(draft.transferNoticeFinalized,false);assert.equal(settlementTransferNoticeReady({...finalEnv,AUTHOR_SETTLEMENT_TRANSFER_NOTICE_VERSION:'draft-v1'}),false);
 assert.equal(settlementTransferNoticeReady({...finalEnv,AUTHOR_SETTLEMENT_TRANSFER_NOTICE_TEXT:'Too short'}),false);
 const final=await settlementPolicy(finalEnv),changed=await settlementPolicy({...finalEnv,AUTHOR_SETTLEMENT_TRANSFER_NOTICE_TEXT:finalEnv.AUTHOR_SETTLEMENT_TRANSFER_NOTICE_TEXT+' Changed processing recipient.'});
 assert.equal(final.transferNoticeFinalized,true);assert.equal(final.hash,draft.hash);assert.notEqual(final.transferNoticeHash,draft.transferNoticeHash);assert.notEqual(final.transferNoticeHash,changed.transferNoticeHash);
 assert.equal((await settlementPolicy(env)).transferNoticeHash,draft.transferNoticeHash);
 const sql=await readFile(new URL('../database/launch/016_author_settlement_registration.sql',import.meta.url),'utf8');assert.ok(sql.includes(final.hash));assert.ok(sql.includes(final.version));
});
