// Read-only public UI inventory and deployment parity. No credentials, browser or API calls.
import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {parse} from 'parse5';

const publicRoot=fileURLToPath(new URL('../public/',import.meta.url));
const inventoryOrigin='https://inventory.example';
const defaultPages=['/','/company/','/policies/terms/','/policies/refund/'];
const attr=(node,name)=>node.attrs?.find(item=>item.name===name)?.value;
const nodes=node=>[node,...(node.childNodes||[]).flatMap(nodes)];
const hash=(bytes,algorithm='sha256',encoding='hex')=>createHash(algorithm).update(bytes).digest(encoding);
// Byte-preserving normalization: no trimming, BOM removal or Unicode replacement.
export const normalizeNewlines=bytes=>Buffer.from(Buffer.from(bytes).toString('latin1').replace(/\r\n/g,'\n'),'latin1');
const textKind=kind=>['html','css','js'].includes(kind);
const fingerprint=(bytes,kind)=>hash(textKind(kind)?normalizeNewlines(bytes):bytes);

export function validateOrigin(value){
 let url;try{url=new URL(value);}catch{throw Error('INVALID_PUBLIC_ORIGIN');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||!['','/'].includes(url.pathname)||
   isIP(url.hostname)||!url.hostname.includes('.')||/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname))throw Error('INVALID_PUBLIC_ORIGIN');
 return url.origin;
}
function reference(raw,base){
 if(typeof raw!=='string'||/[\\\x00-\x20\x7f]/.test(raw)||/%(?:2e|2f|5c)/i.test(raw)||/(?:^|\/)\.\.(?:\/|$)/.test(raw))return {skip:'UNSAFE_REFERENCE'};
 let url;try{url=new URL(raw,base);}catch{return {skip:'UNSAFE_REFERENCE'};}
 if(url.username||url.password||!['https:','http:'].includes(url.protocol))return {skip:'UNSAFE_REFERENCE'};
 if(url.origin!==new URL(base).origin)return {external:url.hostname};
 if(url.hash||url.search&&!/^\?v=[A-Za-z0-9._-]+$/.test(url.search))return {skip:'UNSUPPORTED_ASSET_QUERY'};
 if(url.pathname.startsWith('/api/')||/public-config\.js$/.test(url.pathname))return {skip:'CONFIG_OR_API_EXCLUDED'};
 if(!/^\/(?:css\/|js\/|vendor\/|fonts\/|styles\.css$|app\.js$|supabase-admin\.js$)/.test(url.pathname))return {skip:'OUTSIDE_UI_SCOPE'};
 const kind=url.pathname.match(/\.(css|js|woff2)$/)?.[1];
 return kind?{path:url.pathname+url.search,kind}:{skip:'OUTSIDE_UI_SCOPE'};
}
export function htmlReferences(source,page='/',origin=inventoryOrigin){
 const local=[],external=[],skipped=[];
 for(const node of nodes(parse(source))){
  let raw,kind,blocking=false;
  if(node.tagName==='script'&&attr(node,'src')){raw=attr(node,'src');kind='script';blocking=attr(node,'async')===undefined&&attr(node,'defer')===undefined&&attr(node,'type')!=='module';}
  if(node.tagName==='link'){
   const rel=(attr(node,'rel')||'').toLowerCase().split(/\s+/);
   if(rel.includes('stylesheet')){raw=attr(node,'href');kind='stylesheet';blocking=attr(node,'disabled')===undefined&&(!attr(node,'media')||attr(node,'media')==='all');}
   else if(rel.includes('preload')&&['font','script','style'].includes(attr(node,'as'))){raw=attr(node,'href');kind='preload';}
  }
  if(!raw)continue;const item=reference(raw,new URL(page,origin));
  if(item.path)local.push({...item,kind:item.kind,role:kind,blocking,integrity:attr(node,'integrity')||null});
  else if(item.external)external.push({host:item.external,role:kind,blocking});
  else skipped.push(item.skip);
 }
 return {local,external,skipped};
}
function localPath(root,path){
 const pathname=path.split('?')[0],relative=pathname.endsWith('/')?pathname+'index.html':pathname;
 if(!/^\/[A-Za-z0-9_./-]+$/.test(relative)||relative.split('/').includes('..'))throw Error('INVALID_LOCAL_PATH');
 const file=resolve(root,'.'+relative),base=resolve(root)+sep;
 if(!file.startsWith(base))throw Error('INVALID_LOCAL_PATH');return file;
}
const sriMatches=(bytes,integrity)=>integrity.split(/\s+/).some(value=>{
 const match=value.match(/^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/);return !!match&&hash(bytes,match[1],'base64')===match[2];
});

export async function inventoryDelivery({root=publicRoot,pages=defaultPages,maxAssets=96,read=readFile}={}){
 const assets=new Map(),documents=[],findings=[];
 const add=(path,kind,source,integrity)=>{
  if(!assets.has(path)){
   if(assets.size>=maxAssets)throw Error('ASSET_LIMIT_EXCEEDED');
   assets.set(path,{path,kind,sources:[],integrities:[]});
  }
  const item=assets.get(path);if(!item.sources.includes(source))item.sources.push(source);
  if(integrity&&!item.integrities.includes(integrity))item.integrities.push(integrity);
 };
 for(const page of pages){if(!defaultPages.includes(page))throw Error('UNSUPPORTED_PUBLIC_PAGE');add(page,'html','document');}
 for(const item of assets.values()){
  let bytes;try{bytes=Buffer.from(await read(localPath(root,item.path)));}catch{item.local={error:'LOCAL_ASSET_UNAVAILABLE'};findings.push({code:'LOCAL_ASSET_UNAVAILABLE',path:item.path});continue;}
  item.local={bytes:bytes.length,sha256:fingerprint(bytes,item.kind),normalization:textKind(item.kind)?'CRLF_TO_LF':'BINARY'};
  if(item.integrities.some(value=>!sriMatches(bytes,value)))findings.push({code:'LOCAL_INTEGRITY_MISMATCH',path:item.path});
  if(item.kind==='html'){
   const references=htmlReferences(bytes.toString('utf8'),item.path);documents.push({path:item.path,...references});
   for(const child of references.local)add(child.path,child.kind,item.path,child.integrity);
  }else if(item.kind==='css'){
   for(const match of bytes.toString('utf8').matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g)){
    const child=reference(match[1],new URL(item.path,inventoryOrigin));if(child.path&&child.kind==='woff2')add(child.path,child.kind,item.path);
   }
  }else if(item.path.split('?')[0]==='/js/core/role-modules.js'){
   for(const match of bytes.toString('utf8').matchAll(/['"]((?:\/js\/|\/vendor\/)[^'"\s]+\.js(?:\?v=[A-Za-z0-9._-]+)?)['"]/g)){
    const child=reference(match[1],inventoryOrigin);if(child.path)add(child.path,child.kind,'lazy-role');
   }
  }
 }
 return {assets:[...assets.values()],documents,findings};
}
function directive(header,name){return (header||'').split(';').map(value=>value.trim().split(/\s+/)).find(parts=>parts[0]===name)?.slice(1)||[];}
export function headerSummary(headers){
 const csp=headers.get('content-security-policy'),report=headers.get('content-security-policy-report-only'),cache=headers.get('cache-control')||'';
 const maxAge=cache.match(/(?:^|,)\s*max-age=(\d+)(?:\s*,|$)/i);
 // A matching token with extra sources is a wider policy. Combined response policies
 // need a full CSP intersection evaluator; this narrow baseline check fails closed.
 const exactSource=(name,allowed)=>{const values=directive(csp,name);return !!csp&&!csp.includes(',')&&values.length===1&&allowed.includes(values[0]);};
 return {cache:{revalidates:/(?:^|,)\s*(?:no-cache|no-store)(?:\s*,|$)/i.test(cache),immutable:/(?:^|,)\s*immutable(?:\s*,|$)/i.test(cache),maxAge:maxAge?Number(maxAge[1]):null},
  nosniff:headers.get('x-content-type-options')?.toLowerCase()==='nosniff',frameDenied:headers.get('x-frame-options')?.toUpperCase()==='DENY',
  referrerPolicy:headers.get('referrer-policy')==='strict-origin-when-cross-origin',
  csp:{baseRestricted:exactSource('base-uri',["'self'","'none'"]),objectNone:exactSource('object-src',["'none'"]),frameAncestorsNone:exactSource('frame-ancestors',["'none'"]),
   scriptControlEnforced:directive(csp,'script-src').length>0||directive(csp,'default-src').length>0,
   scriptControlReportOnly:directive(report,'script-src').length>0||directive(report,'default-src').length>0}};
}
async function limitedBytes(response,maxBytes){
 if(!response.body)return Buffer.alloc(0);const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw Error('RESPONSE_BODY_LIMIT');}chunks.push(Buffer.from(value));}return Buffer.concat(chunks,size);}
 finally{reader.releaseLock();}
}
const mimeMatches=(kind,mime)=>({html:['text/html'],css:['text/css'],js:['application/javascript','text/javascript'],woff2:['font/woff2','application/font-woff2','application/octet-stream']})[kind]?.includes(mime);
async function remoteAsset(item,origin,{fetchImpl,maxBytes,timeoutMs}){
 for(let attempt=1;attempt<=2;attempt++){
  try{
   const response=await fetchImpl(new URL(item.path,origin),{method:'GET',redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(timeoutMs),headers:{'Accept-Encoding':'br, gzip','User-Agent':'webnovels-ui-delivery-audit'}});
   if(response.status>=500&&attempt===1){await response.body?.cancel();continue;}
   const metadata={status:response.status,attempts:attempt,headers:headerSummary(response.headers)};
   if(response.status!==200){await response.body?.cancel();return {...metadata,error:response.status>=300&&response.status<400?'REDIRECT_NOT_FOLLOWED':'HTTP_STATUS_UNEXPECTED'};}
   const bytes=await limitedBytes(response,maxBytes),mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase(),encoding=(response.headers.get('content-encoding')||'identity').toLowerCase();
   const length=response.headers.get('content-length'),size=/^\d+$/.test(length||'')&&Number.isSafeInteger(Number(length))?Number(length):null;
   const remote={...metadata,decodedBytes:bytes.length,sha256:fingerprint(bytes,item.kind),mime,mimeMatches:mimeMatches(item.kind,mime),encoding,
    encodedBytesFromContentLength:['br','gzip','deflate'].includes(encoding)?size:null,
    contentLength:size,integrityMatches:item.integrities.every(value=>sriMatches(bytes,value))};
   if(item.kind==='html')remote.references=htmlReferences(bytes.toString('utf8'),item.path,origin);
   return remote;
  }catch(error){if(error.message==='RESPONSE_BODY_LIMIT')return {attempts:attempt,error:'RESPONSE_BODY_LIMIT'};if(attempt===2)return {attempts:attempt,error:'PUBLIC_FETCH_UNAVAILABLE'};}
 }
}
export async function auditDelivery({origin,onlyPaths=[],fetchImpl=fetch,maxBytes=2_000_000,timeoutMs=12000,concurrency=4,...options}={}){
 if(origin)origin=validateOrigin(origin);
 if(!Array.isArray(onlyPaths)||onlyPaths.length>8||onlyPaths.length&&!origin)throw Error('INVALID_RESOURCE_SELECTION');
 const inventory=await inventoryDelivery(options);
 if(onlyPaths.some(path=>!inventory.assets.some(item=>item.path===path)))throw Error('UNKNOWN_INVENTORY_RESOURCE');
 const report={schemaVersion:1,checkedAt:new Date().toISOString(),mode:origin?'live':'offline',origin:origin||null,scope:onlyPaths.length?'selected-resources':'inventory',
  measurement:'Decoded resource parity and HTTP metadata only; no browser paint, Core Web Vitals or throughput benchmark.',
  coverage:'Four public documents, linked scripts/styles/font preloads, CSS font URLs and literal role-loader modules; APIs, configuration, external hosts, work images and unreferenced files excluded.',...inventory};
 if(origin){
  const targets=onlyPaths.length?report.assets.filter(item=>onlyPaths.includes(item.path)):report.assets;
  let cursor=0;const workers=Array.from({length:Math.min(Math.max(1,concurrency),4)},async()=>{
   while(cursor<targets.length){const item=targets[cursor++];if(item.local.error)continue;
    item.remote=await remoteAsset(item,origin,{fetchImpl,maxBytes,timeoutMs});item.matchesLocal=!item.remote.error&&item.remote.sha256===item.local.sha256;
    if(item.remote.error)report.findings.push({code:item.remote.error,path:item.path});
    else{
     if(!item.matchesLocal)report.findings.push({code:'DEPLOYED_CONTENT_DIFFERS',path:item.path});
     if(!item.remote.mimeMatches)report.findings.push({code:'CONTENT_TYPE_MISMATCH',path:item.path});
     if(!item.remote.integrityMatches)report.findings.push({code:'DEPLOYED_INTEGRITY_MISMATCH',path:item.path});
     if(!item.remote.headers.nosniff)report.findings.push({code:'NOSNIFF_MISSING',path:item.path});
     if(item.kind==='html'){
      const expected=inventory.documents.find(doc=>doc.path===item.path).local.map(ref=>ref.path),actual=item.remote.references.local.map(ref=>ref.path);
      item.referenceDifferences={localOnly:expected.filter(path=>!actual.includes(path)),deployedOnly:actual.filter(path=>!expected.includes(path)),orderMatches:JSON.stringify(expected)===JSON.stringify(actual)};
      if(!item.referenceDifferences.orderMatches)report.findings.push({code:'DOCUMENT_REFERENCES_DIFFER',path:item.path});
      const h=item.remote.headers;if(!h.csp.baseRestricted||!h.csp.objectNone||!h.csp.frameAncestorsNone||!h.frameDenied||!h.referrerPolicy)report.findings.push({code:'DOCUMENT_SECURITY_HEADERS_INCOMPLETE',path:item.path});
      if(!h.cache.revalidates&&h.cache.maxAge!==0)report.findings.push({code:'DOCUMENT_CACHE_REVALIDATION_UNDECLARED',path:item.path});
     }
    }
   }
  });await Promise.all(workers);
 }
 report.summary={resources:report.assets.length,localBytes:report.assets.reduce((sum,item)=>sum+(item.local.bytes||0),0),
  requested:report.assets.filter(item=>item.remote).length,liveChecked:report.assets.filter(item=>item.remote?.status===200&&!item.remote.error).length,
  unavailable:report.assets.filter(item=>item.remote?.error).length,matched:report.assets.filter(item=>item.matchesLocal).length,findings:report.findings.length,
  compressedLengthReported:report.assets.filter(item=>item.remote?.encodedBytesFromContentLength!=null).length};
 return report;
}
export async function main(args=process.argv.slice(2)){
 if(args.length===1&&args[0]==='--help'){console.log('node scripts/audit_ui_delivery.mjs [--origin https://webnovels-db4.pages.dev] [--only /asset/path?v=version]\nDefault: offline public UI inventory. Explicit origin: at most 96 resources, 4 concurrent GETs, one retry, 2 MB decoded limit per resource. --only may repeat up to 8 known inventory paths to recheck changed files without downloading every asset. API/config/external requests excluded.');return;}
 let origin;const onlyPaths=[];
 for(let at=0;at<args.length;at+=2){if(!args[at+1])throw Error('INVALID_ARGUMENTS');if(args[at]==='--origin'&&!origin)origin=args[at+1];else if(args[at]==='--only')onlyPaths.push(args[at+1]);else throw Error('INVALID_ARGUMENTS');}
 const report=await auditDelivery({origin,onlyPaths});console.log(JSON.stringify(report,null,2));
 if(report.findings.length)process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('UI_DELIVERY_AUDIT_FAILED (details redacted)');process.exitCode=2;});
