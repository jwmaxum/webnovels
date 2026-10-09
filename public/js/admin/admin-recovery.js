(function(){
 'use strict';
 const actor=()=>window.WebNovelsAuth?.getActor(),active=()=>window.WEBNOVELS_CONFIG?.adminRecoveryReviewEnabled===true;
 const can=p=>actor()?.admin?.role==='SUPER_ADMIN'||actor()?.admin?.permissions?.includes(p);
 const labels={PENDING:'검토 대기',HOLD:'자료 보완·보류',REJECTED:'반려',READY_FOR_RESTORE_REVIEW:'후속 복원 검증 준비'};
 let generation=0,host=null,currentContext=null;
 const current=c=>c===currentContext&&c.generation===generation&&c.user===actor()?.userId&&c.isCurrent();
 function el(p,t,text){const n=document.createElement(t);if(text!=null)n.textContent=String(text);p.append(n);return n;}
 function button(p,label,fn){const n=el(p,'button',label);n.type='button';n.className='btn btn-outline btn-sm';n.onclick=fn;return n;}
 function field(p,label,type='textarea'){el(p,'label',label);const n=el(p,type);n.setAttribute('aria-label',label);return n;}
 function status(p,text){const n=el(p,'p',text);n.setAttribute('role','status');return n;}
 const query=(action,data={})=>'/api/v2/admin/workflow?'+new URLSearchParams({action,...data});
 async function api(c,action,data,blob=false){
  if(!current(c))throw Error('SESSION_CHANGED');
  return window.WebNovelsAuth.api(query(action,action==='recovery-detail'?data:{}),action==='recovery-detail'?undefined:{method:'POST',body:JSON.stringify(data),...(blob?{responseType:'blob'}:{})});
 }
 const storageKey=c=>'webnovels:recovery-review:'+c.user+':'+c.id;
 function load(c){try{const p=JSON.parse(sessionStorage.getItem(storageKey(c)));return p?.data?.recoveryId===c.id&&['recovery-decide','recovery-source'].includes(p.action)?p:null;}catch{return null;}}
 function save(c,p){sessionStorage.setItem(storageKey(c),JSON.stringify(p));}
 function clear(c){sessionStorage.removeItem(storageKey(c));}
 function reset(){generation++;currentContext=null;if(host)host.replaceChildren();host=null;}
 async function detail(c){
  if(c.generation!==generation||c.user!==actor()?.userId||!c.isCurrent())return;
  c.generation=++generation;currentContext=c;c.access=null;
  host.replaceChildren();status(host,'복구 요청을 확인하는 중입니다…');
  try{const d=await api(c,'recovery-detail',{recoveryId:c.id});if(!current(c))return;c.detail=d;show(c);}
  catch(e){if(current(c)){host.replaceChildren();status(host,'조회 실패: '+(e.code||e.message));button(host,'다시 확인',()=>detail(c));}}
 }
 function show(c){
  host.replaceChildren();const d=c.detail,r=d.request;
  el(host,'h3','원고 복구 검토');status(host,'이 결정은 검토 의견입니다. 회차 복원·권리 승인·공개는 별도 절차로 진행합니다.');
  el(host,'p',`요청 ${r.id} · 작품 ${r.workId} · ${r.episodeNumber}화 · 제출 버전 ${r.revision} · 원본 연결 버전 ${r.sourceRevision}`);
  el(host,'p',`원본 SHA-256 ${r.fileSha256}`);el(host,'p',d.note);
  status(host,d.eligible?'제출 대상과 원본 연결이 유지되고 있습니다.':'현재 소유권·상태·원본 또는 대상이 변경되었습니다. 원고 열람과 준비 결정은 제한됩니다.');
  for(const h of d.history)el(host,'p',`${labels[h.status]||h.status} · 검토 버전 ${h.revision} · ${h.reason} · ${h.createdAt}`);
  c.privateArea=el(host,'section');const feedback=status(host,c.error||'');
  const pending=load(c);
  async function dispatch(p){
   if(c.busy||!current(c))return;c.busy=true;host.querySelectorAll('button,input,textarea,select').forEach(n=>n.disabled=true);
   try{
    // Persist metadata only before dispatch. No source, file bytes, URL or token enters storage.
    save(c,p);const result=await api(c,p.action,p.data,p.action==='recovery-source'&&p.data.kind==='original');
    clear(c);if(!current(c))return;
    if(p.action==='recovery-decide'){c.busy=false;await detail(c);return;}
    c.error=null;c.definitive=false;show(c);
    if(p.data.kind==='manuscript'){
     c.access=result.accessId;c.privateArea.replaceChildren();el(c.privateArea,'h4',`제출 버전 ${result.revision} · ${result.title}`);el(c.privateArea,'pre',result.content);el(c.privateArea,'p',result.authorComment);
     button(c.privateArea,'원고 닫기',()=>c.privateArea.replaceChildren());status(c.privateArea,'제출 당시 원고를 열람했습니다. 현재 편집본과 구분해주세요.');
    }else{
     const url=URL.createObjectURL(result);try{const a=el(c.privateArea,'a','검증된 원본 다운로드');a.href=url;a.download='recovery-original.bin';a.click();a.remove();}finally{URL.revokeObjectURL(url);}
     status(c.privateArea,'서버가 요청의 원본 SHA-256과 크기를 확인했습니다. 권리 증명은 별도로 필요합니다.');
    }
   }catch(e){if(current(c)){c.error='결과 미확인: '+(e.code||e.message)+'. 동일 요청으로 다시 확인해주세요.';
    c.definitive=e.status===400||e.status===409&&['RECOVERY_CONTEXT_CHANGED','RECOVERY_REVIEW_CONFLICT','RECOVERY_SOURCE_UNAVAILABLE','RECOVERY_EVIDENCE_REQUIRED','RECOVERY_FILE_CHECKSUM_MISMATCH'].includes(e.code||e.message);
    show(c);
   }}finally{if(current(c)){c.busy=false;host.querySelectorAll('button,input,textarea,select').forEach(n=>n.disabled=false);}}
  }
  if(pending){status(host,'응답을 확인하지 못한 요청이 보존되어 있습니다. 당시 선택: '+(pending.data.decision||pending.data.kind)+' · 사유 '+pending.data.reason);button(host,'동일 요청 결과 확인',()=>dispatch(pending));
   if(c.definitive)button(host,'거절 결과 확인 후 최신 자료로 새 검토',()=>{clear(c);c.error=null;c.definitive=false;detail(c);});return;}
  if(actor()?.admin?.role==='SUPER_ADMIN'&&d.eligible){
   const reason=field(host,'비공개 자료 열람 사유 (3~500자)');reason.maxLength=500;
   for(const [kind,name] of [['manuscript','제출 원고 열람'],['original','원본 파일 확인·다운로드']])button(host,name,()=>dispatch({action:'recovery-source',data:{requestId:crypto.randomUUID(),reason:reason.value,recoveryId:c.id,contextDigest:d.contextDigest,kind}}));
  }
  if(can('CASE_RESOLVE')||can('CONTENT_REVIEW')){
   const form=el(host,'form'),decision=field(form,'검토 의견','select');
   for(const key of ['HOLD','REJECTED',...(actor()?.admin?.role==='SUPER_ADMIN'&&d.eligible?['READY_FOR_RESTORE_REVIEW']:[])]){const o=el(decision,'option',labels[key]);o.value=key;}
   decision.value='HOLD';const reason=field(form,'작가에게 전달할 사유 (3~500자)');reason.maxLength=500;
   const evidence=field(form,'검토 근거 참조·후속 확인 사항 (최대 2000자)');evidence.maxLength=2000;
   const checks={};for(const [key,label] of [['rightsChecked','권리 근거 직접 확인'],['ratingChecked','등급·유해성 검토'],['aiChecked','AI 사용 고지 검토']]){const n=field(form,label,'input');n.type='checkbox';checks[key]=n;}
   const confirm=field(form,'검토 의견을 저장하고 작가에게 전달합니다','input');confirm.type='checkbox';
   const submit=el(form,'button','검토 의견 저장');submit.type='submit';
   form.onsubmit=e=>{e.preventDefault();if(!confirm.checked){feedback.textContent='검토 의견 저장을 확인해주세요.';return;}
    return dispatch({action:'recovery-decide',data:{requestId:crypto.randomUUID(),recoveryId:c.id,contextDigest:d.contextDigest,revision:d.reviewRevision,decision:decision.value,reason:reason.value,evidence:evidence.value,accessId:c.access,
     rightsChecked:checks.rightsChecked.checked,ratingChecked:checks.ratingChecked.checked,aiChecked:checks.aiChecked.checked}});
   };
  }
 }
 async function render(root,options={}){
  reset();if(!active()||!(can('CASE_READ')||can('CONTENT_REVIEW')))return;host=root;
  const c={generation:++generation,user:actor()?.userId,isCurrent:options.isCurrent||(()=>true)};currentContext=c;
  status(root,'복구 검토 요청을 불러오는 중입니다…');const offset=options.offset||0;
  try{
   const result=await window.WebNovelsAuth.api(query('recovery-list',{offset}));if(!current(c))return;root.replaceChildren();el(root,'h3','원고 복구 요청 검토함');
   status(root,'작가의 비공개 제출을 검토합니다. 후속 복원 계획과 공개 승인은 별도입니다.');
   if(!result.requests.length)status(root,'복구 요청이 없습니다.');
   for(const r of result.requests){const card=el(root,'article');el(card,'p',`작품 ${r.workId} · ${r.episodeNumber}화 · ${labels[r.review?.status]||'검토 대기'}`);button(card,'요청 상세',()=>detail({...c,id:r.id}));}
   if(offset)button(root,'이전',()=>render(root,{...options,offset:Math.max(0,offset-50)}));if(result.hasMore)button(root,'다음',()=>render(root,{...options,offset:offset+50}));
  }catch(e){if(current(c)){root.replaceChildren();status(root,'조회 실패: '+(e.code||e.message));button(root,'다시 불러오기',()=>render(root,options));}}
 }
 window.AdminRecovery=Object.freeze({active,render,reset,leave:view=>{if(view!=='view-admin-cms')reset();}});
})();
