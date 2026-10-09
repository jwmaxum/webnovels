import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { setup,admin,reader } from './fixtures/stage17-db.mjs';
import { inspectRecoveryBundle, compareRecoveryBundles } from './lib/recovery-bundle.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const state={schemaVersion:1,schemaSha256:'a'.repeat(64),securitySha256:'b'.repeat(64),
  tables:[{name:'public.works',rows:'1',sha256:'c'.repeat(64)}],buckets:[{id:'authoring-originals',public:false}],
  references:[{bucket:'authoring-originals',object:'work/source',sha256:hash('original bytes')}]};
async function bundle({archive=Buffer.from('PGDMP synthetic test'),stateValue=state,manifest=null}={}){
  await mkdir(path.resolve('scratch/stage19'),{recursive:true});
  const directory=await mkdtemp(path.resolve('scratch/stage19/recovery-test-'));await mkdir(path.join(directory,'objects'));
  const source=Buffer.from('original bytes');await writeFile(path.join(directory,'objects/source.bin'),source);
  await writeFile(path.join(directory,'database.dump'),archive);const stateBytes=Buffer.from(JSON.stringify(stateValue));await writeFile(path.join(directory,'state.json'),stateBytes);
  const descriptor=(file,bytes)=>({file,bytes:bytes.length,sha256:hash(bytes)});
  const document=manifest||{format:'webnovels-recovery-v1',snapshotId:randomUUID(),capturedAt:'2026-10-09T00:00:00Z',kind:'SYNTHETIC',consistentSnapshotConfirmed:true,
    database:{...descriptor('database.dump',archive),format:'POSTGRES_CUSTOM'},state:descriptor('state.json',stateBytes),
    objects:[{...descriptor('objects/source.bin',source),bucket:'authoring-originals',object:'work/source'}]};
  await writeFile(path.join(directory,'manifest.json'),JSON.stringify(document));return {directory,manifest:document};
}
async function editManifest(sample,mutate){const document=JSON.parse(JSON.stringify(sample.manifest));mutate(document);await writeFile(path.join(sample.directory,'manifest.json'),JSON.stringify(document));}
test('archive plus original bytes verify, preserve unreferenced objects, and never claim hosted restore acceptance',async()=>{
  const source=await bundle(),target=await bundle({manifest:source.manifest});
  for(const sample of [source,target]){
    await writeFile(path.join(sample.directory,'objects/unreferenced.bin'),Buffer.alloc(0));
    await editManifest(sample,m=>m.objects.push({file:'objects/unreferenced.bin',bytes:0,sha256:hash(Buffer.alloc(0)),bucket:'authoring-originals',object:'unreferenced/empty'}));
  }
  const report=await compareRecoveryBundles(source.directory,target.directory);assert.equal(report.byteHashesMatched,true);assert.equal(report.hostedRestoreAccepted,false);
  assert.equal(report.objects,2);assert.equal(report.kind,'SYNTHETIC');
  await assert.rejects(compareRecoveryBundles(source.directory,source.directory),/RECOVERY_TARGET_NOT_ISOLATED/);
});
test('a valid DB archive cannot conceal missing, changed or truncated Storage bytes',async()=>{
  for(const mode of ['hash','size','missing']){
    const sample=await bundle();if(mode==='hash')await writeFile(path.join(sample.directory,'objects/source.bin'),'different byte');
    if(mode==='size')await writeFile(path.join(sample.directory,'objects/source.bin'),'short');
    if(mode==='missing')await editManifest(sample,m=>m.objects[0].file='objects/not-present.bin');
    await assert.rejects(inspectRecoveryBundle(sample.directory));
  }
});
test('escaping paths, duplicate references/files, public private bucket and false snapshot are rejected',async()=>{
  for(const mutate of [m=>m.objects[0].file='../.env.local',m=>m.objects[0].file='objects\\source.bin',
    m=>m.objects.push({...m.objects[0]}),m=>m.objects[0].file=m.state.file,m=>m.consistentSnapshotConfirmed=false,
    m=>{m.kind='HOSTED_BACKUP';m.database.format='PGLITE_DATA_DIR';}]){
    const sample=await bundle();await editManifest(sample,mutate);await assert.rejects(inspectRecoveryBundle(sample.directory),/RECOVERY_/);
  }
  const invalid=structuredClone(state);invalid.buckets[0].public=true;await assert.rejects(inspectRecoveryBundle((await bundle({stateValue:invalid})).directory),/RECOVERY_PRIVATE_BUCKET_PUBLIC/);
  const missing=structuredClone(state);missing.references[0].object='missing';await assert.rejects(inspectRecoveryBundle((await bundle({stateValue:missing})).directory),/RECOVERY_REFERENCE_MISSING/);
  const duplicate=structuredClone(state);duplicate.references.push({...duplicate.references[0]});await assert.rejects(inspectRecoveryBundle((await bundle({stateValue:duplicate})).directory),/RECOVERY_DUPLICATE_REFERENCE/);
  await assert.rejects(inspectRecoveryBundle((await bundle({archive:Buffer.from('invalid archive')})).directory),/RECOVERY_ARCHIVE_FORMAT_MISMATCH/);
});
test('individually valid packages reject different restored rows, security fingerprints, snapshots or object inventory',async()=>{
  const source=await bundle();
  for(const change of [s=>s.tables[0].rows='2',s=>s.securitySha256='d'.repeat(64),s=>s.schemaSha256='e'.repeat(64)]){
    const changed=structuredClone(state);change(changed);
    const target=await bundle({stateValue:changed});await editManifest(target,m=>{m.snapshotId=source.manifest.snapshotId;});
    await assert.rejects(compareRecoveryBundles(source.directory,target.directory),/RECOVERY_DATABASE_STATE_MISMATCH/);
  }
  const reduced=structuredClone(state);reduced.references=[];
  const target=await bundle({stateValue:reduced});await editManifest(target,m=>{m.snapshotId=source.manifest.snapshotId;m.objects=[];});
  await assert.rejects(compareRecoveryBundles(source.directory,target.directory),/RECOVERY_OBJECT_INVENTORY_MISMATCH/);
  const other=await bundle();await assert.rejects(compareRecoveryBundles(source.directory,other.directory),/RECOVERY_SNAPSHOT_MISMATCH/);
});
test('symlinked archive paths are refused instead of reading files outside the bundle',async()=>{
  const sample=await bundle(),external=await bundle();
  try{await symlink(path.join(external.directory,'objects'),path.join(sample.directory,'linked'),'junction');}catch(error){if(!['EPERM','EACCES'].includes(error.code))throw error;return;}
  await editManifest(sample,m=>m.objects[0].file='linked/source.bin');await assert.rejects(inspectRecoveryBundle(sample.directory),/RECOVERY_LINK_FORBIDDEN/);
});
test('full synthetic database data-directory restore retains draft revision, RPC ownership and private role denial',async()=>{
  const {db}=await setup();let restored;
  try{
    await db.exec(await readFile('database/authoring/015_webtoon.sql','utf8'));
    const id=randomUUID(),key=randomUUID();
    const saved=(await db.query('select public.creator_drafts($1,$2,$3,$4,$5,$6) result',[admin,'save','10',id,JSON.stringify({title:'복원할 원고',content:'한글 원고\n줄바꿈',authorComment:'원고 보존',expectedRevision:'0'}),key])).rows[0].result;
    assert.ok(saved.draft);const before=(await db.query('select to_jsonb(d) snapshot from authoring.drafts d where id=$1',[id])).rows;
    const image=await db.dumpDataDir();restored=await PGlite.create({loadDataDir:image});
    assert.deepEqual((await restored.query('select to_jsonb(d) snapshot from authoring.drafts d where id=$1',[id])).rows,before);
    const own=(await restored.query('select public.creator_drafts($1,$2,$3,$4,$5,$6) result',[admin,'get','10',id,'{}',null])).rows[0].result;
    assert.equal(own.draft.content,'한글 원고\n줄바꿈');
    const foreign=(await restored.query('select public.creator_drafts($1,$2,$3,$4,$5,$6) result',[reader,'get','10',id,'{}',null])).rows[0].result;assert.equal(foreign.status,404);
    for(const role of ['anon','authenticated']){await restored.exec('set role '+role);await assert.rejects(restored.query('select * from authoring.drafts'));await assert.rejects(restored.query('select * from authoring.webtoon_assets'));await restored.exec('reset role');}
    assert.equal((await restored.query("select public from storage.buckets where id='authoring-webtoons'")).rows[0].public,false);
  }finally{await restored?.close();await db.close();}
});
