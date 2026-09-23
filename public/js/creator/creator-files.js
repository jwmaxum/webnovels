(function(){
 'use strict';
 const $=id=>document.getElementById(id),actor=()=>window.WebNovelsAuth?.getActor();
 let epoch=0,coverSelection=0,work=null,jobs=[],cover=null,editorContext=null;
 const errors={DOCX_CHECKSUM_INVALID:'DOCX 파일의 체크섬이 일치하지 않습니다. 원본에서 다시 저장해주세요.',DOCX_ARCHIVE_INVALID:'DOCX 압축 구조가 손상되었거나 지원하지 않는 압축 형식입니다.',DOCX_SIGNATURE_INVALID:'DOCX 확장자와 실제 파일 형식이 일치하지 않습니다.',DOCX_PACKAGE_INVALID:'Word 본문 또는 문서 형식 정보가 없습니다.',DOCX_XML_INVALID:'DOCX 내부 문서가 손상되었습니다.',DOCX_BODY_MISSING:'지원하는 Word 문서 본문을 찾지 못했습니다.',IMAGE_INVALID:'유효한 PNG 또는 JPEG 이미지가 아닙니다.',IMAGE_PIXEL_LIMIT:'이미지는 1,200만 픽셀, 가로·세로 각 8,192픽셀까지 지원합니다.',STORAGE_UPLOAD_FAILED:'파일 업로드에 실패했습니다. 원본과 기존 표지는 유지됩니다. 같은 항목에서 재시도해주세요.',EXPORT_TOO_LARGE:'묶음 내보내기는 총 본문 500만 자·2,000개까지 지원합니다. 원고를 개별 내보내기 해주세요.',IMPORT_CANCELLED:'취소된 가져오기 요청입니다. 다시 가져오려면 파일을 새로 선택해주세요.',ALREADY_COMMITTED:'이미 저장된 파일입니다. 원고 목록에서 결과를 확인해주세요.',SESSION_CHANGED:'계정이 변경되어 작업을 중단했습니다.',FILE_TOO_LARGE:'파일 용량이 제한을 초과했습니다.',TEXT_TOO_LONG:'원고는 200,000자까지 가져올 수 있습니다.',TEXT_ENCODING_INVALID:'문자 인코딩을 확인해주세요.',TEXT_BINARY_OR_INVALID:'텍스트로 읽을 수 없는 문자가 있습니다.',DOCX_EXPANSION_LIMIT:'DOCX 압축 해제 한도를 초과했습니다.',DOCX_ACTIVE_CONTENT:'매크로·실행 요소가 있는 문서는 지원하지 않습니다.',FILE_TYPE_UNSUPPORTED:'TXT와 DOCX만 지원합니다. HWP/HWPX와 자동 회차 분리는 지원하지 않습니다.',WORK_CONFLICT:'작품이 변경되었습니다. 최신 설정을 확인해주세요. 기존 표지는 유지됩니다.',AUTHOR_FILES_NOT_ACTIVATED:'파일 저장 기능이 아직 활성화되지 않았습니다.',IMAGE_PROCESSOR_NOT_CONFIGURED:'표지 처리 서비스가 아직 연결되지 않았습니다.',EDIT_CHANGED_DURING_IMPORT:'미리보기 이후 원고가 변경되었습니다. 원고를 다시 확인해주세요.'};
 const warnings={UNSUPPORTED_BLOCK_IGNORED:'지원하지 않는 문서 블록 제외',ENCODING_CONFIRM_REQUIRED:'UTF-8로 읽히지 않아 EUC-KR 후보를 표시합니다. 인코딩을 확인해주세요.',TABLE_IGNORED:'표 내용 제외',IMAGE_IGNORED:'이미지 제외',FOOTNOTE_IGNORED:'각주/미주 제외',COMMENT_IGNORED:'주석 제외',EXTERNAL_REFERENCES_IGNORED:'외부 링크/리소스 연결 제외',HEADER_FOOTER_IGNORED:'머리글/바닥글 제외',EMBEDDED_CONTENT_IGNORED:'삽입 문서 제외',DELETED_TEXT_IGNORED:'삭제된 변경 추적 내용 제외',FIELD_CODE_IGNORED:'필드 코드 제외'};
 function message(e){$('creatorFilesMessage').textContent=errors[e.code||e.message]||('처리 실패: '+(e.code||e.message||'다시 시도해주세요.'));}
 const safe=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(message);
 async function api(action,args={}){return window.WebNovelsAuth.api('/api/v2/creator/files'+(action?'/'+action:'')+(args.id?'/'+args.id:'')+'?workId='+args.workId,
  ['import','cover','cancel'].includes(action)?{method:'POST',headers:args.key?{'Idempotency-Key':args.key}:{},body:JSON.stringify(args.body||{})}:{});}
 const queue=new CreatorFileQueue({store:DraftStore,api,actor,onChange:()=>{if(work&&actor()?.userId===work.userId)render();}});
 function assertOpen(turn,user){if(turn!==epoch||actor()?.userId!==user)throw Error('SESSION_CHANGED');}
 function button(label,fn){const b=document.createElement('button');b.type='button';b.textContent=label;b.className='btn btn-outline btn-sm';b.onclick=safe(fn);return b;}
 async function open(workId){
  reset();const turn=epoch,user=actor()?.userId;if(!user)throw Error('AUTHOR_REQUIRED');
  const data=await window.WebNovelsAuth.api('/api/v2/creator/works/'+workId);assertOpen(turn,user);work={...data.work,userId:user};
  editorContext=window.CreatorDraftEditor.getFileContext();jobs=await DraftStore.fileJobs(user,String(workId));assertOpen(turn,user);
  $('creatorFilesWorkTitle').textContent=work.title;$('creatorFilesMessage').textContent='';cover=null;$('creatorCoverCanvas').getContext('2d').clearRect(0,0,600,900);
  render();window.openModal('modalCreatorFiles');await listOriginals();
 }
 async function convert(job,encoding='auto'){
  if(job.locked)throw Error('IMPORT_ALREADY_SENT');const bytes=job.bytes;
  try{const result=/\.txt$/i.test(job.filename)?CreatorFileCodec.txt(bytes,encoding):/\.docx$/i.test(job.filename)?CreatorFileCodec.docx(bytes):(()=>{throw Error('FILE_TYPE_UNSUPPORTED');})();
   job.preview=result.content;job.encoding=result.encoding;job.warnings=result.warnings;job.confirmed=false;job.state='READY';job.error=null;
   job.payload={filename:job.filename,bytes:creatorFileBase64(bytes),draftId:job.draftId,title:job.title,content:result.content,order:job.order,batchId:job.batchId};
  }catch(e){job.state='ERROR';job.error=e.message;job.payload=null;}
  await queue.persist(job);
 }
 async function addFiles(files){
  if(!work||queue.running)throw Error('IMPORT_IN_PROGRESS');if(files.length>20)throw Error('한 번에 20개까지 선택해주세요.');
  const turn=epoch,user=work.userId,workId=work.id,batchId=crypto.randomUUID();
  for(const file of [...files].sort((a,b)=>a.name.localeCompare(b.name,'ko',{numeric:true}))){
   assertOpen(turn,user);if(file.size>CreatorFileCodec.MAX_FILE){message(Error('FILE_TOO_LARGE'));continue;}
   const requestId=crypto.randomUUID(),job={key:user+':'+requestId,userId:user,workId,requestId,batchId,draftId:crypto.randomUUID(),kind:'import',filename:file.name,title:file.name.replace(/\.[^.]+$/,'').slice(0,200),order:jobs.filter(j=>j.batchId===batchId).length,state:'READY',locked:false,confirmed:false,bytes:new Uint8Array(await file.arrayBuffer())};
   assertOpen(turn,user);jobs.push(job);await convert(job);
  }render();
 }
 function render(){
  const list=$('creatorImportList');if(!list)return;list.replaceChildren();
  for(const job of jobs){
   const row=document.createElement('section');row.className='creator-file-row';const label=document.createElement('p');label.textContent=job.filename+' · '+job.state+(job.error?' · '+(errors[job.error]||job.error):'');row.append(label);
   if(job.kind==='import'){
    const title=document.createElement('input');title.value=job.title;title.maxLength=200;title.disabled=job.locked;title.setAttribute('aria-label','가져올 원고 제목');title.onchange=safe(async()=>{if(job.locked)return;job.title=title.value;if(job.payload)job.payload.title=title.value;await queue.persist(job);});row.append(title);
    if(/\.txt$/i.test(job.filename)){const enc=document.createElement('select');for(const [v,t]of [['auto','자동 감지'],['utf-8','UTF-8'],['euc-kr','EUC-KR/CP949'],['utf-16le','UTF-16 LE'],['utf-16be','UTF-16 BE']]){const o=document.createElement('option');o.value=v;o.textContent=t;enc.append(o);}enc.value=job.encoding==='DOCX'?'auto':job.encoding||'auto';enc.disabled=job.locked;enc.onchange=safe(()=>convert(job,enc.value));row.append(enc);}
    const preview=document.createElement('textarea');preview.value=job.preview||'';preview.readOnly=true;preview.rows=5;preview.setAttribute('aria-label','변환 원고 미리보기');row.append(preview);
    const notice=document.createElement('p');notice.textContent=(job.warnings||[]).map(w=>warnings[w]||w).join(' / ');row.append(notice);
    const confirm=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=job.confirmed;check.disabled=job.locked;check.onchange=safe(async()=>{if(job.locked)return;job.confirmed=check.checked;await DraftStore.saveFileJob(job);});confirm.append(check,document.createTextNode('인코딩·누락 경고·본문을 확인했습니다'));row.append(confirm);
    for(const [label,delta]of [['위로',-1],['아래로',1]]){const b=button(label,async()=>{const peers=jobs.filter(j=>j.batchId===job.batchId);if(peers.some(j=>j.locked))throw Error('IMPORT_ALREADY_SENT');const at=jobs.indexOf(job),other=jobs[at+delta];if(!other||other.batchId!==job.batchId)return;[jobs[at],jobs[at+delta]]=[other,job];for(const [i,j]of jobs.filter(j=>j.batchId===job.batchId).entries()){j.order=i;if(j.payload)j.payload.order=i;await DraftStore.saveFileJob(j);}render();});b.disabled=job.locked;row.append(b);}
    if(job.state==='READY'&&job.payload&&editorContext?.workId===job.workId)row.append(button('현재 원고 대체 (먼저 백업)',async()=>{
      if(!job.confirmed||!window.confirm('작성 중 원고를 백업한 뒤 이 본문으로 바꿀까요? 새 초안 생성이 기본 선택입니다.'))return;
      await window.CreatorDraftEditor.replaceFromFile({title:job.title,content:job.preview,authorComment:''},editorContext);
      editorContext=window.CreatorDraftEditor.getFileContext();$('creatorFilesMessage').textContent='현재 원고를 백업하고 변경했습니다. 원본 파일은 가져오기 목록에 보존됩니다.';
    }));
   }
   if(job.state!=='COMMITTED'&&job.state!=='CANCELLED'){
    row.append(button('이 파일 저장·재시도',()=>queue.run([job])));row.append(button('취소',()=>queue.cancel(job)));
   }
   if(job.result?.draft)row.append(button('저장된 원고 열기',async()=>{window.closeModal('modalCreatorFiles');await window.CreatorDraftEditor.openWork(job.workId,job.result.draft.id);}));
   if(job.state==='COMMITTED'&&job.kind==='cover')row.append(button('새 표지 확인',listOriginals));list.append(row);
  }
 }
 async function listOriginals(){
  const turn=epoch,user=work.userId,result=await api('',{workId:work.id});assertOpen(turn,user);const list=$('creatorOriginalFiles');list.replaceChildren();
  for(const file of result.files.filter(f=>f.state==='COMMITTED'))for(const id of [file.fileId,file.derivativeId].filter(Boolean))list.append(button((id===file.fileId?'원본 다운로드: ':'표지 미리보기: ')+(file.filename||'파일'),async()=>{
    const signed=await api('read',{workId:work.id,id});assertOpen(turn,user);const a=document.createElement('a');a.href=signed.url;a.target='_blank';a.rel='noopener';a.textContent='60초 동안 유효한 파일 링크 열기';list.append(a);
  }));
 }
 async function selectCover(file){
  if(!file)return;const selection=++coverSelection;if(file.size>4194304)throw Error('FILE_TOO_LARGE');const turn=epoch,user=work.userId,bytes=new Uint8Array(await file.arrayBuffer());CreatorFileImage.dimensions(bytes);
  const bitmap=await createImageBitmap(file);if(selection!==coverSelection||turn!==epoch||actor()?.userId!==user){bitmap.close();return;}if(bitmap.width*bitmap.height>12000000){bitmap.close();throw Error('IMAGE_PIXEL_LIMIT');}
  cover?.bitmap?.close();cover={file,bytes,bitmap};$('creatorCoverZoom').value='1';$('creatorCoverX').value='50';$('creatorCoverY').value='50';drawCover();
 }
 function drawCover(){if(!cover)return;const {bitmap}=cover,zoom=Number($('creatorCoverZoom').value),ratio=2/3;
  const h=Math.min(bitmap.height,bitmap.width/ratio)/zoom,w=h*ratio,x=(bitmap.width-w)*Number($('creatorCoverX').value)/100,y=(bitmap.height-h)*Number($('creatorCoverY').value)/100;
  const canvas=$('creatorCoverCanvas'),ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,600,900);ctx.drawImage(bitmap,x,y,w,h,0,0,600,900);
 }
 async function saveCover(){
  if(!cover||!work)throw Error('표지를 선택해주세요.');const turn=epoch,user=work.userId,selected=cover,workId=work.id;
  const blob=await new Promise((resolve,reject)=>$('creatorCoverCanvas').toBlob(b=>b?resolve(b):reject(Error('IMAGE_INVALID')),'image/png'));
  const cropped=new Uint8Array(await blob.arrayBuffer());assertOpen(turn,user);if(selected!==cover)throw Error('IMAGE_CHANGED');
  const key=crypto.randomUUID(),job={key:user+':'+key,requestId:key,userId:user,workId,kind:'cover',filename:selected.file.name,confirmed:true,state:'READY',payload:{filename:selected.file.name,bytes:creatorFileBase64(selected.bytes),cropped:creatorFileBase64(cropped),version:work.version}};
  jobs.push(job);await queue.persist(job);assertOpen(turn,user);await queue.run([job]);assertOpen(turn,user);if(job.state==='COMMITTED'){work.version=job.result.version;$('creatorFilesMessage').textContent='표지를 저장했습니다. 작품 화면을 새로 불러오면 반영됩니다.';}
 }
 function download(bytes,name,type){const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function exportAll(){const turn=epoch,user=work.userId,manifest=await api('export',{workId:work.id});assertOpen(turn,user);download(CreatorFileCodec.bundle(manifest),CreatorFileCodec.safeName(manifest.workTitle)+'.zip','application/zip');}
 async function exportItems(){const turn=epoch,user=work.userId,manifest=await api('export',{workId:work.id});assertOpen(turn,user);const list=$('creatorExportItems');list.replaceChildren();
  for(const [i,item]of manifest.items.entries())list.append(button((item.kind==='episode'?'회차 ':'초안 ')+(item.number??i+1)+' · '+item.title+' · '+item.state,()=>{assertOpen(turn,user);download(item.content,CreatorFileCodec.safeName((i+1)+'_'+item.title)+'.txt','text/plain;charset=utf-8');}));
  if(!manifest.items.length)list.textContent='저장된 회차와 원고가 없습니다.';
 }
 function exportCurrent(){const c=window.CreatorDraftEditor.getFileContext();if(!c||c.userId!==actor()?.userId)throw Error('원고를 먼저 열어주세요.');download(c.snapshot.content,CreatorFileCodec.safeName(c.snapshot.title||'원고')+'.txt','text/plain;charset=utf-8');}
 function reset(){epoch++;coverSelection++;queue.stop();work=null;jobs=[];editorContext=null;cover?.bitmap?.close();cover=null;for(const id of ['creatorImportList','creatorOriginalFiles','creatorExportItems','creatorFilesMessage','creatorFilesWorkTitle'])$(id)?.replaceChildren();if($('creatorFileInput'))$('creatorFileInput').value='';if($('creatorCoverInput'))$('creatorCoverInput').value='';$('creatorCoverCanvas')?.getContext('2d').clearRect(0,0,600,900);window.closeModal?.('modalCreatorFiles');}
 function init(){
  $('creatorFileInput').onchange=safe(e=>addFiles(e.target.files));$('creatorCoverInput').onchange=safe(e=>selectCover(e.target.files[0]));
  const zone=$('creatorFileDrop');zone.ondragover=e=>e.preventDefault();zone.ondrop=safe(e=>{e.preventDefault();return addFiles(e.dataTransfer.files);});
  $('creatorImportRun').onclick=safe(()=>queue.run(jobs));$('creatorImportStop').onclick=()=>{queue.stop();$('creatorFilesMessage').textContent='진행 중 요청 결과를 확인한 뒤 나머지 파일은 멈춥니다.';};
  $('creatorCoverSave').onclick=safe(saveCover);for(const id of ['creatorCoverZoom','creatorCoverX','creatorCoverY'])$(id).oninput=drawCover;
  $('creatorExportAll').onclick=safe(exportAll);$('creatorExportList').onclick=safe(exportItems);$('creatorExportCurrent').onclick=safe(exportCurrent);$('btnCreatorFiles').onclick=safe(()=>{const c=window.CreatorDraftEditor.getFileContext();if(!c)throw Error('작품을 먼저 선택해주세요.');return open(c.workId);});
 }
 window.CreatorFiles={open:safe(open),reset};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
