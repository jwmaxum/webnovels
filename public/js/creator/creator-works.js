// Author-only work management. No public catalog or administrator form dependency.
(function () {
  'use strict';
  let epoch=0, current=null, rows=[], cursor=null, filter='all', busy=false;
  const e = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const root = () => document.getElementById('creatorWorksContainer');
  const api = (path,options) => window.WebNovelsAuth.api('/api/v2/creator/works'+path,options);
  const actor = () => window.WebNovelsAuth?.getActor();
  const pendingKey = () => 'creator.pending-work.'+actor().userId;
  const message = error => ({
    WORK_CONFLICT:'다른 화면에서 수정되었습니다. 입력 내용은 유지됩니다. 최신 내용을 확인한 뒤 다시 저장해주세요.',
    WORK_NOT_FOUND:'작품을 찾을 수 없거나 접근 권한이 없습니다.',
    AUTHOR_REQUIRED:'작가 로그인이 필요합니다.', WORK_RESTRICTED:'운영 제한 중인 작품입니다. 운영자에게 문의해주세요.',
    SCHEDULE_RUNNING:'예약 발행 처리 중입니다. 잠시 후 다시 시도해주세요.',
    WORK_TRASHED:'휴지통에서 먼저 복구해주세요.', RATING_REVIEW_REQUIRED:'공개 작품의 이용등급 변경은 운영 검토가 필요합니다.',
    AUTHOR_WORKS_NOT_ACTIVATED:'작품 관리 서비스가 아직 활성화되지 않았습니다.',
    WORK_STATE_MIGRATION_REQUIRED:'기존 작품의 관리 정보 확인이 필요합니다. 운영자에게 문의해주세요.',
    IDEMPOTENCY_CONFLICT:'이전 등록 요청과 내용이 다릅니다. 목록에서 등록 결과를 먼저 확인해주세요.',
    INVALID_FIELD:'입력 길이와 선택 항목을 확인해주세요.'
  }[error.code] || '작품 요청에 실패했습니다. 입력을 유지한 채 다시 시도해주세요.');
  function navigate(path) { window.navigateTo(path); }
  function validRequest(seq,user) { return epoch===seq && actor()?.userId===user && /^\/(creator|author)(\/|$)/.test(location.pathname); }
  function cover(work) {
    const url=work.cover_image?.startsWith('/api/v2/creator/files/public-cover/')&&work.visibility!=='PUBLIC'?null:work.cover_image;
    return typeof url==='string' && /^(https:\/\/|\/(?!\/))/.test(url)
      ? `<img class="cw-cover" src="${e(url)}" alt="${e(work.title)} 표지" loading="lazy">`
      : `<div class="cw-cover cw-default-cover" role="img" aria-label="${e(work.title)} 기본 표지">${e(work.title)}</div>`;
  }
  function status(work) { return work.trashed_at?'휴지통':work.visibility==='PUBLIC'?'공개':'비공개 / 초안'; }
  function card(work) {
    return `<article class="cw-card">${cover(work)}<div><h4>${e(work.title)}</h4>
      <p>${status(work)} · ${{ONGOING:'연재 중',HIATUS:'휴재',COMPLETED:'완결'}[work.serial_state]||'확인 필요'} · ${e(work.episode_count)}화</p>
      ${work.moderation_state==='RESTRICTED'?'<p class="cw-notice">운영 제한</p>':''}
      <button type="button" class="btn btn-outline" data-work-id="${e(work.id)}">작품 관리</button></div></article>`;
  }
  function listHTML() {
    return `<div class="cw-toolbar"><label>목록 <select id="cwFilter" class="form-control">
      ${[['all','내 작품 전체'],['draft','비공개 / 초안'],['public','공개'],['trash','휴지통']].map(([v,t])=>`<option value="${v}" ${filter===v?'selected':''}>${t}</option>`).join('')}</select></label>
      <button type="button" class="btn btn-primary" id="cwCreate">새 작품</button></div>
      <div id="cwList">${rows.length?rows.map(card).join(''):`<p role="status">${filter==='trash'?'휴지통이 비어 있습니다.':filter==='all'?'아직 등록한 작품이 없습니다. 제목만으로 첫 작품을 시작해보세요.':'이 조건에 맞는 작품이 없습니다.'}</p>${filter==='all'?'<button type="button" class="btn btn-primary" id="cwFirst">첫 작품 등록하기</button>':''}`}</div>
      ${cursor?'<button type="button" class="btn btn-outline" id="cwMore">더 불러오기</button>':''}<p id="cwMessage" role="status"></p>`;
  }
  function bindList() {
    root().querySelector('#cwFilter').onchange=event=>{filter=event.target.value;loadList();};
    root().querySelector('#cwCreate').onclick=()=>navigate('/creator/works/new');
    const first=root().querySelector('#cwFirst');if(first)first.onclick=()=>navigate('/creator/works/new');
    root().querySelectorAll('[data-work-id]').forEach(button=>button.onclick=()=>navigate('/creator/works/'+button.dataset.workId));
    const more=root().querySelector('#cwMore');if(more)more.onclick=()=>loadList(true);
  }
  async function loadList(append=false) {
    const seq=++epoch,user=actor()?.userId;current=null;
    if(!root())return;
    const countLabel=document.getElementById('creatorWorksCount');if(countLabel&&!append)countLabel.textContent='불러오는 중';
    if(!append){rows=[];cursor=null;root().innerHTML='<p role="status">내 작품을 불러오는 중입니다…</p>';}
    else {const button=root().querySelector('#cwMore');if(button)button.disabled=true;}
    try {
      const result=await api('?filter='+filter+'&after='+(append?cursor:'0'));
      if(!validRequest(seq,user))return;
      rows=append?[...rows,...result.works]:result.works;cursor=result.nextCursor;
      root().innerHTML=listHTML();bindList();
      const count=document.getElementById('creatorWorksCount');if(count)count.textContent=`불러온 작품: ${rows.length}개${cursor?' 이상':''}`;
    }catch(error){
      if(!validRequest(seq,user))return;
      if(countLabel)countLabel.textContent='목록 확인 실패';
      if(!append)root().innerHTML=`<p role="alert">${e(message(error))}</p><button type="button" class="btn btn-outline" id="cwRetry">다시 불러오기</button>`;
      else {document.getElementById('cwMessage').textContent=message(error);root().querySelector('#cwMore').disabled=false;}
      const retry=root().querySelector('#cwRetry');if(retry)retry.onclick=()=>loadList();
    }
  }
  function pending() { try{return JSON.parse(sessionStorage.getItem(pendingKey())||'null');}catch{return null;} }
  function createForm() {
    ++epoch;current=null;
    const saved=pending();
    root().innerHTML=`<button type="button" class="btn btn-ghost" id="cwBack">← 내 작품</button><h3>새 작품 시작하기</h3>
      <p>제목만 입력하면 비공개 작품이 만들어집니다. 소개와 장르, 이용등급은 이후에 설정할 수 있습니다.</p>
      <form id="cwCreateForm"><label for="cwTitle">작품명</label><input id="cwTitle" class="form-control" maxlength="200" required value="${e(saved?.title||'')}" ${saved?'readonly':''}>
        <p id="cwMessage" role="status">${saved?'이전 요청의 등록 결과를 확인하지 못했습니다. 같은 요청을 다시 확인합니다.':''}</p>
        <button type="submit" class="btn btn-primary">${saved?'등록 결과 확인 / 재시도':'비공개 작품 만들기'}</button></form>`;
    root().querySelector('#cwBack').onclick=()=>navigate('/creator/works');
    root().querySelector('#cwCreateForm').onsubmit=submitCreate;
  }
  async function create(title) {
    const storageKey=pendingKey();
    let saved=pending();
    if(!saved){saved={key:crypto.randomUUID(),title:title.trim()};sessionStorage.setItem(pendingKey(),JSON.stringify(saved));}
    const result=await api('',{method:'POST',headers:{'Idempotency-Key':saved.key},body:JSON.stringify({title:saved.title})});
    sessionStorage.removeItem(storageKey);return result;
  }
  async function submitCreate(event) {
    event.preventDefault();if(busy)return;
    const title=document.getElementById('cwTitle'),button=event.target.querySelector('button[type="submit"]');
    if(!title.value.trim())return;
    busy=true;button.disabled=true;title.readOnly=true;const user=actor()?.userId,seq=epoch;
    try {const result=await create(title.value);if(validRequest(seq,user))navigate('/creator/works/'+result.work.id+'/settings');}
    catch(error){if(validRequest(seq,user)){
      document.getElementById('cwMessage').textContent=message(error);
      if(error.status===400){sessionStorage.removeItem(pendingKey());title.readOnly=false;}
    }}
    finally{busy=false;button.disabled=false;}
  }
  function options(values,selected,blank=false) {return (blank?'<option value="">미설정 (공개 전 선택)</option>':'')+values.map(([v,t])=>`<option value="${v}" ${v===selected?'selected':''}>${t}</option>`).join('');}
  function detailHTML(work,episodes,tab) {
    const disabled=work.trashed_at||work.moderation_state!=='CLEAR';
    const nav=[['episodes','회차 목록'],['settings','작품 설정'],['reactions','독자 반응']].map(([v,t])=>`<button type="button" class="btn ${v===tab?'btn-primary':'btn-outline'}" data-detail-tab="${v}">${t}</button>`).join('');
    let body;
    if(tab==='settings')body=`<form id="cwSettings"><fieldset ${disabled?'disabled':''}>
      <label for="cwEditTitle">작품명</label><input id="cwEditTitle" class="form-control" name="title" required maxlength="200" value="${e(work.title)}">
      <label for="cwDescription">소개</label><textarea id="cwDescription" class="form-control" name="description" maxlength="5000" rows="5">${e(work.description)}</textarea>
      <label for="cwGenre">장르 (쉼표로 구분, 최대 10개)</label><input id="cwGenre" class="form-control" name="genre" value="${e((work.genre||[]).join(', '))}">
      <label for="cwTags">태그 (쉼표로 구분, 최대 10개)</label><input id="cwTags" class="form-control" name="tags" value="${e((work.tags||[]).join(', '))}">
      <label for="cwRating">이용등급</label><select id="cwRating" class="form-control" name="rating">${options([['ALL','전체 이용가'],['AGE_15','15세 이상'],['AGE_19','19세 이상']],work.rating_confirmed?work.rating:'',!work.rating_confirmed)}</select>
      <label for="cwAI">AI 사용 표기</label><select id="cwAI" class="form-control" name="ai_usage_type">${options([['NONE','사용 안 함'],['ASSISTED','보조 사용'],['GENERATED','AI 생성 포함']],work.ai_confirmed?work.ai_usage_type:'',!work.ai_confirmed)}</select>
      <label for="cwSerial">연재 상태 (공개 여부와 별개)</label><select id="cwSerial" class="form-control" name="serial_state">${options([['ONGOING','연재 중'],['HIATUS','휴재'],['COMPLETED','완결']],work.serial_state)}</select>
      <p>표지는 파일 관리에서 올릴 수 있습니다. 표지가 없으면 제목으로 기본 표지를 표시합니다.</p>
      <button type="submit" class="btn btn-primary">설정 저장</button></fieldset></form>
      ${work.visibility==='PUBLIC'&&!disabled?'<button type="button" class="btn btn-outline" id="cwPrivate">비공개로 전환</button>':''}
      <p>설정 저장은 공개 여부를 바꾸지 않습니다. 저장된 초안은 미리보기·게시에서 확인할 수 있습니다.</p>`;
    else if(tab==='reactions')body='<p>댓글·독자 반응 관리 기능은 준비 중입니다.</p>';
    else body=`<h4>회차 ${episodes.length}개</h4>${episodes.length?`<ol class="cw-episodes">${episodes.map(ep=>`<li>${e(ep.episode_number)}화 · ${e(ep.title)} <span>${e(ep.status)}</span>${ep.scheduled_at?' · 예약 '+e(ep.scheduled_at):''}</li>`).join('')}</ol>`:'<p>아직 작성한 회차가 없습니다.</p>'}<button type="button" id="cwDrafts" class="btn btn-primary">원고 작성·복구</button>`;
    return `<button type="button" class="btn btn-ghost" id="cwBack">← 내 작품</button><header class="cw-card">${cover(work)}<div><h3>${e(work.title)}</h3><p>${status(work)}</p>
      ${work.moderation_state==='RESTRICTED'?`<p role="alert">운영 제한: ${e(work.moderation_reason)}</p>`:''}
      <p>최초 공개 전 확인: ${work.publication_missing?.length?e(work.publication_missing.join(', ')):'기본 정보 입력 완료 (게시 검증은 별도)'}</p></div></header>
      <nav class="cw-toolbar" aria-label="작품 관리">${nav}<button type="button" class="btn btn-outline" id="cwFiles">파일·표지·내보내기</button><button type="button" class="btn btn-outline" id="cwPublications">공개·예약 회차</button></nav>${body}<p id="cwMessage" role="status"></p>
      <div class="cw-danger"><p>휴지통 이동·비공개 전환 시 공개가 중단되고 대기 중인 예약은 취소됩니다. 회차·원고·파일은 보존됩니다. 복구해도 비공개이며 예약은 자동 재개되지 않습니다.</p>
      <button type="button" class="btn btn-outline" id="cwTrash">${work.trashed_at?'비공개로 복구':'휴지통으로 이동'}</button></div>
      <button type="button" class="btn btn-ghost" id="cwReload">최신 내용 불러오기 (입력 초기화)</button>`;
  }
  async function loadDetail(id,tab='episodes') {
    if(!/^\d+$/.test(id))return loadList();
    const seq=++epoch,user=actor()?.userId;current=null;
    root().innerHTML='<p role="status">작품을 불러오는 중입니다…</p>';
    try {
      const result=await api('/'+id);if(!validRequest(seq,user))return;
      current=result.work;root().innerHTML=detailHTML(current,result.episodes,tab);
      const drafts=root().querySelector('#cwDrafts');if(drafts)drafts.onclick=()=>window.CreatorDraftEditor.openWork(id);
      const files=root().querySelector('#cwFiles');if(files)files.onclick=()=>window.CreatorFiles.open(id);
      const publications=root().querySelector('#cwPublications');if(publications)publications.onclick=()=>window.CreatorPublications.open(id);
      root().querySelector('#cwBack').onclick=()=>navigate('/creator/works');
      root().querySelectorAll('[data-detail-tab]').forEach(button=>button.onclick=()=>navigate('/creator/works/'+id+'/'+button.dataset.detailTab));
      root().querySelector('#cwReload').onclick=()=>loadDetail(id,tab);
      root().querySelector('#cwTrash').onclick=()=>mutate(current.trashed_at?'restore':'trash',{},tab);
      const hide=root().querySelector('#cwPrivate');if(hide)hide.onclick=()=>mutate('update',{visibility:'PRIVATE'},tab);
      const form=root().querySelector('#cwSettings');if(form)form.onsubmit=event=>{
        event.preventDefault();const data=Object.fromEntries(new FormData(form));
        for(const key of ['genre','tags'])data[key]=[...new Set(data[key].split(',').map(v=>v.trim()).filter(Boolean))];
        for(const key of ['rating','ai_usage_type'])if(!data[key])delete data[key];
        return mutate('update',data,tab);
      };
    }catch(error){if(validRequest(seq,user))root().innerHTML=`<p role="alert">${e(message(error))}</p><button type="button" class="btn btn-outline" onclick="CreatorWorks.loadFromRoute()">다시 불러오기</button>`;}
  }
  async function mutate(action,data,tab) {
    if(busy||!current)return;
    if(action==='trash'&&!window.confirm('공개가 중단되고 대기 예약이 취소됩니다. 원고는 보존됩니다. 휴지통으로 옮길까요?'))return;
    if(data.visibility==='PRIVATE'&&!window.confirm('공개를 중단하고 대기 예약을 취소할까요?'))return;
    busy=true;const id=current.id,version=current.version,seq=epoch,user=actor()?.userId;
    root().querySelectorAll('button[type="submit"],#cwTrash,#cwPrivate').forEach(b=>b.disabled=true);
    try {
      await api('/'+id+(action==='update'?'':'/'+action),{method:action==='update'?'PATCH':'POST',body:JSON.stringify({...data,version})});
      if(action==='trash'||(action==='update'&&data.visibility==='PRIVATE'))await window.refreshReaderCatalog?.(true);
      if(validRequest(seq,user)){await loadDetail(id,tab);const msg=document.getElementById('cwMessage');if(msg)msg.textContent='저장되었습니다.';}
    }catch(error){if(validRequest(seq,user))document.getElementById('cwMessage').textContent=message(error);}
    finally{busy=false;if(root())root().querySelectorAll('button[type="submit"],#cwTrash,#cwPrivate').forEach(b=>b.disabled=false);}
  }
  function loadFromRoute() {
    if(!root())return;
    if(!actor()?.author){reset();return;}
    const parts=location.pathname.split('/').filter(Boolean);
    if(parts[1]==='works'&&parts[2]==='new')return createForm();
    if(parts[1]==='works'&&/^\d+$/.test(parts[2]||''))return loadDetail(parts[2],['settings','reactions'].includes(parts[3])?parts[3]:'episodes');
    return loadList();
  }
  function reset(){++epoch;current=null;rows=[];cursor=null;if(root())root().innerHTML='<p>작가 로그인이 필요합니다.</p>';}
  window.CreatorWorks={loadFromRoute,create,reset,navigate,renderCard:card,renderDetail:detailHTML};
})();
