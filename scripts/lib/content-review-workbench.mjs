import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import core from './content-review-session.cjs';
import {sha,decisionTemplate,validateContentDecisions,verifyReviewEvidence,reviewSummary,privateBackupDirectory} from './launch-content-review.mjs';
import {safeBundleFile} from './recovery-bundle.mjs';
const fail=code=>{throw Error('WORKBENCH_'+code);};
const id=z.string().regex(/^[1-9][0-9]{0,18}$/).refine(value=>BigInt(value)<=9223372036854775807n);
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const name=z.string().regex(/^[a-z][a-z0-9-]{2,63}$/);
export const MAX_WORKBENCH_BYTES=48*1024*1024;
export function projectContentPacket(packet) {
  if(packet.format!=='webnovels-content-packet-v1'||!digest.safeParse(packet.snapshotSha256).success||
    !z.string().datetime({offset:true}).safeParse(packet.capturedAt).success||!Array.isArray(packet.entries)||packet.entries.length>100000)fail('INVALID_PACKET');
  const seen=new Set();
  const entries=packet.entries.map(row=>{
    if(!id.safeParse(row.episodeId).success||!id.safeParse(row.workId).success||!id.safeParse(row.episodeNumber).success||
      !(row.authorId===null||id.safeParse(row.authorId).success)||seen.has(row.episodeId)||typeof row.authMappingVerified!=='boolean'||
      !Number.isSafeInteger(row.imageCount)||row.imageCount<0||typeof row.contentType!=='string')fail('INVALID_PACKET_ROW');
    seen.add(row.episodeId);
    const episode=JSON.parse(row.source.episode),alternate=JSON.parse(row.source.content),work=JSON.parse(row.source.work);
    if(!digest.safeParse(row.sourceDigest).success||sha(JSON.stringify(row.source))!==row.sourceDigest)fail('SOURCE_DIGEST_MISMATCH');
    const options=[['USE_EPISODES',episode.content,row.currentIsSeed,row.episodesSourceSha256],
      ['USE_EPISODE_CONTENTS',alternate.text_content,row.alternateIsSeed,row.episodeContentsSourceSha256]].map(([decision,body,isSeed,bodyHash])=>{
      if(!(body===null||typeof body==='string')||typeof isSeed!=='boolean'||sha(JSON.stringify(body))!==bodyHash)fail('BODY_DIGEST_MISMATCH');
      const blockedReasons=[];
      if(!row.authMappingVerified||!row.authorId||!row.authUserId)blockedReasons.push('OWNER_UNVERIFIED');
      if(!['NOVEL','WEBTOON'].includes(row.contentType))blockedReasons.push('TYPE_REVIEW_REQUIRED');
      if(isSeed)blockedReasons.push('DEVELOPMENT_SEED');
      if(row.contentType==='NOVEL'&&(body===null||!body.trim()))blockedReasons.push('EMPTY_NOVEL');
      if(row.contentType==='WEBTOON'&&!row.imageCount)blockedReasons.push('WEBTOON_IMAGES_MISSING');
      return {decision,body,sha256:bodyHash,blockedReasons};
    });
    const title=value=>typeof value==='string'?value.slice(0,500):'';
    return {episodeId:row.episodeId,workId:row.workId,episodeNumber:row.episodeNumber,authorId:row.authorId,
      title:title(episode.title),workTitle:title(work.title),contentType:row.contentType,authMappingVerified:row.authMappingVerified,
      imageCount:row.imageCount,sourceDigest:row.sourceDigest,options};
  });
  const model={format:'webnovels-content-review-view-v1',snapshotSha256:packet.snapshotSha256,
    packetSha256:sha(JSON.stringify(packet)),capturedAt:packet.capturedAt,entries};
  if(Buffer.byteLength(JSON.stringify(model))>32*1024*1024)fail('VIEW_TOO_LARGE');
  return {...model,workbenchSha256:sha(JSON.stringify(model))};
}
export function mergeContentSession(packet,model,input) {
  if(JSON.stringify(model)!==JSON.stringify(projectContentPacket(packet)))fail('STALE_VIEW');
  const session=core.validateSession(model,input),changes=new Map(session.decisions.map(decision=>[decision.episodeId,decision]));
  const decisions=decisionTemplate(packet);
  decisions.decisions=decisions.decisions.map(decision=>changes.get(decision.episodeId)||decision);
  return {decisions,validated:validateContentDecisions(packet,decisions)};
}
export function normalizeWorkbenchScript(shared,ui) {
  const script=(shared+'\n'+ui).replace(/\r\n?/g,'\n');
  if(/<\/script/i.test(script))fail('UNSAFE_TRUSTED_SCRIPT');
  return script;
}
export async function renderContentWorkbench(model) {
  const [shared,ui]=await Promise.all(['scripts/lib/content-review-session.cjs','scripts/ui/content-review-workbench.js'].map(file=>readFile(file,'utf8')));
  const script=normalizeWorkbenchScript(shared,ui);
  const style='body{font:16px/1.6 system-ui,sans-serif;margin:24px;background:#f7f8fb;color:#182238}h1,h2,h3{line-height:1.3}label{display:block;margin:12px 0}input,select,textarea,button{font:inherit;padding:8px;max-width:100%;box-sizing:border-box}textarea{display:block;width:100%;min-height:90px}button{cursor:pointer;margin:4px}button[aria-pressed=true]{outline:3px solid #4462c9}.controls{display:flex;gap:16px;flex-wrap:wrap;align-items:center}.layout{display:grid;grid-template-columns:minmax(230px,1fr) minmax(0,3fr);gap:24px}.queue{max-height:80vh;overflow:auto}.queue button{display:block;width:95%;text-align:left}.sources{display:grid;grid-template-columns:1fr 1fr;gap:16px}.sources section{min-width:0;background:white;padding:12px;border:1px solid #dce1ec}.body{white-space:pre-wrap;overflow-wrap:anywhere;max-height:50vh;overflow:auto;font:16px/1.8 system-ui,sans-serif}.context{font-size:12px;overflow-wrap:anywhere}#review-status{background:#e8edf9;padding:12px}span{display:block;overflow-wrap:anywhere}@media(max-width:850px){body{margin:12px}.layout,.sources{grid-template-columns:1fr}.queue{max-height:28vh}}';
  const b64=bytes=>Buffer.from(sha(bytes),'hex').toString('base64');
  const data=JSON.stringify(model).replaceAll('&','\\u0026').replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
  const policy="default-src 'none'; connect-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; script-src 'sha256-"+b64(script)+"'; style-src 'sha256-"+b64(style)+"'";
  const html='<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+policy+'"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>비공개 원본 검토</title><style>'+style+'</style></head><body><main id="review-root"></main><script type="application/json" id="review-data">'+data+'</script><script>'+script+'</script></body></html>\n';
  if(Buffer.byteLength(html)>MAX_WORKBENCH_BYTES)fail('HTML_TOO_LARGE');
  return html;
}
const flags={productionChanged:false,hostedRestoreAccepted:false,freeCutoverAccepted:false};
export function workbenchSummary(model) {
  return {format:'webnovels-content-workbench-summary-v1',snapshotSha256:model.snapshotSha256,packetSha256:model.packetSha256,
    workbenchSha256:model.workbenchSha256,conflicts:model.entries.length,
    byType:Object.fromEntries(['NOVEL','WEBTOON'].map(type=>[type,model.entries.filter(row=>row.contentType===type).length])),
    sourceRecoveryRequired:model.entries.filter(row=>row.options.every(option=>option.blockedReasons.length)).length,
    evidenceRequired:model.entries.filter(row=>row.options.some(option=>!option.blockedReasons.length)).length,
    initialPending:model.entries.length,...flags};
}
const manifestSchema=z.object({format:z.literal('webnovels-content-workbench-v1'),snapshotSha256:digest,packetSha256:digest,
  workbenchSha256:digest,htmlSha256:digest,modelSha256:digest,templateSha256:digest}).strict();
export async function prepareContentWorkbench(directory,packet,outputName) {
  if(!name.safeParse(outputName).success)fail('INVALID_NAME');
  await privateBackupDirectory(directory);
  const model=projectContentPacket(packet),html=await renderContentWorkbench(model),modelBytes=JSON.stringify(model,null,2)+'\n',
    templateBytes=JSON.stringify(decisionTemplate(packet),null,2)+'\n';
  const target=path.join(directory,outputName);
  await mkdir(target);await privateBackupDirectory(target);await mkdir(path.join(target,'evidence'));
  const manifest={format:'webnovels-content-workbench-v1',snapshotSha256:model.snapshotSha256,packetSha256:model.packetSha256,
    workbenchSha256:model.workbenchSha256,htmlSha256:sha(html),modelSha256:sha(modelBytes),templateSha256:sha(templateBytes)};
  for(const [file,bytes] of [['review.html',html],['model.json',modelBytes],['decisions-template.json',templateBytes],['manifest.json',JSON.stringify(manifest,null,2)+'\n']])
    await writeFile(path.join(target,file),bytes,{flag:'wx',mode:0o600});
  return workbenchSummary(model);
}
export async function verifyContentWorkbench(directory,packet,relative) {
  if(!name.safeParse(relative).success)fail('INVALID_NAME');
  const target=await privateBackupDirectory(path.join(directory,relative));
  const read=async(file,max)=>{const absolute=await safeBundleFile(target,file);if((await lstat(absolute)).size>max)fail('FILE_TOO_LARGE');return readFile(absolute);};
  const manifest=manifestSchema.parse(JSON.parse(await read('manifest.json',16384)));
  const model=projectContentPacket(packet),html=await renderContentWorkbench(model),template=JSON.stringify(decisionTemplate(packet),null,2)+'\n',modelBytes=JSON.stringify(model,null,2)+'\n';
  if(manifest.snapshotSha256!==model.snapshotSha256||manifest.packetSha256!==model.packetSha256||manifest.workbenchSha256!==model.workbenchSha256||
    manifest.htmlSha256!==sha(html)||manifest.modelSha256!==sha(modelBytes)||manifest.templateSha256!==sha(template))fail('STALE_WORKBENCH');
  for(const [file,expected] of [['review.html',html],['model.json',modelBytes],['decisions-template.json',template]])
    if(sha(await read(file,MAX_WORKBENCH_BYTES))!==sha(expected))fail('WORKBENCH_BYTES_MISMATCH');
  return {target,model};
}
export async function stageContentEvidence(directory,workbenchName,sourceName) {
  if(!name.safeParse(workbenchName).success||!/^proofs\/input\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:pdf|png|jpe?g|webp|txt|md|json|docx)$/.test(sourceName))fail('PRIVATE_EVIDENCE_INPUT_REQUIRED');
  const target=await privateBackupDirectory(path.join(directory,workbenchName)),source=await safeBundleFile(directory,sourceName);
  const size=(await lstat(source)).size;if(size<=0||size>16*1024*1024)fail('EVIDENCE_SIZE');
  const bytes=await readFile(source);if(bytes.length!==size)fail('EVIDENCE_SIZE');
  const hash=sha(bytes),file=workbenchName+'/evidence/'+hash+path.extname(sourceName).toLowerCase();
  const descriptor=core.evidence({file,bytes:size,sha256:hash});
  const writeOnce=async(relative,data)=>{
    try{await writeFile(path.join(directory,relative),data,{flag:'wx',mode:0o600});}
    catch(error){if(error.code!=='EEXIST')throw error;const existing=await safeBundleFile(directory,relative);if((await lstat(existing)).size!==Buffer.byteLength(data)||sha(await readFile(existing))!==sha(data))fail('EXISTING_EVIDENCE_MISMATCH');}
  };
  // Validate the existing evidence directory to reject links before opening a new file.
  await privateBackupDirectory(path.join(target,'evidence'));
  await writeOnce(file,bytes);await writeOnce(file+'.descriptor.json',JSON.stringify(descriptor,null,2)+'\n');
  return descriptor;
}
export async function finalizeContentSession(directory,packet,workbenchName,sessionName,resultName) {
  if(!name.safeParse(resultName).success)fail('INVALID_NAME');
  const {target,model}=await verifyContentWorkbench(directory,packet,workbenchName),file=await safeBundleFile(directory,sessionName);
  if((await lstat(file)).size>4*1024*1024)fail('SESSION_TOO_LARGE');
  const sessionBytes=await readFile(file),{decisions,validated}=mergeContentSession(packet,model,JSON.parse(sessionBytes));
  for(const {decision} of validated.selected)for(const descriptor of [decision.rightsEvidence,decision.imageEvidence].filter(Boolean)) {
    if(!new RegExp('^'+workbenchName+'/evidence/'+descriptor.sha256+'\\.(?:pdf|png|jpe?g|webp|txt|md|json|docx)$').test(descriptor.file))fail('STAGED_EVIDENCE_REQUIRED');
    const descriptorFile=await safeBundleFile(directory,descriptor.file+'.descriptor.json');
    if((await lstat(descriptorFile)).size>16384)fail('DESCRIPTOR_TOO_LARGE');
    if(JSON.stringify(core.evidence(JSON.parse(await readFile(descriptorFile))))!==JSON.stringify(descriptor))fail('STAGED_DESCRIPTOR_MISMATCH');
  }
  await verifyReviewEvidence(directory,validated);
  const bytes=JSON.stringify(decisions,null,2)+'\n',summary={...reviewSummary(packet,validated),
    format:'webnovels-content-workbench-finalization-v1',status:validated.unresolved?'FILE_VALIDATED_UNRESOLVED':'FILE_VALIDATED',
    sessionSha256:sha(sessionBytes),decisionsSha256:sha(bytes),evidenceBytesVerified:true,rightsAuthenticityConfirmed:false};
  const destination=path.join(target,resultName);await mkdir(destination);await privateBackupDirectory(destination);
  await writeFile(path.join(destination,'decisions-reviewed.json'),bytes,{flag:'wx',mode:0o600});
  await writeFile(path.join(destination,'verification.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});
  return summary;
}
