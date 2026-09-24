// Stage 9 administrator operations. The old console remains dormant until cutover.
(function(){
  'use strict';
  const active=()=>window.WEBNOVELS_CONFIG?.adminOperationsEnabled===true;
  const actor=()=>window.WebNovelsAuth?.getActor();
  const root=()=>document.getElementById('adminOperationsContent');
  const shell=()=>document.getElementById('adminOperationsShell');
  const routes={dashboard:'dashboard',users:'accounts',authors:'accounts',creators:'accounts',
    works:'works',episodes:'works',actionqueue:'cases',review:'cases',comments:'cases',
    subadmins:'roles',security:'audit',analytics:'dashboard'};
  const retired=new Set(['admgmt','settlements','revenue','fanmeeting','goods','events']);
  const menu=[['dashboard','현황'],['cases','신고·검수'],['appeals','이의제기'],['accounts','계정 지원'],
    ['works','작품 운영'],['roles','관리 권한'],['audit','처리 기록']];
  const sources=[['CONTENT_REVIEW','콘텐츠 검수','CONTENT_REVIEW'],
    ['COMMENT_REPORT','작품 댓글 신고','COMMENT_REPORT'],['REPORT','기존 신고','COMMENT_REPORT']];
  const rolePermissions=[['OPERATIONS_READ','운영 현황'],['ACCOUNTS_READ','계정 조회'],
    ['CONTENT_METADATA_READ','작품 조회'],['CASE_READ','처리함 조회'],['CASE_RESOLVE','신고 처리'],
    ['CONTENT_REVIEW','콘텐츠 검수'],['COMMENT_REPORT','댓글 신고 처리'],
    ['CONTENT_MODERATE','노출 제한'],['CURATION_WRITE','큐레이션'],['AUDIT_READ','처리 기록'],
    ['ACCOUNT_MODERATE','계정 정지·복구']];
  let page='dashboard',kind='reader',source='CONTENT_REVIEW',turn=0;
  const own=()=>actor()?.admin;
  const can=permission=>own()?.role==='SUPER_ADMIN'||own()?.permissions?.includes(permission);
  const canRead=key=>key==='dashboard'?(can('OPERATIONS_READ')||can('DASHBOARD')):
    key==='cases'?(can('CASE_READ')||can('CONTENT_REVIEW')||can('COMMENT_REPORT')):
    key==='appeals'?can('CASE_READ'):
    key==='accounts'?(can('ACCOUNTS_READ')||can('USER_MGMT')||can('CREATOR_MGMT')):
    key==='works'?(can('CONTENT_METADATA_READ')||can('WORK_MGMT')):
    key==='roles'?own()?.role==='SUPER_ADMIN':
    key==='audit'?(can('AUDIT_READ')||can('SECURITY_MGMT')):false;
  function el(parent,tag,value,cls){const node=document.createElement(tag);if(value!=null)node.textContent=String(value);
    if(cls)node.className=cls;parent.append(node);return node;}
  function button(parent,label,action,cls='btn btn-outline btn-sm'){
    const node=el(parent,'button',label,cls);node.type='button';node.onclick=action;return node;}
  function message(value){const node=el(root(),'p',value);node.setAttribute('role','status');return node;}
  function errorText(e){return e?.code||e?.message||'요청을 처리하지 못했습니다.';}
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
    for(const [key,label] of menu){
      if(!canRead(key))continue;
      const item=button(nav,label,()=>navigate(key),key===page?'btn btn-primary btn-sm':'btn btn-outline btn-sm');
      item.setAttribute('aria-current',key===page?'page':'false');
    }
  }
  function availableSources(){return sources.filter(([, ,perm])=>can(perm)||can('CASE_READ'));}
  async function render(){
    if(!active()||!root())return;
    const seq=++turn,user=actor()?.userId;
    shell().hidden=false;
    document.getElementById('view-admin-cms')?.classList.add('stage9-admin');
    renderNav();root().replaceChildren();message('운영 정보를 불러오는 중입니다…');
    try{
      if(page==='retired'){
        root().replaceChildren();message('이 메뉴는 초기 운영 범위에서 제공하지 않습니다. 기존 기록은 보존됩니다.');return;
      }
      if(!canRead(page)){root().replaceChildren();message('이 화면을 볼 권한이 없습니다.');return;}
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
      if(seq!==turn||actor()?.userId!==user)return;
      root().replaceChildren();
      if(page==='dashboard'){
        el(root(),'h3','운영 현황');
        for(const [key,label] of [['works','작품'],['readers','독자'],['authors','작가'],
          ['pendingReviews','대기 검수'],['pendingReports','대기 신고'],['failedSchedules','예약 실패']])
          el(root(),'p',`${label}: ${result[key]}`);
      }else if(page==='accounts'){
        el(root(),'h3','계정 지원 · 조회');
        for(const [key,label,legacy] of [['reader','독자','USER_MGMT'],['author','작가','CREATOR_MGMT']])
          if(can('ACCOUNTS_READ')||can(legacy))button(root(),label,()=>{kind=key;render();});
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
          button(root(),label,()=>{source=key;render();},key===source?'btn btn-primary btn-sm':'btn btn-outline btn-sm');
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
    }catch(e){if(seq===turn&&actor()?.userId===user){root().replaceChildren();message('조회 실패: '+errorText(e));}}
  }
  function navigate(tab,shouldPushState=true){
    if(!active())return legacySwitch(tab,shouldPushState);
    page=retired.has(tab)?'retired':routes[tab]||tab;
    if(!menu.some(([key])=>key===page)&&page!=='retired')page='retired';
    if(tab==='dashboard'&&!canRead('dashboard'))page=menu.find(([key])=>canRead(key))?.[0]||'retired';
    if(tab==='authors'||tab==='creators')kind='author';
    if(tab==='users')kind='reader';
    if(tab==='review')source='CONTENT_REVIEW';
    if(tab==='comments')source='COMMENT_REPORT';
    if(shouldPushState){const path=tab==='dashboard'?'/admin':'/admin/'+tab;
      if(location.pathname!==path)history.pushState({path},'',path);}
    return render();
  }
  const legacySwitch=window.switchAdminSubTab,legacyDashboard=window.loadAdminDashboard;
  window.switchAdminSubTab=(tab,shouldPush)=>navigate(tab,shouldPush);
  window.loadAdminDashboard=()=>active()?navigate(location.pathname.split('/')[2]||'dashboard',false):legacyDashboard?.();
  window.AdminOperations=Object.freeze({active,api,navigate,refresh:render,reset(){turn++;if(root())root().replaceChildren();}});
})();
