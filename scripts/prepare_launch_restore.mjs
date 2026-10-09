import {readFile,lstat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {safeBundleFile} from './lib/recovery-bundle.mjs';
import {privateBackupDirectory,readVerifiedSnapshot,sha} from './lib/launch-content-review.mjs';
import {restorePreparation} from './lib/launch-restore-plan.mjs';
async function main(){
  const [logicalInput,nativeInput,targetRef]=process.argv.slice(2);
  if(!logicalInput||!nativeInput||process.argv.length>5)throw Error('RESTORE_PLAN_DIRECTORIES_REQUIRED');
  const logicalDirectory=await privateBackupDirectory(logicalInput),nativeDirectory=await privateBackupDirectory(nativeInput);
  const {manifest:logical}=await readVerifiedSnapshot(logicalDirectory);
  const files=await Promise.all(['manifest.json','archive-toc.txt','application-auth-storage.dump'].map(n=>safeBundleFile(nativeDirectory,n)));
  for(const file of files)if((await lstat(file)).size>128*1024*1024)throw Error('RESTORE_PLAN_FILE_TOO_LARGE');
  const [manifestBytes,toc,archive]=await Promise.all(files.map(file=>readFile(file)));
  const native=JSON.parse(manifestBytes);
  if(archive.length!==native.bytes||sha(archive)!==native.sha256||archive.subarray(0,5).toString()!=='PGDMP')throw Error('RESTORE_PLAN_ARCHIVE_CHECKSUM');
  const report=restorePreparation(logical,native,toc.toString('utf8'),targetRef||null);
  report.preparedAt=new Date().toISOString();
  await writeFile(path.join(logicalDirectory,'stage23-restore-preparation.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  await writeFile('artifacts/stage23-restore-preparation.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(e=>{console.error(/^RESTORE_PLAN_[A-Z_]+$/.test(e.message)?e.message:'RESTORE_PLAN_FAILED_DETAILS_WITHHELD');process.exitCode=1;});
