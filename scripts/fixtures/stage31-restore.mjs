import {setup as base,ready,admin,draft,snapshotOf} from './stage30-evidence.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {buildRecoveryPacket,recoveryDecisionTemplate} from '../lib/recovery-evidence.mjs';
export {admin,draft,ready,snapshotOf};
export const targetRef='zyxwvutsrqponmlkjihg';
export async function refresh(s){
 s.verified=await snapshotOf(s.db);s.packet=await buildRecoveryPacket(s.db,s.verified,s.seed);s.decisions=recoveryDecisionTemplate(s.packet);
 const row=s.packet.entries.find(e=>e.requestId===s.request.id),d=s.decisions.decisions.find(d=>d.requestId===s.request.id);
 Object.assign(d,{decision:'PREPARE_RESTORE',reviewerRef:'synthetic-reviewer',evidenceRef:'합성 검증용 실제 바이트 참조',submittedSha256:row.submittedSha256,
  originalFile:s.originalDescriptor,rightsEvidence:s.descriptor,ratingEvidence:s.descriptor,aiEvidence:s.descriptor});
 for(const [file,value] of [['snapshot.json',s.verified.snapshot],['manifest.json',{...s.verified.manifest,snapshotSha256:s.verified.hash}],
  ['data-restore-verification.json',{snapshotSha256:s.verified.hash,allRowsMatch:true,tablesVerified:s.verified.snapshot.tables.length,rowsVerified:s.verified.snapshot.tables.reduce((n,t)=>n+t.rows.length,0)}]])
  await writeFile(path.join(s.directory,file),JSON.stringify(value),{mode:0o600});
 return s;
}
export async function submit(s,episode='100',revision='1'){
 const options=await s.rpc('creator_draft_recovery',[admin,'options','10',draft,'{}',null,'0']);
 const r=await s.rpc('creator_draft_recovery',[admin,'submit','10',draft,JSON.stringify({...s.submission,episodeId:episode,expectedRevision:revision,
  targetDigest:options.episodes.find(e=>e.id===episode).targetDigest}),crypto.randomUUID(),'0']);
 if(!r.request)throw Error('SYNTHETIC_REQUEST_FAILED');s.request=r.request;await ready(s);return refresh(s);
}
export async function setup(){
 const s=await base({review:false});try{
  const bytes=await readFile(path.join(s.directory,'originals/input/manuscript.bin'));
  const {sha}=await import('../lib/launch-content-review.mjs');s.originalDescriptor={file:'originals/input/manuscript.bin',bytes:bytes.length,sha256:sha(bytes)};
  await s.db.exec(`create table public.episode_contents(episode_id bigint primary key references public.episodes(id),text_content text,content_version int,updated_at timestamptz);
   insert into public.episode_contents select id,'별도 기존 본문',7,'2026-01-01' from public.episodes;`);
  await submit(s);return s;
 }catch(e){await s.db.close();throw e;}
}
