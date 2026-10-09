import {setup as base,admin,reader,limited} from './stage17-db.mjs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export {admin,reader,limited};
export const draft='dddddddd-dddd-4ddd-8ddd-dddddddddddd',key='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export async function setup({timezone,originalBytes}={}){
 const s=await base();try{
  if(timezone==='UTC')await s.db.exec("set timezone='UTC'");
  for(const name of ['019_creator_recovery_requests','020_admin_recovery_review'])await s.db.exec(await readFile(new URL('../../database/authoring/'+name+'.sql',import.meta.url),'utf8'));
  const rpc=async(fn,args)=>(await s.db.query('select public.'+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args)).rows[0].result;
  const files=(action,data={})=>rpc('creator_files',[admin,action,'10',key,JSON.stringify(data)]);
  const prepared=await files('prepare',{kind:'IMPORT',filename:'원고.hwpx',sha256:originalBytes?createHash('sha256').update(originalBytes).digest('hex'):'a'.repeat(64),size:originalBytes?originalBytes.byteLength:10,draftId:draft,title:'제출 제목',content:'제출 당시 비공개 원고 😀',order:0,batchId:key});
  await files('commit');
  const options=await rpc('creator_draft_recovery',[admin,'options','10',draft,'{}',null,'0']);
  const submission={expectedRevision:'1',episodeId:'100',fileId:prepared.original.id,targetDigest:options.episodes.find(e=>e.id==='100').targetDigest,note:'작가 요청 메모',confirmed:true};
  const request=(await rpc('creator_draft_recovery',[admin,'submit','10',draft,JSON.stringify(submission),key,'0'])).request;
  if(!request)throw Error('FIXTURE_REQUEST_FAILED');
  return {...s,rpc,request,submission,review:(action,data={},user=admin)=>rpc('stage29_admin_recovery',[user,action,JSON.stringify(data)]),
   feedback:(user=admin,work='10',requestId=null)=>rpc('creator_recovery_review_status',[user,work,draft,requestId])};
 }catch(e){await s.db.close();throw e;}
}
