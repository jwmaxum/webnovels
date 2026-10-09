import {setup as base} from './stage21-db.mjs';
import {readFile} from 'node:fs/promises';
export {admin,reader,limited} from './stage21-db.mjs';
export const sql=await readFile(new URL('../../database/authoring/018_growth_measurement.sql',import.meta.url),'utf8');
export async function setup(){const f=await base();try{
 await f.db.exec(sql);
 const call=async(action,data={},user=f.users[0])=>(await f.db.query('select public.stage22_growth($1,$2,$3) result',
  [user,action,JSON.stringify(['viewport','referral','seo','feed'].includes(action)?{webtoon:false,...data}:data)])).rows[0].result;
 const consent=async(user=f.users[0],value=true)=>call('save-preferences',{excludedGenres:[],frequency:'OFF',analyticsConsent:true,measurementConsent:value},user);
 const content=async(episode,user=f.users[0],webtoon=false)=>(await f.db.query('select public.stage22_episode_content($1,$2,$3) result',[user,episode,webtoon])).rows[0].result;
 const funnel=async(work,at)=>(await f.db.query('select growth.funnel($1,$2) result',[work,at])).rows[0].result;
 return {...f,call,consent,content,funnel};
 }catch(e){await f.db.close();throw e;}}
