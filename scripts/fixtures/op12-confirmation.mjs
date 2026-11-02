import {env,owner} from './op12-db.mjs';
import {encryptSettlement} from '../../server/author-settlement-crypto.mjs';
export async function confirmation(f,patch={}){
 const facts=(await f.call('detail',{authorId:'1'})).facts,documentId=crypto.randomUUID();
 return {authorId:'1',binding:facts.binding,requestId:crypto.randomUUID(),documentId,digest:'a'.repeat(64),policyVersion:'synthetic-proof-v1',policyHash:'b'.repeat(64),retentionDays:30,fingerprint:'c'.repeat(64),envelope:await encryptSettlement({mime:'image/png',data:'synthetic-only'},{userId:owner,authorId:'1',revision:facts.bankRevision,purpose:'bank-review:'+documentId+':'+facts.identityRevision},env),...patch};
}
