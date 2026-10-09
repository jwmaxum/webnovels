import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import scope from './lib/launch-backup-scope.cjs';
import {restoreSnapshot} from './verify_launch_backup.mjs';
import {restorePreparation} from './lib/launch-restore-plan.mjs';

const tables=[{schema:'public',name:'works',kind:'r'},{schema:'commerce',name:'orders',kind:'r'},{schema:'growth',name:'preferences',kind:'r'}];
const toc=tables.map((t,i)=>`${i}; 0 1 TABLE DATA ${t.schema} ${t.name} postgres`).join('\n');
const logical={projectRef:'abcdefghijklmnopqrst',snapshotSha256:'a'.repeat(64),requestedSchemas:scope.schemas,rowCounts:{'public.works':1,'commerce.orders':1,'growth.preferences':1}};
const native={projectRef:logical.projectRef,sha256:'b'.repeat(64),requestedSchemas:scope.schemas,format:'PostgreSQL custom archive',archiveReadable:true,tableDataEntries:3};
test('logical/native/catalog scope includes commerce and growth; absent or duplicate table/schema layouts fail',async()=>{
  assert.equal(scope.schemas.includes('commerce'),true);assert.equal(scope.schemas.includes('growth'),true);
  assert.deepEqual(scope.nativeSchemaArgs(tables),['--schema=commerce','--schema=growth','--schema=public']);
  scope.assertInventory(tables,[...tables].reverse());scope.assertArchiveInventory(tables,toc);
  assert.throws(()=>scope.assertInventory(tables,tables.slice(1)),/SCHEMA_CHANGED/);
  assert.throws(()=>scope.assertArchiveInventory(tables,toc.split('\n').slice(1).join('\n')),/ARCHIVE_TABLE_MISMATCH/);
  for(const input of [[],[...tables,tables[0]],tables.map(t=>({...t,kind:'p'})),[{schema:'unknown',name:'x',kind:'r'}]])assert.throws(()=>scope.inventoryKeys(input));
  assert.equal(scope.reportFile('data-backup',['--report-prefix=stage23']),'artifacts/stage23-data-backup.json');
  assert.throws(()=>scope.reportFile('data-backup',['--report-prefix=../../private']),/INVALID_REPORT_PREFIX/);
  for(const script of ['backup_launch_data.cjs','backup_launch_postgres.cjs']){
    const code=await readFile(new URL(script,import.meta.url),'utf8');assert.match(code,/launch-backup-scope/);assert.doesNotMatch(code,/'public','auth','storage','authoring','launch_recovery'/);
  }
});
test('restore plans require independent target/schema scope/archive inventory and never claim a combined snapshot or hosted success',()=>{
  const pending=restorePreparation(logical,native,toc);assert.equal(pending.targetConfigured,false);
  const configured=restorePreparation(logical,native,toc,'zyxwvutsrqponmlkjihg');assert.equal(configured.targetConfigured,true);
  assert.equal(configured.combinedConsistentSnapshotConfirmed,false);assert.equal(configured.hostedRestoreAccepted,false);assert.equal(configured.targetOwnershipVerified,false);
  for(const target of [logical.projectRef,'https://example.invalid','bad'])assert.throws(()=>restorePreparation(logical,native,toc,target),/ISOLATED_TARGET_REQUIRED/);
  assert.throws(()=>restorePreparation(logical,{...native,projectRef:'zyxwvutsrqponmlkjihg'},toc),/SOURCE_PROJECT_MISMATCH/);
  assert.throws(()=>restorePreparation(logical,{...native,requestedSchemas:scope.schemas.slice(0,-1)},toc),/INCOMPLETE_SCHEMA_SCOPE/);
  assert.throws(()=>restorePreparation(logical,native,toc+'\n4; 0 1 TABLE DATA growth.extra postgres'),/ARCHIVE_TABLE_MISMATCH/);
  assert.throws(()=>restorePreparation(logical,{...native,archiveReadable:false},toc),/NATIVE_ARCHIVE_REQUIRED/);
});
test('actual data restore includes private FK/check and standalone unique keys instead of silently skipping them',async()=>{
  const source=await PGlite.create();let restored;
  try{
    await source.exec(`set timezone='UTC';create schema authoring;create schema commerce;create schema growth;
      create table works(id bigint not null,author_id bigint not null);create unique index work_owner on works(id,author_id);
      insert into works values(9007199254740993,7);
      create table authoring.drafts(id text primary key,work_id bigint,author_id bigint,foreign key(work_id,author_id) references works(id,author_id));
      insert into authoring.drafts values('draft',9007199254740993,7);
      create table commerce.orders(id text primary key,amount int check(amount>=0));insert into commerce.orders values('order',1);
      create table growth.preferences(id text primary key,order_id text references commerce.orders);insert into growth.preferences values('reader','order');`);
    const tables=[];
    for(const [schema,name] of [['public','works'],['authoring','drafts'],['commerce','orders'],['growth','preferences']]){
      const rows=(await source.query(`select to_jsonb(r)::text row from ${schema}.${name} r`)).rows.map(r=>r.row);tables.push({schema,name,rows,row_count:String(rows.length)});
    }
    const columns=(await source.query(`select n.nspname schema,c.relname "table",a.attname name,format_type(a.atttypid,a.atttypmod) type,a.attnum ordinal,a.attnotnull not_null
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','authoring','commerce','growth') and c.relkind='r' and a.attnum>0 and not a.attisdropped`)).rows;
    const constraints=(await source.query(`select n.nspname schema,c.relname "table",co.conname name,co.contype type,pg_get_constraintdef(co.oid) definition
      from pg_constraint co join pg_class c on c.oid=co.conrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','authoring','commerce','growth')`)).rows;
    const indexes=(await source.query("select * from pg_indexes where schemaname in ('public','authoring','commerce','growth')")).rows;
    const result=await restoreSnapshot({tables,columns,constraints,indexes});restored=result.db;
    assert.equal(result.verified.length,4);assert.equal(result.uniqueIndexes,1);assert.equal(result.applicationConstraints,constraints.length);
    await assert.rejects(restored.exec("insert into authoring.drafts values('bad',9007199254740993,8)"),/foreign key constraint/);
    await assert.rejects(restored.exec("insert into commerce.orders values('bad',-1)"),/check constraint/);
    await assert.rejects(restored.exec("insert into growth.preferences values('bad','missing')"),/foreign key constraint/);
    await assert.rejects(restored.exec('insert into works values(9007199254740993,7)'),/unique constraint/);
  }finally{if(restored)await restored.close();await source.close();}
});
