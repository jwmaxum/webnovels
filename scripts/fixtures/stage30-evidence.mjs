import {setup as base,admin,draft} from './stage29-db.mjs';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';import path from 'node:path';
import {sha} from '../lib/launch-content-review.mjs';
import {buildRecoveryPacket,recoveryDecisionTemplate} from '../lib/recovery-evidence.mjs';
export {admin,draft};
export const originalBytes=Buffer.from('제출 당시 비공개 원고 😀'),privateSentinel='PRIVATE_AUTH_CREDENTIAL_NEVER_EXPORTED';
const q=s=>'"'+s.replaceAll('"','""')+'"';
export async function snapshotOf(db){
 const schemaList="'public','authoring','auth','storage'",tables=(await db.query(`select table_schema schema,table_name name from information_schema.tables where table_schema in (${schemaList}) and table_type='BASE TABLE' order by 1,2`)).rows;
 for(const t of tables){const rows=(await db.query(`select to_jsonb(r)::text row from ${q(t.schema)}.${q(t.name)} r order by to_jsonb(r)::text`)).rows.map(r=>r.row);t.rows=rows;t.row_count=String(rows.length);}
 const columns=(await db.query(`select n.nspname schema,c.relname "table",a.attname name,format_type(a.atttypid,a.atttypmod) type,a.attnum ordinal,a.attnotnull not_null
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in (${schemaList}) and c.relkind='r' and a.attnum>0 and not a.attisdropped`)).rows;
 const enums=(await db.query(`select n.nspname schema,t.typname name,array_agg(e.enumlabel order by e.enumsortorder) labels from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname in (${schemaList}) group by 1,2`)).rows;
 const constraints=(await db.query(`select n.nspname schema,c.relname "table",co.conname name,co.contype type,pg_get_constraintdef(co.oid) definition from pg_constraint co join pg_class c on c.oid=co.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in (${schemaList})`)).rows;
 const indexes=(await db.query(`select * from pg_indexes where schemaname in (${schemaList})`)).rows;
 const snapshot={format:'webnovels-logical-data-v1',captured_at:new Date().toISOString(),tables,columns,enums,constraints,indexes};
 return {snapshot,manifest:{projectRef:'abcdefghijklmnopqrst'},hash:sha(JSON.stringify(snapshot))};
}
export async function ready(s,decision='READY_FOR_RESTORE_REVIEW'){
 const d=await s.review('recovery-detail',{recoveryId:s.request.id});
 const access=await s.review('recovery-source',{recoveryId:s.request.id,requestId:crypto.randomUUID(),reason:'합성 제출 원고 검토',contextDigest:d.contextDigest,kind:'manuscript'});
 const r=await s.review('recovery-decide',{recoveryId:s.request.id,requestId:crypto.randomUUID(),reason:'합성 검증용 자료 확인',contextDigest:d.contextDigest,revision:d.reviewRevision,decision,evidence:'합성 근거 확인 참조',accessId:access.accessId,rightsChecked:true,ratingChecked:true,aiChecked:true});
 if(r.error)throw Error(r.error);return r;
}
export async function setup({review=true}={}){
 const s=await base({timezone:'UTC',originalBytes});try{
  await s.db.exec("alter table auth.users add encrypted_password text;update auth.users set encrypted_password='"+privateSentinel+"',email='"+privateSentinel+"'");
  if(review)await ready(s);
  const verified=await snapshotOf(s.db),seed=await readFile(new URL('../../database/99_seed_dev.sql',import.meta.url),'utf8'),packet=await buildRecoveryPacket(s.db,verified,seed);
  await mkdir('scratch/launch/backups',{recursive:true});const directory=await mkdtemp(path.resolve('scratch/launch/backups/stage30-test-'));
  await mkdir(path.join(directory,'originals/input'),{recursive:true});await mkdir(path.join(directory,'proofs/input'),{recursive:true});
  await writeFile(path.join(directory,'originals/input/manuscript.bin'),originalBytes,{mode:0o600});
  const proof=Buffer.from('합성 증거 파일'),descriptor={file:'proofs/input/review.txt',bytes:proof.length,sha256:sha(proof)};await writeFile(path.join(directory,descriptor.file),proof,{mode:0o600});
  const decisions=recoveryDecisionTemplate(packet);
  if(review)Object.assign(decisions.decisions[0],{decision:'PREPARE_RESTORE',reviewerRef:'synthetic-reviewer',evidenceRef:'합성 검증용 권리/등급/AI 자료 참조',submittedSha256:packet.entries[0].submittedSha256,
   originalFile:{file:'originals/input/manuscript.bin',bytes:originalBytes.length,sha256:sha(originalBytes)},rightsEvidence:descriptor,ratingEvidence:descriptor,aiEvidence:descriptor});
  const bytes=JSON.stringify(verified.snapshot);await writeFile(path.join(directory,'snapshot.json'),bytes,{mode:0o600});
  await writeFile(path.join(directory,'manifest.json'),JSON.stringify({...verified.manifest,snapshotSha256:verified.hash}),{mode:0o600});
  await writeFile(path.join(directory,'data-restore-verification.json'),JSON.stringify({snapshotSha256:verified.hash,allRowsMatch:true,tablesVerified:verified.snapshot.tables.length,rowsVerified:verified.snapshot.tables.reduce((n,t)=>n+t.rows.length,0)}),{mode:0o600});
  return {...s,verified,seed,packet,decisions,directory,descriptor,proofBytes:proof};
 }catch(e){await s.db.close();throw e;}
}
