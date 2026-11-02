import {settlementCollectionEnabled,settlementRegistrationEnabled} from './author-settlement-api.mjs';
export const settlementReadinessEnabled=env=>env.SETTLEMENT_READINESS_ENABLED==='true'&&settlementRegistrationEnabled(env);
export const proofPolicyReady=env=>settlementCollectionEnabled(env)&&env.BANK_PROOF_PRIVACY_REVIEWED==='true'&&
 /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(env.BANK_PROOF_POLICY_VERSION||'')&&!/draft/i.test(env.BANK_PROOF_POLICY_VERSION)&&
 typeof env.BANK_PROOF_POLICY_TEXT==='string'&&env.BANK_PROOF_POLICY_TEXT.trim().length>=200&&env.BANK_PROOF_POLICY_TEXT.length<=8000&&!env.BANK_PROOF_POLICY_TEXT.includes('\0')&&
 /^[1-9]\d{0,3}$/.test(env.BANK_PROOF_RETENTION_DAYS||'')&&Number(env.BANK_PROOF_RETENTION_DAYS)<=3650;
export async function proofPolicy(env){
 if(!proofPolicyReady(env))return {collectionEnabled:false,version:null,hash:null,retentionDays:null,text:'은행 증빙의 처리 목적·접근자·보존 기간·국외 처리 조건을 확정한 뒤 접수를 시작합니다.'};
 const value={version:env.BANK_PROOF_POLICY_VERSION,retentionDays:Number(env.BANK_PROOF_RETENTION_DAYS),text:env.BANK_PROOF_POLICY_TEXT};
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
 return {collectionEnabled:true,...value,hash:Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')};
}
