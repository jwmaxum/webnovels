import {projectWork} from './stage16-api.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id=value=>typeof value==='string'&&/^[1-9]\d{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n;
const revision=value=>typeof value==='string'&&/^(0|[1-9]\d{0,18})$/.test(value)&&BigInt(value)<=9223372036854775807n;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max,min=0)=>typeof value==='string'&&value.length<=max&&value.trim().length>=min&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)&&!/[\uD800-\uDFFF]/u.test(value);
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value.slice(0,10);
const keys=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
const blocks=['hero','recommendations','latest','ranking','notice'],menus=['home','novel','webtoon','recommendations','ranking'];
const link=value=>value===''||typeof value==='string'&&(/^\/(?:home|discover|recommendations)\/?$/.test(value)||/^\/company\/$/.test(value)||/^\/policies\/(?:terms|privacy|refund|settlement)\/$/.test(value)||/^\/works\/[1-9]\d*$/.test(value)&&id(value.slice(7)));
const windowValid=value=>(value.startsAt===null||timestamp(value.startsAt))&&(value.endsAt===null||timestamp(value.endsAt))&&(!value.startsAt||!value.endsAt||Date.parse(value.endsAt)>Date.parse(value.startsAt));
const ordered=(rows,names)=>Array.isArray(rows)&&rows.length===names.length&&new Set(rows.map(row=>row?.key)).size===names.length&&rows.every(row=>names.includes(row?.key));
export function validDisplayDocument(value){
  if(!keys(value,['selections','blocks','notices','menus','footerNote'])||!Array.isArray(value.selections)||value.selections.length>200||!ordered(value.blocks,blocks)||!ordered(value.menus,menus)||!Array.isArray(value.notices)||value.notices.length>10||!text(value.footerNote,300))return false;
  // Match the stored document contract before issuing a write RPC.
  if(/[<>]/.test(JSON.stringify(value)))return false;
  const selected=new Set(),selectionIds=new Set(),noticeIds=new Set();
  for(const row of value.selections){
    if(!keys(row,['id','workId','home','startsAt','endsAt','enabled','caption'])||!UUID.test(row.id||'')||!id(row.workId)||!['NONE','HERO','FEATURED'].includes(row.home)||!windowValid(row)||typeof row.enabled!=='boolean'||!text(row.caption,120)||selected.has(row.workId)||selectionIds.has(row.id.toLowerCase()))return false;
    selected.add(row.workId);selectionIds.add(row.id.toLowerCase());
  }
  if(value.selections.filter(row=>row.enabled&&row.home==='FEATURED').length>8)return false;
  const heroes=value.selections.filter(row=>row.enabled&&row.home==='HERO');
  for(let a=0;a<heroes.length;a++)for(let b=a+1;b<heroes.length;b++)if((heroes[a].endsAt?Date.parse(heroes[a].endsAt):Infinity)>(heroes[b].startsAt?Date.parse(heroes[b].startsAt):-Infinity)&&(heroes[b].endsAt?Date.parse(heroes[b].endsAt):Infinity)>(heroes[a].startsAt?Date.parse(heroes[a].startsAt):-Infinity))return false;
  for(const row of value.blocks)if(!keys(row,['key','enabled','title'])||typeof row.enabled!=='boolean'||!text(row.title,60,1))return false;
  for(const row of value.menus)if(!keys(row,['key','label','visible'])||typeof row.visible!=='boolean'||!text(row.label,20,1)||row.key==='home'&&!row.visible)return false;
  for(const row of value.notices){
    if(!keys(row,['id','title','body','href','startsAt','endsAt','enabled'])||!UUID.test(row.id||'')||noticeIds.has(row.id.toLowerCase())||!text(row.title,80,1)||!text(row.body,2000)||!link(row.href)||!windowValid(row)||typeof row.enabled!=='boolean')return false;
    noticeIds.add(row.id.toLowerCase());
  }
  return true;
}
async function readJson(request,fail){
  if(request.headers.get('origin')!==new URL(request.url).origin)fail(403,'ORIGIN_REQUIRED');
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')fail(415,'JSON_REQUIRED');
  const stream=request.body?.getReader();if(!stream)fail(400,'BODY_REQUIRED');const parts=[];let size=0;
  while(true){const {done,value}=await stream.read();if(done)break;size+=value.length;if(size>262144){await stream.cancel();fail(413,'BODY_TOO_LARGE');}parts.push(value);}
  const bytes=new Uint8Array(size);let position=0;for(const part of parts){bytes.set(part,position);position+=part.length;}
  let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'INVALID_DISPLAY_REQUEST');}
  if(!object(data))fail(400,'INVALID_DISPLAY_REQUEST');return data;
}
const pick=(value,fields)=>Object.fromEntries(fields.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
function card(value,fail,admin=false){
  if(!object(value)||!id(value.id))fail(503,'DISPLAY_UNAVAILABLE');
  for(const key of ['title','author','author_id','cover_image','status','content_type','rating','published_at','created_at','episode_count','view_count','like_count'])if(value[key]!==undefined&&value[key]!==null&&!['string','number','boolean'].includes(typeof value[key]))fail(503,'DISPLAY_UNAVAILABLE');
  for(const key of ['genre','tags'])if(value[key]!==undefined&&value[key]!==null&&!(typeof value[key]==='string'||Array.isArray(value[key])&&value[key].every(item=>typeof item==='string')))fail(503,'DISPLAY_UNAVAILABLE');
  if(admin&&value.eligible!==true){
    if(!text(value.title,500)||!text(value.author??'',200)||!['NOVEL','WEBTOON'].includes(value.content_type))fail(503,'DISPLAY_UNAVAILABLE');
    return {...pick(value,['id','title','author','cover_image','content_type','status','rating','genre','episode_count','published_at']),eligible:false,exclusionReason:typeof value.exclusionReason==='string'?value.exclusionReason:'NOT_PUBLICLY_ELIGIBLE'};
  }
  const result=projectWork({...value,is_top_recommended:false,is_popular_work:false,is_new_work:false},fail,true,true);
  if(UUID.test(value.selectionId||''))result.selectionId=value.selectionId.toLowerCase();
  if(text(value.caption,120))result.caption=value.caption;
  if(admin){result.eligible=true;result.exclusionReason=null;}return result;
}
export function projectDisplayPublic(result,fail,preview=false){
  if(!object(result)||result.ready!==true||!(result.revision==='0'||UUID.test(result.revision||''))||!Array.isArray(result.items)||result.items.length>24||!object(result.home)||!Array.isArray(result.home.featured)||result.home.featured.length>8||!Number.isInteger(result.offset)||result.offset<0||result.limit!==24||!Number.isInteger(result.total)||result.total<0||typeof result.hasMore!=='boolean'||result.hasMore!==(result.nextOffset!==null)||result.nextOffset!==null&&result.nextOffset!==result.offset+24)fail(503,'DISPLAY_UNAVAILABLE');
  const metadata={selections:[],blocks:result.blocks,notices:result.notices,menus:result.menus,footerNote:result.footerNote};
  if(!validDisplayDocument(metadata))fail(503,'DISPLAY_UNAVAILABLE');
  const publication=result.publication;
  if(publication!==null&&(!object(publication)||!UUID.test(publication.id||'')||!timestamp(publication.startsAt)||!(publication.endsAt===null||timestamp(publication.endsAt))))fail(503,'DISPLAY_UNAVAILABLE');
  if(!preview&&(publication===null?(result.revision!=='0'||result.items.length>0||result.home.hero!==null||result.home.featured.length>0||result.notices.length>0||result.footerNote!==''):result.revision!==publication.id))fail(503,'DISPLAY_UNAVAILABLE');
  return {ready:true,revision:result.revision,publication:publication===null?null:pick(publication,['id','startsAt','endsAt']),items:result.items.map(value=>card(value,fail)),offset:result.offset,limit:24,total:result.total,hasMore:result.hasMore,nextOffset:result.nextOffset,home:{hero:result.home.hero===null?null:card(result.home.hero,fail),featured:result.home.featured.map(value=>card(value,fail))},blocks:result.blocks,notices:result.notices,menus:result.menus,footerNote:result.footerNote};
}
function state(result,fail){
  if(!object(result)||result.ready!==true||!object(result.draft)||!revision(result.draft.revision)||!validDisplayDocument(result.draft.document)||!Array.isArray(result.releases)||result.releases.length>50)fail(503,'DISPLAY_UNAVAILABLE');
  const releases=result.releases.map(row=>{if(!object(row)||!UUID.test(row.id||'')||!timestamp(row.startsAt)||!(row.endsAt===null||timestamp(row.endsAt))||typeof row.stopped!=='boolean'||typeof row.cancelled!=='boolean'||!text(row.reason??'',500))fail(503,'DISPLAY_UNAVAILABLE');return pick(row,['id','startsAt','endsAt','createdAt','stopped','cancelled','reason']);});
  if(result.selectionCards!==undefined&&(!Array.isArray(result.selectionCards)||result.selectionCards.length>200))fail(503,'DISPLAY_UNAVAILABLE');
  return {ready:true,draft:{revision:result.draft.revision,document:result.draft.document},selectionCards:(result.selectionCards||[]).map(value=>card(value,fail,true)),releases,capabilities:{canEdit:result.capabilities?.canEdit===true},legacyAvailable:result.legacyAvailable===true,...(result.saved===true?{saved:true,replayed:result.replayed===true}:{})};
}
export async function siteDisplayPublicApi({request,rpc,fail}){
  const url=new URL(request.url);if(request.method!=='GET')fail(405,'METHOD_NOT_ALLOWED');
  if([...url.searchParams.keys()].some(key=>!['offset','type'].includes(key)||url.searchParams.getAll(key).length!==1))fail(400,'INVALID_QUERY');
  const offset=url.searchParams.get('offset')||'0',type=url.searchParams.get('type')||'ALL';
  if(!/^(0|[1-9]\d{0,5})$/.test(offset)||Number(offset)>100000||!['ALL','NOVEL','WEBTOON'].includes(type))fail(400,'INVALID_QUERY');
  return projectDisplayPublic(await rpc('site_display_public',{p_data:{offset:Number(offset),type}}),fail);
}
export async function siteDisplayAdminApi({request,user,actor,rpc,fail}){
  if(!UUID.test(user?.id||'')||actor?.userId!==user.id||actor.admin?.is_active!==true||!(actor.admin.role==='SUPER_ADMIN'||actor.admin.permissions?.includes('CURATION_WRITE')))fail(403,'ADMIN_FORBIDDEN');
  const url=new URL(request.url),action=url.searchParams.get('action'),actions={get:[],search:['q','type','offset'],legacy:['offset'],save:['revision','document','reason','requestId'],preview:['revision','at','offset'],publish:['revision','startsAt','endsAt','reason','requestId'],stop:['releaseId','reason','requestId'],restore:['releaseId','revision','reason','requestId']};
  if(url.searchParams.getAll('action').length!==1||[...url.searchParams.keys()].some(key=>key!=='action'))fail(400,'INVALID_QUERY');
  if(!Object.hasOwn(actions,action))fail(400,'INVALID_ACTION');if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED');
  const data=await readJson(request,fail);if(!keys(data,actions[action]))fail(400,'INVALID_DISPLAY_REQUEST');
  if(['save','publish','stop','restore'].includes(action)){
    if(!UUID.test(data.requestId||'')||!text(data.reason,500,3))fail(400,'REASON_REQUIRED');
  }
  if(['save','preview','publish','restore'].includes(action)&&!revision(data.revision))fail(400,'INVALID_DISPLAY_REQUEST');
  if(action==='save'&&!validDisplayDocument(data.document))fail(400,'INVALID_DISPLAY_DOCUMENT');
  if(['stop','restore'].includes(action)&&!UUID.test(data.releaseId||''))fail(400,'INVALID_DISPLAY_REQUEST');
  if(action==='search'){
    data.q=data.q??'';data.type=data.type??'ALL';if(!text(data.q,100)||!['ALL','NOVEL','WEBTOON'].includes(data.type))fail(400,'INVALID_QUERY');data.q=data.q.trim();
  }
  if(['search','legacy','preview'].includes(action)){data.offset=data.offset??0;if(!Number.isInteger(data.offset)||data.offset<0||data.offset>100000)fail(400,'INVALID_QUERY');}
  if(action==='preview'&&!timestamp(data.at)||action==='publish'&&(!timestamp(data.startsAt)||!(data.endsAt===null||timestamp(data.endsAt))||data.endsAt!==null&&Date.parse(data.endsAt)<=Date.parse(data.startsAt)))fail(400,'INVALID_DISPLAY_REQUEST');
  const result=await rpc('admin_site_display',{p_user:user.id,p_action:action,p_data:data});
  if(['get','save','publish','stop','restore'].includes(action))return state(result,fail);
  if(action==='preview'){
    if(result?.revision!==data.revision||!timestamp(result.at)||!Array.isArray(result.excluded)||result.excluded.length>200)fail(503,'DISPLAY_UNAVAILABLE');
    return {revision:result.revision,at:result.at,public:projectDisplayPublic(result.public,fail,true),excluded:result.excluded.map(row=>{if(!object(row)||!UUID.test(row.selectionId||'')||!id(row.workId)||!text(row.reason,120,1))fail(503,'DISPLAY_UNAVAILABLE');return pick(row,['selectionId','workId','reason']);})};
  }
  if(!object(result)||!Array.isArray(result.items)||result.items.length>50||result.offset!==data.offset||result.limit!==50||!Number.isInteger(result.total)||result.total<0||typeof result.hasMore!=='boolean'||result.hasMore!==(result.nextOffset!==null)||result.nextOffset!==null&&result.nextOffset!==result.offset+50)fail(503,'DISPLAY_UNAVAILABLE');
  return {...pick(result,['offset','limit','total','hasMore','nextOffset']),items:result.items.map(value=>action==='legacy'?{work:card(value.work,fail,true),origins:Array.isArray(value.origins)?value.origins.filter(origin=>typeof origin==='string').slice(0,20):[]}:card(value,fail,true))};
}
