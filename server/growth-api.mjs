import {discoveryEnabled,projectWork} from './stage16-api.mjs';
import {webtoonEnabled} from './webtoon-api.mjs';
export const growthEnabled=env=>env.P0_API_ENABLED==='true'&&env.GROWTH_SERVICE_ENABLED==='true'&&discoveryEnabled(env);
const id=v=>typeof v==='string'&&/^[1-9]\d{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>obj(v)&&Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const text=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.length<=max&&!/[<>\x00-\x1f\x7f]/.test(v);
const version=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,60}$/.test(v);
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
export function publicGrowthCover(value,env){
 if(typeof value!=='string')return null;
 if(/^\/images\/[A-Za-z0-9_./-]+$/.test(value)&&!value.includes('..'))return value;
 try{const u=new URL(value),s=new URL(env.SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL);
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)return null;
  if(u.origin===s.origin&&u.pathname.startsWith('/storage/v1/object/public/authoring-covers/'))return u.href;
  if(u.origin===env.GROWTH_CANONICAL_ORIGIN&&/^\/images\/[A-Za-z0-9_./-]+$/.test(u.pathname))return u.href;
 }catch{}return null;
}
const policyKeys=['hypothesis','control','type','startsAt','endsAt','minEpisodes','minCharacters','minReaders','minFavorites','minCompletionSample','minCompletionRate','costBudgetKrw'];
export function validGrowthPolicy(p){
 return exact(p,policyKeys)&&text(p.hypothesis,10,1000)&&text(p.control,10,1000)&&['NOVEL','WEBTOON'].includes(p.type)&&
 typeof p.startsAt==='string'&&typeof p.endsAt==='string'&&Number.isFinite(Date.parse(p.startsAt))&&
 Date.parse(p.endsAt)>Date.parse(p.startsAt)&&Date.parse(p.endsAt)-Date.parse(p.startsAt)<=90*86400000&&
 integer(p.minEpisodes,1,1000)&&integer(p.minCharacters,0,10000000)&&integer(p.minReaders,5,10000000)&&
 integer(p.minFavorites,5,10000000)&&integer(p.minCompletionSample,5,10000000)&&
 Number.isFinite(p.minCompletionRate)&&p.minCompletionRate>=0&&p.minCompletionRate<=1&&integer(p.costBudgetKrw,0,1000000000)&&
 (p.type!=='WEBTOON'||p.minCharacters===0);
}
const routes={
 '/api/v2/reader/growth':{feed:'PUBLIC',preferences:'GET','save-preferences':'POST',reset:'POST'},
 '/api/v2/creator/growth':{report:'GET'},
 '/api/v2/admin/growth':{admin:'GET',configure:'POST',decide:'POST',evaluate:'POST'},
 '/api/v2/growth/seo':{seo:'GET'}
};
export async function growthApi({request,env,actor,db,readBody,fail}){
 if(!growthEnabled(env))fail(503,'GROWTH_NOT_ACTIVATED');
 const u=new URL(request.url),route=routes[u.pathname],action=u.searchParams.get('action')||Object.keys(route||{})[0];
 const queryKeys=[...u.searchParams.keys()];
 if(!route?.[action]||new Set(queryKeys).size!==queryKeys.length||queryKeys.some(k=>!['action','workId'].includes(k)))fail(400,'INVALID_ACTION');
 const publicRead=(action==='feed'&&request.method==='GET')||action==='seo';
 if(route[action]==='PUBLIC'?!['GET','POST'].includes(request.method):request.method!==route[action])fail(405,'METHOD_NOT_ALLOWED');
 if(request.method==='POST'&&request.headers.get('origin')!==u.origin)fail(403,'ORIGIN_REQUIRED');
 let data=request.method==='POST'?await readBody(request):{};
 const queryId=u.searchParams.get('workId');
 if((action==='report'||action==='seo')&&queryId!==null){if(!id(queryId))fail(400,'INVALID_WORK_ID');data.workId=queryId;}
 else if(queryId!==null)fail(400,'INVALID_QUERY');
 if(action==='report'&&!id(data.workId))fail(400,'INVALID_WORK_ID');
 let who=null;
 if(!publicRead){
  who=await actor();
  if(u.pathname.includes('/reader/')&&who.reader?.status!=='ACTIVE')fail(403,'READER_REQUIRED');
  if(u.pathname.includes('/creator/')&&who.author?.status!=='APPROVED')fail(403,'AUTHOR_REQUIRED');
  if(u.pathname.includes('/admin/')&&(who.admin?.role!=='SUPER_ADMIN'||who.admin?.is_active!==true))fail(403,'ADMIN_FORBIDDEN');
 }
 if(['feed','reset','preferences','admin'].includes(action)&&!exact(data,[]))fail(400,'INVALID_FIELD');
 if(action==='save-preferences'&&(!exact(data,['excludedGenres','frequency','analyticsConsent'])||
 !Array.isArray(data.excludedGenres)||data.excludedGenres.length>8||data.excludedGenres.some(g=>!text(g,1,40))||
 !['OFF','WEEKLY','DAILY'].includes(data.frequency)||typeof data.analyticsConsent!=='boolean'))fail(400,'INVALID_PREFERENCES');
 if(action==='configure'&&(!exact(data,['version','config'])||!version(data.version)||!validGrowthPolicy(data.config)))fail(400,'INVALID_POLICY');
 if(action==='evaluate'&&(!exact(data,['version','workId'])||!version(data.version)||!id(data.workId)))fail(400,'INVALID_INPUT');
 if(action==='decide'){
  const e=data.evidence;
  if(!exact(data,['version','decision','reason','evidence'])||!version(data.version)||!['KEEP','CHANGE','STOP'].includes(data.decision)||
   !text(data.reason,10,2000)||!exact(e,['sampleSize','observedDays','costKrw','retentionSummary','supplySummary','guardrailSummary'])||
   !integer(e.sampleSize,0,10000000)||!integer(e.observedDays,0,90)||!integer(e.costKrw,0,1000000000)||
   !text(e.retentionSummary,10,1000)||!text(e.supplySummary,10,1000)||!text(e.guardrailSummary,10,1000))fail(400,'INVALID_DECISION');
 }
 if(['feed','seo'].includes(action))data.webtoon=webtoonEnabled(env);
 const result=await db('rpc/stage21_growth',{}, {method:'POST',body:{p_user:who?.userId||null,p_action:action,p_data:data}});
 if(result?.error)fail([400,403,404,409].includes(result.status)?result.status:503,result.error);
 if(!obj(result))fail(503,'GROWTH_UNAVAILABLE');
 if(action==='feed'){
  if(!Array.isArray(result.works)||result.works.length>8)fail(503,'GROWTH_UNAVAILABLE');
  return {works:result.works.map(w=>({...projectWork(w,fail,false,webtoonEnabled(env)),cover_image:publicGrowthCover(w.cover_image,env),reason:['RECENT_PUBLIC_SERIAL','GENRE_ROTATION'].includes(w.reason)?w.reason:'RECENT_PUBLIC_SERIAL'})),
   measurement:'SERVER_PROVIDED_NOT_VIEWPORT',analyticsConsent:result.analyticsConsent===true};
 }
 if(action==='seo'){
  if(!Array.isArray(result.items)||result.items.length>1000)fail(503,'SITEMAP_LIMIT_REQUIRES_PARTITION');
  return {items:result.items.map(r=>{if(!id(r.id)||typeof r.title!=='string')fail(503,'GROWTH_UNAVAILABLE');
   return {id:r.id,title:r.title.slice(0,200),description:typeof r.description==='string'?r.description.slice(0,200):'',lastModified:typeof r.lastModified==='string'&&Number.isFinite(Date.parse(r.lastModified))?r.lastModified:null,cover:publicGrowthCover(r.cover,env)};})};
 }
 return result;
}
