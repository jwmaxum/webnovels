import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,symlink} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {CUTOVER_SQL,CUTOVER_STAGES,validateCutoverManifest,cutoverMigrationPlan,readCutoverFile,
 verifyCutoverFiles,evaluateCutoverJournal} from './lib/cutover-package.mjs';
import {sha,decisionTemplate,validateContentDecisions,contentSelectionSql} from './lib/launch-content-review.mjs';
import {legacyImportTemplate,validateLegacyImport,legacyImportSql} from './lib/legacy-publication-import.mjs';
import {BETA_GATES} from './lib/beta-evidence.mjs';
import backupScope from './lib/launch-backup-scope.cjs';
import {candidateSqlBytes,checkCutoverPackage,appendCutoverRecord} from './prepare_cutover_package.mjs';
const now=Date.parse('2026-10-09T12:00:00Z'),json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const fingerprint=rows=>createHash('md5').update(rows.join('')).digest('hex');
function fixture(options={}){
 const files=new Map(),records=[],candidate=options.candidate||'a'.repeat(40),origin='https://staging.example.test',scope=options.scope||'NOVEL_FREE';
 const sourceRef='a'.repeat(20),targetRef='b'.repeat(20);
 const put=(file,bytes)=>{bytes=Buffer.isBuffer(bytes)?bytes:json(bytes);files.set(file,bytes);return {file,bytes:bytes.length,sha256:sha(bytes)}};
 const initialVersions=['authoring-001','authoring-003','authoring-004','authoring-005','authoring-006'];
 let snapshotTables=['public.episodes','public.episode_contents','public.works','public.authors','auth.users','authoring.identity_evidence',
  'storage.buckets','storage.objects','authoring.publication_heads','authoring.publication_versions','growth.publication_activity',
  'launch_recovery.legacy_publication_imports','public.p0_migration_status'].map(name=>({schema:name.split('.')[0],name:name.split('.')[1],rows:[]}));
 snapshotTables.push({schema:'authoring',name:'migrations',rows:initialVersions.map(version=>JSON.stringify({version}))});
 if(options.ledger)snapshotTables.push({schema:'public',name:'ledger_probe',rows:['{"id":1,"amount":0.123456789012345678901}']});
 const episodeId='9007199254740993',versionId='33333333-3333-4333-8333-333333333333',publishedAt='2026-10-08T00:00:00Z';
 if(options.selected){
  const add=(name,row)=>snapshotTables.find(t=>t.schema+'.'+t.name===name).rows.push(JSON.stringify(row));
  add('public.episodes',{id:episodeId,work_id:'21',title:'원작 회차',author_comment:null,content:'원작',image_urls:null,created_at:'2026-01-01T00:00:00Z'});
  add('public.episode_contents',{episode_id:episodeId,text_content:'대체 원작',content_version:1,updated_at:'2026-01-01T00:00:00Z'});
 }
 const capture=(captured_at,stage)=>{
  if(options.selected&&stage==='CONTENT')snapshotTables.find(t=>t.name==='episode_contents').rows=[JSON.stringify({episode_id:episodeId,text_content:'원작',content_version:2,updated_at:captured_at})];
  if(options.selected&&stage==='IMPORT')for(const [name,row] of [
   ['authoring.publication_heads',{episode_id:episodeId,version_id:versionId,published_at:publishedAt}],
   ['authoring.publication_versions',{id:versionId,episode_id:episodeId,work_id:'21',title:'원작 회차',author_comment:'',image_urls:[],content:'원작',source_draft_id:null,source_revision:null}],
   ['growth.publication_activity',{version_id:versionId,work_id:'21',episode_id:episodeId,kind:'BASELINE',created_at:publishedAt}],
   ['launch_recovery.legacy_publication_imports',{episode_id:episodeId,version_id:versionId}]
  ])snapshotTables.find(t=>t.schema+'.'+t.name===name).rows=[JSON.stringify(row)];
  if(stage==='MIGRATIONS'){
   snapshotTables.find(t=>t.name==='migrations').rows=CUTOVER_SQL.filter(s=>s.id.startsWith('authoring-')).map(s=>JSON.stringify({version:s.id}));
   snapshotTables.find(t=>t.name==='p0_migration_status').rows=[JSON.stringify({version:'p0-20260921',phase:'expanded',applied_at:captured_at})];
   snapshotTables.find(t=>t.schema==='storage'&&t.name==='buckets').rows=['authoring-originals','authoring-covers'].map(id=>JSON.stringify({id,public:false}));
   snapshotTables.push({schema:'public',name:'secure_episode_contents',rows:options.selected?[JSON.stringify({episode_id:episodeId,content:'원작',image_urls:null})]:[]});
  }
  if(stage==='LOCKDOWN')snapshotTables.find(t=>t.name==='p0_migration_status').rows=[JSON.stringify({version:'p0-20260921',phase:'locked',applied_at:captured_at})];
  const tables=snapshotTables.map(t=>({...t,rows:[...t.rows],row_count:String(t.rows.length),fingerprint:fingerprint(t.rows)}));
  const columns=tables.flatMap(t=>(t.rows.length?Object.keys(JSON.parse(t.rows[0])):t.name==='migrations'?['version']:t.name==='p0_migration_status'?['version','phase']:['id']).map(name=>({schema:t.schema,table:t.name,name})));
  return {format:'webnovels-logical-data-v1',captured_at,tables,columns,database_version:'synthetic PostgreSQL 17',requested_schemas:backupScope.schemas,
   enums:[],views:[],indexes:[],policies:[],triggers:[],functions:[],sequences:[],column_acl:[],constraints:[],relation_security:[]};
 };
 const initial=put('source/logical-snapshot.json',capture('2026-10-09T00:00:00Z'));
 const archive=put('source/native-archive.dump',Buffer.from('PGDMP synthetic test fixture'));
 const m={format:'webnovels-cutover-package-v1',candidate,origin,scope,sourceRef,targetRef,preparedAt:'2026-10-09T00:00:00Z',
  initialSnapshotSha256:initial.sha256,nativeArchiveSha256:archive.sha256,independentSnapshotTimes:true,combinedConsistentSnapshotConfirmed:false,
  sourceFiles:[initial,archive],initialVersions,p0Expanded:false,
  sql:CUTOVER_SQL.map(s=>({id:s.id,...put('sql/'+s.id+'.sql',options.sql?.get(s.id)||Buffer.from('begin;\n-- '+s.id+'\ncommit;\n'))}))};
 const manifestBytes=json(m);let predecessor=sha(manifestBytes),snapshot=initial.sha256;
 for(const [index,stage] of CUTOVER_STAGES.entries()){
  const observedAt=`2026-10-09T00:${String((index+1)*5).padStart(2,'0')}:00Z`;
  const result=stage==='BETA'?null:put(`proofs/${stage}-snapshot.json`,capture(observedAt,stage));
  const r={format:'webnovels-cutover-step-v1',stage,candidate,origin,scope,sourceRef,targetRef,status:'PASS',
   kind:stage==='RESTORE'?'HOSTED_RESTORE':stage==='BETA'?'HOSTED_API':'HOSTED_SQL',observedAt,
   previousRecordSha256:predecessor,beforeSnapshotSha256:snapshot,afterSnapshotSha256:result?.sha256||snapshot,resultSnapshot:result};
  const context={format:'webnovels-cutover-proof-v1',stage,kind:r.kind,candidate,origin,scope,sourceRef,targetRef,
   beforeSnapshotSha256:snapshot,afterSnapshotSha256:r.afterSnapshotSha256};
  const sql=id=>({id,sha256:m.sql.find(s=>s.id===id).sha256});let proof;
  if(stage==='RESTORE')proof={...context,nativeArchiveSha256:archive.sha256,dataFingerprintsMatched:true,schemaSecurityMatched:true,
   authStorageAccepted:true,externalEffectsIsolated:true,independentSnapshotReconciled:true};
  if(stage==='CONTENT'||stage==='IMPORT'){
   const packet=stage==='CONTENT'?{format:'webnovels-content-packet-v1',projectRef:targetRef,snapshotSha256:snapshot,entries:[]}:
    {format:'webnovels-legacy-import-packet-v1',scope:'NOVEL_FREE',projectRef:targetRef,snapshotSha256:snapshot,capturedAt:observedAt,
     prerequisites:{p0Expanded:true,publicationMigrationApplied:true,bodyConflicts:0},entries:[]};
   if(options.selected){
    const before=JSON.parse(files.get(index===1?'proofs/RESTORE-snapshot.json':'proofs/MIGRATIONS-snapshot.json'));
    const source={episode:before.tables.find(t=>t.name==='episodes').rows[0],content:before.tables.find(t=>t.name==='episode_contents').rows[0],
     work:'{}',author:'{}',auth:'{}',identity:'{}',state:'{}',secure:'{}',alternate:'{}'};
    packet.entries.push({episodeId,sourceDigest:sha(JSON.stringify(source)),source,eligible:true,authMappingVerified:true,authorId:'11',
     authUserId:'11111111-1111-4111-8111-111111111111',contentType:'NOVEL',currentIsSeed:false,alternateIsSeed:false,
     episodesSourceSha256:sha(JSON.stringify('원작')),episodeContentsSourceSha256:sha(JSON.stringify('대체 원작'))});
   }
   const decisions=stage==='CONTENT'?decisionTemplate(packet):legacyImportTemplate(packet);
   let generated=null;
   if(options.selected){
    const rights=put('proofs/rights.txt',Buffer.from('synthetic rights input'));
    Object.assign(decisions.decisions[0],{decision:stage==='CONTENT'?'USE_EPISODES':'IMPORT',reviewerRef:'synthetic-reviewer',
     evidenceRef:'synthetic-contract-fixture',rightsEvidence:rights});
    if(stage==='CONTENT')decisions.decisions[0].selectedSourceSha256=packet.entries[0].episodesSourceSha256;
    else{decisions.cutoverEvidence=rights;decisions.decisions[0].originalPublishedAt=publishedAt}
    const template=files.get('sql/'+(stage==='CONTENT'?'content-selection':'legacy-import')+'.sql').toString();
    generated=stage==='CONTENT'?contentSelectionSql(packet,validateContentDecisions(packet,decisions),template):
     legacyImportSql(packet,validateLegacyImport(packet,decisions),template,{versionIds:[versionId]});
   }
   const inputs={packet:put(`proofs/${stage}-packet.json`,packet),decisions:put(`proofs/${stage}-decisions.json`,decisions),
    executedSql:generated?put(`proofs/${stage}-executed.sql`,Buffer.from(generated.sql)):null};
   proof=stage==='CONTENT'?{...context,...inputs,bodyConflicts:0,unresolvedDecisions:0,originalRightsReviewed:true,
    nonSelectedRowsPreserved:true,privateHistoryImmutable:true,reviewSnapshotSha256:snapshot,sql:sql('content-selection')}:
    {...context,...inputs,packetSnapshotSha256:snapshot,eligibleLegacyNovels:options.selected?1:0,importedHeads:options.selected?1:0,pendingImports:0,
     sourceRowsPreserved:true,existingHeadsPreserved:true,privateHistoryImmutable:true,growthBaselineOnly:true,
     webtoonAssetAcceptance:scope==='NOVEL_WEBTOON_FREE',sql:sql('legacy-import'),versionIds:options.selected?[versionId]:[]};
  }
  if(stage==='MIGRATIONS')proof={...context,versions:CUTOVER_SQL.filter(s=>s.id.startsWith('authoring-')).map(s=>s.id),
   appliedSql:cutoverMigrationPlan(m).filter(s=>s.action==='REVIEW_AND_APPLY').map(s=>sql(s.id)),bodyConflicts:0,
   sourceRowsPreserved:true,schemaAccepted:true,privateBucketsAccepted:true};
  if(stage==='LOCKDOWN')proof={...context,phase:'locked',legacyDirectAccessDenied:true,crossRoleAccepted:true,freeRpcAccepted:true,sql:sql('p0-lockdown')};
  if(stage==='BETA')proof={schemaVersion:1,candidate,origin,scope,p0Open:0,participants:{novelAuthors:5,readers:30,webtoonAuthors:3},
   operations:{ownerConfirmed:true,supportConfirmed:true,supportHoursConfirmed:true,stopCriteriaConfirmed:true},
   evidence:BETA_GATES.filter(g=>scope!=='NOVEL_FREE'||!g.webtoon).map(g=>({gate:g.id,status:'PASS',kind:g.kinds[0],candidate,origin,
    observedAt,proof:{file:'scratch/launch/evidence/'+g.id+'.json',sha256:'c'.repeat(64)}}))};
  r.proof=put(`proofs/${stage}-proof.json`,proof);const bytes=json(r);records.push({bytes});predecessor=sha(bytes);snapshot=r.afterSnapshotSha256;
 }
 const mutateRecord=(index,fn)=>{const r=JSON.parse(records[index].bytes);fn(r);records[index].bytes=json(r)};
 const mutateProof=(index,fn)=>mutateRecord(index,r=>{const p=JSON.parse(files.get(r.proof.file));fn(p);r.proof=put(r.proof.file,p)});
 return {m,files,records,put,manifestBytes,mutateRecord,mutateProof};
}
const evaluate=(f,records=f.records,overrides={})=>evaluateCutoverJournal(f.m,records,{manifestSha256:sha(f.manifestBytes),now,
 readProof:d=>f.files.get(d.file),verifyBetaProof:async()=>true,...overrides});
const blocked=async(f,code)=>assert.ok((await evaluate(f)).blockers.includes(code));
test('fixed free SQL plan includes missing Storage 002 before files 007 and excludes commerce/seed',()=>{
 const f=fixture(),plan=cutoverMigrationPlan(validateCutoverManifest(f.m));
 assert.equal(plan.find(s=>s.id==='authoring-002').action,'REVIEW_AND_APPLY');
 assert.deepEqual(plan.find(s=>s.id==='authoring-007').requires,['authoring-006','authoring-002']);
 assert.equal(plan.find(s=>s.id==='authoring-001').action,'VERIFY_EXISTING');
 assert.ok(plan.every(s=>s.executionAllowed===false));assert.ok(CUTOVER_SQL.every(s=>!s.path.includes('016')&&!s.path.includes('seed')));
 f.m.p0Expanded=true;assert.equal(cutoverMigrationPlan(f.m)[0].action,'VERIFY_EXISTING');
 const audit=spawnSync(process.execPath,['-e',"const fs=require('fs');if(!fs.readFileSync('scripts/audit_stage22_launch.cjs','utf8').includes(\"'001','002','003'\"))process.exit(1)"],{encoding:'utf8'});
 assert.equal(audit.status,0);
});
test('manifest rejects credentials, production target, unknown versions, arbitrary SQL and unsafe source paths',()=>{
 for(const mutate of [m=>m.origin='https://user:private@staging.example.test',m=>m.origin='https://localhost',m=>m.candidate='--private',
  m=>m.targetRef=m.sourceRef,m=>m.initialVersions.push('authoring-016'),m=>m.initialVersions.push(m.initialVersions[0]),
  m=>m.sql[0].id='seed',m=>m.sql.reverse(),m=>m.sql[0].file='../.env.local',m=>m.sourceFiles[0].file='source/../.env.local',
  m=>m.sourceFiles[1].file=m.sourceFiles[0].file,m=>m.initialSnapshotSha256='f'.repeat(64),m=>m.token='private-value']){
  const f=fixture();mutate(f.m);assert.throws(()=>validateCutoverManifest(f.m),/^Error: CUTOVER_[A-Z_]+$/);
 }
});
test('missing isolated target is blocked; empty journal only prepares the next review',async()=>{
 const f=fixture();assert.equal((await evaluate(f,[])).status,'READY_FOR_NEXT_REVIEW');f.m.targetRef=null;
 const r=await evaluate(f,[]);assert.equal(r.status,'BLOCKED');assert.deepEqual(r.blockers,['ISOLATED_TARGET_NOT_CONFIGURED']);
 assert.equal(r.activationAllowed,false);assert.equal(r.hostedRestoreAccepted,false);
});
test('complete synthetic contract fixtures link distinct snapshots and await human review without executing',async()=>{
 const f=fixture(),r=await evaluate(f);assert.equal(r.status,'READY_FOR_HUMAN_APPROVAL');assert.equal(r.completedSteps,6);assert.equal(r.nextStep,null);
 for(const key of ['activationAllowed','sqlExecuted','flagsChanged','hostedRestoreAccepted'])assert.equal(r[key],false);
 assert.equal((await evaluate(f,f.records.slice(0,3))).nextStep,'IMPORT');
});
test('record byte hashes, strict sequence and before-state prevent skips or stale snapshot reuse',async()=>{
 for(const mutate of [f=>f.records.shift(),f=>f.mutateRecord(1,r=>r.previousRecordSha256='d'.repeat(64)),
  f=>f.mutateRecord(1,r=>r.beforeSnapshotSha256=f.m.initialSnapshotSha256),f=>f.mutateRecord(0,r=>r.stage='CONTENT')]){
  const f=fixture();mutate(f);await blocked(f,'STEP_LINEAGE_MISMATCH');
 }
 const f=fixture();f.records[0].bytes=Buffer.from(' '+f.records[0].bytes);await blocked(f,'STEP_LINEAGE_MISMATCH');
});
test('candidate/environment/scope/target mismatches and pending or synthetic status never pass a hosted stage',async()=>{
 for(const key of ['candidate','origin','scope','sourceRef','targetRef']){
  const f=fixture();f.mutateRecord(0,r=>r[key]=key==='candidate'?'d'.repeat(40):key==='origin'?'https://other.example.test':
   key==='scope'?'NOVEL_WEBTOON_FREE':'d'.repeat(20));await blocked(f,'STEP_CONTEXT_MISMATCH');
 }
 for(const status of ['PENDING','HOLD','FAIL']){const f=fixture();f.mutateRecord(0,r=>r.status=status);await blocked(f,'STEP_NOT_PASSED')}
 for(const kind of ['LOCAL_UNIT','SYNTHETIC_RESTORE']){const f=fixture();f.mutateRecord(0,r=>r.kind=kind);await blocked(f,'HOSTED_STEP_EVIDENCE_REQUIRED')}
});
test('future, stale and backwards observations plus malformed journals stay blocked',async()=>{
 for(const time of ['2026-10-10T00:00:00Z','2026-09-01T00:00:00Z']){const f=fixture();f.mutateRecord(0,r=>r.observedAt=time);await blocked(f,'STEP_EVIDENCE_STALE')}
 const f=fixture();f.m.preparedAt='2026-10-10T00:00:00Z';await blocked(f,'PACKAGE_TIME_INVALID');
 assert.ok((await evaluate(f,[],{manifestSha256:'bad'})).blockers.includes('INVALID_JOURNAL'));
 f.records[0].bytes=Buffer.from('{}');f.m.preparedAt='2026-10-09T00:00:00Z';await blocked(f,'INVALID_STEP_RECORD');
 f.records[0].bytes=Buffer.from('private invalid JSON');await blocked(f,'INVALID_STEP_RECORD');
});
test('result snapshot bytes and capture times are verified separately from source and hosted proof',async()=>{
 for(const mutate of [f=>f.mutateRecord(0,r=>r.afterSnapshotSha256=r.beforeSnapshotSha256),
  f=>f.mutateRecord(0,r=>r.resultSnapshot=null),f=>f.mutateRecord(0,r=>r.resultSnapshot.sha256='d'.repeat(64))]){
  const f=fixture();mutate(f);assert.equal((await evaluate(f)).status,'BLOCKED');
 }
 const f=fixture();f.files.set('proofs/RESTORE-snapshot.json',Buffer.from('{}'));await blocked(f,'RESULT_SNAPSHOT_UNVERIFIED');
 const g=fixture();g.mutateRecord(0,r=>r.resultSnapshot=g.put(r.resultSnapshot.file,{captured_at:'2026-10-10T00:00:00Z',tables:[{}]}));
 g.mutateRecord(0,r=>r.afterSnapshotSha256=r.resultSnapshot.sha256);await blocked(g,'RESULT_SNAPSHOT_UNVERIFIED');
});
test('proof bytes, archive identity and stage/context attestations fail safely',async()=>{
 const f=fixture();f.files.set('proofs/RESTORE-proof.json',Buffer.from('private-secret'));await blocked(f,'STEP_PROOF_UNVERIFIED');
 const g=fixture();g.mutateProof(0,p=>p.nativeArchiveSha256='d'.repeat(64));await blocked(g,'RESTORED_ARCHIVE_MISMATCH');
 const h=fixture();h.mutateProof(0,p=>p.targetRef='d'.repeat(20));await blocked(h,'STAGE_PROOF_CONTEXT_MISMATCH');
 const i=fixture();i.mutateProof(0,p=>p.externalEffectsIsolated=false);await blocked(i,'INVALID_STAGE_PROOF');
});
test('CONTENT requires current target review packet, rights decisions and exact execution-input bytes',async()=>{
 for(const mutate of [p=>p.bodyConflicts=1,p=>p.unresolvedDecisions=1,p=>p.sql.sha256='d'.repeat(64),p=>p.reviewSnapshotSha256='d'.repeat(64)]){
  const f=fixture();f.mutateProof(1,mutate);await blocked(f,'ORIGINAL_REVIEW_INCOMPLETE');
 }
 const f=fixture();f.mutateProof(1,p=>p.executedSql=f.put('proofs/CONTENT-executed.sql',Buffer.from('DROP TABLE public.episodes;')));await blocked(f,'EXECUTION_INPUT_UNVERIFIED');
 const g=fixture();g.mutateProof(1,p=>p.packet=g.put(p.packet.file,{snapshotSha256:g.m.initialSnapshotSha256,entries:[]}));await blocked(g,'EXECUTION_INPUT_UNVERIFIED');
 const h=fixture();h.mutateProof(1,p=>p.originalRightsReviewed=false);await blocked(h,'INVALID_STAGE_PROOF');
});
test('migration review requires all markers including 002 and the ordered missing candidate SQL hashes',async()=>{
 for(const mutate of [p=>p.versions=p.versions.filter(v=>v!=='authoring-002'),p=>p.versions.push(p.versions[0]),
  p=>p.appliedSql.reverse(),p=>p.appliedSql[0].sha256='d'.repeat(64),p=>p.bodyConflicts=1,p=>p.appliedSql.pop()]){
  const f=fixture();f.mutateProof(2,mutate);await blocked(f,'MIGRATION_REVIEW_INCOMPLETE');
 }
});
test('publication import binds post-migration packet, counts and preserves existing heads',async()=>{
 for(const mutate of [p=>p.packetSnapshotSha256='d'.repeat(64),p=>p.pendingImports=1,p=>p.sql.id='content-selection']){
  const f=fixture();f.mutateProof(3,mutate);await blocked(f,'PUBLICATION_IMPORT_INCOMPLETE');
 }
 const f=fixture();f.mutateProof(3,p=>p.existingHeadsPreserved=false);await blocked(f,'INVALID_STAGE_PROOF');
 const g=fixture({scope:'NOVEL_WEBTOON_FREE'});g.mutateProof(3,p=>p.webtoonAssetAcceptance=false);await blocked(g,'PUBLICATION_IMPORT_INCOMPLETE');
 const h=fixture();h.mutateProof(3,p=>p.eligibleLegacyNovels=2);await blocked(h,'EXECUTION_INPUT_UNVERIFIED');
});
test('lockdown and final beta use current candidate evidence only after all prior stages',async()=>{
 const f=fixture();f.mutateProof(4,p=>p.sql.sha256='d'.repeat(64));await blocked(f,'LOCKDOWN_PROOF_INCOMPLETE');
 const g=fixture();g.mutateProof(5,p=>p.evidence=[]);await blocked(g,'BETA_EVIDENCE_INCOMPLETE');
 const h=fixture();h.mutateProof(5,p=>p.evidence[0].kind='LOCAL_UNIT');await blocked(h,'BETA_EVIDENCE_INCOMPLETE');
 const i=fixture();i.mutateRecord(5,r=>r.resultSnapshot=i.put('proofs/beta-state.json',{}));await blocked(i,'BETA_SNAPSHOT_MUST_BE_READ_ONLY');
 assert.equal((await evaluate(fixture({scope:'NOVEL_WEBTOON_FREE'}))).status,'READY_FOR_HUMAN_APPROVAL');
});
test('approved inputs regenerate exact content/import SQL with stable UUIDs and reject unrelated SQL or rights tampering',async()=>{
 const f=fixture({selected:true});assert.equal((await evaluate(f)).status,'READY_FOR_HUMAN_APPROVAL');
 for(const index of [1,3]){
  const g=fixture({selected:true});g.mutateProof(index,p=>p.executedSql=g.put(p.executedSql.file,Buffer.from('DROP TABLE public.episodes;')));
  await blocked(g,'EXECUTION_INPUT_UNVERIFIED');
 }
 const h=fixture({selected:true});h.files.set('proofs/rights.txt',Buffer.from('wrong'));await blocked(h,'EXECUTION_INPUT_UNVERIFIED');
 const i=fixture({selected:true});i.mutateProof(3,p=>p.versionIds=['44444444-4444-4444-8444-444444444444']);await blocked(i,'EXECUTION_INPUT_UNVERIFIED');
 const p={snapshotSha256:'a'.repeat(64)},v={selected:[{row:{episodeId:'1',source:Object.fromEntries(['episode','work','state','author','auth','identity','secure','alternate'].map(k=>[k,'{}']))},decision:{originalPublishedAt:'2026-01-01T00:00:00Z'}}],cutoverEvidence:{}};
 const one=legacyImportSql(p,v,'begin;\ncommit;');assert.equal(one.versionIds.length,1);
 assert.equal(legacyImportSql(p,v,'begin;\ncommit;',{versionIds:one.versionIds}).sql,one.sql);
 assert.throws(()=>legacyImportSql(p,v,'begin;',{versionIds:[]}),/INVALID_VERSION_IDS/);
 assert.throws(()=>legacyImportSql(p,v,'begin;',{versionIds:['bad']}),/INVALID_VERSION_IDS/);
});
test('malformed full snapshots and data changes cannot be hidden by self-consistent file hashes',async()=>{
 const f=fixture();f.mutateRecord(0,r=>{const s=JSON.parse(f.files.get(r.resultSnapshot.file));s.tables[0].fingerprint='d'.repeat(64);
  r.resultSnapshot=f.put(r.resultSnapshot.file,s);r.afterSnapshotSha256=r.resultSnapshot.sha256});await blocked(f,'RESULT_SNAPSHOT_UNVERIFIED');
 const g=fixture();g.mutateRecord(0,r=>{const s=JSON.parse(g.files.get(r.resultSnapshot.file));s.tables=s.tables.filter(t=>t.name!=='objects');
  r.resultSnapshot=g.put(r.resultSnapshot.file,s);r.afterSnapshotSha256=r.resultSnapshot.sha256});await blocked(g,'RESULT_SNAPSHOT_UNVERIFIED');
 const h=fixture({selected:true});h.mutateRecord(0,r=>{const s=JSON.parse(h.files.get(r.resultSnapshot.file)),t=s.tables.find(t=>t.name==='episodes');
  const row=JSON.parse(t.rows[0]);row.content='덮어쓴 원고';t.rows=[JSON.stringify(row)];t.fingerprint=fingerprint(t.rows);
  r.resultSnapshot=h.put(r.resultSnapshot.file,s);r.afterSnapshotSha256=r.resultSnapshot.sha256});
 h.mutateProof(0,p=>p.afterSnapshotSha256=JSON.parse(h.records[0].bytes).afterSnapshotSha256);await blocked(h,'RESULT_DATA_CONTRACT_MISMATCH');
 for(const [index,name,change] of [
  [2,'buckets',row=>row.public=true],
  [3,'publication_versions',row=>{row.work_id='999';row.title='잘못된 제목';row.author_comment='다른 작가말';row.image_urls=['unverified.png']}],
  [4,'p0_migration_status',row=>row.applied_at='2026-10-10T00:00:00Z']
 ]){
  const k=fixture({selected:true});k.mutateRecord(index,r=>{const s=JSON.parse(k.files.get(r.resultSnapshot.file)),t=s.tables.find(t=>t.name===name);
   const row=JSON.parse(t.rows[0]);change(row);t.rows[0]=JSON.stringify(row);t.fingerprint=fingerprint(t.rows);
   r.resultSnapshot=k.put(r.resultSnapshot.file,s);r.afterSnapshotSha256=r.resultSnapshot.sha256});
  k.mutateProof(index,p=>p.afterSnapshotSha256=JSON.parse(k.records[index].bytes).afterSnapshotSha256);await blocked(k,'RESULT_DATA_CONTRACT_MISMATCH');
 }
 const money=fixture({ledger:true});money.mutateRecord(2,r=>{const s=JSON.parse(money.files.get(r.resultSnapshot.file)),t=s.tables.find(t=>t.name==='ledger_probe');
  t.rows[0]=t.rows[0].replace('678901','678902');t.fingerprint=fingerprint(t.rows);
  r.resultSnapshot=money.put(r.resultSnapshot.file,s);r.afterSnapshotSha256=r.resultSnapshot.sha256});
 money.mutateProof(2,p=>p.afterSnapshotSha256=JSON.parse(money.records[2].bytes).afterSnapshotSha256);await blocked(money,'RESULT_DATA_CONTRACT_MISMATCH');
});
async function privateFixture(f){
 await mkdir('scratch/launch/backups',{recursive:true});const dir=await mkdtemp(path.resolve('scratch/launch/backups/stage25-test-'));
 for(const [file,bytes] of f.files){await mkdir(path.dirname(path.join(dir,file)),{recursive:true});await writeFile(path.join(dir,file),bytes)}
 await mkdir(path.join(dir,'steps'));await writeFile(path.join(dir,'manifest.json'),f.manifestBytes);return dir;
}
test('on-disk verification rejects byte tampering, candidate SQL mismatch and path/link escapes',async()=>{
 const f=fixture(),dir=await privateFixture(f);await verifyCutoverFiles(dir,f.m,{expectedSql:Object.fromEntries(f.m.sql.map(s=>[s.id,s.sha256]))});
 await assert.rejects(()=>verifyCutoverFiles(dir,f.m,{expectedSql:{}}),/CANDIDATE_SQL_MISMATCH/);
 await assert.rejects(()=>verifyCutoverFiles(dir,{...f.m,initialVersions:f.m.initialVersions.slice(1)}),/BASELINE_MARKER_MISMATCH/);
 await writeFile(path.join(dir,'sql/content-selection.sql'),'tamper');await assert.rejects(()=>verifyCutoverFiles(dir,f.m),/FILE_SIZE_MISMATCH|FILE_HASH_MISMATCH/);
 await assert.rejects(()=>readCutoverFile(dir,{file:'../.env.local',bytes:1,sha256:'d'.repeat(64)}),/UNSAFE_PATH/);
 const first=f.m.sourceFiles[0];await assert.rejects(()=>readCutoverFile(dir,{...first,sha256:'d'.repeat(64)}),/FILE_HASH_MISMATCH/);
 try{await symlink(path.join(dir,'source'),path.join(dir,'linked'),'junction')}catch(e){if(['EPERM','EACCES'].includes(e.code))return;throw e}
 await assert.rejects(()=>readCutoverFile(dir,{...first,file:'linked/logical-snapshot.json'}),/LINK_FORBIDDEN/);
});
test('CLI checks candidate Git blobs and append-only records without touching source or replacing history',async t=>{
 t.mock.method(Date,'now',()=>now);
 const head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim(),f=fixture({candidate:head,sql:candidateSqlBytes(head)}),dir=await privateFixture(f);
 assert.equal((await checkCutoverPackage(dir,{now})).nextStep,'RESTORE');
 const original=await readFile(path.join(dir,'source/logical-snapshot.json'));
 await writeFile(path.join(dir,'proofs/next.json'),f.records[0].bytes);
 assert.equal((await appendCutoverRecord(dir,'proofs/next.json')).completedSteps,1);
 const first=await readFile(path.join(dir,'steps/01-RESTORE.json'));
 await assert.rejects(()=>appendCutoverRecord(dir,'proofs/next.json'),/STEP_APPEND_REJECTED/);
 assert.deepEqual(await readFile(path.join(dir,'steps/01-RESTORE.json')),first);assert.deepEqual(await readFile(path.join(dir,'source/logical-snapshot.json')),original);
 await writeFile(path.join(dir,'steps/03-MIGRATIONS.json'),'{}');await assert.rejects(()=>checkCutoverPackage(dir,{now}),/JOURNAL_SEQUENCE_MISMATCH/);
 const bad=spawnSync(process.execPath,['scripts/prepare_cutover_package.mjs','--apply','private-secret'],{encoding:'utf8'});
 assert.equal(bad.status,1);assert.equal(bad.stdout,'');assert.match(bad.stderr,/CUTOVER_PREPARE_CHECK_OR_RECORD_REQUIRED/);assert.ok(!bad.stderr.includes('private-secret'));
 assert.throws(()=>candidateSqlBytes('private-value'),/INVALID_CANDIDATE/);
});
