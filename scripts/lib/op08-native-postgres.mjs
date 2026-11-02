// Disposable synthetic cluster only. Never loads .env.local or accepts a DB URL.
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,unlink,realpath} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import pg from 'pg';

export async function startNativeCluster({bin=process.env.OP08_PG_BIN||'scratch/tools/postgresql-17/pgsql/bin'}={}){
 const root=await realpath('.');await mkdir(join(root,'scratch','op08'),{recursive:true});
 const directory=await mkdtemp(join(root,'scratch','op08','native-'));
 if(!directory.startsWith(root+sep+'scratch'+sep+'op08'+sep))throw Error('OP08_LOCAL_DIRECTORY_REQUIRED');
 const binaryRoot=await realpath(resolve(bin)),ext=process.platform==='win32'?'.exe':'';
 const password=randomBytes(32).toString('hex'),user='op08_owner';
 const port=await new Promise((ok,no)=>{const s=createServer();s.once('error',no);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>ok(p));});});
 const cleanEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^PG|^DATABASE_URL$|^SUPABASE_/i.test(k)));
 const env={...cleanEnv,PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:user,PGPASSWORD:password,PGDATABASE:'postgres',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'};
 let started=false;
 async function run(tool,args,extra={}){
  return new Promise((ok,no)=>{const child=spawn(join(binaryRoot,tool+ext),args,{windowsHide:true,env:{...env,...extra},stdio:['ignore','pipe','pipe']});let out='',err='';
   const timer=setTimeout(()=>child.kill(),240000);child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',()=>{clearTimeout(timer);no(Error('OP08_NATIVE_TOOL_UNAVAILABLE'));});
   child.on('exit',async code=>{clearTimeout(timer);child.stdout.destroy();child.stderr.destroy();if(code!==0){await writeFile(join(directory,tool+'-failure.private.log'),err.split(password).join('[REDACTED]'));no(Error('OP08_NATIVE_'+tool.toUpperCase()+'_FAILED'));}else ok(out);});
  });
 }
 async function connect(database='postgres'){
  if(!/^op08_[a-z0-9_]+$/.test(database)&&database!=='postgres')throw Error('OP08_SYNTHETIC_DATABASE_REQUIRED');
  const client=new pg.Client({host:'127.0.0.1',port,user,password,database,ssl:false,application_name:'webnovels-op08-synthetic',connectionTimeoutMillis:5000,statement_timeout:15000,lock_timeout:10000});
  // Surface failures at the awaited query; do not print connection properties.
  client.on('error',()=>{});await client.connect();
  return {client,query:(...args)=>client.query(...args),exec:sql=>client.query(sql),close:()=>client.end()};
 }
 const data=join(directory,'data'),pw=join(directory,'init-password.private');
 try{
  await writeFile(pw,password+'\n',{mode:0o600});await run('initdb',['-D',data,'-U',user,'--encoding=UTF8','--locale=C','--auth=scram-sha-256','--pwfile',pw]);await unlink(pw);
  await writeFile(join(data,'postgresql.auto.conf'),`listen_addresses='127.0.0.1'\nport=${port}\nunix_socket_directories=''\n`);
  await run('pg_ctl',['-D',data,'-l',join(directory,'postgres.private.log'),'-w','start']);started=true;
  const control=await connect();await control.exec('set statement_timeout=120000');
  const createDatabase=async name=>{if(!/^op08_[a-z0-9_]+$/.test(name))throw Error('OP08_SYNTHETIC_DATABASE_REQUIRED');await control.query('create database "'+name+'"');};
  return {directory,connect,createDatabase,control,run,version:(await run('postgres',['--version'])).trim(),
   dump:async(database,file)=>{if(!/^op08_[a-z0-9_]+$/.test(database)||resolve(file)!==join(directory,'database.dump'))throw Error('OP08_ARCHIVE_PATH_REQUIRED');await run('pg_dump',['--no-password','--format=custom','--file',file,'--dbname',database]);},
   restore:async(database,file)=>{if(database!=='op08_restored'||resolve(file)!==join(directory,'database.dump'))throw Error('OP08_RESTORE_TARGET_REQUIRED');await run('pg_restore',['--no-password','--exit-on-error','--single-transaction','--dbname',database,file]);},
   stop:async()=>{await control.close();await run('pg_ctl',['-D',data,'-w','-t','180','-m','fast','stop']);started=false;}};
 }catch(e){if(started)await run('pg_ctl',['-D',data,'-w','-m','fast','stop']).catch(()=>{});await unlink(pw).catch(()=>{});throw e;}
}
