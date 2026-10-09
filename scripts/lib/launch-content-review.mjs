import {createHash} from 'node:crypto';
import {readFile,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {safeBundleFile} from './recovery-bundle.mjs';

export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const md5=bytes=>createHash('md5').update(bytes).digest('hex');
const fail=code=>{throw Error('CONTENT_REVIEW_'+code);};
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const id=z.string().regex(/^[1-9][0-9]{0,18}$/).refine(v=>BigInt(v)<=9223372036854775807n);
const evidence=z.object({file:z.string().min(1).max(1024),bytes:z.number().int().positive().max(16*1024*1024),sha256:digest}).strict();
const reviewSchema=z.object({format:z.literal('webnovels-content-decisions-v1'),snapshotSha256:digest,packetSha256:digest,
  decisions:z.array(z.object({episodeId:id,sourceDigest:digest,decision:z.enum(['PENDING','HOLD','USE_EPISODES','USE_EPISODE_CONTENTS']),
    reviewerRef:z.string().max(200).nullable(),evidenceRef:z.string().max(500).nullable(),
    rightsEvidence:evidence.nullable(),imageEvidence:evidence.nullable(),selectedSourceSha256:digest.nullable()}).strict()).max(100000)}).strict();

export async function privateBackupDirectory(input) {
  const allowed=path.resolve('scratch/launch/backups'),directory=path.resolve(input);
  const relative=path.relative(allowed,directory);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))fail('PRIVATE_DIRECTORY_REQUIRED');
  let current=allowed;
  for(const part of relative.split(path.sep)){
    current=path.join(current,part);if((await lstat(current)).isSymbolicLink())fail('LINK_FORBIDDEN');
  }
  if(!(await lstat(directory)).isDirectory()||!(await realpath(directory)).startsWith((await realpath(allowed))+path.sep))fail('PRIVATE_DIRECTORY_REQUIRED');
  return directory;
}
export async function readVerifiedSnapshot(directory) {
  const files=await Promise.all(['snapshot.json','manifest.json','data-restore-verification.json'].map(n=>safeBundleFile(directory,n)));
  for(const file of files)if((await lstat(file)).size>128*1024*1024)fail('FILE_TOO_LARGE');
  const [bytes,manifestBytes,restoreBytes]=await Promise.all(files.map(file=>readFile(file)));
  const manifest=JSON.parse(manifestBytes),restore=JSON.parse(restoreBytes),snapshot=JSON.parse(bytes),hash=sha(bytes);
  if(hash!==manifest.snapshotSha256||hash!==restore.snapshotSha256||!restore.allRowsMatch||!Number.isInteger(restore.tablesVerified)||
    restore.tablesVerified!==snapshot.tables.length||restore.rowsVerified!==snapshot.tables.reduce((n,t)=>n+t.rows.length,0)||
    !/^[a-z0-9]{20}$/.test(manifest.projectRef))fail('VERIFIED_SNAPSHOT_REQUIRED');
  return {snapshot,manifest,hash};
}
export async function buildContentPacket(db,{snapshot,manifest,hash},seed) {
  await db.exec("set timezone='UTC'");
  // Reuse only the exact seed body expression, in the isolated engine. Never seed production.
  const expression=seed.match(/ep_id,\s*('제 '[\s\S]+?),\s*1\s*\)\s*ON CONFLICT \(episode_id\)/)?.[1];
  if(!expression||!expression.includes('ep_num'))fail('SEED_EXPRESSION_REQUIRED');
  const rows=(await db.query(`select e.id::text episode_id,e.work_id::text work_id,e.episode_number::text episode_number,
    w.author_id::text author_id,a.auth_user_id::text auth_user_id,w.content_type::text content_type,
    to_jsonb(e)::text episode_row,to_jsonb(c)::text content_row,to_jsonb(w)::text work_row,to_jsonb(a)::text author_row,
    to_jsonb(u)::text auth_row,to_jsonb(i)::text identity_row,
    (u.id is not null and u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=now()) and i.auth_user_id=u.id) mapping_verified
    from public.episodes e join public.episode_contents c on c.episode_id=e.id
    join public.works w on w.id=e.work_id left join public.authors a on a.id=w.author_id
    left join auth.users u on u.id=a.auth_user_id
    left join authoring.identity_evidence i on i.profile_kind='author' and i.profile_id=a.id::text
    where e.content is distinct from c.text_content order by e.id`)).rows;
  const entries=[];
  for(const row of rows){
    if(!id.safeParse(row.episode_id).success||!id.safeParse(row.work_id).success)fail('INVALID_DOMAIN_ID');
    const episode=JSON.parse(row.episode_row),content=JSON.parse(row.content_row);
    const seedBody=(await db.query(`select ${expression.replaceAll('ep_num','$1::int')} body`,[row.episode_number])).rows[0].body;
    const source={episode:row.episode_row,content:row.content_row,work:row.work_row,author:row.author_row,auth:row.auth_row,identity:row.identity_row};
    entries.push({episodeId:row.episode_id,workId:row.work_id,episodeNumber:row.episode_number,authorId:row.author_id,authUserId:row.auth_user_id,
      contentType:row.content_type,authMappingVerified:row.mapping_verified===true,source,
      sourceDigest:sha(JSON.stringify(source)),episodesSourceSha256:sha(JSON.stringify(episode.content)),
      episodeContentsSourceSha256:sha(JSON.stringify(content.text_content)),
      episodesEmpty:typeof episode.content!=='string'||!episode.content.trim(),
      alternateIsSeed:content.text_content===seedBody,currentIsSeed:episode.content===seedBody,
      imageCount:Array.isArray(episode.image_urls)?episode.image_urls.length:0});
  }
  return {format:'webnovels-content-packet-v1',projectRef:manifest.projectRef,snapshotSha256:hash,
    capturedAt:snapshot.captured_at,seedSha256:sha(seed),entries};
}
export function decisionTemplate(packet) {
  return {format:'webnovels-content-decisions-v1',snapshotSha256:packet.snapshotSha256,packetSha256:sha(JSON.stringify(packet)),
    decisions:packet.entries.map(row=>({episodeId:row.episodeId,sourceDigest:row.sourceDigest,decision:'PENDING',reviewerRef:null,evidenceRef:null,
      rightsEvidence:null,imageEvidence:null,selectedSourceSha256:null}))};
}
export function validateContentDecisions(packet,input) {
  const parsed=reviewSchema.safeParse(input);if(!parsed.success)fail('INVALID_DECISIONS');
  const review=parsed.data;
  if(review.snapshotSha256!==packet.snapshotSha256||review.packetSha256!==sha(JSON.stringify(packet)))fail('STALE_PACKET');
  const byId=new Map(packet.entries.map(row=>[row.episodeId,row]));
  if(byId.size!==packet.entries.length)fail('DUPLICATE_SOURCE');
  if(review.decisions.length!==byId.size)fail('INCOMPLETE_DECISIONS');
  const seen=new Set(),selected=[],held=[],pending=[];
  for(const decision of review.decisions){
    if(seen.has(decision.episodeId))fail('DUPLICATE_DECISION');seen.add(decision.episodeId);
    const row=byId.get(decision.episodeId);
    if(!row||row.sourceDigest!==decision.sourceDigest)fail('STALE_SOURCE');
    if(decision.decision==='PENDING'){pending.push(row);continue;}
    if(!decision.reviewerRef?.trim()||decision.reviewerRef.trim().length<3||!decision.evidenceRef?.trim()||decision.evidenceRef.trim().length<10)fail('REVIEWER_EVIDENCE_REQUIRED');
    if(decision.decision==='HOLD'){held.push(row);continue;}
    if(!row.authMappingVerified||!row.authorId||!row.authUserId)fail('VERIFIED_OWNER_REQUIRED');
    if(!decision.rightsEvidence)fail('RIGHTS_EVIDENCE_REQUIRED');
    const current=decision.decision==='USE_EPISODES';
    if(decision.selectedSourceSha256!==(current?row.episodesSourceSha256:row.episodeContentsSourceSha256))fail('SELECTED_SOURCE_MISMATCH');
    if(current?row.currentIsSeed:row.alternateIsSeed)fail('DEVELOPMENT_SEED_FORBIDDEN');
    const selectedBody=JSON.parse(current?row.source.episode:row.source.content)[current?'content':'text_content'];
    const empty=typeof selectedBody!=='string'||!selectedBody.trim();
    if(!['NOVEL','WEBTOON'].includes(row.contentType))fail('TYPE_REVIEW_REQUIRED');
    if(row.contentType==='NOVEL'&&empty)fail('EMPTY_NOVEL_FORBIDDEN');
    if(row.contentType==='WEBTOON'&&(!row.imageCount||!decision.imageEvidence))fail('IMAGE_EVIDENCE_REQUIRED');
    selected.push({row,decision});
  }
  return {selected,held,pending,unresolved:held.length+pending.length};
}
export async function verifyReviewEvidence(directory,validated) {
  for(const {decision} of validated.selected)for(const descriptor of [decision.rightsEvidence,decision.imageEvidence].filter(Boolean)){
    const file=await safeBundleFile(directory,descriptor.file);
    if((await lstat(file)).size!==descriptor.bytes)fail('EVIDENCE_SIZE_MISMATCH');
    if(sha(await readFile(file))!==descriptor.sha256)fail('EVIDENCE_HASH_MISMATCH');
  }
}
export function reviewSummary(packet,validated) {
  return {format:'webnovels-content-review-summary-v1',snapshotSha256:packet.snapshotSha256,packetSha256:sha(JSON.stringify(packet)),
    conflicts:packet.entries.length,byType:Object.fromEntries(['NOVEL','WEBTOON'].map(t=>[t,packet.entries.filter(r=>r.contentType===t).length])),
    seededAlternateBodies:packet.entries.filter(r=>r.alternateIsSeed).length,verifiedOwnerMappings:packet.entries.filter(r=>r.authMappingVerified).length,
    approved:validated.selected.length,held:validated.held.length,pending:validated.pending.length,unresolved:validated.unresolved,
    productionChanged:false,hostedRestoreAccepted:false,freeCutoverAccepted:false};
}
export function contentSelectionSql(packet,validated,template) {
  if(!validated.selected.length)fail('NO_APPROVED_SELECTIONS');
  const lit=s=>"'"+String(s).replaceAll("'","''")+"'";
  const selections=validated.selected.map(({row,decision})=>({episodeId:row.episodeId,sourceDigest:row.sourceDigest,...decision}));
  const batchId='content-v1-'+sha(JSON.stringify({snapshot:packet.snapshotSha256,selections}));
  let prelude=`create temp table content_review_context(batch_id text,backup_sha256 text) on commit drop;
    insert into content_review_context values(${lit(batchId)},${lit(packet.snapshotSha256)});
    create temp table content_review_plan(episode_id bigint primary key,choice text,episode_hash text,content_hash text,
      work_hash text,author_hash text,auth_hash text,identity_hash text,evidence_ref text) on commit drop;`;
  for(const {row,decision} of validated.selected){
    const proof=JSON.stringify({reviewer:decision.reviewerRef,evidence:decision.evidenceRef,rights:decision.rightsEvidence,image:decision.imageEvidence,
      sourceDigest:row.sourceDigest,packetSha256:sha(JSON.stringify(packet))});
    prelude+=`insert into content_review_plan values(${row.episodeId},${lit(decision.decision)},${['episode','content','work','author','auth','identity'].map(k=>lit(md5(row.source[k]))).join(',')},${lit(proof)});\n`;
  }
  return {batchId,sql:template.replace('begin;',`begin;\n${prelude}`)};
}
