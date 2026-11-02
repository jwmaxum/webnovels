// External TEST acceptance only. No credentials or payment destination in storage.
(function(){
 'use strict';let generation=0,dispose=()=>{};
 const actor=()=>window.WebNovelsAuth?.getActor(),endpoint='/api/v2/admin/payout-provider-test';
 const el=(p,t,text)=>{const n=document.createElement(t);if(text!==undefined)n.textContent=String(text);p.append(n);return n;};
 const button=(p,label,fn)=>{const b=el(p,'button',label);b.type='button';b.className='btn btn-outline btn-sm';b.onclick=fn;return b;};
 const input=(p,label,type='text')=>{const l=el(p,'label',label),i=el(l,'input');i.type=type;i.required=true;i.autocomplete=type==='password'?'new-password':'off';i.maxLength=256;return i;};
 const api=(action,data={})=>window.WebNovelsAuth.api(endpoint,{method:'POST',body:JSON.stringify({action,...data})});
 const errors={PAYOUT_TEST_NOT_ACTIVATED:'지급 TEST 인수를 준비 중입니다. 운영 담당자의 별도 설정이 필요합니다.',ADMIN_REAUTH_FAILED:'현재 관리자 비밀번호를 확인해주세요.',ADMIN_FORBIDDEN:'최고 관리자만 사용할 수 있습니다.',RATE_LIMITED:'요청이 많습니다. 1분 후 다시 시도해주세요.',CONFLICT:'기존 요청 또는 설정이 변경되었습니다. 새로고침 후 확인해주세요.',CONFIG_NOT_REVIEWED:'이 요청의 설정 버전은 발송 승인을 받지 않았습니다.',SOURCE_NOT_READY:'참조 정산 상태가 변경되었거나 승인되지 않았습니다.',INVALID_PAYOUT_REQUEST:'입력 형식과 TEST 전용 키를 확인해주세요.',PROVIDER_KEY_REQUIRED:'서버 암호화 키 설정이 필요합니다.',PROVIDER_KEY_UNAVAILABLE:'암호화 키 버전을 확인해야 합니다.'};
 const labels={READY:'발송 전',UNKNOWN:'결과 확인 필요',PENDING:'처리 중',COMPLETED:'TEST 완료',REVIEW:'담당자 검토 필요'};
 function reset(){generation++;dispose();dispose=()=>{};}
 async function render(root,{isCurrent=()=>true,settings=false}={}){
  reset();const seq=generation,owner=actor()?.userId,privateInputs=[];
  dispose=()=>{for(const i of privateInputs)i.value='';root.replaceChildren();};
  const valid=()=>seq===generation&&owner===actor()?.userId&&actor()?.admin?.role==='SUPER_ADMIN'&&actor()?.admin?.is_active!==false&&isCurrent();
  if(!valid())return;root.className='co-panel';el(root,'h3',settings?'지급 전용 TEST 연결':'외부 지급 TEST 인수');
  el(root,'p','실제 작가 지급 기능이 아닙니다. 승인된 모의 정산을 시험 자료로 참조하며, 외부 TEST 결과는 기존 정산 잔액·지급 상태에 반영하지 않습니다.');
  const feedback=el(root,'p');feedback.setAttribute('role','status');let state,busy=false;
  button(root,'상태 새로고침',()=>{if(valid()&&!busy)return render(root,{isCurrent,settings});});
  try{state=await window.WebNovelsAuth.api(endpoint);}catch(e){if(valid())feedback.textContent=errors[e.code]||'지급 TEST 설정을 확인하지 못했습니다.';return;}
  if(!valid())return;
  async function run(task){if(!valid()||busy)return;busy=true;feedback.textContent='처리 상태를 확인 중입니다…';try{await task();}catch(e){if(valid())feedback.textContent=errors[e.code]||'결과를 확인하지 못했습니다. 새로고침하여 기존 요청을 확인해주세요.';}finally{busy=false;}}
  if(settings){
   el(root,'p',state.configured?'저장 버전 '+state.revision+' · 입력 완료':'아직 지급 TEST 키가 없습니다.');
   if(state.configId)el(root,'p','설정 ID: '+state.configId);
   el(root,'p','카드결제 키와 별개입니다. 모든 항목을 입력하여 새 버전으로 저장합니다. 저장만으로 발송이 시작되지 않으며, 진행 중 요청은 기존 버전을 계속 사용합니다.');
   const form=el(root,'form'),inputs={};
   for(const [key,label] of [['secretKey','지급 TEST 시크릿 키'],['securityKey','JWE 보안 키 (64자리 16진수)'],['merchantId','지급 상점 ID'],['webhookKeyBase64','웹훅 HMAC 키 바이트 (Base64)']]){inputs[key]=input(form,label,'password');privateInputs.push(inputs[key]);}
   el(form,'p','웹훅 키의 원문/16진수 해석은 제공자의 서명 샘플로 확인한 뒤 입력해야 합니다. 카드결제 키를 복사하지 마세요.');
   const password=input(form,'현재 최고 관리자 비밀번호','password');password.autocomplete='current-password';password.maxLength=1024;privateInputs.push(password);
   const save=button(form,'새 버전으로 암호화 저장');save.type='submit';save.disabled=!state.keyReady;
   form.onsubmit=e=>{e.preventDefault();return run(async()=>{
    const values=Object.fromEntries(Object.entries(inputs).map(([k,i])=>[k,i.value])),data={revision:state.revision,values,password:password.value};
    privateInputs.forEach(i=>{i.value='';});save.disabled=true;
    try{const r=await api('save',data);if(!valid())return;if(r.saved!==true||typeof r.revision!=='string')throw Error();state={...state,...r};feedback.textContent='새 설정 버전 '+r.revision+'을 저장했습니다. 연동 인수와 별도 발송 승인이 필요합니다.';}
    finally{data.password='';Object.keys(values).forEach(k=>{values[k]='';});if(valid())save.disabled=!state.keyReady;}
   });};return;
  }
  el(root,'p',state.runtimeEnabled?'검토된 설정 버전의 TEST 요청만 발송할 수 있습니다.':'외부 TEST 발송은 비활성입니다. 요청 준비·조회는 저장된 설정과 DB 준비 후 사용할 수 있습니다.');
  const prepare=el(root,'details');el(prepare,'summary','승인된 모의 정산으로 TEST 요청 준비');
  const form=el(prepare,'form'),sourceLabel=el(form,'label','참조할 승인 정산'),source=el(sourceLabel,'select');source.required=true;
  let sourceOffset=0;const sourceStatus=el(form,'p');sourceStatus.setAttribute('role','status');
  async function sources(){
   try{const result=await window.WebNovelsAuth.api('/api/v2/admin/payouts-test?action=requests',{method:'POST',body:JSON.stringify({offset:sourceOffset,status:'APPROVED'})});if(!valid())return;
    source.replaceChildren();const blank=el(source,'option','정산 선택');blank.value='';for(const p of result.items||[]){const o=el(source,'option',p.authorName+' · '+Number(p.amountKrw).toLocaleString('ko-KR')+'원 · '+p.id);o.value=p.id;}
    sourceStatus.textContent=sourceOffset+'번째부터 승인 정산 '+(result.items||[]).length+'건';
   }catch{if(valid())sourceStatus.textContent='승인 정산을 불러오지 못했습니다. 모의 정산 설정을 확인해주세요.';}
  }
  button(form,'승인 정산 이전 목록',()=>run(async()=>{sourceOffset=Math.max(0,sourceOffset-50);await sources();}));
  button(form,'승인 정산 다음 목록',()=>run(async()=>{sourceOffset+=50;await sources();}));
  const destination=input(form,'제공자 TEST 셀러 ID');destination.maxLength=64;privateInputs.push(destination);
  const scheduleLabel=el(form,'label','지급 방식'),schedule=el(scheduleLabel,'select');
  for(const [v,t]of [['EXPRESS','즉시 TEST'],['SCHEDULED','예약 TEST']]){const o=el(schedule,'option',t);o.value=v;}
  const date=input(form,'예약 지급일','date');date.required=false;date.disabled=true;schedule.onchange=()=>{date.disabled=schedule.value!=='SCHEDULED';date.required=!date.disabled;};
  const description=input(form,'거래 표시 (7자 이내)');description.maxLength=7;description.value='TEST정산';
  const save=button(form,'TEST 요청 준비');save.type='submit';save.disabled=!state.configId;
  let pending=null;
  form.onsubmit=e=>{e.preventDefault();return run(async()=>{
   const data={sourceId:source.value,configId:state.configId,destination:destination.value,scheduleType:schedule.value,payoutDate:schedule.value==='SCHEDULED'?date.value:null,transactionDescription:description.value};
   const fingerprint=JSON.stringify(data);if(!pending||pending.fingerprint!==fingerprint)pending={fingerprint,data:{...data,id:crypto.randomUUID()}};
   const r=await api('prepare',pending.data);if(!valid())return;if(!r.job)throw Error();pending=null;feedback.textContent='TEST 요청을 준비했습니다. 목록에서 내용을 확인한 뒤 별도로 발송하세요.';await load();
  });};
  const list=el(root,'div'),paging=el(root,'div');let offset=0;
  async function load(){const r=await api('list',{offset});if(!valid())return;list.replaceChildren();
   if(!r.items?.length)el(list,'p','준비된 외부 TEST 요청이 없습니다.');
   for(const j of r.items||[]){const card=el(list,'section');card.className='co-panel';el(card,'h4',(labels[j.state]||'확인 필요')+' · '+Number(j.amountKrw).toLocaleString('ko-KR')+'원');
    el(card,'p','참조 정산: '+j.sourceId);el(card,'p','TEST 셀러: '+j.destination+' · '+(j.payoutDate||'즉시')+' · '+j.transactionDescription);
    el(card,'p','요청 ID: '+j.id);el(card,'p','설정 ID: '+j.configId);
    const action=j.state==='READY'?'dispatch':'reconcile',b=button(card,j.state==='READY'?'TEST 1회 발송':'제공자 조회·대사',()=>run(async()=>{await api(action,{id:j.id});if(!valid())return;feedback.textContent='요청 상태를 조회했습니다. 결과 불명 상태는 재발송하지 않고 조회로 확인합니다.';await load();}));
    b.disabled=!state.runtimeEnabled||(action==='dispatch'&&j.configId!==state.reviewedConfigId);
    button(card,'조회 증빙 보기',()=>run(async()=>{const d=await api('detail',{id:j.id});if(!valid())return;const evidence=el(card,'ul');for(const item of d.evidence||[])el(evidence,'li',(labels[item.state]||'확인 필요')+' · '+(item.requestedAt||'응답 미확인'));}));
   }
   paging.replaceChildren();const prev=button(paging,'이전',()=>run(async()=>{offset=Math.max(0,offset-20);await load();}));prev.disabled=offset===0;
   const next=button(paging,'다음',()=>run(async()=>{offset+=20;await load();}));next.disabled=offset+20>=r.total;
  }
  await sources();if(valid())await run(load);
 }
 window.AdminPayoutProviderTest=Object.freeze({render,reset});
})();
