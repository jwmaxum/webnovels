import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup as foundation,admin,reader,limited} from './stage17-db.mjs';
export {admin,reader,limited};
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8');
export const sql=await read('database/authoring/017_growth_experiments.sql');
export const config={hypothesis:'합성 신인 탐색 가설입니다.',control:'같은 필터와 작가/장르 제한, 작품 번호 역순',type:'NOVEL',
 startsAt:'2026-01-01T00:00:00Z',endsAt:'2026-03-01T00:00:00Z',minEpisodes:1,minCharacters:1,minReaders:5,
 minFavorites:5,minCompletionSample:5,minCompletionRate:0.65,costBudgetKrw:0};
export async function setup(){const {db}=await foundation();try{
 await db.exec(await read('database/authoring/015_webtoon.sql'));await db.exec(sql);
 const call=async(action,data={},user=reader)=>(await db.query('select public.stage21_growth($1,$2,$3) result',[user,action,JSON.stringify(data)])).rows[0].result;
 const publish=async({title='신규 작품',genre='판타지',author=admin,episodes=1}={})=>{
  const w=(await db.query("select public.creator_works($1,'create',null,$2,$3) result",[author,JSON.stringify({title}),crypto.randomUUID()])).rows[0].result.work.id;
  await db.query('update works set description=$2,genre=array[$3] where id=$1',[w,'시험 소개',genre]);
  await db.query('update authoring.work_state set rating_confirmed=true,ai_confirmed=true where work_id=$1',[w]);
  const ids=[];
  for(let i=1;i<=episodes;i++){const d=crypto.randomUUID();const saved=(await db.query("select public.creator_drafts($1,'save',$2,$3,$4,$5) result",[author,w,d,JSON.stringify({title:'회차 '+i,content:'가 나 다 본문입니다.',authorComment:'',expectedRevision:'0'}),crypto.randomUUID()])).rows[0].result;
   assert.ok(saved.draft,JSON.stringify(saved));const p=(await db.query("select public.creator_publications($1,'publish',$2,$3,null,$4,$5) result",[author,w,d,JSON.stringify({revision:'1',episodeNumber:i,mode:'NOW',rightsConfirmed:true}),crypto.randomUUID()])).rows[0].result;
   assert.ok(p.publication,JSON.stringify(p));ids.push(p.publication.episodeId);
  }return {w,episodes:ids};
 };
 const users=[];for(let i=1;i<=6;i++){const u='77777777-7777-4777-8777-'+String(i).padStart(12,'0');users.push(u);
  await db.query('insert into auth.users(id) values($1)',[u]);await db.query("insert into readers(id,auth_user_id,status) values($1,$2,'ACTIVE')",[crypto.randomUUID(),u]);
  await db.query("insert into growth.preferences(user_id,consent,metrics_since) values($1,true,'2026-01-01T00:00:00Z')",[u]);}
 const event=async(u,w,episode,when,type='OPEN')=>db.query('insert into authoring.reader_events_v2(user_id,work_id,episode_id,event_type,bucket,created_at) values($1,$2,$3,$4,date_trunc(\'hour\',$5::timestamptz),$5) on conflict do nothing',[u,w,episode,type,when]);
 const metrics=async(w,asof)=>(await db.query('select growth.metrics($1,$2) result',[w,asof])).rows[0].result;
 const webtoon=async()=>{
  const q=async(sql,args)=>(await db.query(sql,args)).rows[0].result;
  const w=(await q("select public.creator_works($1,'create',null,$2,$3) result",[admin,JSON.stringify({title:'웹툰 성장 시험',contentType:'WEBTOON'}),crypto.randomUUID()])).work.id;
  await db.query("update works set description='웹툰 소개',genre=array['일상'] where id=$1",[w]);await db.query('update authoring.work_state set rating_confirmed=true,ai_confirmed=true where work_id=$1',[w]);
  const asset=crypto.randomUUID(),sha='a'.repeat(64);const image=(action,data={})=>q('select public.creator_webtoon($1,$2,$3,$4,$5) result',[admin,action,w,asset,JSON.stringify(data)]);
  await image('prepare',{name:'합성.png',sha,bytes:1000,mime:'image/png',width:800,height:800});await image('uploaded');const lease=(await image('claim')).lease;
  assert.equal((await image('part',{lease,part:0,width:800,height:800,webpSha:sha,pngSha:'b'.repeat(64)})).asset.state,'READY');
  const d=crypto.randomUUID(),manifest={schemaVersion:1,assetIds:[asset],thumbnailAssetId:asset,credits:{writer:'글',artist:'그림',original:''}};
  const saved=await q("select public.creator_drafts($1,'save',$2,$3,$4,$5) result",[admin,w,d,JSON.stringify({title:'그림 회차',content:'',authorComment:'',expectedRevision:'0',webtoon:manifest}),crypto.randomUUID()]);assert.ok(saved.draft,JSON.stringify(saved));
  const p=await q("select public.creator_publications_v18($1,'publish',$2,$3,null,$4,$5) result",[admin,w,d,JSON.stringify({revision:'1',episodeNumber:1,mode:'NOW',rightsConfirmed:true}),crypto.randomUUID()]);assert.ok(p.publication,JSON.stringify(p));
  return {w,episode:p.publication.episodeId};
 };
 return {db,call,publish,webtoon,users,event,metrics};
 }catch(e){await db.close();throw e;}}
