import {readFile} from 'node:fs/promises';
import {setup as foundation,admin,reader} from './op04-db.mjs';
import {encryptSettlement} from '../../server/author-settlement-crypto.mjs';
import {encryptAccount} from '../../server/author-dashboard-api.mjs';
import {settlementPolicy} from '../../server/author-settlement-policy.mjs';
import {env as readinessEnv} from './op12-db.mjs';
export {admin,reader};
export const reviewer='55555555-5555-4555-8555-555555555555',operator='66666666-6666-4666-8666-666666666666';
export const env={...readinessEnv,P0_API_ENABLED:'true',LIVE_MANUAL_COMMERCE_ENABLED:'true',LIVE_COMMERCE_GUARD_ENABLED:'true',NEW_SERIALS_ENABLED:'true',LIVE_COMMERCE_RELEASE_REVIEWED:'true',LIVE_FINANCE_PRIVACY_REVIEWED:'true',LIVE_FINANCE_PROOF_POLICY_VERSION:'synthetic-v1',LIVE_FINANCE_PROOF_POLICY_TEXT:'Synthetic financial proof processing: purpose, access, retention and deletion, overseas storage. '.repeat(4),LIVE_FINANCE_PROOF_RETENTION_DAYS:'30',LIVE_BANK_DESTINATION_ID:'synthetic-account',LIVE_BANK_DEPOSIT_INSTRUCTIONS:'합성 검증용 입금 안내입니다. 실제 계좌가 아닙니다.'};
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8');
export async function setup(options={}){
 const f=await foundation(options),{db}=f;
 try{
  await db.exec(`create table public.author_settlement_accounts(author_id bigint,account_number_encrypted text);create table public.author_earnings(id uuid,author_id bigint,work_id bigint,period_date date,author_revenue numeric,status text);
   alter table readers add column if not exists is_adult_verified boolean default false,add column if not exists adult_verified_at timestamptz,add column if not exists points integer default 0;
   alter table authors add column if not exists username text,add column if not exists bio text,add column if not exists profile_image text;
   alter table admin_users add column if not exists username text;
   alter table auth.users add column if not exists deleted_at timestamptz;
   update auth.users set email=id::text||'@example.test';
   insert into auth.users(id,email) values('${reviewer}','reviewer@example.test'),('${operator}','operator@example.test');
   insert into public.admin_users(id,auth_user_id,role,is_active) values('${reviewer}','${reviewer}','SUPER_ADMIN',true),('${operator}','${operator}','SUPER_ADMIN',true);`);
  await db.exec(await read('database/launch/004_virtual_accounts.sql'));
  await db.exec(`update launch_recovery.account_service set enabled=true;
   insert into launch_recovery.account_links(kind,profile_id,auth_user_id,evidence_ref,operator_ref,backup_sha256) select 'admin',id::text,auth_user_id,'synthetic','synthetic',repeat('a',64) from public.admin_users;
   insert into launch_recovery.account_links(kind,profile_id,auth_user_id,evidence_ref,operator_ref,backup_sha256) select 'reader',id::text,auth_user_id,'synthetic','synthetic',repeat('a',64) from public.readers;
   insert into launch_recovery.account_links(kind,profile_id,auth_user_id,evidence_ref,operator_ref,backup_sha256) values('author','1','${admin}','synthetic','synthetic',repeat('a',64));
   insert into launch_recovery.virtual_accounts(kind,profile_id,auth_user_id,login_email) values('author','1','${admin}','${admin}@example.test');
   create function public.launch_author_workspace_ready() returns boolean language sql as $$select public.launch_accounts_ready()$$;
   set webnovels.dashboard_apply_verified='true';set webnovels.settlement_apply_verified='true';set webnovels.settlement_readiness_apply_verified='true';set webnovels.live_commerce_apply_verified='true';`);
  for(const p of ['009_author_dashboard','016_author_settlement_registration','025_settlement_readiness','026_live_manual_commerce'])await db.exec(await read('database/launch/'+p+'.sql'));
  const call=async(role,action,data={},user=role==='reader'?reader:role==='author'?admin:operator)=>(await db.query('select public.op13_commerce($1,$2,$3,$4) r',[user,role,action,JSON.stringify(data)])).rows[0].r;
  const write=(role,action,data={},user)=>call(role,action,{requestId:crypto.randomUUID(),...data},user);
  const evidence=async()=>({id:crypto.randomUUID(),envelope:await encryptSettlement({synthetic:true},{userId:operator,authorId:'0',revision:'1',purpose:'synthetic'},env),digest:'a'.repeat(64),policyVersion:'synthetic-v1',policyHash:'b'.repeat(64),retentionDays:30});
  const fund=async()=>{
   const order=await write('reader','order',{destinationHash:'d'.repeat(64)}),deposit=await write('admin','deposit',{orderId:order.id,destinationHash:'d'.repeat(64),amount:10000,bankRefHash:crypto.randomUUID().replaceAll('-','').repeat(2),occurredAt:new Date().toISOString(),evidence:await evidence()});
   const confirmed=await write('admin','confirm',{depositId:deposit.id},reviewer);return {order,deposit,confirmed};
  };
  const policy=async(workId,price=100,shareBps=7000)=>write('admin','policy',{workId,price,shareBps,contractRef:'synthetic-contract-v1',expectedPolicyId:null});
  const bank=async()=>{
   const envelope=await encryptSettlement({synthetic:true},{userId:admin,authorId:'1',revision:'1',purpose:'profile'},env);
   await db.query("insert into launch_recovery.author_payout_details(author_id,bank_name,account_holder,account_envelope,last4) values(1,'합성 은행','합성 작가',$1,'1234')",[JSON.stringify(envelope)]);
   await db.query("insert into launch_recovery.author_settlement_applications(author_id,user_id,revision,status,applicant_type,document_type,profile_envelope,policy_version,policy_hash,transfer_version,transfer_hash,submitted_at,expires_at,profile_expires_at,reviewed_at) values(1,$1,1,'APPROVED','INDIVIDUAL','RESIDENT_CARD',$2,'synthetic',repeat('a',64),'synthetic',repeat('b',64),now(),now()+interval '7 days',now()+interval '90 days',now())",[admin,JSON.stringify(envelope)]);
   const facts=(await db.query('select launch_recovery.op12_facts(1) f')).rows[0].f;
   const data={authorId:'1',binding:facts.binding,requestId:crypto.randomUUID(),documentId:crypto.randomUUID(),envelope,digest:'a'.repeat(64),policyVersion:'synthetic-v1',policyHash:'b'.repeat(64),retentionDays:30,fingerprint:'c'.repeat(64)};
   return (await db.query("select public.op12_settlement_readiness($1,'confirm',$2,true) r",[reviewer,JSON.stringify(data)])).rows[0].r;
  };
  const changedBankData=async()=>{const p=await settlementPolicy(env);return {revision:'1',bankName:'합성 변경 은행',holder:'합성 작가',last4:'5678',envelope:await encryptAccount('000000005678','synthetic-bank-key',admin+':1'),policyVersion:p.version,policyHash:p.hash,transferNoticeVersion:p.transferNoticeVersion,transferNoticeHash:p.transferNoticeHash};};
  return {...f,call,write,evidence,fund,policy,bank,changedBankData};
 }catch(e){await db.close();throw e;}
}
