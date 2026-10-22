// Provider credentials are sent once over the authenticated API. Never keep them in
// storage, HTML attributes, logs, or render a stored credential back into an input.
(function(){
 'use strict';let generation=0,clearCurrent=()=>{};
 const specs={TOSS:{title:'토스 카드결제',fields:[['clientKey','클라이언트 키'],['secretKey','시크릿 키'],['merchantId','상점 ID (MID)']]},
  PASS:{title:'PASS 본인확인 (PortOne)',fields:[['storeId','상점 ID'],['channelKey','채널 키'],['apiSecret','API Secret'],
   ['pgProvider','본인확인 업체',['DANAL','INICIS_UNIFIED']],['identifierType','본인 식별값',['CI','DI']],['hmacKey','CI/DI 변환키 (64자리 16진수)'],['keyVersion','변환키 버전']]}};
 const el=(p,t,text)=>{const n=document.createElement(t);if(text!==undefined)n.textContent=text;p.append(n);return n;};
 const errors={ADMIN_REAUTH_FAILED:'관리자 비밀번호를 확인해주세요.',ADMIN_FORBIDDEN:'최고 관리자만 설정할 수 있습니다.',
  RATE_LIMITED:'변경 시도가 많습니다. 1분 후 다시 시도해주세요.',CONFLICT:'다른 관리자가 변경했습니다. 새로고침 후 확인해주세요.',
  INVALID_PROVIDER_SETTINGS:'키 형식과 TEST/LIVE 구분, 본인확인 업체·식별값 조합을 확인해주세요.',
  PROVIDER_KEY_REQUIRED:'서버의 암호화 키 설정이 필요합니다.',PROVIDER_KEY_UNAVAILABLE:'암호화 키 버전을 확인해야 합니다. 운영 담당자에게 문의해주세요.'};
 async function render(root,{isCurrent=()=>true}={}){
  clearCurrent();const seq=++generation,owner=window.WebNovelsAuth?.getActor()?.userId;
  const privateInputs=[];clearCurrent=()=>{privateInputs.forEach(input=>{input.value='';});root.replaceChildren();};
  const valid=()=>seq===generation&&owner===window.WebNovelsAuth?.getActor()?.userId&&isCurrent();
  root.replaceChildren();if(window.WebNovelsAuth?.getActor()?.admin?.role!=='SUPER_ADMIN')return;
  el(root,'h3','외부 서비스 연결 준비');
  const reload=el(root,'button','설정 새로고침');reload.type='button';reload.className='btn btn-outline btn-sm';reload.onclick=()=>render(root,{isCurrent});
  el(root,'p','무료 베타에서는 결제와 PASS를 사용하지 않습니다. 계약 후 이곳에 키를 저장할 수 있습니다. 저장만으로 결제·본인확인이 시작되지 않습니다.');
  const status=el(root,'p','설정 상태를 확인 중입니다…');status.setAttribute('role','status');
  let result;try{result=await window.WebNovelsAuth.api('/api/v2/admin/providers');}catch(e){if(valid())status.textContent=errors[e.code]||'설정 상태를 확인하지 못했습니다.';return;}
  if(!valid())return;status.textContent=result.keyReady?'키는 암호화하여 저장되며 저장된 값은 다시 표시하지 않습니다.':'키 저장을 준비 중입니다. 운영 담당자가 Cloudflare의 암호화 키와 버전을 먼저 설정해야 합니다.';
  for(const [provider,spec] of Object.entries(specs)){
   const card=el(root,'section');card.className='co-panel';el(card,'h4',spec.title);
   const form=el(card,'form'),modeLabel=el(form,'label','환경'),mode=el(modeLabel,'select');
   for(const [value,label] of [['TEST','TEST · 시험 환경'],['LIVE','LIVE · 계약한 운영 환경']]){const o=el(mode,'option',label);o.value=value;}
   const summary=el(form,'p'),inputs={};
   for(const [field,label,choices] of spec.fields){const wrapper=el(form,'label',label),input=el(wrapper,choices?'select':'input');
    input.name=field;input.setAttribute('aria-label',spec.title+' '+label);
    if(choices){const empty=el(input,'option','기존 값 유지 / 선택');empty.value='';for(const value of choices){const o=el(input,'option',value);o.value=value;}}
    else{input.type='password';input.autocomplete='new-password';input.spellcheck=false;input.maxLength=2048;input.placeholder='새 값 입력 (비워두면 기존 값 유지)';}
    inputs[field]=input;privateInputs.push(input);
   }
   const passwordLabel=el(form,'label','현재 최고 관리자 비밀번호'),password=el(passwordLabel,'input');
   password.type='password';password.autocomplete='current-password';password.maxLength=1024;password.required=true;privateInputs.push(password);
   const actions=el(form,'div');actions.className='cms-toolbar';const save=el(actions,'button','암호화하여 저장');save.type='submit';save.className='btn btn-primary btn-sm';
   const clear=el(actions,'button','이 환경의 저장 키 삭제');clear.type='button';clear.className='btn btn-outline btn-sm';
   const feedback=el(form,'p');feedback.setAttribute('role','status');let current,busy=false;
   function refresh(){current=result.items.find(x=>x.provider===provider&&x.mode===mode.value)||{revision:'0',configuredFields:[]};
    summary.textContent=(current.enabled?'운영 승인됨':current.complete?'입력 완료 · 연동 검증·운영 승인 대기':'미설정 / 일부 입력')+' · 저장된 항목: '+
     (current.configuredFields.map(f=>spec.fields.find(x=>x[0]===f)?.[1]).filter(Boolean).join(', ')||'없음');
    save.disabled=busy||!result.keyReady;clear.disabled=busy||!result.keyReady||!current.configuredFields.length;
   }
   mode.onchange=()=>{Object.values(inputs).forEach(i=>{i.value='';});password.value='';feedback.textContent='';refresh();};refresh();
   async function submit(action){
    if(!valid()||busy||!result.keyReady)return;if(!password.value){feedback.textContent='현재 관리자 비밀번호를 입력해주세요.';return;}
    const values=Object.fromEntries(Object.entries(inputs).filter(([,i])=>i.value).map(([k,i])=>[k,i.value]));
    const data={provider,mode:mode.value,revision:current.revision,action,password:password.value,...(action==='save'?{values}:{})};
    Object.values(inputs).forEach(i=>{i.value='';i.disabled=true;});password.value='';password.disabled=true;mode.disabled=true;busy=true;refresh();feedback.textContent='저장 상태를 확인 중입니다…';
    try{const saved=await window.WebNovelsAuth.api('/api/v2/admin/providers',{method:'POST',body:JSON.stringify(data)});data.password='';
     if(!valid())return;if(saved.saved!==true||saved.provider!==provider||saved.mode!==mode.value||typeof saved.revision!=='string'||!Array.isArray(saved.configuredFields))throw Error('INVALID_SAVE_RESPONSE');
     const index=result.items.findIndex(x=>x.provider===provider&&x.mode===mode.value);if(index>=0)result.items[index]=saved;else result.items.push(saved);
     feedback.textContent=action==='clear'?'저장 키를 삭제했습니다. 해당 서비스는 비활성 상태입니다.':'키를 저장했습니다. 실제 서비스 활성화는 계약·연동 검증 후 별도로 진행합니다.';
    }catch(e){if(valid())feedback.textContent=errors[e.code]||'저장을 확인하지 못했습니다. 새로고침하여 저장 상태를 확인해주세요.';}
    finally{data.password='';Object.keys(values).forEach(k=>{values[k]='';});busy=false;if(valid()){Object.values(inputs).forEach(i=>{i.disabled=false;});password.disabled=false;mode.disabled=false;refresh();}}
   }
   form.onsubmit=e=>{e.preventDefault();return submit('save');};clear.onclick=()=>submit('clear');
  }
  const checklist=el(root,'ol');for(const s of ['사업자 계약 및 TEST/LIVE 키 발급',
   'TEST 환경에서 결제·취소·환불 또는 본인확인 성공·취소·만료 검증',
   '운영 약관·개인정보·환불 및 정산 준비 확인',
   '검증한 설정 버전을 운영 담당자가 승인하고 서비스 기능 활성화'])el(checklist,'li',s);
 }
 window.AdminProviderSettings=Object.freeze({render,reset(){generation++;clearCurrent();clearCurrent=()=>{};}});
})();
