import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { compareRecoveryBundles } from './lib/recovery-bundle.mjs';

async function main() {
  const [source,restored] = process.argv.slice(2);
  if (!source || !restored) throw Error('RECOVERY_DIRECTORIES_REQUIRED');
  const report = await compareRecoveryBundles(source,restored);
  await mkdir('scratch/stage19',{recursive:true});
  await writeFile('scratch/stage19/recovery-verification.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error => { console.error(/^RECOVERY_[A-Z_]+$/.test(error.message) ? error.message : 'RECOVERY_CHECK_FAILED_DETAILS_WITHHELD'); process.exitCode=1; });
