import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const bootstrap=await read('database/launch/003_bootstrap_verified_admin.sql');

test('initial admin linking requires verified active Auth, preserves roles and evidence, and rejects replacement',async()=>{
  const db=await PGlite.create();
  try{
    await db.exec(`create schema auth;create schema authoring;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false,deleted_at timestamptz,banned_until timestamptz);
      create table public.admin_users(id uuid primary key,auth_user_id uuid unique references auth.users,role text,is_active boolean);
      create table authoring.migrations(version text primary key);
      create table authoring.identity_evidence(profile_kind text,profile_id text,auth_user_id uuid references auth.users,
        evidence_ref text,verified_by uuid references auth.users,primary key(profile_kind,profile_id),unique(profile_kind,auth_user_id));
      insert into authoring.migrations values('authoring-003');
      insert into auth.users(id,email) values('11111111-1111-4111-8111-111111111111','first@example.invalid'),('22222222-2222-4222-8222-222222222222','second@example.invalid');
      insert into admin_users values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'SUPER_ADMIN',true);
      set webnovels.bootstrap_profile_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      set webnovels.bootstrap_auth_user_id='11111111-1111-4111-8111-111111111111';
      set webnovels.bootstrap_evidence_ref='operator-owned-ticket-1';set webnovels.bootstrap_operator_ref='verified-db-operator';`);
    await assert.rejects(db.exec(bootstrap),/Confirmed active Auth user required/);await db.exec('rollback');
    assert.equal((await db.query('select auth_user_id from admin_users')).rows[0].auth_user_id,null);
    await db.exec('update auth.users set email_confirmed_at=now()');
    await db.exec(bootstrap);
    const first=(await db.query('select * from authoring.identity_evidence')).rows;
    assert.equal(first.length,1);assert.match(first[0].evidence_ref,/verified-db-operator/);
    await db.exec("set webnovels.bootstrap_evidence_ref='different-ticket';");await db.exec(bootstrap);
    assert.deepEqual((await db.query('select * from authoring.identity_evidence')).rows,first);
    await db.exec("set webnovels.bootstrap_auth_user_id='22222222-2222-4222-8222-222222222222'");
    await assert.rejects(db.exec(bootstrap),/Existing identity mapping conflicts/);await db.exec('rollback');
    assert.equal((await db.query('select role from admin_users')).rows[0].role,'SUPER_ADMIN');
    assert.equal((await db.query('select auth_user_id from admin_users')).rows[0].auth_user_id,first[0].auth_user_id);
  }finally{await db.close()}
});

test('repair transaction rejects stale body plan before changing any owner or archive',async()=>{
  const db=await PGlite.create();
  try{
    await db.exec(`create table authors(id bigint primary key);insert into authors values(7);
      create table works(id bigint primary key,author_id bigint);insert into works values(5,null);
      create table episodes(id bigint primary key,content text);insert into episodes values(6,'Original');
      create table episode_contents(episode_id bigint primary key,text_content text,content_version int,updated_at timestamptz);
      insert into episode_contents values(6,'Different',1,now());
      create temp table launch_context(batch_id text,backup_sha256 text,evidence_ref text);
      insert into launch_context values('test',repeat('a',64),'verified manuscript choice');
      create temp table launch_owner_plan(work_id bigint,author_id bigint,work_hash text,author_hash text,evidence_ref text);
      insert into launch_owner_plan select 5,7,md5(to_jsonb(w)::text),md5(to_jsonb(a)::text),'explicit source mapping' from works w cross join authors a;
      create temp table launch_body_plan(episode_id bigint,episode_hash text,content_hash text);
      insert into launch_body_plan values(6,'stale','stale');`);
    await assert.rejects(db.exec(await read('database/launch/001_reconcile_legacy_data.sql')),/Body plan stale/);
    await db.exec('rollback');
    assert.equal((await db.query('select author_id from works')).rows[0].author_id,null);
    assert.equal((await db.query('select text_content from episode_contents')).rows[0].text_content,'Different');
    assert.equal((await db.query("select to_regnamespace('launch_recovery') namespace")).rows[0].namespace,null);
  }finally{await db.close()}
});
