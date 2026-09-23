/* UI adapter. Identity and snapshots live in DraftEngine, never in the work selector. */
(function() {
  'use strict';
  const $=id=>document.getElementById(id), fields={title:'newEpTitle',content:'newEpContent',authorComment:'newEpAuthorComment'};
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let timer,remoteTimer,composing=false,epoch=0,selected=null,works=[];
  const actor=()=>window.WebNovelsAuth?.getActor(), toast=m=>window.showToast?.(m);
  function error(e) {
    const message=e.code==='AUTHOR_DRAFTS_NOT_ACTIVATED'?'서버 원고 저장 기능이 아직 활성화되지 않았습니다.':e.code==='DRAFT_CONFLICT'?'다른 곳에서 수정한 원고가 있습니다. 양쪽 내용을 비교해주세요.':'저장 또는 불러오기에 실패했습니다. 원고를 다운로드하고 다시 시도해주세요.';
    toast(message);if($('creatorDraftError'))$('creatorDraftError').textContent=message;
  }
  const safe=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(error);
  function data(){return Object.fromEntries(Object.entries(fields).map(([k,id])=>[k,$(id)?.value||'']));}
  function form(value={},readOnly=engine.current?.lifecycle!=='ACTIVE'){for(const [k,id]of Object.entries(fields))if($(id)){$(id).value=value[k]||'';$(id).disabled=readOnly;}counts();}
  function counts(){const s=$('newEpContent')?.value||'';if($('creatorWordCount'))$('creatorWordCount').textContent=`공백 포함 ${s.length}자 · 제외 ${s.replace(/\s/g,'').length}자`;if($('creatorWordProgress'))$('creatorWordProgress').style.width=Math.min(100,s.length/45)+'%';}
  async function api(action,args) {
    if(args.userId && actor()?.userId!==args.userId)throw Object.assign(Error('SESSION_CHANGED'),{code:'SESSION_CHANGED'});
    const path='/api/v2/creator/drafts'+(args.id?'/'+args.id:'')+(action==='history'?'/history':'')+'?workId='+encodeURIComponent(args.workId)+(args.before?'&before='+args.before:'');
    return window.WebNovelsAuth.api(path,action==='save'?{method:'PUT',headers:{'Idempotency-Key':args.key},body:JSON.stringify(args.data)}:{});
  }
  function status(c) {
    if(actor()?.userId!==c.userId)return;
    $('creatorDraftStatus').textContent=c.conflict?'충돌 · 양쪽 사본 보존':c.error?'저장 실패 · 다운로드 가능':c.localSeq<c.seq?'기기에 저장 중…':c.serverSeq<c.seq?'기기 저장 완료 · 서버 미동기화':'기기·서버 저장 완료';
    $('draftConflict').hidden=!c.conflict;
    $('draftIdentity').textContent=`원고 ${c.id} · 서버 버전 ${c.revision}${c.lifecycle!=='ACTIVE'?' · 보관 원고 (읽기 전용)':''}`;
  }
  const engine=new DraftEngine({store:DraftStore,api,uuid:()=>crypto.randomUUID(),onChange:status});
  function stop(){clearTimeout(timer);clearTimeout(remoteTimer);}
  function schedule(c=engine.current){if(!c||composing)return;stop();timer=setTimeout(safe(()=>engine.flush(c)),700);remoteTimer=setTimeout(safe(async()=>{await engine.sync(c);if(engine.current===c&&c.seq>c.serverSeq&&!c.conflict)schedule(c);}),2500);}
  function input(){if(engine.current){engine.edit(data());counts();schedule();}}
  async function loadWorks(){
    const user=actor()?.userId;if(!user||!actor()?.author)throw Error('AUTHOR_REQUIRED');
    let all=[],after='0';do{const r=await window.WebNovelsAuth.api('/api/v2/creator/works?after='+after);all.push(...r.works);after=r.nextCursor;}while(after);
    if(actor()?.userId!==user)throw Error('SESSION_CHANGED');works=all;
    $('newEpWorkSelect').innerHTML='<option value="">작품을 선택해주세요</option>'+all.filter(w=>!w.trashed_at).map(w=>`<option value="${esc(w.id)}">${esc(w.title)}</option>`).join('');
  }
  async function openWork(workId,id=null,{fresh=false,record=null,localOnly=false}={}) {
    const turn=++epoch,user=actor()?.userId;if(!user)throw Error('AUTHOR_REQUIRED');
    stop();await engine.checkpoint();selected=null;window.closeModal?.('modalDraftDiff');
    if(!works.some(w=>w.id===String(workId)))await loadWorks();
    const work=works.find(w=>w.id===String(workId));if(!work)throw Error('WORK_NOT_FOUND');
    if(turn!==epoch||user!==actor()?.userId)return;
    if(!id&&!fresh)id=[...engine.contexts.values()].find(c=>c.userId===user&&c.workId===String(workId)&&c.lifecycle==='ACTIVE')?.id||null;
    const c=await engine.open(user,String(workId),id,{localOnly});
    if(!c||turn!==epoch||user!==actor()?.userId)return;
    if(record)await engine.recover(record);
    if(turn!==epoch||user!==actor()?.userId)return;
    window.switchCreatorTab?.('new-ep',false);$('newEpWorkSelect').value=String(workId);
    form(c.snapshot,c.lifecycle!=='ACTIVE'||work.moderation_state!=='CLEAR'||!!work.trashed_at);
    history.replaceState(null,'','/creator/episodes?work='+workId+'&draft='+c.id);status(c);
    $('creatorDraftError').textContent='';if(record)schedule(c);await listCopies(c);$('newEpTitle')?.focus();
  }
  async function listCopies(c=engine.current) {
    if(!c)return;const turn=epoch;
    const local=await DraftStore.heads(c.userId,c.workId);
    if(turn!==epoch||actor()?.userId!==c.userId)return;
    const box=$('draftCopies');box.replaceChildren();
    if($('draftCopyDetails'))$('draftCopyDetails').open=local.some(r=>r.branch!==c.branch&&r.seq>r.serverSeq);
    function button(label,fn){const b=document.createElement('button');b.type='button';b.className='btn btn-outline btn-sm';b.textContent=label;b.onclick=safe(fn);box.append(b);}
    for(const row of local.filter(r=>r.branch!==c.branch))button('기기 사본 복구: '+(row.snapshot.title||'무제')+' · '+row.id.slice(0,8),async()=>{
      if(!window.confirm('현재 원고를 먼저 백업한 뒤 이 사본을 복구합니다. 계속할까요?'))return;
      if(row.id===engine.current?.id){await engine.recover(row);form(engine.current.snapshot);status(engine.current);schedule();}
      else {
        await openWork(row.workId,row.id,{record:row,localOnly:true});
      }
    });
    try {
      const result=await api('list',{workId:c.workId,userId:c.userId});if(turn!==epoch||actor()?.userId!==c.userId)return;
      for(const row of result.drafts)button('서버 원고: '+(row.title||'무제')+' · '+row.lifecycle,()=>openWork(c.workId,row.id));
    }catch(e){if(turn===epoch)error(e);}
    const legacy=await DraftStore.legacy(actor()?.author?.id,c.workId);
    if(turn!==epoch||actor()?.userId!==c.userId)return;
    for(const row of legacy)button('이전 편집기 원고 가져오기: '+(row.title||row.key),async()=>{
      const verified=await window.WebNovelsAuth.api('/api/v2/creator/works/'+c.workId);
      if(!verified.work||actor()?.userId!==c.userId)throw Error('OWNER_MISMATCH');
      const imported=await DraftStore.importLegacy(c.userId,actor().author.id,c.workId,row);
      // Stable mapping survives repeated imports; never delete the source.
      let localOnly=false;try{await api('get',{workId:c.workId,id:imported.id,userId:c.userId});}catch(e){if(e.status===404)localOnly=true;else throw e;}
      await openWork(c.workId,imported.id,{record:imported,localOnly});
    });
  }
  async function save(){const c=engine.current;if(!c)throw Error('작품을 선택해주세요.');await engine.flush(c);await engine.sync(c);if(c.seq>c.serverSeq)schedule(c);}
  async function preparePublication(){
    const c=engine.current,user=actor()?.userId;
    if(!c||!user||c.userId!==user||c.lifecycle!=='ACTIVE'||c.conflict)throw Error('PUBLISH_DRAFT_UNAVAILABLE');
    stop();await engine.flush(c);
    for(let attempt=0;attempt<3&&c.serverSeq<c.seq;attempt++)await engine.sync(c);
    if(c!==engine.current||actor()?.userId!==user||c.serverSeq!==c.seq||c.pending||c.conflict||c.revision==='0')
      throw Error('PUBLISH_SAVE_REQUIRED');
    const remote=(await api('get',{workId:c.workId,id:c.id,userId:user})).draft;
    if(remote.revision!==c.revision||remote.lifecycle!=='ACTIVE'||
       ['title','content','authorComment'].some(k=>remote[k]!==c.snapshot[k]))
      throw Error('PUBLISH_REVISION_CONFLICT');
    return JSON.parse(JSON.stringify({userId:user,workId:c.workId,id:c.id,revision:c.revision,
      episodeId:remote.episodeId,seq:c.seq,snapshot:c.snapshot}));
  }
  async function markPublished(expected){
    const c=engine.current;
    if(!c||c.id!==expected.id||c.workId!==expected.workId||c.userId!==expected.userId)return;
    c.lifecycle='PUBLISHED';stop();await engine.flush(c);form(c.snapshot,true);status(c);
  }
  function download(c=engine.current){if(!c)return;const blob=new Blob([JSON.stringify({workId:c.workId,draftId:c.id,revision:c.revision,...c.snapshot},null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='원고-'+c.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function exportLegacy(){
    const user=actor(),workId=$('newEpWorkSelect').value;if(!user?.author||!workId)throw Error('AUTHOR_REQUIRED');
    await window.WebNovelsAuth.api('/api/v2/creator/works/'+workId);
    const value=await DraftStore.exportLegacy(user.author.id,workId);if(actor()?.userId!==user.userId)throw Error('SESSION_CHANGED');
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='이전-원고-'+workId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function transform(kind) {
    const c=engine.current;if(!c||composing)return;let content=c.snapshot.content;
    if(kind==='indent')content=content.split('\n').map(l=>!l.trim()?'':['"','“','‘',"'",'「','『','(','['].some(q=>l.trimStart().startsWith(q))?l.trimStart():'  '+l.trimStart()).join('\n');
    if(kind==='dialogue')content=content.split('\n').map(l=>/^["“‘'「『]/.test(l.trim())?'\n'+l.trim()+'\n':l).join('\n').replace(/\n{3,}/g,'\n\n');
    if(kind==='clean')content=content.replace(/[ \t]+$/gm,'').replace(/\n{3,}/g,'\n\n');
    await engine.replace({...c.snapshot,content},'before-format');if(engine.current===c){form(c.snapshot);schedule(c);}
  }
  function compare(value) {
    selected=value;const current=engine.current?.snapshot||{};
    $('diffPreviewHeader').textContent='선택한 사본 → 현재 원고 (복구 직전 원고도 보존됩니다)';
    $('diffSectionsContainer').innerHTML=['title','content','authorComment'].map(k=>`<h4>${esc({title:'제목',content:'본문',authorComment:'작가의 말'}[k])}</h4>`+draftLineDiff(value[k]||'',current[k]||'').map(d=>`<div class="diff-line-row diff-type-${d.type}"><span>${d.type==='ins'?'+':d.type==='del'?'−':' '} ${esc(d.text)}</span></div>`).join('')).join('');
    $('btnConfirmRestoreRevision').disabled=engine.current?.lifecycle!=='ACTIVE';
  }
  async function openDiffModal(){
    const c=engine.current;if(!c)return;await engine.flush(c);
    const rows=(await DraftStore.history(c)).map(r=>({label:r.reason,value:r.snapshot}));
    if(c.conflict)rows.unshift({label:'충돌한 서버 사본',value:c.conflict});
    try{if(c.revision!=='0'){let before='0';do{const r=await api('history',{workId:c.workId,id:c.id,userId:c.userId,before});rows.push(...r.revisions.map(v=>({label:'서버 버전 '+v.revision,value:v})));before=r.revisions.length===20?r.revisions.at(-1).revision:null;}while(before);}}catch(e){error(e);}
    if(engine.current!==c||actor()?.userId!==c.userId)return;selected=null;
    $('diffVersionList').replaceChildren();rows.forEach(r=>{const b=document.createElement('button');b.type='button';b.textContent=r.label;b.className='diff-version-card';b.onclick=()=>compare(r.value);$('diffVersionList').append(b);});
    $('btnConfirmRestoreRevision').disabled=true;$('diffSectionsContainer').textContent=rows.length?'비교할 버전을 선택해주세요.':'저장한 버전이 없습니다.';
    window.openModal?.('modalDraftDiff');
  }
  async function beforeAccountChange(){stop();await engine.checkpoint();if(engine.current&&engine.current.seq>engine.current.serverSeq)toast('서버 미동기 원고는 이 기기에 보존됩니다. 같은 계정으로 로그인해 기기 사본을 복구해주세요.');}
  function onAuthLost(){stop();epoch++;const c=engine.detach();works=[];selected=null;form({},true);
    window.CreatorFiles?.reset();
    window.CreatorPublications?.reset();
    for(const id of ['newEpWorkSelect','draftCopies','diffVersionList','diffSectionsContainer','diffPreviewHeader','draftIdentity','creatorDraftError'])if($(id))$(id).replaceChildren();
    if($('draftConflict'))$('draftConflict').hidden=true;if($('creatorDraftStatus'))$('creatorDraftStatus').textContent='로그인 후 원고를 복구할 수 있습니다.';
    window.closeModal?.('modalDraftDiff');
    if(c){toast('세션이 종료되어 원고 화면을 닫았습니다. 원고는 같은 계정의 기기 사본으로 보존합니다.');engine.flush(c).catch(()=>{download(c);toast('기기 저장 실패로 원고 백업 다운로드를 요청했습니다. 다운로드를 확인해주세요.');});}
  }
  async function enter(){if(!works.length)await loadWorks();const params=new URLSearchParams(location.search);if(params.get('work')){
    const id=params.get('draft');let localOnly=false;
    if(id)try{await api('get',{workId:params.get('work'),id});}catch(e){
      const saved=await DraftStore.heads(actor()?.userId,params.get('work'));
      if(e.status===404||saved.some(r=>r.id===id))localOnly=true;else throw e;
    }
    await openWork(params.get('work'),id,{localOnly});
  }else if(engine.current){$('newEpWorkSelect').value=engine.current.workId;form(engine.current.snapshot);status(engine.current);}else form({},true);}
  function initialize(){
    form({},true);for(const id of Object.values(fields)){$(id)?.addEventListener('input',input);$(id)?.addEventListener('compositionstart',()=>{composing=true;stop();});$(id)?.addEventListener('compositionend',()=>{composing=false;input();});}
    $('newEpWorkSelect')?.addEventListener('change',safe(async()=>{const id=$('newEpWorkSelect').value;if(!id){$('newEpWorkSelect').value=engine.current?.workId||'';return;}try{await openWork(id);}catch(e){$('newEpWorkSelect').value=engine.current?.workId||id;throw e;}}));
    const bind=(id,fn)=>$(id)?.addEventListener('click',safe(fn));
    bind('btnDraftDownload',()=>download());bind('btnLegacyDraftExport',exportLegacy);bind('btnDraftNew',()=>openWork(engine.current?.workId||$('newEpWorkSelect').value,null,{fresh:true}));
    bind('btnDraftRefresh',()=>listCopies());bind('btnSaveDraftVersion',async()=>{const c=engine.current;if(c)await DraftStore.backup(c,c.snapshot,'manual');});
    bind('btnRestoreDraftVersion',openDiffModal);bind('btnConfirmRestoreRevision',async()=>{if(selected){await engine.replace(selected);form(engine.current.snapshot);schedule();window.closeModal?.('modalDraftDiff');}});
    bind('btnFormatIndent',()=>transform('indent'));bind('btnFormatDialogue',()=>transform('dialogue'));bind('btnFormatClean',()=>transform('clean'));
    bind('btnDraftUndo',async()=>{if(engine.current?.undo){await engine.replace(engine.current.undo,'before-undo');form(engine.current.snapshot);schedule();}});
    bind('btnConflictCompare',openDiffModal);for(const [id,keep]of [['btnConflictLocal',true],['btnConflictRemote',false]])bind(id,async()=>{await engine.resolve(keep);form(engine.current.snapshot);status(engine.current);});
    bind('btnDraftFocus',()=>{$('creatorTab-new-ep').classList.toggle('draft-focus');$('newEpContent').focus();});
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'&&engine.current){e.preventDefault();safe(save)();}if(e.key==='Escape')$('creatorTab-new-ep')?.classList.remove('draft-focus');});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)safe(()=>engine.checkpoint())();});
    window.addEventListener('online',safe(async()=>{for(const c of engine.contexts.values())await engine.sync(c);}));
    window.addEventListener('beforeunload',e=>{if([...engine.contexts.values()].some(c=>c.seq>c.localSeq)){e.preventDefault();e.returnValue='';}});
    window.visualViewport?.addEventListener('resize',()=>{document.documentElement.style.setProperty('--draft-viewport',window.visualViewport.height+'px');if(document.activeElement===$('newEpContent'))$('newEpContent').scrollIntoView({block:'nearest'});});
  }
  window.CreatorDraftEditor={openWork:safe(openWork),enter:safe(enter),save:safe(save),syncServer:safe(save),download,openDiffModal:safe(openDiffModal),beforeAccountChange,onAuthLost,
    preparePublication,markPublished,startNext:workId=>openWork(workId,null,{fresh:true}),
    getFileContext:()=>engine.current?JSON.parse(JSON.stringify({userId:engine.current.userId,workId:engine.current.workId,id:engine.current.id,seq:engine.current.seq,snapshot:engine.current.snapshot})):null,
    replaceFromFile:async(snapshot,expected)=>{
      const c=engine.current;if(!c||c.id!==expected.id||c.seq!==expected.seq||c.userId!==expected.userId||c.workId!==expected.workId)throw Error('EDIT_CHANGED_DURING_IMPORT');
      stop();await engine.replace(snapshot,'before-file-import');if(engine.current!==c)throw Error('SESSION_CHANGED');form(c.snapshot);schedule(c);
    },
    checkpoint:()=>{epoch++;engine.cancelLoads();selected=null;window.closeModal?.('modalDraftDiff');return safe(()=>engine.checkpoint())();},clearCurrentDraft:async()=>{throw Error('발행된 원고도 보존합니다. 새 원고를 시작해주세요.');}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize);else initialize();
})();
