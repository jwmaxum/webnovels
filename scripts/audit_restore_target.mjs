// Uses the user-designated .env.local, quietly. No target creation or remote mutations.
import {writeFile,mkdir} from 'node:fs/promises';
import access from './lib/launch-access.cjs';
import {inspectRestoreTarget} from './lib/restore-target.mjs';
async function main(){
  if(process.argv.length>3)throw Error('RESTORE_TARGET_ARGUMENTS_REQUIRED');
  const env=access.loadEnv(),source=access.connection(env);
  const configured=process.argv[2]||(env.SUPABASE_RESTORE_TARGET_REF||'').trim()||null;
  const report=await inspectRestoreTarget({sourceRef:source.ref,targetRef:configured,token:access.managementToken(env)});
  await mkdir('artifacts',{recursive:true});await writeFile('artifacts/stage24-restore-target.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(report.status==='BLOCKED')process.exitCode=2;
}
main().catch(()=>{console.error('RESTORE_TARGET_AUDIT_FAILED_DETAILS_WITHHELD');process.exitCode=2;});
