// Stage 9 administrator operations. The old console remains dormant until cutover.
(function(){
  'use strict';
  const active=()=>window.WEBNOVELS_CONFIG?.adminOperationsEnabled===true||!!actor()?.accountServiceReady;
  const actor=()=>window.WebNovelsAuth?.getActor();
  const root=()=>document.getElementById('adminOperationsContent');
  const shell=()=>document.getElementById('adminOperationsShell');
  const navigation=window.AdminNavigation;
  const sources=[['CONTENT_REVIEW','콘텐츠 검수','CONTENT_REVIEW'],
    ['COMMENT_REPORT','작품 댓글 신고','COMMENT_REPORT'],['REPORT','기존 신고','COMMENT_REPORT']];
  const rolePermissions=[['OPERATIONS_READ','운영 현황'],['ACCOUNTS_READ','계정 조회'],
    ['CONTENT_METADATA_READ','작품 조회'],['CASE_READ','처리함 조회'],['CASE_RESOLVE','신고 처리'],
    ['CONTENT_REVIEW','콘텐츠 검수'],['COMMENT_REPORT','댓글 신고 처리'],
    ['CONTENT_MODERATE','노출 제한'],['CURATION_WRITE','큐레이션'],['AUDIT_READ','처리 기록'],
    ['ACCOUNT_MODERATE','계정 정지·복구']];
  let page='dashboard',kind='reader',source='CONTENT_REVIEW',turn=0,route=null,sourceExplicit=false;
  const own=()=>actor()?.admin?.is_active===false?null:actor()?.admin;
  const can=permission=>own()?.role==='SUPER_ADMIN'||own()?.permissions?.includes(permission);
  const canRead=key=>key==='virtual-accounts'?own()?.role==='SUPER_ADMIN':
    key==='recovery'?(window.AdminRecovery?.active()&&(can('CASE_READ')||can('CONTENT_REVIEW'))):
    key==='curation'?(window.AdminWorkflow?.active()&&can('CURATION_WRITE')):
    key==='dashboard'?(can('OPERATIONS_READ')||can('DASHBOARD')):
    key==='beta-operations'?(can('OPERATIONS_READ')||can('CASE_READ')):
    key==='cases'?(can('CASE_READ')||can('CONTENT_REVIEW')||can('COMMENT_REPORT')):
    key==='appeals'?can('CASE_READ'):
    key==='accounts'?(can('ACCOUNTS_READ')||can('USER_MGMT')||can('CREATOR_MGMT')):
    ['works','content-pages'].includes(key)?(can('CONTENT_METADATA_READ')||can('WORK_MGMT')||can('CURATION_WRITE')):
    key==='episodes'?(can('CONTENT_METADATA_READ')||can('EPISODE_MGMT')):
    ['settlements','payments','refunds','reconciliation'].includes(key)?(can('SETTLEMENTS_READ')||can('AUTHOR_SETTLEMENT')):
    key==='settings'?own()?.role==='SUPER_ADMIN':
    key==='roles'?own()?.role==='SUPER_ADMIN':
    key==='audit'?(can('AUDIT_READ')||can('SECURITY_MGMT')):false;
  const canKind=value=>can('ACCOUNTS_READ')||can(value==='author'?'CREATOR_MGMT':'USER_MGMT');
  const groups=()=>{
    const visible=navigation?.groups((key,tab)=>!!own()&&!!canRead(key)&&(key!=='accounts'||!!canKind(tab.kind)))||[];
    return visible.map(group=>{
      const tabs=group.tabs.map(tab=>tab.page==='cases'?{...tab,href:navigation.path({group:group.key,tab:tab.key,source:availableSources()[0]?.[0]||'CONTENT_REVIEW'})}:tab);
      return {...group,tabs,href:tabs.find(tab=>tab.href===group.href)?.href||(group.key==='inbox'?tabs[0].href:group.href)};
    });
  };
  const allowed=()=>!!own()&&!!route?.valid&&!!canRead(page)&&(page!=='accounts'||!!canKind(kind))&&
    (page!=='cases'||availableSources().some(([key])=>key===source));
  function el(parent,tag,value,cls){const node=document.createElement(tag);if(value!=null)node.textContent=String(value);
    if(cls)node.className=cls;parent.append(node);return node;}
  function button(parent,label,action,cls='btn btn-outline btn-sm'){
    const node=el(parent,'button',label,cls);node.type='button';node.onclick=action;return node;}
  function message(value){const node=el(root(),'p',value);node.setAttribute('role','status');return node;}
  function errorText(e){return e?.code||e?.message||'요청을 처리하지 못했습니다.';}
  function link(parent,label,href,cls){
    const node=el(parent,'a',label,cls);node.href=href;
    node.onclick=event=>{if(event&&(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button>0))return;
      event?.preventDefault();return openRoute(href);};return node;
  }
  async function api(action,data){
    const user=actor()?.userId;
    if(!user||!own())throw Error('ADMIN_REQUIRED');
    const query=new URLSearchParams({action});
    if(action==='cases')query.set('source',data.source);
    if(action==='accounts')query.set('kind',data.kind);
    const result=await window.WebNovelsAuth.api('/api/v2/admin/operations?'+query,
      ['case-resolve','appeal-resolve','moderate','curate','role-update','account-moderate'].includes(action)?{method:'POST',body:JSON.stringify(data)}:undefined);
    if(actor()?.userId!==user)throw Error('SESSION_CHANGED');
    return result;
  }
  function renderNav(){
    const nav=document.getElementById('adminOperationsNav');if(!nav)return;
    nav.replaceChildren();
    const visible=groups(),group=visible.find(item=>item.key===route?.group),tab=group?.tabs.find(item=>item.key===route?.tab);
    for(const item of visible){
      const node=link(nav,item.label,item.href,'cms-nav-link');
      if(item.key===route?.group)node.setAttribute('aria-current','page');
    }
    const tabs=document.getElementById('adminSectionTabs');tabs?.replaceChildren();
    if(tabs)for(const item of group?.tabs||[]){
      const node=link(tabs,item.label,item.href);if(item.key===route?.tab)node.setAttribute('aria-current','page');
    }
    const crumbs=document.getElementById('adminBreadcrumbs');crumbs?.replaceChildren();
    if(crumbs){el(crumbs,'span','관리자');if(group)el(crumbs,'span','/ '+group.label);if(tab)el(crumbs,'span','/ '+tab.label);}
    const heading=document.getElementById('adminWorkspaceHeading'),description=document.getElementById('adminWorkspaceDescription');
    if(heading)heading.textContent=tab?.label||'관리자 작업 영역';
    const descriptions={home:'현재 운영 현황을 확인하고 필요한 업무로 이동하세요.',content:'작품과 회차를 확인하고, 관리자가 직접 추천 작품을 선정합니다.',
      members:'독자와 작가의 계정 상태 및 지원 이력을 구분해 확인하세요.',finance:'정산 요청을 확인합니다. 결제·포인트 기능은 준비 상태와 구분해 안내합니다.',
      inbox:'신고, 공개본 변경, 원고 복구와 문의를 업무별로 처리하세요. 최초 발행은 작가가 직접 진행합니다.',settings:'서비스 운영 조건과 외부 연결, 운영 권한 및 처리 기록을 관리하세요.'};
    if(description)description.textContent=descriptions[group?.key]||'주소와 접근 권한을 확인해 주세요.';
    const identity=document.getElementById('adminConsoleIdentity');
    if(identity)identity.textContent=`${own()?.nickname||'관리자'} · ${own()?.role==='SUPER_ADMIN'?'최고 관리자':'업무 관리자'}`;
    const form=document.getElementById('adminGlobalSearch'),input=document.getElementById('adminGlobalSearchInput'),results=document.getElementById('adminGlobalSearchResults');
    if(results){results.replaceChildren();results.hidden=true;}
    if(form&&input&&results)form.onsubmit=event=>{
      event.preventDefault();results.replaceChildren();results.hidden=false;
      const query=input.value.trim().slice(0,80).toLocaleLowerCase('ko-KR');
      if(!query){el(results,'p','찾을 메뉴나 업무명을 입력해 주세요.');return;}
      let count=0;
      for(const section of groups())for(const item of section.tabs){
        if(!(section.label+' '+item.label).toLocaleLowerCase('ko-KR').includes(query))continue;
        link(results,section.label+' › '+item.label,item.href);count++;
      }
      if(!count)el(results,'p','일치하는 메뉴가 없습니다. 회원·작품 검색은 각 업무 화면에서 이용해 주세요.');
    };
  }
  function availableSources(){return sources.filter(([, ,perm])=>can(perm)||can('CASE_READ'));}
  function overview(){
    const panel=el(root(),'section',null,'admin-overview-grid');panel.setAttribute('aria-label','업무 바로가기');
    for(const group of groups())if(group.key!=='home')link(panel,group.label,group.href,'admin-overview-card');
  }
  function prepared(title,text,href,label){
    const panel=el(root(),'section',null,'admin-preparation-state');el(panel,'h3',title);el(panel,'p',text);
    if(href)link(panel,label,href,'btn btn-outline');
  }
  function workflowNavigate(next,options={}){
    const model=navigation.parse('/admin/'+next);if(!model.valid)return;
    const params={};for(const key of ['source','offset','target'])if(options[key]!=null&&options[key]!=='')params[key]=String(options[key]);
    const value={...model,params,source:options.source||model.source};
    if(next==='accounts'){value.tab=options.accountKind||kind;value.kind=value.tab;}
    const href=navigation.path(value);if(href)return openRoute(href);
    message('필터 형식을 확인해 주세요.');
  }
  async function render(){
    if(!active()||!root())return;
    const seq=++turn,user=actor()?.userId,isCurrent=()=>seq===turn&&actor()?.userId===user&&allowed();
    shell().hidden=false;
    document.getElementById('view-admin-cms')?.classList.add('stage9-admin');
    renderNav();root().replaceChildren();message('운영 정보를 불러오는 중입니다…');
    try{
      if(page==='retired'){
        root().replaceChildren();message('이 메뉴는 초기 운영 범위에서 제공하지 않습니다. 기존 기록은 보존됩니다.');return;
      }
      if(!allowed()){root().replaceChildren();message('이 화면을 볼 권한이 없습니다.');return;}
      const offset=Number(route.params.offset||0);
      if(['payments','refunds','reconciliation','content-pages'].includes(page)){
        root().replaceChildren();prepared(page==='content-pages'?'공지·정책 관리 준비 중':'결제 운영 기능 준비 중',
          page==='content-pages'?'공지·정책의 현재 공개 페이지는 유지됩니다. 페이지 편집·검토 기능은 후속 단계에서 연결합니다.':'현재 무료 베타 운영입니다. 결제·입금, 포인트·환불, 대사는 계약과 검증이 완료된 후 단계적으로 연결합니다.',
          page==='content-pages'?'/admin/content?tab=works':'/admin/finance?tab=payouts',page==='content-pages'?'작품 관리로 이동':'작가 정산 확인');return;
      }
      if(page==='settings'&&route.tab==='service'){
        root().replaceChildren();prepared('서비스 운영 정책','최초 발행과 예약 발행은 작가가 직접 진행합니다. 공개 이후 변경 요청은 통합처리함에서 검토합니다. 유료 열람·광고 보상 정책은 후속 개발 단계에서 설정합니다.',
          '/admin/settings?tab=connections','외부 연동·운영 설정 열기');return;
      }
      if(route.group==='settings'&&route.tab==='status'){
        root().replaceChildren();prepared('운영 상태 확인','기존 베타 운영 현황과 문의는 통합처리함의 한 화면에서 확인합니다.',
          '/admin/inbox?tab=support','문의·운영 현황 열기');return;
      }
      if(page==='beta-operations'){await window.AdminBetaOperations.render(root(),{isCurrent});return;}
      if(page==='virtual-accounts'){await window.VirtualAccounts.render(root());return;}
      if(page==='recovery'){await window.AdminRecovery.render(root(),{offset,isCurrent});return;}
      if(window.AdminWorkflow?.active()&&['cases','appeals','accounts','works','curation','audit'].includes(page)){
        await window.AdminWorkflow.render(root(),page,{...(page==='cases'?{source}:{}),...(page==='accounts'?{accountKind:kind}:{}),
          ...(['cases','appeals','accounts','audit'].includes(page)?{offset}:{}),...(page==='audit'?{target:route.params.target}:{}),isCurrent,
          onNavigate:workflowNavigate,externalAccountTabs:true});return;
      }
      if(!window.WEBNOVELS_CONFIG?.adminOperationsEnabled||['roles','settlements','settings','episodes'].includes(page)){
        if(page==='cases'&&source==='COMMENT_REPORT'){
          root().replaceChildren();prepared('댓글 신고 처리 연결 준비 중','현재 환경은 기존 신고 기록을 조회할 수 있습니다. 댓글 신고 처리 연결은 후속 운영 인수에서 확인합니다.',
            '/admin/inbox?tab=cases&source=REPORT','기존 신고 기록 확인');return;
        }
        await window.AdminConsole.render(root(),page,{accountKind:page==='accounts'?kind:undefined,
          caseSource:page==='cases'?source:undefined,onNavigate:workflowNavigate,externalAccountTabs:true,isCurrent});
        if(page==='dashboard'&&isCurrent())overview();return;
      }
      let result;
      if(page==='accounts'){
        if(kind==='reader'&&!can('ACCOUNTS_READ')&&!can('USER_MGMT'))kind='author';
        if(kind==='author'&&!can('ACCOUNTS_READ')&&!can('CREATOR_MGMT'))kind='reader';
        result=await api('accounts',{kind});
      }
      else if(page==='cases'){
        const choices=availableSources();
        if(!choices.some(([key])=>key===source))source=choices[0]?.[0];
        if(!source){root().replaceChildren();message('이 처리함을 볼 권한이 없습니다.');return;}
        result=await api('cases',{source});
      }else result=await api(page==='works'?'work-list':page);
      if(!isCurrent())return;
      root().replaceChildren();
      if(page==='dashboard'){
        el(root(),'h3','운영 현황');
        for(const [key,label] of [['works','작품'],['readers','독자'],['authors','작가'],
          ['pendingReviews','대기 검수'],['pendingReports','대기 신고'],['failedSchedules','예약 실패']])
          el(root(),'p',`${label}: ${result[key]}`);
        overview();
      }else if(page==='accounts'){
        el(root(),'h3','계정 지원 · 조회');
        if(!result.accounts?.length)message('조회 결과가 0건입니다.');
        for(const item of result.accounts||[]){
          const card=el(root(),'article',null,'co-panel');
          el(card,'p',`${item.id} · ${item.nickname||item.pen_name||''} · ${item.status}`);
          if(can('ACCOUNT_MODERATE')&&['ACTIVE','APPROVED','SUSPENDED'].includes(item.status))
            button(card,item.status==='SUSPENDED'?'정지 해제':'계정 정지',async()=>{
              const reason=prompt('계정 조치 사유 (3~500자)');if(!reason||reason.trim().length<3)return;
              try{await api('account-moderate',{kind,accountId:item.id,
                decision:item.status==='SUSPENDED'?'RESTORE':'SUSPEND',reason:reason.trim()});await render();}
              catch(e){message('계정 조치 실패: '+errorText(e));}
            });
        }
        message('비밀번호 변경·계정 삭제는 이 화면에서 제공하지 않습니다.');
      }else if(page==='cases'){
        el(root(),'h3','신고·검수 처리함');
        for(const [key,label] of availableSources())
          button(root(),label,()=>{if(isCurrent())workflowNavigate('cases',{source:key});},key===source?'btn btn-primary btn-sm':'btn btn-outline btn-sm');
        if(!result.cases?.length)message('대기 중인 항목이 0건입니다.');
        for(const item of result.cases||[]){
          const card=el(root(),'article',null,'co-panel');
          el(card,'p',`${item.source} · ${item.label||''} · ${item.created_at||''}`);
          if(can('CASE_RESOLVE')||can(item.source==='CONTENT_REVIEW'?'CONTENT_REVIEW':'COMMENT_REPORT'))
          for(const [decision,label] of [['RESOLVE','조치'],['REJECT','기각']])
            button(card,label,async()=>{
              const reason=prompt('처리 사유 (3~500자)');if(!reason||reason.trim().length<3)return;
              try{await api('case-resolve',{source:item.source,caseId:item.id,decision,reason:reason.trim()});
                await render();}catch(e){message('처리 실패: '+errorText(e));}
            });
        }
      }else if(page==='appeals'){
        el(root(),'h3','이의제기 처리함');
        if(!result.appeals?.length)message('대기 중인 이의제기가 없습니다.');
        for(const item of result.appeals||[]){
          const card=el(root(),'article',null,'co-panel');
          el(card,'p',`${item.source} · ${item.sourceId} · ${item.reason} · ${item.created_at}`);
          if(can('CASE_RESOLVE'))for(const [decision,label] of [['ACCEPT','접수'],['REJECT','기각']])
            button(card,label,async()=>{
              const reason=prompt('심사 사유 (3~500자)');if(!reason||reason.trim().length<3)return;
              try{await api('appeal-resolve',{appealId:item.id,decision,reason:reason.trim()});await render();}
              catch(e){message('이의제기 처리 실패: '+errorText(e));}
            });
        }
      }else if(page==='works'){
        el(root(),'h3','작품 노출·큐레이션');
        if(!result.works?.length)message('조회 결과가 0건입니다.');
        for(const work of result.works||[]){
          const card=el(root(),'article',null,'co-panel');
          el(card,'p',`${work.title} · ${work.moderation_state} · #${work.id}`);
          if(can('CONTENT_MODERATE'))button(card,work.moderation_state==='RESTRICTED'?'제한 해제':'노출 제한',async()=>{
            const reason=prompt('조치 사유 (3~500자)');if(!reason||reason.trim().length<3)return;
            try{await api('moderate',{workId:work.id,version:work.version,
              decision:work.moderation_state==='RESTRICTED'?'UNRESTRICT':'RESTRICT',reason:reason.trim()});
              await render();}catch(e){message('조치 실패: '+errorText(e));}
          });
          if(can('CURATION_WRITE'))for(const [flag,label] of [['is_top_recommended','추천'],
            ['is_popular_work','인기'],['is_new_work','신작']])
            button(card,`${label} ${work[flag]?'해제':'설정'}`,async()=>{
              const reason=prompt('편집 사유 (3~500자)');if(!reason||reason.trim().length<3)return;
              try{await api('curate',{workId:work.id,version:work.version,flag,
                enabled:!work[flag],reason:reason.trim()});await render();}
              catch(e){message('편집 실패: '+errorText(e));}
            });
        }
      }else if(page==='roles'){
        el(root(),'h3','관리 권한');
        for(const item of result.roles||[]){
          const card=el(root(),'article',null,'co-panel');
          el(card,'p',`${item.nickname} · ${item.role} · ${item.is_active?'활성':'비활성'}`);
          if(item.role!=='SUB_ADMIN'){el(card,'p','최고 관리자 권한은 이 화면에서 변경하지 않습니다.');continue;}
          if(!window.WEBNOVELS_CONFIG?.adminRoleChangesEnabled){
            el(card,'p',(item.permissions||[]).join(', ')||'설정된 권한 없음');continue;
          }
          const form=el(card,'form');
          for(const [key,label] of rolePermissions){
            const field=el(form,'label');const check=el(field,'input');
            check.type='checkbox';check.value=key;check.checked=(item.permissions||[]).includes(key);
            el(field,'span',label);
          }
          const save=button(form,'권한 저장',null,'btn btn-primary btn-sm');save.type='submit';
          form.onsubmit=async event=>{event.preventDefault();
            const reason=prompt('변경 사유 (3~500자)');if(!reason||reason.trim().length<3)return;
            save.disabled=true;
            try{await api('role-update',{adminId:item.id,permissions:[...form.querySelectorAll('input:checked')].map(x=>x.value),
              reason:reason.trim()});await render();}catch(e){message('권한 저장 실패: '+errorText(e));save.disabled=false;}
          };
        }
        message(window.WEBNOVELS_CONFIG?.adminRoleChangesEnabled?
          '기존 권한 문자열은 보존되며, 이 화면은 9단계 운영 권한만 편집합니다.':
          '권한 변경은 추가 재인증 절차가 준비된 후 제공됩니다.');
      }else if(page==='audit'){
        el(root(),'h3','처리 기록');
        if(!result.events?.length)message('기록이 0건입니다.');
        for(const item of result.events||[])el(root(),'p',`${item.created_at} · ${item.kind} · ${item.target} · ${item.action} · ${item.reason}`);
      }
    }catch(e){if(isCurrent()){root().replaceChildren();message('조회 실패: '+errorText(e));}}
  }
  function clearModules(){
    window.AdminRecovery?.reset();
    window.AdminBetaOperations?.reset();
    window.VirtualAccounts?.reset();
    window.AdminConsole?.reset();
    window.AdminWorkflow?.reset();
  }
  function openRoute(input,shouldPushState=true){
    if(!active())return legacySwitch?.(String(input).split(/[/?]/).filter(Boolean).pop()||'dashboard',shouldPushState);
    clearModules();turn++;
    route=navigation?.parse(input);sourceExplicit=false;
    if(route?.valid){
      const visible=groups(),group=visible.find(item=>item.key===route.group);
      if(!route.explicit||(route.legacy&&route.page==='dashboard')){
        const initial=route.group==='home'&&!group?visible[0]:group;
        const tab=initial?.tabs.find(item=>item.key===route.tab)||initial?.tabs[0];
        if(tab)route=navigation.parse(navigation.path({...route,group:initial.key,tab:tab.key,
          params:initial.key===route.group?route.params:{},source:initial.key===route.group?route.source:undefined}));
      }
      try{sourceExplicit=new URL(input,location.origin||'https://admin.invalid').searchParams.has('source')||/(?:^|\/)(?:review|comments)(?:[?#]|$)/.test(input);}
      catch{sourceExplicit=false;}
      page=route.page;kind=route.kind||'reader';source=route.source||'CONTENT_REVIEW';
      if(page==='cases'&&!sourceExplicit&&!availableSources().some(([key])=>key===source)){
        source=availableSources()[0]?.[0]||source;
        route=navigation.parse(navigation.path({...route,source}));
      }
      const href=route.href,current=location.pathname+(location.search||'');
      if(current!==href){
        if(shouldPushState)history.pushState({path:href},'',href);
        else history.replaceState?.({path:href},'',href);
      }
    }else page='retired';
    const pending=render();
    if(shouldPushState)root()?.focus?.({preventScroll:true});
    return pending;
  }
  function navigate(tab,shouldPushState=true){
    if(!active())return legacySwitch?.(tab,shouldPushState);
    return openRoute(typeof tab==='string'&&tab.startsWith('/')?tab:'/admin/'+tab,shouldPushState);
  }
  const legacySwitch=window.switchAdminSubTab,legacyDashboard=window.loadAdminDashboard;
  window.switchAdminSubTab=(tab,shouldPush)=>navigate(tab,shouldPush);
  window.loadAdminDashboard=()=>active()?openRoute(/^\/admin(?:\/|$)/.test(location.pathname)?location.pathname+(location.search||''):'/admin',false):legacyDashboard?.();
  window.AdminOperations=Object.freeze({active,api,navigate,openRoute,refresh:render,reset(){turn++;route=null;clearModules();
    if(root())root().replaceChildren();document.getElementById('adminOperationsNav')?.replaceChildren();
    for(const id of ['adminSectionTabs','adminBreadcrumbs','adminGlobalSearchResults'])document.getElementById(id)?.replaceChildren();
    for(const id of ['adminWorkspaceHeading','adminWorkspaceDescription']){const node=document.getElementById(id);if(node)node.textContent='';}
    const form=document.getElementById('adminGlobalSearch');if(form)form.onsubmit=null;
    const input=document.getElementById('adminGlobalSearchInput');if(input)input.value='';
    const results=document.getElementById('adminGlobalSearchResults');if(results)results.hidden=true;
    const identity=document.getElementById('adminConsoleIdentity');if(identity)identity.textContent='';if(shell())shell().hidden=true;}});
})();
