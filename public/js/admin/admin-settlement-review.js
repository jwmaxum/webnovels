// Sensitive settlement documents stay in this view's memory and authenticated API only.
(function(){
  'use strict';
  let generation=0,disposeCurrent=()=>{};
  const actor=()=>window.WebNovelsAuth?.getActor();
  const allowed=()=>actor()?.admin?.role==='SUPER_ADMIN'&&actor().admin.is_active!==false;
  const decimal=value=>typeof value==='string'&&/^[1-9]\d{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n;
  const statuses={PENDING:'서류 확인 대기',APPROVED:'서류 확인 완료',NEEDS_CHANGES:'보완 필요',WITHDRAWN:'철회',EXPIRED:'보관 기간 만료'};
  const types={INDIVIDUAL:'개인 작가',SOLE_PROPRIETOR:'개인사업자',CORPORATION:'법인'};
  const documents={RESIDENT_CARD:'주민등록증',DRIVER_LICENSE:'운전면허증',PASSPORT:'여권'};
  const el=(parent,tag,value,cls)=>{const node=document.createElement(tag);if(value!=null)node.textContent=String(value);if(cls)node.className=cls;parent.append(node);return node;};
  const button=(parent,label,onclick)=>{const node=el(parent,'button',label,'btn btn-outline');node.type='button';node.onclick=onclick;return node;};
  const field=(parent,label,tag='input')=>{const wrap=el(parent,'label',label),input=el(wrap,tag);input.className='form-input';return input;};
  const date=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'—';
  const errorText=error=>({ADMIN_FORBIDDEN:'최고 관리자만 정산 서류를 확인할 수 있습니다.',SETTLEMENT_REAUTH_REQUIRED:'현재 최고 관리자 비밀번호를 다시 입력해주세요.',
    SETTLEMENT_CONFLICT:'신청 또는 계좌 정보가 변경되었습니다. 목록을 새로고침한 뒤 다시 확인해주세요.',SETTLEMENT_DOCUMENT_UNAVAILABLE:'이미 검토했거나 만료된 서류입니다. 목록을 새로고침해주세요.',
    SETTLEMENT_NOT_ACTIVATED:'정산 정보 등록 연결이 준비되지 않았습니다.',RATE_LIMITED:'확인 요청이 많습니다. 잠시 후 다시 시도해주세요.'})[error?.code]||'결과를 확인하지 못했습니다. 연결과 현재 상태를 다시 확인해주세요.';
  function reset(){generation++;disposeCurrent();disposeCurrent=()=>{};}
  function imageUrl(image){
    if(!image||!['image/jpeg','image/png'].includes(image.mime)||typeof image.data!=='string'||image.data.length>204800||!image.data.length||image.data.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(image.data))throw Error('INVALID_DOCUMENT');
    const raw=atob(image.data);if(raw.length>153600)throw Error('INVALID_DOCUMENT');
    const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    const valid=image.mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b);
    if(!valid)throw Error('INVALID_DOCUMENT');
    return URL.createObjectURL(new Blob([bytes],{type:image.mime}));
  }
  async function render(root,{isCurrent=()=>true,offset=0}={}){
    reset();const seq=generation,user=actor()?.userId;
    const valid=()=>seq===generation&&actor()?.userId===user&&allowed()&&isCurrent()&&root.isConnected!==false;
    let detailsTurn=0,closeSensitive=()=>{},privateInputs=[];
    const clear=()=>{detailsTurn++;closeSensitive();closeSensitive=()=>{};privateInputs.forEach(input=>{input.value='';});privateInputs=[];root.replaceChildren();};
    disposeCurrent=clear;root.replaceChildren();
    if(!allowed()){el(root,'p','정산 서류 확인은 최고 관리자 권한이 필요합니다.');return;}
    el(root,'h3','정산 정보·서류 확인');
    el(root,'p','가림 처리된 신분증과 사업자 증빙을 검토합니다. 서류 확인 완료는 PASS 인증·은행 예금주 확인·정산 지급 완료를 뜻하지 않습니다.');
    const reload=button(root,'정산 신청 새로고침',()=>{if(valid())return render(root,{isCurrent,offset});});
    const status=el(root,'p','신청 목록을 불러오는 중입니다.');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const list=el(root,'div',null,'settlement-review-list'),detail=el(root,'section',null,'settlement-review-detail');detail.hidden=true;
    const close=()=>{detailsTurn++;closeSensitive();closeSensitive=()=>{};detail.replaceChildren();detail.hidden=true;};
    const message=value=>{if(valid())status.textContent=value;};
    const open=application=>{
      if(!valid())return;close();const turn=++detailsTurn,current=()=>valid()&&turn===detailsTurn;
      const urls=[],inputs=[],privateNodes=[];let pending=null,busy=false;
      closeSensitive=()=>{urls.splice(0).forEach(url=>URL.revokeObjectURL(url));inputs.forEach(input=>{input.value='';});privateNodes.forEach(node=>{node.textContent='';if(node.tagName==='IMG')node.removeAttribute('src');});pending=null;detail.replaceChildren();detail.hidden=true;};
      detail.hidden=false;
      el(detail,'h4',`${application.penName||'작가'} · ${types[application.applicantType]}`);
      button(detail,'서류 확인 닫기',()=>{if(current()){close();status.textContent='열람한 개인정보와 이미지를 화면에서 지웠습니다.';}});
      el(detail,'p','열람·검토 사유에는 주민등록번호나 계좌번호를 입력하지 마세요. 서류 열람은 감사 기록에 남고, 검토가 끝나면 첨부 이미지를 파기합니다.');
      const reveal=el(detail,'form',null,'settlement-review-form');reveal.autocomplete='off';
      const reason=field(reveal,'열람 사유 (3~200자)');reason.required=true;reason.minLength=3;reason.maxLength=200;inputs.push(reason);
      const password=field(reveal,'현재 최고 관리자 비밀번호');password.type='password';password.autocomplete='current-password';password.maxLength=256;password.required=true;inputs.push(password);privateInputs.push(password);
      const view=button(reveal,'비밀번호 확인 후 서류 열람');view.type='submit';
      const feedback=el(detail,'p');feedback.setAttribute('role','status');
      const content=el(detail,'div',null,'settlement-review-private');
      reveal.onsubmit=async event=>{
        event.preventDefault();if(!current()){closeSensitive();return;}if(busy)return;
        const text=reason.value.trim();if(text.length<3||text.length>200||!password.value){feedback.textContent='열람 사유와 현재 최고 관리자 비밀번호를 입력해주세요.';return;}
        busy=true;view.disabled=true;feedback.textContent='관리자 확인 후 서류를 불러오는 중입니다.';
        const payload={revision:application.revision,reason:text,password:password.value};password.value='';
        try{
          const result=await window.WebNovelsAuth.api('/api/v2/admin/settlements/identity/'+encodeURIComponent(application.authorId)+'/reveal',{method:'POST',body:JSON.stringify(payload)});
          if(!current())return;const data=result?.details;
          if(!data||result.application?.authorId!==application.authorId||result.application?.revision!==application.revision||result.application?.status!=='PENDING'||
            !['legalName','birthDate','postalCode','address','addressDetail'].every(key=>typeof data[key]==='string'&&data[key].length<=500)||
            !['companyName','businessNumber'].every(key=>data[key]==null||typeof data[key]==='string'&&data[key].length<=500))throw Error('INVALID_DOCUMENT');
          const next=[];try{next.push(imageUrl(data.identityImage));if(data.businessImage)next.push(imageUrl(data.businessImage));}catch(e){next.forEach(url=>URL.revokeObjectURL(url));throw e;}
          urls.splice(0).forEach(url=>URL.revokeObjectURL(url));urls.push(...next);content.replaceChildren();
          const values=el(content,'dl',null,'settlement-review-values');
          for(const [key,label]of [['legalName','성명 / 대표자명'],['birthDate','생년월일'],['postalCode','우편번호'],['address','주소'],['addressDetail','상세 주소'],['companyName','상호 / 법인명'],['businessNumber','사업자등록번호']]){
            if(typeof data[key]!=='string'||!data[key])continue;el(values,'dt',label);privateNodes.push(el(values,'dd',data[key]));
          }
          next.forEach((url,index)=>{const figure=el(content,'figure'),image=el(figure,'img');image.src=url;image.alt=index?'사업자등록 증빙':'가림 처리된 '+documents[application.documentType];image.className='settlement-review-image';privateNodes.push(image);el(figure,'figcaption',image.alt);});
          for(const key of Object.keys(data))data[key]=null;
          reveal.hidden=true;feedback.textContent='서류와 입력 정보를 확인한 뒤 검토 결과를 저장하세요.';
          const form=el(content,'form',null,'settlement-review-form');form.autocomplete='off';
          const confirmedLabel=el(form,'label'),confirmed=el(confirmedLabel,'input');confirmed.type='checkbox';confirmed.required=true;el(confirmedLabel,'span','이 신청의 증빙과 입력 정보를 직접 확인했습니다.');
          const note=field(form,'검토 사유 / 보완 안내 (3~200자)','textarea');note.required=true;note.minLength=3;note.maxLength=200;inputs.push(note);
          const reviewPassword=field(form,'현재 최고 관리자 비밀번호 (결과 저장 시 재확인)');reviewPassword.type='password';reviewPassword.autocomplete='current-password';reviewPassword.maxLength=256;reviewPassword.required=true;inputs.push(reviewPassword);privateInputs.push(reviewPassword);
          const actions=el(form,'div',null,'settlement-review-actions'),buttons=[];
          const commit=async decision=>{
            if(!current()){closeSensitive();return;}if(busy)return;
            if(!pending){if(!confirmed.checked||note.value.trim().length<3||note.value.trim().length>200||!reviewPassword.value){feedback.textContent='직접 확인 표시와 검토 사유, 현재 관리자 비밀번호를 입력해주세요.';return;}
              pending={key:crypto.randomUUID(),data:{revision:application.revision,decision,note:note.value.trim()}};}
            if(!reviewPassword.value){feedback.textContent='같은 검토 결과를 다시 확인하려면 현재 관리자 비밀번호를 입력해주세요.';return;}
            busy=true;buttons.forEach(item=>{item.disabled=true;});confirmed.disabled=true;note.disabled=true;
            const request={...pending.data,password:reviewPassword.value};reviewPassword.value='';feedback.textContent='검토 결과를 저장하는 중입니다.';
            try{
              const saved=await window.WebNovelsAuth.api('/api/v2/admin/settlements/identity/'+encodeURIComponent(application.authorId)+'/review',{method:'POST',headers:{'Idempotency-Key':pending.key},body:JSON.stringify(request)});
              if(!current())return;
              if(!saved.application||saved.application.authorId!==application.authorId||!decimal(saved.application.revision)||saved.application.status!==pending.data.decision)throw Error('INVALID_REVIEW_RESULT');
              const approved=pending.data.decision==='APPROVED';close();message(approved?'서류 확인을 완료했습니다. 첨부 이미지는 파기되며 실제 지급과 계좌 확인은 별도입니다.':'보완을 요청했습니다. 첨부 이미지는 파기되며 작가가 새로 제출해야 합니다.');
              application.status=saved.application.status;application.documentAvailable=false;
              rowState.textContent=statuses[application.status];openButton.disabled=true;
            }catch(error){if(current()){
              const known=[400,401,403,404,409,429].includes(error?.status);
              if(known)pending=null;
              feedback.textContent=pending?'결과를 확인하지 못했습니다. 비밀번호를 다시 입력하고 같은 결정으로 재시도해주세요.':errorText(error);
              if([401,403,404,409].includes(error?.status)){openButton.disabled=true;close();message(errorText(error));return;}
              confirmed.disabled=!!pending;note.disabled=!!pending;
              buttons.forEach(item=>{item.disabled=!!pending&&item.dataset.decision!==pending.data.decision;});
            }}finally{request.password='';reviewPassword.value='';busy=false;}
          };
          for(const [decision,label]of [['APPROVED','서류 확인 완료'],['NEEDS_CHANGES','보완 요청']]){const action=button(actions,label,()=>commit(decision));action.dataset.decision=decision;buttons.push(action);}
          form.onsubmit=event=>event.preventDefault();
        }catch(error){if(current()){feedback.textContent=errorText(error);content.replaceChildren();}}
        finally{payload.password='';password.value='';busy=false;if(current())view.disabled=false;}
      };
      // The originating metadata row remains inert when its document is consumed.
      const rowState=application.rowState,openButton=application.openButton;
    };
    root.setAttribute?.('aria-busy','true');
    try{
      const result=await window.WebNovelsAuth.api('/api/v2/admin/settlements/identity?offset='+offset);if(!valid())return;
      if(!Array.isArray(result.applications)||result.applications.length>30||!Number.isSafeInteger(result.total)||result.total<0||result.pageSize!==30||!result.applications.every(item=>decimal(item.authorId)&&decimal(item.revision)&&Object.hasOwn(statuses,item.status)&&Object.hasOwn(types,item.applicantType)&&Object.hasOwn(documents,item.documentType)&&typeof item.penName==='string'&&item.penName.length<=100))throw Error('INVALID_LIST');
      const table=el(list,'table',null,'settlement-review-table');el(table,'caption','작가별 정산 정보 확인 신청');const head=el(table,'thead'),heading=el(head,'tr');
      for(const label of ['작가','정산 대상','증빙 종류','접수일','상태','관리']){const cell=el(heading,'th',label);cell.setAttribute('scope','col');}
      const body=el(table,'tbody');
      for(const item of result.applications){const row=el(body,'tr');el(row,'td',item.penName||'필명 미등록');el(row,'td',types[item.applicantType]);el(row,'td',documents[item.documentType]);el(row,'td',date(item.submittedAt));const rowState=el(row,'td',statuses[item.status]),actions=el(row,'td'),openButton=button(actions,'서류 열람',()=>open(application));
        const application={...item,rowState,openButton};openButton.disabled=item.status!=='PENDING'||item.documentAvailable!==true;
      }
      status.textContent=result.total?`총 ${result.total}건 · ${Math.floor(offset/30)+1}페이지`:'접수된 정산 정보 확인 신청이 없습니다.';
      const pager=el(root,'div',null,'settlement-review-actions');const prev=button(pager,'이전 신청',()=>{if(valid())return render(root,{isCurrent,offset:Math.max(0,offset-30)});}),next=button(pager,'다음 신청',()=>{if(valid())return render(root,{isCurrent,offset:offset+30});});prev.disabled=offset===0;next.disabled=offset+result.applications.length>=result.total;
    }catch(error){if(valid()){status.textContent=errorText(error);list.replaceChildren();}}
    finally{if(valid()){reload.disabled=false;root.setAttribute?.('aria-busy','false');}}
  }
  window.AdminSettlementReview=Object.freeze({render,reset});
  window.addEventListener?.('pagehide',reset);
  document.addEventListener?.('visibilitychange',()=>{if(document.visibilityState==='hidden')reset();});
})();
