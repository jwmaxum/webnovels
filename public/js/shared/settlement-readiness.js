/* Preparation only: no transfer, no TEST balance promotion, no full bank number. */
(function(){
 'use strict';let generation=0,dispose=()=>{};
 const actor=()=>window.WebNovelsAuth?.getActor(),el=(p,t,v)=>{const n=document.createElement(t);if(v!==undefined)n.textContent=String(v);p.append(n);return n;};
 const button=(p,v,fn)=>{const b=el(p,'button',v);b.type='button';b.className='btn btn-outline';b.onclick=fn;return b;};
 const field=(p,label,type='text')=>{const l=el(p,'label'),s=el(l,'span',label),i=el(l,'input');l.className='payouts-field';i.type=type;i.autocomplete='off';return i;};
 const blockers={BANK_MISSING:'정산 계좌 등록 필요',IDENTITY_NOT_APPROVED:'신원 서류 확인 필요',BANK_REVIEW_REQUIRED:'현재 계좌 수동 확인 필요',LIVE_REVENUE_UNCONNECTED:'실제 결제·회차 소비의 수익 원장 연결 전',PAYOUT_RELEASE_NOT_APPROVED:'실제 지급 운영 전환 전'};
 const errors={SETTLEMENT_CONFLICT:'계좌·신원·검토 정보가 변경되었습니다. 새로 조회해주세요.',BANK_ALREADY_CONFIRMED:'이미 확인된 계좌입니다. 최신 상태를 조회해주세요.',SETTLEMENT_REAUTH_REQUIRED:'현재 관리자 비밀번호를 확인해주세요.',INDEPENDENT_REVIEW_REQUIRED:'본인 계좌는 다른 최고 관리자가 확인해야 합니다.',BANK_DOCUMENT_UNAVAILABLE:'증빙이 만료되었거나 조회할 수 없습니다.',BANK_PROOF_POLICY_REQUIRED:'은행 증빙 처리·보존 정책 설정이 필요합니다.',BANK_PROOF_POLICY_CHANGED:'증빙 정책이 변경되었습니다. 다시 조회해주세요.',INVALID_SETTLEMENT_IMAGE:'번호를 가린 JPEG/PNG를 확인해주세요. 메타데이터 없는 150KB 이하 이미지가 필요합니다.',RATE_LIMITED:'요청이 많습니다. 잠시 후 다시 확인해주세요.'};
 function reset(){generation++;dispose();dispose=()=>{};}
 async function render(parent,{admin=false,isCurrent=()=>true}={}){
  reset();const root=el(parent,'section'),seq=generation,user=actor()?.userId;
  let detailTurn=0,offset=0,query='',pending=null,privateInputs=[],url=null,timer=null;
  const allowed=()=>admin?actor()?.admin?.role==='SUPER_ADMIN'&&actor()?.admin?.is_active===true:actor()?.author?.status==='APPROVED';
  const valid=()=>seq===generation&&actor()?.userId===user&&allowed()&&isCurrent();
  function clearPrivate(){privateInputs.forEach(i=>{i.value='';});privateInputs=[];pending=null;if(url)URL.revokeObjectURL(url);url=null;clearTimeout(timer);}
  dispose=()=>{detailTurn++;clearPrivate();root.replaceChildren();};
  el(root,'h3','수동 정산 운영 준비');
  el(root,'p','관리자가 별도 송금한 뒤 완료를 기록하는 방식입니다. 아래는 계좌·증빙 준비 상태이며 지급 승인이나 송금 완료가 아닙니다.');
  if(!valid())return;
  if(window.WEBNOVELS_CONFIG?.settlementReadinessEnabled!==true){el(root,'p','운영 준비 기능 연결 전입니다. 실제 지급은 활성화되지 않았습니다.');return;}
  const status=el(root,'p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const controls=el(root,'div'),list=el(root,'div'),detail=el(root,'section');
  const request=(action,data={})=>window.WebNovelsAuth.api('/api/v2/'+(admin?'admin':'creator')+'/settlement-readiness',{method:'POST',body:JSON.stringify({action,...data})});
  const error=e=>errors[e?.code]||'결과를 확인하지 못했습니다. 같은 요청으로 다시 확인하거나 최신 내역을 조회해주세요.';
  function showFacts(p,f){
   el(p,'p','신원 서류: '+(f.identityApproved?'확인됨':'확인 전')+' · 계좌: '+(f.bankConfirmed?'관리자 수동 확인됨':'확인 전'));
   el(p,'p','실제 정산 가능 금액: 연결 전 · TEST 금액은 포함하지 않습니다.');
   const ul=el(p,'ul');for(const code of f.blockers||[])el(ul,'li',blockers[code]||'운영 확인 필요');
  }
  async function loadList(){
   const turn=++detailTurn;clearPrivate();detail.replaceChildren();status.textContent='작가 준비 상태를 조회 중입니다.';
   try{const r=await request('list',{query,offset});if(!valid()||turn!==detailTurn)return;
    list.replaceChildren();for(const row of r.items.slice(0,30)){const p=el(list,'article');el(p,'h4',row.penName+' · 작가 '+row.authorId);el(p,'p',row.facts.bankConfirmed?'계좌 확인됨 · 실수익 연결 전':'계좌 확인 필요 · 실수익 연결 전');button(p,'정산 준비 상세',()=>loadDetail(row.authorId));}
    if(!r.items.length)el(list,'p','검색 결과가 없습니다.');
    const prev=button(list,'이전 작가',()=>{offset=Math.max(0,offset-30);return loadList();});prev.disabled=offset===0;
    const next=button(list,'다음 작가',()=>{offset+=30;return loadList();});next.disabled=r.items.length<=30;
    status.textContent='작가 준비 상태를 조회했습니다.';
   }catch(e){if(valid()&&turn===detailTurn)status.textContent=error(e);}
  }
  async function loadDetail(authorId){
   const turn=++detailTurn;clearPrivate();detail.replaceChildren();status.textContent='준비 내역을 조회 중입니다.';
   const current=()=>valid()&&turn===detailTurn;
   try{const r=await request('detail',admin?{authorId}:{});if(!current())return;
    if(r.mode!=='PREPARATION'||r.canPay!==false||r.facts?.canPay!==false||r.facts?.sourceStatus!=='UNCONNECTED')throw Error('INVALID_RESPONSE');
    showFacts(detail,r.facts);if(r.bank)el(detail,'p',r.bank.bankName+' · '+r.bank.maskedNumber+' · 예금주 '+r.bank.holder);
    el(detail,'p','계좌 확인은 관리자의 증빙 대조 기록이며 금융기관 예금주 인증이나 PASS 인증을 대신하지 않습니다.');
    button(detail,'준비 내역 새로고침',()=>loadDetail(authorId));
    const snapshots=el(detail,'details');el(snapshots,'summary','기간별 준비 기록');
    for(const s of r.snapshots||[])el(snapshots,'p',s.period+' · '+(s.stale?'현재 정보와 달라 다시 확인 필요':'저장 당시와 동일')+' · 지급 불가');
    if(!admin){status.textContent='본인 준비 내역입니다.';return;}
    const period=field(detail,'정산 준비 대상 월','month');period.value=new Date().toISOString().slice(0,7);period.min='2000-01';period.max=period.value;
    const password=field(detail,'계좌 확인·증빙 열람용 관리자 비밀번호','password');password.autocomplete='current-password';privateInputs.push(password);
    const operationButtons=[];let busy=false;
    function lock(){operationButtons.forEach(b=>{b.disabled=busy||!!pending;});retry.hidden=!pending;retry.disabled=busy;}
    async function send(){if(!current()||busy||!pending)return;busy=true;lock();const op=pending,body={...op.data,...(op.action==='snapshot'?{}:{password:password.value})};
     try{const result=await request(op.action,body);if(!current())return;if(result.saved!==true||typeof result.replayed!=='boolean')throw Error();pending=null;status.textContent='준비 기록을 저장했습니다. 실제 송금은 실행되지 않았습니다.';await loadDetail(authorId);}
     catch(e){if(current()){if([400,403,404,409].includes(e.status))pending=null;status.textContent=error(e);}}
     finally{body.password='';password.value='';busy=false;if(current())lock();}
    }
    const retry=button(detail,'미확인 기록 같은 요청으로 재확인',send);retry.hidden=true;
    function write(label,action,build){const b=button(detail,label,async()=>{if(!current()||busy||pending)return;busy=true;lock();try{const more=await build();if(!current())return;busy=false;pending={action,data:{authorId,binding:r.facts.binding,requestId:crypto.randomUUID(),...more}};await send();}catch(e){if(current())status.textContent=e.message;}finally{busy=false;if(current())lock();}});operationButtons.push(b);return b;}
    write('이 달의 준비 상태 기록','snapshot',()=>{if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period.value))throw Error('대상 월을 확인해주세요.');return {period:period.value};});
    el(detail,'p',r.policy?.text||'은행 증빙 정책 확인 전');
    if(r.policy?.collectionEnabled&&r.facts.bankRegistered&&r.facts.identityApproved&&!r.facts.bankConfirmed){
     const file=field(detail,'번호를 가린 계좌 확인 증빙 (JPEG/PNG, 150KB 이하)','file');file.accept='image/png,image/jpeg';privateInputs.push(file);
     el(detail,'p','이 화면은 계좌 확인용 증빙입니다. 송금 영수증 접수나 지급 완료 기록이 아닙니다. 전체 계좌번호·신분증 번호·불필요한 거래 내역은 가린 뒤 선택하세요.');
     const check=field(detail,'현재 등록된 예금주·은행·계좌를 별도 자료와 대조했고 보존 정책을 확인했습니다','checkbox');
     write('현재 계좌 수동 확인 기록','confirm',async()=>{
      if(!check.checked)throw Error('대조와 보존 정책 확인이 필요합니다.');const f=file.files?.[0];if(!f||!['image/png','image/jpeg'].includes(f.type)||f.size>150*1024)throw Error('JPEG/PNG 150KB 이하 증빙을 선택해주세요.');
      const bytes=new Uint8Array(await f.arrayBuffer());let binary='';for(let n=0;n<bytes.length;n+=8192)binary+=String.fromCharCode(...bytes.subarray(n,n+8192));
      return {documentId:crypto.randomUUID(),image:{mime:f.type,data:btoa(binary)},policyVersion:r.policy.version,policyHash:r.policy.hash,confirmed:true};
     });
    }else if(!r.policy?.collectionEnabled)el(detail,'p','은행 증빙 정책 확정 전에는 이미지를 접수하지 않습니다.');
    const evidence=el(detail,'div');
    for(const review of r.reviews||[]){
     el(detail,'p','계좌 검토 '+review.createdAt+(review.revoked?' · 철회됨':''));
     if(review.documentAvailable){const reveal=button(detail,'은행 증빙 열람',async()=>{
      if(!current()||busy||pending)return;busy=true;lock();const body={authorId,reviewId:review.id,password:password.value};
      try{const result=await request('reveal',body);if(!current())return;const image=result.image;if(!['image/png','image/jpeg'].includes(image?.mime)||typeof image.data!=='string'||image.data.length>204800||!/^[A-Za-z0-9+/]+={0,2}$/.test(image.data))throw Error();
       if(url)URL.revokeObjectURL(url);clearTimeout(timer);evidence.replaceChildren();url=URL.createObjectURL(new Blob([Uint8Array.from(atob(image.data),c=>c.charCodeAt(0))],{type:image.mime}));const img=el(evidence,'img');img.src=url;img.alt='가림 처리한 계좌 확인 증빙';img.style.maxWidth='100%';
       const close=()=>{if(url)URL.revokeObjectURL(url);url=null;evidence.replaceChildren();clearTimeout(timer);};button(evidence,'증빙 닫기',close);timer=setTimeout(close,60000);status.textContent='증빙은 60초 후 닫힙니다.';
      }catch(e){if(current())status.textContent=error(e);}finally{body.password='';password.value='';busy=false;if(current())lock();}
     });operationButtons.push(reveal);}
     if(!review.revoked)write('이 계좌 확인 철회','revoke',()=>({reviewId:review.id,reason:'OTHER_REVIEW'}));
    }
    status.textContent='준비 내역을 조회했습니다. 실제 지급은 활성화되지 않았습니다.';
   }catch(e){if(current())status.textContent=error(e);}
  }
  if(admin){const search=field(controls,'작가 필명 또는 작가 ID 검색');search.maxLength=80;button(controls,'작가 검색',()=>{query=search.value.trim();offset=0;return loadList();});await loadList();}else await loadDetail();
 }
 window.SettlementReadiness=Object.freeze({render,reset});
})();
