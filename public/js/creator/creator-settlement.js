// Settlement preparation only: document review never enables payments or PASS.
(function () {
  'use strict';
  const actor=()=>window.WebNovelsAuth?.getActor();
  let epoch=0,summaryEpoch=0,dispose=null,statusUpdate=null;
  const node=(parent,tag,value,cls)=>{const element=document.createElement(tag);if(value!==undefined)element.textContent=value;if(cls)element.className=cls;parent.append(element);return element;};
  const button=(parent,title,action)=>{const element=node(parent,'button',title,'btn btn-outline');element.type='button';element.onclick=action;return element;};
  const field=(parent,title,name,type='text')=>{const label=node(parent,'label',title),input=node(label,'input',undefined,'form-input');input.name=name;input.type=type;input.autocomplete='off';return input;};
  const error=e=>({SETTLEMENT_CONFLICT:'다른 변경이 먼저 저장됐습니다. 상태를 새로고침한 뒤 다시 신청해주세요.',SETTLEMENT_REAUTH_REQUIRED:'현재 로그인 비밀번호를 확인해주세요. 추가 인증이 설정된 계정은 운영자에게 문의해주세요.',INVALID_SETTLEMENT_DETAILS:'입력 항목을 확인해주세요.',INVALID_SETTLEMENT_IMAGE:'JPEG/PNG 이미지를 가린 뒤 다시 확정해주세요.',SETTLEMENT_NOT_ACTIVATED:'정산 정보 등록 연결을 준비 중입니다.',PRIVACY_TRANSFER_NOT_READY:'개인정보 보관·국외이전 조건 확인 전에는 자료를 제출할 수 없습니다.',POLICY_CONFIRMATION_REQUIRED:'현재 안내문과 개인정보 처리에 동의해주세요.',RATE_LIMITED:'확인 요청이 많습니다. 잠시 후 다시 시도해주세요.',IDEMPOTENCY_CONFLICT:'이전 신청과 내용이 다릅니다. 상태를 새로고침해주세요.',IMAGE_PIXEL_LIMIT:'이미지는 변당 10,000px·1,200만 화소 이하여야 합니다.',IMAGE_INVALID:'JPEG/PNG 이미지를 읽을 수 없습니다. 다시 저장한 파일을 선택해주세요.',IMAGE_TOO_LARGE:'원본 파일은 10 MiB 이하로 선택해주세요.',IMAGE_REDACTION_REQUIRED:'불필요한 번호를 가리고 이미지를 확정해주세요.'})[e?.code||e?.message]||'응답을 확인하지 못했습니다. 같은 신청의 결과를 다시 확인해주세요.';
  const api=(path='',body,key)=>window.WebNovelsAuth.api('/api/v2/creator/settlement'+path,body?{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(body)}:undefined);
  function reset(){epoch++;dispose?.();dispose=null;statusUpdate=null;}
  function updateBankSummary(value){summaryEpoch++;const el=document.getElementById('creatorBankInfo');if(el)el.textContent=value?'등록 · 계좌 확인 대기':'미등록';}
  async function refreshSummary(){
    const turn=++summaryEpoch,user=actor()?.userId;if(!user||actor()?.author?.status!=='APPROVED')return;
    const target=document.getElementById('creatorBankInfo');if(target)target.textContent='확인 중';
    try{const result=await window.WebNovelsAuth.api('/api/v2/creator/dashboard?action=home');if(turn===summaryEpoch&&actor()?.userId===user&&actor()?.author?.status==='APPROVED')updateBankSummary(result.bankRegistered===true);}
    catch{if(turn===summaryEpoch&&actor()?.userId===user&&target)target.textContent='상태 확인 필요';}
  }
  async function capability(){try{return await api();}catch{return {enabled:false};}}
  async function refreshStatus(){const apply=statusUpdate;if(!apply)return;const result=await capability();if(statusUpdate===apply&&result.enabled===true)apply(result.application||null);}
  function imageEditor(parent,label,valid){
    const root=node(parent,'section',undefined,'settlement-image-editor');node(root,'h4',label);
    const upload=field(root,'JPEG/PNG 원본 선택 (이 기기에서만 처리)','', 'file');upload.accept='image/jpeg,image/png';
    node(root,'p','주민번호 뒷자리, 면허·여권 번호, MRZ·바코드와 불필요한 주소를 가리세요. 성명·사진·생년월일은 확인할 수 있도록 남겨주세요. 원본 파일은 전송하지 않습니다.');
    const canvas=node(root,'canvas',undefined,'settlement-image-canvas');canvas.hidden=true;canvas.setAttribute('aria-label',label+' 번호 가리기 편집');
    const tools=node(root,'div',undefined,'settlement-image-tools');tools.hidden=true;
    const help=node(root,'p');help.setAttribute('role','status');help.setAttribute('aria-live','polite');
    const preview=node(root,'img');preview.hidden=true;preview.alt=label+' 가림 처리한 제출 이미지';
    let bitmap=null,prepared=null,previewUrl=null,selection=0,rectangles=[],drag=null,encoding=false;
    const clearPrepared=()=>{prepared=null;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;preview.removeAttribute('src');preview.hidden=true;};
    function paint(){if(!bitmap)return;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);ctx.fillStyle='#000';for(const r of rectangles)ctx.fillRect(r.x,r.y,r.width,r.height);}
    function mask(r){if(!valid()||!bitmap||encoding)return;clearPrepared();rectangles.push(r);paint();help.textContent='가림 영역 '+rectangles.length+'개. 가린 이미지를 확정해주세요.';}
    const coordinate=node(tools,'details'),summary=node(coordinate,'summary','키보드로 가릴 영역 입력');
    const coords={};for(const [key,title,value]of [['left','왼쪽 위치 (%)',0],['top','위쪽 위치 (%)',50],['width','너비 (%)',100],['height','높이 (%)',50]]){const input=field(coordinate,title,'','number');input.min=0;input.max=100;input.step=1;input.value=String(value);coords[key]=input;}
    button(coordinate,'입력한 영역 가리기',()=>{const values=Object.fromEntries(Object.entries(coords).map(([k,v])=>[k,Number(v.value)]));if(Object.values(values).some(v=>!Number.isFinite(v)||v<0||v>100)||values.width<1||values.height<1||values.left+values.width>100||values.top+values.height>100){help.textContent='이미지 안의 영역을 0~100%로 입력해주세요.';return;}mask({x:canvas.width*values.left/100,y:canvas.height*values.top/100,width:canvas.width*values.width/100,height:canvas.height*values.height/100});});
    button(tools,'전체 가리기',()=>mask({x:0,y:0,width:canvas.width,height:canvas.height}));
    button(tools,'가림 영역 초기화',()=>{if(!valid()||encoding)return;clearPrepared();rectangles=[];paint();help.textContent='가림 처리를 다시 진행해주세요. 원본은 이 기기에만 있습니다.';});
    const confirm=button(tools,'가린 이미지 확정',async()=>{
      if(!valid()||!bitmap||encoding)return;if(!rectangles.length){help.textContent='불필요한 번호 영역을 먼저 가려주세요.';return;}
      encoding=true;confirm.disabled=true;const version=selection;
      try{
        paint();let blob=null,working=canvas;
        for(const size of [1600,1280,1024,800]){
          const ratio=Math.min(1,size/Math.max(canvas.width,canvas.height));working=document.createElement('canvas');working.width=Math.max(1,Math.round(canvas.width*ratio));working.height=Math.max(1,Math.round(canvas.height*ratio));working.getContext('2d').drawImage(canvas,0,0,working.width,working.height);
          for(const quality of [.85,.7,.55]){blob=await new Promise(resolve=>working.toBlob(resolve,'image/jpeg',quality));if(!valid()||version!==selection)return;if(blob&&blob.size<=150*1024)break;}
          if(blob&&blob.size<=150*1024)break;
        }
        if(!blob||blob.size>150*1024)throw Error('IMAGE_TOO_LARGE');
        const bytes=new Uint8Array(await blob.arrayBuffer());if(!valid()||version!==selection)return;
        let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        clearPrepared();prepared={mime:'image/jpeg',data:btoa(binary)};previewUrl=URL.createObjectURL(blob);preview.src=previewUrl;preview.hidden=false;help.textContent='가린 제출 이미지를 확정했습니다. 아래 개인정보 동의를 확인하고 신청하세요.';
      }catch(e){if(valid()&&version===selection)help.textContent=error(e);}
      finally{encoding=false;if(valid()&&version===selection)confirm.disabled=false;}
    });
    function clear(){selection++;encoding=false;drag=null;bitmap?.close?.();bitmap=null;rectangles=[];clearPrepared();upload.value='';canvas.width=1;canvas.height=1;canvas.hidden=true;tools.hidden=true;confirm.disabled=false;help.textContent='';}
    button(root,'첨부 취소',clear);
    upload.onchange=async()=>{
      const file=upload.files?.[0];clear();if(!file||!valid())return;const version=selection;
      try{
        if(!['image/jpeg','image/png'].includes(file.type))throw Error('IMAGE_INVALID');if(file.size>10*1024*1024)throw Error('IMAGE_TOO_LARGE');
        const bytes=new Uint8Array(await file.arrayBuffer());if(!valid()||version!==selection)return;
        const info=window.CreatorFileImage.dimensions(bytes,{maxEdge:10000});if(info.type!==file.type)throw Error('IMAGE_INVALID');
        const loaded=await createImageBitmap(file,{imageOrientation:'from-image'});
        if(!valid()||version!==selection){loaded.close?.();return;}
        if(loaded.width>10000||loaded.height>10000||loaded.width*loaded.height>12000000){loaded.close?.();throw Error('IMAGE_PIXEL_LIMIT');}
        bitmap=loaded;const ratio=Math.min(1,1600/Math.max(loaded.width,loaded.height));canvas.width=Math.max(1,Math.round(loaded.width*ratio));canvas.height=Math.max(1,Math.round(loaded.height*ratio));canvas.hidden=false;tools.hidden=false;paint();help.textContent='원본은 이 기기에만 있습니다. 번호를 드래그하거나 키보드 입력으로 가려주세요.';
      }catch(e){if(valid()&&version===selection)help.textContent=error(e);}
    };
    const point=event=>{const bounds=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(canvas.width,(event.clientX-bounds.left)*canvas.width/bounds.width)),y:Math.max(0,Math.min(canvas.height,(event.clientY-bounds.top)*canvas.height/bounds.height))};};
    canvas.onpointerdown=event=>{if(!valid()||!bitmap||encoding)return;event.preventDefault();drag=point(event);canvas.setPointerCapture?.(event.pointerId);};
    canvas.onpointerup=event=>{if(!drag)return;const start=drag;drag=null;const end=point(event),r={x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(start.x-end.x),height:Math.abs(start.y-end.y)};if(r.width>=2&&r.height>=2)mask(r);};
    canvas.onpointercancel=()=>{drag=null;};
    return {root,value:()=>prepared?{...prepared}:null,clear,dispose:clear};
  }
  async function mount(root,{valid:outerValid=()=>true,initial}={}){
    reset();const turn=epoch,user=actor()?.userId;
    const valid=()=>turn===epoch&&outerValid()&&root.isConnected!==false&&actor()?.userId===user&&actor()?.author?.status==='APPROVED';
    root.replaceChildren();root.className='author-settlement';node(root,'h3','정산 본인 정보·서류 확인');
    const status=node(root,'p','등록 상태를 확인하는 중입니다.','settlement-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    let data=initial||await capability();if(!valid())return;
    if(data.enabled!==true){status.textContent='정산 정보 등록을 준비 중입니다. 현재 결제·송금은 제공하지 않습니다.';return;}
    const policy=data.policy||{},collectionEnabled=data.collectionEnabled===true;let application=data.application||null,revision=application?.revision||'0',pending=null,pendingWithdraw=null,busy=false;
    const labels={PENDING:'서류 확인 대기',APPROVED:'서류 확인 완료',NEEDS_CHANGES:'보완 필요',WITHDRAWN:'철회',EXPIRED:'서류 보관 만료'};
    const renderStatus=()=>{status.textContent=(application?labels[application.status]||'등록 상태 확인 필요':'아직 신청하지 않았습니다.')+(application?.reviewNote?' · '+application.reviewNote:'');};renderStatus();
    statusUpdate=value=>{if(!valid()||busy||pending||pendingWithdraw)return;application=value;revision=value?.revision||'0';renderStatus();};
    node(root,'p','계좌 등록과 서류 검토는 정산 준비 절차입니다. 서류 확인은 PASS 인증·은행 예금주 검증 또는 지급 완료를 뜻하지 않습니다. 페이지를 나가면 작성 중인 개인정보와 첨부는 이 기기에서도 비웁니다.');
    if(!collectionEnabled)node(root,'p',policy.collectionInfoText||'개인정보 보관·국외이전 조건을 확인 중입니다. 확인 전에는 개인정보 입력·첨부·제출을 받지 않습니다.','settlement-collection-notice');
    const form=node(root,'form',undefined,'settlement-form');form.autocomplete='off';
    const fields=node(form,'fieldset');node(fields,'legend','신청자 정보');
    const typeLabel=node(fields,'label','정산 대상'),type=node(typeLabel,'select',undefined,'form-input');type.name='applicantType';
    for(const [value,title]of [['INDIVIDUAL','개인 작가'],['SOLE_PROPRIETOR','개인사업자'],['CORPORATION','법인']]){const option=node(type,'option',title);option.value=value;}type.value='INDIVIDUAL';
    const controls={legalName:field(fields,'실명 (사업자·법인은 대표자 성명)','legalName'),birthDate:field(fields,'생년월일','birthDate','date'),postalCode:field(fields,'우편번호','postalCode'),address:field(fields,'주소','address'),addressDetail:field(fields,'상세 주소 (선택)','addressDetail')};
    for(const input of Object.values(controls)){input.maxLength=input===controls.address||input===controls.addressDetail?200:80;input.required=input!==controls.addressDetail;}controls.postalCode.inputMode='numeric';controls.postalCode.pattern='[0-9]{5}';controls.postalCode.maxLength=5;
    const business=node(fields,'section');business.hidden=true;
    controls.companyName=field(business,'상호·법인명','companyName');controls.companyName.maxLength=120;
    controls.businessNumber=field(business,'사업자등록번호','businessNumber');controls.businessNumber.inputMode='numeric';controls.businessNumber.maxLength=12;
    const tax=node(fields,'p',policy.taxText||'주민등록번호(세무용): 실제 정산·세무 신고 대상 확정 후 별도로 수집합니다. 지금은 전체 주민등록번호를 입력하거나 첨부하지 마세요.');tax.setAttribute('role','note');
    const documentLabel=node(fields,'label','본인확인 서류 종류'),documentType=node(documentLabel,'select',undefined,'form-input');documentType.name='documentType';
    for(const [value,title]of [['RESIDENT_CARD','주민등록증'],['DRIVER_LICENSE','운전면허증'],['PASSPORT','여권']]){const option=node(documentType,'option',title);option.value=value;}documentType.value='RESIDENT_CARD';
    const editing=()=>valid()&&collectionEnabled&&!busy&&!pending&&!pendingWithdraw;
    const identity=imageEditor(fields,'번호를 가린 신분증',editing),businessImage=imageEditor(business,'사업자등록 증빙 (개인 주민번호 등 불필요한 정보 가림)',editing);
    type.onchange=()=>{if(pending||busy)return;business.hidden=type.value==='INDIVIDUAL';controls.companyName.required=controls.businessNumber.required=!business.hidden;if(business.hidden){controls.companyName.value='';controls.businessNumber.value='';businessImage.clear();}};
    documentType.onchange=()=>{if(!pending&&!busy)identity.clear();};
    const disclosure=node(fields,'details');node(disclosure,'summary','정산 정보 수집·보관 안내');
    for(const value of [policy.privacyText,policy.retentionText,policy.redactionText])if(typeof value==='string')node(disclosure,'p',value);
    const consentLabel=node(fields,'label'),consent=node(consentLabel,'input');consent.type='checkbox';consent.required=true;node(consentLabel,'span',' 안내한 정산 준비 목적의 개인정보 처리에 동의합니다.');
    const redactionLabel=node(fields,'label'),redacted=node(redactionLabel,'input');redacted.type='checkbox';redacted.required=true;node(redactionLabel,'span',' 주민번호 뒷자리·면허/여권번호·MRZ·바코드 등 불필요한 정보를 가렸고, 본인 또는 대표자로서 정당한 자료를 제출합니다.');
    if(policy.transferNoticeText)node(disclosure,'p',policy.transferNoticeText);
    const transferLabel=node(fields,'label'),transferConsent=node(transferLabel,'input');transferConsent.type='checkbox';transferConsent.required=true;node(transferLabel,'span',' 안내한 개인정보 국외이전 조건에 별도로 동의합니다.');
    const password=field(form,'현재 로그인 비밀번호','password','password');password.required=true;password.maxLength=256;password.autocomplete='current-password';
    const submit=node(form,'button','서류 확인 신청','btn btn-primary');submit.type='submit';
    const feedback=node(form,'p');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
    const withdraw=button(root,'정산 본인 정보 철회·삭제',async()=>{
      if(!valid()||busy||pending||!application)return;if(!password.value){feedback.textContent='현재 로그인 비밀번호를 입력한 뒤 철회해주세요.';password.focus();return;}
      if(!window.confirm('정산 본인 정보와 첨부를 삭제하고 신청을 철회할까요? 작품·계정·등록 계좌는 유지됩니다.'))return;
      pendingWithdraw ||= {key:crypto.randomUUID(),revision};
      const body={revision:pendingWithdraw.revision,password:password.value};password.value='';busy=true;withdraw.disabled=true;submit.disabled=true;fields.disabled=true;
      try{const result=await api('/withdraw',body,pendingWithdraw.key);if(!valid())return;application=result.application||null;revision=application?.revision||revision;pendingWithdraw=null;renderStatus();clearFields();withdraw.hidden=true;feedback.textContent='정산 본인 정보를 철회했습니다. 등록 계좌는 별도로 관리할 수 있습니다.';}
      catch(e){if(valid()){if(e.status>=400&&e.status<500)pendingWithdraw=null;feedback.textContent=error(e)+(pendingWithdraw?' 현재 비밀번호를 다시 입력하면 같은 철회 요청으로 확인합니다.':' 철회 상태를 새로고침해 확인해주세요.');}}
      finally{body.password='';password.value='';if(valid()){busy=false;withdraw.disabled=false;submit.disabled=!collectionEnabled||!!pendingWithdraw;fields.disabled=!collectionEnabled||!!pendingWithdraw;}}
    });
    withdraw.hidden=!application||application.status==='WITHDRAWN';
    const clearFields=()=>{for(const input of Object.values(controls))input.value='';password.value='';consent.checked=false;redacted.checked=false;transferConsent.checked=false;identity.clear();businessImage.clear();};
    form.onsubmit=async event=>{
      event.preventDefault();if(!valid()||!collectionEnabled||busy||pendingWithdraw)return;
      if(!password.value){feedback.textContent='현재 로그인 비밀번호를 입력해주세요.';return;}
      if(!pending){
        const selected=identity.value(),proof=type.value==='INDIVIDUAL'?null:businessImage.value();
        if(!selected||(type.value!=='INDIVIDUAL'&&!proof)){feedback.textContent='각 첨부의 불필요한 번호를 가리고 이미지를 확정해주세요.';return;}
        if(!consent.checked||!redacted.checked||!transferConsent.checked){feedback.textContent='개인정보 처리 안내·가림 확인·국외이전 안내에 각각 동의해주세요.';return;}
        if(!form.checkValidity()){form.reportValidity?.();return;}
        pending={key:crypto.randomUUID(),body:{revision,applicantType:type.value,...Object.fromEntries(Object.entries(controls).map(([k,v])=>[k,v.value.trim()])),documentType:documentType.value,identityImage:selected,businessImage:proof,privacyConsent:true,redactionConfirmed:true,policyVersion:policy.version,policyHash:policy.hash,transferConsent:true,transferNoticeVersion:policy.transferNoticeVersion,transferNoticeHash:policy.transferNoticeHash}};
      }
      busy=true;fields.disabled=true;submit.disabled=true;withdraw.disabled=true;feedback.textContent='본인 계정 확인 후 암호화해 신청하고 있습니다.';
      const attempt=pending,body={...attempt.body,password:password.value};password.value='';
      try{
        const result=await api('',body,attempt.key);if(!valid())return;
        application=result.application||null;revision=application?.revision||revision;pending=null;clearFields();renderStatus();withdraw.hidden=!application||application.status==='WITHDRAWN';submit.textContent='서류 확인 다시 신청';feedback.textContent='신청을 접수했습니다. 관리자 검토 결과는 이 화면에서 확인할 수 있습니다.';
      }catch(e){if(valid()){
        if(e.status>=400&&e.status<500){pending=null;fields.disabled=false;submit.textContent='서류 확인 신청';feedback.textContent=error(e);}
        else{submit.textContent='동일 신청 결과 다시 확인';feedback.textContent=error(e)+' 현재 비밀번호를 다시 입력하면 같은 신청으로 확인합니다. 내용은 변경하지 않습니다.';}
      }}
      finally{body.password='';password.value='';if(valid()){busy=false;submit.disabled=false;withdraw.disabled=!!pending;fields.disabled=!!pending;}}
    };
    fields.disabled=!collectionEnabled;submit.disabled=!collectionEnabled;password.disabled=!collectionEnabled&&!application;
    dispose=()=>{pending=null;pendingWithdraw=null;busy=false;clearFields();root.replaceChildren();};
  }
  window.CreatorSettlement=Object.freeze({mount,reset,capability,refreshSummary,refreshStatus,updateBankSummary});
})();
