// CMS inventory during migration. Every read/write is authorized again on the server.
(function(){
  'use strict';
  let turn=0,offset=0,query='',current='',kind='author',source='CONTENT_REVIEW';
  const actor=()=>window.WebNovelsAuth?.getActor();
  const can=p=>actor()?.admin?.role==='SUPER_ADMIN'||actor()?.admin?.permissions?.includes(p);
  const permissions=[['OPERATIONS_READ','운영 대시보드'],['ACCOUNTS_READ','작가·독자 조회'],
    ['CONTENT_METADATA_READ','작품·회차 조회'],['CASE_READ','신고·검수 조회'],['CASE_RESOLVE','신고 처리'],
    ['CONTENT_REVIEW','콘텐츠 검수'],['COMMENT_REPORT','댓글 신고 처리'],['CONTENT_MODERATE','작품 노출 제한'],
    ['CURATION_WRITE','홈 큐레이션'],['AUDIT_READ','감사 기록'],['ACCOUNT_MODERATE','계정 정지·복구'],['SETTLEMENTS_READ','정산 기록 조회']];
  const titles={dashboard:'운영 대시보드',works:'작품 CMS',episodes:'회차 CMS',accounts:'작가·독자 관리',
    cases:'신고·콘텐츠 검수',appeals:'이의제기',settlements:'작가 정산',roles:'서브관리자·권한',audit:'감사·처리 기록',settings:'서비스 운영 설정'};
  function el(parent,tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=String(text);if(cls)n.className=cls;parent.append(n);return n;}
  function button(parent,label,action,cls='btn btn-outline btn-sm'){const b=el(parent,'button',label,cls);b.type='button';b.onclick=action;return b;}
  const date=value=>value?new Date(value).toLocaleString('ko-KR'):'—';
  function notice(root,text){return el(root,'p',text,'cms-notice');}
  function table(root,columns,items){
    if(!items.length){notice(root,'조회 결과가 없습니다.');return;}
    const wrap=el(root,'div',null,'cms-table-wrap'),t=el(wrap,'table',null,'cms-table');
    const head=el(el(t,'thead'),'tr');for(const [label] of columns)el(head,'th',label).scope='col';
    const body=el(t,'tbody');for(const item of items){const row=el(body,'tr');for(const [,value] of columns)el(row,'td',value(item)??'—');}
  }
  function settings(root){
    const config=window.WEBNOVELS_CONFIG||{};
    notice(root,'운영 설정 상태입니다. 기능별 실제 사용 검증과 공개 오픈 판정은 별도로 확인해야 합니다.');
    table(root,[['기능',x=>x[0]],['설정 상태',x=>x[1]?'활성':'준비 중']],
      [['계정 로그인',actor()?.accountServiceReady||!actor()?.accountServiceOnly],['게시·본문 열람',config.authorPublishEnabled],
       ['독자 서비스',config.readerServiceEnabled],['작가 운영',config.authorOperationsEnabled],['콘텐츠 조치·검수 처리',config.adminOperationsEnabled]]);
    const list=el(root,'ul');for(const item of ['회원가입·인증 메일: 발신 서비스와 서비스 복귀 주소 설정',
      '작품 공개: 본문 검토, 비공개 원고 접근 차단, 게시·게시 취소 확인',
      '운영 준비: 문의 연락처, 신고 처리 기준, 백업 복원과 장애 알림',
      '정산 지급: 거래 원장 대조, 지급 정책, 중복 지급 방지 및 송금 결과 확인'])el(list,'li',item);
  }
  async function render(root,page,{accountKind,isCurrent=()=>true}={}){
    const seq=++turn,owner=actor()?.userId,valid=()=>seq===turn&&actor()?.userId===owner&&isCurrent();
    if(current!==page){current=page;offset=0;query='';}
    if(accountKind&&kind!==accountKind){kind=accountKind;offset=0;query='';}
    root.replaceChildren();el(root,'h2',titles[page]||'운영 관리');
    if(!actor()?.admin){notice(root,'관리자 로그인이 필요합니다.');return;}
    const refresh=()=>render(root,page,{isCurrent});
    if(page==='settings'){settings(root);return;}
    if(page==='appeals'){
      notice(root,'이의제기 처리 기능을 준비하고 있습니다. 신고·제재 처리 기능의 운영 연결 후 접수·심사를 사용할 수 있습니다.');
      button(root,'신고·검수로 이동',()=>window.AdminOperations.navigate('cases'));return;
    }
    const toolbar=el(root,'div',null,'cms-toolbar');
    if(page==='accounts'){
      const choices=[['author','작가','CREATOR_MGMT'],['reader','독자','USER_MGMT']].filter(x=>can('ACCOUNTS_READ')||can(x[2]));
      if(!choices.some(x=>x[0]===kind))kind=choices[0]?.[0];
      for(const [value,label] of choices)button(toolbar,label,()=>{kind=value;offset=0;query='';refresh();},kind===value?'btn btn-primary btn-sm':'btn btn-outline btn-sm');
      if(can('SUPER_ADMIN')||actor()?.admin?.role==='SUPER_ADMIN')button(toolbar,'가상 계정 수정·정지·삭제',()=>window.AdminOperations.navigate('virtual-accounts'));
    }
    if(page==='cases'){
      const choices=[['CONTENT_REVIEW','콘텐츠 검수','CONTENT_REVIEW'],['REPORT','신고','COMMENT_REPORT']].filter(x=>can('CASE_READ')||can(x[2]));
      if(!choices.some(x=>x[0]===source))source=choices[0]?.[0];
      for(const [value,label] of choices)button(toolbar,label,()=>{source=value;offset=0;refresh();},value===source?'btn btn-primary btn-sm':'btn btn-outline btn-sm');
      notice(root,'기존 접수 기록을 조회합니다. 조치·반려는 콘텐츠 운영 연결과 검증 후 사용할 수 있습니다.');
    }
    if(['works','episodes','accounts'].includes(page)){
      const form=el(toolbar,'form',null,'cms-search'),input=el(form,'input');input.type='search';input.value=query;input.maxLength=100;
      input.placeholder=page==='accounts'?'표시 이름 검색':'작품·회차 검색';input.setAttribute('aria-label',input.placeholder);
      const submit=button(form,'검색');submit.type='submit';form.onsubmit=e=>{e.preventDefault();query=input.value.trim();offset=0;refresh();};
    }
    button(toolbar,'새로고침',refresh);
    const loading=notice(root,'운영 정보를 불러오는 중입니다…');loading.setAttribute('role','status');
    const params=new URLSearchParams({action:page,offset:String(offset)});
    if(['works','episodes','accounts'].includes(page))params.set('q',query);
    if(page==='accounts')params.set('kind',kind);
    if(page==='cases')params.set('source',source);
    try{
      const result=await window.WebNovelsAuth.api('/api/v2/admin/console?'+params);if(!valid())return;
      loading.textContent='';
      if(page==='dashboard'){
        const cards=el(root,'div',null,'cms-metrics');
        for(const [key,label] of [['works','작품'],['episodes','회차'],['authors','작가'],['readers','독자'],['pendingReviews','대기 검수'],['pendingReports','대기 신고']]){
          const card=el(cards,'article',null,'cms-metric');el(card,'span',label);el(card,'strong',result[key]??'확인 필요');
        }
        notice(root,`원본 본문 확인이 필요한 회차: ${result.emptyOriginals??'확인 필요'}개. 등록 건수는 공개 가능 건수와 다릅니다.`);
        el(root,'h3','서비스 준비 상태');settings(root);return;
      }
      const items=result.items||[];
      if(page==='works'){
        notice(root,'작품과 회차의 등록 상태를 조회합니다. 본문 편집은 작가 스튜디오에서 진행하며, 공개·큐레이션 조치는 콘텐츠 서비스 연결 후 사용할 수 있습니다.');
        table(root,[['작품',x=>`#${x.id} ${x.title}`],['소유 작가',x=>x.author_id?`${x.author||'이름 미등록'} (#${x.author_id})`:'연결 확인 필요'],
          ['유형 / 등급',x=>`${x.content_type||'—'} / ${x.rating||'—'}`],['등록 상태',x=>x.status],['회차',x=>x.episodes],
          ['본문 확인 필요',x=>x.empty_originals],['홈 노출 설정',x=>[x.is_top_recommended?'추천':'',x.is_popular_work?'인기':'',x.is_new_work?'신작':''].filter(Boolean).join(' · ')||'없음']],items);
      }else if(page==='episodes')table(root,[['작품',x=>x.work_title],['회차',x=>x.episode_number],['제목',x=>x.title],['등록 상태',x=>x.status],['무료 설정',x=>x.is_free?'무료':'비무료'],['원본 본문',x=>x.has_original?'있음':'검토 필요']],items);
      else if(page==='accounts')table(root,[['번호',x=>x.id],['표시 이름',x=>x.name],['상태',x=>x.status],['인증 연결',x=>x.linked?'연결됨':'연결 필요']],items);
      else if(page==='cases')table(root,[['대상',x=>x.label],['상태',x=>x.status],['접수일',x=>date(x.created_at)]],items);
      else if(page==='settlements'){
        notice(root,'기존 정산 신청 기록입니다. 시험 데이터 포함 여부와 거래 원장의 대조가 끝나지 않아 실제 지급 의무·지급 완료·지급 가능액을 확정하는 자료로 사용할 수 없습니다.');
        table(root,[['작가',x=>x.author_id?`${x.author||'이름 미등록'} (#${x.author_id})`:'소유자 확인 필요'],['기록 금액',x=>x.recorded_amount],['기록 상태',x=>x.recorded_status],['신청일',x=>date(x.requested_at)],['처리 기록일',x=>date(x.processed_at)]],items);
        const panel=el(root,'section',null,'co-panel');el(panel,'h3','정산 처리 준비');
        notice(panel,'원장 대조 → 정산 확정 → 지급 승인 → 송금 결과 확인 순서로 연결할 예정입니다. 현재 승인·지급 상태 변경은 제공하지 않습니다. 계좌번호와 지급 비밀정보는 표시하지 않습니다.');
      }else if(page==='roles'){
        notice(root,'최고 관리자가 서브관리자의 업무 권한을 저장할 수 있습니다. 저장 시 현재 관리자 비밀번호를 다시 확인합니다. 인증 연결이 필요한 관리자는 권한을 설정해도 로그인할 수 없습니다.');
        for(const item of items){
          const card=el(root,'article',null,'co-panel cms-role');el(card,'h3',item.nickname||'관리자');
          el(card,'p',`${item.role==='SUPER_ADMIN'?'최고 관리자':item.role==='SUB_ADMIN'?'서브관리자':item.role} · ${item.is_active?'활성':'비활성'} · ${item.linked?'인증 연결됨':'인증 연결 필요'}`);
          if(item.role!=='SUB_ADMIN'){notice(card,'최고 관리자 및 다른 관리자 유형은 이 화면에서 변경하지 않습니다.');continue;}
          const form=el(card,'form'),grid=el(form,'div',null,'cms-permissions'),checks=[];
          for(const [value,label] of permissions){const field=el(grid,'label'),input=el(field,'input');input.type='checkbox';input.value=value;input.checked=(item.permissions||[]).includes(value);checks.push(input);el(field,'span',label);}
          const legacy=(item.permissions||[]).filter(p=>!permissions.some(([value])=>value===p));
          if(legacy.length)notice(form,'보존되는 기존 권한: '+legacy.join(', ')+'. 아래 선택을 해제해도 이 기존 권한은 유지됩니다.');
          const reasonLabel=el(form,'label','변경 사유'),reason=el(reasonLabel,'input');reason.required=true;reason.minLength=3;reason.maxLength=500;reason.type='text';
          const passLabel=el(form,'label','현재 최고 관리자 비밀번호'),password=el(passLabel,'input');password.type='password';password.autocomplete='current-password';password.required=true;password.maxLength=1024;
          const save=button(form,'권한 저장',null,'btn btn-primary btn-sm');save.type='submit';
          const feedback=el(form,'p');feedback.setAttribute('role','status');
          form.onsubmit=async event=>{event.preventDefault();if(!valid())return;
            if(reason.value.trim().length<3||!password.value){feedback.textContent='변경 사유와 현재 관리자 비밀번호를 입력해주세요.';return;}
            save.disabled=true;feedback.textContent='관리자 확인 후 권한을 저장하고 있습니다…';
            const payload={adminId:item.id,revision:item.revision,permissions:checks.filter(x=>x.checked).map(x=>x.value),reason:reason.value.trim(),password:password.value};password.value='';
            try{await window.WebNovelsAuth.api('/api/v2/admin/console?action=role-update',{method:'POST',body:JSON.stringify(payload)});
              if(valid()){await refresh();window.showToast?.('서브관리자 권한을 저장했습니다.');}
            }catch(e){if(valid()){feedback.textContent=errorText(e);save.disabled=false;}}
            finally{payload.password='';password.value='';}
          };
        }
        notice(root,'일부 업무는 콘텐츠 서비스 연결 후 사용할 수 있습니다. 신규 관리자 생성·인증 연결은 별도 절차이며, 이메일만으로 기존 계정을 연결하지 않습니다.');
      }else if(page==='audit')table(root,[['일시',x=>date(x.created_at)],['대상 종류',x=>x.kind],['대상 번호',x=>x.target],['작업',x=>x.action],['사유',x=>x.reason]],items);
      const pager=el(root,'div',null,'cms-toolbar');el(pager,'span',`총 ${result.total}건 · ${Math.floor(offset/100)+1}페이지`);
      const prev=button(pager,'이전',()=>{offset=Math.max(0,offset-100);refresh();});prev.disabled=offset===0;
      const next=button(pager,'다음',()=>{offset+=100;refresh();});next.disabled=offset+items.length>=result.total;
    }catch(e){if(valid()){loading.textContent=errorText(e);button(root,'다시 시도',refresh);}}
  }
  function errorText(e){return ({ADMIN_REAUTH_FAILED:'관리자 비밀번호를 확인해주세요.',ADMIN_REAUTH_REQUIRED:'현재 관리자 비밀번호를 입력해주세요.',
    CONFLICT:'다른 변경이 먼저 저장되었습니다. 새로고침 후 다시 확인해주세요.',ADMIN_FORBIDDEN:'이 정보를 조회하거나 변경할 권한이 없습니다.',
    ACCOUNT_SERVICE_NOT_ACTIVATED:'관리자 데이터 연결을 준비 중입니다. 잠시 후 새로고침해주세요.',RATE_LIMITED:'요청이 많습니다. 잠시 후 다시 시도해주세요.'})[e?.code]||'정보를 불러오거나 저장하지 못했습니다. 새로고침 후 상태를 확인해주세요.';}
  window.AdminConsole=Object.freeze({render,reset(){turn++;current='';offset=0;query='';}});
})();
