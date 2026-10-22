import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {restoreSnapshot} from './verify_launch_backup.mjs';

test('backup restore loads the exact immutable document validator and still enforces CHECKs and row hashes',async()=>{
 const source=await PGlite.create();let restored;
 try{
  const migration=await readFile(new URL('../database/authoring/021_manuscript_documents.sql',import.meta.url),'utf8');
  const definition=migration.match(/create or replace function authoring\.document_valid\([\s\S]*?end \$\$;/)?.[0];
  assert.ok(definition);
  await source.exec('create schema authoring;'+definition);
  await source.exec(`create table authoring.draft_revisions(id int primary key,content text,content_document jsonb,
   constraint draft_document_valid check(content_document is null or authoring.document_valid(content_document,content)))`);
  const doc={version:1,paragraphs:[{align:'left',indent:0,runs:[{text:'보존된 원고',bold:true}]}]};
  await source.query('insert into authoring.draft_revisions values(1,$1,$2)',['보존된 원고',doc]);
  const rows=(await source.query('select to_jsonb(r)::text row from authoring.draft_revisions r')).rows.map(r=>r.row);
  const columns=(await source.query(`select n.nspname schema,c.relname "table",a.attname name,format_type(a.atttypid,a.atttypmod) type,a.attnum ordinal,a.attnotnull not_null
   from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='authoring' and c.relkind='r' and a.attnum>0 and not a.attisdropped`)).rows;
  const constraints=(await source.query(`select n.nspname schema,c.relname "table",co.conname name,co.contype type,pg_get_constraintdef(co.oid) definition
   from pg_constraint co join pg_class c on c.oid=co.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='authoring'`)).rows;
  const functions=(await source.query(`select n.nspname schema,p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='authoring'`)).rows;
  const snapshot={tables:[{schema:'authoring',name:'draft_revisions',rows,row_count:'1'}],columns,constraints,functions};
  const result=await restoreSnapshot(snapshot);restored=result.db;
  assert.equal(result.constraintValidators,1);assert.equal(result.applicationConstraints,constraints.length);assert.equal(result.verified[0].rows,1);
  assert.deepEqual((await restored.query('select content_document from authoring.draft_revisions')).rows[0].content_document,doc);
  await assert.rejects(restored.query('insert into authoring.draft_revisions values(2,$1,$2)',['다른 내용',doc]),/check constraint/);
  await restored.exec('create role backup_browser;grant usage on schema authoring to backup_browser');await restored.exec('set role backup_browser');
  await assert.rejects(restored.query('select authoring.document_valid($1,$2)',[doc,'보존된 원고']),/permission denied/);await restored.exec('reset role');
  await assert.rejects(restoreSnapshot({...snapshot,functions:[]}),/BACKUP_DOCUMENT_VALIDATOR_REQUIRED/);
  await assert.rejects(restoreSnapshot({...snapshot,functions:[{...functions[0],definition:functions[0].definition.replace(/IMMUTABLE/i,'VOLATILE')}]}),/BACKUP_DOCUMENT_VALIDATOR_CONTRACT/);
  const invalid=JSON.stringify({...JSON.parse(rows[0]),content:'검증에 맞지 않는 변경'});
  await assert.rejects(restoreSnapshot({...snapshot,tables:[{...snapshot.tables[0],rows:[invalid]}]}),/check constraint/);
 }finally{await restored?.close();await source.close();}
});
