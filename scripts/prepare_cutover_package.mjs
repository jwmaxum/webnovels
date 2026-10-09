// Private files and evidence validation only. This command has no database/apply client.
import {readFile,writeFile,mkdir,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {safeBundleFile} from './lib/recovery-bundle.mjs';
import {privateBackupDirectory,readVerifiedSnapshot,sha} from './lib/launch-content-review.mjs';
import {restorePreparation} from './lib/launch-restore-plan.mjs';
import {verifyEvidenceProof} from './check_beta_readiness.mjs';
import {CUTOVER_SQL,CUTOVER_STAGES,validateCutoverManifest,cutoverMigrationPlan,readCutoverFile,
 verifyCutoverFiles,evaluateCutoverJournal,inspectCutoverSnapshot} from './lib/cutover-package.mjs';
const fail=code=>{throw Error('CUTOVER_'+code)};
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const descriptor=(file,bytes)=>({file,bytes:bytes.length,sha256:sha(bytes)});
async function cappedFile(directory,name,limit=128*1024*1024){
 const file=await safeBundleFile(directory,name);if((await lstat(file)).size>limit)fail('FILE_TOO_LARGE');return readFile(file);
}
export function candidateSqlBytes(candidate){
 if(!/^[a-f0-9]{40}$/.test(candidate))fail('INVALID_CANDIDATE');
 const result=spawnSync('git',['cat-file','--batch'],{input:CUTOVER_SQL.map(s=>candidate+':'+s.path+'\n').join(''),
  shell:false,maxBuffer:16*1024*1024,windowsHide:true});
 if(result.status!==0)fail('CANDIDATE_SQL_UNAVAILABLE');
 const files=new Map();let offset=0;
 for(const entry of CUTOVER_SQL){
  const end=result.stdout.indexOf(10,offset),header=result.stdout.subarray(offset,end).toString();
  const match=header.match(/^[a-f0-9]{40} blob ([1-9][0-9]*)$/);if(end<0||!match)fail('CANDIDATE_SQL_UNAVAILABLE');
  const size=Number(match[1]);offset=end+1;if(size>16*1024*1024||offset+size>=result.stdout.length)fail('CANDIDATE_SQL_UNAVAILABLE');
  files.set(entry.id,result.stdout.subarray(offset,offset+size));offset+=size+1;
 }
 if(offset!==result.stdout.length)fail('CANDIDATE_SQL_UNAVAILABLE');
 return files;
}
export async function prepareCutoverPackage({logicalInput,nativeInput,candidate,origin,scope,targetRef=null}){
 const logical=await privateBackupDirectory(logicalInput),native=await privateBackupDirectory(nativeInput);
 const verified=await readVerifiedSnapshot(logical),sqlFiles=candidateSqlBytes(candidate);
 const sources=new Map();
 for(const [name,directory,file] of [
  ['logical-snapshot.json',logical,'snapshot.json'],['logical-manifest.json',logical,'manifest.json'],
  ['logical-verification.json',logical,'data-restore-verification.json'],['native-manifest.json',native,'manifest.json'],
  ['native-archive.dump',native,'application-auth-storage.dump'],['archive-toc.txt',native,'archive-toc.txt'],
  ['content-review-packet.json',logical,'review-stage23/packet.json'],['import-impact-packet.json',logical,'import-stage24/packet.json']
 ])sources.set('source/'+name,await cappedFile(directory,file));
 inspectCutoverSnapshot(sources.get('source/logical-snapshot.json'));
 const nativeManifest=JSON.parse(sources.get('source/native-manifest.json')),archive=sources.get('source/native-archive.dump');
 if(archive.length!==nativeManifest.bytes||sha(archive)!==nativeManifest.sha256||archive.subarray(0,5).toString()!=='PGDMP')fail('ARCHIVE_CHECKSUM');
 const preparation=restorePreparation(verified.manifest,nativeManifest,sources.get('source/archive-toc.txt').toString(),targetRef);
 const review=JSON.parse(sources.get('source/content-review-packet.json')),impact=JSON.parse(sources.get('source/import-impact-packet.json'));
 if(review.format!=='webnovels-content-packet-v1'||impact.format!=='webnovels-legacy-import-packet-v1'||
   review.snapshotSha256!==verified.hash||impact.snapshotSha256!==verified.hash)fail('STALE_INITIAL_PACKET');
 const versions=verified.snapshot.tables.find(t=>t.schema==='authoring'&&t.name==='migrations')?.rows.map(r=>JSON.parse(r).version)||[];
 const p0Expanded=(verified.snapshot.tables.find(t=>t.schema==='public'&&t.name==='p0_migration_status')?.rows||[])
  .some(r=>{const row=JSON.parse(r);return row.version==='p0-20260921'&&['expanded','locked'].includes(row.phase)});
 const manifest=validateCutoverManifest({format:'webnovels-cutover-package-v1',candidate,origin,scope,
  sourceRef:verified.manifest.projectRef,targetRef,preparedAt:new Date().toISOString(),initialSnapshotSha256:verified.hash,
  nativeArchiveSha256:nativeManifest.sha256,independentSnapshotTimes:true,combinedConsistentSnapshotConfirmed:false,
  sourceFiles:[...sources].map(([file,bytes])=>descriptor(file,bytes)),initialVersions:versions,p0Expanded,
  sql:CUTOVER_SQL.map(s=>({id:s.id,...descriptor('sql/'+s.id+'.sql',sqlFiles.get(s.id))}))});
 const parent=path.join(logical,'cutover-stage25');
 try{await mkdir(parent)}catch(e){if(e.code!=='EEXIST')throw e}await privateBackupDirectory(parent);
 const directory=path.join(parent,candidate);await mkdir(directory);await privateBackupDirectory(directory);
 for(const folder of ['source','sql','steps','proofs'])await mkdir(path.join(directory,folder));
 for(const [file,bytes] of sources)await writeFile(path.join(directory,file),bytes,{flag:'wx',mode:0o600});
 for(const entry of manifest.sql)await writeFile(path.join(directory,entry.file),sqlFiles.get(entry.id),{flag:'wx',mode:0o600});
 await writeFile(path.join(directory,'manifest.json'),json(manifest),{flag:'wx',mode:0o600});
 const report={format:'webnovels-cutover-preparation-v1',candidate,origin,scope,sourceRef:manifest.sourceRef,targetRef,
  status:targetRef?'PREPARED_FOR_RESTORE_REVIEW':'PENDING_ISOLATED_TARGET',manifestSha256:sha(json(manifest)),
  logicalSnapshotSha256:verified.hash,nativeArchiveSha256:nativeManifest.sha256,tables:preparation.tables,
  initialContentConflicts:review.entries.length,initialImportEntries:impact.entries.length,
  initialPacketsArePlanningOnly:true,regenerateReviewAfterRestore:true,regenerateImportAfterMigrations:true,
  migrationPlan:cutoverMigrationPlan(manifest),activationAllowed:false,sqlExecuted:false,flagsChanged:false,hostedRestoreAccepted:false};
 await writeFile(path.join(directory,'preparation.json'),json(report),{flag:'wx',mode:0o600});
 return {directory,report};
}
async function journalFiles(directory){
 const folder=path.join(directory,'steps');if((await lstat(folder)).isSymbolicLink())fail('JOURNAL_LINK_FORBIDDEN');
 const files=(await readdir(folder)).sort();
 if(files.length>CUTOVER_STAGES.length||files.some((f,i)=>f!==`${String(i+1).padStart(2,'0')}-${CUTOVER_STAGES[i]}.json`))fail('JOURNAL_SEQUENCE_MISMATCH');
 return Promise.all(files.map(async file=>({bytes:await cappedFile(directory,'steps/'+file,2*1024*1024)})));
}
export async function checkCutoverPackage(input,{additionalRecord,now=Date.now()}={}){
 const directory=await privateBackupDirectory(input),manifestBytes=await cappedFile(directory,'manifest.json',2*1024*1024);
 const manifest=validateCutoverManifest(JSON.parse(manifestBytes)),sql=candidateSqlBytes(manifest.candidate);
 await verifyCutoverFiles(directory,manifest,{expectedSql:Object.fromEntries([...sql].map(([id,b])=>[id,sha(b)]))});
 const records=await journalFiles(directory);if(additionalRecord)records.push({bytes:additionalRecord});
 return evaluateCutoverJournal(manifest,records,{manifestSha256:sha(manifestBytes),now,
  readProof:d=>readCutoverFile(directory,d),verifyBetaProof:verifyEvidenceProof});
}
export async function appendCutoverRecord(input,recordFile){
 const directory=await privateBackupDirectory(input),bytes=await cappedFile(directory,recordFile,2*1024*1024);
 const existing=await journalFiles(directory),report=await checkCutoverPackage(directory,{additionalRecord:bytes});
 if(report.status==='BLOCKED'||report.completedSteps!==existing.length+1)fail('STEP_APPEND_REJECTED');
 const stage=CUTOVER_STAGES[existing.length],file=`steps/${String(existing.length+1).padStart(2,'0')}-${stage}.json`;
 await writeFile(path.join(directory,file),bytes,{flag:'wx',mode:0o600});return report;
}
async function main(){
 const [action,...args]=process.argv.slice(2);let report;
 if(action==='prepare'&&(args.length===5||args.length===6)){
  const [logicalInput,nativeInput,candidate,origin,scope,targetRef]=args;
  ({report}=await prepareCutoverPackage({logicalInput,nativeInput,candidate,origin,scope,targetRef:targetRef||null}));
  await writeFile('artifacts/stage25-cutover-preparation.json',json(report));
 }else if(action==='check'&&args.length===1)report=await checkCutoverPackage(args[0]);
 else if(action==='record'&&args.length===2)report=await appendCutoverRecord(...args);
 else fail('PREPARE_CHECK_OR_RECORD_REQUIRED');
 console.log(JSON.stringify(report,null,2));if(report.status==='BLOCKED')process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
 main().catch(e=>{console.error(/^CUTOVER_[A-Z_]+$/.test(e.message)?e.message:'CUTOVER_FAILED_DETAILS_WITHHELD');process.exitCode=1});
