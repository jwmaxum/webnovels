import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {setup,admin,reader,limited} from './fixtures/stage17-db.mjs';
import {betaSupportApi} from '../server/beta-support-api.mjs';
const migration=await readFile(new URL('../database/authoring/026_beta_support.sql',import.meta.url),'utf8');
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
const form=(patch={})=>({requestId:randomUUID(),category:'BUG',title:'저장 오류 문의',message:'원고 저장 이후 확인이 필요합니다.',...patch});

test('support API validates identity, exact origin, JSON stream limits and allowlisted fields before RPC',async()=>{
 const calls=[];
 const context={user:{id:reader},actor:{userId:reader,reader:{status:'ACTIVE'}},fail,
  rpc:async(name,p)=>{calls.push({name,p});return {items:[],nextOffset:null};}};
 const invoke=(action,body,patch={},headers={})=>betaSupportApi({...context,...patch,request:new Request(
  'https://site.test/api/v2/support?action='+action,{method:body?'POST':'GET',headers:{Origin:'https://site.test','Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})})});
 await invoke('create',form({title:'  문의 제목  ',message:'  문의 내용입니다.  '}));
 assert.equal(calls[0].name,'beta_support');assert.equal(calls[0].p.p_user,reader);assert.equal(calls[0].p.p_admin,false);
 assert.equal(calls[0].p.p_data.title,'문의 제목');assert.equal(calls[0].p.p_data.message,'문의 내용입니다.');assert.equal(calls[0].p.p_data.workId,null);
 await invoke('list');assert.deepEqual(calls[1].p.p_data,{offset:0});
 const before=calls.length;
 for(const body of [form({authorId:'1'}),form({category:'OTHER'}),form({workId:1}),form({title:'a'}),form({message:'x\u0007x'}),form({message:'가'.repeat(4001)}),form({category:'WITHDRAWAL'}),form({withdrawalConfirmed:false}),{requestId:randomUUID(),id:randomUUID(),revision:1,message:'다시 문의합니다.'}])
  await assert.rejects(invoke(body.id?'reply':'create',body),e=>e.code==='INVALID_SUPPORT_REQUEST');
 await assert.rejects(invoke('create',form(),{}, {Origin:'https://evil.test'}),e=>e.code==='ORIGIN_REQUIRED');
 await assert.rejects(invoke('create',form(),{}, {Origin:''}),e=>e.code==='ORIGIN_REQUIRED');
 await assert.rejects(invoke('create',form(),{}, {'Content-Type':'text/plain'}),e=>e.code==='JSON_REQUIRED');
 await assert.rejects(invoke('create',form({message:'가'.repeat(9000)})),e=>e.code==='BODY_TOO_LARGE');
 await assert.rejects(invoke('list',null,{actor:{userId:admin}}),e=>e.code==='ACCOUNT_REQUIRED');
 await assert.rejects(invoke('list',null,{actor:{userId:reader,author:{status:'SUSPENDED'}}}),e=>e.code==='ACCOUNT_REQUIRED');
 await assert.rejects(invoke('list',null,{actor:{userId:reader,reader:{status:'WITHDRAWN'}}}),e=>e.code==='ACCOUNT_REQUIRED');
 await assert.rejects(invoke('list',null,{actor:{userId:reader,admin:{is_active:false}}}),e=>e.code==='ACCOUNT_REQUIRED');
 await assert.rejects(invoke('list&offset=1&offset=2'),e=>e.code==='INVALID_SUPPORT_REQUEST');
 await assert.rejects(invoke('list&category=BUG'),e=>e.code==='INVALID_SUPPORT_REQUEST');
 await assert.rejects(invoke('detail&id=1'),e=>e.code==='INVALID_SUPPORT_REQUEST');
 await assert.rejects(invoke('transition',form()),e=>e.code==='INVALID_SUPPORT_REQUEST');
 assert.equal(calls.length,before);
 const adminRequest=(action,method='GET',body)=>new Request('https://site.test/api/v2/admin/support?action='+action,{method,headers:{Origin:'https://site.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const adminContext={...context,actor:{admin:{is_active:true,role:'SUB_ADMIN',permissions:['CASE_READ']}}};
 await betaSupportApi({...adminContext,request:adminRequest('list&category=BUG')});
 await assert.rejects(betaSupportApi({...adminContext,request:adminRequest('reply','POST',{requestId:randomUUID(),id:randomUUID(),revision:'1',message:'운영자 답변입니다.'})}),e=>e.code==='ADMIN_FORBIDDEN');
 await assert.rejects(betaSupportApi({...context,request:adminRequest('list')}),e=>e.code==='ADMIN_FORBIDDEN');
 await assert.rejects(betaSupportApi({...context,request:new Request('https://site.test/api/v2/support',{method:'DELETE'})}),e=>e.code==='METHOD_NOT_ALLOWED');
 const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(24577));controller.close();}});
 await assert.rejects(betaSupportApi({...context,request:new Request('https://site.test/api/v2/support?action=create',{
  method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json'},body:stream,duplex:'half'})}),e=>e.code==='BODY_TOO_LARGE');
});

test('support RPC isolates members, verifies live roles, preserves revision/idempotency and appends review history',async()=>{
 const {db}=await setup();
 try{
  await db.exec(migration);await db.exec(migration);
  const rpc=async(user,scope,action,data={})=>(await db.query('select public.beta_support($1,$2,$3,$4) value',[user,scope,action,data])).rows[0].value;
  const expectError=async(promise,code)=>assert.equal((await promise).error,code);
  const create=form({workId:'20'});
  const first=await rpc(reader,false,'create',create);assert.equal(first.saved,true);assert.equal(first.case.revision,'1');
  assert.equal(first.case.workId,'20');assert.equal(first.messages.length,1);assert.equal(first.messages[0].authorKind,'USER');
  assert.equal(JSON.stringify(first).includes(reader),false);assert.equal(JSON.stringify(first).includes('owner_id'),false);
  const id=first.case.id;
  const replay=await rpc(reader,false,'create',create);assert.equal(replay.replayed,true);assert.equal(replay.case.id,id);
  await expectError(rpc(reader,false,'create',{...create,message:'다른 요청 내용입니다.'}),'CONFLICT');
  assert.equal((await db.query('select count(*) n from authoring.support_cases')).rows[0].n,1);
  await expectError(rpc(admin,false,'detail',{id}),'CASE_NOT_FOUND');
  assert.equal((await rpc(admin,false,'list')).items.length,0);assert.equal((await rpc(reader,false,'list')).items.length,1);
  await expectError(rpc(admin,false,'reply',{requestId:randomUUID(),id,revision:'1',message:'다른 회원 답변입니다.'}),'CASE_NOT_FOUND');
  await expectError(rpc(limited,true,'list'),'ADMIN_FORBIDDEN');
  await db.query("update public.admin_users set permissions='[\"CASE_READ\"]' where auth_user_id=$1",[limited]);
  assert.equal((await rpc(limited,true,'detail',{id})).case.id,id);
  await expectError(rpc(limited,true,'reply',{requestId:randomUUID(),id,revision:'1',message:'허가되지 않은 답변입니다.'}),'ADMIN_FORBIDDEN');
  await db.query("update public.admin_users set permissions='[\"CASE_READ\",\"CASE_RESOLVE\"]' where auth_user_id=$1",[limited]);
  const transition=(status,revision,user=limited)=>rpc(user,true,'transition',{requestId:randomUUID(),id,revision,message:'지원 상태를 변경합니다.',status});
  const reviewing=await transition('IN_REVIEW','1');assert.equal(reviewing.case.revision,'2');assert.equal(reviewing.messages[1].previousStatus,'OPEN');
  const stale={requestId:randomUUID(),id,revision:'1',message:'예전 화면에서 추가한 내용입니다.'};
  await expectError(rpc(reader,false,'reply',stale),'CONFLICT');
  assert.equal((await transition('WAITING_USER','2')).case.status,'WAITING_USER');
  const followup={requestId:randomUUID(),id,revision:'3',message:'요청하신 추가 설명을 남깁니다.'};
  const updated=await rpc(reader,false,'reply',followup);assert.equal(updated.case.status,'OPEN');assert.equal(updated.case.revision,'4');
  assert.equal((await rpc(reader,false,'reply',followup)).replayed,true);
  assert.equal((await transition('RESOLVED','4')).case.status,'RESOLVED');
  await expectError(rpc(reader,false,'reply',{...stale,requestId:randomUUID(),revision:'5'}),'CASE_CLOSED');
  const reopen=(revision)=>rpc(reader,false,'reopen',{requestId:randomUUID(),id,revision,message:'해결되지 않은 부분에 이의를 제기합니다.'});
  assert.equal((await reopen('5')).case.reopenCount,1);
  assert.equal((await transition('CLOSED','6')).case.status,'CLOSED');
  await expectError(transition('OPEN','7'),'CASE_CLOSED');
  assert.equal((await reopen('7')).case.reopenCount,2);
  assert.equal((await transition('RESOLVED','8')).case.revision,'9');
  await expectError(reopen('9'),'REOPEN_LIMIT');
  const details=await rpc(reader,false,'detail',{id});assert.equal(details.messages.length,9);assert.equal(details.case.replyCount,1);
  await assert.rejects(db.exec("update authoring.support_messages set message='변조된 메시지'"),/append-only/);
  await assert.rejects(db.exec('delete from authoring.support_receipts'),/append-only/);
  await expectError(rpc(reader,false,'create',form({category:'WITHDRAWAL'})),'INVALID_SUPPORT_REQUEST');
  const withdrawal=await rpc(reader,false,'create',form({category:'WITHDRAWAL',withdrawalConfirmed:true}));
  assert.equal(withdrawal.case.category,'WITHDRAWAL');assert.equal(withdrawal.case.status,'OPEN');
  assert.equal((await db.query('select count(*) n from auth.users where id=$1',[reader])).rows[0].n,1);
  assert.equal((await db.query('select status from public.works where id=20')).rows[0].status,'DRAFT');
  await expectError(rpc(admin,false,'create',form({workId:'20'})),'WORK_NOT_FOUND');
  await expectError(rpc(reader,false,'create',form({workId:'999999'})),'WORK_NOT_FOUND');
  for(const sql of ["update auth.users set email_confirmed_at=null where id='"+reader+"'", "update auth.users set banned_until=now()+interval '1 day' where id='"+reader+"'", "update public.authors set status='SUSPENDED' where auth_user_id='"+reader+"'", "update public.readers set status='SUSPENDED' where auth_user_id='"+reader+"'"]){
   await db.exec('begin');await db.exec(sql);await expectError(rpc(reader,false,'detail',{id}),'ACCOUNT_REQUIRED');await db.exec('rollback');
  }
  await db.exec('begin');await db.query('update public.admin_users set is_active=false where auth_user_id=$1',[limited]);
  await expectError(rpc(limited,true,'detail',{id}),'ACCOUNT_REQUIRED');await db.exec('rollback');
  // A single-threaded synthetic DB cannot prove a production two-connection race,
  // but concurrent submissions must still produce exactly one write and receipt.
  const racing=form({category:'IDEA'});const results=await Promise.all([rpc(reader,false,'create',racing),rpc(reader,false,'create',racing)]);
  assert.equal(results[0].case.id,results[1].case.id);assert.equal(results.filter(x=>x.replayed).length,1);
  const raceId=results[0].case.id;
  const compete=await Promise.all([rpc(reader,false,'reply',{requestId:randomUUID(),id:raceId,revision:'1',message:'첫 번째 추가 설명입니다.'}),rpc(admin,true,'reply',{requestId:randomUUID(),id:raceId,revision:'1',message:'동시에 작성한 관리자 답변입니다.'})]);
  assert.equal(compete.filter(x=>x.saved).length,1);assert.equal(compete.filter(x=>x.error==='CONFLICT').length,1);
  await db.query('update authoring.support_limits set writes=30 where actor_id=$1',[reader]);
  await expectError(rpc(reader,false,'create',form()),'RATE_LIMITED');
  assert.equal((await rpc(reader,false,'create',racing)).replayed,true);
  await db.query("update authoring.support_limits set window_start=now()-interval '2 hours' where actor_id=$1",[reader]);
  assert.equal((await rpc(reader,false,'create',form())).saved,true);
  const cancelled=await rpc(reader,false,'cancel',{requestId:randomUUID(),id:withdrawal.case.id,revision:'1',message:'탈퇴 요청을 취소합니다.'});assert.equal(cancelled.case.status,'CANCELLED');
  await expectError(rpc(reader,false,'reopen',{requestId:randomUUID(),id:withdrawal.case.id,revision:'2',message:'취소한 요청 재개입니다.'}),'CASE_CLOSED');
  // Explicit role checks: defaults confer no access, BYPASSRLS is not an ACL grant.
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('set role '+role);
   for(const table of ['support_cases','support_messages','support_receipts','support_limits'])
    await assert.rejects(db.query('select * from authoring.'+table),/permission denied/);
   await assert.rejects(db.query('select authoring.support_detail($1)',[id]),/permission denied/);
   if(role==='service_role')assert.equal((await rpc(reader,false,'detail',{id})).case.id,id);
   else await assert.rejects(rpc(reader,false,'detail',{id}),/permission denied/);
   await db.exec('reset role');
  }
  const acls=(await db.query("select relname,relrowsecurity,relacl from pg_class where relnamespace='authoring'::regnamespace and relname like 'support_%' and relkind='r'")).rows;
  assert.equal(acls.length,4);assert.ok(acls.every(x=>x.relrowsecurity));
 }finally{await db.close();}
});
