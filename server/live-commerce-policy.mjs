import {settlementKeyReady} from './author-settlement-crypto.mjs';
export const liveCommerceEnabled=(env={})=>env.LIVE_MANUAL_COMMERCE_ENABLED==='true'&&env.LIVE_COMMERCE_GUARD_ENABLED==='true'&&env.NEW_SERIALS_ENABLED==='true'&&env.LIVE_COMMERCE_RELEASE_REVIEWED==='true'&&env.P0_API_ENABLED==='true'&&env.FREE_BETA_ENABLED!=='true'&&env.FREE_BETA_ENABLED!==true&&['POINTS_TEST_ENABLED','CHARGING_TEST_ENABLED','AD_REWARDS_TEST_ENABLED','SETTLEMENTS_TEST_ENABLED','PAID_EPISODES_ENABLED','MONETIZATION_SANDBOX_ENABLED'].every(k=>env[k]!=='true')&&settlementKeyReady(env);
export const sha256=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof bytes==='string'?new TextEncoder().encode(bytes):bytes)),v=>v.toString(16).padStart(2,'0')).join('');
export async function liveCommercePolicy(env){
 const version=env.LIVE_FINANCE_PROOF_POLICY_VERSION||'',text=env.LIVE_FINANCE_PROOF_POLICY_TEXT||'',days=Number(env.LIVE_FINANCE_PROOF_RETENTION_DAYS);
 const enabled=env.LIVE_FINANCE_PRIVACY_REVIEWED==='true'&&env.AUTHOR_SETTLEMENT_PRIVACY_REVIEWED==='true'&&env.AUTHOR_SETTLEMENT_TRANSFER_NOTICE_VERSION&&!/draft/i.test(env.AUTHOR_SETTLEMENT_TRANSFER_NOTICE_VERSION)&&typeof env.AUTHOR_SETTLEMENT_TRANSFER_NOTICE_TEXT==='string'&&env.AUTHOR_SETTLEMENT_TRANSFER_NOTICE_TEXT.length>=200&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(version)&&!/draft/i.test(version)&&text.length>=200&&text.length<=8000&&Number.isInteger(days)&&days>=1&&days<=3650;
 return enabled?{enabled:true,version,text,hash:await sha256(text),days}:{enabled:false};
}
export async function depositInstructions(env){
 const text=env.LIVE_BANK_DEPOSIT_INSTRUCTIONS||'',destination=env.LIVE_BANK_DESTINATION_ID||'';
 if(!/^[A-Za-z0-9_.-]{3,80}$/.test(destination)||text.length<20||text.length>2000||/[<>\x00-\x1f]/.test(text))return null;
 return {text,destinationHash:await sha256(destination+'\n'+text)};
}
