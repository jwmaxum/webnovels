import {z} from 'zod';
import {createHash} from 'node:crypto';
import {readFile,lstat} from 'node:fs/promises';
import {safeBundleFile} from './recovery-bundle.mjs';
import {sha,validateContentDecisions,contentSelectionSql} from './launch-content-review.mjs';
import {validateLegacyImport,legacyImportSql} from './legacy-publication-import.mjs';
import backupScope from './launch-backup-scope.cjs';
import {evaluateBetaEvidence} from './beta-evidence.mjs';
const fail=code=>{throw Error('CUTOVER_'+code)};
const digest=z.string().regex(/^[a-f0-9]{64}$/),candidate=z.string().regex(/^[a-f0-9]{40}$/),ref=z.string().regex(/^[a-z0-9]{20}$/);
const origin=z.string().url().refine(s=>{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.pathname==='/'&&!u.search&&!u.hash&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname)});
const relative=z.string().min(1).max(1024).refine(s=>!/[\\\x00-\x1f\x7f:]/.test(s)&&!s.startsWith('/')&&!s.split('/').some(p=>!p||p==='.'||p==='..'));
const file=z.object({file:relative,bytes:z.number().int().positive().max(128*1024*1024),sha256:digest}).strict();
const scope=z.enum(['NOVEL_FREE','NOVEL_WEBTOON_FREE']);
export const CUTOVER_STAGES=Object.freeze(['RESTORE','CONTENT','MIGRATIONS','IMPORT','LOCKDOWN','BETA']);
const migrations=['001_authoring_foundation','002_private_storage','003_verified_identity_link','004_auth_onboarding',
 '005_creator_works','006_creator_drafts','007_creator_files','008_creator_publications','009_creator_reader_operations',
 '010_admin_operations','011_reader_profile_cutover','012_creator_distribution','013_reader_discovery','014_admin_workflow',
 '015_webtoon','017_growth_experiments','018_growth_measurement'];
const dependencies={'001':['p0-expand'],'002':['authoring-001'],'003':['authoring-001'],'004':['authoring-003'],
 '005':['authoring-004'],'006':['authoring-005'],'007':['authoring-006','authoring-002'],'008':['authoring-007'],
 '009':['authoring-008'],'010':['authoring-009'],'011':['authoring-010'],'012':['authoring-005'],'013':['authoring-009','authoring-012'],
 '014':['authoring-010','authoring-013'],'015':['authoring-014'],'017':['authoring-015'],'018':['authoring-017']};
export const CUTOVER_SQL=Object.freeze([
 {id:'content-selection',path:'database/launch/004_reviewed_content_selection.sql',stage:'CONTENT',requires:[]},
 {id:'p0-expand',path:'database/p0/001_expand_identity_content.sql',stage:'MIGRATIONS',requires:[]},
 ...migrations.map(name=>({id:'authoring-'+name.slice(0,3),path:'database/authoring/'+name+'.sql',stage:'MIGRATIONS',requires:dependencies[name.slice(0,3)]})),
 {id:'legacy-import',path:'database/launch/005_import_verified_legacy_novels.sql',stage:'IMPORT',requires:['authoring-008','p0-expand']},
 {id:'p0-lockdown',path:'database/p0/002_lockdown_after_cutover.sql',stage:'LOCKDOWN',requires:['authoring-011']}
]);
const id=z.enum(CUTOVER_SQL.map(s=>s.id));
const manifestSchema=z.object({format:z.literal('webnovels-cutover-package-v1'),candidate,origin,scope,
 sourceRef:ref,targetRef:ref.nullable(),preparedAt:z.string().datetime(),initialSnapshotSha256:digest,nativeArchiveSha256:digest,
 independentSnapshotTimes:z.literal(true),combinedConsistentSnapshotConfirmed:z.literal(false),
 sourceFiles:z.array(file).min(2).max(10),initialVersions:z.array(z.string().regex(/^authoring-\d{3}$/)).max(100),p0Expanded:z.boolean(),
 sql:z.array(z.object({id,file:z.string(),bytes:file.shape.bytes,sha256:digest}).strict()).length(CUTOVER_SQL.length)}).strict();
const count=z.number().int().nonnegative().max(1000000000);
const recordSchema=z.object({format:z.literal('webnovels-cutover-step-v1'),stage:z.enum(CUTOVER_STAGES),candidate,origin,scope,
 sourceRef:ref,targetRef:ref,status:z.enum(['PASS','PENDING','HOLD','FAIL']),kind:z.enum(['HOSTED_RESTORE','HOSTED_SQL','HOSTED_API','LOCAL_UNIT','SYNTHETIC_RESTORE']),
 observedAt:z.string().datetime(),previousRecordSha256:digest,beforeSnapshotSha256:digest,afterSnapshotSha256:digest,
 proof:file,resultSnapshot:file.nullable()}).strict();
const context={candidate,origin,scope,sourceRef:ref,targetRef:ref,beforeSnapshotSha256:digest,afterSnapshotSha256:digest};
const sqlProof=z.object({id,sha256:digest}).strict();
const proofSchema=z.discriminatedUnion('stage',[
 z.object({format:z.literal('webnovels-cutover-proof-v1'),...context,stage:z.literal('RESTORE'),kind:z.literal('HOSTED_RESTORE'),
  nativeArchiveSha256:digest,dataFingerprintsMatched:z.literal(true),schemaSecurityMatched:z.literal(true),authStorageAccepted:z.literal(true),
  externalEffectsIsolated:z.literal(true),independentSnapshotReconciled:z.literal(true)}).strict(),
 z.object({format:z.literal('webnovels-cutover-proof-v1'),...context,stage:z.literal('CONTENT'),kind:z.literal('HOSTED_SQL'),
  bodyConflicts:count,unresolvedDecisions:count,originalRightsReviewed:z.literal(true),nonSelectedRowsPreserved:z.literal(true),
  privateHistoryImmutable:z.literal(true),reviewSnapshotSha256:digest,sql:sqlProof,executedSql:file.nullable(),packet:file,decisions:file}).strict(),
 z.object({format:z.literal('webnovels-cutover-proof-v1'),...context,stage:z.literal('MIGRATIONS'),kind:z.literal('HOSTED_SQL'),
  versions:z.array(z.string().regex(/^authoring-\d{3}$/)).max(100),appliedSql:z.array(sqlProof).max(30),bodyConflicts:count,
  sourceRowsPreserved:z.literal(true),schemaAccepted:z.literal(true),privateBucketsAccepted:z.literal(true)}).strict(),
 z.object({format:z.literal('webnovels-cutover-proof-v1'),...context,stage:z.literal('IMPORT'),kind:z.literal('HOSTED_SQL'),
  packetSnapshotSha256:digest,eligibleLegacyNovels:count,importedHeads:count,pendingImports:count,
  sourceRowsPreserved:z.literal(true),existingHeadsPreserved:z.literal(true),privateHistoryImmutable:z.literal(true),
  growthBaselineOnly:z.literal(true),webtoonAssetAcceptance:z.boolean(),sql:sqlProof,executedSql:file.nullable(),packet:file,decisions:file,
  versionIds:z.array(z.string().uuid()).max(100000)}).strict(),
 z.object({format:z.literal('webnovels-cutover-proof-v1'),...context,stage:z.literal('LOCKDOWN'),kind:z.literal('HOSTED_SQL'),
  phase:z.literal('locked'),legacyDirectAccessDenied:z.literal(true),crossRoleAccepted:z.literal(true),freeRpcAccepted:z.literal(true),sql:sqlProof}).strict()
]);
export function validateCutoverManifest(input){
 const parsed=manifestSchema.safeParse(input);if(!parsed.success)fail('INVALID_MANIFEST');const m=parsed.data;
 if(m.targetRef===m.sourceRef)fail('PRODUCTION_TARGET_FORBIDDEN');
 if(new Set(m.initialVersions).size!==m.initialVersions.length)fail('DUPLICATE_VERSION');
 const known=new Set(CUTOVER_SQL.filter(s=>s.id.startsWith('authoring-')).map(s=>s.id));
 if(m.initialVersions.some(v=>!known.has(v)))fail('UNKNOWN_BASELINE_VERSION');
 for(let n=0;n<CUTOVER_SQL.length;n++)if(m.sql[n].id!==CUTOVER_SQL[n].id||m.sql[n].file!==`sql/${m.sql[n].id}.sql`)fail('SQL_ALLOWLIST_MISMATCH');
 const names=[...m.sourceFiles.map(s=>s.file),...m.sql.map(s=>s.file)];
 if(new Set(names).size!==names.length)fail('DUPLICATE_FILE');
 if(!m.sourceFiles.some(f=>f.file==='source/logical-snapshot.json'&&f.sha256===m.initialSnapshotSha256)||
   !m.sourceFiles.some(f=>f.file==='source/native-archive.dump'&&f.sha256===m.nativeArchiveSha256))fail('SOURCE_BINDING_REQUIRED');
 return m;
}
export function cutoverMigrationPlan(m){
 const applied=new Set(m.initialVersions);if(m.p0Expanded)applied.add('p0-expand');
 return CUTOVER_SQL.filter(s=>s.stage==='MIGRATIONS').map(s=>({id:s.id,path:s.path,sha256:m.sql.find(f=>f.id===s.id).sha256,
   requires:s.requires,action:applied.has(s.id)?'VERIFY_EXISTING':'REVIEW_AND_APPLY',executionAllowed:false}));
}
export async function readCutoverFile(directory,descriptor){
 const location=await safeBundleFile(directory,descriptor.file),stat=await lstat(location);
 if(stat.size!==descriptor.bytes||stat.size>128*1024*1024)fail('FILE_SIZE_MISMATCH');
 const bytes=await readFile(location);if(sha(bytes)!==descriptor.sha256)fail('FILE_HASH_MISMATCH');return bytes;
}
export async function verifyCutoverFiles(directory,input,{expectedSql}={}){
 const m=validateCutoverManifest(input);
 for(const f of [...m.sourceFiles,...m.sql])await readCutoverFile(directory,f);
 if(expectedSql)for(const f of m.sql)if(expectedSql[f.id]!==f.sha256)fail('CANDIDATE_SQL_MISMATCH');
 const s=inspectCutoverSnapshot(await readCutoverFile(directory,m.sourceFiles.find(f=>f.file==='source/logical-snapshot.json')));
 const versions=rows(s,'authoring.migrations').map(r=>r.version);
 const expanded=rows(s,'public.p0_migration_status').some(r=>r.version==='p0-20260921'&&['expanded','locked'].includes(r.phase));
 if(JSON.stringify([...versions].sort())!==JSON.stringify([...m.initialVersions].sort())||expanded!==m.p0Expanded)fail('BASELINE_MARKER_MISMATCH');
 return m;
}
class ExactNumber {constructor(raw){this.raw=raw}toString(){return this.raw}}
const parseRow=text=>JSON.parse(text,(_key,value,ctx)=>typeof value==='number'?new ExactNumber(ctx.source):value);
// Preserve numeric lexemes (including arbitrary NUMERIC decimals) and JSON types.
const stable=value=>value instanceof ExactNumber?'number:'+value.raw:
 Array.isArray(value)?'array:['+value.map(stable).join(',')+']':
 value&&typeof value==='object'?'object:{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}':
 typeof value+':'+JSON.stringify(value);
export function inspectCutoverSnapshot(bytes){
 let s;try{s=JSON.parse(bytes)}catch{fail('INVALID_SNAPSHOT')}
 const keys=['enums','views','format','tables','columns','indexes','policies','triggers','functions','sequences','column_acl',
  'captured_at','constraints','database_version','relation_security','requested_schemas'];
 if(!s||Array.isArray(s)||Object.keys(s).sort().join()!==keys.sort().join()||s.format!=='webnovels-logical-data-v1'||
   !Number.isFinite(Date.parse(s.captured_at))||typeof s.database_version!=='string'||
   !Array.isArray(s.requested_schemas)||
   JSON.stringify([...s.requested_schemas||[]].sort())!==JSON.stringify([...backupScope.schemas].sort()))fail('INVALID_SNAPSHOT');
 for(const key of keys.filter(k=>!['format','captured_at','database_version'].includes(k)))if(!Array.isArray(s[key])||s[key].length>1000000)fail('INVALID_SNAPSHOT');
 const names=new Set();
 for(const t of s.tables){
  if(!t||!backupScope.schemas.includes(t.schema)||!/^[a-z_][a-z0-9_]*$/.test(t.name)||names.has(t.schema+'.'+t.name)||
    !Array.isArray(t.rows)||!/^\d+$/.test(t.row_count)||BigInt(t.row_count)!==BigInt(t.rows.length)||
    createHash('md5').update(t.rows.join('')).digest('hex')!==t.fingerprint)fail('INVALID_SNAPSHOT_TABLE');
  names.add(t.schema+'.'+t.name);
  const cols=s.columns.filter(c=>c.schema===t.schema&&c.table===t.name).map(c=>c.name);
  if(!cols.length||new Set(cols).size!==cols.length||cols.some(c=>typeof c!=='string'))fail('INVALID_SNAPSHOT_COLUMNS');
  for(const text of t.rows){const row=parseRow(text);if(!row||Array.isArray(row)||typeof row!=='object'||
    Object.keys(row).sort().join()!==[...cols].sort().join())fail('INVALID_SNAPSHOT_ROW')}
 }
 for(const name of ['public.episodes','public.episode_contents','public.works','public.authors','auth.users',
  'authoring.migrations','authoring.identity_evidence','storage.buckets','storage.objects'])if(!names.has(name))fail('INCOMPLETE_SNAPSHOT');
 return s;
}
const table=(s,name)=>s.tables.find(t=>t.schema+'.'+t.name===name);
const rows=(s,name)=>(table(s,name)?.rows||[]).map(parseRow);
function stageDataMatches(before,after,stage,proof,validated){
 const changed=stage==='CONTENT'?new Set(validated.selected.map(x=>x.row.episodeId)):new Set();
 for(const t of before.tables){
  const name=t.schema+'.'+t.name,next=table(after,name);if(!next)return false;
  if(stage==='RESTORE'&&t.fingerprint!==next.fingerprint)return false;
  const omit=stage==='CONTENT'&&name==='public.episodes'?['content']:
   stage==='CONTENT'&&name==='public.episode_contents'?['text_content','content_version','updated_at']:
   stage==='LOCKDOWN'&&name==='public.p0_migration_status'?['phase','applied_at']:[];
  const nextRows=next.rows.map(parseRow);
  for(const old of t.rows.map(parseRow)){
   const ignore=(stage==='CONTENT'&&changed.has(String(old.id??old.episode_id)))||
    (stage==='LOCKDOWN'&&old.version==='p0-20260921');
   const keys=Object.keys(old).filter(k=>!(ignore&&omit.includes(k)));
   if(!nextRows.some(r=>stable(Object.fromEntries(keys.map(k=>[k,r[k]])))===stable(Object.fromEntries(keys.map(k=>[k,old[k]])))))return false;
  }
  const append=stage==='MIGRATIONS'||(stage==='CONTENT'&&name==='launch_recovery.content_selection_history')||
   (stage==='IMPORT'&&['authoring.publication_heads','authoring.publication_versions','growth.publication_activity','launch_recovery.legacy_publication_imports'].includes(name));
  if(!append&&next.rows.length!==t.rows.length)return false;
 }
 const versions=rows(after,'authoring.migrations').map(r=>r.version),p0=rows(after,'public.p0_migration_status');
 if(stage==='CONTENT'||stage==='MIGRATIONS'){
  const alternate=new Map(rows(after,'public.episode_contents').map(r=>[String(r.episode_id),r.text_content]));
  if(rows(after,'public.episodes').some(e=>alternate.has(String(e.id))&&stable(e.content)!==stable(alternate.get(String(e.id)))))return false;
 }
 if(stage==='CONTENT')for(const {row,decision} of validated.selected){
  const original=rows(before,'public.episodes').find(e=>String(e.id)===row.episodeId),alt=rows(before,'public.episode_contents').find(e=>String(e.episode_id)===row.episodeId);
  const ep=rows(after,'public.episodes').find(e=>String(e.id)===row.episodeId),content=rows(after,'public.episode_contents').find(e=>String(e.episode_id)===row.episodeId);
  if(stable(original)!==stable(parseRow(row.source.episode))||stable(alt)!==stable(parseRow(row.source.content)))return false;
  const body=decision.decision==='USE_EPISODES'?original.content:alt.text_content;
  if(ep?.content!==body||content?.text_content!==body||
    (decision.decision==='USE_EPISODES'&&BigInt(String(content.content_version))!==BigInt(String(alt.content_version??0))+1n))return false;
 }
 if(stage==='MIGRATIONS'){
  if(!proof.versions.every(v=>versions.includes(v))||!p0.some(r=>r.version==='p0-20260921'&&['expanded','locked'].includes(r.phase)))return false;
  const buckets=rows(after,'storage.buckets');
  if(['authoring-originals','authoring-covers'].some(id=>!buckets.some(b=>b.id===id&&b.public===false)))return false;
  const secure=rows(after,'public.secure_episode_contents');
  if(rows(after,'public.episodes').some(e=>!secure.some(c=>String(c.episode_id)===String(e.id)&&c.content===e.content&&stable(c.image_urls)===stable(e.image_urls))))return false;
 }
 if(stage==='IMPORT'){
  for(const name of ['authoring.publication_heads','authoring.publication_versions','growth.publication_activity','launch_recovery.legacy_publication_imports']){
   if(!table(after,name)||(table(after,name).rows.length-(table(before,name)?.rows.length||0))!==proof.importedHeads)return false;
  }
  for(const [i,{row,decision}] of validated.selected.entries()){
   const head=rows(after,'authoring.publication_heads').find(h=>String(h.episode_id)===row.episodeId&&h.version_id===proof.versionIds[i]);
   const version=rows(after,'authoring.publication_versions').find(v=>v.id===proof.versionIds[i]&&String(v.episode_id)===row.episodeId);
   const episode=rows(before,'public.episodes').find(e=>String(e.id)===row.episodeId);
   const archive=rows(after,'launch_recovery.legacy_publication_imports').find(a=>a.version_id===proof.versionIds[i]&&String(a.episode_id)===row.episodeId);
   const activity=rows(after,'growth.publication_activity').find(a=>a.version_id===proof.versionIds[i]&&a.kind==='BASELINE');
   if(!head||!version||!archive||!activity||version.content!==episode?.content||String(version.work_id)!==String(episode.work_id)||
     version.title!==episode.title||version.author_comment!==(episode.author_comment??'')||!Array.isArray(version.image_urls)||version.image_urls.length||
     String(activity.episode_id)!==row.episodeId||String(activity.work_id)!==String(episode.work_id)||
     version.source_draft_id!==null||version.source_revision!==null||
     Date.parse(head.published_at)!==Date.parse(decision.originalPublishedAt)||Date.parse(activity.created_at)!==Date.parse(decision.originalPublishedAt))return false;
  }
 }
 if(stage==='LOCKDOWN'&&!p0.some(r=>r.version==='p0-20260921'&&r.phase==='locked'&&
   Number.isFinite(Date.parse(r.applied_at))&&Date.parse(r.applied_at)>=Date.parse(before.captured_at)&&
   Date.parse(r.applied_at)<=Date.parse(after.captured_at)))return false;
 return true;
}
export async function evaluateCutoverJournal(input,records,{manifestSha256,readProof,verifyBetaProof,now=Date.now()}={}){
 const m=validateCutoverManifest(input),report={format:'webnovels-cutover-readiness-v1',candidate:m.candidate,origin:m.origin,scope:m.scope,
  sourceRef:m.sourceRef,targetRef:m.targetRef,status:'BLOCKED',completedSteps:0,nextStep:'RESTORE',steps:[],blockers:[],
  activationAllowed:false,sqlExecuted:false,flagsChanged:false,hostedRestoreAccepted:false};
 const block=code=>{report.blockers.push(code);return report};
 if(!digest.safeParse(manifestSha256).success||!Array.isArray(records)||records.length>CUTOVER_STAGES.length)return block('INVALID_JOURNAL');
 if(!m.targetRef)return block('ISOLATED_TARGET_NOT_CONFIGURED');
 let predecessor=manifestSha256,snapshot=m.initialSnapshotSha256,previousAt=Date.parse(m.preparedAt);
 if(!Number.isFinite(now)||previousAt>now)return block('PACKAGE_TIME_INVALID');
 let previousSnapshot;
 try{const d=m.sourceFiles.find(f=>f.file==='source/logical-snapshot.json'),b=Buffer.from(await readProof(d));
  if(b.length!==d.bytes||sha(b)!==d.sha256)throw Error();previousSnapshot=inspectCutoverSnapshot(b)}catch{return block('INITIAL_SNAPSHOT_UNVERIFIED')}
 for(let index=0;index<records.length;index++){
  const bytes=records[index]?.bytes;
  if(!Buffer.isBuffer(bytes)||bytes.length>2*1024*1024)return block('INVALID_STEP_RECORD');
  let raw;try{raw=JSON.parse(bytes)}catch{return block('INVALID_STEP_RECORD')}
  const parsed=recordSchema.safeParse(raw);if(!parsed.success)return block('INVALID_STEP_RECORD');const r=parsed.data;
  if(r.stage!==CUTOVER_STAGES[index]||r.previousRecordSha256!==predecessor||r.beforeSnapshotSha256!==snapshot)return block('STEP_LINEAGE_MISMATCH');
  if(['candidate','origin','scope','sourceRef','targetRef'].some(k=>r[k]!==m[k]))return block('STEP_CONTEXT_MISMATCH');
  const at=Date.parse(r.observedAt);if(at<previousAt||at>now||now-at>14*86400000)return block('STEP_EVIDENCE_STALE');
  if(r.status!=='PASS')return block('STEP_NOT_PASSED');
  if(r.kind!==(r.stage==='RESTORE'?'HOSTED_RESTORE':r.stage==='BETA'?'HOSTED_API':'HOSTED_SQL'))return block('HOSTED_STEP_EVIDENCE_REQUIRED');
  if(r.stage==='BETA'?r.afterSnapshotSha256!==snapshot:r.afterSnapshotSha256===snapshot)return block('FRESH_RESULT_SNAPSHOT_REQUIRED');
  const verifiedBytes=async d=>{const b=Buffer.from(await readProof(d));if(b.length!==d.bytes||sha(b)!==d.sha256)fail('PROOF_BYTES_MISMATCH');return b};
  if(r.stage==='BETA'&&r.resultSnapshot!==null)return block('BETA_SNAPSHOT_MUST_BE_READ_ONLY');
  let resultSnapshot;
  if(r.stage!=='BETA'){
   try{
    if(!r.resultSnapshot||r.resultSnapshot.sha256!==r.afterSnapshotSha256)throw Error();
    const s=inspectCutoverSnapshot(await verifiedBytes(r.resultSnapshot));
    if(
       Date.parse(s.captured_at)<previousAt||Date.parse(s.captured_at)>at)throw Error();
    resultSnapshot=s;
   }catch{return block('RESULT_SNAPSHOT_UNVERIFIED')}
  }
  let proof;try{if(r.proof.bytes>2*1024*1024)throw Error();proof=JSON.parse(await verifiedBytes(r.proof))}catch{return block('STEP_PROOF_UNVERIFIED')}
  if(r.stage==='BETA'){
   const result=await evaluateBetaEvidence(proof,{candidate:m.candidate,origin:m.origin,scope:m.scope,now,verifyProof:verifyBetaProof});
   if(result.decision!=='READY_FOR_HUMAN_APPROVAL')return block('BETA_EVIDENCE_INCOMPLETE');
  }else{
   const p=proofSchema.safeParse(proof);if(!p.success)return block('INVALID_STAGE_PROOF');const v=p.data;
   if(v.stage!==r.stage||v.kind!==r.kind||Object.keys(context).some(k=>v[k]!==r[k]))return block('STAGE_PROOF_CONTEXT_MISMATCH');
   let validated;
   if(r.stage==='CONTENT'||r.stage==='IMPORT'){
    try{
     const packet=JSON.parse(await verifiedBytes(v.packet)),decisions=JSON.parse(await verifiedBytes(v.decisions));
     if(packet.snapshotSha256!==snapshot||packet.projectRef!==m.targetRef)throw Error();
     validated=r.stage==='CONTENT'?validateContentDecisions(packet,decisions):validateLegacyImport(packet,decisions);
     if((Array.isArray(validated.pending)?validated.pending.length:validated.pending)||
       (Array.isArray(validated.held)?validated.held.length:validated.held))throw Error();
     if(r.stage==='IMPORT'&&(validated.selected.length!==v.importedHeads||packet.entries.filter(e=>e.eligible).length!==v.eligibleLegacyNovels))throw Error();
     for(const {decision} of validated.selected)for(const d of [decision.rightsEvidence,decision.imageEvidence].filter(Boolean))await verifiedBytes(d);
     if(r.stage==='IMPORT'&&validated.selected.length)await verifiedBytes(validated.cutoverEvidence);
     if(validated.selected.length){
      const template=(await verifiedBytes(m.sql.find(s=>s.id===v.sql.id))).toString();
      const generated=r.stage==='CONTENT'?contentSelectionSql(packet,validated,template):legacyImportSql(packet,validated,template,{versionIds:v.versionIds});
      if(!v.executedSql||sha(await verifiedBytes(v.executedSql))!==sha(generated.sql))throw Error();
     }else if(v.executedSql!==null||(r.stage==='IMPORT'&&v.versionIds.length))throw Error();
    }catch{return block('EXECUTION_INPUT_UNVERIFIED')}
   }
   const expected=entry=>m.sql.find(s=>s.id===entry.id)?.sha256===entry.sha256;
   if(r.stage==='RESTORE'&&v.nativeArchiveSha256!==m.nativeArchiveSha256)return block('RESTORED_ARCHIVE_MISMATCH');
   if(r.stage==='CONTENT'&&(v.bodyConflicts||v.unresolvedDecisions||v.reviewSnapshotSha256!==snapshot||v.sql.id!=='content-selection'||!expected(v.sql)))return block('ORIGINAL_REVIEW_INCOMPLETE');
   if(r.stage==='MIGRATIONS'){
    const required=CUTOVER_SQL.filter(s=>s.id.startsWith('authoring-')).map(s=>s.id),plan=cutoverMigrationPlan(m).filter(s=>s.action==='REVIEW_AND_APPLY');
    if(v.bodyConflicts||new Set(v.versions).size!==v.versions.length||required.some(s=>!v.versions.includes(s))||
      JSON.stringify(v.appliedSql.map(s=>s.id))!==JSON.stringify(plan.map(s=>s.id))||v.appliedSql.some(s=>!expected(s)))return block('MIGRATION_REVIEW_INCOMPLETE');
   }
   if(r.stage==='IMPORT'&&(v.packetSnapshotSha256!==snapshot||v.pendingImports||v.importedHeads!==v.eligibleLegacyNovels||
     v.sql.id!=='legacy-import'||!expected(v.sql)||(m.scope==='NOVEL_WEBTOON_FREE'&&!v.webtoonAssetAcceptance)))return block('PUBLICATION_IMPORT_INCOMPLETE');
   if(r.stage==='LOCKDOWN'&&(v.sql.id!=='p0-lockdown'||!expected(v.sql)))return block('LOCKDOWN_PROOF_INCOMPLETE');
   try{if(!stageDataMatches(previousSnapshot,resultSnapshot,r.stage,v,validated))return block('RESULT_DATA_CONTRACT_MISMATCH')}
   catch{return block('RESULT_DATA_CONTRACT_MISMATCH')}
  }
  predecessor=sha(bytes);snapshot=r.afterSnapshotSha256;previousAt=at;
  if(resultSnapshot)previousSnapshot=resultSnapshot;
  report.completedSteps++;report.steps.push({stage:r.stage,status:'EVIDENCE_LINKED'});
 }
 report.nextStep=CUTOVER_STAGES[report.completedSteps]||null;
 report.status=report.nextStep?'READY_FOR_NEXT_REVIEW':'READY_FOR_HUMAN_APPROVAL';
 return report;
}
