/* Manual-first settlement handling. Current earnings remain explicitly TEST. */
(function(){
 'use strict';let generation=0,dispose=()=>{},pending=null,owner=null;
 const actor=()=>window.WebNovelsAuth?.getActor(),el=(p,t,text)=>{const n=document.createElement(t);if(text!==undefined)n.textContent=String(text);p.append(n);return n;};
 const button=(p,text,fn)=>{const b=el(p,'button',text);b.type='button';b.className='btn btn-outline';b.onclick=fn;return b;};
 const input=(p,label,type='text')=>{const l=el(p,'label'),s=el(l,'span',label),i=el(l,'input');l.className='payouts-field';i.type=type;i.maxLength=300;i.autocomplete='off';return i;};
 const date=v=>v?new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' KST':'—';
 const errors={PAYOUT_METHOD_CONFLICT:'Toss 경로가 선택되었거나 기존 이력이 충돌합니다. 수동 송금하지 말고 조회·대사해주세요.',REVISION_CONFLICT:'내역이 변경되었습니다. 최신 내용을 다시 확인해주세요.',PAYOUT_STATE_CONFLICT:'현재 상태에서는 처리할 수 없습니다.',PAYOUT_PROOF_MISMATCH:'송금 금액·대상·일시가 확정 내역과 다릅니다.',PAYOUT_EVIDENCE_CONFLICT:'이미 사용된 거래 증빙입니다.',IDEMPOTENCY_CONFLICT:'같은 요청의 입력 내용이 다릅니다.',TEST_REFERENCE_REQUIRED:'모의 증빙 참조는 TEST-로 시작해야 합니다.',RATE_LIMITED:'요청이 많습니다. 잠시 후 같은 요청으로 확인해주세요.',MANUAL_PAYOUT_WORKFLOW_NOT_ACTIVATED:'수동 지급 기록 기능을 준비 중입니다.',WORKFLOW_HISTORY_LIMIT:'메모 한도에 도달했습니다. 지급 결과 기록은 계속 사용할 수 있습니다.'};
 function leave(){generation++;dispose();dispose=()=>{};}
 function reset(){leave();pending=null;owner=null;}
 async function render(parent,{payout,admin,isCurrent=()=>true,onRefresh=()=>{}}){
  if(owner!==actor()?.userId){reset();owner=actor()?.userId;}else leave();
  const root=el(parent,'section'),seq=generation,user=owner,inputs=[];
  dispose=()=>{inputs.forEach(i=>{i.value='';});root.replaceChildren();};
  const valid=()=>generation===seq&&actor()?.userId===user&&isCurrent()&&(admin?actor()?.admin?.role==='SUPER_ADMIN'&&actor()?.admin?.is_active===true:actor()?.author?.status==='APPROVED');
  if(!valid())return;
  el(root,'h4',admin?'지급 처리 · TEST':'지급 처리 내역 · TEST');
  el(root,'p','기본 방식은 관리자 별도 송금 후 완료 기록입니다. 현재는 TEST 원장으로 실제 송금이나 실제 은행 증빙을 입력하지 않습니다.');
  const status=el(root,'p','지급 경로를 확인 중입니다.');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const controls=el(root,'div'),body=el(root,'div');let busy=false,workflow;
  const request=async(action,data={},legacy=false)=>window.WebNovelsAuth.api('/api/v2/'+(admin?'admin':'creator')+'/'+(legacy?'payouts-test?action='+action:'payout-workflow'),{method:'POST',body:JSON.stringify(legacy?data:{action,...data})});
  const retry=button(controls,'미확인 처리 결과 다시 확인',()=>send());retry.hidden=!pending;
  button(controls,'최신 내역 확인',()=>{if(valid()&&!busy)return load();});
  function lock(){root.setAttribute('aria-busy',String(busy));root.querySelectorAll('button[data-write]').forEach(b=>{b.disabled=busy||!!pending;});retry.hidden=!pending;retry.disabled=busy;}
  function field(label,type='text'){const i=input(body,label,type);inputs.push(i);return i;}
  function reason(i){const s=i.value.trim();if(s.length<3||s.length>300||/[<>\x00-\x1f\x7f]/.test(s))throw Error('처리 사유는 개인정보 없이 3~300자로 입력해주세요.');return s;}
  function ref(i){if(!/^TEST-[A-Za-z0-9_-]{1,72}$/.test(i.value))throw Error('TEST-로 시작하는 모의 거래·증빙 참조를 입력해주세요.');return i.value;}
  function write(label,action,build,legacy=false){const b=button(body,label,async()=>{if(!valid()||busy||pending)return;try{pending={action,legacy,data:{payoutId:payout.id,revision:workflow.revision,requestId:crypto.randomUUID(),...build()}};}catch(e){status.textContent=e.message;return;}await send();});b.setAttribute('data-write','true');return b;}
  async function send(){if(!valid()||busy||!pending)return;busy=true;lock();const op=pending;status.textContent='기록 결과를 확인 중입니다.';
   try{const result=await request(op.action,op.data,op.legacy);if(!valid()||op!==pending)return;if(typeof result.replayed!=='boolean')throw Error('INVALID_RESPONSE');pending=null;status.textContent=result.replayed?'같은 요청의 기존 처리 결과를 확인했습니다.':'TEST 처리 내용을 기록했습니다.';}
   catch(e){if(!valid())return;if([400,403,404,409].includes(e.status))pending=null;status.textContent=(errors[e.code]||'결과를 확인하지 못했습니다.')+(pending?' 같은 요청으로 다시 확인하세요.':'');}
   finally{busy=false;if(valid()){lock();await load(true);if(valid())await onRefresh();}}
  }
  async function load(keep=false){if(!valid()||busy)return;busy=true;lock();
   try{const r=await request('detail',{payoutId:payout.id});if(!valid())return;if(r.mode!=='TEST'||r.livePayouts!==false||r.workflow?.payoutId!==payout.id)throw Error();workflow=r.workflow;draw();if(!keep)status.textContent=pending?'미확인 처리 대상: '+pending.data.payoutId+' · 같은 요청으로 먼저 확인해주세요.':'최신 지급 내역입니다.';}
   catch(e){if(valid()){body.replaceChildren();status.textContent=errors[e.code]||'지급 경로를 확인하지 못했습니다. 확인 전 송금하지 마세요.';}}
   finally{busy=false;if(valid())lock();}
  }
  function draw(){body.replaceChildren();inputs.length=0;
   const w=workflow,method={MANUAL:'관리자 별도 송금',TOSS_TEST:'Toss 지급대행 TEST',LEGACY_REVIEW:'기존 이력 확인 필요'}[w.method];el(body,'p','지급 방식: '+method);
   el(body,'p','확정 금액: '+Number(w.amountKrw).toLocaleString('ko-KR')+'원 · TEST 대상: '+w.payeeReference);
   el(body,'p','대상 확정: '+date(w.startedAt)+' · 완료: '+date(w.completedAt));
   if(w.proof){el(body,'p',w.proof.outcome==='PAID'?'관리자 송금 완료 기록 · TEST':'관리자 미송금 확정 기록 · TEST');if(admin)el(body,'p','거래 참조: '+w.proof.transactionReference+' · 증빙 보관 참조: '+w.proof.documentReference);}
   if(w.provider){el(body,'p','제공자 TEST 상태: '+({READY:'발송 전',UNKNOWN:'결과 불명',PENDING:'처리 중',COMPLETED:'외부 TEST 완료',REVIEW:'검토 필요'}[w.provider.state]||'확인 필요')+' · 최근 조회: '+date(w.provider.lastObservedAt));el(body,'p','외부 TEST 응답은 실제 정산 완료가 아닙니다. 수동 송금으로 전환하지 말고 외부 지급 TEST 목록에서 조회·대사하세요.');}
   if(!admin){if(!w.selected&&['REQUESTED','APPROVED'].includes(w.status)){const why=field('취소 사유');write('신청 취소','cancel',()=>({reason:reason(why)}),true);}return;}
   const history=el(body,'details');el(history,'summary','관리자 처리 이력');for(const h of w.history||[])el(history,'p',date(h.createdAt)+' · '+({START:'대상 확정',ADOPT:'기존 미확인 건 인수',COMPLETE:'완료 기록',FAILURE:'미송금 확정',NOTE:'메모',HOLD:'대사 필요'}[h.kind]||h.kind)+' · '+h.note);
   const why=field('처리 사유 · 개인정보 입력 금지');
   if(w.status==='REQUESTED'){write('정산 승인','approve',()=>({reason:reason(why)}),true);write('반려','reject',()=>({reason:reason(why)}),true);}
   if(!w.selected&&w.status==='APPROVED'){
    el(body,'ol').textContent='1. 송금 대상 확정 → 2. 관리자가 별도 송금 → 3. 증빙 확인 후 완료 기록';
    el(body,'p','대상 확정 버튼은 은행 이체를 실행하지 않습니다. Toss 자동 지급은 별도 계약·검증 후 아래 외부 지급 TEST 영역에서 선택합니다.');
    write('수동 송금 대상 확정','start',()=>({reason:reason(why)}));write('반려','reject',()=>({reason:reason(why)}),true);
   }
   if(!w.selected&&w.status==='UNKNOWN'){el(body,'p','이전 미확인 건입니다. 이미 송금했을 수 있으므로 재송금하지 말고 원래 거래부터 확인하세요.');write('기존 미확인 건 인수','start',()=>({reason:reason(why)}));}
   if(w.method==='MANUAL'&&w.selected&&w.status==='UNKNOWN'){
    el(body,'p','별도 송금 결과를 대조한 뒤 기록합니다. 결과가 불명확하면 아래 대사 필요 메모를 남기세요.');
    const transaction=field('TEST 송금 거래 참조'),document=field('TEST 증빙 보관 참조'),target=field('증빙의 TEST 지급 대상'),amount=field('증빙의 송금 금액 (원)','number'),at=field('송금 일시 (한국 시간)','datetime-local');at.step='1';amount.min='1';amount.step='1';
    const confirmed=field('송금 결과와 증빙을 대조했습니다','checkbox');
    write('송금 완료로 기록 · TEST','complete',()=>{
     if(!confirmed.checked)throw Error('송금 결과와 증빙을 확인해주세요.');const value=Number(amount.value),time=new Date(at.value+'+09:00');
     if(!/^[1-9]\d*$/.test(amount.value)||!Number.isSafeInteger(value)||value!==w.amountKrw)throw Error('확정 금액과 증빙 금액이 일치해야 합니다.');
     if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(at.value)||!Number.isFinite(time.getTime())||new Date(time.getTime()+9*3600000).toISOString().slice(0,at.value.length)!==at.value)throw Error('올바른 한국 시간 송금 일시를 입력해주세요.');
     return {reference:ref(transaction),documentReference:ref(document),testReference:ref(target),amountKrw:value,paidAt:time.toISOString(),reason:reason(why)};
    });
    const failed=field('은행 내역으로 미송금을 확정했습니다','checkbox');
    write('미송금 확정으로 종료 · TEST','failure',()=>{if(!failed.checked)throw Error('결과 불명 상태는 실패로 종료할 수 없습니다. 미송금을 확인해주세요.');return {reference:ref(transaction),documentReference:ref(document),testReference:ref(target),reason:reason(why)};});
   }
   if(['APPROVED','UNKNOWN'].includes(w.status))write('대사 필요 메모','hold',()=>({reason:reason(why)}));
   write('관리자 메모 기록','note',()=>({reason:reason(why)}));
   el(body,'p','메모는 관리자에게만 표시됩니다. 메모 기록만으로 완료·취소·예약금 해제 또는 재송금하지 않습니다.');
  }
  await load();
 }
 window.PayoutWorkflow=Object.freeze({render,leave,reset});
})();
