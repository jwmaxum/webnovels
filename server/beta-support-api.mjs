const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL=/^(0|[1-9]\d{0,17})$/;
const categories=['QUESTION','BUG','IDEA','COPYRIGHT','WITHDRAWAL'];
const statuses=['OPEN','IN_REVIEW','WAITING_USER','RESOLVED','CLOSED','CANCELLED'];
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const textValue=(v,max)=>typeof v==='string'&&v.trim().length>=3&&v.trim().length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
const can=(actor,permission)=>actor.admin?.is_active===true&&(actor.admin.role==='SUPER_ADMIN'||Array.isArray(actor.admin.permissions)&&actor.admin.permissions.includes(permission));

async function readBody(request,fail){
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')fail(415,'JSON_REQUIRED');
 const stream=request.body?.getReader();if(!stream)fail(400,'INVALID_SUPPORT_REQUEST');
 const chunks=[];let length=0;
 while(true){const {done,value}=await stream.read();if(done)break;length+=value.length;
  if(length>24576){await stream.cancel();fail(413,'BODY_TOO_LARGE');}chunks.push(value);}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'INVALID_SUPPORT_REQUEST');}
}

// The account router verifies the Supabase session. The RPC independently verifies
// the active account and permissions; public catalog/signup flags are unrelated.
export async function betaSupportApi({request,user,actor,rpc,fail}){
 if(!user?.id||!UUID.test(user.id)||!actor||actor.userId&&actor.userId!==user.id)fail(403,'ACCOUNT_REQUIRED');
 if(actor.author&&actor.author.status!=='APPROVED'||actor.reader&&actor.reader.status!=='ACTIVE'||actor.admin&&actor.admin.is_active!==true)fail(403,'ACCOUNT_REQUIRED');
 const url=new URL(request.url),admin=url.pathname==='/api/v2/admin/support';
 if(!admin&&url.pathname!=='/api/v2/support')fail(404,'NOT_FOUND');
 if(admin&&!can(actor,'CASE_READ'))fail(403,'ADMIN_FORBIDDEN');
 if(!['GET','POST'].includes(request.method))fail(405,'METHOD_NOT_ALLOWED');
 const action=url.searchParams.get('action')||(request.method==='GET'?'list':'');
 const params=[...url.searchParams.keys()];
 if(new Set(params).size!==params.length)fail(400,'INVALID_SUPPORT_REQUEST');
 const call=data=>rpc('beta_support',{p_user:user.id,p_admin:admin,p_action:action,p_data:data});
 if(request.method==='GET'){
  if(!['list','detail'].includes(action)||params.some(k=>!(action==='list'?['action','offset','status',...(admin?['category']:[])]:['action','id']).includes(k)))fail(400,'INVALID_SUPPORT_REQUEST');
  if(action==='detail'){
   const id=url.searchParams.get('id');if(!UUID.test(id||''))fail(400,'INVALID_SUPPORT_REQUEST');return call({id:id.toLowerCase()});
  }
  const offset=url.searchParams.get('offset')||'0',status=url.searchParams.get('status'),category=url.searchParams.get('category');
  if(!/^(0|[1-9]\d{0,5})$/.test(offset)||status!==null&&!statuses.includes(status)||category!==null&&!categories.includes(category))fail(400,'INVALID_SUPPORT_REQUEST');
  return call({offset:Number(offset),...(status?{status}:{}),...(category?{category}:{})});
 }
 if(request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');
 if(admin&&!can(actor,'CASE_RESOLVE'))fail(403,'ADMIN_FORBIDDEN');
 if(params.some(k=>k!=='action')||!(admin?['reply','transition']:['create','reply','reopen','cancel']).includes(action))fail(400,'INVALID_SUPPORT_REQUEST');
 const data=await readBody(request,fail);
 const allowed=action==='create'?['requestId','category','title','message','workId','withdrawalConfirmed']:['requestId','id','revision','message',...(action==='transition'?['status']:[])];
 if(!object(data)||Object.keys(data).some(k=>!allowed.includes(k))||!UUID.test(data.requestId||'')||!textValue(data.message,4000))fail(400,'INVALID_SUPPORT_REQUEST');
 const clean={...data,requestId:data.requestId.toLowerCase(),message:data.message.trim()};
 if(action==='create'){
  if(!categories.includes(data.category)||!textValue(data.title,120)||data.workId!==undefined&&data.workId!==null&&(typeof data.workId!=='string'||!/^[1-9]\d{0,17}$/.test(data.workId))||
   data.withdrawalConfirmed!==undefined&&data.withdrawalConfirmed!==true||data.category==='WITHDRAWAL'&&data.withdrawalConfirmed!==true)fail(400,'INVALID_SUPPORT_REQUEST');
  clean.title=data.title.trim();clean.workId=data.workId??null;
 }else{
  if(!UUID.test(data.id||'')||typeof data.revision!=='string'||!DECIMAL.test(data.revision)||action==='transition'&&(!statuses.includes(data.status)||data.status==='CANCELLED'))fail(400,'INVALID_SUPPORT_REQUEST');
  clean.id=data.id.toLowerCase();
 }
 return call(clean);
}
