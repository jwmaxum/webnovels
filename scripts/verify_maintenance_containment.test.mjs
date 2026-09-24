import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const sql=await read('database/p0/003_maintenance_containment.sql');

test('P0 expansion refuses divergent legacy bodies atomically and preserves both sources',async()=>{
 const db=await PGlite.create();
 try {
  await db.exec(await read('scripts/fixtures/authoring_legacy.sql'));
  await db.exec("create table public.episode_contents(episode_id bigint primary key,text_content text); insert into public.episode_contents values(100,'Other preserved body')");
  await assert.rejects(db.exec(await read('database/p0/001_expand_identity_content.sql')),/Legacy body sources disagree/);
  await db.exec('rollback');
  assert.equal((await db.query("select to_regclass('public.secure_episode_contents') marker")).rows[0].marker,null);
  assert.equal((await db.query('select content from public.episodes where id=100')).rows[0].content,'Original body');
  assert.equal((await db.query('select text_content from public.episode_contents where episode_id=100')).rows[0].text_content,'Other preserved body');
  // Matching sources are safe to copy; the original table still remains available for preservation.
  await db.exec("update public.episode_contents set text_content='Original body'");
  await db.exec(await read('database/p0/001_expand_identity_content.sql'));
  assert.equal((await db.query('select content from public.secure_episode_contents where episode_id=100')).rows[0].content,'Original body');
 } finally {await db.close();}
});

test('maintenance containment preserves rows, blocks legacy privileges and retains filtered metadata without activating P0',async()=>{
 const db=await PGlite.create();
 try {
  await db.exec(await read('scripts/fixtures/authoring_legacy.sql'));
  await db.exec(`alter table authors add username text,add pen_name text,add profile_image text,add bio text,add password_hash text;
    alter table works add title text,add author text,add genre text[] default '{}',add tags text[],add description text,add cover_image text,
      add view_count integer,add like_count integer,add created_at timestamptz,add is_top_recommended boolean,add is_popular_work boolean,
      add is_new_work boolean,add content_type text default 'NOVEL',add is_completed boolean,add ai_usage_type text,add published_at timestamptz;
    alter table episodes add is_free boolean default true,add is_ad_free boolean,add author_comment text,add scheduled_at timestamptz,
      add access_policy text default 'FREE',add view_count integer,add created_at timestamptz;
    create view public.body_view as select content from public.episodes;
    create function public.legacy_body() returns text language sql security definer as 'select content from public.episodes limit 1';
    grant all on all tables in schema public to public,anon,authenticated,service_role;
    grant select(password_hash) on authors to anon;
    grant execute on function public.legacy_body() to public,anon,authenticated,service_role;
    create policy legacy_open on works for all to public using(true) with check(true);
    create policy legacy_open on episodes for all to public using(true) with check(true);
    create policy legacy_open on authors for all to public using(true) with check(true);
    insert into works(id,author_id,status,rating) values(30,1,'PUBLISHED','AGE_19'),(40,1,'PUBLISHED','ALL');
    update works set genre=array['성인'] where id=40;
    insert into episodes(id,work_id,episode_number,status,is_free,access_policy,scheduled_at) values
      (301,10,4,'PUBLISHED',false,'FREE',null),(302,10,5,'PUBLISHED',true,'PAID',null),
      (303,10,6,'PUBLISHED',true,'FREE','2099-01-01'),(304,30,1,'PUBLISHED',true,'FREE',null);`);
  const before=JSON.stringify((await db.query('select to_jsonb(e) as row from episodes e order by id')).rows);
  await assert.rejects(db.exec(sql),/Reviewed permission backup/); await db.exec('rollback');
  await db.exec("set webnovels.containment_reviewed='true'");await db.exec(sql);await db.exec(sql);
  for(const role of ['anon','authenticated']) {
    await db.exec('set role '+role);
    assert.deepEqual((await db.query('select id from works order by id')).rows,[{id:10}]);
    assert.deepEqual((await db.query('select id from episodes order by id')).rows,[{id:100}]);
    for(const query of ['select password_hash from authors','select * from readers','select content from episodes',
      'select * from body_view','select legacy_body()',"update works set title='attacker' where id=10"])
      await assert.rejects(db.query(query),e=>e.code==='42501');
    await db.exec('reset role');
  }
  await db.exec('set role service_role'); assert.equal((await db.query('select count(*)::int n from episodes')).rows[0].n,7);
  await db.exec('reset role');
  assert.equal(JSON.stringify((await db.query('select to_jsonb(e) as row from episodes e order by id')).rows),before);
  assert.equal((await db.query("select to_regclass('public.p0_migration_status') marker")).rows[0].marker,null);
  // A restricted audit role cannot see other roles in information_schema.role_table_grants.
  await db.exec('create role audit_reader; grant usage on schema public to audit_reader; grant select on works,episodes,authors,readers to audit_reader; grant usage on schema storage to audit_reader; grant select on storage.objects,storage.buckets to audit_reader; set role audit_reader');
  const audit=(await db.query(await read('database/p0/000_preflight.sql'))).rows[0].audit;
  assert.ok(audit.column_grants.some(g=>g.table_name==='works'&&g.column_name==='id'&&g.grantee==='anon'));
  assert.ok(audit.table_grants.some(g=>g.table_name==='episodes'&&g.grantee==='service_role'));
 } finally {await db.close();}
});
