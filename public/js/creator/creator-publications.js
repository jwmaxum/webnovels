(function() {
  'use strict';
  const $ = id => document.getElementById(id);
  const actor = () => window.WebNovelsAuth?.getActor();
  let work = null, context = null, epoch = 0, lastResult = null, busy = false;
  const pendingKey = (user,id) => 'creator-publication:' + user + ':' + id;
  const errorText = e => ({
    WEBTOON_PROCESSING_PENDING:'선택한 이미지 처리를 마치거나 실패한 업로드를 취소한 뒤 미리보기를 열어주세요.',
    LEGACY_WEBTOON_REVIEW_REQUIRED:'기존 웹툰은 원본·권리·순서를 검토한 뒤 이미지 원고로 등록해야 합니다. 기존 자료는 보존됩니다.',
    AUTHOR_PUBLISH_NOT_ACTIVATED:'게시 기능이 아직 활성화되지 않았습니다.',
    PUBLICATION_NOT_READY:'작품 소개·장르·이용등급·AI 사용 표기와 제한 상태를 확인해주세요.',
    DRAFT_REVISION_CONFLICT:'원고 버전이 변경됐습니다. 미리보기를 다시 열어주세요.',
    EPISODE_NUMBER_CONFLICT:'다른 회차나 예약이 먼저 번호를 사용했습니다. 목록을 새로고침하세요.',
    SCHEDULE_CONFLICT:'예약이 이미 변경됐습니다. 상태를 새로고침하세요.',
    PUBLISH_SAVE_REQUIRED:'서버 저장이 확인되지 않았습니다. 원고 상태를 확인하고 다시 시도하세요.',
    PUBLISH_REVISION_CONFLICT:'미리보기와 서버 원고가 달라졌습니다. 다시 확인하세요.',
    RIGHTS_CONFIRMATION_REQUIRED:'게시 권리와 작품 정보를 확인해주세요.',
    INVALID_SCHEDULE:'예약 시각과 시간대를 확인해주세요.',
    DRAFT_COMPOSING:'한글 입력을 마친 뒤 미리보기를 다시 열어주세요.',
    PUBLICATION_IN_PROGRESS:'게시 결과를 확인하는 중입니다. 결과 확인 후 다른 작품을 열어주세요.'
  }[e?.code || e?.message] || '게시 상태를 확인하지 못했습니다. 같은 요청으로 다시 확인하세요.');
  const message = text => { if ($('publicationMessage')) $('publicationMessage').textContent = text; };
  const api = (path, options) => window.WebNovelsAuth.api(
    '/api/v2/creator/publications' + path + '?workId=' + encodeURIComponent(work.id), options
  );
  const post = (path,data,key) => api(path,{method:'POST',
    ...(key ? {headers:{'Idempotency-Key':key}} : {}),body:JSON.stringify(data)});
  function assertOpen(turn,user) {
    if (turn !== epoch || actor()?.userId !== user || work?.userId !== user) throw Error('SESSION_CHANGED');
  }
  function checklist(){
    if(!context||!work)return [];
    const items=window.CreatorReadiness?.publicationItems(work,context,$('publicationRights').checked)||[];
    if($('publicationChecklist'))$('publicationChecklist').innerHTML=window.CreatorReadiness?.render(items)||'';
    return items;
  }
  function showResult(publication,text){
    lastResult=publication;$('publicationDraftPanel').hidden=true;$('publicationRetryPanel').hidden=true;
    $('publicationResult').hidden=false;$('publicationResultText').textContent=text;
    $('publicationRead').hidden=publication.status!=='PUBLISHED';$('publicationCopy').hidden=publication.status!=='PUBLISHED';
  }
  function resultText(publication){
    if(publication.status==='PUBLISHED')return `${publication.episodeNumber}화가 공개됐습니다. 독자 화면에서 확인하세요.`;
    if(publication.status==='SCHEDULED')return `${publication.episodeNumber}화가 ${new Date(publication.dueAt).toLocaleString('ko-KR',{timeZone:publication.displayTimezone})} ${publication.displayTimezone}에 예약됐습니다.`;
    return `${publication.episodeNumber}화 · ${{CANCELLED:'예약이 취소되었습니다. 원고 상태를 확인해 이어서 작성할 수 있습니다.',FAILED:'예약 실행이 실패했습니다. 아래 목록에서 사유를 확인해주세요.',SUPERSEDED:'이 버전 이후에 다른 버전이 반영되었습니다.',RUNNING:'예약 발행 처리 중입니다.'}[publication.status]||'게시 상태를 다시 확인해주세요.'}`;
  }
  async function reconcileDraft(publication,expected){
    if(publication.status==='CANCELLED')await window.CreatorDraftEditor.refreshPublicationState(expected);
    else if(['PUBLISHED','SCHEDULED','FAILED','SUPERSEDED','RUNNING'].includes(publication.status))await window.CreatorDraftEditor.markPublished(expected);
  }
  function utcValue(local,zone) {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(local)) throw Error('INVALID_SCHEDULE');
    const [year,month,day,hour,minute] = local.split(/[-T:]/).map(Number);
    const stamp=Date.UTC(year,month-1,day,hour,minute);
    const round=new Date(stamp);
    if(round.getUTCFullYear()!==year||round.getUTCMonth()!==month-1||round.getUTCDate()!==day||
       round.getUTCHours()!==hour||round.getUTCMinutes()!==minute)throw Error('INVALID_SCHEDULE');
    return new Date(stamp-(zone==='Asia/Seoul'?9:0)*3600000).toISOString();
  }
  function localValue(utc,zone) {
    return new Date(Date.parse(utc)+(zone==='Asia/Seoul'?9:0)*3600000).toISOString().slice(0,16);
  }
  async function loadList(turn,user) {
    const rows=(await api('')).publications;
    assertOpen(turn,user);
    const list=$('publicationList');list.replaceChildren();
    for(const row of rows) {
      const box=document.createElement('div');
      const label=document.createElement('p');
      label.textContent=`${row.episodeNumber}화 · ${row.title} · ${row.status}`+
        (row.dueAt ? ' · '+new Date(row.dueAt).toLocaleString('ko-KR',{timeZone:row.displayTimezone||'Asia/Seoul'})+' '+(row.displayTimezone||'Asia/Seoul') : '')+
        (row.lastErrorCode ? ' · 오류 '+row.lastErrorCode : '');
      box.append(label);
      if(row.status==='PUBLISHED') {
        const edit=document.createElement('button');edit.type='button';edit.className='btn btn-outline btn-sm';
        edit.textContent='공개본 수정 초안 시작';
        edit.onclick=async()=>{try {
          const draftId=crypto.randomUUID();
          const r=await post('/edit/'+row.episodeId,{draftId},crypto.randomUUID());
          assertOpen(turn,user);
          window.closeModal('modalCreatorPublication');
          await window.CreatorDraftEditor.openWork(work.id,r.draft.id);
        }catch(e){message(errorText(e));}};
        box.append(edit);
      }
      if(['SCHEDULED','FAILED'].includes(row.status)) {
        const due=document.createElement('input');due.type='datetime-local';
        due.value=localValue(row.dueAt,row.displayTimezone);
        due.setAttribute('aria-label',row.episodeNumber+'화 예약 시각');
        const zone=document.createElement('select');
        for(const z of ['Asia/Seoul','UTC']){const option=document.createElement('option');option.value=z;option.textContent=z;zone.append(option);}
        zone.value=row.displayTimezone;
        zone.onchange=()=>{due.value=localValue(row.dueAt,zone.value);};
        const change=document.createElement('button');change.type='button';change.className='btn btn-outline btn-sm';change.textContent='예약 시각 변경';
        change.onclick=async()=>{try {
          await post('/schedule/'+row.episodeId,{generation:row.generation,dueAt:utcValue(due.value,zone.value),displayTimezone:zone.value});
          await loadList(turn,user);message('예약 시각을 변경했습니다.');
        }catch(e){if(e.status===409)await loadList(turn,user).catch(()=>{});message(errorText(e));}};
        const cancel=document.createElement('button');cancel.type='button';cancel.className='btn btn-outline btn-sm';cancel.textContent='예약 취소';
        cancel.onclick=async()=>{try {
          const cancelled=await post('/cancel/'+row.episodeId,{generation:row.generation});assertOpen(turn,user);
          let notice='';
          try{await reconcileDraft(cancelled.publication,{userId:user,workId:work.id,id:row.draftId});}
          catch{notice=' 기기 원고 상태 확인에 실패했습니다. 원고를 보관하고 다시 확인해주세요.';}
          assertOpen(turn,user);
          try{await loadList(turn,user);}catch{notice+=' 회차 목록 갱신에 실패했습니다.';}
          assertOpen(turn,user);message('예약 취소가 확정됐습니다. 원고는 보존됩니다.'+notice);
        }catch(e){if(e.status===409)await loadList(turn,user).catch(()=>{});message(errorText(e));}};
        box.append(due,zone,change,cancel);
      }
      list.append(box);
    }
    if(!rows.length)list.textContent='아직 공개하거나 예약한 회차가 없습니다.';
    return rows;
  }
  async function open(workId) {
    if(busy)throw Error('PUBLICATION_IN_PROGRESS');
    if(window.WEBNOVELS_CONFIG?.authorPublishEnabled!==true||actor()?.author?.status!=='APPROVED'||actor()?.authorWorkspaceReady===true)throw Error('AUTHOR_PUBLISH_NOT_ACTIVATED');
    const turn=++epoch,user=actor()?.userId;
    if(!user||!actor()?.author)throw Error('AUTHOR_REQUIRED');
    work=null;context=null;lastResult=null;message('작품과 원고를 확인하는 중입니다.');
    $('publicationResult').hidden=true;$('publicationDraftPanel').hidden=true;$('publicationRetryPanel').hidden=true;
    $('publicationRights').checked=false;
    window.openModal('modalCreatorPublication');
    const result=await window.WebNovelsAuth.api('/api/v2/creator/works/'+workId);
    if(turn!==epoch||actor()?.userId!==user)throw Error('SESSION_CHANGED');
    work={...result.work,userId:user,episodes:result.episodes};
    $('publicationHeading').textContent=work.title+' · 미리보기·게시';
    const rows=await loadList(turn,user);
    const current=window.CreatorDraftEditor?.getFileContext();
    if(current?.id&&current.workId===String(workId)&&current.userId===user) {
      const storage=pendingKey(user,current.id);
      const pending=JSON.parse(sessionStorage.getItem(storage)||'null');
      const confirmed=pending&&rows.find(row=>row.draftId===current.id&&
        row.revision===pending.data.revision&&row.episodeNumber===pending.data.episodeNumber);
      if(confirmed) {
        sessionStorage.removeItem(storage);
        showResult(confirmed,resultText(confirmed));
        let notice='';try{await reconcileDraft(confirmed,{...current,seq:-1});}catch{notice=' 기기 원고 상태를 확인하지 못했습니다. 원고를 다운로드하고 다시 확인해주세요.';}
        assertOpen(turn,user);message('게시 결과를 확인했습니다. 다음 회차는 새 원고로 시작할 수 있습니다.'+notice);return;
      }
      if(pending){
        context={...current,seq:-1,revision:pending.data.revision,episodeNumber:pending.data.episodeNumber};
        $('publicationRetryPanel').hidden=false;
        $('publicationRetrySummary').textContent=`이전 요청: ${pending.data.episodeNumber}화 · 서버 버전 ${pending.data.revision}. 당시의 권리 확인과 정확한 요청으로 결과를 재확인합니다. 현재 편집 내용은 새로 게시하지 않습니다.`;
        message('응답을 확인하지 못한 게시 요청이 있습니다. 기존 요청의 결과를 먼저 확인해주세요.');return;
      }
    }
    if(current?.workId!==String(workId)||current.userId!==user){
      message('원고 작성 화면에서 초안을 열면 미리보기와 게시를 진행할 수 있습니다.');
      return;
    }
    try { context=await window.CreatorDraftEditor.preparePublication(); }
    catch(e){message(errorText(e));return;}
    assertOpen(turn,user);
    const suggestion=await api('/suggest');assertOpen(turn,user);
    const number=context.episodeId
      ? result.episodes.find(e=>String(e.id)===String(context.episodeId))?.episode_number
      : suggestion.episodeNumber;
    if(!number)throw Error('EPISODE_NUMBER_UNAVAILABLE');
    context.episodeNumber=Number(number);
    const prior=rows.find(row=>String(row.episodeId)===String(context.episodeId)&&row.status==='PUBLISHED');
    const policy=context.episodeId?(prior?.accessPolicy||'기존 정책'):'FREE';
    $('publicationDraftPanel').hidden=false;
    document.querySelector('input[name="publicationMode"][value="NOW"]').checked=true;
    $('publicationScheduleFields').hidden=true;$('publicationCommit').textContent='선택한 버전 게시';
    $('publicationPreviewTitle').textContent=context.snapshot.title||'무제';
    if(context.snapshot.webtoon){
      window.ReaderWebtoon?.destroy($('publicationPreviewBody'));
      await window.CreatorWebtoon.renderPreview($('publicationPreviewBody'),context,()=>turn===epoch&&actor()?.userId===user);
      assertOpen(turn,user);$('publicationPreviewComment').textContent=Object.entries(context.snapshot.webtoon.credits||{}).map(([k,v])=>({writer:'글',artist:'그림',original:'원작'}[k])+': '+v).join(' · ')+'\n'+context.snapshot.authorComment;
    }else window.ReaderContent.render($('publicationPreviewBody'),$('publicationPreviewComment'),context.snapshot);
    $('publicationSummary').textContent=
      `작품: ${work.title} · ${number}화 · 서버 원고 버전 ${context.revision} · ${context.snapshot.webtoon?'이미지 '+context.snapshot.webtoon.assetIds.length+'개':'본문 '+context.snapshot.content.length+'자'} · 등급 ${work.rating} · AI ${work.ai_usage_type} · ${context.episodeId?'기존 접근 정책 유지: '+policy:'신규 무료'} · ${work.description||'소개 없음'}`+
      (work.publication_missing?.length?' · 게시 전 미확인: '+work.publication_missing.join(', '):'');
    $('publicationNowLabel').textContent=context.episodeId?'즉시 재게시 (기존 접근 정책 유지)':'즉시 무료 게시';
    $('publicationScheduledLabel').textContent=context.episodeId?'예약 재게시 (기존 접근 정책 유지)':'예약 무료 게시';
    $('publicationRights').checked=false;
    checklist();
    message('미리보기는 이 계정의 저장된 초안 버전입니다. 공개 전 내용을 확인하세요.');
  }
  async function publish() {
    if(busy||!work||!context||lastResult)return;
    const turn=epoch;
    busy=true;$('publicationCommit').disabled=true;$('publicationRetry').disabled=true;
    try {
      const user=actor()?.userId;if(user!==work.userId)throw Error('SESSION_CHANGED');
      const storage=pendingKey(user,context.id);
      let pending=JSON.parse(sessionStorage.getItem(storage)||'null');
      if(!pending) {
        if(!$('publicationRights').checked)throw Error('RIGHTS_CONFIRMATION_REQUIRED');
        if(checklist().some(x=>x.state==='blocked'||x.state==='pending'))throw Error('PUBLICATION_NOT_READY');
        const current=await window.CreatorDraftEditor.preparePublication();
        assertOpen(turn,user);
        if(current.id!==context.id||current.revision!==context.revision||current.seq!==context.seq)
          throw Error('PUBLISH_REVISION_CONFLICT');
        const mode=document.querySelector('input[name="publicationMode"]:checked')?.value||'NOW';
        const data={revision:context.revision,episodeNumber:context.episodeNumber,mode,rightsConfirmed:true};
        if(mode==='SCHEDULED') {
          data.displayTimezone=$('publicationTimezone').value;
          data.dueAt=utcValue($('publicationDueAt').value,data.displayTimezone);
        }
        pending={key:crypto.randomUUID(),data};
        sessionStorage.setItem(storage,JSON.stringify(pending));
      }
      const result=await post('/publish/'+context.id,pending.data,pending.key);
      assertOpen(turn,user);
      sessionStorage.removeItem(storage);
      const publication=result.publication,notices=[];
      try { await reconcileDraft(publication,context); }
      catch { notices.push('기기 상태 저장에 실패했습니다. 기기 원고를 다운로드해 보관해주세요.'); }
      assertOpen(turn,user);
      showResult(publication,resultText(publication));
      try{await loadList(turn,user);}catch{notices.push('회차 목록 갱신에 실패했습니다. 게시 결과는 확정됐습니다.');}
      assertOpen(turn,user);
      if(publication.status==='PUBLISHED')try { await window.refreshReaderCatalog?.(true); }
        catch { notices.push('독자 목록 갱신에 실패했습니다. 독자 화면을 다시 열어주세요.'); }
      assertOpen(turn,user);message('게시 결과를 확인했습니다.'+(notices.length?' '+notices.join(' '):''));
    } finally {if(turn===epoch){busy=false;$('publicationCommit').disabled=false;$('publicationRetry').disabled=false;}}
  }
  function reset(){window.ReaderWebtoon?.destroy($('publicationPreviewBody'));epoch++;work=null;context=null;lastResult=null;busy=false;
    for(const id of ['publicationList','publicationPreviewBody','publicationPreviewComment','publicationSummary','publicationMessage','publicationChecklist','publicationRetrySummary'])$(id)?.replaceChildren();
    $('publicationDraftPanel').hidden=true;$('publicationResult').hidden=true;$('publicationRetryPanel').hidden=true;
    window.closeModal?.('modalCreatorPublication');
  }
  function init(){
    $('btnOpenPublication').onclick=()=>{const c=window.CreatorDraftEditor.getFileContext(),user=actor()?.userId;if(c)return open(c.workId).catch(e=>{if(actor()?.userId===user&&e.message!=='SESSION_CHANGED')message(errorText(e));});};
    $('publicationDesktop').onclick=()=>$('publicationPreview').classList.remove('is-mobile');
    $('publicationMobile').onclick=()=>$('publicationPreview').classList.add('is-mobile');
    for(const input of document.querySelectorAll('input[name="publicationMode"]'))input.onchange=()=>{
      $('publicationScheduleFields').hidden=input.value!=='SCHEDULED';
      $('publicationCommit').textContent=input.value==='SCHEDULED'?'선택한 버전 예약':'선택한 버전 게시';
    };
    const submit=()=>{const turn=epoch;return publish().catch(e=>{if(turn===epoch)message(errorText(e));});};
    $('publicationCommit').onclick=submit;
    $('publicationRetry').onclick=submit;
    $('publicationRights').onchange=checklist;
    $('publicationRead').onclick=()=>{if(lastResult){window.closeModal('modalCreatorPublication');window.openReaderDirect(work.id,lastResult.episodeNumber);}};
    $('publicationCopy').onclick=()=>{if(lastResult)navigator.clipboard.writeText(location.origin+'/read/'+work.id+'/'+lastResult.episodeNumber)
      .then(()=>message('독자 링크를 복사했습니다.')).catch(()=>message('링크 복사에 실패했습니다.'));};
    $('publicationNext').onclick=async()=>{if(!lastResult)return;try{const id=work.id;window.closeModal('modalCreatorPublication');await window.CreatorDraftEditor.startNext(id);}
      catch(e){message(errorText(e));}};
  }
  window.CreatorPublications={open,reset};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
