import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup,admin,reader,limited} from './fixtures/stage17-db.mjs';
const call=async(db,who,action,data={})=>(await db.query('select public.stage17_admin($1,$2,$3) r',[who,action,JSON.stringify(data)])).rows[0].r;
const mutation=(data={})=>({requestId:randomUUID(),reason:'검토 근거 확인',...data});
const one=async(db,query,values=[])=>(await db.query(query,values)).rows[0];
const metadata=(id,more={})=>mutation({source:'CONTENT_REVIEW',caseId:id,revision:'0',targetVersion:'',assigneeId:limited,priority:'HIGH',dueAt:null,evidence:'신고 본문과 원본을 대조했습니다.',duplicateId:null,...more});
const first=async db=>(await call(db,admin,'cases',{source:'CONTENT_REVIEW'})).cases[0];
const visible=async db=>db.exec(`insert into authoring.publication_versions(episode_id,work_id,title,content) values(100,10,'공개 원고','공개 내용');
 insert into authoring.publication_heads(episode_id,version_id,published_at) select episode_id,id,now()-interval '1 hour' from authoring.publication_versions;`);
const placement=(more={})=>mutation({placementId:randomUUID(),revision:'0',workId:'10',slot:'HOME_RECOMMENDED',position:1,
 startsAt:'2020-01-01T00:00:00.000Z',endsAt:'2099-01-01T00:00:00.000Z',enabled:true,...more});
const submitAppeal=async(db,source,sourceId,who=admin)=>{
 const r=(await db.query('select public.stage9_appeal($1,$2,$3) r',[who,'submit',JSON.stringify({source,sourceId,reason:'원조치 재검토를 요청합니다.'})])).rows[0].r;
 assert.equal(r.saved,true);return (await call(db,admin,'appeals')).appeals[0];
};

test('stage17 migration is repeatable, gated and service-only; history is immutable',async()=>{
 const {db,sql}=await setup();try{
  await db.exec(sql);await db.exec("set webnovels.authoring_apply_verified='false'");await assert.rejects(db.exec(sql),/Reviewed/);await db.exec('rollback');
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(call(db,admin,'cases',{source:'CONTENT_REVIEW'}));await assert.rejects(db.query('select public.stage17_editorial()'));await db.exec('reset role');}
  await db.exec('set role service_role');assert.ok((await first(db)).id);await assert.rejects(db.query('select * from authoring.workflow_receipts'));await db.exec('reset role');
  const item=await first(db);assert.equal((await call(db,admin,'case-update',metadata(item.id))).saved,true);
  await assert.rejects(db.exec("update authoring.workflow_events set reason='rewrite'"),/append-only/);
  await assert.rejects(db.exec('delete from authoring.workflow_receipts'),/append-only/);
 }finally{await db.close();}
});
test('read permissions cannot mutate and revoked permissions reject the same session and receipt',async()=>{
 const {db}=await setup();try{
  await db.query("update admin_users set permissions='[\"CASE_READ\"]' where id=$1",[limited]);
  const item=(await call(db,limited,'cases',{source:'CONTENT_REVIEW'})).cases[0];
  for(const action of ['case-update','case-resolve','draft-read','curation-save','account-moderate','moderate','appeal-followup'])assert.equal((await call(db,limited,action,metadata(item.id))).status,403,action);
  await db.query("update admin_users set permissions='[\"CASE_READ\",\"CASE_RESOLVE\"]' where id=$1",[limited]);
  const payload=metadata(item.id);assert.equal((await call(db,limited,'case-update',payload)).saved,true);
  await db.query("update admin_users set permissions='[\"CASE_READ\"]' where id=$1",[limited]);
  assert.equal((await call(db,limited,'case-update',payload)).status,403);
  await db.query('update admin_users set is_active=false where id=$1',[limited]);assert.equal((await call(db,limited,'cases',{source:'CONTENT_REVIEW'})).status,403);
 }finally{await db.close();}
});
test('case metadata, duplicate references, CAS and cycle protection preserve every original',async()=>{
 const {db}=await setup();try{
  const item=await first(db);
  const next=(await one(db,"insert into content_reviews(work_id,work_title_snapshot,author_name_snapshot) values(10,'중복 검수','필명') returning id")).id;
  const other=(await one(db,"insert into content_reviews(work_id,work_title_snapshot,author_name_snapshot) values(20,'다른 작품','필명') returning id")).id;
  assert.equal((await call(db,admin,'case-update',metadata(item.id,{duplicateId:other}))).error,'INVALID_DUPLICATE');
  assert.equal((await call(db,admin,'case-update',metadata(item.id,{duplicateId:next}))).revision,'1');
  assert.equal((await call(db,admin,'case-update',metadata(next,{duplicateId:item.id}))).error,'INVALID_DUPLICATE');
  assert.equal((await call(db,admin,'case-update',metadata(item.id))).error,'CASE_CONFLICT');
  const payload=metadata(next);const results=await Promise.all([call(db,admin,'case-update',payload),call(db,admin,'case-update',metadata(next))]);
  assert.equal(results.filter(x=>x.saved).length,1);assert.equal(results.filter(x=>x.status===409).length,1);
  assert.equal((await one(db,'select count(*)::int n from content_reviews')).n,3);
 }finally{await db.close();}
});
test('case closure needs evidence and atomically records one event, receipt and author notice on retry',async()=>{
 const {db}=await setup();try{
  const item=await first(db),resolve=mutation({source:item.source,caseId:item.id,revision:'0',decision:'RESOLVE'});
  assert.equal((await call(db,admin,'case-resolve',resolve)).error,'EVIDENCE_REQUIRED');
  assert.equal((await call(db,limited,'case-update',metadata(item.id))).revision,'1');resolve.revision='1';
  const results=await Promise.all([call(db,limited,'case-resolve',resolve),call(db,limited,'case-resolve',resolve)]);
  assert.deepEqual(results[0],results[1]);assert.equal(results[0].saved,true);
  assert.equal((await one(db,'select count(*)::int n from authoring.admin_case_events')).n,1);
  assert.equal((await one(db,"select count(*)::int n from authoring.creator_notices where title='사건 처리 결과'")).n,1);
  assert.equal((await call(db,limited,'case-resolve',{...resolve,decision:'REJECT'})).error,'REQUEST_CONFLICT');
  assert.equal((await call(db,admin,'case-update',metadata(item.id,{revision:'2'}))).error,'CASE_CLOSED');
 }finally{await db.close();}
});
test('appeal acceptance leaves restriction until an explicit idempotent followup, visible to its requester',async()=>{
 const {db}=await setup();try{
  let version=(await call(db,admin,'work-list')).works.find(x=>x.id==='10').version;
  assert.equal((await call(db,admin,'moderate',mutation({workId:'10',version,decision:'RESTRICT'}))).saved,true);
  const action=(await one(db,"select id from authoring.admin_work_actions where action='RESTRICT'")).id;
  const ap=await submitAppeal(db,'WORK_MODERATION',action);
  assert.equal((await call(db,admin,'appeal-resolve',mutation({appealId:ap.id,decision:'ACCEPT'}))).saved,true);
  assert.equal((await one(db,'select moderation_state from authoring.work_state where work_id=10')).moderation_state,'RESTRICTED');
  const current=(await call(db,admin,'appeals')).appeals[0];
  const follow=mutation({appealId:ap.id,decision:'UNRESTRICT',targetVersion:current.targetVersion});
  assert.equal((await call(db,admin,'appeal-followup',follow)).saved,true);assert.equal((await call(db,admin,'appeal-followup',follow)).saved,true);
  assert.equal((await one(db,'select moderation_state from authoring.work_state where work_id=10')).moderation_state,'CLEAR');
  const mine=(await one(db,'select public.stage17_my_appeals($1) r',[admin])).r;
  assert.equal(mine.appeals[0].followup.decision,'UNRESTRICT');
  assert.equal((await one(db,'select public.stage17_my_appeals($1) r',[reader])).r.appeals.length,0);
  assert.equal((await one(db,"select count(*)::int n from authoring.creator_notices where title='이의제기 후속 조치'")).n,1);
 }finally{await db.close();}
});
test('an accepted old appeal cannot release a newer work restriction',async()=>{
 const {db}=await setup();try{
  const moderate=async decision=>{const w=(await call(db,admin,'work-list')).works.find(x=>x.id==='10');return call(db,admin,'moderate',mutation({workId:'10',version:w.version,decision}));};
  await moderate('RESTRICT');const action=(await one(db,"select id from authoring.admin_work_actions where action='RESTRICT'")).id;
  const ap=await submitAppeal(db,'WORK_MODERATION',action);await call(db,admin,'appeal-resolve',mutation({appealId:ap.id,decision:'ACCEPT'}));
  await moderate('UNRESTRICT');await moderate('RESTRICT');
  const current=(await call(db,admin,'appeals')).appeals[0];
  assert.equal((await call(db,admin,'appeal-followup',mutation({appealId:ap.id,decision:'UNRESTRICT',targetVersion:current.targetVersion}))).error,'NEWER_MODERATION');
  assert.equal((await call(db,admin,'appeal-followup',mutation({appealId:ap.id,decision:'MAINTAIN',targetVersion:''}))).saved,true);
 }finally{await db.close();}
});
test('comment report resolution and separate appeal release preserve report and comment rows',async()=>{
 const {db}=await setup();try{
  const comment=(await one(db,"insert into comments(user_id,nickname_snapshot,work_id,content) values($1,'독자',10,'댓글') returning id",[reader])).id;
  const report=(await one(db,"insert into authoring.comment_reports(comment_id,work_id,reporter_user_id,reason) values($1,10,$2,'신고 사유') returning id",[comment,reader])).id;
  const loaded=(await call(db,admin,'cases',{source:'COMMENT_REPORT'})).cases[0];
  await call(db,admin,'case-update',metadata(report,{source:'COMMENT_REPORT',assigneeId:null,targetVersion:loaded.targetVersion}));
  assert.equal((await call(db,admin,'cases',{source:'COMMENT_REPORT'})).cases[0].subject.content,'댓글');
  await db.query("update comments set content='수정된 댓글',updated_at=now() where id=$1",[comment]);
  assert.equal((await call(db,admin,'case-resolve',mutation({source:'COMMENT_REPORT',caseId:report,revision:'1',decision:'RESOLVE'}))).error,'REVIEW_TARGET_CHANGED');
  assert.equal((await call(db,admin,'case-update',metadata(report,{source:'COMMENT_REPORT',assigneeId:null,revision:'1',targetVersion:loaded.targetVersion}))).error,'REVIEW_TARGET_CHANGED');
  await call(db,admin,'case-update',metadata(report,{source:'COMMENT_REPORT',assigneeId:null,revision:'1',targetVersion:(await call(db,admin,'cases',{source:'COMMENT_REPORT'})).cases[0].targetVersion}));
  assert.equal((await call(db,admin,'case-resolve',mutation({source:'COMMENT_REPORT',caseId:report,revision:'2',decision:'RESOLVE'}))).saved,true);
  const ap=await submitAppeal(db,'COMMENT_REPORT',report,reader);await call(db,admin,'appeal-resolve',mutation({appealId:ap.id,decision:'ACCEPT'}));
  let current=(await call(db,admin,'appeals')).appeals[0];
  assert.equal((await call(db,admin,'appeal-followup',mutation({appealId:ap.id,decision:'UNBLOCK',targetVersion:'wrong'}))).error,'COMMENT_CONFLICT');
  assert.equal((await call(db,admin,'appeal-followup',mutation({appealId:ap.id,decision:'UNBLOCK',targetVersion:current.targetVersion}))).saved,true);
  assert.equal((await one(db,'select is_blocked from comments where id=$1',[comment])).is_blocked,false);
  assert.equal((await one(db,'select status from authoring.comment_reports where id=$1',[report])).status,'REVIEWED');
 }finally{await db.close();}
});
test('exception draft reads require super admin, matching pending review and reason; receipts contain no manuscript',async()=>{
 const {db}=await setup();try{
  const draftId=randomUUID();
  await db.query('select public.creator_drafts($1,$2,$3,$4,$5,$6)',[admin,'save',10,draftId,JSON.stringify({expectedRevision:'0',title:'검수 원고',content:'SECRET_MANUSCRIPT_17',authorComment:''}),randomUUID()]);
  const item=await first(db),payload=mutation({source:item.source,caseId:item.id,draftId});
  assert.equal((await call(db,limited,'draft-read',payload)).status,403);
  assert.equal((await call(db,admin,'draft-read',{...payload,reason:''})).status,400);
  assert.equal((await call(db,admin,'draft-read',{...payload,draftId:randomUUID()})).status,404);
  const result=await call(db,admin,'draft-read',payload);assert.equal(result.draft.content,'SECRET_MANUSCRIPT_17');
  assert.equal((await call(db,admin,'draft-read',payload)).draft.revision,result.draft.revision);
  const receipts=await db.query('select * from authoring.workflow_receipts');assert.doesNotMatch(JSON.stringify(receipts.rows),/SECRET_MANUSCRIPT/);
  const audit=await call(db,admin,'audit');assert.doesNotMatch(JSON.stringify(audit),/SECRET_MANUSCRIPT/);
  assert.match(JSON.stringify(audit),new RegExp(draftId));
  await db.query('select public.creator_drafts($1,$2,$3,$4,$5,$6)',[admin,'save',10,draftId,JSON.stringify({expectedRevision:'1',title:'수정 원고',content:'SECRET_MANUSCRIPT_18',authorComment:''}),randomUUID()]);
  assert.equal((await call(db,admin,'draft-read',payload)).error,'DRAFT_REVIEW_CHANGED');
 }finally{await db.close();}
});
test('editorial schedules enforce CAS and overlap and recheck public free visibility without changing rankings',async()=>{
 const {db}=await setup();try{
  assert.equal((await call(db,admin,'curation-save',placement())).error,'PUBLIC_WORK_REQUIRED');await visible(db);
  const p=placement();assert.equal((await call(db,admin,'curation-save',p)).revision,'1');
  assert.equal((await call(db,admin,'curation-save',p)).revision,'1');
  assert.equal((await call(db,admin,'curation-save',placement())).error,'PLACEMENT_OVERLAP');
  assert.equal((await call(db,admin,'curation-save',placement({slot:'HOME_SPOTLIGHT'}))).saved,true);
  const boundary=placement({startsAt:'2099-01-01T00:00:00.000Z',endsAt:'2100-01-01T00:00:00.000Z'});
  assert.equal((await call(db,admin,'curation-save',boundary)).saved,true);
  assert.equal((await call(db,admin,'preview',{at:'2099-01-01T00:00:00.000Z'})).placements.length,1);
  assert.equal((await one(db,'select public.stage17_editorial() r')).r.placements.length,2);
  assert.equal((await call(db,admin,'curation-save',{...p,requestId:randomUUID(),enabled:false})).error,'CURATION_CONFLICT');
  assert.equal((await one(db,'select is_top_recommended,is_popular_work,is_new_work from works where id=10')).is_popular_work,false);
  await db.exec("update authoring.work_state set moderation_state='RESTRICTED',moderation_reason='노출 제한' where work_id=10");
  assert.equal((await one(db,'select public.stage17_editorial() r')).r.placements.length,0);
  assert.equal((await call(db,admin,'curation')).placements[0].eligible,false);
  assert.equal((await call(db,admin,'curation-save',{...p,requestId:randomUUID(),revision:'1',enabled:false})).saved,true);
 }finally{await db.close();}
});
test('account support keeps auth IDs private, checks expected status and changes access for existing sessions',async()=>{
 const {db}=await setup();try{
  const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const account=await call(db,admin,'account-support',{kind:'reader',accountId:id});assert.equal(account.linked,true);assert.equal(account.emailConfirmed,true);assert.doesNotMatch(JSON.stringify(account),new RegExp(reader));
  const data=mutation({kind:'reader',accountId:id,expectedStatus:'ACTIVE',decision:'SUSPEND'});
  assert.equal((await call(db,admin,'account-moderate',data)).saved,true);assert.equal((await call(db,admin,'account-moderate',data)).saved,true);
  assert.equal((await call(db,admin,'account-moderate',{...data,requestId:randomUUID()})).error,'ACCOUNT_CONFLICT');
  assert.equal((await one(db,'select status from readers where id=$1',[id])).status,'SUSPENDED');
  assert.equal((await one(db,"select public.stage8_reader($1,'library','{}') r",[reader])).r.status,403);
  assert.equal((await call(db,admin,'account-moderate',mutation({kind:'reader',accountId:id,expectedStatus:'SUSPENDED',decision:'RESTORE'}))).saved,true);
  assert.equal((await call(db,admin,'accounts',{kind:'reader'})).accounts[0].status,'ACTIVE');
 }finally{await db.close();}
});
test('unified audit reports absent sources and projects legacy rows without sensitive before/after payloads',async()=>{
 const {db}=await setup();try{
  assert.equal((await call(db,admin,'audit')).missingSources.length,3);
  await db.exec(`create schema if not exists launch_recovery;
   create table launch_recovery.admin_permission_audit(id uuid default gen_random_uuid(),target_id uuid,actor_id uuid,reason text,created_at timestamptz default now(),before_state jsonb);
   insert into launch_recovery.admin_permission_audit(target_id,actor_id,reason,before_state) values('${limited}','${admin}','권한 회수','{"password":"DO_NOT_EXPOSE"}');`);
  const result=await call(db,admin,'audit',{target:'ADMIN:'+limited});assert.equal(result.events.length,1);assert.doesNotMatch(JSON.stringify(result),/DO_NOT_EXPOSE|password/);
  assert.equal((await call(db,limited,'audit')).status,403);
 }finally{await db.close();}
});
