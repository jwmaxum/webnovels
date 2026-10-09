import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {sha,verifyReviewEvidence} from './launch-content-review.mjs';
const fail=code=>{throw Error('LEGACY_IMPORT_'+code);};
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const id=z.string().regex(/^[1-9][0-9]{0,18}$/).refine(v=>BigInt(v)<=9223372036854775807n);
const proof=z.object({file:z.string().min(1).max(1024),bytes:z.number().int().positive().max(16*1024*1024),sha256:digest}).strict();
const reviewSchema=z.object({format:z.literal('webnovels-legacy-import-decisions-v1'),snapshotSha256:digest,packetSha256:digest,
  cutoverEvidence:proof.nullable(),decisions:z.array(z.object({episodeId:id,sourceDigest:digest,
    decision:z.enum(['PENDING','HOLD','IMPORT']),reviewerRef:z.string().max(200).nullable(),evidenceRef:z.string().max(500).nullable(),
    rightsEvidence:proof.nullable(),originalPublishedAt:z.string().datetime({offset:true}).nullable()}).strict()).max(100000)}).strict();

export async function buildLegacyImportPacket(db,{snapshot,manifest,hash},seed) {
  await db.exec("set timezone='UTC'");
  const present=async name=>(await db.query('select to_regclass($1) present',[name])).rows[0].present!==null;
  const hasAlternate=await present('public.episode_contents'),hasSecure=await present('public.secure_episode_contents');
  const queryRows=async(name,key)=>(await db.query(`select ${key}::text id,to_jsonb(r)::text row from ${name} r`)).rows;
  const alternates=new Map(hasAlternate?(await queryRows('public.episode_contents','episode_id')).map(r=>[r.id,r.row]):[]);
  const secured=new Map(hasSecure?(await queryRows('public.secure_episode_contents','episode_id')).map(r=>[r.id,r.row]):[]);
  const versions=(await db.query('select version from authoring.migrations order by version')).rows.map(r=>r.version);
  const marker=await present('public.p0_migration_status');
  const p0=marker?(await db.query("select exists(select 1 from public.p0_migration_status where version='p0-20260921' and phase in ('expanded','locked')) ready")).rows[0].ready:false;
  const conflicts=hasAlternate?(await db.query('select count(*)::int n from public.episodes e join public.episode_contents c on c.episode_id=e.id where e.content is distinct from c.text_content')).rows[0].n:0;
  const expression=seed.match(/ep_id,\s*('제 '[\s\S]+?),\s*1\s*\)\s*ON CONFLICT \(episode_id\)/)?.[1];
  if(!expression)fail('SEED_PROVENANCE_REQUIRED');
  const rows=(await db.query(`select e.id::text episode_id,e.work_id::text work_id,e.episode_number::text episode_number,
    to_jsonb(e)::text episode,to_jsonb(w)::text work,to_jsonb(s)::text state,to_jsonb(a)::text author,
    to_jsonb(u)::text auth,to_jsonb(i)::text identity,
    exists(select 1 from authoring.publication_heads h where h.episode_id=e.id) has_head,
    exists(select 1 from authoring.schedules q where q.episode_id=e.id and q.status in ('PENDING','RUNNING')) active_schedule
    from public.episodes e left join public.works w on w.id=e.work_id
    left join authoring.work_state s on s.work_id=w.id and s.author_id=w.author_id
    left join public.authors a on a.id=w.author_id left join auth.users u on u.id=a.auth_user_id
    left join authoring.identity_evidence i on i.profile_kind='author' and i.profile_id=a.id::text and i.auth_user_id=u.id
    order by e.id`)).rows;
  const entries=[];
  for(const row of rows){
    if(!id.safeParse(row.episode_id).success||!id.safeParse(row.work_id).success)fail('INVALID_DOMAIN_ID');
    const source=Object.fromEntries(['episode','work','state','author','auth','identity'].map(k=>[k,row[k]]));
    source.alternate=alternates.get(row.episode_id)||null;source.secure=secured.get(row.episode_id)||null;
    const [e,w,s,a,u,i,c,secure]=['episode','work','state','author','auth','identity','alternate','secure'].map(k=>JSON.parse(source[k]));
    const reasons=[],add=code=>reasons.push(code),at=Date.parse(snapshot.captured_at);
    if(!w||!s||!a||!u||!i||a.status!=='APPROVED'||!u.email_confirmed_at||u.deleted_at||u.is_anonymous||
      (u.banned_until&&Date.parse(u.banned_until)>at))add('VERIFIED_OWNER_REQUIRED');
    if(!w||w.content_type!=='NOVEL')add('NOVEL_ONLY');
    const genres=Array.isArray(w?.genre)?w.genre:[w?.genre];
    if(!w||!['ALL','AGE_15'].includes(w.rating)||genres.some(g=>['성인','19세 이상'].includes(g)))add('GENERAL_RATING_REQUIRED');
    if(!s||s.visibility!=='PUBLIC'||s.trashed_at||s.moderation_state!=='CLEAR'||!['PUBLISHED','ONGOING','PAUSED','COMPLETED'].includes(w?.status)||
      (w?.published_at&&Date.parse(w.published_at)>at))add('PUBLIC_CLEAR_WORK_REQUIRED');
    if(!s?.rating_confirmed||!s.ai_confirmed||!w?.description?.trim()||!genres.some(g=>typeof g==='string'&&g.trim()))add('REVIEWED_METADATA_REQUIRED');
    if(e.status!=='PUBLISHED'||e.is_free!==true||e.access_policy!=='FREE'||!e.title?.trim()||
      (e.scheduled_at&&Date.parse(e.scheduled_at)>at))add('PUBLISHED_FREE_EPISODE_REQUIRED');
    if(row.has_head)add('EXISTING_HEAD_PRESERVED');if(row.active_schedule)add('ACTIVE_SCHEDULE_PRESERVED');
    if(!hasAlternate||!c||!e.content?.trim()||c.text_content!==e.content)add('ALIGNED_NONEMPTY_BODY_REQUIRED');
    const seedBody=(await db.query(`select ${expression.replaceAll('ep_num','$1::int')} body`,[row.episode_number])).rows[0].body;
    if(e.content===seedBody)add('DEVELOPMENT_SEED_FORBIDDEN');
    const images=JSON.stringify(e.image_urls??[]);
    if(images!=='[]')add('NOVEL_IMAGE_REVIEW_REQUIRED');
    if(secure&&(secure.content!==e.content||JSON.stringify(secure.image_urls??[])!==images))add('SECURE_SOURCE_MISMATCH');
    if(!secure)add('P0_SECURE_SOURCE_REQUIRED');
    entries.push({episodeId:row.episode_id,workId:row.work_id,episodeNumber:row.episode_number,source,sourceDigest:sha(JSON.stringify(source)),
      eligible:reasons.length===0,reasons,hasHead:row.has_head});
  }
  return {format:'webnovels-legacy-import-packet-v1',scope:'NOVEL_FREE',projectRef:manifest.projectRef,snapshotSha256:hash,
    capturedAt:snapshot.captured_at,seedSha256:sha(seed),prerequisites:{p0Expanded:p0,publicationMigrationApplied:versions.includes('authoring-008'),bodyConflicts:conflicts},entries};
}
export function legacyImportTemplate(packet) {
  return {format:'webnovels-legacy-import-decisions-v1',snapshotSha256:packet.snapshotSha256,packetSha256:sha(JSON.stringify(packet)),cutoverEvidence:null,
    decisions:packet.entries.map(e=>({episodeId:e.episodeId,sourceDigest:e.sourceDigest,decision:'PENDING',reviewerRef:null,evidenceRef:null,rightsEvidence:null,originalPublishedAt:null}))};
}
export function validateLegacyImport(packet,input) {
  const parsed=reviewSchema.safeParse(input);if(!parsed.success)fail('INVALID_DECISIONS');const review=parsed.data;
  if(review.snapshotSha256!==packet.snapshotSha256||review.packetSha256!==sha(JSON.stringify(packet)))fail('STALE_PACKET');
  const entries=new Map(packet.entries.map(e=>[e.episodeId,e]));if(entries.size!==packet.entries.length)fail('DUPLICATE_SOURCE');
  if(review.decisions.length!==entries.size)fail('INCOMPLETE_DECISIONS');
  const seen=new Set(),selected=[];let held=0,pending=0;
  for(const d of review.decisions){
    const row=entries.get(d.episodeId);if(seen.has(d.episodeId))fail('DUPLICATE_DECISION');seen.add(d.episodeId);
    if(!row||row.sourceDigest!==d.sourceDigest)fail('STALE_SOURCE');
    if(d.decision==='PENDING'){pending++;continue;}
    if(!d.reviewerRef?.trim()||d.reviewerRef.trim().length<3||!d.evidenceRef?.trim()||d.evidenceRef.trim().length<10)fail('REVIEWER_EVIDENCE_REQUIRED');
    if(d.decision==='HOLD'){held++;continue;}
    if(!row.eligible)fail('SOURCE_NOT_ELIGIBLE');
    if(!packet.prerequisites.p0Expanded||!packet.prerequisites.publicationMigrationApplied||packet.prerequisites.bodyConflicts)fail('CUTOVER_PREREQUISITES_REQUIRED');
    if(!d.rightsEvidence||!review.cutoverEvidence||!d.originalPublishedAt)fail('RIGHTS_CUTOVER_TIME_EVIDENCE_REQUIRED');
    const time=Date.parse(d.originalPublishedAt),created=Date.parse(JSON.parse(row.source.episode).created_at);
    if(time>Date.parse(packet.capturedAt)||!Number.isFinite(created)||time<created)fail('ORIGINAL_PUBLICATION_TIME_INVALID');
    selected.push({row,decision:d});
  }
  return {selected,held,pending,cutoverEvidence:review.cutoverEvidence};
}
export async function verifyLegacyImportEvidence(directory,validated) {
  await verifyReviewEvidence(directory,{selected:validated.selected});
  if(validated.selected.length)await verifyReviewEvidence(directory,{selected:[{decision:{rightsEvidence:validated.cutoverEvidence}}]});
}
export function legacyImportSummary(packet,validated) {
  return {format:'webnovels-legacy-import-summary-v1',snapshotSha256:packet.snapshotSha256,packetSha256:sha(JSON.stringify(packet)),scope:packet.scope,
    episodes:packet.entries.length,eligibleNovelEpisodes:packet.entries.filter(e=>e.eligible).length,existingHeads:packet.entries.filter(e=>e.hasHead).length,
    reasonCounts:Object.fromEntries([...new Set(packet.entries.flatMap(e=>e.reasons))].sort().map(r=>[r,packet.entries.filter(e=>e.reasons.includes(r)).length])),
    prerequisites:packet.prerequisites,approved:validated.selected.length,held:validated.held,pending:validated.pending,
    productionApplied:false,flagsChanged:false,hostedRestoreAccepted:false,freeCutoverAccepted:false};
}
export function legacyImportSql(packet,validated,template) {
  if(!validated.selected.length)fail('NO_APPROVED_IMPORTS');
  const md5=s=>createHash('md5').update(s).digest('hex'),lit=s=>"'"+String(s).replaceAll("'","''")+"'";
  const batchId='legacy-novel-'+sha(JSON.stringify({snapshot:packet.snapshotSha256,selected:validated.selected,cutover:validated.cutoverEvidence}));
  let prelude=`create temp table legacy_import_context(batch_id text,backup_sha256 text,cutover_evidence text) on commit drop;
    insert into legacy_import_context values(${lit(batchId)},${lit(packet.snapshotSha256)},${lit(JSON.stringify(validated.cutoverEvidence))});
    create temp table legacy_import_plan(episode_id bigint primary key,version_id uuid unique,published_at timestamptz,
      episode_hash text,work_hash text,state_hash text,author_hash text,auth_hash text,identity_hash text,secure_hash text,alternate_hash text,evidence_ref text) on commit drop;`;
  for(const {row,decision} of validated.selected){
    prelude+=`insert into legacy_import_plan values(${row.episodeId},${lit(randomUUID())},${lit(decision.originalPublishedAt)},
      ${['episode','work','state','author','auth','identity','secure','alternate'].map(k=>lit(md5(row.source[k]))).join(',')},
      ${lit(JSON.stringify({reviewer:decision.reviewerRef,evidence:decision.evidenceRef,rights:decision.rightsEvidence,sourceDigest:row.sourceDigest}))});\n`;
  }
  return {batchId,sql:template.replace('begin;',`begin;\n${prelude}`)};
}
