const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function publicationChangeApi({request,env,actor,db,readBody,fail,fetchImpl=fetch,base,serviceHeaders}) {
  if(env.AUTHOR_PUBLICATION_REVIEW_ENABLED!=='true')fail(503,'PUBLICATION_REVIEW_NOT_ACTIVATED');
  const url=new URL(request.url),action=url.searchParams.get('action');
  const operation={'publication-changes':'list','publication-change':'detail','publication-decision':'decide','publication-image':'image'}[action];
  if(!operation)fail(400,'INVALID_ACTION');
  const write=operation==='decide';
  if(request.method!==(write?'POST':'GET'))fail(405,'METHOD_NOT_ALLOWED');
  const keys=operation==='detail'?['changeId']:operation==='image'?['changeId','side','panelId']:[];
  for(const key of url.searchParams.keys())if(!['action',...keys].includes(key)||url.searchParams.getAll(key).length!==1)fail(400,'INVALID_QUERY');
  const who=await actor();if(!who.admin?.is_active)fail(403,'ADMIN_REQUIRED');
  let data={};
  if(write){
    if(request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');
    data=await readBody(request);
    if(Object.keys(data).some(k=>!['changeId','decision','reason'].includes(k))||!['APPROVE','REJECT'].includes(data.decision)||typeof data.reason!=='string'||data.reason.trim().length<3||data.reason.length>500)fail(400,'INVALID_FIELD');
  }else for(const key of keys)if(url.searchParams.has(key))data[key]=url.searchParams.get(key);
  if(operation!=='list'&&!uuid.test(data.changeId||''))fail(400,'INVALID_FIELD');
  if(operation==='image'&&(!['before','after'].includes(data.side)||(data.panelId&&!uuid.test(data.panelId))))fail(400,'INVALID_FIELD');
  const result=await db('rpc/admin_publication_changes',{}, {method:'POST',body:{p_user:who.userId,p_action:operation,p_data:data}});
  if(result?.error)fail([400,403,404,409].includes(result.status)?result.status:503,result.error);
  if(!result||typeof result!=='object')fail(503,'DATABASE_UNAVAILABLE');
  if(operation==='image') {
    const allowed=result.bucket==='authoring-webtoons'&&result.mime==='image/png'&&/^webtoon\/[1-9]\d*\/[0-9a-f-]{36}\/[0-2]\/[a-f0-9]{64}\.png$/.test(result.path||'')||result.bucket==='authoring-covers'&&result.mime==='image/jpeg'&&/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/cover\.jpg$/.test(result.path||'');
    if(!allowed)fail(503,'STORAGE_UNAVAILABLE');
    const response=await fetchImpl(new URL('/storage/v1/object/'+result.bucket+'/'+result.path,base),{headers:serviceHeaders,signal:AbortSignal.timeout(15000)});
    if(!response.ok)fail(503,'STORAGE_UNAVAILABLE');
    return new Response(response.body,{headers:{'Content-Type':result.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  return result;
}
