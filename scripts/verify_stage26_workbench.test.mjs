import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,symlink} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import core from './lib/content-review-session.cjs';
import {sha,validateContentDecisions} from './lib/launch-content-review.mjs';
import {projectContentPacket,mergeContentSession,renderContentWorkbench,workbenchSummary,prepareContentWorkbench,
  verifyContentWorkbench,stageContentEvidence,finalizeContentSession,normalizeWorkbenchScript} from './lib/content-review-workbench.mjs';
import {runWorkbench} from './content_review_workbench.mjs';
const sentinel='PRIVATE_AUTH_PASSWORD_AND_EMAIL_NEVER_PROJECT';
const body='원고 <img src="https://example.invalid/secret" onerror="evil()">\r\n</script><script>evil()</script>&\u2028\u2029';
function packet() {
  const entries=[['9007199254740993','NOVEL',body,'다른 원고',false,false,0],['2','NOVEL',null,'seed',false,true,0],
    ['3','WEBTOON','', 'seed',false,true,12],['4','WEBTOON','',null,false,false,0],['5','OTHER','원본','대체',false,false,0],
    ['6','NOVEL','원본','대체',false,false,0],['7','NOVEL','seed','대체',true,false,0]].map(([episodeId,contentType,current,alternate,currentIsSeed,alternateIsSeed,imageCount])=>{
      const source={episode:JSON.stringify({content:current,title:'회차 '+episodeId,image_urls:['https://example.invalid/token?secret=never']}),
        content:JSON.stringify({text_content:alternate}),work:JSON.stringify({title:'작품',private_metadata:sentinel}),
        author:JSON.stringify({email:sentinel}),auth:JSON.stringify({encrypted_password:sentinel,email:sentinel}),identity:JSON.stringify({account:sentinel})};
      return {episodeId,workId:'9223372036854775807',episodeNumber:episodeId,authorId:episodeId==='6'?null:'9007199254740995',
        authUserId:episodeId==='6'?null:'12345678-1234-4234-8234-123456789abc',contentType,authMappingVerified:episodeId!=='6',
        source,sourceDigest:sha(JSON.stringify(source)),episodesSourceSha256:sha(JSON.stringify(current)),episodeContentsSourceSha256:sha(JSON.stringify(alternate)),
        episodesEmpty:!current,alternateIsSeed,currentIsSeed,imageCount};
    });
  return {format:'webnovels-content-packet-v1',projectRef:'abcdefghijklmnopqrst',snapshotSha256:'a'.repeat(64),capturedAt:'2026-10-09T07:17:50.651Z',seedSha256:'b'.repeat(64),entries};
}
const descriptor={file:'proofs/input/rights.txt',bytes:6,sha256:sha('권리')};
function selection(model,index=0,choice='USE_EPISODES') {
  const row=model.entries[index],selected=row.options.find(option=>option.decision===choice);
  return {...core.pending(row),decision:choice,reviewerRef:'reviewer-26',evidenceRef:'실제 원본과 권리 자료 검토 기록',rightsEvidence:descriptor,
    imageEvidence:row.contentType==='WEBTOON'?descriptor:null,selectedSourceSha256:selected.sha256};
}
async function directory() {
  await mkdir('scratch/launch/backups',{recursive:true});
  return mkdtemp(path.resolve('scratch/launch/backups/stage26-test-'));
}
test('projection excludes complete account/private metadata and URL references; bigint and exact body survive',()=>{
  const original=packet(),model=projectContentPacket(original),bytes=JSON.stringify(model);
  assert(!bytes.includes(sentinel));assert(!bytes.includes('authUserId'));assert(!bytes.includes('private_metadata'));assert(!bytes.includes('token?secret'));
  assert.equal(model.entries[0].episodeId,'9007199254740993');assert.equal(model.entries[0].workId,'9223372036854775807');
  assert.equal(model.entries[0].options[0].body,body);assert.equal(model.entries[1].options[0].body,null);
  assert.equal(model.entries[2].options[0].body,'');assert.equal(JSON.stringify(original),JSON.stringify(packet()));
});
test('source and body digest tampering, malformed/duplicate domain IDs and unsafe packet shapes fail',()=>{
  for(const mutate of [p=>p.entries[0].sourceDigest='c'.repeat(64),p=>p.entries[0].episodesSourceSha256='c'.repeat(64),
    p=>p.entries[0].episodeId=9007199254740993,p=>p.entries[0].authorId='9223372036854775808',p=>p.entries.push(p.entries[0]),
    p=>p.entries[0].authMappingVerified='true',p=>p.entries[0].imageCount=-1,p=>p.format='OTHER',p=>p.capturedAt='today']) {
    const source=packet();mutate(source);assert.throws(()=>projectContentPacket(source));
  }
  const source=packet();source.entries[0].source.episode=JSON.stringify({content:123});source.entries[0].sourceDigest=sha(JSON.stringify(source.entries[0].source));
  assert.throws(()=>projectContentPacket(source),/BODY_DIGEST/);
});
test('both sources have explicit seed/empty/type/owner/image blocks; recovery and evidence counts are separate',()=>{
  const model=projectContentPacket(packet()),summary=workbenchSummary(model);
  assert.deepEqual(model.entries[1].options.map(option=>option.blockedReasons),[['EMPTY_NOVEL'],['DEVELOPMENT_SEED']]);
  assert.deepEqual(model.entries[3].options[0].blockedReasons,['WEBTOON_IMAGES_MISSING']);
  assert.deepEqual(model.entries[4].options[0].blockedReasons,['TYPE_REVIEW_REQUIRED']);
  assert.deepEqual(model.entries[5].options[0].blockedReasons,['OWNER_UNVERIFIED']);
  assert.equal(summary.sourceRecoveryRequired,4);assert.equal(summary.evidenceRequired,3);assert.equal(summary.initialPending,7);
  assert.equal(summary.productionChanged,false);assert.equal(summary.freeCutoverAccepted,false);
});
test('partial sessions merge to existing complete decision contract without altering source or guessing approvals',()=>{
  const original=packet(),before=JSON.stringify(original),model=projectContentPacket(original),chosen=selection(model);
  const result=mergeContentSession(original,model,core.session(model,[chosen]));
  assert.equal(result.decisions.decisions.length,7);assert.equal(result.validated.selected.length,1);assert.equal(result.validated.pending.length,6);
  assert.equal(validateContentDecisions(original,result.decisions).unresolved,6);assert.equal(JSON.stringify(original),before);
  assert.equal(mergeContentSession(original,model,core.session(model,[])).validated.selected.length,0);
});
test('HOLD remains unresolved and cannot carry a source or rights selection',()=>{
  const original=packet(),model=projectContentPacket(original),held={...core.pending(model.entries[1]),decision:'HOLD',reviewerRef:'owner-review',evidenceRef:'작가에게 원본 복구를 요청해야 합니다'};
  const result=mergeContentSession(original,model,core.session(model,[held]));assert.equal(result.validated.held.length,1);assert.equal(result.validated.unresolved,7);
  assert.throws(()=>core.validateDecision(model.entries[1],{...held,rightsEvidence:descriptor}),/HOLD_MUST/);
});
test('missing rights/image evidence, seed/empty choices and incorrect selected source digest fail',()=>{
  const model=projectContentPacket(packet());
  for(const index of [1,3,4,5,6])assert.throws(()=>core.validateDecision(model.entries[index],selection(model,index)),/SOURCE_BLOCKED/);
  assert.throws(()=>core.validateDecision(model.entries[0],{...selection(model),rightsEvidence:null}),/RIGHTS_IMAGE/);
  assert.throws(()=>core.validateDecision(model.entries[2],{...selection(model,2),imageEvidence:null}),/RIGHTS_IMAGE/);
  assert.throws(()=>core.validateDecision(model.entries[0],{...selection(model),selectedSourceSha256:'d'.repeat(64)}),/SELECTED_SOURCE/);
  assert.equal(core.validateDecision(model.entries[6],selection(model,6,'USE_EPISODE_CONTENTS')).decision,'USE_EPISODE_CONTENTS');
});
test('sessions reject stale contexts, unknown/duplicate IDs, extra fields, reviewer limits and pending residue',()=>{
  const original=packet(),model=projectContentPacket(original),chosen=selection(model),fresh=()=>core.session(model,[chosen]);
  for(const mutate of [s=>s.snapshotSha256='c'.repeat(64),s=>s.packetSha256='c'.repeat(64),s=>s.workbenchSha256='c'.repeat(64),
    s=>s.decisions.push(chosen),s=>s.decisions[0]={...chosen,episodeId:'1'},s=>s.unknown=true,
    s=>s.decisions[0]={...chosen,sourceDigest:'c'.repeat(64)},s=>s.decisions[0]={...chosen,reviewerRef:'aa'},
    s=>s.decisions[0]={...chosen,evidenceRef:'short'},s=>s.decisions[0]={...chosen,extra:1},
    s=>s.decisions[0]={...chosen,reviewerRef:'a'.repeat(201)},s=>s.decisions[0]={...chosen,evidenceRef:'a'.repeat(501)},
    s=>s.decisions[0]={...chosen,decision:'PENDING'}]) {const input=fresh();mutate(input);assert.throws(()=>core.validateSession(model,input));}
  assert.throws(()=>mergeContentSession(original,{...model,capturedAt:'2026-10-10T00:00:00Z'},fresh()),/STALE_VIEW/);
});
test('evidence descriptors reject traversal, URLs, ADS, Windows aliases, extra fields, invalid hashes and size',()=>{
  for(const file of ['../rights.txt','/rights.txt','C:/rights.txt','proofs\\rights.txt','proofs//rights.txt','proofs/./rights.txt','proofs/rights.txt.','proofs/a /rights.txt','https://example.invalid/a','proofs/a\u0000'])
    assert.throws(()=>core.evidence({...descriptor,file}));
  for(const patch of [{bytes:0},{bytes:16*1024*1024+1},{bytes:1.5},{sha256:'bad'},{extra:true}])assert.throws(()=>core.evidence({...descriptor,...patch}));
  assert.deepEqual(core.evidence(descriptor),descriptor);
});
test('HTML escapes script terminators and uses exact CSP script/style hashes without network/storage APIs',async()=>{
  const html=await renderContentWorkbench(projectContentPacket(packet()));assert(!html.includes(sentinel));assert(!html.includes(body));
  assert(html.includes('\\u003c/script\\u003e'));assert.equal([...html.matchAll(/<script/g)].length,2);
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1],style=html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert(!script.includes('\r'),'HTML parser and CSP must hash the same LF-normalized trusted code');
  for(const bytes of [script,style])assert(html.includes('sha256-'+Buffer.from(sha(bytes),'hex').toString('base64')));
  for(const token of ['innerHTML','fetch(','XMLHttpRequest','localStorage','sessionStorage','sendBeacon','src="http'])assert(!html.includes(token));
  for(const directive of ["default-src 'none'","connect-src 'none'","img-src 'none'","form-action 'none'"])assert(html.includes(directive));
});
test('Windows CRLF/CR trusted code uses HTML-parser LF for CSP; closing script source is forbidden',()=>{
  assert.equal(normalizeWorkbenchScript('first\r\nsecond\rthird','last\r\n'),'first\nsecond\nthird\nlast\n');
  assert.throws(()=>normalizeWorkbenchScript('trusted','</SCRIPT>'),/UNSAFE_TRUSTED_SCRIPT/);
});
test('private workbench files are immutable, context reverified and tampered bytes rejected',async()=>{
  const dir=await directory(),source=packet();await prepareContentWorkbench(dir,source,'review-test');
  assert.equal((await verifyContentWorkbench(dir,source,'review-test')).model.entries.length,7);
  await assert.rejects(prepareContentWorkbench(dir,source,'review-test'),/EEXIST/);
  await assert.rejects(prepareContentWorkbench(dir,source,'../escape'),/INVALID_NAME/);
  await assert.rejects(verifyContentWorkbench(dir,source,'../escape'),/INVALID_NAME/);
  const changed=packet();changed.snapshotSha256='c'.repeat(64);await assert.rejects(verifyContentWorkbench(dir,changed,'review-test'),/STALE_WORKBENCH/);
  await writeFile(path.join(dir,'review-test/review.html'),'tampered');await assert.rejects(verifyContentWorkbench(dir,source,'review-test'),/BYTES_MISMATCH/);
});
test('staged evidence checks private source paths, size and byte identity; duplicate calls never overwrite',async()=>{
  const dir=await directory();await prepareContentWorkbench(dir,packet(),'review-test');await mkdir(path.join(dir,'proofs/input'),{recursive:true});
  await writeFile(path.join(dir,'proofs/input/rights.txt'),'권리');const staged=await stageContentEvidence(dir,'review-test','proofs/input/rights.txt');
  assert.equal(staged.bytes,6);assert.equal(staged.sha256,descriptor.sha256);assert.deepEqual(await stageContentEvidence(dir,'review-test','proofs/input/rights.txt'),staged);
  for(const source of ['snapshot.json','proofs/input/.env.local','proofs/input/private.pem','proofs/input/../rights.txt'])await assert.rejects(stageContentEvidence(dir,'review-test',source),/PRIVATE_EVIDENCE/);
  await writeFile(path.join(dir,'proofs/input/empty.txt'),'');await assert.rejects(stageContentEvidence(dir,'review-test','proofs/input/empty.txt'),/EVIDENCE_SIZE/);
  await writeFile(path.join(dir,staged.file),'xxxxxx');await assert.rejects(stageContentEvidence(dir,'review-test','proofs/input/rights.txt'),/EXISTING_EVIDENCE_MISMATCH/);
});
test('finalizer verifies actual evidence bytes and emits existing decisions with pending count and no GO',async()=>{
  const dir=await directory(),source=packet(),model=projectContentPacket(source);await prepareContentWorkbench(dir,source,'review-test');
  await mkdir(path.join(dir,'proofs/input'),{recursive:true});await writeFile(path.join(dir,'proofs/input/rights.txt'),'권리');
  const staged=await stageContentEvidence(dir,'review-test','proofs/input/rights.txt'),chosen={...selection(model),rightsEvidence:staged};
  await writeFile(path.join(dir,'session.json'),JSON.stringify(core.session(model,[chosen])));
  const result=await finalizeContentSession(dir,source,'review-test','session.json','final-test');assert.equal(result.approved,1);assert.equal(result.pending,6);
  assert.equal(result.status,'FILE_VALIDATED_UNRESOLVED');assert.equal(result.rightsAuthenticityConfirmed,false);assert.equal(result.productionChanged,false);
  const output=JSON.parse(await readFile(path.join(dir,'review-test/final-test/decisions-reviewed.json'),'utf8'));
  assert.equal(validateContentDecisions(source,output).selected.length,1);
  await writeFile(path.join(dir,'unstaged.json'),JSON.stringify(core.session(model,[selection(model)])));
  await assert.rejects(finalizeContentSession(dir,source,'review-test','unstaged.json','final-unstaged'),/STAGED_EVIDENCE_REQUIRED/);
  await assert.rejects(finalizeContentSession(dir,source,'review-test','session.json','final-test'),/EEXIST/);
  await writeFile(path.join(dir,staged.file+'.descriptor.json'),JSON.stringify({...staged,bytes:5}));
  await assert.rejects(finalizeContentSession(dir,source,'review-test','session.json','final-descriptor'),/STAGED_DESCRIPTOR_MISMATCH/);
  await writeFile(path.join(dir,staged.file+'.descriptor.json'),JSON.stringify(staged));
  await writeFile(path.join(dir,staged.file),'변조');await assert.rejects(finalizeContentSession(dir,source,'review-test','session.json','final-tamper'),/EVIDENCE_HASH_MISMATCH/);
});
test('all pending finalization is valid only as unresolved preparation; unsafe source/result paths fail',async()=>{
  const dir=await directory(),source=packet(),model=projectContentPacket(source);await prepareContentWorkbench(dir,source,'review-test');
  await writeFile(path.join(dir,'session.json'),JSON.stringify(core.session(model,[])));
  const result=await finalizeContentSession(dir,source,'review-test','session.json','final-pending');assert.equal(result.approved,0);assert.equal(result.unresolved,7);
  await assert.rejects(finalizeContentSession(dir,source,'review-test','../session.json','final-invalid'));
  await assert.rejects(finalizeContentSession(dir,source,'review-test','session.json','../escape'),/INVALID_NAME/);
  for(const args of [[],['apply','x','y'],['prepare','x','y','extra'],['finalize','x','y','missing']])await assert.rejects(runWorkbench(args),/ARGUMENTS/);
});
test('symlink evidence is rejected before copying (junction supported on Windows)',async()=>{
  const dir=await directory(),external=await directory();await prepareContentWorkbench(dir,packet(),'review-test');await mkdir(path.join(dir,'proofs/input'),{recursive:true});
  await writeFile(path.join(external,'rights.txt'),'권리');await symlink(external,path.join(dir,'proofs/input/link'),'junction');
  await assert.rejects(stageContentEvidence(dir,'review-test','proofs/input/link/rights.txt'),/LINK_FORBIDDEN/);
});
class Element {
  constructor(tag,document){this.tagName=tag;this.document=document;this.children=[];this.events={};this.value='';this.files=[];this.attributes={};this._text='';}
  set id(value){this._id=value;this.document.nodes.set(value,this);}get id(){return this._id;}
  set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
  appendChild(child){child.parent=this;this.children.push(child);return child;}replaceChildren(){this.children=[];}
  setAttribute(key,value){this.attributes[key]=value;}addEventListener(type,fn){this.events[type]=fn;}
  async fire(type){return this.events[type]?.();}click(){this.clicked=true;}remove(){this.parent.children=this.parent.children.filter(child=>child!==this);}
}
async function page(source=packet()) {
  const model=projectContentPacket(source),document={nodes:new Map(),createElement(tag){return new Element(tag,this);},getElementById(id){return this.nodes.get(id);}};
  const root=document.createElement('main');root.id='review-root';const data=document.createElement('script');data.id='review-data';data.textContent=JSON.stringify(model);
  let download=null,revoked=false;
  const context=vm.createContext({document,Blob,URL:{createObjectURL(blob){download=blob;return 'blob:private';},revokeObjectURL(){revoked=true;}},setTimeout(fn){fn();}});
  vm.runInContext(await readFile('scripts/lib/content-review-session.cjs','utf8'),context,{filename:path.resolve('scripts/lib/content-review-session.cjs')});
  vm.runInContext(await readFile('scripts/ui/content-review-workbench.js','utf8'),context,{filename:path.resolve('scripts/ui/content-review-workbench.js')});
  return {model,document,get:id=>document.getElementById(id),download:async()=>download?JSON.parse(await download.text()):null,revoked:()=>revoked};
}
test('offline UI safely renders source text, blocks invalid choices, exports explicit HOLD and restores session',async()=>{
  const ui=await page();assert.equal(ui.get('review-list').children.length,7);await ui.get('review-list').children[0].fire('click');
  assert(ui.get('review-detail').textContent.includes(body));assert.equal(ui.get('review-choice').children.length,4);
  await ui.get('review-export').fire('click');assert.equal((await ui.download()).decisions.length,0);assert(ui.revoked());
  ui.get('review-choice').value='HOLD';ui.get('review-reviewer').value='검토자';ui.get('review-reason').value='작가 원본 복구가 완료될 때까지 보류';
  await ui.get('review-save').fire('click');await ui.get('review-export').fire('click');const saved=await ui.download();assert.equal(saved.decisions[0].decision,'HOLD');
  ui.get('review-import').files=[{size:1000,text:async()=>JSON.stringify(saved)}];await ui.get('review-import').fire('change');assert.equal(ui.get('review-status').textContent,'WORKBENCH_CLEAR_BEFORE_IMPORT');
  await ui.get('review-clear').fire('click');await ui.get('review-import').fire('change');assert(ui.get('review-summary').textContent.includes('보류 1'));
  const button=ui.get('review-list').children[1];await button.fire('click');assert(ui.get('review-choice').children[2].disabled);assert(ui.get('review-choice').children[3].disabled);
  ui.get('review-choice').value='USE_EPISODES';ui.get('review-reviewer').value='검토자';ui.get('review-reason').value='원본 선택을 강제로 지정하더라도 검증';await ui.get('review-export').fire('click');
  assert.equal(ui.get('review-status').textContent,'WORKBENCH_SOURCE_BLOCKED');
});
test('offline UI stages descriptor references for a webtoon and catches malformed/stale files',async()=>{
  const ui=await page();await ui.get('review-list').children[2].fire('click');
  ui.get('review-choice').value='USE_EPISODES';ui.get('review-reviewer').value='검토자';ui.get('review-reason').value='웹툰 이미지와 권리 인수 근거 검토';
  await ui.get('review-save').fire('click');assert.equal(ui.get('review-status').textContent,'WORKBENCH_RIGHTS_IMAGE_EVIDENCE_REQUIRED');
  for(const kind of ['rights','image']){const input=ui.get('review-'+kind);input.files=[{size:200,text:async()=>JSON.stringify(descriptor)}];await input.fire('change');}
  await ui.get('review-export').fire('click');const output=await ui.download();assert.equal(output.decisions[0].imageEvidence.sha256,descriptor.sha256);
  ui.get('review-image').files=[{size:20000,text:async()=>''}];await ui.get('review-image').fire('change');assert.equal(ui.get('review-status').textContent,'WORKBENCH_DESCRIPTOR_SIZE');
  ui.get('review-image').files=[{size:10,text:async()=>'{broken'}];await ui.get('review-image').fire('change');assert.equal(ui.get('review-status').textContent,'WORKBENCH_INPUT_REJECTED');
  await ui.get('review-clear').fire('click');ui.get('review-import').files=[{size:10,text:async()=>JSON.stringify({...output,packetSha256:'c'.repeat(64)})}];await ui.get('review-import').fire('change');
  assert.equal(ui.get('review-status').textContent,'WORKBENCH_STALE_SESSION');
});
test('offline UI filters/searches queues and preserves unsaved invalid input when switching',async()=>{
  const ui=await page();ui.get('review-filter').value='RECOVERY';await ui.get('review-filter').fire('input');assert.equal(ui.get('review-list').children.length,4);
  ui.get('review-filter').value='EVIDENCE';await ui.get('review-filter').fire('input');assert.equal(ui.get('review-list').children.length,3);
  ui.get('review-search').value='9007199254740993';await ui.get('review-search').fire('input');assert.equal(ui.get('review-list').children.length,1);
  ui.get('review-search').value='unmatched';await ui.get('review-search').fire('input');assert.equal(ui.get('review-list').children[0].tagName,'p');
  ui.get('review-search').value='';ui.get('review-filter').value='ALL';await ui.get('review-search').fire('input');await ui.get('review-list').children[0].fire('click');
  ui.get('review-choice').value='HOLD';await ui.get('review-list').children[1].fire('click');assert.equal(ui.get('review-status').textContent,'WORKBENCH_REVIEWER_EVIDENCE_REQUIRED');
  assert(ui.get('review-detail').textContent.includes(body));
});
