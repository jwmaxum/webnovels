// No identity evidence in URLs/localStorage. Resume from the authenticated server state.
(function () {
 'use strict';
 let root=null,documents=[],attempt=null,completed=false,enabled=false,busy=false,epoch=0,requestKey=null,sdkFlight=null,mode=null;
 const el=id=>root?.querySelector('[data-enrollment="'+id+'"]');
 const api=(action,data)=>window.WebNovelsAuth.api('/api/v2/onboarding/author/'+action,
  data===undefined?{}:{method:'POST',body:JSON.stringify(data)});
 const message=text=>{if(el('message'))el('message').textContent=text;};
 function update(){
  if(!root)return;
  el('start').disabled=busy||!enabled||completed;
  el('verify').disabled=busy||!enabled||!attempt||!['PENDING','VERIFIED'].includes(attempt.status);
  el('cancel').disabled=busy||!attempt||!['PENDING','VERIFIED'].includes(attempt.status);
  root.dataset.verified=String(mode!=='FREE_BETA'&&(completed||attempt?.status==='VERIFIED'));
  root.dataset.enrollmentMode=mode||'';
 }
 function rights(){return documents.find(d=>d.id===(el('basis').value==='OWN'?'copyright-own':'copyright-licensed'));}
 function renderDocument(){const d=rights();el('rightsText').textContent=d?d.text+' (버전 '+d.version+')':'';
  el('rights').checked=false;requestKey=null;}
 async function sdk(){
  if(window.PortOne?.requestIdentityVerification)return window.PortOne;
  if(!sdkFlight)sdkFlight=new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src='https://cdn.portone.io/v2/browser-sdk.js';script.async=true;
   script.onload=()=>window.PortOne?.requestIdentityVerification?resolve(window.PortOne):reject(new Error('본인확인 창을 불러오지 못했습니다. 다시 시도해주세요.'));
   script.onerror=()=>{script.remove();reject(new Error('본인확인 SDK 연결을 확인해주세요.'));};document.head.appendChild(script);
  }).catch(e=>{sdkFlight=null;throw e;});return sdkFlight;
 }
 async function run(fn){if(busy)return;busy=true;update();const ownEpoch=epoch;
  try{await fn(ownEpoch);}catch(e){if(ownEpoch===epoch)message(window.WebNovelsAuth.message(e));}
  finally{if(ownEpoch===epoch){busy=false;update();}}}
 async function verify(ownEpoch){
  if(!attempt)throw new Error('먼저 본인확인을 시작해주세요.');
  const result=await api('verify',{attemptId:attempt.id});if(ownEpoch!==epoch)return;
  attempt=result.attempt;completed=result.completed;
  message(attempt?.mode==='TEST'?'TEST 인증 결과입니다. 실제 작가 가입에는 사용할 수 없습니다.':
   '서버에서 본인확인을 마쳤습니다. 필명을 확인하고 가입 완료를 눌러주세요.');
 }
 function mount(container){
  reset();root=container;root.innerHTML=`<fieldset class="author-enrollment-panel">
   <legend data-enrollment="heading">작가 권리 확약 및 PASS 본인확인</legend>
   <p data-enrollment="intro">확인한 이메일 → 권리 동의 → PASS 본인확인 → 필명 등록 순서로 진행합니다. 같은 본인도 별도 이메일 ID와 필명으로 가입할 수 있습니다. 각 계정의 작품 권한은 분리됩니다.</p>
   <label>게재할 작품의 권리 관계 <select data-enrollment="basis" class="form-control"><option value="OWN">본인이 창작하고 저작권을 보유한 작품</option><option value="LICENSED">공동 창작·각색·정당한 이용허락 작품</option></select></label>
   <details open><summary>저작권·비도용·법적 책임 확약</summary><p data-enrollment="rightsText"></p></details>
   <label class="author-consent"><input type="checkbox" data-enrollment="rights"> [필수] 선택한 권리 확약을 읽고 동의합니다.</label>
   <div data-enrollment="identitySection"><details><summary>본인확인 개인정보 수집·이용 안내</summary><p data-enrollment="privacyText"></p></details>
   <label class="author-consent"><input type="checkbox" data-enrollment="privacy"> [필수] 개인정보 수집·이용에 동의합니다.</label>
   <div class="author-enrollment-actions"><button type="button" class="btn btn-primary" data-enrollment="start">동의하고 PASS 인증</button>
   <button type="button" class="btn btn-outline" data-enrollment="verify">인증 결과 다시 확인</button>
   <button type="button" class="btn btn-ghost" data-enrollment="cancel">인증 시도 취소</button></div></div>
   <p data-enrollment="message" role="status" aria-live="polite"></p></fieldset>`;
  el('basis').onchange=renderDocument;
  el('start').onclick=()=>run(async ownEpoch=>{
   if(!el('rights').checked||!el('privacy').checked)throw new Error('저작권 확약과 개인정보 동의를 각각 선택해주세요.');
   const d=rights(),p=documents.find(d=>d.id==='identity-privacy');
   requestKey=requestKey||crypto.randomUUID();
   const r=await api('start',{requestKey,rightsBasis:el('basis').value,rightsAccepted:true,privacyAccepted:true,
    documentVersion:d.version,documentHash:d.hash,privacyVersion:p.version,privacyHash:p.hash});
   if(ownEpoch!==epoch)return;attempt=r.attempt;
   if(attempt.status!=='PENDING'){requestKey=null;throw new Error('이전 인증 시도가 종료되었습니다. 다시 시작해주세요.');}
   message('PASS 인증을 완료한 뒤 이 화면으로 돌아와 주세요.');
   const provider=await sdk();if(ownEpoch!==epoch)return;
   const result=await provider.requestIdentityVerification(r.request);if(ownEpoch!==epoch)return;
   if(result?.code){message('인증이 완료되지 않았습니다. 다시 시도하거나 인증 결과 다시 확인을 눌러주세요.');return;}
   await verify(ownEpoch);
  });
  el('verify').onclick=()=>run(verify);
  el('cancel').onclick=()=>run(async ownEpoch=>{await api('cancel',{attemptId:attempt.id});if(ownEpoch!==epoch)return;
   attempt=null;requestKey=null;message('인증 시도를 취소했습니다. 동의 후 다시 시작할 수 있습니다.');});
  update();return load();
 }
 async function load(){const ownEpoch=epoch;message('작가 가입 방식을 확인하고 있습니다.');
  try{
   const response=await fetch('/api/v2/onboarding/author/policy',{credentials:'omit',signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error('작가 가입을 준비 중입니다. 잠시 후 다시 확인해주세요.');
   const policy=await response.json();if(ownEpoch!==epoch)return;documents=policy.documents;enabled=policy.enabled;mode=policy.mode;
   renderDocument();const p=documents.find(d=>d.id==='identity-privacy');el('privacyText').textContent=p?p.text+' (버전 '+p.version+')':'';
   if(mode==='FREE_BETA'){
    el('heading').textContent='무료 베타 작가 가입';
    el('intro').textContent='이메일 확인과 아래 저작권 동의 후 필명으로 바로 가입할 수 있습니다. 웹소설과 웹툰을 모두 무료로 연재할 수 있습니다. PASS 실명 인증은 아직 제공하지 않으며 본인확인 완료 표시를 부여하지 않습니다. 별도 이메일 ID와 필명 가입이 가능하며 각 계정의 작품은 분리됩니다.';
    el('identitySection').hidden=true;
    if(!enabled){message('무료 베타 가입을 준비 중입니다. 잠시 후 다시 확인해주세요.');return;}
    const state=await api('status');if(ownEpoch!==epoch)return;completed=state.completed;
    message(completed?'이 계정의 무료 베타 가입이 완료되어 있습니다.':'권리 확약을 읽고 동의한 뒤 필명을 확인하고 가입 완료를 눌러주세요.');return;
   }
   if(!enabled){message('PASS 계약·개인정보 안내 확인 후 작가 가입이 열립니다. 기존 계정의 원고 작성·저장·백업은 계속 이용할 수 있습니다.');return;}
   const state=await api('status');if(ownEpoch!==epoch)return;attempt=state.attempt;completed=state.completed;
   message(completed?'이 계정의 권리 동의와 본인확인이 완료되어 있습니다.':state.existingAuthor?
    '기존 필명과 작품을 유지하며 추가 인증합니다. 다른 계정의 작품은 합쳐지지 않습니다.':
    attempt?.status==='VERIFIED'?'확인된 인증이 있습니다. 필명을 확인하고 가입을 완료해주세요.':'필수 동의 후 PASS 인증을 진행해주세요.');
   if(attempt?.status==='PENDING'&&new URLSearchParams(location.search).get('auth')==='author-identity')await run(verify);
  }catch(e){if(ownEpoch===epoch)message(window.WebNovelsAuth.message(e));}finally{if(ownEpoch===epoch)update();}
 }
 async function complete(displayName){
  if(busy)throw new Error('인증 결과를 확인 중입니다. 잠시 기다려주세요.');
  if(completed)return window.WebNovelsAuth.validate();
  if(mode==='FREE_BETA'){
   if(!enabled)throw new Error('무료 베타 가입을 준비 중입니다.');
   if(!el('rights')?.checked)throw new Error('저작권 확약을 읽고 동의해주세요.');
   const d=rights(),ownEpoch=epoch;busy=true;update();
   try{await api('complete',{displayName,rightsBasis:el('basis').value,rightsAccepted:true,documentVersion:d.version,documentHash:d.hash});
    if(ownEpoch!==epoch)throw new Error('계정이 변경되었습니다.');completed=true;return await window.WebNovelsAuth.validate();
   }finally{if(ownEpoch===epoch){busy=false;update();}}return;
  }
  if(!attempt||attempt.status!=='VERIFIED')throw new Error('필수 동의와 PASS 본인확인을 먼저 완료해주세요.');
  const ownEpoch=epoch;busy=true;update();
  try{await api('complete',{attemptId:attempt.id,displayName});if(ownEpoch!==epoch)throw new Error('계정이 변경되었습니다.');
   completed=true;return await window.WebNovelsAuth.validate();
  }finally{if(ownEpoch===epoch){busy=false;update();}}
 }
 function reset(){epoch++;documents=[];attempt=null;completed=false;enabled=false;busy=false;requestKey=null;mode=null;
  if(root){el('rights').checked=false;el('privacy').checked=false;message('가입 화면을 다시 열어 현재 계정의 인증 상태를 확인해주세요.');update();}root=null;}
 window.AuthorEnrollment={mount,complete,reset};
})();
