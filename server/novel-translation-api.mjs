import '../public/js/shared/manuscript-document.js';

export const NOVEL_TRANSLATION_LOCALES=Object.freeze(['en','ja','zh-Hans']);
const targetCodes=Object.freeze({en:'en',ja:'ja','zh-Hans':'zh-CN'});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id=value=>typeof value==='string'&&/^[1-9]\d{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const novelTranslationEnabled=env=>env.FREE_BETA_ENABLED==='true'&&env.NEW_SERIALS_ENABLED==='true'&&
  env.AUTHOR_PUBLISH_ENABLED==='true'&&env.READER_SERVICE_ENABLED==='true'&&env.NOVEL_TRANSLATION_PILOT_ENABLED==='true';

function translationSource(source){
  const manuscript=globalThis.ManuscriptDocument;
  const doc=manuscript.valid(source.contentDocument,source.content)?source.contentDocument:manuscript.fromText(source.content);
  const title=String(source.title||'').trim();
  if(!manuscript.valid(doc)||!title||title.length>500||/[\x00-\x1f\x7f]/.test(title))throw Error('TRANSLATION_SOURCE_LIMIT');
  const parts=[title];
  const layout=doc.paragraphs.map(paragraph=>paragraph.runs.map(run=>run.text.split('\n').map(line=>{
    const value=line.trim();
    if(!value)return {line};
    const start=line.indexOf(value),position=parts.push(value)-1;
    return {position,before:line.slice(0,start),after:line.slice(start+value.length)};
  })));
  const count=parts.reduce((total,part)=>total+[...part].length,0);
  if(parts.length<2||parts.length>1024||count>28000||parts.some(part=>part.length>8000))
    throw Error('TRANSLATION_SOURCE_LIMIT');
  return {doc,parts,layout,count};
}
function validSegments(segments,count){
  return Array.isArray(segments)&&segments.length===count&&segments.every(value=>typeof value==='string'&&value===value.trim()&&
    value.length>0&&value.length<=8000&&!/[\x00-\x1f\x7f]/.test(value))&&
    new TextEncoder().encode(JSON.stringify(segments)).length<=240000;
}
function projectTranslation(source,segments){
  if(!validSegments(segments,source.parts.length)||segments[0].length>500)throw Error('TRANSLATION_INVALID_SEGMENTS');
  const contentDocument={version:1,paragraphs:source.doc.paragraphs.map((paragraph,p)=>({...paragraph,
    runs:paragraph.runs.map((run,r)=>({...run,text:source.layout[p][r].map(part=>part.position===undefined?part.line:
      part.before+segments[part.position]+part.after).join('\n')}))
  }))};
  const content=globalThis.ManuscriptDocument.text(contentDocument);
  if(!globalThis.ManuscriptDocument.valid(contentDocument,content))throw Error('TRANSLATION_INVALID_SEGMENTS');
  return {title:segments[0],content,contentDocument};
}
function providerConfig(env){
  const project=env.NOVEL_TRANSLATION_GOOGLE_PROJECT,location=env.NOVEL_TRANSLATION_GOOGLE_LOCATION;
  const token=env.NOVEL_TRANSLATION_GOOGLE_ACCESS_TOKEN;
  if(!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project||'')||
    !/^(?:global|[a-z]+-[a-z]+[0-9]+)$/.test(location||'')||
    typeof token!=='string'||!/^\S{20,4096}$/.test(token))return null;
  return {parent:'projects/'+project+'/locations/'+location,token,location};
}
async function translate({provider,locale,source,glossary,fetchImpl}){
  const response=await fetchImpl('https://translation.googleapis.com/v3/'+provider.parent+':translateText',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{Authorization:'Bearer '+provider.token,'Content-Type':'application/json'},
    body:JSON.stringify({sourceLanguageCode:'ko',targetLanguageCode:targetCodes[locale],mimeType:'text/plain',contents:source.parts,
      ...(glossary?{glossaryConfig:{glossary}}:{})})
  });
  if(!response.ok)throw Error('TRANSLATION_PROVIDER_FAILED');
  const body=await response.json(),translations=glossary?body.glossaryTranslations:body.translations;
  const segments=Array.isArray(translations)?translations.map(value=>value?.translatedText?.trim?.()):null;
  projectTranslation(source,segments);
  return segments;
}
export async function creatorNovelTranslation({request,url,env,db,actor,readBody,fail,fetchImpl=fetch}){
  if(!novelTranslationEnabled(env))fail(503,'TRANSLATION_PILOT_DISABLED');
  if(actor?.author?.status!=='APPROVED')fail(403,'AUTHOR_FORBIDDEN');
  let input,action;
  if(request.method==='GET'){
    if([...url.searchParams.keys()].some(key=>!['workId','episodeId','locale'].includes(key)||url.searchParams.getAll(key).length!==1))
      fail(400,'TRANSLATION_INVALID_REQUEST');
    input=Object.fromEntries(url.searchParams);
    action=input.episodeId===undefined?'state':'detail';
  }else if(request.method==='POST'){
    if(request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');
    if(url.search)fail(400,'TRANSLATION_INVALID_REQUEST');
    input=await readBody(request);
    action=input.action;
  }else fail(405,'METHOD_NOT_ALLOWED');
  const byAction={state:['workId'],detail:['workId','episodeId','locale'],consent:['workId','version','accepted'],
    withdraw:['workId'],generate:['workId','episodeId','locale'],save:['workId','episodeId','locale','versionId','revision','segments'],
    approve:['workId','episodeId','locale','versionId','revision','segments','reviewed']};
  if(!Object.hasOwn(byAction,action)||request.method==='POST'&&['state','detail'].includes(action)||
    !id(input.workId)||Object.keys(input).some(key=>key!=='action'&&!byAction[action].includes(key)))fail(400,'TRANSLATION_INVALID_REQUEST');
  const episodeAction=byAction[action].includes('episodeId');
  if(episodeAction&&(!id(input.episodeId)||!NOVEL_TRANSLATION_LOCALES.includes(input.locale)))fail(400,'TRANSLATION_INVALID_REQUEST');
  const call=async(kind,data={})=>{
    const result=await db('rpc/novel_translation_author',{}, {method:'POST',body:{p_user:actor.userId,p_action:kind,p_work:input.workId,
      p_episode:input.episodeId??null,p_locale:input.locale??null,p_data:data}});
    if(!object(result))fail(503,'TRANSLATION_UNAVAILABLE');
    if(result.error)fail([400,403,404,409].includes(result.status)?result.status:503,
      /^TRANSLATION_[A-Z_]+$/.test(result.error)||result.error==='WORK_NOT_FOUND'?result.error:'TRANSLATION_UNAVAILABLE');
    return result;
  };
  if(action==='state'){
    const state=await call('state');
    return {...state,generationEnabled:state.generationEnabled===true&&!!providerConfig(env)};
  }
  if(action==='consent')return call(action,{accepted:input.accepted,version:input.version});
  if(action==='withdraw')return call(action);
  const detail=await call('detail');
  let source;
  try{source=translationSource(detail);}catch{fail(400,'TRANSLATION_SOURCE_LIMIT');}
  if(action==='detail')return {versionId:detail.versionId,source:source.parts,job:detail.job};
  if(action==='save'||action==='approve'){
    if(!uuid.test(input.versionId||'')||!Number.isInteger(input.revision)||input.revision<1||
      action==='approve'&&input.reviewed!==true)fail(400,'TRANSLATION_INVALID_REQUEST');
    if(input.versionId!==detail.versionId)fail(409,'TRANSLATION_SOURCE_CHANGED');
    try{projectTranslation(source,input.segments);}catch{fail(400,'TRANSLATION_INVALID_SEGMENTS');}
    return call(action,{versionId:input.versionId,revision:input.revision,segments:input.segments});
  }
  const provider=providerConfig(env);
  if(!provider)fail(503,'TRANSLATION_PROVIDER_NOT_CONFIGURED');
  const glossary=detail.glossaryResource;
  if(glossary&&(provider.location==='global'||!glossary.startsWith(provider.parent+'/glossaries/')||
    !/^[a-zA-Z0-9_-]+$/.test(glossary.slice((provider.parent+'/glossaries/').length))))fail(503,'TRANSLATION_GLOSSARY_NOT_READY');
  const {jobId}=await call('claim',{versionId:detail.versionId,consentRevision:detail.consentRevision,glossaryVersion:detail.glossaryVersion,
    characterCount:source.count,segmentCount:source.parts.length});
  if(!uuid.test(jobId||''))fail(503,'TRANSLATION_UNAVAILABLE');
  let segments;
  try{segments=await translate({provider,locale:input.locale,source,glossary,fetchImpl});}
  catch{
    await call('fail',{jobId,versionId:detail.versionId}).catch(()=>{});
    fail(502,'TRANSLATION_PROVIDER_FAILED');
  }
  return call('finish',{jobId,versionId:detail.versionId,segments});
}

export async function withNovelTranslation({result,url,env,db,fail}){
  const episode=result.episode;
  if(!novelTranslationEnabled(env)||episode.webtoon||episode.contentType==='WEBTOON')return result;
  const query=url.searchParams.getAll('translation');
  if(query.length>1||query.length===1&&!NOVEL_TRANSLATION_LOCALES.includes(query[0]))fail(400,'TRANSLATION_INVALID_REQUEST');
  const locale=query[0]??null;
  try{
    const data=await db('rpc/novel_translation_public',{}, {method:'POST',body:{p_episode:episode.id,p_version:episode.versionId,p_locale:locale}});
    if(!Array.isArray(data))return result;
    const available=NOVEL_TRANSLATION_LOCALES.filter(code=>data.some(row=>row?.locale===code));
    const selected=data.find(row=>row?.locale===locale&&Array.isArray(row.segments));
    const translation=selected?{locale,...projectTranslation(translationSource(episode),selected.segments)}:undefined;
    return {...result,episode:{...episode,translationLocales:available,...(translation?{translation}:{})}};
  }catch{return result;}
}
