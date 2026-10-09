(function(){
 'use strict';
 const $=id=>document.getElementById(id),actor=()=>window.WebNovelsAuth?.getActor();
 let epoch=0,context=null,options=null,pending=null,busy=false;
 const errors={SESSION_CHANGED:'계정이나 원고가 변경되었습니다. 원고에서 다시 열어주세요.',RECOVERY_EDIT_CHANGED:'선택 이후 원고가 변경되었습니다. 저장된 원고를 다시 확인해주세요.',RECOVERY_SELECTION_REQUIRED:'원본 파일과 원래 회차를 직접 선택하고 확인해주세요.',RECOVERY_TARGET_CONFLICT:'원래 회차가 변경되었습니다. 최신 회차를 다시 확인해주세요.',DRAFT_REVISION_CONFLICT:'저장된 원고 버전이 변경되었습니다. 원고를 다시 확인해주세요.',RECOVERY_READ_ONLY:'활성 상태의 새 소설 원고와 제한 없는 작품에서 요청할 수 있습니다.',RECOVERY_NOVEL_REQUIRED:'웹소설 원고 복구 검토를 지원합니다. 웹툰 원본과 순서는 별도 검토가 필요합니다.',AUTHOR_FILES_NOT_ACTIVATED:'원본 파일 저장과 복구 검토 기능이 아직 활성화되지 않았습니다.',DRAFT_COMPOSING:'한글 입력을 마친 뒤 다시 열어주세요.',PUBLISH_SAVE_REQUIRED:'원고의 서버 저장을 확인한 뒤 다시 열어주세요.',PUBLISH_REVISION_CONFLICT:'기기 원고와 저장된 원고가 다릅니다. 원고 상태를 확인해주세요.'};
 const text=e=>errors[e.code||e.message]||'결과를 확인하지 못했습니다. 보존한 동일 요청으로 다시 확인해주세요.';
 function assertOpen(turn,user){if(turn!==epoch||actor()?.userId!==user||actor()?.author?.status!=='APPROVED'||context?.userId!==user)throw Error('SESSION_CHANGED');}
 function assertDraft(){const c=window.CreatorDraftEditor.getFileContext();if(!c||c.userId!==context.userId||c.workId!==context.workId||c.id!==context.id)throw Error('SESSION_CHANGED');if(context.seq!==undefined&&c.seq!==context.seq)throw Error('RECOVERY_EDIT_CHANGED');}
 const api=(c,body,key,after)=>window.WebNovelsAuth.api('/api/v2/creator/drafts/'+c.id+'/recovery?workId='+encodeURIComponent(c.workId)+(after?'&before='+encodeURIComponent(after):''),body?{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(body)}:{});
 const message=value=>{$('recoveryMessage').textContent=value;};
 const safe=fn=>async()=>{const turn=epoch;try{await fn();}catch(e){if(turn===epoch&&context?.userId===actor()?.userId)message(text(e));}};
 function controls(){for(const id of ['recoveryFile','recoveryEpisode','recoveryNote','recoveryConfirmed','recoverySubmit','recoveryMore','recoveryRetry','recoveryReload'])$(id).disabled=busy;}
 function option(select,value,label){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}
 function history(rows){const list=$('recoveryHistory');list.replaceChildren();for(const r of rows){const p=document.createElement('p');p.textContent=r.episodeNumber+'화 · 원고 버전 '+r.revision+' · 검토 대기 · 요청 '+r.id;list.append(p);}}
 function showPending(){
  $('recoveryForm').hidden=true;$('recoveryPending').hidden=false;$('recoveryResult').hidden=true;
  $('recoveryPendingText').textContent='응답 미확인: 회차 ID '+pending.body.episodeId+' · 원고 버전 '+pending.body.expectedRevision+'. 당시 선택을 보존한 동일 요청의 결과를 확인합니다.';
  message('요청 결과 확인을 먼저 진행해주세요. 현재 편집 내용은 이 요청에 포함되지 않습니다.');
 }
 function showResult(r){$('recoveryForm').hidden=true;$('recoveryPending').hidden=true;$('recoveryResult').hidden=false;$('recoveryResultText').textContent=r.episodeNumber+'화 · 원고 버전 '+r.revision+' · 원본 연결 버전 '+r.sourceRevision+' · 요청 '+r.id+' · 검토 대기. 권리 승인·회차 복구·공개는 아직 진행되지 않았습니다.';message('비공개 검토 요청을 저장했습니다. 원본 파일과 기존 회차는 보존됩니다.');}
 async function open(workId,draftId){
  reset();const turn=epoch,user=actor()?.userId;
  if(!user||actor()?.author?.status!=='APPROVED')throw Error('AUTHOR_REQUIRED');
  if(window.WEBNOVELS_CONFIG?.authorFilesEnabled!==true)throw Error('AUTHOR_FILES_NOT_ACTIVATED');
  if(window.WEBNOVELS_CONFIG?.authorRecoveryEnabled!==true)throw Error('AUTHOR_FILES_NOT_ACTIVATED');
  context={userId:user,workId:String(workId),id:draftId};assertDraft();window.openModal('modalCreatorRecovery');message('저장된 원고와 원본 연결을 확인하는 중입니다.');
  const jobs=await DraftStore.fileJobs(user,context.workId);assertOpen(turn,user);assertDraft();
  pending=jobs.find(j=>j.kind==='recovery'&&j.draftId===draftId&&j.state==='PENDING')||null;
  if(pending){showPending();return;}
  const saved=await window.CreatorDraftEditor.preparePublication();assertOpen(turn,user);assertDraft();
  if(saved.id!==context.id||saved.workId!==context.workId||saved.userId!==user)throw Error('SESSION_CHANGED');context=saved;assertDraft();
  options=await api(context);assertOpen(turn,user);assertDraft();
  if(options.draft.id!==context.id||options.draft.revision!==context.revision)throw Error('DRAFT_REVISION_CONFLICT');
  $('recoverySummary').textContent='저장된 원고 버전 '+context.revision+'. 원본 파일이 연결된 이전 버전과 이후 수정 내용은 각각 검토합니다.';
  for(const f of options.files)option($('recoveryFile'),f.id,(f.filename||'원본 파일')+' · 연결 버전 '+f.sourceRevision+' · SHA-256 '+f.sha256);
  appendEpisodes(options.episodes);$('recoveryMore').hidden=!options.nextCursor;history(options.requests);
  $('recoveryForm').hidden=false;message(options.files.length?'원래 회차와 원본 파일을 직접 선택해주세요.':'가져오기가 완료된 원본 파일이 없습니다. 파일 저장 결과를 먼저 확인해주세요.');
 }
 function appendEpisodes(rows){for(const e of rows)option($('recoveryEpisode'),e.id,e.number+'화 · '+e.title+' · ID '+e.id);}
 async function more(){if(busy||!options?.nextCursor)return;const turn=epoch,user=context.userId;assertDraft();busy=true;controls();try{const page=await api(context,null,null,options.nextCursor);assertOpen(turn,user);assertDraft();if(page.draft.revision!==context.revision)throw Error('DRAFT_REVISION_CONFLICT');options.episodes.push(...page.episodes);options.nextCursor=page.nextCursor;appendEpisodes(page.episodes);$('recoveryMore').hidden=!page.nextCursor;}finally{if(turn===epoch){busy=false;controls();}}}
 async function send(job){
  const turn=epoch,user=context.userId;assertOpen(turn,user);assertDraft();busy=true;controls();
  try{
   // Persist exact metadata and key before dispatch; keep every original import job.
   await DraftStore.saveFileJob(job);assertOpen(turn,user);assertDraft();pending=job;showPending();
   const r=await api({id:job.draftId,workId:job.workId},job.body,job.requestId);
   if(!r?.request?.id||r.request.status!=='PENDING')throw Error('RECOVERY_RESULT_INVALID');
   job.state='COMMITTED';job.result=r.request;await DraftStore.saveFileJob(job);
   assertOpen(turn,user);assertDraft();showResult(r.request);
  }catch(e){
   // Auth/ownership failures happen before receipt lookup and cannot resolve a lost response.
   if([404,409].includes(e.status)&&['DRAFT_REVISION_CONFLICT','RECOVERY_TARGET_CONFLICT','RECOVERY_READ_ONLY','RECOVERY_NOVEL_REQUIRED','SOURCE_FILE_NOT_FOUND','EPISODE_NOT_FOUND'].includes(e.code||e.message)){
    job.state='REJECTED';job.error=e.code||e.message;await DraftStore.saveFileJob(job);
   }
   if(turn===epoch&&actor()?.userId===user){message(text(e));if(job.state==='REJECTED'){$('recoveryPending').hidden=true;$('recoveryResult').hidden=false;$('recoveryResultText').textContent='제출이 거절되었습니다. 기존 요청과 원고는 보존됩니다. 새 선택은 원고에서 검토 화면을 다시 열어 진행해주세요.';}}
  }finally{if(turn===epoch){busy=false;controls();}}
 }
 async function submit(){
  if(busy||pending)return;assertDraft();
  const f=options?.files.find(f=>f.id===$('recoveryFile').value),e=options?.episodes.find(e=>e.id===$('recoveryEpisode').value);
  if(!f||!e||!$('recoveryConfirmed').checked)throw Error('RECOVERY_SELECTION_REQUIRED');
  const turn=epoch,user=context.userId,note=$('recoveryNote').value;busy=true;controls();try{
  const saved=await window.CreatorDraftEditor.preparePublication();assertOpen(turn,user);assertDraft();
  if(saved.revision!==context.revision||saved.seq!==context.seq)throw Error('RECOVERY_EDIT_CHANGED');
  const requestId=crypto.randomUUID(),job={key:user+':recovery:'+requestId,userId:user,workId:context.workId,draftId:context.id,kind:'recovery',state:'PENDING',requestId,
   body:{expectedRevision:context.revision,fileId:f.id,episodeId:e.id,targetDigest:e.targetDigest,note,confirmed:true}};
  await send(job);
  }finally{if(turn===epoch){busy=false;controls();}}
 }
 function reset(){epoch++;context=null;options=null;pending=null;busy=false;for(const id of ['recoveryMessage','recoverySummary','recoveryHistory','recoveryPendingText','recoveryResultText'])$(id)?.replaceChildren();
  for(const id of ['recoveryFile','recoveryEpisode']){if($(id)){$(id).replaceChildren();option($(id),'','직접 선택해주세요');$(id).value='';}}
  if($('recoveryNote'))$('recoveryNote').value='';if($('recoveryConfirmed'))$('recoveryConfirmed').checked=false;
  for(const id of ['recoveryForm','recoveryPending','recoveryResult'])if($(id))$(id).hidden=true;
  if($('recoverySubmit'))controls();window.closeModal?.('modalCreatorRecovery');
 }
 function init(){reset();$('recoverySubmit').onclick=safe(submit);$('recoveryMore').onclick=safe(more);$('recoveryRetry').onclick=safe(()=>{if(!busy&&pending)return send(pending);});$('recoveryReload').onclick=safe(()=>{if(!busy&&context)return open(context.workId,context.id);});}
 window.CreatorRecovery={open:async(work,id)=>{const turn=epoch+1,user=actor()?.userId;try{await open(work,id);}catch(e){if(turn===epoch&&actor()?.userId===user)message(text(e));}},reset};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
