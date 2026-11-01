// Real member profiles, kept separate from the administrator's test-account tools.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const decimal=value=>typeof value==='string'&&/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n;
const identifier=(kind,value)=>decimal(value)||kind==='reader'&&typeof value==='string'&&UUID.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const revision=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,18}):[a-f0-9]{32}$/.test(value)&&BigInt(value.split(':')[0])<=9223372036854775807n;
const cleanText=value=>typeof value==='string'&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const permission=(actor,key)=>actor.admin?.role==='SUPER_ADMIN'||Array.isArray(actor.admin?.permissions)&&actor.admin.permissions.includes(key);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const choices={status:['ALL','ACTIVE','APPROVED','PENDING','SUSPENDED','REJECTED','DELETED'],linked:['ALL','LINKED','UNLINKED'],
  activity:['ALL','7D','30D','90D'],hasWorks:['ALL','YES','NO'],settlement:['ALL','REGISTERED','UNREGISTERED','PENDING','APPROVED'],pending:['ALL','YES','NO']};

async function readJson(request,fail){
  if(request.headers.get('origin')!==new URL(request.url).origin)fail(403,'ORIGIN_REQUIRED');
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')fail(415,'JSON_REQUIRED');
  const stream=request.body?.getReader();if(!stream)fail(400,'BODY_REQUIRED');
  const parts=[];let size=0;
  while(true){const {done,value}=await stream.read();if(done)break;size+=value.length;
    if(size>16000){await stream.cancel();fail(413,'BODY_TOO_LARGE');}parts.push(value);}
  const bytes=new Uint8Array(size);let position=0;for(const part of parts){bytes.set(part,position);position+=part.length;}
  let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'INVALID_MEMBER_REQUEST');}
  if(!object(body))fail(400,'INVALID_MEMBER_REQUEST');return body;
}

// Project database results onto the public member-management DTO. Identity documents,
// authentication identifiers and financial envelopes never become response fields.
function project(result,kind,action,actor,fail,accountId){
  const unavailable=()=>fail(503,'MEMBER_SERVICE_UNAVAILABLE');
  if(!object(result)||result.kind!==kind)unavailable();
  const member=value=>{
    if(!object(value)||!identifier(kind,value.id)||typeof value.displayName!=='string'||typeof value.status!=='string')unavailable();
    const picked={};
    for(const key of ['id','displayName','status','createdAt','lastActivityAt','authLinked','emailConfirmed','workCount','lastPublishedAt','pendingRequests','settlementState'])
      if(Object.hasOwn(value,key)){if(value[key]!==null&&!['string','number','boolean'].includes(typeof value[key]))unavailable();picked[key]=value[key];}
    if(kind==='author'&&!canReadSettlement)picked.settlementState=null;
    if(!permission(actor,'CASE_READ')&&!permission(actor,'CONTENT_REVIEW'))picked.pendingRequests=null;
    if(kind==='author')picked.bio=typeof value.bio==='string'?value.bio:'';
    if(typeof value.maskedEmail==='string'&&/^[^@\s]*\*[^@\s]*@[^@\s]+$/.test(value.maskedEmail))picked.maskedEmail=value.maskedEmail;
    else picked.maskedEmail=null;
    if(revision(value.revision))picked.revision=value.revision;
    return picked;
  };
  const caps=object(result.capabilities)?result.capabilities:{};
  const canReadSettlement=kind==='author'&&(permission(actor,'SETTLEMENTS_READ')||permission(actor,'AUTHOR_SETTLEMENT'));
  const supportAccess=permission(actor,'CASE_READ'),changeAccess=kind==='author'&&permission(actor,'CONTENT_REVIEW');
  const sources={};if(object(caps.sources))for(const key of ['works','activity','support','publicationChanges','settlement','history','rights'])sources[key]=caps.sources[key]===true;
  sources.support=!!supportAccess&&sources.support===true;sources.publicationChanges=!!changeAccess&&sources.publicationChanges===true;
  sources.history=(permission(actor,'AUDIT_READ')||permission(actor,'SECURITY_MGMT'))&&sources.history===true;
  sources.settlement=!!canReadSettlement&&sources.settlement===true;
  const filters={};for(const key of ['work','requests','activity'])filters[key]=caps.filters?.[key]===true;
  filters.work=kind==='author'&&filters.work;filters.settlement=canReadSettlement&&caps.filters?.settlement===true;
  filters.requests=(sources.support||sources.publicationChanges)&&filters.requests;
  filters.payments=false;filters.balance=false;filters.orderSearch=false;
  const capabilities={canEditPublic:actor.admin.role==='SUPER_ADMIN'&&caps.canEditPublic===true,
    canSearchEmail:permission(actor,'ACCOUNTS_READ')&&caps.canSearchEmail===true,canReadSettlement:!!canReadSettlement&&caps.canReadSettlement===true,filters,sources};
  if(action==='list'){
    if(!Array.isArray(result.items)||result.items.length>50||!Number.isInteger(result.offset)||result.offset<0||result.limit!==50||
      typeof result.hasMore!=='boolean'||result.hasMore!==(result.nextOffset!==null)||result.nextOffset!==null&&(!Number.isInteger(result.nextOffset)||result.nextOffset!==result.offset+50)||
      !Number.isInteger(result.total)||result.total<0)unavailable();
    return {kind,items:result.items.map(member),offset:result.offset,limit:50,hasMore:result.hasMore,nextOffset:result.nextOffset,total:result.total,capabilities};
  }
  const value=member(result.member);if(value.id!==accountId||!value.revision)unavailable();
  if(action==='update-profile'){
    if(result.saved!==true)unavailable();return {saved:true,kind,member:value,replayed:result.replayed===true};
  }
  const rows=(name,fields,limit)=>{
    if(result[name]===undefined)return [];
    if(!Array.isArray(result[name])||result[name].length>limit)unavailable();
    return result[name].map(row=>{if(!object(row))unavailable();const picked={};for(const key of fields)if(Object.hasOwn(row,key)){
      if(!['before','after'].includes(key)&&row[key]!==null&&!['string','number','boolean'].includes(typeof row[key]))unavailable();picked[key]=row[key];}return picked;});
  };
  const works=kind==='author'?rows('works',['id','title','type','status','episodeCount','lastPublishedAt'],50):[];
  const requests=rows('requests',['id','kind','label','status','createdAt'],50).filter(row=>row.kind==='SUPPORT'?supportAccess:row.kind==='PUBLICATION_CHANGE'?changeAccess:false);
  const history=(permission(actor,'AUDIT_READ')||permission(actor,'SECURITY_MGMT'))?rows('history',['id','action','createdAt','reason','before','after'],20).map(item=>{
    for(const key of ['before','after'])if(object(item[key]))item[key]=Object.fromEntries(['displayName',...(kind==='author'?['bio']:[])].filter(field=>typeof item[key][field]==='string').map(field=>[field,item[key][field]]));else delete item[key];
    return item;
  }):[];
  const rights=kind==='reader'&&sources.rights?rows('rights',['id','workId','episodeNumber','source','createdAt','expiresAt'],50):[];
  const settlement={state:kind==='reader'?'NOT_APPLICABLE':capabilities.canReadSettlement?'NOT_CONNECTED':'RESTRICTED'};
  if(kind==='author'&&capabilities.canReadSettlement&&object(result.settlement)){
    for(const key of ['state','bankRegistered','applicationStatus'])if(Object.hasOwn(result.settlement,key)){
      if(result.settlement[key]!==null&&!['string','boolean'].includes(typeof result.settlement[key]))unavailable();settlement[key]=result.settlement[key];}
    settlement.verification='MANUAL_REVIEW_NOT_PASS_OR_BANK';
  }
  return {kind,member:value,works,requests,history,rights,settlement,capabilities,
    finance:{state:'NOT_CONNECTED',paidTotal:null,netPaidTotal:null,paidPoints:null,bonusPoints:null,latestPayment:null}};
}

export async function adminMembersApi({request,user,actor,rpc,fail}){
  if(!UUID.test(user?.id||'')||actor?.userId!==user.id||actor.admin?.is_active!==true||!['SUPER_ADMIN','ADMIN','SUB_ADMIN'].includes(actor.admin.role))fail(403,'ADMIN_FORBIDDEN');
  const url=new URL(request.url),action=url.searchParams.get('action');
  if(url.pathname!=='/api/v2/admin/members')fail(404,'NOT_FOUND');
  if([...url.searchParams.keys()].some(key=>key!=='action')||url.searchParams.getAll('action').length!==1)fail(400,'INVALID_QUERY');
  if(!['list','detail','update-profile'].includes(action))fail(400,'INVALID_ACTION');
  if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED');
  const body=await readJson(request,fail),kind=body.kind;
  if(!['author','reader'].includes(kind))fail(400,'INVALID_KIND');
  if(!permission(actor,'ACCOUNTS_READ')&&!permission(actor,kind==='author'?'CREATOR_MGMT':'USER_MGMT'))fail(403,'ADMIN_FORBIDDEN');
  const fields=action==='list'?['kind','q',...Object.keys(choices),'createdFrom','createdTo','offset']:
    action==='detail'?['kind','accountId']:['kind','accountId','revision','displayName',...(kind==='author'?['bio']:[]),'reason','requestId'];
  if(Object.keys(body).some(key=>!fields.includes(key)))fail(400,'INVALID_MEMBER_REQUEST');
  let data;
  if(action==='list'){
    data={kind,q:body.q??'',offset:body.offset??0,createdFrom:body.createdFrom??'',createdTo:body.createdTo??''};
    if(!cleanText(data.q)||data.q.length>100||!Number.isInteger(data.offset)||data.offset<0||data.offset>100000)fail(400,'INVALID_MEMBER_REQUEST');
    data.q=data.q.trim();
    for(const [key,values]of Object.entries(choices)){data[key]=body[key]??'ALL';if(!values.includes(data[key]))fail(400,'INVALID_MEMBER_REQUEST');}
    for(const key of ['createdFrom','createdTo'])if(data[key]!==''&&!date(data[key]))fail(400,'INVALID_MEMBER_REQUEST');
    if(data.createdFrom&&data.createdTo&&data.createdFrom>data.createdTo)fail(400,'INVALID_MEMBER_REQUEST');
    if(kind==='reader'&&(data.hasWorks!=='ALL'||data.settlement!=='ALL'))fail(400,'INVALID_MEMBER_REQUEST');
    if(data.q.includes('@')&&!permission(actor,'ACCOUNTS_READ'))fail(403,'EMAIL_SEARCH_FORBIDDEN');
    if(data.settlement!=='ALL'&&!permission(actor,'SETTLEMENTS_READ')&&!permission(actor,'AUTHOR_SETTLEMENT'))fail(403,'ADMIN_FORBIDDEN');
  }else{
    if(!identifier(kind,body.accountId))fail(400,'INVALID_MEMBER_REQUEST');
    data={kind,accountId:body.accountId.toLowerCase()};
    if(action==='update-profile'){
      if(actor.admin.role!=='SUPER_ADMIN')fail(403,'ADMIN_FORBIDDEN');
      if(!revision(body.revision)||!UUID.test(body.requestId||''))fail(400,'INVALID_MEMBER_REQUEST');
      if(typeof body.displayName!=='string'||body.displayName.trim().length<2||body.displayName.trim().length>40||/[<>\x00-\x1f\x7f]/.test(body.displayName))fail(400,'INVALID_PROFILE');
      if(kind==='author'&&(!cleanText(body.bio)||body.bio.length>2000))fail(400,'INVALID_PROFILE');
      if(!cleanText(body.reason)||body.reason.trim().length<3||body.reason.length>500)fail(400,'REASON_REQUIRED');
      data={...data,revision:body.revision,displayName:body.displayName.trim(),...(kind==='author'?{bio:body.bio}:{}),reason:body.reason.trim(),requestId:body.requestId.toLowerCase()};
    }
  }
  const result=await rpc('admin_member_directory',{p_user:user.id,p_action:action,p_data:data});
  return project(result,kind,action,actor,fail,data.accountId);
}
