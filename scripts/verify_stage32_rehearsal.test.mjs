import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {rehearseExpansion} from './rehearse_stage32.mjs';

async function fixture(conflict=false) {
  const db=await PGlite.create();
  try {
    await db.exec(await readFile(new URL('./fixtures/authoring_legacy.sql',import.meta.url),'utf8'));
    if(conflict)await db.exec(`create table episode_contents(episode_id integer primary key references episodes(id),text_content text);
      insert into episode_contents values(100,'private conflicting manuscript');`);
    const tables=(await db.query(`select n.nspname schema,c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','auth','storage') and c.relkind='r' order by 1,2`)).rows;
    for(const t of tables) {
      t.rows=(await db.query(`select to_jsonb(r)::text row from ${t.schema}.${t.name} r`)).rows.map(r=>r.row);
      t.row_count=String(t.rows.length);
    }
    const columns=(await db.query(`select n.nspname schema,c.relname "table",a.attname name,format_type(a.atttypid,a.atttypmod) type,
      a.attnum ordinal,a.attnotnull not_null from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','auth','storage') and c.relkind='r' and a.attnum>0 and not a.attisdropped`)).rows;
    const constraints=(await db.query(`select n.nspname schema,c.relname "table",co.conname name,co.contype type,pg_get_constraintdef(co.oid) definition
      from pg_constraint co join pg_class c on c.oid=co.conrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','auth','storage')`)).rows;
    return {tables,columns,constraints};
  }finally{await db.close();}
}

test('real migration refuses differing legacy bodies, rolls back and preserves every original row',async()=>{
  const report=await rehearseExpansion(await fixture(true));
  assert.equal(report.result,'LEGACY_CONTENT_CONFLICT');assert.equal(report.originalRowsMatch,true);
  assert.equal(report.failedExpansionRolledBack,true);assert.equal(report.productionApplied,false);
  assert.doesNotMatch(JSON.stringify(report),/private conflicting manuscript/);
});

test('local expansion success still cannot claim hosted restoration or production acceptance',async()=>{
  const report=await rehearseExpansion(await fixture());
  assert.equal(report.result,'EXPANSION_APPLIED_LOCALLY');assert.equal(report.originalRowsMatch,true);
  assert.equal(report.hostedRestoreAccepted,false);assert.equal(report.fullSchemaRestore,false);
  assert.equal(report.productionApplied,false);assert.equal(report.failedExpansionRolledBack,false);
});

test('unexpected schema failures are withheld and remain failures, never accepted as an expected conflict',async()=>{
  const snapshot=await fixture();
  snapshot.tables=snapshot.tables.filter(t=>t.name!=='admin_users');
  snapshot.constraints=snapshot.constraints.filter(c=>c.table!=='admin_users');
  const report=await rehearseExpansion(snapshot);
  assert.equal(report.result,'EXPANSION_REHEARSAL_FAILED');assert.equal(report.failedExpansionRolledBack,true);
  assert.equal(report.originalRowsMatch,true);assert.equal(report.hostedRestoreAccepted,false);
});
