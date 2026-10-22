import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {setup} from './fixtures/stage17-db.mjs';
import {snapshotOf} from './fixtures/stage30-evidence.mjs';
import scope from './lib/launch-backup-scope.cjs';
import {rehearseStage36,stage36PreparedSql,stage36SourceGuards,validateStage36Snapshot,validateStage36Native,verifyStage36Preservation} from './prepare_stage36.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');

const guardNames=['auth.users','auth.schema_migrations','storage.objects','public.authors','public.readers','public.admin_users','authoring.migrations','commerce.orders','growth.metrics','launch_recovery.flags'];
function guardSnapshot(){
 return {format:'webnovels-logical-data-v1',requested_schemas:scope.schemas,
  tables:guardNames.map(name=>{const [schema,table]=name.split('.');const rows=table==='migrations'?['{"version": "authoring-015"}']:[];
   return {schema,name:table,row_count:String(rows.length),rows};}),
  columns:guardNames.map(name=>{const [schema,table]=name.split('.');return {schema,table,name:table==='migrations'?'version':'id',ordinal:1};}),
  functions:[],triggers:[],sequences:[]};
}
test('stage36 guard package sets repeatable-read isolation and bounded timeouts before correctly scoped locks and checks',()=>{
 const snapshot=guardSnapshot();
 const sql=stage36PreparedSql(snapshot,'a'.repeat(64));
 for(const setting of ['set transaction isolation level repeatable read',"set local lock_timeout='5s'","set local statement_timeout='60s'"]){
  assert.ok(sql.indexOf(setting)>sql.indexOf('begin;'));
  assert.ok(sql.indexOf(setting)<sql.indexOf('do $scope$'));
  assert.ok(sql.indexOf(setting)<sql.indexOf('lock table '));
 }
 assert.ok(sql.lastIndexOf('lock table ')<sql.indexOf('do $scope$'));
 for(const name of guardNames){const [schema,table]=name.split('.');
  assert.ok(sql.includes(`lock table "${schema}"."${table}" in ${['auth','storage'].includes(schema)?'access share':'share row exclusive'} mode;`));}
 assert.equal(/lock table "(?:auth|storage)"\.[^;]+ in share row exclusive mode/.test(sql),false);
 assert.equal(/(?:grant|alter owner|alter role)[^;]*(?:auth|storage)\./i.test(stage36SourceGuards(snapshot)),false);
});

test('stage36 source guards work with SELECT-only managed-table privileges while retaining app locks',async()=>{
 const db=await PGlite.create();
 try{
  for(const schema of scope.schemas)await db.exec('create schema if not exists '+schema);
  for(const name of guardNames)await db.exec(`create table ${name}(${name==='authoring.migrations'?'version text':'id integer'})`);
  await db.exec("insert into authoring.migrations values('authoring-015');create role guard_operator");
  for(const schema of scope.schemas){
   await db.exec(`grant usage on schema ${schema} to guard_operator;grant ${['auth','storage'].includes(schema)?'select':'select,update,delete'} on all tables in schema ${schema} to guard_operator`);
  }
  await db.exec('set role guard_operator');
  await db.exec('begin;set transaction isolation level repeatable read;');
  await db.exec(stage36SourceGuards(guardSnapshot()));await db.exec('rollback');
  assert.equal((await db.query('select current_user r')).rows[0].r,'guard_operator');
  await db.exec('begin');
  await assert.rejects(db.exec('lock table auth.schema_migrations in share row exclusive mode'),/permission denied/);
  await db.exec('rollback;reset role');
 }finally{await db.close();}
});

async function fullSnapshot(db){
 await db.exec("set timezone='UTC'");
 const {snapshot}=await snapshotOf(db);
 snapshot.requested_schemas=scope.schemas;
 snapshot.columns=(await db.query(`select n.nspname schema,c.relname "table",a.attname name,format_type(a.atttypid,a.atttypmod) type,a.attnum ordinal,a.attnotnull not_null,
  a.attidentity identity,a.attgenerated generated,pg_get_expr(d.adbin,d.adrelid) "default" from pg_attribute a join pg_class c on c.oid=a.attrelid
  join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
  where n.nspname in (${scope.schemaSql}) and c.relkind='r' and a.attnum>0 and not a.attisdropped`)).rows;
 snapshot.sequences=(await db.query(`select * from pg_sequences where schemaname in (${scope.schemaSql})`)).rows;
 snapshot.functions=(await db.query(`select n.nspname schema,p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl acl
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in (${scope.schemaSql}) and p.prokind='f'`)).rows;
 snapshot.triggers=(await db.query(`select n.nspname schema,c.relname "table",pg_get_triggerdef(t.oid) definition
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in (${scope.schemaSql}) and not t.tgisinternal`)).rows;
 return JSON.parse(JSON.stringify(snapshot,(_key,value)=>typeof value==='bigint'?value.toString():value));
}

test('stage36 rehearses only additive migrations, preserves all source rows and flags, proves service-only grants',async()=>{
 const {db}=await setup();
 try{
  await db.exec(await readFile(new URL('../database/authoring/015_webtoon.sql',import.meta.url),'utf8'));
  await db.exec('create table authoring.free_beta_settings(id boolean primary key,enabled boolean not null);insert into authoring.free_beta_settings values(true,false)');
  const snapshot=await fullSnapshot(db),sha=hash(JSON.stringify(snapshot));
  validateStage36Snapshot(snapshot);
  const sql=stage36PreparedSql(snapshot,sha);
  assert.ok(sql.indexOf("set local lock_timeout='5s'")<sql.indexOf('lock table '));
  assert.ok(sql.indexOf("set local statement_timeout='60s'")<sql.indexOf('lock table '));
  assert.ok(sql.includes('STAGE36_SOURCE_SCOPE_CHANGED'));assert.ok(sql.includes('STAGE36_SOURCE_CHANGED'));
  assert.equal(sql.includes('beta_test_data_reset'),false);assert.equal(sql.includes('truncate '),false);
  const report=await rehearseStage36(snapshot,sha);
  assert.equal(report.originalRowsMatch,true);assert.equal(report.migrationRepeatable,true);assert.equal(report.flagsUnchanged,true);
  assert.equal(report.sourceDriftRejected,true);assert.equal(report.privateTables,7);assert.equal(report.serviceOnlyRpcs,4);
  assert.equal(report.roleChecks,true);assert.equal(report.destructiveReset,false);assert.equal(report.hostedRestoreAcceptance,false);
  assert.equal(report.sourceIsolation,'REPEATABLE READ');assert.equal(report.managedProviderWritesFrozen,false);assert.equal(report.postApplyDriftRequiresReview,true);
  assert.equal(await verifyStage36Preservation(db,snapshot),true);
  await db.exec('update authoring.free_beta_settings set enabled=true');
  await assert.rejects(verifyStage36Preservation(db,snapshot),/STAGE36_ORIGINAL_ROWS_CHANGED/);
  await db.exec('update authoring.free_beta_settings set enabled=false');
  assert.throws(()=>validateStage36Snapshot({...snapshot,requested_schemas:['public']}),/STAGE36_SNAPSHOT_SCOPE_REQUIRED/);
  assert.throws(()=>validateStage36Snapshot({...snapshot,tables:[...snapshot.tables,snapshot.tables[0]]}),/BACKUP_DUPLICATE_TABLE/);
  const archive=Buffer.from('PGDMP synthetic archive bytes for verification only'),projectRef='abcdefghijklmnopqrst';
  const logical={projectRef,snapshotSha256:sha,requestedSchemas:scope.schemas,rowCounts:Object.fromEntries(snapshot.tables.map(t=>[t.schema+'.'+t.name,Number(t.row_count)]))};
  const native={projectRef,createdAt:new Date().toISOString(),requestedSchemas:scope.schemas,format:'PostgreSQL custom archive',archiveReadable:true,
   tableDataEntries:snapshot.tables.length,sha256:hash(archive),bytes:archive.length};
  const toc=snapshot.tables.map((t,i)=>`${i+1}; 1 1 TABLE DATA ${t.schema} ${t.name} postgres`).join('\n');
  assert.equal(validateStage36Native(snapshot,logical,native,toc,archive).nativeArchiveVerified,true);
  assert.throws(()=>validateStage36Native({...snapshot,captured_at:'invalid'},logical,native,toc,archive),/FRESH_BACKUPS_REQUIRED/);
  assert.throws(()=>validateStage36Native(snapshot,logical,{...native,createdAt:new Date(Date.now()-25*3600000).toISOString()},toc,archive),/FRESH_BACKUPS_REQUIRED/);
  assert.throws(()=>validateStage36Native(snapshot,logical,{...native,createdAt:new Date(Date.now()+3600000).toISOString()},toc,archive),/FRESH_BACKUPS_REQUIRED/);
  assert.throws(()=>validateStage36Native(snapshot,logical,native,toc,Buffer.from('PGDMP wrong archive bytes')),/NATIVE_BACKUP_CHECKSUM/);
  assert.throws(()=>validateStage36Native(snapshot,{...logical,rowCounts:{}},native,toc,archive),/MANIFEST_SCOPE_MISMATCH/);
  assert.throws(()=>validateStage36Native(snapshot,logical,{...native,projectRef:'zzzzzzzzzzzzzzzzzzzz'},toc,archive),/SOURCE_PROJECT_MISMATCH/);
  assert.throws(()=>validateStage36Native(snapshot,logical,native,toc+'\n999; 1 1 TABLE DATA public.unexpected postgres',archive),/ARCHIVE_TABLE_MISMATCH/);
 }finally{await db.close();}
});
