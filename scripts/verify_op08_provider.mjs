// Optional externally-issued TEST receipt query. Never confirms/cancels/transfers funds.
import {readFile,writeFile,mkdir,realpath,stat} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {loadEnv} from './lib/launch-access.cjs';
import {probeTossTest} from './lib/op08-provider-probe.mjs';
await mkdir('scratch/op08/inputs',{recursive:true});
const env=loadEnv();let order;
try{
 if(env.OP08_PROVIDER_RECEIPT_FILE){
  const root=await realpath('scratch/op08/inputs'),file=await realpath(resolve(env.OP08_PROVIDER_RECEIPT_FILE));
  if(!file.startsWith(root+sep)||(await stat(file)).size>8192)throw Error('INVALID_TEST_RECEIPT_FILE');
  order=JSON.parse(await readFile(file,'utf8'));
 }
 const report=await probeTossTest({env,order});await writeFile('scratch/op08/provider-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 // Missing prerequisites are deliberately not a successful provider acceptance.
 process.exitCode=report.result==='VERIFIED_QUERY'?0:2;
}catch{console.error('OP08_PROVIDER_INPUT_UNAVAILABLE');process.exitCode=1;}
