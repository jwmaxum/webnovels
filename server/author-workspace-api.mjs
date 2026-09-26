// Private author workspace reuses the canonical ownership/revision APIs and SQL.
// Its database readiness is independent of reader publication cutover.
import {creatorWorkApi} from './creator-work-api.mjs';
import {creatorDraftApi} from './creator-draft-api.mjs';
export async function authorWorkspaceApi({request,env,actor,rpc,fail,ready}) {
  if(!actor.author || actor.author.status!=='APPROVED')fail(403,'AUTHOR_REQUIRED');
  if(!ready || env.AUTHOR_WORKSPACE_DISABLED==='true')fail(503,'AUTHOR_WORKSPACE_NOT_ACTIVATED');
  const readBody=async req=>{
    if(!req.headers.get('content-type')?.includes('application/json'))fail(415,'JSON_REQUIRED');
    const reader=req.body?.getReader();if(!reader)fail(400,'BODY_REQUIRED');
    let size=0;const chunks=[];
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>1_000_000){await reader.cancel();fail(413,'BODY_TOO_LARGE');}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'INVALID_JSON');}
    if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'INVALID_JSON');return body;
  };
  const db=async (route,query,{body}={})=>{
    if(!['rpc/creator_works','rpc/creator_drafts'].includes(route))fail(403,'RPC_NOT_ALLOWED');
    return rpc(route.slice(4),body);
  };
  const handler=new URL(request.url).pathname.startsWith('/api/v2/creator/works')?creatorWorkApi:creatorDraftApi;
  return handler({request,env,actor:async()=>actor,db,readBody,fail,workspaceReady:true});
}
