import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {privateBackupDirectory,sha} from './launch-content-review.mjs';
import {safeBundleFile} from './recovery-bundle.mjs';
import {buildRecoveryPacket,validateRecoveryDecisions,verifyRecoveryEvidence,recoveryEvidenceSummary} from './recovery-evidence.mjs';
import scope from './launch-backup-scope.cjs';

const fail=code=>{throw Error('SUBMITTED_RESTORE_'+code);};
const q=s=>'"'+s.replaceAll('"','""')+'"';
const lit=s=>"'"+String(s).replaceAll("'","''")+"'";
const fingerprint=rows=>sha(rows.map(sha).sort().join('\n'));
const ref=z.string().regex(/^[a-z0-9]{20}$/);
const name=z.string().regex(/^[a-z][a-z0-9-]{2,63}$/);
const sortedTables=snapshot=>[...snapshot.tables].sort((a,b)=>(a.schema+'.'+a.name).localeCompare(b.schema+'.'+b.name,'en'));
const rowHash="encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex')";
const aggregate=t=>`select count(*)::text n,encode(sha256(convert_to(coalesce(string_agg(${rowHash},E'\\n' order by ${rowHash}),''),'UTF8')),'hex') hash from ${q(t.schema)}.${q(t.name)} r`;
const templateFile=new URL('../../database/launch/005_submitted_manuscript_restore.sql',import.meta.url);

export function restoreTargetRef(source,target){
 if(!ref.safeParse(target).success||target===source)fail('SEPARATE_TARGET_REQUIRED');return target;
}
async function assertRows(db,snapshot){
 for(const t of snapshot.tables){
  const actual=(await db.query(aggregate(t))).rows[0];
  if(actual.n!==String(t.rows.length)||actual.hash!==fingerprint(t.rows))fail('SOURCE_ROWS_CHANGED');
 }
}
function guards(tables){
 return tables.map(t=>`do $$ declare n text;h text;begin ${aggregate(t)} into n,h;
 if n is distinct from ${lit(String(t.rows.length))} or h is distinct from ${lit(fingerprint(t.rows))}
 then raise exception 'SUBMITTED_RESTORE_ROWS_CHANGED';end if;end $$;`).join('\n');
}
async function expectedAfter(db,snapshot,selected){
 const tables=structuredClone(snapshot.tables);
 for(const {row} of selected)for(const [table,key,column] of [['episodes','id','content'],['secure_episode_contents','episode_id','content'],['episode_contents','episode_id','text_content']]){
  const t=tables.find(t=>t.schema==='public'&&t.name===table);if(!t)continue;
  const changed=(await db.query(`select to_jsonb(r)::text before,(to_jsonb(r)||jsonb_build_object($2::text,$3::text))::text after
   from public.${q(table)} r where ${q(key)}=$1::bigint`,[row.episodeId,column,row.submitted.content])).rows;
  for(const r of changed){const i=t.rows.indexOf(r.before);if(i<0)fail('SOURCE_ROWS_CHANGED');t.rows[i]=r.after;}
 }
 return tables;
}
export async function submittedRestoreSql(db,verified,packet,input,directory,targetRef){
 restoreTargetRef(packet.projectRef,targetRef);
 const validated=validateRecoveryDecisions(packet,input);await verifyRecoveryEvidence(directory,validated);
 if(!validated.selected.length)fail('NO_VERIFIED_SELECTIONS');
 const seed=await readFile(new URL('../../database/99_seed_dev.sql',import.meta.url),'utf8');
 const current=await buildRecoveryPacket(db,verified,seed);
 if(sha(JSON.stringify(current))!==sha(JSON.stringify(packet)))fail('CURRENT_PACKET_CHANGED');
 await assertRows(db,verified.snapshot);
 if(!verified.snapshot.tables.some(t=>t.schema==='authoring'&&t.name==='schedules'))fail('SCHEDULE_PREREQUISITE_REQUIRED');
 for(const {row,decision} of validated.selected){
  const target=JSON.parse(row.source.target);
  const active=(await db.query("select 1 from authoring.schedules where episode_id=$1 and status in ('PENDING','RUNNING')",[row.episodeId])).rows.length;
  if(!target.protected||target.head||target.episode.scheduled_at!==null||active)fail('PUBLICATION_OR_SCHEDULE_CONFLICT');
  if([target.episode.image_urls,target.protected.image_urls,...target.alternate.map(a=>a.image_urls)].some(v=>Array.isArray(v)&&v.length)&&!decision.imageEvidence)fail('IMAGE_EVIDENCE_REQUIRED');
 }
 const after=await expectedAfter(db,verified.snapshot,validated.selected),template=await readFile(templateFile,'utf8');
 const batchId='submitted-v1-'+sha(JSON.stringify({snapshot:packet.snapshotSha256,packet:sha(JSON.stringify(packet)),input,targetRef}));
 let prelude=`create temp table submitted_restore_context(batch_id text,source_ref text,target_ref text,backup_sha256 text,packet_sha256 text,decisions_sha256 text) on commit drop;
 insert into submitted_restore_context values(${[batchId,packet.projectRef,targetRef,packet.snapshotSha256,sha(JSON.stringify(packet)),sha(JSON.stringify(input))].map(lit).join(',')});
 create temp table submitted_restore_plan(request_id uuid primary key,episode_id bigint unique,review_revision bigint,context_digest text,
 before_target jsonb,submitted jsonb,imported jsonb,evidence jsonb) on commit drop;\n`;
 for(const {row,decision} of validated.selected){
  prelude+=`insert into submitted_restore_plan values(${lit(row.requestId)},${row.episodeId},${row.reviewRevision},${lit(row.contextDigest)},${lit(row.source.target)}::jsonb,
   ${lit(JSON.stringify(row.submitted))}::jsonb,${lit(JSON.stringify(row.imported))}::jsonb,${lit(JSON.stringify({decision,sourceDigest:row.sourceDigest,submittedSha256:row.submittedSha256,importedSha256:row.importedSha256}))}::jsonb);\n`;
 }
 const tables=sortedTables(verified.snapshot),schemas=scope.schemas.map(lit).join(',');
 const catalog=`do $$ begin if (select coalesce(jsonb_agg(table_schema||'.'||table_name order by table_schema||'.'||table_name collate "C"),'[]')
 from information_schema.tables where table_type='BASE TABLE' and table_schema in (${schemas}))
 is distinct from ${lit(JSON.stringify(tables.map(t=>t.schema+'.'+t.name).sort()))}::jsonb
 then raise exception 'SUBMITTED_RESTORE_TABLE_SET_CHANGED';end if;end $$;\n`;
 const sql=template.replace('__PRELUDE__',()=>prelude)
  .replace('__LOCKS__',()=>`lock table ${tables.map(t=>q(t.schema)+'.'+q(t.name)).join(',')} in access exclusive mode;`)
  .replace('__SOURCE_GUARD__',()=>catalog+guards(tables)).replace('__AFTER_GUARD__',()=>guards(after));
 return {sql,batchId,templateSha256:sha(template),validated,after,
  report:{...recoveryEvidenceSummary(packet,validated),format:'webnovels-submitted-restore-summary-v1',status:'TRANSACTION_CANDIDATE_PREPARED',
   batchSha256:sha(batchId),sqlSha256:sha(sql),sourceTables:tables.length,sourceRows:tables.reduce((n,t)=>n+t.rows.length,0),
   targetIsSeparate:true,requiresHostedTargetAcceptance:true,fullSchemaRestore:false,publicationChanged:false,flagsChanged:false}};
}
export async function executeIsolatedCandidate(db,candidate,targetRef){
 // Only the offline CLI's freshly restored PGlite calls this. No connection/env/remote API is supported.
 await db.query("select set_config('webnovels.submitted_restore_reviewed','true',false),set_config('webnovels.restore_runtime_disabled','true',false),set_config('webnovels.restore_target_ref',$1,false)",[targetRef]);
 try{await db.exec(candidate.sql);}catch(e){await db.exec('rollback');throw e;}
}
async function rejectedMutation(db,sql,code){
 await db.exec('begin');try{await db.exec(sql);fail('SAFETY_CHECK_FAILED');}
 catch(e){if(e.message!==code)throw e;}finally{await db.exec('rollback');}
}
export async function rehearseSubmittedRestore(db,verified,packet,input,directory,targetRef){
 const candidate=await submittedRestoreSql(db,verified,packet,input,directory,targetRef);
 for(const role of ['anon','authenticated','service_role'])if(!(await db.query('select 1 from pg_roles where rolname=$1',[role])).rows.length)await db.exec('create role '+role);
 await executeIsolatedCandidate(db,candidate,targetRef);
 await assertRows(db,{tables:candidate.after});
 const history=(await db.query('select before_data,after_data,submitted,imported,evidence from launch_recovery.submitted_restore_history where batch_id=$1',[candidate.batchId])).rows;
 if(history.length!==candidate.validated.selected.length)fail('HISTORY_INCOMPLETE');
 await rejectedMutation(db,candidate.sql,'SUBMITTED_RESTORE_REPLAY_FORBIDDEN');
 for(const mutation of ['update launch_recovery.submitted_restore_history set evidence=evidence','delete from launch_recovery.submitted_restore_history','truncate launch_recovery.submitted_restore_history'])
  await rejectedMutation(db,mutation,'SUBMITTED_RESTORE_HISTORY_IMMUTABLE');
 const security=(await db.query(`select relrowsecurity rls,has_schema_privilege(role,'launch_recovery','USAGE') schema_access,
  has_table_privilege(role,'launch_recovery.submitted_restore_history','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') table_access
  from pg_class cross join unnest(array['anon','authenticated','service_role']) role where oid='launch_recovery.submitted_restore_history'::regclass`)).rows;
 if(security.some(r=>!r.rls||r.schema_access||r.table_access))fail('HISTORY_ACCESS_OPEN');
 return {...candidate,report:{...candidate.report,status:'TRANSACTION_CANDIDATE_REHEARSED',isolatedBodyReplacementExecuted:true,allOriginalRowsAccountedFor:true,
  privateImmutableHistory:true,replayRejected:true,updateDeleteTruncateRejected:true,hostedRestoreAccepted:false,freeCutoverAccepted:false}};
}
export async function writeSubmittedCandidate(directory,outputName,candidate){
 if(!name.safeParse(outputName).success)fail('INVALID_NAME');await privateBackupDirectory(directory);
 const target=path.join(directory,outputName);await mkdir(target);await privateBackupDirectory(target);
 const manifest={format:'webnovels-submitted-restore-candidate-v1',sqlSha256:sha(candidate.sql),reportSha256:sha(JSON.stringify(candidate.report,null,2)+'\n'),templateSha256:candidate.templateSha256};
 for(const [file,value] of [['005_submitted_manuscript_restore.sql',candidate.sql],['verification.json',JSON.stringify(candidate.report,null,2)+'\n'],['manifest.json',JSON.stringify(manifest,null,2)+'\n']])
  await writeFile(path.join(target,file),value,{flag:'wx',mode:0o600});
}
export async function checkSubmittedCandidate(directory,outputName,candidate){
 if(!name.safeParse(outputName).success)fail('INVALID_NAME');await privateBackupDirectory(path.join(directory,outputName));
 const expected=[['005_submitted_manuscript_restore.sql',candidate.sql],['verification.json',JSON.stringify(candidate.report,null,2)+'\n'],
  ['manifest.json',JSON.stringify({format:'webnovels-submitted-restore-candidate-v1',sqlSha256:sha(candidate.sql),reportSha256:sha(JSON.stringify(candidate.report,null,2)+'\n'),templateSha256:candidate.templateSha256},null,2)+'\n']];
 for(const [file,bytes] of expected){const p=await safeBundleFile(directory,outputName+'/'+file);if((await lstat(p)).size>64*1024*1024||sha(await readFile(p))!==sha(bytes))fail('CANDIDATE_BYTES_CHANGED');}
 return candidate.report;
}
