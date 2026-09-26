// Owner-only dashboard. Payout execution remains disabled.
const text = (v,min,max) => typeof v==='string' && v.trim().length>=min && v.length<=max && !/[<>\x00-\x1f\x7f]/.test(v);
const b64 = bytes => btoa(String.fromCharCode(...bytes));
export async function encryptAccount(number, secret, owner) {
  const encoder=new TextEncoder();
  const material=await crypto.subtle.importKey('raw',encoder.encode(secret),'HKDF',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:encoder.encode('webnovels-bank-v1'),info:encoder.encode(owner)},material,{name:'AES-GCM',length:256},false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(owner)},key,encoder.encode(number));
  const fingerprint=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(secret)));
  return {version:1,keyId:Array.from(fingerprint.slice(0,8),b=>b.toString(16).padStart(2,'0')).join(''),iv:b64(iv),ciphertext:b64(new Uint8Array(encrypted))};
}
export async function authorDashboardApi({request,env,actor,user,rpc,remote,fail,ready}) {
  if(actor.author?.status!=='APPROVED')fail(403,'AUTHOR_REQUIRED');
  if(!ready)fail(503,'AUTHOR_WORKSPACE_NOT_ACTIVATED');
  const url=new URL(request.url),action=url.searchParams.get('action')||'home';
  if([...url.searchParams.keys()].some(k=>!['action','month','page'].includes(k)) ||
     [...url.searchParams.keys()].some(k=>url.searchParams.getAll(k).length!==1))fail(400,'INVALID_QUERY');
  const call=(a,data={})=>rpc('launch_author_dashboard',{p_user:user.id,p_action:a,p_data:data});
  if(['home','profile','earnings'].includes(action)) {
    if(request.method!=='GET')fail(405,'METHOD_NOT_ALLOWED');
    const month=url.searchParams.get('month')||'',page=url.searchParams.get('page')||'0';
    if((month&&!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))||!/^\d{1,4}$/.test(page)||Number(page)>2000||
      (action!=='earnings'&&(url.searchParams.has('month')||url.searchParams.has('page'))))fail(400,'INVALID_QUERY');
    return call(action,action==='earnings'?{month,page:Number(page)}:{});
  }
  if(!['save-profile','save-bank'].includes(action))fail(400,'INVALID_ACTION');
  if(url.searchParams.size!==1)fail(400,'INVALID_QUERY');
  if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED');
  if(request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');
  if(!request.headers.get('content-type')?.includes('application/json'))fail(415,'JSON_REQUIRED');
  const reader=request.body?.getReader();if(!reader)fail(400,'BODY_REQUIRED');
  let size=0;const chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>12000){await reader.cancel();fail(413,'BODY_TOO_LARGE');}chunks.push(value);}
  const bytes=new Uint8Array(size);let pos=0;for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length;}
  let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'INVALID_JSON');}
  const fields=action==='save-profile'?['version','penName','bio']:['revision','bankName','holder','accountNumber','password'];
  if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!fields.includes(k)))fail(400,'INVALID_PROFILE');
  if(action==='save-profile'){
    if(!/^[a-f0-9]{32}$/.test(data.version||'')||!text(data.penName,2,40)||typeof data.bio!=='string'||data.bio.length>2000||data.bio.includes('\0'))fail(400,'INVALID_PROFILE');
    return call(action,{version:data.version,penName:data.penName.trim(),bio:data.bio});
  }
  if(typeof data.revision!=='string'||!/^\d{1,16}$/.test(data.revision)||!text(data.bankName,2,60)||!text(data.holder,2,80)||
    typeof data.accountNumber!=='string'||!/^\d[\d -]{6,31}\d$/.test(data.accountNumber)||
    typeof data.password!=='string'||data.password.length<1||data.password.length>256)fail(400,'INVALID_BANK_DETAILS');
  const number=data.accountNumber.replace(/[ -]/g,'');if(!/^\d{8,20}$/.test(number))fail(400,'INVALID_BANK_DETAILS');
  await call('bank-attempt'); // Durable per-owner limit before asking Auth to verify a password.
  const auth=await remote('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:user.email,password:data.password})});
  data.password='';
  if(!auth.ok)fail(auth.status===429?429:403,auth.status===429?'RATE_LIMITED':'BANK_REAUTH_REQUIRED');
  const session=await auth.json();
  try {
    if(session.user?.id!==user.id||!session.access_token||session.user?.factors?.some(f=>f.status==='verified'))fail(403,'BANK_REAUTH_REQUIRED');
    const envelope=await encryptAccount(number,env.AUTHOR_BANK_ENCRYPTION_KEY||env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,user.id+':'+actor.author.id);
    return await call(action,{revision:data.revision,bankName:data.bankName.trim(),holder:data.holder.trim(),last4:number.slice(-4),envelope});
  } finally {
    // Revoke only this password-check session, never the author's existing login.
    if(session.access_token)try{await remote('/auth/v1/logout?scope=local',{method:'POST',headers:{Authorization:'Bearer '+session.access_token}});}catch{}
  }
}
