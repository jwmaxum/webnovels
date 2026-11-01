import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {PGlite} from '@electric-sql/pglite';
const require=createRequire(import.meta.url),{sequenceSnapshotSql}=require('./backup_launch_data.cjs');

test('real sequence catalog metadata survives API JSON and backup round trips above MAX_SAFE_INTEGER',async()=>{
  const db=await PGlite.create();
  try{
    await db.exec('create sequence public.precision_max start 9999999999999999 maxvalue 9223372036854775807 cache 2;create sequence public.precision_negative minvalue -9223372036854775808 maxvalue -1 start -9999999999999999 increment -1;');
    await db.query("select nextval('public.precision_max')::text");
    const captured=(await db.query('select ('+sequenceSnapshotSql+') snapshot')).rows[0].snapshot;
    const roundTrip=JSON.parse(JSON.stringify(JSON.parse(JSON.stringify(captured))));
    const expected=(await db.query("select sequencename,start_value::text,min_value::text,max_value::text,increment_by::text,cache_size::text,last_value::text from pg_sequences where schemaname='public' order by sequencename")).rows;
    for(const source of expected){
      const actual=roundTrip.find(row=>row.sequencename===source.sequencename);assert(actual);
      for(const key of ['start_value','min_value','max_value','increment_by','cache_size','last_value'])assert.equal(actual[key],source[key],source.sequencename+'.'+key);
      assert.equal(typeof actual.cycle,'boolean');
    }
    const maximum=roundTrip.find(row=>row.sequencename==='precision_max'),negative=roundTrip.find(row=>row.sequencename==='precision_negative');
    assert.equal(maximum.max_value,'9223372036854775807');assert.equal(maximum.start_value,'9999999999999999');assert.equal(negative.min_value,'-9223372036854775808');
    await db.exec('create schema replay');
    for(const row of roundTrip){
      assert(/^[a-z_]+$/.test(row.sequencename));for(const key of ['start_value','min_value','max_value','increment_by','cache_size'])assert(/^-?\d+$/.test(row[key]));
      await db.exec(`create sequence replay.${row.sequencename} start ${row.start_value} minvalue ${row.min_value} maxvalue ${row.max_value} increment ${row.increment_by} cache ${row.cache_size}`);
    }
    const replay=(await db.query("select sequencename,start_value::text,min_value::text,max_value::text,increment_by::text,cache_size::text from pg_sequences where schemaname='replay' order by sequencename")).rows;
    assert.deepEqual(replay,expected.map(({last_value,...row})=>row));
  }finally{await db.close();}
});
