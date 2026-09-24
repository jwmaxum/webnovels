import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const directory = path.resolve(process.argv[2] || '');
const root = path.resolve('scratch/launch/backups') + path.sep;
if (!directory.startsWith(root)) throw Error('BACKUP_DIRECTORY_REQUIRED');
const bytes = fs.readFileSync(path.join(directory,'snapshot.json'));
const manifest = JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));
if (sha(bytes) !== manifest.snapshotSha256) throw Error('BACKUP_CHECKSUM_MISMATCH');
const restore = JSON.parse(fs.readFileSync(path.join(directory,'data-restore-verification.json')));
if (!restore.allRowsMatch || restore.snapshotSha256 !== manifest.snapshotSha256) throw Error('DATA_RESTORE_VERIFICATION_REQUIRED');
const snapshot = JSON.parse(bytes);
const table = name => snapshot.tables.find(t=>t.schema==='public' && t.name===name).rows.map(row=>({ json:row, value:JSON.parse(row) }));
const seed = fs.readFileSync('database/99_seed_dev.sql','utf8');
const worksInsert = seed.match(/INSERT INTO public\.works \([\s\S]+?ON CONFLICT \(id\) DO UPDATE SET[\s\S]+?;/)?.[0];
const authorsInsert = seed.match(/INSERT INTO public\.authors \([\s\S]+?ON CONFLICT \(id\) DO UPDATE SET[\s\S]+?;/)?.[0];
const bodyExpression = seed.match(/ep_id,\s*('제 '[\s\S]+?),\s*1\s*\)\s*ON CONFLICT \(episode_id\)/)?.[1];
if (!worksInsert || !authorsInsert || !bodyExpression) throw Error('SEED_PROVENANCE_PARSE_FAILED');
const db = await PGlite.create();
try {
  // Evaluate only the two identified INSERTs and text expression in an empty local database.
  // The seed file itself is never executed against production.
  await db.exec(`create table authors(id int primary key,username text,pen_name text,status text);
    create table works(id int primary key,author_id int,title text,content_type text,genre text[],tags text[],description text,
    cover_image text,rating text,status text,is_completed boolean,is_top_recommended boolean,is_popular_work boolean,
    is_new_work boolean,ai_usage_type text,view_count int,like_count int);`);
  await db.exec(authorsInsert); await db.exec(worksInsert);
  const seedWorks = (await db.query('select * from works')).rows;
  const seedAuthors = (await db.query('select * from authors')).rows;
  const authors = table('authors');
  const owners = [], blockedOwners = [];
  for (const row of table('works').filter(r=>r.value.author_id==null)) {
    const work = row.value, reference = seedWorks.find(w=>w.id===work.id);
    const seedAuthor = seedAuthors.find(a=>a.id===reference?.author_id);
    const author = authors.find(a=>a.value.id===reference?.author_id);
    // Require explicit FK in the repository seed AND the work identity/state fields its upsert replaces.
    // Covers are presentation assets and have since changed; preserve and report that drift.
    // Never infer ownership from pen name, title, equal numeric IDs or email alone.
    const workMatches = reference && ['title','content_type','status'].every(k=>work[k]===reference[k]);
    const authorMatches = author && seedAuthor && ['id','username','pen_name','status'].every(k=>author.value[k]===seedAuthor[k]);
    if (!workMatches || !authorMatches) { blockedOwners.push({workId:work.id,reason:'SOURCE_RECORD_MISMATCH',
      workFields:['title','content_type','status'].filter(k=>work[k]!==reference?.[k]),
      authorFields:['id','username','pen_name','status'].filter(k=>author?.value[k]!==seedAuthor?.[k])}); continue; }
    owners.push({workId:work.id,authorId:reference.author_id,beforeWork:row.json,beforeAuthor:author.json,
      preservedCoverDrift:work.cover_image!==reference.cover_image,
      evidence:'database/99_seed_dev.sql: explicit works.author_id + exact work id/title/type/status + author id/username/pen_name/status; cover drift preserved',
      evidenceSha256:sha(seed)});
  }
  const bodies = [], contents=table('episode_contents');
  for (const row of table('episodes')) {
    const e=row.value, alternate=contents.find(c=>c.value.episode_id===e.id);
    if (!alternate || e.content===alternate.value.text_content) continue;
    const generated = (await db.query(`select ${bodyExpression.replaceAll('ep_num','$1::int')} body`,[e.episode_number])).rows[0].body;
    bodies.push({episodeId:e.id,workId:e.work_id,episodeNumber:e.episode_number,
      currentCharacters:(e.content||'').length,alternateCharacters:(alternate.value.text_content||'').length,
      alternateIsExactSeedText:generated===alternate.value.text_content,
      currentEmpty:!e.content?.trim(),workContentType:table('works').find(w=>w.value.id===e.work_id)?.value.content_type,
      hasLegacyImages:Array.isArray(e.image_urls)&&e.image_urls.length>0,
      currentHash:sha(e.content??''),alternateHash:sha(alternate.value.text_content??'')});
  }
  const plan={preparedAt:new Date().toISOString(),snapshotSha256:manifest.snapshotSha256,seedSha256:sha(seed),owners,blockedOwners,bodies,
    bodySelectionRequired:true,authIdentityProofRequired:true};
  const target=path.join(directory,'reconciliation-plan.json');
  // Do not replace a human-reviewed plan.
  if (fs.existsSync(target) && JSON.parse(fs.readFileSync(target)).reviewedBy) throw Error('REVIEWED_PLAN_EXISTS');
  fs.writeFileSync(target,JSON.stringify(plan,null,2),{mode:0o600});
  const report={preparedAt:plan.preparedAt,snapshotSha256:plan.snapshotSha256,seedSha256:plan.seedSha256,
    ownerCandidates:owners.length,blockedOwners,ownerMappings:owners.map(({workId,authorId})=>({workId,authorId})),
    ownerEvidence:'Explicit repository seed foreign keys + exact work id/title/type/status + author id/username/pen_name/status; cover drift preserved. Repairs seeded relationships, not Auth identity.',
    divergentBodies:bodies.length,alternateExactSeedBodies:bodies.filter(b=>b.alternateIsExactSeedText).length,
    emptyBodyByType:Object.fromEntries([...new Set(bodies.map(b=>b.workContentType))].map(t=>[t,bodies.filter(b=>b.workContentType===t&&b.currentEmpty).length])),
    emptyBodiesWithImages:bodies.filter(b=>b.currentEmpty&&b.hasLegacyImages).length,
    bodySelectionRequired:true,authIdentityProofRequired:true,productionChanged:false};
  fs.writeFileSync('artifacts/launch-reconciliation-plan.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {await db.close();}
