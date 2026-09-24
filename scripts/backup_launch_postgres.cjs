// Native logical backup via a short-lived, read-only provider login role.
// Passwords remain in child-process environment and are never logged or persisted.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {loadEnv,connection,managementToken}=require('./lib/launch-access.cjs');
async function main(){
 const env=loadEnv(),{ref}=connection(env),headers={Authorization:'Bearer '+managementToken(env),'Content-Type':'application/json'};
 const binary=path.resolve(env.PG_DUMP_PATH||'scratch/tools/postgresql-17/pgsql/bin/pg_dump.exe');
 if(!fs.existsSync(binary))throw Error('NATIVE_BACKUP_PG_DUMP_REQUIRED');
 const p=await fetch(`https://api.supabase.com/v1/projects/${ref}/config/database/pooler`,{headers,redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!p.ok)throw Error('NATIVE_BACKUP_POOLER_HTTP_'+p.status);
 const configs=await p.json(),pool=configs.find(c=>c.database_type==='PRIMARY')||configs[0];
 if(!pool||!/^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(pool.db_host))throw Error('NATIVE_BACKUP_POOLER_INVALID');
 const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/cli/login-role`,{method:'POST',headers,
  body:JSON.stringify({read_only:true}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('NATIVE_BACKUP_LOGIN_HTTP_'+r.status);
 const login=await r.json();
 if(!login.role||!login.password||!(login.ttl_seconds>0))throw Error('NATIVE_BACKUP_LOGIN_INVALID');
 const directory=path.resolve('scratch/launch/backups','native-'+new Date().toISOString().replace(/[:.]/g,'-'));
 fs.mkdirSync(directory,{recursive:true});
 const caFile=path.join(directory,'trusted-ca.pem');
 // Official Studio source: apps/studio/hooks/custom-content/custom-content.json.
 const certificateUrl='https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt';
 const certificateResponse=await fetch(certificateUrl,{redirect:'error',signal:AbortSignal.timeout(20000)});
 const certificate=await certificateResponse.text();
 if(!certificateResponse.ok||!certificate.startsWith('-----BEGIN CERTIFICATE-----'))throw Error('NATIVE_BACKUP_CA_INVALID');
 const parsedCertificate=new crypto.X509Certificate(certificate);
 if(!parsedCertificate.ca||Date.parse(parsedCertificate.validTo)<Date.now())throw Error('NATIVE_BACKUP_CA_INVALID');
 fs.writeFileSync(caFile,require('node:tls').rootCertificates.join('\n')+'\n'+certificate);
 const childEnv={...process.env,PGHOST:pool.db_host,PGPORT:'5432',PGUSER:login.role+'.'+ref,
  PGPASSWORD:login.password,PGDATABASE:pool.db_name||'postgres',PGSSLMODE:'verify-full',PGSSLROOTCERT:caFile,PGCONNECT_TIMEOUT:'15',
  PGOPTIONS:'-c default_transaction_read_only=on'};
 const output=path.join(directory,'application-auth-storage.dump');
 // The temporary login is NOINHERIT; explicitly assume its existing read-only membership.
 const args=['--no-password','--role=supabase_read_only_user','--format=custom','--file',output,
  '--schema=public','--schema=auth','--schema=storage','--schema=authoring','--schema=launch_recovery'];
 let result=spawnSync(binary,args,{env:childEnv,encoding:'utf8',windowsHide:true,timeout:180000});
 // The pooler can briefly cache the prior temporary password. Reuse the same credential,
 // never mint another credential in this retry and never retry a non-auth dump failure.
 if(result.status!==0&&/password authentication failed/.test(result.stderr||'')){
  console.log('WAITING_FOR_POOLER_TEMPORARY_CREDENTIAL_REFRESH');
  await new Promise(resolve=>setTimeout(resolve,30000));
  result=spawnSync(binary,args,{env:childEnv,encoding:'utf8',windowsHide:true,timeout:180000});
 }
 const safeLog=String(result.stderr||'').split(login.password).join('[REDACTED]');
 fs.writeFileSync(path.join(directory,'pg-dump-private.log'),safeLog,{mode:0o600});
 if(result.status!==0)throw Error('NATIVE_BACKUP_PG_DUMP_FAILED_PRIVATE_LOG:'+directory);
 const list=spawnSync(path.join(path.dirname(binary),'pg_restore.exe'),['--list',output],{encoding:'utf8',windowsHide:true,timeout:30000});
 if(list.status!==0)throw Error('NATIVE_BACKUP_ARCHIVE_UNREADABLE');
 fs.writeFileSync(path.join(directory,'archive-toc.txt'),list.stdout,{mode:0o600});
 const bytes=fs.readFileSync(output),report={createdAt:new Date().toISOString(),projectRef:ref,
  tool:spawnSync(binary,['--version'],{encoding:'utf8',windowsHide:true}).stdout.trim(),
  requestedSchemas:['public','auth','storage','authoring','launch_recovery'],
  schemas:[...new Set(list.stdout.split('\n').map(line=>line.match(/ TABLE DATA (\S+) /)?.[1]).filter(Boolean))].sort(),bytes:bytes.length,
  sha256:crypto.createHash('sha256').update(bytes).digest('hex'),format:'PostgreSQL custom archive',
  tableDataEntries:list.stdout.split('\n').filter(line=>/ TABLE DATA /.test(line)).length,
  archiveReadable:true,hostedRestoreVerified:false,providerLoginReadOnly:true,credentialTtlSeconds:login.ttl_seconds,
  tlsMode:'verify-full',certificateUrl,certificateSha256:crypto.createHash('sha256').update(certificate).digest('hex'),
  limitations:['Cluster roles and provider-managed internals/configuration are not included.','Storage file bytes and external assets are separate.','Off-device copy and hosted Supabase restoration not yet verified.']};
 fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(report,null,2)+'\n');
 fs.writeFileSync('artifacts/launch-native-backup.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({directory,...report},null,2));
}
main().catch(e=>{console.error(e.message.startsWith('NATIVE_BACKUP_')?e.message:'NATIVE_BACKUP_FAILED_DETAILS_WITHHELD');process.exitCode=1});
