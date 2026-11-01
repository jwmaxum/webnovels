import {settlementKeyReady,encryptSettlement,decryptSettlement,settlementFingerprint} from './author-settlement-crypto.mjs';
import {settlementPolicy,settlementTransferNoticeReady} from './author-settlement-policy.mjs';
import '../public/js/creator/file-image.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const revision=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(value);
const id=value=>typeof value==='string'&&/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n;
const noIdentifier=value=>!/[0-9]{6}[ -]?[0-9]{7}|[0-9]{12,}/.test(value);
const text=(value,min,max)=>typeof value==='string'&&value.trim().length>=min&&value.length<=max&&!/[<>\x00-\x1f\x7f]/.test(value)&&noIdentifier(value);
export const settlementRegistrationEnabled=env=>env.AUTHOR_SETTLEMENT_REGISTRATION_ENABLED==='true'&&settlementKeyReady(env);
export const settlementCollectionEnabled=env=>settlementRegistrationEnabled(env)&&env.AUTHOR_SETTLEMENT_PRIVACY_REVIEWED==='true'&&settlementTransferNoticeReady(env);
const decode=value=>Uint8Array.from(atob(value),character=>character.charCodeAt(0));
function dimensions(bytes,mime){
 if(mime==='image/png'){
  if(bytes.length<45||![137,80,78,71,13,10,26,10].every((byte,index)=>bytes[index]===byte))throw Error();
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let cursor=8,width,height,ended=false;
  while(cursor+12<=bytes.length){
   const size=view.getUint32(cursor),name=String.fromCharCode(...bytes.subarray(cursor+4,cursor+8));
   if(size>bytes.length-cursor-12||!['IHDR','IDAT','IEND','sRGB','gAMA','cHRM','pHYs'].includes(name))throw Error();
   if(cursor===8){if(name!=='IHDR'||size!==13)throw Error();width=view.getUint32(cursor+8);height=view.getUint32(cursor+12);}
   if(name==='IEND'){if(size!==0||cursor+12!==bytes.length)throw Error();ended=true;break;}
   cursor+=size+12;
  }
  if(!ended)return null;return {width,height};
 }
 if(bytes.length<20||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw Error();
 let position=2,width,height,scan=false;
 while(position+3<bytes.length){
  if(bytes[position++]!==255)throw Error();while(bytes[position]===255)position++;
  const marker=bytes[position++];if(marker===217)break;
  const length=(bytes[position]<<8)|bytes[position+1];if(length<2||position+length>bytes.length)throw Error();
  // Canvas exports contain no EXIF, textual comments, or source ICC/Photoshop metadata.
  if(marker===225||marker===226||marker===237||marker===254)throw Error();
  if([192,193,194].includes(marker)){if(length<8)throw Error();height=(bytes[position+3]<<8)|bytes[position+4];width=(bytes[position+5]<<8)|bytes[position+6];}
  if(marker===218){scan=true;break;}position+=length;
 }
 return scan?{width,height}:null;
}
export function validateSettlementImage(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['mime','data'].includes(key))||
  !['image/jpeg','image/png'].includes(value.mime)||typeof value.data!=='string'||value.data.length>204800||
  !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data))throw Error('INVALID_SETTLEMENT_IMAGE');
 try{const bytes=decode(value.data);if(bytes.length<20||bytes.length>150*1024)throw Error();
  const known=globalThis.CreatorFileImage.dimensions(bytes,{maxEdge:4096});if(known.type!==value.mime)throw Error();
  const size=dimensions(bytes,value.mime);if(!size||!Number.isInteger(size.width)||!Number.isInteger(size.height)||size.width<1||size.height<1||size.width>4096||size.height>4096||size.width*size.height>8000000)throw Error();
 }catch{throw Error('INVALID_SETTLEMENT_IMAGE');}
 return {mime:value.mime,data:value.data};
}
async function readJson(request,limit,fail){
 const url=new URL(request.url);if(request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))fail(415,'JSON_REQUIRED');
 const stream=request.body?.getReader();if(!stream)fail(400,'BODY_REQUIRED');let size=0;const parts=[];
 while(true){const {done,value}=await stream.read();if(done)break;size+=value.length;if(size>limit){await stream.cancel();fail(413,'BODY_TOO_LARGE');}parts.push(value);}
 const bytes=new Uint8Array(size);let position=0;for(const part of parts){bytes.set(part,position);position+=part.length;}
 let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'INVALID_JSON');}
 if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'INVALID_SETTLEMENT_DETAILS');return data;
}
async function reauthenticate({password,user,rpc,remote,admin,fail}){
 if(user.factors?.some(factor=>factor.status==='verified'))fail(403,'SETTLEMENT_REAUTH_REQUIRED');
 if(typeof password!=='string'||password.length<1||password.length>256)fail(403,'SETTLEMENT_REAUTH_REQUIRED');
 await rpc('author_settlement_registration',{p_user:user.id,p_action:admin?'admin-attempt':'attempt'});
 const response=await remote('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:user.email,password})});
 if(!response.ok)fail(response.status===429?429:403,response.status===429?'RATE_LIMITED':'SETTLEMENT_REAUTH_REQUIRED');
 const session=await response.json();
 try{
  if(session.user?.id!==user.id||!session.access_token||session.user?.factors?.some(factor=>factor.status==='verified'))fail(403,'SETTLEMENT_REAUTH_REQUIRED');
 }finally{
  // Revoke this check session only, without logging out the user's current session.
  if(session.access_token)try{await remote('/auth/v1/logout?scope=local',{method:'POST',headers:{Authorization:'Bearer '+session.access_token}});}catch{}
 }
}
const fields=(data,keys,fail)=>{if(Object.keys(data).some(key=>!keys.includes(key)))fail(400,'INVALID_SETTLEMENT_DETAILS');};
export async function authorSettlementApi({request,env,actor,user,rpc,remote,fail,ready}){
 const url=new URL(request.url),admin=url.pathname.startsWith('/api/v2/admin/settlements/identity');
 if(admin){if(actor.admin?.is_active!==true||actor.admin.role!=='SUPER_ADMIN')fail(403,'ADMIN_FORBIDDEN');}
 else if(actor.author?.status!=='APPROVED')fail(403,'AUTHOR_REQUIRED');
 if(!ready)fail(503,'AUTHOR_WORKSPACE_NOT_ACTIVATED');
 const policy=await settlementPolicy(env),enabled=settlementRegistrationEnabled(env);
 const match=url.pathname.match(admin?/^\/api\/v2\/admin\/settlements\/identity(?:\/([1-9][0-9]{0,18})\/(reveal|review))?$/:/^\/api\/v2\/creator\/settlement(?:\/(withdraw|bank\/delete))?$/);
 if(!match)fail(404,'NOT_FOUND');
 if(!admin&&request.method==='GET'&&!match[1]){
  if(url.searchParams.size)fail(400,'INVALID_QUERY');
  if(!enabled)return {enabled:false,collectionEnabled:false,policy,application:null,taxCollectionEnabled:false};
  const result=await rpc('author_settlement_registration',{p_user:user.id,p_action:'get'});
  return {enabled:true,collectionEnabled:settlementCollectionEnabled(env),policy,application:result.application||null,taxCollectionEnabled:false};
 }
 if(!enabled)fail(503,'SETTLEMENT_NOT_ACTIVATED');
 if(admin&&!match[1]){
  if(request.method!=='GET')fail(405,'METHOD_NOT_ALLOWED');
  if([...url.searchParams.keys()].some(key=>key!=='offset')||url.searchParams.getAll('offset').length>1||!/^(0|[1-9][0-9]{0,5})$/.test(url.searchParams.get('offset')||'0'))fail(400,'INVALID_QUERY');
  return rpc('author_settlement_registration',{p_user:user.id,p_action:'admin-list',p_data:{offset:url.searchParams.get('offset')||'0'}});
 }
 if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED');if(url.searchParams.size)fail(400,'INVALID_QUERY');
 const action=admin?match[2]:match[1]==='bank/delete'?'bank-delete':match[1]||'submit',authorId=admin?match[1]:String(actor.author.id);
 if(action==='submit'&&!settlementCollectionEnabled(env))fail(503,'PRIVACY_TRANSFER_NOT_READY');
 if(!id(authorId))fail(400,'INVALID_ID');
 const data=await readJson(request,action==='submit'?450000:12000,fail);
 const key=request.headers.get('idempotency-key');if(action!=='reveal'&&!UUID.test(key||''))fail(400,'INVALID_IDEMPOTENCY_KEY');
 if(!revision(data.revision))fail(400,'INVALID_SETTLEMENT_DETAILS');
 let logical,encrypted;
 if(action==='submit'){
  fields(data,['revision','applicantType','legalName','birthDate','postalCode','address','addressDetail','companyName','businessNumber','documentType','identityImage','businessImage','privacyConsent','redactionConfirmed','policyVersion','policyHash','transferConsent','transferNoticeVersion','transferNoticeHash','password'],fail);
  if(data.privacyConsent!==true||data.redactionConfirmed!==true||data.policyVersion!==policy.version||data.policyHash!==policy.hash||data.transferConsent!==true||data.transferNoticeVersion!==policy.transferNoticeVersion||data.transferNoticeHash!==policy.transferNoticeHash)fail(400,'POLICY_CONFIRMATION_REQUIRED');
  const birth=/^(19|20)\d{2}-\d{2}-\d{2}$/.test(data.birthDate||'')?new Date(data.birthDate+'T00:00:00Z'):null;
  if(!['INDIVIDUAL','SOLE_PROPRIETOR','CORPORATION'].includes(data.applicantType)||!['RESIDENT_CARD','DRIVER_LICENSE','PASSPORT'].includes(data.documentType)||
   !text(data.legalName,2,80)||!birth||!Number.isFinite(birth.getTime())||birth.toISOString().slice(0,10)!==data.birthDate||data.birthDate>new Date().toISOString().slice(0,10)||
   !/^\d{5}$/.test(data.postalCode||'')||!text(data.address,3,200)||!text(data.addressDetail??'',0,200))fail(400,'INVALID_SETTLEMENT_DETAILS');
  const business=data.applicantType!=='INDIVIDUAL',companyName=business?data.companyName:'',businessNumber=business?String(data.businessNumber||'').replace(/-/g,''):'';
  if(business&&(!text(companyName,2,100)||!/^\d{10}$/.test(businessNumber)))fail(400,'INVALID_SETTLEMENT_DETAILS');
  let identityImage,businessImage;
  try{identityImage=validateSettlementImage(data.identityImage);businessImage=business?validateSettlementImage(data.businessImage):null;}
  catch{fail(400,'INVALID_SETTLEMENT_IMAGE');}
  if(!business&&data.businessImage!=null)fail(400,'INVALID_SETTLEMENT_DETAILS');
  const details={legalName:data.legalName.trim(),birthDate:data.birthDate,postalCode:data.postalCode,address:data.address.trim(),addressDetail:(data.addressDetail||'').trim(),companyName:companyName.trim(),businessNumber};
  logical={revision:data.revision,applicantType:data.applicantType,documentType:data.documentType,...details,identityImage,businessImage,policyVersion:policy.version,policyHash:policy.hash,transferNoticeVersion:policy.transferNoticeVersion,transferNoticeHash:policy.transferNoticeHash};
  const context={userId:user.id,authorId,revision:(BigInt(data.revision)+1n).toString()};
  encrypted={profileEnvelope:await encryptSettlement(details,{...context,purpose:'profile'},env),identityEnvelope:await encryptSettlement(identityImage,{...context,purpose:'identity-image'},env),businessEnvelope:business?await encryptSettlement(businessImage,{...context,purpose:'business-image'},env):null};
 }else if(action==='withdraw'||action==='bank-delete'){
  fields(data,['revision','password'],fail);logical={revision:data.revision};
 }else if(action==='reveal'){
  fields(data,['revision','reason','password'],fail);if(!text(data.reason,3,200))fail(400,'REASON_REQUIRED');logical={revision:data.revision,reason:data.reason.trim()};
 }else{
  fields(data,['revision','decision','note','password'],fail);if(!['APPROVED','NEEDS_CHANGES'].includes(data.decision)||!text(data.note,3,500))fail(400,'INVALID_SETTLEMENT_REVIEW');
  logical={revision:data.revision,decision:data.decision,note:data.note.trim()};
 }
 try{await reauthenticate({password:data.password,user,rpc,remote,admin,fail});}finally{data.password='';}
 const fingerprint=await settlementFingerprint({userId:user.id,authorId,action,data:logical},env);
 const payload=action==='submit'?{revision:data.revision,applicantType:data.applicantType,documentType:data.documentType,policyVersion:policy.version,policyHash:policy.hash,transferNoticeVersion:policy.transferNoticeVersion,transferNoticeHash:policy.transferNoticeHash,...encrypted,requestFingerprint:fingerprint}
  :action==='reveal'?{revision:data.revision,reasonFingerprint:fingerprint}:{...logical,requestFingerprint:fingerprint};
 const result=await rpc('author_settlement_registration',{p_user:user.id,p_action:action,p_author:admin?authorId:null,p_data:payload,...(action!=='reveal'?{p_key:key}:{})});
 if(action!=='reveal')return result;
 const secured=result.encrypted,application=result.application;
 if(!secured||secured.authorId!==authorId||secured.revision!==data.revision||application?.authorId!==authorId||application.revision!==data.revision||application.status!=='PENDING'||!UUID.test(secured.userId||''))fail(503,'SETTLEMENT_DOCUMENT_UNAVAILABLE');
 const context={userId:secured.userId,authorId,revision:secured.revision};let details;
 try{
  const profile=await decryptSettlement(secured.profileEnvelope,{...context,purpose:'profile'},env);
  const identityImage=validateSettlementImage(await decryptSettlement(secured.identityEnvelope,{...context,purpose:'identity-image'},env));
  const businessImage=secured.businessEnvelope?validateSettlementImage(await decryptSettlement(secured.businessEnvelope,{...context,purpose:'business-image'},env)):null;
  details={...profile,identityImage,businessImage};
 }catch{fail(503,'SETTLEMENT_KEY_UNAVAILABLE');}
 return {application,details};
}
