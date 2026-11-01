import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {PGlite} from '@electric-sql/pglite';
const {functionSnapshotSql,triggerSnapshotSql}=createRequire(import.meta.url)('./backup_launch_data.cjs');
test('logical backup preserves actual function owners and all trigger execution modes across JSON',async()=>{
  const db=await PGlite.create();
  try{
    await db.exec("create role source_owner;grant usage,create on schema public to source_owner;create table public.catalog_probe(id int);create function public.catalog_probe_fn() returns trigger language plpgsql as $$begin return new;end$$;alter function public.catalog_probe_fn() owner to source_owner;");
    for(const [name,mode]of [['normal','enable'],['disabled','disable'],['replica','enable replica'],['always','enable always']])await db.exec(`create trigger ${name} before insert on public.catalog_probe for each row execute function public.catalog_probe_fn();alter table public.catalog_probe ${mode} trigger ${name};`);
    const captured=(await db.query(`select (${functionSnapshotSql}) functions,(${triggerSnapshotSql}) triggers`)).rows[0],roundTrip=JSON.parse(JSON.stringify(captured));
    const fn=roundTrip.functions.find(row=>row.signature==='catalog_probe_fn()'||row.signature==='public.catalog_probe_fn()');assert(fn);assert.equal(fn.owner,'source_owner');assert.match(fn.definition,/RETURNS trigger/);
    const states=Object.fromEntries(roundTrip.triggers.filter(row=>row.table==='catalog_probe').map(row=>[row.definition.match(/^CREATE TRIGGER (\w+)/)[1],row.enabled]));
    assert.deepEqual(states,{normal:'O',disabled:'D',replica:'R',always:'A'});
    await db.exec('alter table public.catalog_probe enable trigger disabled');
    const later=(await db.query(`select (${triggerSnapshotSql}) triggers`)).rows[0].triggers.find(row=>row.table==='catalog_probe'&&row.definition.startsWith('CREATE TRIGGER disabled '));
    assert.equal(later.definition,roundTrip.triggers.find(row=>row.table==='catalog_probe'&&row.enabled==='D').definition,'definitions alone cannot detect mode changes');assert.equal(later.enabled,'O');
  }finally{await db.close();}
});
