// Executes real PostgreSQL SQL in an isolated embedded engine. No env files/network/remote seed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');
const fixture = await read('scripts/fixtures/authoring_legacy.sql');
const expansion = await read('database/p0/001_expand_identity_content.sql');
const foundation = await read('database/authoring/001_authoring_foundation.sql');
const storage = await read('database/authoring/002_private_storage.sql');
const linking = await read('database/authoring/003_verified_identity_link.sql');
const integrity = await read('database/authoring/000_integrity_audit.sql');
const draft = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const version = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const digest = 'a'.repeat(64);
const key = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const hash = data => createHash('sha256').update(data).digest('hex');
async function setup(source = fixture) {
  const db = await PGlite.create();
  await db.exec(source);
  await db.exec(expansion);
  await db.exec("set webnovels.authoring_apply_verified='true'");
  return db;
}
async function denied(db, sql, code) {
  await assert.rejects(db.exec(sql), error => code ? (Array.isArray(code) ? code.includes(error.code) : error.code === code) : true);
  await db.exec('rollback; reset role;');
}

test('authoring migrations and preservation contracts', async t => {
  const db = await setup();
  const completed = [];
  const failed = [];
  const check = async (name, run) => t.test(name, async () => {
    try { await run(); completed.push(name); } catch(error) { failed.push(name); throw error; }
  });
  try {
    const legacy = JSON.stringify((await db.query('select * from public.episodes order by id')).rows);
    await check('additive migration and repeat application preserve IDs and bodies', async () => {
      await db.exec(foundation); await db.exec(storage); await db.exec(linking);
      await db.exec(foundation); await db.exec(storage); await db.exec(linking);
      assert.equal(JSON.stringify((await db.query('select * from public.episodes order by id')).rows), legacy);
      assert.equal((await db.query('select phase from public.p0_migration_status')).rows[0].phase, 'expanded');
      assert.equal((await db.query('select count(*)::int n from authoring.migrations')).rows[0].n, 3);
      assert.equal((await db.query('select revision_days from authoring.retention_policy')).rows[0].revision_days, null);
    });
    await check('read-only audit reports an episode gap without renumbering', async () => {
      const result = (await db.query(integrity)).rows[0].integrity_audit;
      assert.equal(result.episode_number_gaps, 1);
      assert.equal(result.duplicate_episode_number_groups, 0);
    });
    await db.exec(`insert into authoring.work_state(work_id,author_id) values(10,1),(20,2);
      begin;
      insert into authoring.drafts(id,work_id,author_id,episode_id) values('${draft}',10,1,100);
      insert into authoring.draft_revisions(draft_id,revision,title,content) values('${draft}',1,'Title','First');
      commit;`);
    await check('owner mismatch and cross-work episode attachment are rejected', async () => {
      await denied(db, `insert into authoring.drafts(work_id,author_id) values(10,2)`, '23503');
      await denied(db, `insert into authoring.drafts(work_id,author_id,episode_id) values(10,1,200)`, '23503');
    });
    await check('draft cannot commit without its current revision', async () => {
      await denied(db, 'insert into authoring.drafts(work_id,author_id) values(10,1)', '23503');
    });
    await check('service-only save increments revision and rejects a stale writer', async () => {
      await db.exec('set role service_role');
      assert.equal(Number((await db.query(`select authoring.save_draft($1,1,'Title','Second','') n`, [draft])).rows[0].n), 2);
      await denied(db, `select authoring.save_draft('${draft}',1,'Bad','Overwritten','')`, '40001');
      assert.equal((await db.query('select content from authoring.draft_revisions where revision=2')).rows[0].content, 'Second');
    });
    await check('revision updates and deletes are forbidden even for table owner', async () => {
      await denied(db, `update authoring.draft_revisions set content='changed' where draft_id='${draft}'`, '55000');
      await denied(db, `delete from authoring.draft_revisions where draft_id='${draft}'`, '55000');
    });
    await check('snapshot must match source revision and remains stable after editing', async () => {
      await denied(db, `insert into authoring.publication_versions(episode_id,work_id,source_draft_id,source_revision,title,content)
        values(100,10,'${draft}',2,'Title','Wrong')`, '23514');
      await db.exec(`insert into authoring.publication_versions(id,episode_id,work_id,source_draft_id,source_revision,title,content)
        values('${version}',100,10,'${draft}',2,'Title','Second');
        insert into authoring.publication_heads(episode_id,version_id) values(100,'${version}');
        select authoring.save_draft('${draft}',2,'Title','Third','');`);
      assert.equal((await db.query(`select v.content from authoring.publication_heads h join authoring.publication_versions v on v.id=h.version_id`)).rows[0].content, 'Second');
      await denied(db, `update authoring.publication_versions set content='changed'`, '55000');
    });
    await check('one episode number and one idempotent result; cross-work result rejected', async () => {
      await denied(db, `insert into public.episodes(id,work_id,episode_number) values(102,10,1)`, '23505');
      await denied(db, `insert into public.episodes(id,work_id,episode_number) values(102,10,null)`, '23514');
      await db.exec(`insert into authoring.publish_requests(work_id,idempotency_key,payload_sha256,result_version_id) values(10,'${key}','${digest}','${version}')`);
      await denied(db, `insert into authoring.publish_requests(work_id,idempotency_key,payload_sha256) values(10,'${key}','${digest}')`, '23505');
      await denied(db, `update authoring.publish_requests set payload_sha256='${'b'.repeat(64)}'`, '55000');
      await denied(db, `insert into authoring.publish_requests(work_id,idempotency_key,payload_sha256,result_version_id) values(20,'${key}','${digest}','${version}')`, '23503');
    });
    await check('schedule pins immutable snapshot; duplicate active job and cross-episode snapshot denied', async () => {
      await db.exec(`insert into authoring.schedules(episode_id,version_id,due_at) values(100,'${version}','2030-01-01T00:00:00Z')`);
      await denied(db, `insert into authoring.schedules(episode_id,version_id,due_at) values(100,'${version}',now())`, '23505');
      await denied(db, `insert into authoring.schedules(episode_id,version_id,due_at) values(200,'${version}',now())`, '23503');
      await denied(db, `update authoring.schedules set status='RUNNING'`, '23514');
      await db.exec(`update authoring.schedules set status='CANCELLED';
        insert into authoring.schedules(episode_id,version_id,due_at) values(100,'${version}',now())`);
    });
    await check('trash and moderation are independent from creator visibility', async () => {
      await db.exec(`update authoring.work_state set moderation_state='RESTRICTED',moderation_reason='test case' where work_id=10;
        update authoring.work_state set visibility='PUBLIC',trashed_at=now() where work_id=10;
        update authoring.work_state set trashed_at=null where work_id=10;`);
      assert.equal((await db.query('select moderation_state from authoring.work_state where work_id=10')).rows[0].moderation_state, 'RESTRICTED');
      await denied(db, `delete from public.works where id=10`, '23503');
      await db.exec(`update authoring.drafts set lifecycle='TRASHED',trashed_at=now() where id='${draft}'`);
      await denied(db, `select authoring.save_draft('${draft}',3,'x','x','')`, '55000');
      await db.exec(`update authoring.drafts set lifecycle='ACTIVE',trashed_at=null where id='${draft}'`);
    });
    await check('private schema cannot be read or written by anon/authenticated', async () => {
      for (const role of ['anon','authenticated']) {
        await denied(db, `set role ${role}; select * from authoring.drafts`, '42501');
        await denied(db, `set role ${role}; select authoring.save_draft('${draft}',3,'x','x','')`, '42501');
      }
    });
    await check('restrictive storage rule overrides legacy permissive policies, other bucket preserved', async () => {
      await db.exec(`insert into storage.objects(bucket_id,name) values('authoring-originals','private.txt'),('authoring-covers','cover.png'); set role anon;`);
      assert.deepEqual((await db.query('select name from storage.objects')).rows, [{name:'untouched'}]);
      await denied(db, `insert into storage.objects(bucket_id,name) values('authoring-originals','attack')`, '42501');
      assert.equal((await db.query(`select count(*)::int n from storage.buckets where id like 'authoring-%' and public`)).rows[0].n, 0);
    });
    await check('account mapping conflicts fail without overwriting original identities', async () => {
      await db.exec(`update public.authors set auth_user_id='11111111-1111-4111-8111-111111111111' where id=1`);
      await denied(db, `update public.authors set auth_user_id='11111111-1111-4111-8111-111111111111' where id=2`, '23505');
      assert.equal((await db.query('select auth_user_id from public.authors where id=2')).rows[0].auth_user_id,null);
    });
    await check('verified linking is atomic, idempotent and rejects impersonation/remapping', async () => {
      const verifier='11111111-1111-4111-8111-111111111111';
      const target='22222222-2222-4222-8222-222222222222';
      await denied(db, `select authoring.link_verified_identity('author','2','${target}','${verifier}','case:test')`, '42501');
      // Synthetic bootstrap represents an independently verified DBA action, not signup.
      await db.exec(`update public.admin_users set auth_user_id='${verifier}'`);
      await db.exec('set role service_role');
      assert.equal((await db.query(`select authoring.link_verified_identity('author','2',$1,$2,'case:test') linked`,[target,verifier])).rows[0].linked,true);
      assert.equal((await db.query(`select authoring.link_verified_identity('author','2',$1,$2,'case:retry') linked`,[target,verifier])).rows[0].linked,false);
      await denied(db, `select authoring.link_verified_identity('author','2','${verifier}','${verifier}','case:bad')`, '23505');
      await denied(db, `select authoring.link_verified_identity('reader','1','33333333-3333-4333-8333-333333333333','${verifier}','case:missing-auth')`, '23503');
      assert.equal((await db.query('select auth_user_id from public.readers where id=1')).rows[0].auth_user_id,null);
      assert.equal((await db.query('select count(*)::int n from authoring.identity_evidence')).rows[0].n,1);
    });
    await check('file references cannot cross works and referenced files cannot disappear', async () => {
      const file='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      await db.exec(`insert into authoring.files(id,work_id,author_id,bucket_id,object_key,purpose,sha256,byte_size)
        values('${file}',10,1,'authoring-originals','test.txt','MANUSCRIPT_ORIGINAL','${digest}',10);
        insert into authoring.revision_files values('${draft}',1,'${file}',10);`);
      await denied(db, `insert into authoring.revision_files values('${draft}',2,'${file}',20)`, '23503');
      await denied(db, `delete from authoring.files where id='${file}'`, ['23503','23001']);
    });
    await check('partial transaction failure rolls back and migration can be retried', async () => {
      await denied(db, foundation.replace('commit;', "select 1/0; commit;"), '22012');
      await db.exec(foundation);
      assert.equal(JSON.stringify((await db.query('select * from public.episodes order by id')).rows),legacy);
    });
    await check('locked P0 marker never becomes expanded during replay', async () => {
      await db.exec("update public.p0_migration_status set phase='locked'");
      await db.exec(expansion); await db.exec(foundation);
      assert.equal((await db.query('select phase from public.p0_migration_status')).rows[0].phase,'locked');
    });
    await check('local PostgreSQL backup restores legacy rows, versions and storage metadata', async () => {
      const blob = await db.dumpDataDir('none');
      const restored = await PGlite.create({loadDataDir:blob});
      try {
        assert.equal(JSON.stringify((await restored.query('select * from public.episodes order by id')).rows),legacy);
        assert.equal((await restored.query('select count(*)::int n from authoring.draft_revisions')).rows[0].n,3);
        assert.equal((await restored.query('select count(*)::int n from storage.objects')).rows[0].n,3);
        assert.equal((await restored.query('select content from authoring.publication_versions')).rows[0].content,'Second');
      } finally {await restored.close();}
    });
    await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
    await writeFile(new URL('../artifacts/step2-schema-verification.json',import.meta.url),JSON.stringify({
      checkedAt:new Date().toISOString(),engine:'PGlite isolated PostgreSQL',syntheticDataOnly:true,
      scope:'main preservation contracts; separate variant/gate tests reported by test runner',
      status:failed.length?'failed':'passed',tests:completed,failed,
      realConcurrentConnectionsTested:false,productionApplied:false,
      realSupabaseBackupRestored:false,storageObjectBytesRestored:false,
      migrations:{foundation:hash(foundation),storage:hash(storage),linking:hash(linking)}
    },null,2)+'\n');
  } finally {await db.close();}
});

test('conflicting legacy numbering aborts the entire expansion', async () => {
  const db=await setup();
  try {
    await db.exec("insert into public.episodes(id,work_id,episode_number) values(999,10,1)");
    await denied(db,foundation,'23505');
    assert.equal((await db.query("select to_regnamespace('authoring') n")).rows[0].n,null);
    assert.equal((await db.query('select count(*)::int n from public.episodes')).rows[0].n,4);
  } finally {await db.close();}
});

test('UUID reader/admin and bigint content schema variant is supported', async () => {
  const variant=fixture.replace('readers(id integer primary key','readers(id uuid primary key')
    .replace('public.readers(id) values(1)',"public.readers(id) values('22222222-2222-4222-8222-222222222222')")
    .replaceAll('integer primary key','bigint primary key').replaceAll('author_id integer','author_id bigint').replaceAll('work_id integer','work_id bigint');
  const db=await setup(variant);
  try {await db.exec(foundation); await db.exec(storage); await db.exec(linking);} finally {await db.close();}
});

test('unreviewed application gate and public bucket collision fail closed', async () => {
  const db=await setup();
  try {
    await db.exec("set webnovels.authoring_apply_verified='false'");
    await denied(db,foundation,'P0001');
    assert.equal((await db.query("select to_regnamespace('authoring') n")).rows[0].n,null);
    await db.exec("set webnovels.authoring_apply_verified='true'");
    await db.exec(foundation);
    await db.exec("insert into storage.buckets values('authoring-originals','authoring-originals',true)");
    await denied(db,storage,'P0001');
    assert.equal((await db.query("select public from storage.buckets where id='authoring-originals'")).rows[0].public,true);
  } finally {await db.close();}
});
