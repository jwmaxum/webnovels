import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { restoreSnapshot } from './verify_launch_backup.mjs';
import access from './lib/launch-access.cjs';
import backup from './backup_launch_data.cjs';
const sha = s=>crypto.createHash('sha256').update(s).digest('hex');
const md5 = s=>crypto.createHash('md5').update(s).digest('hex');
const lit = s=>"'"+String(s).replaceAll("'","''")+"'";
const args=process.argv.slice(2),directory=path.resolve(args[0]||'');
async function main(){
  if(!directory.startsWith(path.resolve('scratch/launch/backups')+path.sep))throw Error('REPAIR_BACKUP_DIRECTORY_REQUIRED');
  if(!args.includes('--keep-existing-nonempty'))throw Error('REPAIR_EXPLICIT_BODY_SELECTION_REQUIRED');
  const bytes=fs.readFileSync(path.join(directory,'snapshot.json')),snapshot=JSON.parse(bytes);
  const plan=JSON.parse(fs.readFileSync(path.join(directory,'reconciliation-plan.json')));
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));
  const restored=JSON.parse(fs.readFileSync(path.join(directory,'data-restore-verification.json')));
  if(sha(bytes)!==plan.snapshotSha256 || sha(bytes)!==manifest.snapshotSha256 || sha(bytes)!==restored.snapshotSha256 || !restored.allRowsMatch)
    throw Error('REPAIR_BACKUP_VERIFICATION_REQUIRED');
  if(plan.seedSha256!==sha(fs.readFileSync('database/99_seed_dev.sql','utf8')))throw Error('REPAIR_SEED_CHANGED');
  const getTable=name=>snapshot.tables.find(t=>t.schema==='public'&&t.name===name).rows;
  const find=(name,id,key='id')=>getTable(name).find(r=>String(JSON.parse(r)[key])===String(id));
  const owners=args.includes('--repair-seed-owners')?plan.owners:[];
  const bodies=plan.bodies.filter(b=>!b.currentEmpty&&b.alternateIsExactSeedText);
  if(!owners.length&&!bodies.length)throw Error('REPAIR_NO_VERIFIED_TARGETS');
  const batchId='launch-'+sha(bytes).slice(0,16)+'-keep-existing-v1';
  let prelude=`create temp table launch_context(batch_id text,backup_sha256 text,evidence_ref text) on commit drop;
    insert into launch_context values(${lit(batchId)},${lit(sha(bytes))},'User selection 2026-09-25: preserve existing work-specific manuscripts; hold empty bodies');
    create temp table launch_owner_plan(work_id bigint primary key,author_id bigint,work_hash text,author_hash text,evidence_ref text) on commit drop;
    create temp table launch_body_plan(episode_id bigint primary key,episode_hash text,content_hash text) on commit drop;`;
  for(const o of owners){
    if(o.beforeWork!==find('works',o.workId)||o.beforeAuthor!==find('authors',o.authorId))throw Error('REPAIR_OWNER_PLAN_MISMATCH');
    prelude+=`insert into launch_owner_plan values(${Number(o.workId)},${Number(o.authorId)},${lit(md5(o.beforeWork))},${lit(md5(o.beforeAuthor))},${lit(o.evidence+'; sha256='+o.evidenceSha256)});`;
  }
  for(const b of bodies)prelude+=`insert into launch_body_plan values(${Number(b.episodeId)},${lit(md5(find('episodes',b.episodeId)))},${lit(md5(find('episode_contents',b.episodeId,'episode_id')))});`;
  const sql=fs.readFileSync('database/launch/001_reconcile_legacy_data.sql','utf8').replace('begin;','begin;\n'+prelude);
  const sqlSha256=sha(sql),reportPath=path.join(directory,'reconciliation-rehearsal.json');
  fs.writeFileSync(path.join(directory,'reconcile-reviewed.sql'),sql,{mode:0o600});
  if(!args.includes('--apply')){
    const {db}=await restoreSnapshot(snapshot);
    try{
      await db.exec('create role anon;create role authenticated;create role service_role');
      await db.exec(sql);
      const untouched=snapshot.tables.filter(t=>t.schema!=='public'||!['works','episode_contents'].includes(t.name));
      for(const t of untouched){
        const rows=(await db.query(`select to_jsonb(r)::text row from ${backup.quote(t.schema)}.${backup.quote(t.name)} r`)).rows.map(r=>r.row).sort();
        if(JSON.stringify(rows)!==JSON.stringify([...t.rows].sort()))throw Error('REPAIR_UNEXPECTED_TABLE_CHANGE');
      }
      // Untargeted works and bodies, including every empty/image body, must remain byte-for-byte equal.
      for(const [name,ids,key] of [['works',owners.map(o=>o.workId),'id'],['episode_contents',bodies.map(b=>b.episodeId),'episode_id']]){
        const actual=(await db.query(`select to_jsonb(r)::text row from public.${name} r`)).rows.map(r=>r.row);
        const expected=getTable(name).filter(r=>!ids.includes(JSON.parse(r)[key])).sort();
        if(JSON.stringify(actual.filter(r=>!ids.includes(JSON.parse(r)[key])).sort())!==JSON.stringify(expected))throw Error('REPAIR_UNEXPECTED_UNSELECTED_CHANGE');
      }
      const counts=(await db.query(`select count(*) filter(where entity_kind='owner')::int owners,count(*) filter(where entity_kind='body')::int bodies from launch_recovery.reconciliation_history`)).rows[0];
      if(counts.owners!==owners.length||counts.bodies!==bodies.length)throw Error('REPAIR_AUDIT_COUNT_MISMATCH');
      await db.exec('set role anon');
      let denied=false;try{await db.query('select * from launch_recovery.reconciliation_history')}catch(e){denied=e.code==='42501'}
      await db.exec('reset role');if(!denied)throw Error('REPAIR_PRIVATE_ARCHIVE_EXPOSED');
      let immutable=false;try{await db.exec('delete from launch_recovery.reconciliation_history')}catch{immutable=true}
      if(!immutable)throw Error('REPAIR_ARCHIVE_MUTABLE');
      let replayRejected=false;try{await db.exec(sql)}catch{replayRejected=true;await db.exec('rollback')}
      if(!replayRejected)throw Error('REPAIR_STALE_PLAN_ACCEPTED');
      const report={verifiedAt:new Date().toISOString(),batchId,snapshotSha256:sha(bytes),sqlSha256,
        owners:owners.length,bodies:bodies.length,emptyBodiesHeld:plan.bodies.filter(b=>b.currentEmpty).length,
        untouchedTablesVerified:untouched.length,untargetedRowsPreserved:true,privateArchive:true,immutableArchive:true,
        stalePlanRejected:true,actualProductionDataInIsolatedPGlite:true,productionApplied:false};
      fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
      fs.writeFileSync('artifacts/launch-reconciliation-rehearsal.json',JSON.stringify(report,null,2)+'\n');
      console.log(JSON.stringify(report,null,2));
    }finally{await db.close()}
    return;
  }
  const rehearsal=JSON.parse(fs.readFileSync(reportPath));
  if(rehearsal.sqlSha256!==sqlSha256||rehearsal.snapshotSha256!==sha(bytes))throw Error('REPAIR_REHEARSAL_REQUIRED');
  const env=access.loadEnv(),{ref}=access.connection(env);
  if(ref!==manifest.projectRef)throw Error('REPAIR_PROJECT_MISMATCH');
  const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',
    headers:{Authorization:'Bearer '+access.managementToken(env),'Content-Type':'application/json'},
    body:JSON.stringify({query:sql,read_only:false}),redirect:'error',signal:AbortSignal.timeout(90000)});
  if(!r.ok){fs.writeFileSync(path.join(directory,'apply-error-private.txt'),await r.text(),{mode:0o600});throw Error('REPAIR_APPLY_HTTP_'+r.status)}
  const verification=await backup.query(`select
    (select count(*) from public.works w left join public.authors a on a.id=w.author_id where a.id is null)::int orphan_works,
    (select count(*) from public.episodes e join public.episode_contents c on c.episode_id=e.id where e.content is distinct from c.text_content)::int remaining_body_conflicts,
    (select count(*) from launch_recovery.reconciliation_history where batch_id=${lit(batchId)} and entity_kind='owner')::int owner_repairs,
    (select count(*) from launch_recovery.reconciliation_history where batch_id=${lit(batchId)} and entity_kind='body')::int body_repairs`);
  const report={...rehearsal,appliedAt:new Date().toISOString(),productionApplied:true,projectRef:ref,verification:verification[0]};
  fs.writeFileSync(path.join(directory,'reconciliation-applied.json'),JSON.stringify(report,null,2)+'\n');
  fs.writeFileSync('artifacts/launch-reconciliation-applied.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(/^REPAIR_/.test(error.message)?error.message:'REPAIR_FAILED_DETAILS_WITHHELD_CHECK_DATABASE_BEFORE_RETRY');process.exitCode=1});
