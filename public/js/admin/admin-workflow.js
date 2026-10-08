/* Stage 17 operational forms. All decisions are enforced by the authenticated service RPC. */
(function(){
  'use strict';
  const actor=()=>window.WebNovelsAuth?.getActor();
  const active=()=>window.WEBNOVELS_CONFIG?.adminWorkflowEnabled===true;
  const can=permission=>actor()?.admin?.role==='SUPER_ADMIN'||actor()?.admin?.permissions?.includes(permission);
  const sourceNames={CONTENT_REVIEW:'콘텐츠 검수',COMMENT_REPORT:'작품 댓글 신고',REPORT:'기존 신고'};
  const labels={PENDING:'대기',APPROVED:'승인',REJECTED:'기각',REVIEWED:'처리됨',RESOLVED:'처리됨',ACCEPTED:'이의 인정',
    MAINTAIN:'원조치 유지',UNRESTRICT:'작품 제한 해제',UNBLOCK:'댓글 차단 해제',RESOLVE:'조치',REJECT:'기각',ACCEPT:'이의 인정'};
  let turn=0,host=null,context=null;
  const date=value=>value?new Date(value).toLocaleString('ko-KR'):'미지정';
  const local=value=>{const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
  const utc=value=>value?new Date(value).toISOString():null;
  function el(parent,tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=String(text);if(cls)n.className=cls;parent.append(n);return n;}
  function button(parent,text,fn){const n=el(parent,'button',text,'btn btn-outline btn-sm');n.type='button';n.onclick=fn;return n;}
  function field(parent,label,value='',type='text'){
    const wrap=el(parent,'label',null,'workflow-field');el(wrap,'span',label);
    const n=el(wrap,type==='textarea'?'textarea':'input',null,'form-control');if(type!=='textarea')n.type=type;
    n.value=value;n.setAttribute('aria-label',label);return n;
  }
  function select(parent,label,choices,value){
    const wrap=el(parent,'label',null,'workflow-field');el(wrap,'span',label);const n=el(wrap,'select',null,'form-control');n.setAttribute('aria-label',label);
    for(const [id,text] of choices){const option=el(n,'option',text);option.value=id;}n.value=value;return n;
  }
  const current=c=>context===c&&turn===c.turn&&actor()?.userId===c.user&&c.isCurrent();
  function status(parent,text){const n=el(parent,'p',text);n.setAttribute('role','status');return n;}
  async function api(action,data={},write=false){
    const user=actor()?.userId;if(!user||!actor()?.admin)throw Error('ADMIN_REQUIRED');
    const query=new URLSearchParams({action});if(!write)for(const [key,value] of Object.entries(data))if(value!=null)query.set(key,value);
    const result=await window.WebNovelsAuth.api('/api/v2/admin/workflow?'+query,write?{method:'POST',body:JSON.stringify(data)}:undefined);
    if(actor()?.userId!==user)throw Error('SESSION_CHANGED');return result;
  }
  function auditLink(parent,target,c){if(can('AUDIT_READ')||can('SECURITY_MGMT'))button(parent,'관련 감사 기록',()=>render(host,'audit',{...c.options,target}));}
  function form(parent,title,action,makeFields,c,success){
    const f=el(parent,'form',null,'workflow-form');el(f,'h4',title);const values=makeFields(f);
    const reason=field(f,'조치 사유 (3~500자)','','textarea');reason.required=true;reason.minLength=3;reason.maxLength=500;
    const note=status(f,''),save=el(f,'button','기록하고 실행','btn btn-primary btn-sm');save.type='submit';
    let pending=null,busy=false;
    f.onsubmit=async event=>{
      event.preventDefault();if(busy||!current(c))return;
      if(!pending){
        try{if(reason.value.trim().length<3)throw Error('사유를 3자 이상 입력해 주세요.');pending={...values(),reason:reason.value.trim(),requestId:crypto.randomUUID()};}
        catch(error){note.textContent=error.message;return;}
      }
      busy=true;for(const n of f.querySelectorAll('input,select,textarea,button'))n.disabled=true;note.textContent='처리 중입니다…';
      try{
        const result=await api(action,pending,true);if(!current(c))return;
        pending=null;note.textContent='처리와 기록을 완료했습니다.';
        if(success)success(result,f);else await render(host,c.page,c.options);
      }catch(error){
        if(!current(c))return;
        const code=error.code||error.message||'요청 실패';
        if([401,403].includes(error.status)){note.textContent='세션 또는 권한이 변경되었습니다. 다시 로그인해 주세요.';return;}
        if(error.status===409){note.textContent='다른 처리와 충돌했습니다. 최신 상태를 다시 확인해 주세요. ('+code+')';button(f,'최신 상태 불러오기',()=>render(host,c.page,c.options));return;}
        if(error.status>=400&&error.status<500){pending=null;for(const n of f.querySelectorAll('input,select,textarea,button'))n.disabled=false;save.textContent='수정 후 실행';}
        else {save.disabled=false;save.textContent='같은 요청 다시 확인';}
        note.textContent=(pending?'결과를 확인하지 못했습니다. 입력을 유지한 동일 요청으로 확인합니다. ':'입력을 확인해 주세요. ')+code;
      }finally{busy=false;}
    };
    return f;
  }
  function pager(result,c){
    if(c.options.offset)button(host,'처음 페이지',()=>render(host,c.page,{...c.options,offset:0}));
    if(result.nextOffset!=null)button(host,'다음 페이지',()=>render(host,c.page,{...c.options,offset:result.nextOffset}));
  }
  function caseCard(item,assignees,c){
    const card=el(host,'article',null,'co-panel workflow-card'),m=item.workflow;
    el(card,'h4',`${sourceNames[item.source]} · ${labels[item.status]||item.status}`);
    el(card,'p',item.label);el(card,'p',`${item.id} · ${date(item.createdAt)} · ${item.target}`,'small text-muted');
    if(item.subject){el(card,'p',`신고 대상 댓글 · ${item.subject.nickname} · ${item.subject.blocked?'차단됨':'차단 전'}${item.subject.deleted?' · 삭제 상태':''}`);el(card,'blockquote',item.subject.content);}
    const overdue=m.dueAt&&Date.parse(m.dueAt)<Date.now()&&item.status==='PENDING';
    el(card,'p',`${m.priority} · 담당 ${assignees.find(a=>a.id===m.assigneeId)?.name||m.assigneeId||'미배정'} · 기한 ${date(m.dueAt)}${overdue?' · 기한 초과':''}`);
    el(card,'p','검토 근거: '+(m.evidence||'미기록'));
    if(m.duplicateId)el(card,'p','같은 대상의 원본 사건 참조: '+m.duplicateId+' (각 사건은 별도 처리됩니다.)');
    auditLink(card,item.source+':'+item.id,c);
    const writable=can('CASE_RESOLVE')||can(item.source==='CONTENT_REVIEW'?'CONTENT_REVIEW':'COMMENT_REPORT');
    if(writable&&item.status==='PENDING'){
      form(card,'담당·기한·검토 근거','case-update',f=>{
        const choices=[['','미배정'],...assignees.map(a=>[a.id,a.name])];
        if(m.assigneeId&&!assignees.some(a=>a.id===m.assigneeId))choices.push([m.assigneeId,'기존 담당 (재배정 필요)']);
        const assigned=select(f,'담당자',choices,m.assigneeId||''),priority=select(f,'우선순위',[['NORMAL','보통'],['HIGH','높음'],['URGENT','긴급']],m.priority);
        const due=field(f,'처리 기한 (현재 기기 시간)',m.dueAt?local(m.dueAt):'','datetime-local');
        const evidence=field(f,'검토 근거 (3~2000자)',m.evidence,'textarea');evidence.required=true;evidence.minLength=3;evidence.maxLength=2000;
        const duplicate=field(f,'같은 종류·대상의 원본 사건 UUID (선택)',m.duplicateId||'');
        return()=>({source:item.source,caseId:item.id,revision:m.revision,targetVersion:item.targetVersion||'',assigneeId:assigned.value||null,priority:priority.value,dueAt:utc(due.value),evidence:evidence.value.trim(),duplicateId:duplicate.value.trim()||null});
      },c);
      form(card,'사건 종결 · 작가에게 결과 통지','case-resolve',f=>{
        const decision=select(f,'판정',item.source==='CONTENT_REVIEW'?[['RESOLVE','검수 승인 (공개는 작가가 별도 실행)'],['REJECT','검수 반려']]:[['RESOLVE','신고 조치 (지원하는 댓글 차단)'],['REJECT','신고 기각']],'REJECT');
        return()=>({source:item.source,caseId:item.id,revision:m.revision,decision:decision.value});
      },c);
    }
    if(actor()?.admin?.role==='SUPER_ADMIN'&&item.source==='CONTENT_REVIEW'&&item.status==='PENDING'){
      const details=el(card,'details');el(details,'summary','예외 초안 열람 · 사유와 열람 기록 필요');
      form(details,'검수 사건과 같은 작품의 초안만 열람','draft-read',f=>{
        const draft=field(f,'작가가 전달한 초안 UUID');draft.required=true;
        return()=>({source:item.source,caseId:item.id,draftId:draft.value.trim()});
      },c,(result,f)=>{
        const section=el(f,'section',null,'workflow-draft');el(section,'h4',result.draft.title);
        el(section,'p','열람 revision '+result.draft.revision);el(section,'pre',result.draft.content);
        button(section,'본문 닫기',()=>section.replaceChildren());
      });
    }
  }
  function appealCard(item,c){
    const card=el(host,'article',null,'co-panel workflow-card');el(card,'h4',`${sourceNames[item.source]||'작품 제한'} · ${labels[item.status]||item.status}`);
    el(card,'p',item.reason);el(card,'p',`원본 ${item.sourceId} · ${date(item.createdAt)}`);
    if(item.resolutionReason)el(card,'p','심사 사유: '+item.resolutionReason);
    auditLink(card,'APPEAL:'+item.id,c);
    if(item.status==='PENDING'&&can('CASE_RESOLVE'))form(card,'이의제기 심사 (해제는 별도 조치)','appeal-resolve',f=>{
      const decision=select(f,'판정',[['ACCEPT','이의 인정'],['REJECT','기각']],'REJECT');return()=>({appealId:item.id,decision:decision.value});
    },c);
    if(item.followup)el(card,'p','후속 조치: '+(labels[item.followup.decision]||item.followup.decision)+' · '+item.followup.reason);
    else if(item.status!=='PENDING'&&can('CONTENT_MODERATE'))form(card,'별도 후속 조치','appeal-followup',f=>{
      const choices=[['MAINTAIN','원조치 유지']];
      if(item.status==='ACCEPTED'&&item.source==='WORK_MODERATION')choices.push(['UNRESTRICT','해당 작품 제한 해제']);
      if(item.status==='ACCEPTED'&&['REPORT','COMMENT_REPORT'].includes(item.source)&&item.case?.target?.startsWith('COMMENT:'))choices.push(['UNBLOCK','해당 댓글 차단 해제']);
      const decision=select(f,'조치',choices,'MAINTAIN');return()=>({appealId:item.id,decision:decision.value,targetVersion:item.targetVersion});
    },c);
  }
  function placementForm(parent,item,works,c){
    form(parent,item?'추천 예약 수정':'추천 예약 추가','curation-save',f=>{
      const list=works.map(w=>[w.id,w.title+' · '+w.id]);if(item&&!list.some(([id])=>id===item.workId))list.push([item.workId,item.title]);
      const work=select(f,'작품',list,item?.workId||list[0]?.[0]||''),slot=select(f,'노출 위치',[['HOME_RECOMMENDED','홈 편집 추천'],['HOME_SPOTLIGHT','홈 기획 추천']],item?.slot||'HOME_RECOMMENDED');
      const position=field(f,'순서 (1~8)',String(item?.position||1),'number');position.min='1';position.max='8';
      const start=field(f,'시작 (현재 기기 시간)',local(item?.starts_at||new Date()),'datetime-local');start.required=true;
      const end=field(f,'종료 (현재 기기 시간)',local(item?.ends_at||new Date(Date.now()+86400000)),'datetime-local');end.required=true;
      const enabled=field(f,'예약 활성화','','checkbox');enabled.checked=item?.enabled??true;
      const id=item?.id||crypto.randomUUID();
      return()=>({placementId:id,revision:item?.revision||'0',workId:work.value,slot:slot.value,position:Number(position.value),startsAt:utc(start.value),endsAt:utc(end.value),enabled:enabled.checked});
    },c);
  }
  async function render(root,page,options={}){
    if(!active())return;host=root;const c={turn:++turn,user:actor()?.userId,page,options,isCurrent:options.isCurrent||(()=>true)};context=c;
    root.replaceChildren();status(root,'운영 정보를 불러오는 중입니다…');
    const source=options.source||'CONTENT_REVIEW',kind=options.accountKind||'reader',offset=options.offset||0;
    try{
      let result,assignees=[],works=[];
      if(page==='cases'){
        [result,{assignees}]=await Promise.all([api('cases',{source,offset}),api('assignees',{source})]);
      }else if(page==='curation'){
        [result,{works}]=await Promise.all([api('curation'),api('work-list')]);
      }else result=await api(page==='works'?'work-list':page,page==='accounts'?{kind,offset}:page==='audit'?{offset,target:options.target||''}:page==='appeals'?{offset}:{});
      if(!current(c))return;root.replaceChildren();el(root,'h3',({cases:'신고·검수 사건 처리',appeals:'이의제기와 후속 조치',accounts:'계정 지원',works:'콘텐츠 상태·제재',curation:'기간별 편집 추천',audit:'통합 감사 기록'})[page]);
      if(page==='cases'){
        for(const [key,name] of Object.entries(sourceNames))if(can('CASE_READ')||can(key==='CONTENT_REVIEW'?'CONTENT_REVIEW':'COMMENT_REPORT'))button(root,name,()=>render(root,page,{...options,source:key,offset:0}));
        if(!result.cases.length)status(root,'사건이 없습니다.');result.cases.forEach(item=>caseCard(item,assignees,c));
      }else if(page==='appeals'){
        status(root,'이의 인정 후에도 별도 후속 조치가 완료될 때까지 기존 제한은 유지됩니다.');
        if(!result.appeals.length)status(root,'이의제기 내역이 없습니다.');result.appeals.forEach(item=>appealCard(item,c));
      }else if(page==='accounts'){
        for(const [key,name,permission] of [['reader','독자','USER_MGMT'],['author','작가','CREATOR_MGMT']])if(can('ACCOUNTS_READ')||can(permission))button(root,name,()=>render(root,page,{...options,accountKind:key,offset:0}));
        status(root,'본인 이메일로 로그인 화면의 비밀번호 재설정을 이용합니다. 링크 수신 → 새 비밀번호 설정 → 다시 로그인 → 작품/계정 확인 순서입니다. 이메일 접근 또는 연결 문제는 본인 확인 후 별도 계정 연결 절차로 처리합니다.');
        status(root,'권한·정지 상태는 매 요청마다 서버에서 확인합니다. 다른 기기의 기존 세션도 다음 요청에서 재검사됩니다.');
        if(!result.accounts.length)status(root,'계정이 없습니다.');
        for(const item of result.accounts){
          const card=el(root,'article',null,'co-panel workflow-card');el(card,'h4',`${item.name} · ${item.id} · ${item.status}`);
          const support=status(card,'');const inspect=button(card,'연결·복구 상태 확인',async()=>{
            inspect.disabled=true;
            try{const data=await api('account-support',{kind,accountId:item.id});if(current(c))support.textContent=`계정 연결 ${data.linked?'확인':'없음'} · 이메일 인증 ${data.emailConfirmed?'확인':'미완료'} · 인증 제한 ${data.authBlocked?'있음':'없음'} · ${data.status}`;}
            catch(error){if(current(c))support.textContent='조회 실패: '+(error.code||error.message);}
            finally{if(current(c))inspect.disabled=false;}
          });
          auditLink(card,kind+':'+item.id,c);
          if(can('ACCOUNT_MODERATE')&&['ACTIVE','APPROVED','SUSPENDED'].includes(item.status))form(card,item.status==='SUSPENDED'?'계정 정지 해제':'계정 정지','account-moderate',()=>()=>({kind,accountId:item.id,expectedStatus:item.status,decision:item.status==='SUSPENDED'?'RESTORE':'SUSPEND'}),c);
        }
      }else if(page==='works'){
        status(root,'작품·회차 본문 편집은 작가 스튜디오에서 진행합니다. 노출 제한과 편집 추천은 별도 운영 업무입니다.');
        for(const item of result.works){const card=el(root,'article',null,'co-panel workflow-card');el(card,'h4',`${item.title} · ${item.id}`);el(card,'p',`${item.status} · ${item.moderation}`);auditLink(card,'WORK:'+item.id,c);
          if(can('CONTENT_MODERATE'))form(card,item.moderation==='RESTRICTED'?'작품 제한 해제':'작품 노출 제한','moderate',()=>()=>({workId:item.id,version:item.version,decision:item.moderation==='RESTRICTED'?'UNRESTRICT':'RESTRICT'}),c);
        }
      }else if(page==='curation'){
        status(root,'편집 추천은 최근 7일 독자 랭킹과 별개입니다. 미리보기는 지정 시각의 예약과 현재 공개 적격성을 함께 확인합니다.');
        const at=field(root,'미리보기 시각 (현재 기기 시간)',local(new Date()),'datetime-local'),preview=el(root,'section');
        button(root,'미리보기',async()=>{if(!at.value)return;const stamp=at.value;preview.replaceChildren();status(preview,'확인 중입니다…');
          try{const data=await api('preview',{at:utc(stamp)});if(!current(c)||stamp!==at.value)return;preview.replaceChildren();
            if(!data.placements.length)status(preview,'해당 시각에 공개할 편집 추천이 없습니다.');
            for(const row of data.placements){const p=el(preview,'p',`${row.slot==='HOME_RECOMMENDED'?'홈 편집 추천':'홈 기획 추천'} ${row.position}. `);const link=el(p,'a',row.work.title);link.href='/works/'+encodeURIComponent(row.work.id);}
          }catch(error){if(current(c)&&stamp===at.value){preview.replaceChildren();status(preview,'미리보기 실패: '+(error.code||error.message));}}
        });
        const create=el(root,'details');el(create,'summary','추천 예약 추가');placementForm(create,null,works,c);
        for(const item of result.placements){const card=el(root,'article',null,'co-panel workflow-card');el(card,'h4',item.title+' · '+item.slot+' · '+item.position);el(card,'p',`${date(item.starts_at)} ~ ${date(item.ends_at)} · ${item.enabled?'예약 활성':'비활성'} · ${item.eligible?'공개 가능':'현재 공개 불가'}`);auditLink(card,'WORK:'+item.workId,c);
          const details=el(card,'details');el(details,'summary','예약 수정');placementForm(details,item,works,c);}
      }else if(page==='audit'){
        const target=field(root,'대상 필터 (예: WORK:10 / APPEAL:UUID)',options.target||'');button(root,'필터 적용',()=>render(root,page,{...options,target:target.value.trim(),offset:0}));
        if(result.missingSources?.length)status(root,'이 환경에서 미설치된 감사 원천: '+result.missingSources.join(', '));
        if(!result.events.length)status(root,'감사 기록이 없습니다.');
        for(const item of result.events){const card=el(root,'article',null,'co-panel workflow-card');el(card,'h4',`${item.action} · ${item.target}`);el(card,'p',`${date(item.created_at)} · ${item.origin} · 처리자 ${item.actor}`);el(card,'p',item.reason);if(item.detail&&Object.keys(item.detail).length)el(card,'pre',JSON.stringify(item.detail,null,2));}
      }
      pager(result,c);
    }catch(error){if(current(c)){root.replaceChildren();status(root,'조회 실패: '+(error.code||error.message||'요청 실패'));button(root,'다시 불러오기',()=>render(root,page,options));}}
  }
  function reset(){turn++;context=null;if(host)host.replaceChildren();host=null;}
  window.AdminWorkflow=Object.freeze({active,api,render,reset});
})();
