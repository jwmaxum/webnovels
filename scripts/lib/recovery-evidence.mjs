import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {privateBackupDirectory,sha} from './launch-content-review.mjs';
import {safeBundleFile} from './recovery-bundle.mjs';
import {readCutoverFile} from './cutover-package.mjs';
const fail=code=>{throw Error('RECOVERY_EVIDENCE_'+code);};
const digest=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.string().uuid(),md5=z.string().regex(/^[a-f0-9]{32}$/);
const id=z.string().regex(/^[1-9]\d{0,18}$/).refine(v=>BigInt(v)<=9223372036854775807n);
const revision=z.string().regex(/^(0|[1-9]\d{0,18})$/).refine(v=>BigInt(v)<=9223372036854775807n);
const name=z.string().regex(/^[a-z][a-z0-9-]{2,63}$/);
const relative=z.string().min(1).max(1024).refine(v=>!/[\\\x00-\x1f\x7f:]/.test(v)&&!v.startsWith('/')&&!v.split('/').some(p=>!p||p==='.'||p==='..'));
const evidencePath=relative.refine(v=>/^(?:proofs\/input\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+|[a-z][a-z0-9-]{2,63}\/evidence\/[a-f0-9]{64})\.(?:pdf|png|jpe?g|webp|txt|md|json|docx)$/.test(v));
const originalPath=relative.refine(v=>/^originals\/input\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:bin|txt|docx|hwpx)$/.test(v));
const evidence=z.object({file:evidencePath,bytes:z.number().int().positive().max(16*1024*1024),sha256:digest}).strict();
const original=evidence.extend({file:originalPath,bytes:z.number().int().positive().max(2*1024*1024)});
const body=z.object({title:z.string().max(200),content:z.string().max(200000),authorComment:z.string().max(5000)}).strict();
const entrySchema=z.object({requestId:uuid,workId:id,authorId:id,draftId:uuid,episodeId:id,episodeNumber:id,
 revision:id,sourceRevision:id,fileId:uuid,fileSha256:digest,fileBytes:z.number().int().positive().max(2*1024*1024),
 reviewRevision:revision,reviewStatus:z.enum(['PENDING','HOLD','REJECTED','READY_FOR_RESTORE_REVIEW']),contextDigest:md5,
 submitted:body,imported:body,submittedSha256:digest,importedSha256:digest,sourceDigest:digest,
 imageCount:z.number().int().nonnegative(),blockedReasons:z.array(z.string()).max(30),
 source:z.record(z.union([z.string(),z.array(z.string()),z.null()]))}).strict();
const packetSchema=z.object({format:z.literal('webnovels-recovery-evidence-packet-v1'),projectRef:z.string().regex(/^[a-z0-9]{20}$/),
 snapshotSha256:digest,capturedAt:z.string().datetime({offset:true}),helperSha256:digest,seedSha256:digest,
 missingPrerequisites:z.array(z.string()).max(100),entries:z.array(entrySchema).max(1000)}).strict();
const decisionSchema=z.object({requestId:uuid,sourceDigest:digest,decision:z.enum(['PENDING','HOLD','PREPARE_RESTORE']),
 reviewerRef:z.string().max(200).nullable(),evidenceRef:z.string().max(500).nullable(),submittedSha256:digest.nullable(),
 originalFile:original.nullable(),rightsEvidence:evidence.nullable(),ratingEvidence:evidence.nullable(),aiEvidence:evidence.nullable(),imageEvidence:evidence.nullable()}).strict();
const reviewSchema=z.object({format:z.literal('webnovels-recovery-evidence-decisions-v1'),snapshotSha256:digest,packetSha256:digest,
 decisions:z.array(decisionSchema).max(1000)}).strict();
const MAX_PACKET=48*1024*1024,MAX_DECISIONS=4*1024*1024;
const requiredTables=['public.works','public.episodes','public.authors','public.readers','public.admin_users','public.secure_episode_contents','auth.users',
 'authoring.migrations','authoring.work_state','authoring.drafts','authoring.draft_revisions','authoring.files','authoring.file_jobs','authoring.revision_files',
 'authoring.publication_heads','authoring.recovery_requests','authoring.recovery_review_events','authoring.recovery_source_access','authoring.recovery_review_receipts','authoring.workflow_events'];
const requiredMigrations=['authoring-002','authoring-007','authoring-014','authoring-019','authoring-020'];
const q=s=>'"'+s.replaceAll('"','""')+'"';
async function helperDefinitions(){
 const files=await Promise.all(['019_creator_recovery_requests','020_admin_recovery_review'].map(n=>readFile(new URL('../../database/authoring/'+n+'.sql',import.meta.url),'utf8')));
 const definitions=files.map((s,i)=>s.match(new RegExp('create or replace function authoring\\.'+(i?'recovery_review_context':'recovery_target')+'\\([\\s\\S]*?end \\$\\$;'))?.[0]);
 if(definitions.some(d=>!d))fail('HELPER_DEFINITION_REQUIRED');return {sql:definitions.join('\n'),hash:sha(definitions.join('\n'))};
}
export function validateRecoveryPacket(input){
 const parsed=packetSchema.safeParse(input);if(!parsed.success||Buffer.byteLength(JSON.stringify(input,null,2)+'\n')>MAX_PACKET)fail('INVALID_PACKET');
 const packet=parsed.data,seen=new Set();
 for(const e of packet.entries){
  if(seen.has(e.requestId))fail('DUPLICATE_REQUEST');seen.add(e.requestId);
  if(BigInt(e.sourceRevision)>BigInt(e.revision)||sha(JSON.stringify(e.submitted))!==e.submittedSha256||sha(JSON.stringify(e.imported))!==e.importedSha256||sha(JSON.stringify(e.source))!==e.sourceDigest)fail('SOURCE_DIGEST_MISMATCH');
 }
 return packet;
}
export async function buildRecoveryPacket(db,{snapshot,manifest,hash},seed){
 await db.exec("set timezone='UTC'");const helper=await helperDefinitions(),tables=new Set(snapshot.tables.map(t=>t.schema+'.'+t.name));
 const missing=requiredTables.filter(t=>!tables.has(t)).map(t=>'TABLE:'+t);
 if(tables.has('authoring.migrations')){const versions=new Set((await db.query('select version from authoring.migrations')).rows.map(r=>r.version));missing.push(...requiredMigrations.filter(v=>!versions.has(v)).map(v=>'MIGRATION:'+v));}
 const packet={format:'webnovels-recovery-evidence-packet-v1',projectRef:manifest.projectRef,snapshotSha256:hash,capturedAt:snapshot.captured_at,helperSha256:helper.hash,seedSha256:sha(seed),missingPrerequisites:missing,entries:[]};
 if(missing.length)return validateRecoveryPacket(packet);
 // Install only two trusted, read-only helper definitions in the isolated data restore.
 // Full migrations/RPC/ACL/trigger acceptance is deliberately outside this rehearsal.
 await db.exec(helper.sql);
 const expression=seed.match(/ep_id,\s*('제 '[\s\S]+?),\s*1\s*\)\s*ON CONFLICT \(episode_id\)/)?.[1];
 if(!expression||!expression.includes('ep_num'))fail('SEED_EXPRESSION_REQUIRED');
 const rows=(await db.query(`select r.id::text request_id,r.work_id::text work_id,r.author_id::text author_id,r.draft_id::text draft_id,
 r.episode_id::text episode_id,e.episode_number::text episode_number,r.revision::text revision,r.source_revision::text source_revision,
 r.file_id::text file_id,r.file_sha256,r.file_size::text file_size,coalesce(v.revision,0)::text review_revision,coalesce(v.disposition,'PENDING') review_status,
 authoring.recovery_review_context(r) context,
 dv.title,dv.content,dv.author_comment,sv.title source_title,sv.content source_content,sv.author_comment source_comment,
 to_jsonb(r)::text request_row,to_jsonb(dv)::text submitted_row,to_jsonb(sv)::text imported_row,to_jsonb(f)::text file_row,
 to_jsonb(w)::text work_row,to_jsonb(a)::text author_row,to_jsonb(d)::text draft_row,to_jsonb(s)::text state_row,
 to_jsonb(u)::text auth_row,to_jsonb(ad)::text admin_row,to_jsonb(au)::text admin_auth_row,to_jsonb(v)::text review_row,
 to_jsonb(access)::text access_row,authoring.recovery_target(r.episode_id)::text target_row,
 (select coalesce(jsonb_agg(to_jsonb(x)::text order by x.id),'[]') from authoring.file_jobs x where x.file_id=r.file_id and x.user_id=r.user_id and x.work_id=r.work_id and x.kind='IMPORT' and x.payload->>'draftId'=r.draft_id::text) jobs,
 (select coalesce(jsonb_agg(to_jsonb(x)::text order by x.revision),'[]') from authoring.revision_files x where x.draft_id=r.draft_id and x.file_id=r.file_id) links,
 (select coalesce(jsonb_agg(to_jsonb(x)::text order by x.id),'[]') from authoring.workflow_events x where x.actor_user_id=v.actor_user_id and x.action='recovery-decide' and x.target='RECOVERY:'||r.id
  and x.work_id=r.work_id and x.reason=v.reason and x.detail=receipt.result and x.created_at=v.created_at) audits,
 to_jsonb(receipt)::text receipt_row,
 (v.disposition='READY_FOR_RESTORE_REVIEW' and ad.role::text='SUPER_ADMIN' and ad.is_active=true
  and au.email_confirmed_at is not null and au.is_anonymous is not true and (au.banned_until is null or au.banned_until<=now()) and to_jsonb(au)->>'deleted_at' is null
  and v.context_digest=authoring.recovery_review_context(r)->>'digest'
  and v.checks->'rightsChecked'='true'::jsonb and v.checks->'ratingChecked'='true'::jsonb and v.checks->'aiChecked'='true'::jsonb
  and access.actor_user_id=v.actor_user_id and access.request_id=r.id and access.kind='manuscript' and access.context_digest=v.context_digest
  and receipt.action='recovery-decide' and receipt.payload=v.checks||jsonb_build_object('reason',v.reason,'evidence',v.evidence)
  and v.checks->>'recoveryId'=r.id::text and v.checks->>'decision'=v.disposition and v.checks->>'revision'=(v.revision-1)::text and v.checks->>'contextDigest'=v.context_digest
  and receipt.result=jsonb_build_object('id',r.id,'revision',v.revision::text,'status',v.disposition,'reason',v.reason,'createdAt',v.created_at)) verified_review,
 (to_jsonb(u)->>'deleted_at' is null) author_not_deleted,
 jsonb_array_length(coalesce(e.image_urls,'[]')) image_count
 from authoring.recovery_requests r
 join public.episodes e on e.id=r.episode_id and e.work_id=r.work_id join public.works w on w.id=r.work_id
 join public.authors a on a.id=r.author_id join auth.users u on u.id=r.user_id
 join authoring.work_state s on s.work_id=r.work_id join authoring.drafts d on d.id=r.draft_id
 join authoring.draft_revisions dv on dv.draft_id=r.draft_id and dv.revision=r.revision
 join authoring.draft_revisions sv on sv.draft_id=r.draft_id and sv.revision=r.source_revision
 join authoring.files f on f.id=r.file_id
 left join lateral(select * from authoring.recovery_review_events x where x.request_id=r.id order by x.revision desc limit 1) v on true
 left join public.admin_users ad on ad.auth_user_id=v.actor_user_id left join auth.users au on au.id=v.actor_user_id
 left join authoring.recovery_source_access access on access.id=(v.checks->>'accessId')::uuid
 left join authoring.recovery_review_receipts receipt on receipt.user_id=v.actor_user_id and receipt.request_key=(v.checks->>'requestId')::uuid
 order by r.created_at,r.id limit 1001`)).rows;
 const total=(await db.query('select count(*)::text n from authoring.recovery_requests')).rows[0].n;
 if(BigInt(total)>1000n)fail('REQUEST_LIMIT');if(rows.length!==Number(total))fail('INCOMPLETE_SOURCE_ROWS');
 for(const r of rows){
  const submitted={title:r.title,content:r.content,authorComment:r.author_comment},imported={title:r.source_title,content:r.source_content,authorComment:r.source_comment};
  const seedBody=(await db.query(`select ${expression.replaceAll('ep_num','$1::int')} body`,[r.episode_number])).rows[0].body;
  const source={request:r.request_row,submitted:r.submitted_row,imported:r.imported_row,file:r.file_row,work:r.work_row,author:r.author_row,draft:r.draft_row,state:r.state_row,
   authorAuthSha256:sha(r.auth_row),admin:r.admin_row,adminAuthSha256:r.admin_auth_row===null?null:sha(r.admin_auth_row),review:r.review_row,access:r.access_row,target:r.target_row,jobs:r.jobs,links:r.links,audits:r.audits,receipt:r.receipt_row};
  const blocks=[];
  if(r.context.eligible!==true||r.author_not_deleted!==true)blocks.push('CURRENT_CONTEXT_INVALID');
  if(r.review_status!=='READY_FOR_RESTORE_REVIEW')blocks.push('LATEST_REVIEW_NOT_READY');
  if(r.verified_review!==true||!r.audits.length)blocks.push('REVIEW_EVIDENCE_CHAIN_INVALID');
  if(typeof submitted.content!=='string'||!submitted.content.trim())blocks.push('EMPTY_SUBMITTED_NOVEL');
  if(submitted.content===seedBody)blocks.push('DEVELOPMENT_SEED');
  packet.entries.push({requestId:r.request_id,workId:r.work_id,authorId:r.author_id,draftId:r.draft_id,episodeId:r.episode_id,episodeNumber:r.episode_number,
   revision:r.revision,sourceRevision:r.source_revision,fileId:r.file_id,fileSha256:r.file_sha256,fileBytes:Number(r.file_size),reviewRevision:r.review_revision,reviewStatus:r.review_status,
   contextDigest:r.context.digest,submitted,imported,submittedSha256:sha(JSON.stringify(submitted)),importedSha256:sha(JSON.stringify(imported)),sourceDigest:sha(JSON.stringify(source)),imageCount:r.image_count,blockedReasons:blocks,source});
 }
 return validateRecoveryPacket(packet);
}
export function recoveryDecisionTemplate(packet){
 validateRecoveryPacket(packet);return {format:'webnovels-recovery-evidence-decisions-v1',snapshotSha256:packet.snapshotSha256,packetSha256:sha(JSON.stringify(packet)),
  decisions:packet.entries.map(e=>({requestId:e.requestId,sourceDigest:e.sourceDigest,decision:'PENDING',reviewerRef:null,evidenceRef:null,submittedSha256:null,
   originalFile:null,rightsEvidence:null,ratingEvidence:null,aiEvidence:null,imageEvidence:null}))};
}
export function validateRecoveryDecisions(packet,input){
 validateRecoveryPacket(packet);const parsed=reviewSchema.safeParse(input);if(!parsed.success)fail('INVALID_DECISIONS');const review=parsed.data;
 if(review.snapshotSha256!==packet.snapshotSha256||review.packetSha256!==sha(JSON.stringify(packet)))fail('STALE_PACKET');
 if(review.decisions.length!==packet.entries.length)fail('INCOMPLETE_DECISIONS');
 const rows=new Map(packet.entries.map(e=>[e.requestId,e])),seen=new Set(),episodes=new Set(),selected=[],held=[],pending=[];
 for(const decision of review.decisions){
  if(seen.has(decision.requestId))fail('DUPLICATE_DECISION');seen.add(decision.requestId);const row=rows.get(decision.requestId);
  if(!row||row.sourceDigest!==decision.sourceDigest)fail('STALE_SOURCE');
  if(decision.decision!=='PREPARE_RESTORE'){
   if([decision.submittedSha256,decision.originalFile,decision.rightsEvidence,decision.ratingEvidence,decision.aiEvidence,decision.imageEvidence].some(v=>v!==null))fail('UNSELECTED_EVIDENCE_FORBIDDEN');
   if(decision.decision==='HOLD'){if(!decision.reviewerRef?.trim()||!decision.evidenceRef?.trim())fail('HOLD_REASON_REQUIRED');held.push(row);}else pending.push(row);continue;
  }
  if(packet.missingPrerequisites.length||row.blockedReasons.length||row.reviewStatus!=='READY_FOR_RESTORE_REVIEW'||row.reviewRevision==='0')fail('BLOCKED_REQUEST');
  if(!decision.reviewerRef?.trim()||decision.reviewerRef.trim().length<3||!decision.evidenceRef?.trim()||decision.evidenceRef.trim().length<10)fail('REVIEWER_EVIDENCE_REQUIRED');
  if(!decision.originalFile||!decision.rightsEvidence||!decision.ratingEvidence||!decision.aiEvidence)fail('ACTUAL_EVIDENCE_REQUIRED');
  if(row.imageCount&&!decision.imageEvidence)fail('IMAGE_EVIDENCE_REQUIRED');
  if(decision.submittedSha256!==row.submittedSha256||decision.originalFile.sha256!==row.fileSha256||decision.originalFile.bytes!==row.fileBytes)fail('SELECTED_SOURCE_MISMATCH');
  if(episodes.has(row.episodeId))fail('DUPLICATE_TARGET_EPISODE');episodes.add(row.episodeId);selected.push({row,decision});
 }
 return {selected,held,pending};
}
export async function verifyRecoveryEvidence(directory,validated){
 await privateBackupDirectory(directory);
 for(const {decision} of validated.selected)for(const file of [decision.originalFile,decision.rightsEvidence,decision.ratingEvidence,decision.aiEvidence,decision.imageEvidence].filter(Boolean)){
  const bytes=await readCutoverFile(directory,file);if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)fail('FILE_BYTES_MISMATCH');
 }
}
export function recoveryEvidenceSummary(packet,validated){
 return {format:'webnovels-recovery-evidence-summary-v1',snapshotSha256:packet.snapshotSha256,packetSha256:sha(JSON.stringify(packet)),
  requests:packet.entries.length,readyForEvidence:packet.entries.filter(e=>!e.blockedReasons.length).length,blockedRequests:packet.entries.filter(e=>e.blockedReasons.length).length,
  missingPrerequisites:packet.missingPrerequisites,selected:validated.selected.length,held:validated.held.length,pending:validated.pending.length,
  unresolved:validated.held.length+validated.pending.length,status:packet.missingPrerequisites.length?'SOURCE_PREREQUISITES_MISSING':validated.selected.length?'EVIDENCE_VALIDATED_PLAN_ONLY':'NO_VERIFIED_SELECTIONS',
  productionChanged:false,hostedRestoreAccepted:false,rightsAuthenticated:false,freeCutoverAccepted:false};
}
async function boundedJson(directory,file,max){const p=await safeBundleFile(directory,file);if((await lstat(p)).size>max)fail('FILE_TOO_LARGE');return JSON.parse(await readFile(p,'utf8'));}
export async function prepareRecoveryPackage(directory,packet,outputName){
 if(!name.safeParse(outputName).success)fail('INVALID_NAME');validateRecoveryPacket(packet);await privateBackupDirectory(directory);
 const target=path.join(directory,outputName);await mkdir(target);await privateBackupDirectory(target);
 const bytes=JSON.stringify(packet,null,2)+'\n',template=JSON.stringify(recoveryDecisionTemplate(packet),null,2)+'\n';
 const manifest={format:'webnovels-recovery-evidence-package-v1',snapshotSha256:packet.snapshotSha256,packetSha256:sha(JSON.stringify(packet)),packetFileSha256:sha(bytes),templateSha256:sha(template)};
 for(const [file,value]of [['packet.json',bytes],['decisions-template.json',template],['manifest.json',JSON.stringify(manifest,null,2)+'\n']])await writeFile(path.join(target,file),value,{flag:'wx',mode:0o600});
 return recoveryEvidenceSummary(packet,validateRecoveryDecisions(packet,recoveryDecisionTemplate(packet)));
}
export async function checkRecoveryPackage(directory,packet,packageName){
 if(!name.safeParse(packageName).success)fail('INVALID_NAME');await privateBackupDirectory(path.join(directory,packageName));
 const manifest=await boundedJson(directory,packageName+'/manifest.json',16384);
 const expected={format:'webnovels-recovery-evidence-package-v1',snapshotSha256:packet.snapshotSha256,packetSha256:sha(JSON.stringify(packet)),
  packetFileSha256:sha(JSON.stringify(packet,null,2)+'\n'),templateSha256:sha(JSON.stringify(recoveryDecisionTemplate(packet),null,2)+'\n')};
 if(JSON.stringify(manifest)!==JSON.stringify(expected))fail('STALE_PACKAGE');
 for(const [file,expectedHash]of [['packet.json',manifest.packetFileSha256],['decisions-template.json',manifest.templateSha256]]){
  const p=await safeBundleFile(directory,packageName+'/'+file);if((await lstat(p)).size>MAX_PACKET||sha(await readFile(p))!==expectedHash)fail('PACKAGE_BYTES_MISMATCH');
 }
 return expected;
}
export async function readRecoveryDecisions(directory,relativeFile){return boundedJson(directory,relativeFile,MAX_DECISIONS);}
export async function rehearseRecoveryPlan(db,verified,packet,input,directory){
 const validated=validateRecoveryDecisions(packet,input);await verifyRecoveryEvidence(directory,validated);
 if(!validated.selected.length)fail('NO_VERIFIED_SELECTIONS');
 const seed=await readFile(new URL('../../database/99_seed_dev.sql',import.meta.url),'utf8');
 const current=await buildRecoveryPacket(db,verified,seed);if(sha(JSON.stringify(current))!==sha(JSON.stringify(packet)))fail('REHEARSAL_SOURCE_CHANGED');
 let preservedRows=0;
 for(const t of verified.snapshot.tables){
  const rows=(await db.query(`select to_jsonb(r)::text row from ${q(t.schema)}.${q(t.name)} r`)).rows.map(r=>r.row).sort();
  if(JSON.stringify(rows)!==JSON.stringify([...t.rows].sort()))fail('SOURCE_ROWS_CHANGED');preservedRows+=rows.length;
 }
 const plan={format:'webnovels-submitted-novel-restore-plan-v1',snapshotSha256:packet.snapshotSha256,packetSha256:sha(JSON.stringify(packet)),decisionsSha256:sha(JSON.stringify(input)),
  mode:'PLAN_ONLY_NO_APPLY',selections:validated.selected.map(({row,decision})=>({requestId:row.requestId,workId:row.workId,authorId:row.authorId,draftId:row.draftId,episodeId:row.episodeId,
   revision:row.revision,sourceRevision:row.sourceRevision,reviewRevision:row.reviewRevision,contextDigest:row.contextDigest,sourceDigest:row.sourceDigest,
   submitted:row.submitted,importedSha256:row.importedSha256,submittedSha256:row.submittedSha256,originalFile:decision.originalFile,
   evidence:{reviewerRef:decision.reviewerRef,evidenceRef:decision.evidenceRef,rights:decision.rightsEvidence,rating:decision.ratingEvidence,ai:decision.aiEvidence,image:decision.imageEvidence},
   preservedTarget:row.source.target})),productionChanged:false,publicationChanged:false,hostedRestoreAccepted:false};
 return {plan,report:{...recoveryEvidenceSummary(packet,validated),planSha256:sha(JSON.stringify(plan)),isolatedPGliteSourceRowsVerified:true,preservedRows,
  fullSchemaRestore:false,bodyReplacementExecuted:false,requiresFreshHostedSnapshotBeforeApply:true,requiresReviewedTransactionalRestore:true}};
}
export async function writeRecoveryRehearsal(directory,outputName,result){
 if(!name.safeParse(outputName).success)fail('INVALID_NAME');await privateBackupDirectory(directory);const target=path.join(directory,outputName);await mkdir(target);await privateBackupDirectory(target);
 for(const [file,value]of [['candidate-plan.json',result.plan],['verification.json',result.report]])await writeFile(path.join(target,file),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
}
