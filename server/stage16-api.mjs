// Additive public discovery. No client identity, private distribution rows, or manuscript text in cards.
import { DISTRIBUTION_HOSTS, normalizeExternalLinks } from './creator-distribution-api.mjs';

const BIGINT = /^[1-9]\d{0,18}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const publicStates = new Set(['PUBLISHED','ONGOING','PAUSED','COMPLETED']);
const fields = ['id','title','author','author_id','genre','tags','cover_image','view_count','like_count',
  'created_at','status','content_type','is_completed','is_top_recommended','is_popular_work','is_new_work',
  'rating','ai_usage_type','published_at','episode_count','first_published_at','last_published_at','ranking_readers'];
const episodeFields = ['id','work_id','episode_number','title','status','view_count','is_free','is_ad_free',
  'access_policy','scheduled_at','published_at','versionId'];
const actions = {
  home: ['action'],
  list: ['action','q','genre','status','epRange','rating','tag','sort','type','limit','cursor'],
  work: ['action','workId'],
  episodes: ['action','workId','limit','cursor'],
  chapter: ['action','workId','episodeNumber']
};
const validId = value => typeof value==='string' && BIGINT.test(value) && BigInt(value)<=9223372036854775807n;
const object = value => value && typeof value==='object' && !Array.isArray(value);
const pick = (value, keys) => Object.fromEntries(keys.filter(key=>key in value).map(key=>[key,value[key]]));
export function discoveryEnabled(env) {
  return env.READER_DISCOVERY_ENABLED==='true' && env.AUTHOR_PUBLISH_ENABLED==='true' && env.READER_SERVICE_ENABLED==='true';
}
export function validReadingPosition(position) {
  return object(position) && Object.keys(position).length===3 && UUID.test(position.versionId||'') &&
    Number.isInteger(position.paragraphIndex) && position.paragraphIndex>=0 && position.paragraphIndex<=999999 &&
    Number.isFinite(position.offset) && position.offset>=0 && position.offset<=1;
}
function visibleWork(work) {
  return object(work) && validId(work.id) && publicStates.has(work.status) &&
    ['ALL','AGE_15'].includes(work.rating) && work.content_type==='NOVEL' &&
    !(Array.isArray(work.genre)?work.genre:[work.genre]).some(value=>['성인','19세 이상'].includes(value));
}
function visibleEpisode(episode, workId) {
  return object(episode) && validId(episode.id) && validId(episode.work_id) &&
    (!workId || episode.work_id===workId) && Number.isInteger(episode.episode_number) && episode.episode_number>0 &&
    episode.status==='PUBLISHED' && episode.is_free===true && episode.access_policy==='FREE' &&
    (!episode.scheduled_at || (Number.isFinite(Date.parse(episode.scheduled_at)) && Date.parse(episode.scheduled_at)<=Date.now())) &&
    UUID.test(episode.versionId||'');
}
function publicDistribution(value) {
  if (!object(value) || value.mode!=='NON_EXCLUSIVE') return null;
  // Revalidate stored metadata too. A malformed legacy link cannot create an arbitrary outbound anchor.
  let links;
  try { links=normalizeExternalLinks(value.externalLinks,()=>{throw Error('UNSAFE_LINK');}); }
  catch { links=[]; }
  return {mode:'NON_EXCLUSIVE',externalLinks:links.map(url=>({label:DISTRIBUTION_HOSTS[new URL(url).hostname],url}))};
}
function projectWork(work, fail, detail=false) {
  if (!visibleWork(work)) fail(503,'CATALOG_UNAVAILABLE');
  const result=pick(work,fields);
  result.ranking_readers=Number.isSafeInteger(work.ranking_readers)&&work.ranking_readers>=5?work.ranking_readers:null;
  result.distribution=publicDistribution(work.distribution);
  if(detail) {
    result.description=typeof work.description==='string'?work.description:'';
    result.firstEpisodeNumber=Number.isInteger(work.firstEpisodeNumber)&&work.firstEpisodeNumber>0?work.firstEpisodeNumber:null;
  }
  return result;
}
function projectEpisode(episode,workId,fail) {
  if(!visibleEpisode(episode,workId))fail(503,'CATALOG_UNAVAILABLE');
  return pick(episode,episodeFields);
}
function rank(value,fail) {
  if(!object(value)||value.periodDays!==7||value.minSample!==5||value.metric!=='uniqueReaders'||
    !Number.isFinite(Date.parse(value.asOf)))fail(503,'CATALOG_UNAVAILABLE');
  return pick(value,['periodDays','minSample','asOf','metric']);
}
async function fingerprint(value) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
function encode(value) {
  const binary=[...new TextEncoder().encode(JSON.stringify(value))].map(value=>String.fromCharCode(value)).join('');
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function decode(value,fail) {
  if(typeof value!=='string'||value.length>2048||!/^[A-Za-z0-9_-]+$/.test(value))fail(400,'INVALID_CURSOR');
  try {
    const binary=atob(value.replace(/-/g,'+').replace(/_/g,'/'));
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,char=>char.charCodeAt(0))));
  } catch { fail(400,'INVALID_CURSOR'); }
}
function cursorShape(cursor) {
  return object(cursor) && Object.keys(cursor).length===6 && cursor.v===1 &&
    ['list','episodes'].includes(cursor.action) && /^[a-f0-9]{64}$/.test(cursor.filter||'') &&
    typeof cursor.asOf==='string' && Number.isFinite(Date.parse(cursor.asOf)) && validId(cursor.id) &&
    typeof cursor.key==='string' && /^-?\d{1,20}(?:\.\d{1,6})?$/.test(cursor.key);
}
export async function stage16Catalog({url,env,db,fail}) {
  if(!discoveryEnabled(env))fail(503,'READER_DISCOVERY_NOT_ACTIVATED');
  const action=url.searchParams.get('action');
  if(!Object.hasOwn(actions,action))fail(400,'INVALID_ACTION');
  const allowed=actions[action];
  for(const key of url.searchParams.keys()) {
    if(!allowed.includes(key) || (key!=='tag' && url.searchParams.getAll(key).length!==1))fail(400,'INVALID_QUERY');
  }
  const data={};
  if(['work','episodes','chapter'].includes(action)) {
    data.workId=url.searchParams.get('workId');
    if(!validId(data.workId))fail(400,'INVALID_WORK_ID');
  }
  if(action==='chapter') {
    const value=url.searchParams.get('episodeNumber')||'';
    if(!/^[1-9]\d{0,9}$/.test(value)||Number(value)>2147483647)fail(400,'INVALID_EPISODE_NUMBER');
    data.episodeNumber=Number(value);
  }
  if(action==='list') {
    data.q=(url.searchParams.get('q')||'').trim();
    data.genre=url.searchParams.get('genre')||'ALL';
    data.status=url.searchParams.get('status')||'ALL';
    data.epRange=url.searchParams.get('epRange')||'ALL';
    data.rating=url.searchParams.get('rating')||'ALL';
    data.sort=url.searchParams.get('sort')||'latest';
    data.type=url.searchParams.get('type')||'NOVEL';
    data.tags=[...new Set(url.searchParams.getAll('tag').map(value=>value.trim()))].sort();
    if(data.q.length>100||/[\x00-\x1f\x7f]/.test(data.q)||data.genre.length>40||/[\x00-\x1f\x7f]/.test(data.genre)||
      !['ALL','ONGOING','COMPLETED'].includes(data.status)||!['ALL','1-25','26-100','101+'].includes(data.epRange)||
      !['ALL','ALL_AGES','AGE_15','AGE_19'].includes(data.rating)||
      !['latest','new','popular','views','episodes'].includes(data.sort)||!['NOVEL','WEBTOON'].includes(data.type)||
      data.tags.length>10||data.tags.some(tag=>!tag||tag.length>40||/[\x00-\x1f\x7f]/.test(tag)))fail(400,'INVALID_QUERY');
    if(data.sort==='views')data.sort='popular';
  }
  const filter=await fingerprint({action,...data});
  if(['list','episodes'].includes(action)) {
    const limit=url.searchParams.get('limit')||'24';
    if(!/^[1-9]\d?$/.test(limit)||Number(limit)>50)fail(400,'INVALID_LIMIT');
    data.limit=Number(limit);
    if(url.searchParams.has('cursor')) {
      const cursor=decode(url.searchParams.get('cursor'),fail);
      if(!cursorShape(cursor)||cursor.action!==action||cursor.filter!==filter||Date.parse(cursor.asOf)>Date.now()+60000)
        fail(400,'INVALID_CURSOR');
      data.cursor={key:cursor.key,id:cursor.id};data.asOf=cursor.asOf;
    }
  }
  const result=await db('rpc/stage16_catalog',{}, {method:'POST',body:{p_action:action,p_query:data}});
  if(result?.error)fail([400,404].includes(result.status)?result.status:503,result.error);
  if(!object(result))fail(503,'CATALOG_UNAVAILABLE');
  if(action==='home') {
    if(!object(result.sections))fail(503,'CATALOG_UNAVAILABLE');
    const sections={};
    for(const key of ['recommended','popular','new','completed']) {
      if(!Array.isArray(result.sections[key])||result.sections[key].length>8)fail(503,'CATALOG_UNAVAILABLE');
      sections[key]=result.sections[key].map(work=>projectWork(work,fail));
    }
    return {sections,ranking:rank(result.ranking,fail)};
  }
  if(action==='work')return {work:projectWork(result.work,fail,true)};
  if(action==='chapter')return {
    episode:projectEpisode(result.episode,data.workId,fail),
    previous:result.previous==null?null:projectEpisode(result.previous,data.workId,fail),
    next:result.next==null?null:projectEpisode(result.next,data.workId,fail)
  };
  const key=action==='list'?'works':'episodes';
  if(!Array.isArray(result[key])||result[key].length>data.limit)fail(503,'CATALOG_UNAVAILABLE');
  let nextCursor=null;
  const ranking=action==='list'?rank(result.ranking,fail):null;
  if(result.nextCursor!=null) {
    const cursor={v:1,action,filter,asOf:ranking?.asOf||result.asOf,key:result.nextCursor.key,id:result.nextCursor.id};
    if(!cursorShape(cursor))fail(503,'CATALOG_UNAVAILABLE');
    nextCursor=encode(cursor);
  }
  return {[key]:result[key].map(value=>action==='list'?projectWork(value,fail):projectEpisode(value,data.workId,fail)),
    nextCursor,...(ranking?{ranking}:{})};
}

export function publicContent(result,fail) {
  if(result?.error)fail([403,404].includes(result.status)?result.status:503,result.error);
  const episode=result?.episode;
  if(!visibleEpisode(episode)||typeof episode.content!=='string'||!Array.isArray(episode.image_urls))
    fail(503,'CONTENT_UNAVAILABLE');
  return {success:true,episode:{...projectEpisode(episode,episode.work_id,fail),content:episode.content,
    author_comment:typeof episode.author_comment==='string'?episode.author_comment:'',image_urls:episode.image_urls}};
}
