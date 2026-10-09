(function () {
  'use strict';
  const core = globalThis.ContentReviewSession;
  const model = JSON.parse(document.getElementById('review-data').textContent);
  const root = document.getElementById('review-root');
  const el = (tag, text, parent) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  };
  el('h1','원본 검토 워크벤치',root);
  el('p','비공개 원고입니다. 이 파일을 웹에 올리지 마세요. 입력은 메모리에만 남습니다. 이동·종료 전 검토 세션을 내려받으세요.',root);
  el('p','이 화면의 선택은 저작권 인증이나 공개 승인이 아닙니다. 근거 바이트는 CLI에서 다시 검증합니다. HOLD와 PENDING은 미해결이며 실제 DB·플래그는 바뀌지 않습니다.',root);
  el('p','백업: '+model.capturedAt+' · snapshot '+model.snapshotSha256,root).className='context';
  const controls = el('div',undefined,root); controls.className='controls';
  const searchLabel = el('label','작품/회차 ID·제목 검색 ',controls);
  const search = el('input',undefined,searchLabel); search.type='search'; search.id='review-search';
  const filterLabel = el('label','검토 목록 ',controls);
  const filter = el('select',undefined,filterLabel); filter.id='review-filter';
  for (const [value,label] of [['ALL','전체'],['PENDING','미검토'],['HOLD','보류'],['RECOVERY','원본 복구 필요'],['EVIDENCE','권리·이미지 근거 필요']]) {
    const option=el('option',label,filter); option.value=value;
  }
  const summary = el('p',undefined,root); summary.id='review-summary';
  const status = el('p','회차를 선택해 두 원본을 확인하세요.',root); status.id='review-status'; status.setAttribute('role','status');
  const layout = el('div',undefined,root); layout.className='layout';
  const list = el('div',undefined,layout); list.id='review-list'; list.className='queue';
  const detail = el('section',undefined,layout); detail.id='review-detail';
  const actions = el('div',undefined,root); actions.className='controls';
  const exportButton = el('button','검토 세션 내려받기',actions); exportButton.id='review-export';
  const importLabel = el('label','저장한 세션 가져오기 ',actions);
  const importInput = el('input',undefined,importLabel); importInput.type='file'; importInput.accept='.json'; importInput.id='review-import';
  const clearButton = el('button','현재 검토 비우기',actions); clearButton.id='review-clear';
  el('p','근거: CLI의 stage-evidence로 private 파일을 복사한 뒤 생성된 descriptor.json을 선택하세요. 다운로드한 세션은 같은 백업 폴더에 두고 finalize로 전체 결정 파일을 만드세요. 원고 NULL·빈 문자열·공백·CRLF는 해시에 그대로 보존됩니다.',root);
  const edits = new Map();
  let active = null, form = null;
  const reportError = error => { status.textContent = /^WORKBENCH_[A-Z_]+$/.test(error.message) ? error.message : 'WORKBENCH_INPUT_REJECTED'; };
  function save() {
    if (!active || !form) return;
    let decision = core.pending(active);
    if (form.choice.value !== 'PENDING') {
      decision.decision=form.choice.value; decision.reviewerRef=form.reviewer.value; decision.evidenceRef=form.reason.value;
      if (decision.decision !== 'HOLD') {
        decision.rightsEvidence=form.rights; decision.imageEvidence=form.image;
        decision.selectedSourceSha256=active.options.find(option=>option.decision===decision.decision)?.sha256 ?? null;
      }
    }
    decision=core.validateDecision(active,decision);
    if (decision.decision === 'PENDING') edits.delete(active.episodeId);
    else edits.set(active.episodeId,decision);
  }
  function renderList() {
    list.replaceChildren();
    const states=[...edits.values()], selected=states.filter(d=>d.decision.startsWith('USE_')).length, held=states.filter(d=>d.decision==='HOLD').length;
    summary.textContent='전체 '+model.entries.length+' · 원본 선택 '+selected+' · 보류 '+held+' · 미검토 '+(model.entries.length-states.length)+' · 미해결 '+(model.entries.length-selected);
    const query=search.value.trim().toLowerCase();
    for (const row of model.entries) {
      const state=edits.get(row.episodeId)?.decision || 'PENDING';
      const recovery=row.options.every(option=>option.blockedReasons.length);
      if (query && ![row.workId,row.episodeId,row.workTitle,row.title].some(text=>text.toLowerCase().includes(query))) continue;
      if (filter.value==='PENDING' && state!=='PENDING' || filter.value==='HOLD' && state!=='HOLD' || filter.value==='RECOVERY' && !recovery || filter.value==='EVIDENCE' && recovery) continue;
      const button=el('button',row.contentType+' · 작품 '+row.workId+' / '+row.episodeNumber+'화 · '+row.title+' · '+state,list);
      button.setAttribute('aria-pressed',String(active?.episodeId===row.episodeId));
      button.addEventListener('click',()=>{try{save();show(row);renderList();}catch(error){reportError(error);}});
    }
    if (!list.children.length) el('p','조건에 맞는 회차가 없습니다.',list);
  }
  function evidencePicker(key,label,parent,row) {
    const field=el('label',label+' descriptor ',parent), input=el('input',undefined,field);
    input.type='file'; input.accept='.json'; input.id='review-'+key;
    const info=el('span',form[key] ? form[key].file+' · '+form[key].bytes+' bytes' : '미선택',field);
    input.addEventListener('change',async()=>{
      const ownerForm=form;
      ownerForm[key]=null; info.textContent='미선택';
      try {
        const file=input.files?.[0]; if (!file || file.size>16384) throw Error('WORKBENCH_DESCRIPTOR_SIZE');
        const descriptor=core.evidence(JSON.parse(await file.text()));
        if (active!==row || form!==ownerForm) return;
        ownerForm[key]=descriptor; info.textContent=descriptor.file+' · '+descriptor.bytes+' bytes';
      } catch(error) { if(active===row && form===ownerForm) reportError(error); }
    });
  }
  function show(row) {
    active=row; detail.replaceChildren();
    const saved=edits.get(row.episodeId) || core.pending(row);
    el('h2',row.workTitle+' · '+row.episodeNumber+'화 '+row.title,detail);
    el('p','회차 '+row.episodeId+' · 작품 '+row.workId+' · 작가 프로필 '+(row.authorId ?? '없음')+' · 서버 소유 연결 '+(row.authMappingVerified?'검증됨':'미검증')+' · 이미지 '+row.imageCount+'개',detail);
    el('p',row.options.every(option=>option.blockedReasons.length) ? '선택 가능한 원본이 없습니다. 실제 원고 복구/연결 확인 후 새 백업으로 다시 검토하세요.' : '원본 선택에는 권리 근거가 필요합니다. 웹툰은 별도 이미지 인수 근거도 필요합니다.',detail);
    const sources=el('div',undefined,detail); sources.className='sources';
    for (const option of row.options) {
      const column=el('section',undefined,sources);
      el('h3',option.decision==='USE_EPISODES'?'현재 episodes 원본':'대체 episode_contents 원본',column);
      el('p',option.blockedReasons.length?'선택 불가: '+option.blockedReasons.join(', '):'선택 가능 · 근거 필요',column);
      el('p',option.body===null?'NULL':option.body===''?'빈 문자열':option.body.length+' UTF-16 단위 · CR '+(option.body.match(/\r/g)||[]).length+' · LF '+(option.body.match(/\n/g)||[]).length,column);
      el('p',option.sha256,column).className='context';
      const body=el('pre',option.body===null?'[NULL]':option.body,column); body.className='body';
    }
    const choiceLabel=el('label','결정 ',detail), choice=el('select',undefined,choiceLabel); choice.id='review-choice';
    for (const [value,label] of [['PENDING','미검토'],['HOLD','보류'],['USE_EPISODES','현재 원본 선택'],['USE_EPISODE_CONTENTS','대체 원본 선택']]) {
      const option=el('option',label,choice); option.value=value;
      option.disabled=value.startsWith('USE_') && row.options.find(o=>o.decision===value).blockedReasons.length>0;
    }
    choice.value=saved.decision;
    const reviewerLabel=el('label','검토자 참조 (3~200자) ',detail), reviewer=el('input',undefined,reviewerLabel); reviewer.id='review-reviewer'; reviewer.maxLength=200; reviewer.value=saved.reviewerRef ?? '';
    const reasonLabel=el('label','근거/보류 사유 (10~500자) ',detail), reason=el('textarea',undefined,reasonLabel); reason.id='review-reason'; reason.maxLength=500; reason.value=saved.evidenceRef ?? '';
    form={choice,reviewer,reason,rights:saved.rightsEvidence,image:saved.imageEvidence};
    evidencePicker('rights','권리 근거',detail,row);
    if (row.contentType==='WEBTOON') evidencePicker('image','이미지 근거',detail,row);
    const saveButton=el('button','이 회차 결정 저장',detail); saveButton.id='review-save';
    saveButton.addEventListener('click',()=>{try{save();renderList();status.textContent='메모리에 저장했습니다. 세션을 내려받아 보관하세요.';}catch(error){reportError(error);}});
  }
  for (const control of [search,filter]) control.addEventListener('input',()=>{try{save();renderList();}catch(error){reportError(error);}});
  clearButton.addEventListener('click',()=>{edits.clear();active=null;form=null;detail.replaceChildren();renderList();status.textContent='메모리의 검토를 비웠습니다. 기존 파일은 바뀌지 않습니다.';});
  importInput.addEventListener('change',async()=>{
    try {
      if (edits.size || active) throw Error('WORKBENCH_CLEAR_BEFORE_IMPORT');
      const file=importInput.files?.[0]; if(!file || file.size>4*1024*1024) throw Error('WORKBENCH_SESSION_SIZE');
      const imported=core.validateSession(model,JSON.parse(await file.text()));
      if (edits.size || active) throw Error('WORKBENCH_CLEAR_BEFORE_IMPORT');
      for (const decision of imported.decisions) if(decision.decision!=='PENDING') edits.set(decision.episodeId,decision);
      renderList(); status.textContent='같은 백업의 세션을 가져왔습니다. 실제 근거 파일은 CLI에서 재검증하세요.';
    } catch(error) { reportError(error); }
  });
  exportButton.addEventListener('click',()=>{
    try {
      save(); const output=core.validateSession(model,core.session(model,[...edits.values()]));
      const url=URL.createObjectURL(new Blob([JSON.stringify(output,null,2)+'\n'],{type:'application/json'}));
      const link=el('a',undefined,root); link.href=url; link.download='content-review-session.json'; link.click(); link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),0); renderList(); status.textContent='세션을 내려받았습니다. finalize 검증 전에는 승인 파일이 아닙니다.';
    } catch(error) { reportError(error); }
  });
  renderList();
})();
