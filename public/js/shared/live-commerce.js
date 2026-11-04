/* OP13: server-authorized manual bank commerce. No local balances or grant decisions. */
(function(){
 'use strict';let generation=0;const urls=new Set(),timers=new Set(),roots=new Set(),cleanups=new Set();
 const active=()=>window.WEBNOVELS_CONFIG?.liveCommerceEnabled===true;
 function reset(){generation++;for(const fn of cleanups)fn();cleanups.clear();for(const u of urls)URL.revokeObjectURL(u);urls.clear();for(const t of timers)clearTimeout(t);timers.clear();document.querySelectorAll('[data-live-sensitive]').forEach(n=>{if('value'in n)n.value='';else n.replaceChildren();});for(const root of roots)root.replaceChildren();roots.clear();}
 function el(parent,tag,text,className){const n=document.createElement(tag);if(text!=null)n.textContent=String(text);if(className)n.className=className;parent.append(n);return n;}
 function button(parent,text,fn){const n=el(parent,'button',text,'btn btn-outline');n.type='button';n.onclick=fn;return n;}
 const messages={INSUFFICIENT_POINTS:'포인트가 부족합니다. 입금 확인 후 다시 이용해 주세요.',INDEPENDENT_REVIEW_REQUIRED:'등록한 관리자와 다른 관리자가 확인해야 합니다.',AMOUNT_MISMATCH:'주문·입금 또는 송금 금액이 일치하지 않습니다.',BANK_REFERENCE_USED:'이미 등록한 은행 거래입니다.',PRICE_CHANGED:'가격 또는 회차가 변경됐습니다. 다시 조회해 주세요.',PAYOUT_NOT_READY:'계좌 확인·수익·승인 상태를 다시 확인해 주세요.',IDEMPOTENCY_CONFLICT:'같은 요청의 입력이 달라졌습니다. 원래 입력으로 결과를 확인해 주세요.',AUTH_REQUIRED:'로그인 후 이용해 주세요.',READER_REQUIRED:'독자 계정으로 로그인해 주세요.',DOCUMENT_UNAVAILABLE:'증빙이 만료되었거나 사용할 수 없습니다.',EPISODE_LOCKED:'포인트로 열람권을 구매해 주세요.'};
 function errorText(e){return messages[e?.code]||'처리 결과를 확인하지 못했습니다. 입력을 유지하고 같은 요청을 다시 확인해 주세요.';}
 Object.assign(messages,{OP14_CASE_OPEN:'보류 건 또는 재증빙 검토를 먼저 완료해 주세요.',OP14_REVIEW_PENDING:'이미 제출한 재증빙의 검토를 기다려 주세요.',OP14_EVIDENCE_MISMATCH:'기존 거래의 은행 계좌 식별자·거래번호와 일치하지 않습니다.',OP14_TARGET_NOT_READY:'이미 처리되었거나 검토할 수 없는 거래입니다.',OP14_REPORT_CHANGED:'월 내역 또는 마감 버전이 변경됐습니다. 다시 조회해 주세요.',OP14_REPORT_UNCHANGED:'직전 마감과 같은 내역입니다.',OP14_REPORT_TOO_LARGE:'월 내역이 내보내기 한도를 초과합니다. 운영 담당자에게 문의해 주세요.'});
 Object.assign(messages,{OP15_SOURCE_RESERVED:'다른 배분에서 사용 중인 입금·수익입니다. 최신 내역을 확인하세요.',OP15_PLAN_CHANGED:'검토·시험 상태가 변경됐습니다. 다시 조회하세요.',OP15_REASSIGNMENT_REQUIRED:'다른 주문으로 배분하는 근거와 확인이 필요합니다.',OP15_LEGACY_RECONCILIATION_REQUIRED:'이전 지급의 원천 배분을 별도로 대사해야 합니다.',OP15_REVOKED_SOURCE:'예약한 수익이 취소되었습니다. 미송금 신청을 취소하고 다시 신청하세요.'});
 const api=(role,action,data={},options={})=>window.WebNovelsAuth.api('/api/v2/'+(role==='admin'?'admin/':role==='author'?'creator/':'')+'live-commerce',{method:'POST',body:JSON.stringify({action,...data}),...options});
 function input(parent,label,type='text',value=''){const l=el(parent,'label',null,'form-group');el(l,'span',label);const n=el(l,'input',null,'form-input');n.type=type;n.value=value;n.required=true;if(type==='checkbox')n.className='';return n;}
 async function imageData(file){if(!file||!['image/png','image/jpeg'].includes(file.type)||file.size>150000)throw Error('INVALID_IMAGE');const bytes=new Uint8Array(await file.arrayBuffer());let str='';for(let i=0;i<bytes.length;i+=8192)str+=String.fromCharCode(...bytes.subarray(i,i+8192));return {mime:file.type,data:btoa(str)};}
 async function render(root,{role='reader',isCurrent=()=>true,workId=null,episodeNumber=null}={}){
  reset();if(!root)return;if(!active()){root.textContent='포인트·정산 서비스는 아직 활성화되지 않았습니다.';return;}roots.add(root);const seq=generation,owner=window.WebNovelsAuth?.getActor()?.userId;let busy=false,offset=0,query='',policy=null,walletHeading=null,operationsOpen=false,operationOffset=0,operationFilter='ALL',operationQuery='',loadGeneration=0,allocationOpen=false,fundingDeposits=[];
  const valid=()=>seq===generation&&active()&&isCurrent()&&owner===window.WebNovelsAuth?.getActor()?.userId;
  async function reload(){try{await load();}catch(e){if(valid())notice.textContent=errorText(e);}}
  root.replaceChildren();const section=el(root,'section',null,'live-commerce'),notice=el(section,'p','불러오는 중입니다.');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');const body=el(section,'div');
  if(!owner){notice.textContent='로그인 후 이용해 주세요.';return;}
  function form(parent,title,action,initial={},fields=[],proof=false){
   const details=el(parent,'details');el(details,'summary',title);const form=el(details,'form',null,'live-commerce-form');let requestId=crypto.randomUUID(),documentId=crypto.randomUUID();const controls={};
   for(const [key,label,type,value]of fields){if(type==='sources'){
    const box=el(form,'fieldset');el(box,'legend',label);controls[key]=fundingDeposits.slice(0,20).map(d=>{const row=el(box,'div'),selected=input(row,'입금 '+d.id+' · 원주문 '+d.orderId+' · 미배분 '+d.available+'원','checkbox');selected.required=false;const amount=input(row,'배분액 (원)','number',d.available);amount.required=false;amount.min='1';amount.max=d.available;amount.step='1';return {depositId:d.id,selected,amount};});continue;
   }controls[key]=input(form,label,type,value??'');if(type==='number'){controls[key].min='0';controls[key].step='1';}}
   let password,upload,account,reference,confirmed;
   if(proof){
    if(!policy?.enabled){el(form,'p','금융 증빙 보관·국외 처리 정책을 확정한 후 등록할 수 있습니다.');return;}
    el(form,'p',policy.text);account=input(form,'은행 수취/출금 계좌의 내부 식별자');reference=input(form,'은행에서 확인한 고유 거래번호');
    upload=input(form,'불필요한 개인정보를 가린 증빙 (PNG/JPEG, 150KB 이하)','file');upload.accept='image/png,image/jpeg';upload.setAttribute('data-live-sensitive','');
    confirmed=input(form,'실제 은행 내역·대상 계좌·금액과 대조했으며 증빙 처리 안내를 확인했습니다.','checkbox');
   }
   if(role==='admin'){password=input(form,'관리자 비밀번호 재확인','password');password.autocomplete='current-password';password.setAttribute('data-live-sensitive','');}
   if(controls.reassignmentConfirmed)controls.reassignmentConfirmed.required=false;
   const submit=el(form,'button',title,'btn btn-primary');submit.type='submit';const feedback=el(form,'p');feedback.setAttribute('role','status');
   form.onsubmit=async event=>{event.preventDefault();if(!valid()||busy)return;busy=true;submit.disabled=true;feedback.textContent='처리 중입니다.';
    try{
     const payload={...initial,...(['reveal','month-detail'].includes(action)?{}:{requestId})};for(const [key,,type]of fields)payload[key]=type==='sources'?controls[key].filter(x=>x.selected.checked).map(x=>({depositId:x.depositId,amount:Number(x.amount.value)})):type==='number'?Number(controls[key].value):type==='datetime-local'?new Date(controls[key].value).toISOString():type==='checkbox'?controls[key].checked:controls[key].value.trim();
     if(proof){if(!confirmed.checked)throw Error();Object.assign(payload,{documentId,image:await imageData(upload.files[0]),policyHash:policy.hash,policyVersion:policy.version,bankAccountId:account.value.trim(),bankReference:reference.value.trim(),confirmed:true});}
     if(!valid())return;
     if(password)payload.password=password.value;
     const result=await api(role,action,payload);if(password){password.value='';payload.password='';}if(!valid())return;
     if(action==='reveal')showProof(result,form);else if(action==='month-detail')showReport(result,form);else {feedback.textContent='처리했습니다.';await load();}
    }catch(e){if(valid())feedback.textContent=errorText(e);}finally{if(password)password.value='';busy=false;if(valid())submit.disabled=false;}
   };
  }
  function showProof(data,parent){
   const box=el(parent,'div');box.setAttribute('data-live-sensitive','');el(box,'p','계좌 식별자 '+data.bankAccountId+' · 은행 거래번호 '+data.bankReference);
   const bytes=Uint8Array.from(atob(data.image.data),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:data.image.mime}));urls.add(url);const img=el(box,'img');img.src=url;img.alt='관리자 확인용 금융 증빙';img.style.maxWidth='100%';
   const close=()=>{URL.revokeObjectURL(url);urls.delete(url);box.replaceChildren();};button(box,'증빙 닫기',close);const t=setTimeout(()=>{timers.delete(t);close();},60000);timers.add(t);
  }
  const reasonLabels={MISMATCH:'금액 불일치',EXPIRED:'증빙 만료',OLD_INSTRUCTIONS:'입금 안내 변경',HELD:'보류',REVIEW_PENDING:'재증빙 검토 대기'};
  const eventLabels={BANK_RETURNED:'미충전 입금 반환',DEPOSIT_RECORDED:'입금 기록 (미확정 포함)',POINTS_CREDITED:'확정 충전',EPISODE_PURCHASED:'회차 구매·발생 수익',REFUND_CONFIRMED:'확정 환불',BANK_REVERSAL_CONFIRMED:'은행 입금 취소',REVENUE_REVERSED:'취소된 작가 수익',PAYOUT_REQUESTED:'정산 신청',PAYOUT_CANCELLED:'정산 신청 취소',PAYOUT_PAID:'송금 완료'};
  function totals(parent,snapshot){
   el(parent,'p',snapshot.month+' · 한국 시간 · 장부 기록일 기준 · '+snapshot.events.length+'건');
   el(parent,'p','미결 보류·재증빙·입금 배분 검토 '+(snapshot.reviewIssues?.length||0)+'건 · 검토가 남아 있으면 마감 승인할 수 없습니다.');
   el(parent,'p','충전과 작가 수익은 별도입니다. 이 자료는 세무 검토용이며 신고서가 아닙니다. 누적 구매 목록과 지급별 배분 명세를 구분하세요. OP-15 이후 신청은 독점 배분·이전 지급 회수 내역을 함께 제공합니다.');
   for(const t of snapshot.totals)el(parent,'p',`${eventLabels[t.type]} · ${t.count}건 · 금액 ${t.amount}원 · 포인트 ${t.points}P · 작가 수익 ${t.revenue}원`);
  }
  function showReport(data,parent){
   const box=el(parent,'section');box.setAttribute('data-live-sensitive','');el(box,'h4',data.approved?'승인한 월마감':'검토 중인 마감 초안');totals(box,data.snapshot);
   el(box,'p','기록 ID '+data.id+' · 지문 '+data.digest);
   const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}));urls.add(url);
   const link=el(box,'a','고정된 마감 자료 내려받기 (JSON)','btn btn-outline');link.href=url;link.download='webnovels-'+data.snapshot.month+'-'+data.id+'.json';
   const close=()=>{URL.revokeObjectURL(url);urls.delete(url);box.replaceChildren();};button(box,'내역 닫기',close);const timer=setTimeout(()=>{timers.delete(timer);close();},60000);timers.add(timer);
  }
  async function operations(parent){
   const container=el(parent,'section');el(container,'h3','입금 예외 · 월마감 · 운영 준비');
   try{
    const [exceptionData,months,ready]=await Promise.all([api('admin','exceptions',{query:operationQuery,filter:operationFilter,offset:operationOffset}),api('admin','month-list',{offset:operationOffset}),api('admin','operations-readiness')]);if(!valid())return;
    const search=el(container,'form');const text=input(search,'거래·주문·회원 ID','text',operationQuery);text.required=false;
    const label=el(search,'label');el(label,'span','예외 상태');const filter=el(label,'select',null,'form-input');for(const [value,name]of Object.entries({ALL:'미확정 전체',...reasonLabels})){const option=el(filter,'option',name);option.value=value;option.selected=value===operationFilter;}filter.value=operationFilter;
    const go=el(search,'button','예외 검색');go.type='submit';search.onsubmit=async e=>{e.preventDefault();if(busy||!valid())return;operationQuery=text.value.trim();operationFilter=filter.value;operationOffset=0;await reload();};
    if(!exceptionData.items.length)el(container,'p','조건에 맞는 미확정 거래가 없습니다.');
    for(const order of exceptionData.staleOrders||[])el(container,'p','입금 안내가 변경된 미충전 주문: '+order.id+' · 회원 '+order.userId+' · 기존 안내와 실제 입금을 별도로 대조해야 합니다. 새 주문으로 자동 충전하지 않습니다.');
    el(container,'p','보류 해제는 포인트 지급이나 환불 완료가 아닙니다. 오연결·부분/초과 입금은 입금 배분·반환 메뉴에서 원거래를 보존하여 대조하세요.');
    for(const item of exceptionData.items){const card=el(container,'article',null,'glass-panel');el(card,'h4',(item.kind==='DEPOSIT'?'입금':'환불·취소')+' · '+item.amount.toLocaleString()+'원');el(card,'p',item.id+' · 주문 '+item.orderId);el(card,'p',item.reasons.map(r=>reasonLabels[r]).join(' / ')||'독립 확인 대기');
     form(card,'현재 증빙 확인','reveal',{documentId:item.documentId});
     if(!item.cases.length)form(card,'보류 사유 등록','case-open',{kind:item.kind,targetId:item.id},[['reasonRef','검토 문서·문의 참조 (개인정보 제외)','text','']]);
     for(const c of item.cases){el(card,'p','보류 근거 '+c.reasonRef);if(c.actorId!==owner)form(card,'독립 대조 후 보류 해제','case-resolve',{caseId:c.id},[['reasonRef','해제 검토 문서 참조','text','']]);else el(card,'p','다른 관리자가 보류 해제를 검토합니다.');}
     if(!item.proofs.length)form(card,'같은 은행 거래의 재증빙 제출','reproof',{kind:item.kind,targetId:item.id},[['reasonRef','재증빙 사유 문서 참조','text','']],true);
     for(const p of item.proofs){el(card,'p','재증빙 사유 '+p.reasonRef);form(card,'제출한 재증빙 보기','reveal',{documentId:p.documentId});if(p.actorId!==owner){form(card,'재증빙 승인','review-reproof',{proofId:p.id,approved:true});form(card,'재증빙 반려','review-reproof',{proofId:p.id,approved:false});}else el(card,'p','다른 관리자가 재증빙을 검토합니다.');}
    }
    const nav=el(container,'nav');button(nav,'이전 예외·마감 목록',async()=>{if(busy||!valid())return;operationOffset=Math.max(0,operationOffset-30);await reload();});button(nav,'다음 예외·마감 목록',async()=>{if(busy||!valid())return;operationOffset+=30;await reload();});
    const closeSection=el(container,'section');el(closeSection,'h3','월별 정산 자료');const preview=el(closeSection,'form');const month=input(preview,'조회 월 (한국 시간)','month');const submit=el(preview,'button','월 내역 조회');submit.type='submit';const previewBody=el(closeSection,'div');
    preview.onsubmit=async e=>{e.preventDefault();if(busy||!valid())return;busy=true;submit.disabled=true;try{const data=await api('admin','month-preview',{month:month.value});if(!valid())return;previewBody.replaceChildren();totals(previewBody,data.snapshot);form(previewBody,data.previousId?'마감 수정본 작성':'마감 초안 작성','month-draft',{month:data.snapshot.month,expectedDigest:data.digest,previousId:data.previousId},[['reasonRef','마감 검토 근거 문서 참조','text','']]);el(previewBody,'p','지난달까지 마감할 수 있습니다. 기존 승인 자료는 수정하지 않고 수정본을 새로 남깁니다.');}catch(e){if(valid())notice.textContent=errorText(e);}finally{busy=false;if(valid())submit.disabled=false;}};
    for(const report of months.reports){const card=el(closeSection,'article');el(card,'h4',report.month+' · '+(report.approved?'승인 완료':'검토 중'));el(card,'p',report.id+(report.previousId?' · 이전 마감 '+report.previousId:''));form(card,'마감 내역·다운로드 준비','month-detail',{reportId:report.id});if(!report.approved&&report.actorId!==owner)form(card,'월마감 독립 승인','month-approve',{reportId:report.id,expectedDigest:report.digest});}
    const readiness=el(container,'details');el(readiness,'summary','운영 준비 상태');el(readiness,'p','활성 표시 최고 관리자 '+ready.activeSuperAdmins+'명 · 보류 '+ready.openCases+'건 · 재증빙 대기 '+ready.pendingProofs+'건');
    const config=ready.configuration;el(readiness,'p','암호화 쓰기 키 '+(config.keys.activeVersion||'미설정')+' · 읽기 키 '+config.keys.readVersions.join(', ')+' · 은행 거래 중복 판정 키 v1 유지');for(const key of ready.documentKeys)el(readiness,'p',key.version+' 정산 개인정보·증빙 '+key.count+'건');if(config.keys.missingReadVersions?.length)el(readiness,'p','읽기 키 누락: '+config.keys.missingReadVersions.join(', '));
    el(readiness,'p','SMTP 설정 '+(config.smtp.configurationPresent?'입력됨':'미입력')+' · 메일 도착 검증 미확인 · 금융 알림 미연결');el(readiness,'p','별도 복원 근거 '+(config.hostedRestoreEvidencePresent?'입력됨':'미입력')+' · 실거래 인수 근거 '+(config.bankAcceptanceEvidencePresent?'입력됨':'미입력'));el(readiness,'p','설정·근거의 존재만 표시합니다. 실거래 성공이나 워커 배포 완료를 보장하지 않습니다.');
   }catch(e){if(valid())el(container,'p',errorText(e));}
  }
  async function allocations(parent){
   const box=el(parent,'section');el(box,'h3','입금 배분 · 반환 · 금융 알림');
   try{const [data,queue]=await Promise.all([api('admin','funding-list',{offset}),api('admin','notification-list',{offset})]);if(!valid())return;fundingDeposits=data.deposits;
    el(box,'p','실제 입금 기록은 그대로 유지됩니다. 합계 10,000원을 선택하면 독립 승인 후 한 번만 10,000P가 충전됩니다. 초과·미완납 금액 반환은 승인 후 별도로 송금하고 증빙을 등록하세요.');
    for(const kind of ['CREDIT','RETURN'])form(box,kind==='CREDIT'?'부분 입금 합산·주문 재연결':'미충전 금액 반환 요청','funding-propose',{kind},[['orderId',kind==='CREDIT'?'충전할 주문 ID':'반환 대상 원주문 ID','text',''],['sources','배분할 실제 입금 선택 (현재 목록 최대 20건)','sources',''],['reasonRef','대조·반환 근거 문서 참조','text',''],['reassignmentConfirmed','다른 주문의 입금을 선택한 경우 원래 회원과 새 회원·은행 증빙을 대조했습니다.','checkbox','']]);
    const labels={PENDING:'독립 검토 대기',CREDITED:'충전 완료',RETURN_APPROVED:'반환 승인·외부 송금 대기',RETURNED:'반환 기록 완료',REJECTED:'반려·예약 해제'};
    for(const p of data.plans){const card=el(box,'article',null,'glass-panel');el(card,'h4',(p.kind==='CREDIT'?'충전 배분':'반환')+' · '+p.amount+'원 · '+labels[p.status]);el(card,'p',p.id+' · 주문 '+p.orderId+' · 근거 '+p.reasonRef);for(const src of p.sources)el(card,'p','입금 '+src.depositId+' → '+src.amount+'원');
     if(p.status==='PENDING'){form(card,'독립 검토 승인','funding-review',{planId:p.id,approved:true});form(card,'배분 반려·예약 해제','funding-review',{planId:p.id,approved:false});}
     if(p.status==='RETURN_APPROVED')form(card,'외부 반환 송금 완료 기록','funding-return',{planId:p.id,amount:p.amount},[['occurredAt','실제 반환 송금 시각','datetime-local','']],true);
    }
    const notes=el(box,'details');el(notes,'summary','금융 알림 준비·재시도 TEST');el(notes,'p','외부 발송 비활성 · SMTP 미연결. 아래 시험은 메일을 보내거나 실제 발송 완료를 기록하지 않습니다.');
    for(const n of queue.items){const row=el(notes,'article');el(row,'p',n.eventType+' · 대상 '+n.targetId+' · '+n.outcome+' · 시험 '+n.attempt+'회');if(n.attempt<5&&n.outcome!=='TEST_READY')for(const outcome of ['TEST_RETRY','TEST_READY'])form(row,outcome==='TEST_RETRY'?'재시도 상태 시험':'준비 완료 상태 시험','notification-test',{notificationId:n.id,expectedAttempt:n.attempt,outcome});}
   }catch(e){if(valid())el(box,'p',errorText(e));}
  }
  function payoutRows(parent,rows){for(const p of rows){const card=el(parent,'article',null,'glass-panel');el(card,'h3',(p.penName||'작가')+' · '+p.gross.toLocaleString()+'원');el(card,'p',`신청 ${p.id} · ${p.status} · 공제 ${p.deduction??'미확정'}원 · 송금 ${p.net??'미확정'}원`);
   if(role!=='admin')continue;
   button(card,'지급별 수익 배분·회수 내역',async()=>{if(!valid()||busy)return;busy=true;try{const result=await api('admin','payout-sources',{payoutId:p.id});if(!valid())return;const box=el(card,'section');el(box,'h4','지급별 원천 명세');if(result.legacyReconciliationRequired)el(box,'p','과거 지급: 원천 배분 대사 전 신규 지급이 제한됩니다.');for(const s of result.sources)el(box,'p','구매 '+s.purchaseId+' · 지급 배분 '+s.amount+'원');for(const r of result.recoveries)el(box,'p','구매 '+r.purchaseId+' · 이전 지급 '+r.debtPayoutId+'의 취소 수익 회수 '+r.amount+'원');}catch(e){if(valid())notice.textContent=errorText(e);}finally{busy=false;}});
   if(p.status==='REQUESTED')form(card,'지급 승인','approve',{payoutId:p.id},[['deduction','검토한 공제액 (원)','number',0],['basisRef','계약·세무 검토 문서 참조','text','']]);
   if(p.status==='APPROVED')form(card,'외부 송금 완료 기록','complete',{payoutId:p.id,net:p.net},[['occurredAt','실제 송금 시각','datetime-local','']],true);
   if(['REQUESTED','APPROVED'].includes(p.status))form(card,'송금하지 않은 신청 취소','cancel',{payoutId:p.id},[['notTransferredConfirmed','은행 내역을 확인했으며 송금하지 않았음을 확약합니다.','checkbox',''],['reasonRef','취소 검토 근거 문서 참조','text','']]);
   if(p.documentId)form(card,'송금 증빙 확인','reveal',{documentId:p.documentId});
  }}
  async function load(){
   const ticket=++loadGeneration;
   const data=await api(role,role==='admin'?'list':'state',role==='admin'?{query,offset}:role==='reader'?{offset}:{});if(!valid()||ticket!==loadGeneration)return;
   for(const fn of cleanups)fn();cleanups.clear();for(const u of urls)URL.revokeObjectURL(u);urls.clear();body.replaceChildren();notice.textContent='';el(body,'h2',role==='admin'?'입금·실수익·외부 송금 관리':role==='author'?'실제 정산 내역':'포인트 충전·작품 읽기');
   el(body,'p',role==='reader'?'회원은 1~2화를 무료로 읽습니다. 10,000원 충전 시 10,000P가 지급되며, 회차별 표시된 포인트를 사용합니다.':'은행자료를 관리자가 대조하는 수동 처리입니다. 등록과 확인은 서로 다른 관리자가 담당합니다.');
   if(role==='admin'){
    policy=data.policy;const search=el(body,'form'),q=input(search,'주문·회원·작가 ID 또는 작품명·필명','text',query);q.required=false;const go=el(search,'button','검색');go.type='submit';search.onsubmit=e=>{e.preventDefault();if(busy)return;query=q.value.trim();offset=0;load().catch(e=>{if(valid())notice.textContent=errorText(e);});};
    el(body,'h3','충전 주문·입금 대조');for(const o of data.orders){const card=el(body,'article',null,'glass-panel');el(card,'h4',o.id);el(card,'p',`회원 ${o.userId} · ${o.amount}원 · ${o.confirmed?'충전 완료':'입금 확인 대기'}`);if(o.lotId)el(card,'p','충전 원장 ID '+o.lotId);
     if(!o.confirmed)form(card,'입금 내역 등록','deposit',{orderId:o.id},[['amount','실제 입금액 (원)','number',10000],['occurredAt','은행 입금 시각','datetime-local','']],true);
     for(const d of o.deposits){el(card,'p',`입금 기록 ${d.id} · ${d.amount}원${d.available!==undefined?' · 미배분 '+d.available+'원':''}`);form(card,'입금 증빙 보기','reveal',{documentId:d.documentId});if(!o.confirmed&&(d.available===undefined||Number(d.available)===10000))form(card,'대조 완료·포인트 지급','confirm',{depositId:d.id});}
    }
    const policies=el(body,'details');el(policies,'summary','작품 가격·정산 계약');for(const w of data.works)form(policies,w.title+' 가격·계약 저장','policy',{workId:w.id,expectedPolicyId:w.policyId},[['price','회차 가격 (P)','number',w.price??100],['shareBps','계약상 작가 배분율 (1%=100, 100%=10000)','number',w.shareBps??''],['contractRef','체결된 계약 버전·문서 참조','text','']]);
    el(body,'h3','작가 정산 요청');payoutRows(body,data.payouts);
    const corrections=el(body,'details');el(corrections,'summary','환불·입금 취소 대사');el(corrections,'p','환불은 미사용 잔액 전액만 접수합니다. 은행 입금 취소는 해당 충전 10,000원 전체와 연결된 열람·수익을 정정합니다. 실제 은행 처리를 먼저 확인하세요.');
    for(const kind of ['REFUND','BANK_REVERSAL'])form(corrections,kind==='REFUND'?'외부 환불 기록':'은행 입금 취소 기록','correction',{kind},[['lotId','충전 원장 ID','text',''],['amount','확인한 환불·취소 금액 (원)','number','']],true);
    for(const c of data.corrections){el(corrections,'p',`${c.kind} · ${c.amount}원 · ${c.id}`);form(corrections,'정정 증빙 확인','reveal',{documentId:c.documentId});form(corrections,'정정 확정','confirm-correction',{correctionId:c.id});form(corrections,'오접수 정정 반려','reject-correction',{correctionId:c.id});}
    if(allocationOpen)await allocations(body);else button(body,'입금 배분·반환·알림 준비 열기',async()=>{if(busy||!valid())return;allocationOpen=true;await reload();});
    if(operationsOpen)await operations(body);else button(body,'입금 예외·월마감·운영 준비 열기',async()=>{if(busy||!valid())return;operationsOpen=true;await reload();});
   }else if(role==='author'){
    el(body,'p','현재 신청 가능 수익 '+data.available.toLocaleString()+'원');el(body,'p',data.bankConfirmed?'계좌 검토 완료':'계좌·신원 검토가 필요합니다.');
    if(data.available>0&&data.bankConfirmed)form(body,'정산 신청','request',{binding:data.binding});payoutRows(body,data.payouts);
   }else{
    walletHeading=el(body,'h3',data.balance.toLocaleString()+'P');if(data.instructions){el(body,'p',data.instructions.text);form(body,'10,000원 충전 주문 만들기','order',{destinationHash:data.instructions.destinationHash});}else el(body,'p','입금 안내가 준비되지 않았습니다.');
    for(const o of data.orders)el(body,'p',`주문 ${o.id} · ${o.amount}원 · ${o.confirmed?'충전 완료':'입금 확인 대기'}`);
    el(body,'p','환불은 문의하기에서 주문 ID와 함께 요청해 주세요. 계좌번호·신분증은 문의 본문에 입력하지 마세요.');
    for(const w of data.works)button(body,w.title+' · '+(w.type==='WEBTOON'?'웹툰':'웹소설'),()=>episodes(w.id));
    if(workId)await episodes(workId);
   }
   if(role!=='author'){const nav=el(body,'nav');button(nav,'이전 목록',()=>{if(!busy){offset=Math.max(0,offset-30);load().catch(e=>{if(valid())notice.textContent=errorText(e);});}});button(nav,'다음 목록',()=>{if(!busy){offset+=30;load().catch(e=>{if(valid())notice.textContent=errorText(e);});}});}
  }
  async function episodes(id,offset=0){try{const result=await api('reader','episodes',{workId:id,offset});if(!valid())return;const old=body.querySelector('[data-live-episodes]');old?.remove();const box=el(body,'section');box.setAttribute('data-live-episodes','');el(box,'h3','회차 목록');for(const ep of result.episodes){const row=el(box,'article');el(row,'p',`${ep.number}화 ${ep.title} · ${ep.owned?'구매 완료':ep.price===0?'무료':ep.price+'P'}`);button(row,ep.owned||ep.price===0?'읽기':'가격 확인 후 구매',()=>open(ep,row));}if(offset)button(box,'이전 회차',()=>episodes(id,Math.max(0,offset-30)));if(result.episodes.length===30)button(box,'다음 회차',()=>episodes(id,offset+30));if(episodeNumber){const ep=result.episodes.find(e=>e.number===Number(episodeNumber));episodeNumber=null;if(ep)await open(ep,box);}}catch(e){if(valid())notice.textContent=errorText(e);}}
  async function open(ep,parent){if(busy)return;busy=true;try{
   const q=await api('reader','quote',{episodeId:ep.id});if(!valid())return;
   if(q.price>0){const box=el(parent,'section');el(box,'p',`차감 ${q.price}P · 잔액 ${q.balance}P · 확인 가격 5분 유효`);const confirm=input(box,'가격과 유료 열람에 동의합니다.','checkbox');const requestId=crypto.randomUUID();button(box,q.price+'P 사용하여 읽기',async()=>{if(!valid()||busy||!confirm.checked)return;busy=true;try{const purchased=await api('reader','purchase',{quoteId:q.id,requestId});if(valid()){if(walletHeading)walletHeading.textContent=purchased.balance.toLocaleString()+'P';box.replaceChildren();await read(ep.id,parent);}}catch(e){if(valid())notice.textContent=errorText(e);}finally{busy=false;}});
   }else await read(ep.id,parent);
  }catch(e){if(valid())notice.textContent=errorText(e);}finally{busy=false;}}
  async function read(episodeId,parent){const data=await api('reader','content',{episodeId});if(!valid())return;const article=el(parent,'article',null,'points-test-content');el(article,'h3',data.title);if(data.contentType==='NOVEL'){if(window.ReaderContent?.render)window.ReaderContent.render(article,null,{content:data.content,contentDocument:data.contentDocument,version:data.versionId});else el(article,'p',data.content);return;}
   const current=()=>valid()&&article.isConnected!==false;
   if(window.ReaderWebtoon?.render){const panels=el(article,'div');const dispose=window.ReaderWebtoon.render(panels,data.panels,{valid:current,load:(p,format,signal)=>api('reader','panel',{episodeId,versionId:data.versionId,panelId:p.id,format},{responseType:'blob',signal})});if(typeof dispose==='function')cleanups.add(dispose);return;}
   for(const [index,p]of data.panels.entries()){const box=el(article,'div'),img=el(box,'img');img.alt=(index+1)+'번째 웹툰 이미지';img.width=p.width;img.height=p.height;img.style.width='100%';img.style.height='auto';img.loading='lazy';button(box,'이미지 불러오기',async()=>{try{const blob=await api('reader','panel',{episodeId,versionId:data.versionId,panelId:p.id,format:p.format},{responseType:'blob'});if(!current())return;if(img.src){URL.revokeObjectURL(img.src);urls.delete(img.src);}const u=URL.createObjectURL(blob);urls.add(u);img.src=u;}catch(e){if(current())notice.textContent=errorText(e);}});}
  }
  try{await load();}catch(e){if(valid())notice.textContent=errorText(e);}
 }
 window.LiveCommerce=Object.freeze({active,render,reset});
})();
