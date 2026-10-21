// Rehearse the actual backed-up schema/data locally, then optionally apply only disabled enrollment.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {restoreSnapshot} from './verify_launch_backup.mjs';
import {privateBackupDirectory,readVerifiedSnapshot} from './lib/launch-content-review.mjs';
import {packageSql,sourceGuards} from './prepare_stage33.mjs';
import access from './lib/launch-access.cjs';
import backup from './backup_launch_data.cjs';
const files=['database/authoring/023_author_enrollment.sql','database/launch/014_author_enrollment_accounts.sql'];
const q=s=>'"'+s.replaceAll('"','""')+'"';
const lit=s=>"'"+s.replaceAll("'","''")+"'";
const hash=s=>createHash('sha256').update(s).digest('hex');
async function preserve(db,snapshot){
 for(const t of snapshot.tables){
  const cols=snapshot.columns.filter(c=>c.schema===t.schema&&c.table===t.name).sort((a,b)=>a.ordinal-b.ordinal).map(c=>q(c.name));
  let rows=(await db.query(`select to_jsonb(original)::text row from (select ${cols.join(',')} from ${q(t.schema)}.${q(t.name)}) original`)).rows.map(r=>r.row);
  if(t.schema==='authoring'&&t.name==='migrations')rows=rows.filter(r=>JSON.parse(r).version!=='authoring-023');
  assert.equal(hash(rows.sort().join('\n')),hash([...t.rows].sort().join('\n')),'STAGE34_ORIGINAL_ROWS_CHANGED');
 }
}
async function reconstruct(db,snapshot){
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;set check_function_bodies=false');
 for(const s of snapshot.sequences.filter(s=>['public','authoring','launch_recovery'].includes(s.schemaname))){
  await db.exec(`create sequence ${q(s.schemaname)}.${q(s.sequencename)}`);
  await db.query('select setval($1,$2,true)',[s.schemaname+'.'+s.sequencename,Math.max(Number(s.last_value||1),1)]);
 }
 for(const c of snapshot.columns.filter(c=>(['public','authoring','launch_recovery'].includes(c.schema)||c.schema==='auth'&&c.table==='users')&&c.default&&!c.generated))
  await db.exec(`alter table ${q(c.schema)}.${q(c.table)} alter column ${q(c.name)} set default ${c.default}`);
 for(const c of snapshot.columns.filter(c=>['public','authoring'].includes(c.schema)&&c.identity)){
  const sequence=snapshot.sequences.find(s=>s.schemaname===c.schema&&s.sequencename===c.table+'_'+c.name+'_seq');
  if(!sequence)throw Error('STAGE34_SEQUENCE_REVIEW_REQUIRED');
  await db.exec(`alter table ${q(c.schema)}.${q(c.table)} alter column ${q(c.name)} set default nextval(${lit(c.schema+'.'+sequence.sequencename)}::regclass)`);
 }
 // App-owned routines/triggers only; no Supabase Auth/platform trigger emulation.
 for(const f of snapshot.functions.filter(f=>['public','authoring','launch_recovery'].includes(f.schema))){
  await db.exec(f.definition);
  await db.exec(`revoke all on function ${f.signature} from public,anon,authenticated,service_role`);
  for(const role of ['anon','authenticated','service_role'])if(f.acl?.some(a=>a.startsWith(role+'=')&&a.split('/')[0].includes('X')))
   await db.exec(`grant execute on function ${f.signature} to ${role}`);
 }
 for(const t of snapshot.triggers.filter(t=>['public','authoring','launch_recovery'].includes(t.schema)))await db.exec(t.definition);
 await db.exec('set check_function_bodies=true');
}
export async function rehearseStage34(snapshot,sha){
 const {db,verified}=await restoreSnapshot(snapshot);
 try{
  await reconstruct(db,snapshot);await preserve(db,snapshot);
  const sql=packageSql(files,sha);
  await db.exec(sql.replace('begin;',()=>`begin;\n${sourceGuards(snapshot)}`));await db.exec(sql);
  await preserve(db,snapshot);
  assert.equal((await db.query('select author_enrollment_config() r')).rows[0].r.enabled,false);
  assert.equal((await db.query('select launch_accounts_ready() r')).rows[0].r,true);
  assert.equal((await db.query('select launch_work_registration_ready() r')).rows[0].r,true);
  assert.equal((await db.query('select launch_author_workspace_ready() r')).rows[0].r,true);
  await db.exec('begin');
  try{
   // Synthetic Auth/proofs exist ONLY in this rolled-back local transaction.
   const a=randomUUID(),b=randomUUID();
   await db.query('insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,$2,now(),false),($3,$4,now(),false)',
    [a,'stage34-a@example.test',b,'stage34-b@example.test']);
   await db.exec("update authoring.enrollment_settings set enabled=true,mode='LIVE',store_id='fixture',channel_key='fixture',pg_provider='DANAL',identifier_type='CI',key_version='v1',provider_review_ref='synthetic local only',legal_review_ref='synthetic local only'");
   const docs=(await db.query('select * from authoring.enrollment_documents')).rows;
   const d=docs.find(d=>d.id==='copyright-own'),p=docs.find(d=>d.id==='identity-privacy');
   for(const [user,name] of [[a,'인수필명가'],[b,'인수필명나']]){
    const call=async(action,data={})=>(await db.query('select author_enrollment($1,$2,$3) r',[user,action,data])).rows[0].r;
    const start=await call('start',{requestKey:randomUUID(),rightsBasis:'OWN',rightsAccepted:true,privacyAccepted:true,
     documentVersion:d.version,documentHash:d.hash,privacyVersion:p.version,privacyHash:p.hash});
    assert.ok(start.attempt,'STAGE34_START_FAILED');
    const attemptId=start.attempt.id;
    assert.equal((await call('verify',{attemptId,fingerprint:'a'.repeat(64),verifiedAt:new Date(Date.now()+10).toISOString()})).attempt.status,'VERIFIED');
    assert.equal((await call('complete',{attemptId,displayName:name})).completed,true);
    const actor=(await db.query('select launch_account_actor($1) r',[user])).rows[0].r;
    assert.equal(actor.author.pen_name,name);
   }
   assert.equal((await db.query('select count(*)::int n from authoring.verified_author_persons')).rows[0].n,1);
   const work=(await db.query('select creator_works($1,$2,$3,$4,$5) r',[a,'create',null,{title:'인수 웹툰',contentType:'WEBTOON'},randomUUID()])).rows[0].r.work;
   assert.equal(work.content_type,'WEBTOON');
   assert.equal((await db.query('select creator_works($1,$2,$3) r',[b,'get',work.id])).rows[0].r.status,404);
  }finally{await db.exec('rollback');}
  await preserve(db,snapshot);
  await db.exec('begin');await db.exec("update public.authors set pen_name=pen_name||' changed' where id=(select min(id) from public.authors)");
  await assert.rejects(db.exec(sourceGuards(snapshot)),/SOURCE_CHANGED/);await db.exec('rollback');
  return {engine:'PGlite with actual backup rows, defaults, sequences and app routines/triggers',
   originalTables:verified.length,originalRows:verified.reduce((n,t)=>n+t.rows,0),originalRowsMatch:true,
   repeatableMigration:true,accountWorkspaceRegistrationPreserved:true,multiAccountSignup:true,webtoonRegistration:true,
   crossAccountAccessDenied:true,sourceChangeRejected:true,providerCalled:false,hostedAcceptance:false,multiConnectionAcceptance:false};
 }finally{await db.close();}
}
async function main(){
 const directory=await privateBackupDirectory(process.argv[2]);
 if(process.argv.slice(3).some(x=>x!=='--apply'))throw Error('STAGE34_ARGUMENT_INVALID');
 const {snapshot,manifest,hash:sha}=await readVerifiedSnapshot(directory);
 const rehearsal=await rehearseStage34(snapshot,sha),sql=packageSql(files,sha);
 const report={checkedAt:new Date().toISOString(),snapshotSha256:sha,migrationSha256:hash(sql),files,rehearsal,
  productionApplied:false,flagsChanged:false,passContractReady:false,providerAcceptance:false,browserAcceptance:false};
 if(process.argv.includes('--apply')){
  if(Date.now()-Date.parse(snapshot.captured_at)>24*3600000)throw Error('STAGE34_FRESH_BACKUP_REQUIRED');
  const env=access.loadEnv(),{ref}=access.connection(env);if(ref!==manifest.projectRef)throw Error('STAGE34_SOURCE_MISMATCH');
  const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),
   headers:{Authorization:'Bearer '+access.managementToken(env),'Content-Type':'application/json'},
   body:JSON.stringify({query:sql.replace('begin;',()=>`begin;\n${sourceGuards(snapshot)}`),read_only:false})});
  if(!response.ok){fs.writeFileSync('scratch/launch/stage34-apply-error-private.json',await response.text());throw Error('STAGE34_APPLY_FAILED');}
  report.productionApplied=true;
  // Persist the known write outcome before a separate read-only verification can fail.
  fs.writeFileSync('artifacts/stage34-acceptance.json',JSON.stringify(report,null,2)+'\n');
  report.productionState=await backup.query(`select (select enabled from authoring.enrollment_settings) enrollment_enabled,
   (select count(*)::int from authoring.author_identity_attempts) identity_attempts,
   (select count(*)::int from authoring.author_identity_accounts) verified_accounts,
   (select enabled from authoring.new_serial_service) public_enabled`);
 }
 fs.writeFileSync('artifacts/stage34-acceptance.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
 main().catch(e=>{fs.writeFileSync('scratch/launch/stage34-error-private.json',JSON.stringify({message:e.message,code:e.code,stack:e.stack},null,2));
 console.error(/^STAGE34_[A-Z_]+$/.test(e.message)?e.message:'STAGE34_REHEARSAL_FAILED_DETAILS_WITHHELD');process.exitCode=1;});
