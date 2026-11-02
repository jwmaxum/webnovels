// Native multi-connection claim race and archive restore; no environment secrets.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {startNativeCluster} from './lib/op08-native-postgres.mjs';
import {snapshot} from './lib/native-recovery-snapshot.mjs';
import {setup,admin} from './fixtures/op10-db.mjs';
await mkdir('scratch/op10',{recursive:true});
const cluster=await startNativeCluster();let db,a,b,restored;const steps=[];
const runtime=async(c,action,data)=>(await c.query('select public.op10_payout_runtime($1,$2) result',[action,JSON.stringify(data)])).rows[0].result;
try{
 await cluster.createDatabase('op08_op10');db=await cluster.connect('op08_op10');const f=await setup({dbFactory:async()=>db}),{job}=await f.prepare();
 a=await cluster.connect('op08_op10');b=await cluster.connect('op08_op10');await a.exec('set role service_role;begin');await b.exec('set role service_role');
 const input={id:job.id,actorId:admin,reviewedConfigId:job.configId},one=await runtime(a,'claim-create',input);assert(one.claimed);
 const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;const pending=runtime(b,'claim-create',input);pending.catch(()=>{});
 let blocked=false;const end=Date.now()+5000;
 while(Date.now()<end){if((await cluster.control.query('select cardinality(pg_blocking_pids($1)) n',[pid])).rows[0].n>0){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}
 assert(blocked,'second actual connection must block on the first row lock');await a.exec('commit');assert.equal((await pending).claimed,false);steps.push('concurrent create claims permit only one sender');
 // Simulate a process crash after committed claim. No provider call is made.
 await db.query("update commerce.op10_jobs set lease_until=now()-interval '1 minute' where id=$1",[job.id]);
 assert.equal((await runtime(b,'claim-create',input)).claimed,false);const query=await runtime(b,'claim-query',{id:job.id});assert(query.claimed);steps.push('expired lease permits query only');
 await runtime(b,'observe',{id:job.id,leaseId:query.leaseId,observation:{state:'UNKNOWN'}});
 await a.close();a=null;await b.close();b=null;
 const before=await snapshot(db),file=join(cluster.directory,'database.dump');await cluster.dump('op08_op10',file);await cluster.createDatabase('op08_restored');await cluster.restore('op08_restored',file);restored=await cluster.connect('op08_restored');assert.deepEqual(await snapshot(restored),before);
 await restored.exec('set role service_role');assert.equal((await runtime(restored,'claim-create',input)).claimed,false);const q=await runtime(restored,'claim-query',{id:job.id});assert(q.claimed);steps.push('archive preserves bindings, evidence, ACL and one-shot dispatch marker');
 await restored.exec('reset role;set role authenticated');await assert.rejects(runtime(restored,'claim-query',{id:job.id}),e=>e.code==='42501');await restored.exec('reset role');steps.push('restored authenticated role cannot claim');
 const report={stage:'OP-10',result:'PASS',engine:cluster.version,steps,provenance:'NATIVE_POSTGRES_SYNTHETIC',productionTouched:false,realProviderCalled:false,independentHostedRecovery:false};
 await writeFile('scratch/op10/native-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{
 for(const c of [a,b,restored,db])if(c)await c.close().catch(()=>{});
 await cluster.stop();
}
