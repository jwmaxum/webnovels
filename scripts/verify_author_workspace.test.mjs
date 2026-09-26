import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {accountApi} from '../server/account-api.mjs';
import {workspaceSql,verifyWorkspace} from './prepare_author_workspace.mjs';
const read=p=>fs.readFileSync(p,'utf8');
const author='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',reader='33333333-3333-4333-8333-333333333333',admin='44444444-4444-4444-8444-444444444444';

test('private workspace applies canonical storage without publishing legacy bodies, preserves records and guards revisions',async()=>{
 const db=await PGlite.create();try{
  await db.exec(read('scripts/fixtures/authoring_legacy.sql'));
  await db.exec(`alter table auth.users add email text,add email_confirmed_at timestamptz default now(),add is_anonymous boolean default false,add banned_until timestamptz,add deleted_at timestamptz;
    insert into auth.users(id) values('${reader}'),('${admin}');
    alter table authors add pen_name text default 'Writer',add username text,add profile_image text,add bio text;
    update authors set auth_user_id=case id when 1 then '${author}'::uuid else '${other}'::uuid end;
    alter table readers add auth_user_id uuid,add username text,add nickname text,add is_adult_verified boolean,add adult_verified_at timestamptz,add points integer;
    update readers set auth_user_id='${reader}';
    alter table admin_users add auth_user_id uuid,add username text,add nickname text,add permissions text[];
    update admin_users set auth_user_id='${admin}';
    alter table works add title text not null default 'Title',add description text,add author text,add genre text[] default '{}',add tags text[] default '{}',add ai_usage_type text default 'NONE',add cover_image text,add content_type text default 'NOVEL',add is_completed boolean default false,add is_top_recommended boolean default false,add is_popular_work boolean default false,add is_new_work boolean default false;
    alter table episodes add scheduled_at timestamptz;
    create table episode_contents(episode_id integer primary key,text_content text);
    insert into episode_contents values(100,'Disputed source retained');
    create table episode_drafts(id uuid primary key,work_id bigint,author_id bigint,server_revision bigint,title text,content text,author_comment text,updated_at timestamptz);
    insert into episode_drafts values('${author}',10,1,1,'Draft','Retained draft','',now());
    create table episode_draft_revisions(draft_id uuid,server_revision bigint,title text,content text,author_comment text,created_at timestamptz);`);
  await db.exec(read('database/launch/004_virtual_accounts.sql'));
  await db.exec(`insert into launch_recovery.account_links(kind,profile_id,auth_user_id,evidence_ref,operator_ref,backup_sha256)
    values('author','1','${author}','fixture','test',repeat('a',64)),('author','2','${other}','fixture','test',repeat('a',64)),('reader','1','${reader}','fixture','test',repeat('a',64)),('admin','${author}','${admin}','fixture','test',repeat('a',64));
    update launch_recovery.account_service set enabled=true;`);
  await assert.rejects(db.exec(read('database/authoring/001_authoring_foundation.sql')),/review gate/);await db.exec('rollback');
  await db.exec(workspaceSql('a'.repeat(64)));
  assert.equal((await db.query('select launch_author_workspace_ready() ready')).rows[0].ready,true);
  await verifyWorkspace(db,[author,other,reader]);
  assert.equal((await db.query("select to_regclass('public.p0_migration_status') marker")).rows[0].marker,null);
  assert.equal((await db.query('select text_content from episode_contents')).rows[0].text_content,'Disputed source retained');
  assert.equal((await db.query('select content from authoring.draft_revisions where draft_id=$1',[author])).rows[0].content,'Retained draft');
  await db.exec(workspaceSql('a'.repeat(64)));
  assert.equal((await db.query('select count(*)::int n from works')).rows[0].n,2);
  await db.exec('grant update on works to authenticated');
  assert.equal((await db.query('select launch_author_workspace_ready() ready')).rows[0].ready,false);
 }finally{await db.close();}
});

test('account routes reuse verified actor and canonical work/draft RPCs, deny reader, forged fields and unavailable workspace',async()=>{
 let who={userId:author,author:{id:'1',status:'APPROVED'}},ready=true,calls=[];
 const invoke=async(path,options={})=>accountApi(new Request('https://example.test'+path,{headers:{Authorization:'Bearer abc.def.ghi',Origin:'https://example.test','Content-Type':'application/json',...options.headers},...options}),
 {SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'}, {fetchImpl:async(url,opts)=>{
  const route=new URL(url).pathname;
  if(route.endsWith('launch_accounts_ready'))return Response.json(true);
  if(route.endsWith('launch_author_workspace_ready'))return Response.json(ready);
  if(route==='/auth/v1/user')return Response.json({id:who.userId,email_confirmed_at:'2026-09-26'});
  if(route.endsWith('launch_account_actor'))return Response.json(who);
  calls.push({route,body:JSON.parse(opts.body)});return Response.json({works:[],drafts:[]});
 }});
 let r=await invoke('/api/v2/me');assert.equal((await r.json()).authorWorkspaceReady,true);
 assert.equal((await invoke('/api/v2/creator/works')).status,200);assert.equal(calls.at(-1).body.p_user_id,author);
 assert.equal((await invoke('/api/v2/creator/drafts?workId=10')).status,200);
 r=await invoke('/api/v2/creator/works/10',{method:'PATCH',body:JSON.stringify({version:'1',author_id:'2'})});assert.equal(r.status,400);
 const before=calls.length;
 r=await invoke('/api/v2/creator/works/10',{method:'PATCH',headers:{Authorization:'Bearer abc.def.ghi',Origin:'https://evil.test','Content-Type':'application/json'},body:JSON.stringify({version:'1',title:'no'})});assert.equal(r.status,403);assert.equal(calls.length,before);
 ready=false;assert.equal((await invoke('/api/v2/creator/works')).status,503);assert.equal((await (await invoke('/api/v2/me')).json()).authorWorkspaceReady,false);
 who={userId:reader,reader:{id:'1',status:'ACTIVE'}};ready=true;assert.equal((await invoke('/api/v2/creator/works')).status,403);
 assert.equal(await invoke('/api/v2/creator/files'),null);assert.equal(await invoke('/api/v2/creator/publications'),null);
});

test('file/publication dialogs are hidden by default and reject non-author or outside-studio openings',()=>{
 const html=read('public/index.html'),css=read('public/styles.css');
 for(const id of ['modalCreatorFiles','modalCreatorPublication'])assert.match(html,new RegExp('<div class="modal-backdrop" id="'+id+'"[^>]+hidden>'));
 assert.match(css,/\.modal-backdrop\[hidden\]\s*\{\s*display:\s*none\s*!important/);
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,active:false,classList:{add(){get(id).active=true;},remove(){get(id).active=false;}}});return nodes.get(id);};
 let who=null;
 const c={document:{getElementById:get,querySelectorAll:()=>[...nodes.values()]},WebNovelsAuth:{getActor:()=>who},location:{pathname:'/home'},WEBNOVELS_CONFIG:{authorFilesEnabled:true,authorPublishEnabled:true}};
 c.window=c;vm.createContext(c);vm.runInContext(read('public/js/core/ui-utils.js'),c);
 for(const actor of [null,{reader:{}},{admin:{role:'SUPER_ADMIN'}},{author:{status:'APPROVED'}}]){
  who=actor;c.openModal('modalCreatorFiles');assert.equal(get('modalCreatorFiles').hidden,true);
 }
 c.location.pathname='/creator/works/10';who={author:{status:'APPROVED'}};
 c.openModal('modalCreatorFiles');assert.equal(get('modalCreatorFiles').active,true);assert.equal(get('modalCreatorFiles').hidden,false);
 c.closeAllModals();assert.equal(get('modalCreatorFiles').hidden,true);assert.equal(get('modalCreatorFiles').active,false);
 c.WEBNOVELS_CONFIG.authorFilesEnabled=false;c.openModal('modalCreatorFiles');assert.equal(get('modalCreatorFiles').hidden,true);
 who={reader:{}};c.location.pathname='/creator/works/10';c.WEBNOVELS_CONFIG.authorFilesEnabled=true;
 c.openModal('modalCreatorFiles');assert.equal(get('modalCreatorFiles').hidden,true);
});

test('author workspace readiness removes the account placeholder only for an approved author',()=>{
 let who={accountServiceOnly:true,authorWorkspaceReady:true,author:{status:'APPROVED'}};
 const classes=new Set(),notice={hidden:true},root={classList:{toggle:(key,value)=>value?classes.add(key):classes.delete(key)},querySelector:()=>null,prepend(){}};
 const c={document:{getElementById:id=>id==='authorWorkspaceNotice'?notice:root,createElement:()=>({append(){}})},WebNovelsAuth:{getActor:()=>who}};
 c.window=c;vm.createContext(c);vm.runInContext(read('public/js/core/account-access.js'),c);
 assert.equal(c.showAccountAccessSummary('view-creator'),false);assert.equal(classes.has('account-only'),false);assert.equal(notice.hidden,false);
 vm.runInContext(read('public/js/creator/creator-works.js'),c);
 const detail=c.CreatorWorks.renderDetail({id:'10',title:'내 작품',visibility:'PRIVATE',moderation_state:'CLEAR',publication_missing:[]},[],'episodes');
 assert.match(detail,/id="cwDrafts"/);assert.match(detail,/data-detail-tab="settings"/);
 assert.doesNotMatch(detail,/id="cwFiles"|id="cwPublications"|data-detail-tab="reactions"/);
 who={accountServiceOnly:true,reader:{nickname:'Reader'}};assert.equal(c.showAccountAccessSummary('view-mypage'),true);assert.equal(classes.has('account-only'),true);
 who={accountServiceOnly:true,author:{status:'APPROVED'}};assert.equal(c.showAccountAccessSummary('view-creator'),true);assert.equal(notice.hidden,true);
});
