/* OP-07 isolated settlement rehearsal. No external transfer or identity data. */
(function(){
 'use strict';
 const actor=()=>window.WebNovelsAuth?.getActor(),enabled=()=>window.WEBNOVELS_CONFIG?.settlementsTestEnabled===true;
 const labels={REQUESTED:'신청 접수',APPROVED:'승인 · 지급 전',UNKNOWN:'지급 결과 확인 중',PAID:'TEST 지급 확인',FAILED:'TEST 실패 확인',REJECTED:'반려',CANCELLED:'취소'};
 const errors={REVISION_CONFLICT:'다른 곳에서 변경되었습니다. 최신 내역을 확인하고 다시 진행해주세요.',POLICY_CHANGED:'정산 정책이 변경되었습니다. 최신 조건을 확인해주세요.',POLICY_DISABLED:'정산 신청 정책이 준비 중입니다.',PAYEE_NOT_READY:'TEST 지급 대상 준비가 필요합니다.',PAYEE_CHANGED:'신청 후 지급 대상이 변경되었습니다. 발송 전 신청을 취소하고 다시 신청해주세요.',SOURCE_HELD:'원거래 확인이 필요한 수익이 있습니다.',INSUFFICIENT_EARNINGS:'현재 신청 가능 금액을 초과했습니다.',PAYOUT_HOLD:'계좌·수익 상태를 확인한 뒤 진행해주세요.',INVALID_PAYOUT_STATE:'이미 처리 상태가 변경되었습니다. 최신 내역을 확인해주세요.',SOURCE_ALREADY_CONFIRMED:'이미 확정한 소비입니다.',EVIDENCE_CONFLICT:'이미 사용한 지급 증빙입니다. 원거래를 확인해주세요.',EVIDENCE_MISMATCH:'금액·대상·지급 시각이 신청과 일치하지 않습니다.',RATE_LIMITED:'요청이 많습니다. 잠시 후 같은 요청으로 다시 확인해주세요.',AUTHOR_NOT_ACTIVE:'현재 작가 상태에서 신청·지급할 수 없습니다.',ADJUSTMENT_EXCEEDS_EARNINGS:'감액할 수 있는 금액을 초과했습니다.'};
 const money=v=>Number(v).toLocaleString('ko-KR')+'원',date=v=>v?new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' KST':'—';
 for(const [code,alias]of Object.entries({PAYOUT_POLICY_CHANGED:'POLICY_CHANGED',PAYOUT_POLICY_DISABLED:'POLICY_DISABLED',SOURCE_NOT_PAYABLE:'SOURCE_HELD',ADJUSTMENT_EXCEEDS_EARNING:'ADJUSTMENT_EXCEEDS_EARNINGS',INSUFFICIENT_SETTLEMENT_BALANCE:'INSUFFICIENT_EARNINGS',PAYOUT_STATE_CONFLICT:'INVALID_PAYOUT_STATE',AUTHOR_NOT_PAYABLE:'AUTHOR_NOT_ACTIVE',SETTLEMENT_HOLD:'PAYOUT_HOLD',PAYOUT_PROOF_MISMATCH:'EVIDENCE_MISMATCH',PAYOUT_EVIDENCE_CONFLICT:'EVIDENCE_CONFLICT'}))errors[code]=errors[alias];
 errors.ADJUSTMENT_LIMIT='이 수익의 감액 기록 한도에 도달했습니다. 관리자 대사가 필요합니다.';
 const rejected=new Set([...Object.keys(errors).filter(k=>k!=='RATE_LIMITED'),'INVALID_PAYOUT_REQUEST','REASON_REQUIRED','TEST_REFERENCE_REQUIRED','IDEMPOTENCY_CONFLICT','PAYOUT_NOT_FOUND','EARNING_NOT_FOUND','AUTHOR_REQUIRED','ADMIN_FORBIDDEN']);
 const el=(p,t,text,cls)=>{const n=document.createElement(t);if(text!=null)n.textContent=String(text);if(cls)n.className=cls;p.append(n);return n;};
 function button(p,label,fn,disabled=false){const n=el(p,'button',label,'btn btn-outline');n.type='button';n.disabled=disabled;n.onclick=fn;return n;}
 function field(p,label,value='',type='text'){const wrap=el(p,'label',null,'payouts-field');el(wrap,'span',label);const n=el(wrap,'input');n.type=type;n.value=String(value);n.maxLength=300;if(type==='number'){n.min='1';n.max='1000000000';n.step='1';}return n;}
 function select(p,label,choices,value){const wrap=el(p,'label',null,'payouts-field');el(wrap,'span',label);const n=el(wrap,'select');for(const [key,title]of choices){const o=el(n,'option',title);o.value=key;}n.value=value;return n;}
 function table(p,columns,rows){const scroll=el(p,'div',null,'payouts-scroll'),t=el(scroll,'table'),head=el(el(t,'thead'),'tr');columns.forEach(([label])=>{const th=el(head,'th',label);th.scope='col';});const body=el(t,'tbody');for(const row of rows){const tr=el(body,'tr');for(const [,show]of columns){const td=el(tr,'td');const value=show(row,td);if(value!==undefined)td.textContent=String(value);}}if(!rows.length){const td=el(el(body,'tr'),'td','표시할 내역이 없습니다.');td.colSpan=columns.length;}return t;}
 function totals(root,s){const box=el(root,'dl',null,'payouts-totals');for(const [k,label]of [['netKrw','감액 후 확정 수익'],['paidKrw','TEST 지급 확인액'],['reservedKrw','신청·지급 대기'],['heldKrw','원거래 확인 필요'],['availableKrw','신청 가능액'],['debtKrw','부족액']]){const item=el(box,'div');el(item,'dt',label);el(item,'dd',money(s[k]));}}
 const marked=v=>v?.mode==='TEST'&&v.provenance==='LOCAL_SIMULATED'&&v.currency==='KRW'&&v.livePayouts===false;
 function module(admin){
  let owner=null,epoch=0,dispose=()=>{},pending=null;
  function leave(){epoch++;dispose();dispose=()=>{};}
  function reset(){leave();owner=null;pending=null;}
  const allowed=()=>!!actor()?.userId&&(admin?actor()?.admin?.role==='SUPER_ADMIN'&&actor()?.admin?.is_active===true:actor()?.author?.status==='APPROVED');
  async function render(root,{isCurrent=()=>true,onLegacy}={}){
   if(owner!==actor()?.userId){reset();owner=actor()?.userId||null;}else leave();const generation=epoch,user=owner;
   const current=()=>generation===epoch&&user===actor()?.userId&&allowed()&&enabled()&&isCurrent()&&root.isConnected!==false;
   dispose=()=>root.replaceChildren();root.replaceChildren();root.classList.add('payouts-test');
   el(root,'h2',admin?'작가 정산 관리 · TEST':'내 수익·정산 신청 · TEST');
   if(!allowed()){el(root,'p',admin?'최고 관리자만 정산 TEST를 관리할 수 있습니다.':'승인된 작가로 로그인해주세요.');return;}
   if(!enabled()){el(root,'p','정산 기능은 준비 중입니다. TEST 검증 후 지급 서비스와 연결합니다.');return;}
   el(root,'p','모든 금액과 지급 증빙은 TEST입니다. 실제 송금·신원 확인을 수행하지 않습니다. 개인정보나 실제 계좌번호를 입력하지 마세요.','payouts-notice');
   const feedback=el(root,'p','불러오는 중입니다.');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
   const controls=el(root,'div',null,'payouts-actions'),content=el(root,'div');let busy=false,view=admin?'requests':'overview',offset=0,filter='ALL',query='',authorFilter='',overview=null,policyState=null,detail=null,lastList=null;
   const retry=button(controls,'미확인 요청 다시 확인',()=>dispatch());retry.hidden=!pending;
   const refresh=button(controls,'새로고침',()=>load());
   if(onLegacy)button(controls,'이전 수익 기록',()=>{leave();onLegacy();});
   function lock(){retry.hidden=!pending;retry.disabled=busy;refresh.disabled=busy;root.querySelectorAll('button[data-write]').forEach(n=>n.disabled=busy||!!pending);root.setAttribute('aria-busy',String(busy));}
   function message(e){return errors[e?.code]||'처리 결과를 확인하지 못했습니다. 연결 상태와 내역을 확인해주세요.';}
   async function api(action,data={}){const prefix=admin?'/api/v2/admin/payouts-test':'/api/v2/creator/payouts-test',write=admin||['request','cancel'].includes(action);const q=new URLSearchParams({action,...(!write?data:{})});const result=await window.WebNovelsAuth.api(prefix+'?'+q,write?{method:'POST',body:JSON.stringify(data)}:undefined);if(!marked(result))throw Error('INVALID_RESPONSE');return result;}
   function writeButton(p,label,action,build){const b=button(p,label,async()=>{if(!current()||busy||pending)return;let data;try{data=build();if(data===null)return;}catch(e){feedback.textContent=e.message;return;}pending={action,data:{...data,requestId:crypto.randomUUID()}};await dispatch();});b.setAttribute('data-write','true');b.disabled=busy||!!pending;return b;}
   function reason(input){const s=input.value.trim();if(s.length<3||s.length>300||/[<>\x00-\x1f\x7f]/.test(s))throw Error('처리 사유를 3~300자로 입력해주세요.');return s;}
   function amount(input){const n=Number(input.value);if(!/^[1-9]\d*$/.test(input.value)||!Number.isSafeInteger(n)||n>1000000000)throw Error('금액을 1원 이상의 정수로 입력해주세요.');return n;}
   function testRef(input){if(!/^TEST-[A-Za-z0-9_-]{1,72}$/.test(input.value))throw Error('TEST-로 시작하는 모의 참조를 입력해주세요.');return input.value;}
   async function dispatch(){
    if(!current()||busy||!pending)return;const op=pending;busy=true;feedback.textContent='처리 결과를 확인 중입니다.';lock();
    try{const result=await api(op.action,op.data);if(!current()||pending!==op)return;if(typeof result.replayed!=='boolean')throw Error('INVALID_RESPONSE');pending=null;feedback.textContent=result.replayed?'기존 요청의 처리 결과를 확인했습니다.':'TEST 처리를 완료했습니다.';}
    catch(e){if(!current())return;if([400,403,404,409].includes(e.status)&&rejected.has(e.code))pending=null;feedback.textContent=message(e)+(pending?' 같은 요청으로 다시 확인하세요.':'');}
    finally{busy=false;if(current()){lock();await load(true);}}
   }
   async function load(keepMessage=false){
    if(!current()||busy)return;busy=true;lock();content.replaceChildren();if(!keepMessage)feedback.textContent=pending?'미확인 요청이 있습니다. 같은 요청으로 결과를 확인하세요.':'불러오는 중입니다.';
    try{
     if(admin){policyState=await api('state');if(!current())return;if(!policyState.policy||!policyState.summary)throw Error('INVALID_RESPONSE');}
     else{overview=await api('summary');if(!current())return;if(!overview.summary||!overview.payee||!overview.policy)throw Error('INVALID_RESPONSE');}
     if(view==='detail'){const r=await api(admin?'detail':'request-detail',{payoutId:detail.id});if(!current())return;detail=r.payout;}
     else if(!['overview','policy'].includes(view)){lastList=await api(view,{offset,...(view==='requests'?{status:filter}:{}),...(view==='authors'?{query}:{}),...(admin&&['sources','earnings','requests'].includes(view)&&authorFilter?{authorId:authorFilter}:{})});if(!current())return;if(!Array.isArray(lastList.items)||lastList.limit!==50)throw Error('INVALID_RESPONSE');}
     draw();if(!keepMessage)feedback.textContent=pending?'미확인 요청이 있습니다. 같은 요청으로 결과를 확인하세요.':'최신 내역입니다.';
    }catch(e){if(current()){content.replaceChildren();feedback.textContent=message(e);}}
    finally{busy=false;if(current())lock();}
   }
   function navigate(next){if(!current()||busy)return;view=next;offset=0;return load();}
   function detailButton(row,td){button(td,'신청 상세',()=>{detail=row;return navigate('detail');});}
   function draw(){
    content.replaceChildren();totals(content,(admin?policyState:overview).summary);
    const nav=el(content,'nav',null,'payouts-actions');nav.setAttribute('aria-label','정산 업무');
    for(const [key,label]of admin?[['requests','정산 신청'],['sources','소비 수익 확정'],['earnings','확정 명세·감액'],['authors','작가·지급 대상'],['policy','정산 정책']]:[['overview','정산 신청하기'],['earnings','확정 수익 명세'],['requests','내 신청 내역']]){const b=button(nav,label,()=>navigate(key));if(view===key)b.setAttribute('aria-current','page');}
    if(view==='overview')drawOverview();else if(view==='policy')drawPolicy();else if(view==='detail')drawDetail();else drawList();
   }
   function drawOverview(){
    const p=overview.policy;el(content,'p',`현재 TEST 배분율 ${p.authorBps/100}% · 배분 후 공제율 ${p.deductionBps/100}%. 실제 세율·계약 조건이 아닙니다.`);
    el(content,'p',overview.payee.ready?'TEST 지급 대상 준비 완료':'TEST 지급 대상 준비가 필요합니다. 실제 계좌 등록 상태와 별개입니다.');
    const a=field(content,'신청 금액 (원)','','number');
    const b=writeButton(content,'정산 TEST 신청','request',()=>{const value=amount(a);if(!overview.eligibility.canRequest||value>overview.summary.availableKrw)throw Error('현재 신청 가능액과 준비 상태를 확인해주세요.');return {amountKrw:value,policyVersion:overview.policy.id,payeeRevision:overview.payee.revision};});
    if(!overview.eligibility.canRequest){b.removeAttribute('data-write');b.disabled=true;}
    el(content,'p','신청 금액은 처리 중 예약됩니다. 승인 후 지급 결과를 별도로 확인합니다.');
   }
   function drawPolicy(){
    el(content,'h3','정산 TEST 정책');el(content,'p','배분은 소비 원화에 적용하며 공제는 배분액에 적용합니다. 신규 확정부터 적용하고 기존 명세는 보존합니다.');
    const enabledInput=select(content,'신청 정책',[['false','준비 중'],['true','TEST 활성']],String(policyState.policy.enabled));
    const authorBps=field(content,'작가 배분율 (bp, 100bp=1%)',policyState.policy.authorBps,'number'),deductionBps=field(content,'배분 후 공제율 (bp)',policyState.policy.deductionBps,'number');for(const x of [authorBps,deductionBps]){x.min='0';x.max='10000';}
    const why=field(content,'정책 변경 사유');writeButton(content,'정책 저장','policy',()=>{const a=Number(authorBps.value),d=Number(deductionBps.value);if(![a,d].every(x=>Number.isInteger(x)&&x>=0&&x<=10000)||!authorBps.value||!deductionBps.value)throw Error('비율은 0~10000bp의 정수로 입력해주세요.');return {enabled:enabledInput.value==='true',authorBps:a,deductionBps:d,revision:policyState.revision,reason:reason(why)};});
   }
   function drawDetail(){
    const p=detail;el(content,'h3',`${p.authorName} · ${money(p.amountKrw)} · ${labels[p.status]}`);el(content,'p',`신청 ${date(p.createdAt)} / 승인 ${date(p.approvedAt)} / 결과 확인 시작 ${date(p.dispatchedAt)}`);el(content,'p',`신청 당시 TEST 대상: ${p.testReference} · 버전 ${p.payeeRevision}`);
    if(p.evidence){const e=p.evidence;el(content,'h4','확인된 TEST 증빙');el(content,'p',`${labels[e.outcome]} · ${e.reference} · ${money(e.amountKrw)} · ${date(e.occurredAt)}`);el(content,'p','증빙 출처: 모의 대사. 실제 은행 지급 증빙이 아닙니다.');}
    const actions=admin?(p.status==='REQUESTED'?['approve','reject']:p.status==='APPROVED'?['begin','reject']:p.status==='UNKNOWN'?['paid','fail']:[]):(['REQUESTED','APPROVED'].includes(p.status)?['cancel']:[]);
    if(!actions.length)return;
    const why=field(content,'처리 사유');
    if(p.status==='UNKNOWN'){
     el(content,'p','지급 결과가 미확정인 동안 금액은 예약됩니다. 원래 TEST 대상과 증빙을 대조한 뒤 한 번만 결과를 기록하세요.');
     const ref=field(content,'TEST 거래 증빙 참조','TEST-'),target=field(content,'증빙의 TEST 지급 대상','TEST-'),amountInput=field(content,'증빙의 지급 금액 (원)','','number'),at=field(content,'지급 일시 (한국 시간)','','datetime-local');
     at.step='1';
     writeButton(content,'TEST 지급 증빙 확인','paid',()=>{const t=new Date(at.value+'+09:00');if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(at.value)||!Number.isFinite(t.getTime())||new Date(t.getTime()+9*3600000).toISOString().slice(0,at.value.length)!==at.value)throw Error('한국 시간 지급 일시를 입력해주세요.');return {payoutId:p.id,revision:p.revision,reference:testRef(ref),testReference:testRef(target),amountKrw:amount(amountInput),paidAt:t.toISOString(),reason:reason(why)};});
     writeButton(content,'TEST 확정 실패 증빙 확인','fail',()=>({payoutId:p.id,revision:p.revision,reference:testRef(ref),testReference:testRef(target),reason:reason(why)}));
    }else for(const action of actions)writeButton(content,({approve:'정산 승인',reject:'반려',begin:'TEST 지급 결과 확인 시작',cancel:'신청 취소'})[action],action,()=>({payoutId:p.id,revision:p.revision,reason:reason(why)}));
   }
   function drawList(){
    if(view==='sources')el(content,'p',`현재 TEST 배분율 ${policyState.policy.authorBps/100}% · 배분 후 공제율 ${policyState.policy.deductionBps/100}%. 이 조건으로 각 소비 수익을 확정합니다.`);
    if(view==='requests'){const s=select(content,'처리 상태',[['ALL','전체'],...Object.entries(labels)],filter);s.onchange=()=>{filter=s.value;offset=0;return load();};}
    if(view==='authors'){const form=el(content,'form',null,'payouts-actions'),input=field(form,'작가 필명 검색',query);const b=button(form,'검색');b.type='submit';form.onsubmit=e=>{e.preventDefault();query=input.value.trim();offset=0;return load();};}
    if(authorFilter){el(content,'p',`선택한 작가 #${authorFilter}의 내역`);button(content,'전체 작가 보기',()=>{authorFilter='';offset=0;return load();});}
    const rows=lastList.items;
    if(view==='requests')table(content,[['신청일',r=>date(r.createdAt)],['작가',r=>r.authorName],['금액',r=>money(r.amountKrw)],['상태',r=>labels[r.status]],['관리',detailButton]],rows);
    if(view==='sources')table(content,[['작품·작가',r=>r.workTitle+' · '+r.authorName],['소비 원화',r=>money(r.sourceAmountKrw)],['원거래',r=>r.orderStatus],['수익 확정',(r,td)=>{
     if(r.earningId){el(td,'span','확정됨');return;}if(!r.eligible){el(td,'span','원거래 확인 필요');return;}
     const why=field(td,'수익 확정 사유');writeButton(td,'이 소비 수익 확정','confirm',()=>({allocationId:r.allocationId,policyVersion:policyState.policy.id,reason:reason(why)}));
    }]],rows);
    if(view==='earnings')table(content,[['작품·확정일',r=>r.workTitle+' / '+date(r.createdAt)],['소비 원화',r=>money(r.sourceAmountKrw)],['배분액',r=>money(r.authorGrossKrw)],['정책 공제',r=>money(r.policyDeductionKrw)],['감액 후 순액',r=>money(r.availableNetKrw)],['감액 기록',(r,td)=>{for(const a of r.adjustments)el(td,'p',`${money(a.amountKrw)} · ${a.reason} · ${date(a.createdAt)}`);if(r.sourceHeld)el(td,'p','원거래 확인 필요');if(admin&&r.availableNetKrw>0){const n=field(td,'감액 금액 (원)','','number'),why=field(td,'감액 근거·사유');writeButton(td,'수익 감액 기록','adjust',()=>({earningId:r.id,amountKrw:amount(n),reason:reason(why)}));}}]],rows);
    if(view==='authors')table(content,[['작가',r=>r.penName+' · '+r.status],['신청 가능액',r=>money(r.summary.availableKrw)],['TEST 지급 대상',(r,td)=>{
     el(td,'p',r.payee.ready?'준비 완료 · '+r.payee.testReference:'준비 중');const ready=select(td,'TEST 지급 대상 상태',[['false','준비 중'],['true','준비 완료']],String(r.payee.ready)),ref=field(td,'TEST 지급 대상 참조',r.payee.testReference||'TEST-'),why=field(td,'지급 대상 변경 사유');
     writeButton(td,'TEST 대상 저장','payee',()=>({authorId:r.id,ready:ready.value==='true',testReference:testRef(ref),revision:r.payee.revision,reason:reason(why)}));
    }],['내역',(r,td)=>{button(td,'소비 수익 보기',()=>{authorFilter=r.id;return navigate('sources');});button(td,'확정 명세 보기',()=>{authorFilter=r.id;return navigate('earnings');});button(td,'신청 보기',()=>{authorFilter=r.id;return navigate('requests');});}]],rows);
    const pager=el(content,'div',null,'payouts-actions');button(pager,'이전',()=>{offset=Math.max(0,offset-50);return load();},offset===0);el(pager,'span',`${lastList.total}건 · ${Math.floor(offset/50)+1}페이지`);button(pager,'다음',()=>{offset=lastList.nextOffset;return load();},!lastList.hasMore);
   }
   await load();
  }
  return Object.freeze({render,leave,reset});
 }
 window.AuthorPayoutsTest=module(false);window.AdminPayoutsTest=module(true);
})();
