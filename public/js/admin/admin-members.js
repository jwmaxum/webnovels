/* OP-02: separate author/reader member workspaces. All authority is rechecked server-side. */
(function(){
  'use strict';
  const actor=()=>window.WebNovelsAuth?.getActor();
  const can=permission=>actor()?.admin?.role==='SUPER_ADMIN'||actor()?.admin?.permissions?.includes(permission);
  const readable=kind=>!!actor()?.userId&&!!actor()?.admin&&actor().admin.is_active!==false&&
    (can('ACCOUNTS_READ')||can(kind==='author'?'CREATOR_MGMT':'USER_MGMT'));
  const active=()=>!!actor()?.accountServiceReady;
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const decimal=id=>/^[1-9][0-9]{0,18}$/.test(id)&&BigInt(id)<=9223372036854775807n;
  const idFor=(kind,id)=>typeof id==='string'&&(decimal(id)||kind==='reader'&&uuid.test(id));
  const states=new Map();let owner=null,generation=0,dispose=()=>{};
  const initial=()=>({q:'',status:'ALL',linked:'ALL',createdFrom:'',createdTo:'',activity:'ALL',hasWorks:'ALL',settlement:'ALL',pending:'ALL',offset:0});
  const labels={ACTIVE:'활성',APPROVED:'승인',PENDING:'대기',SUSPENDED:'제한',REJECTED:'반려',DELETED:'삭제',WITHDRAWN:'철회',
    NEEDS_CHANGES:'보완 필요',EXPIRED:'보관 기간 만료',REGISTERED:'등록',UNREGISTERED:'미등록',NOT_REGISTERED:'미등록',
    SERIALIZING:'연재',ONGOING:'연재',COMPLETED:'완결',HIATUS:'휴재',NOVEL:'웹소설',WEBTOON:'웹툰',OPEN:'접수',ANSWERED:'답변 완료',RESOLVED:'처리 완료'};
  const label=value=>labels[value]||value||'확인 필요';
  const date=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'미집계';
  const number=value=>Number.isSafeInteger(value)&&value>=0?String(value):'미집계';
  const masked=value=>typeof value==='string'&&value.includes('*')?value:'비공개';
  const settlementText=value=>({REGISTERED:'계좌 등록',UNREGISTERED:'계좌 미등록',NOT_REGISTERED:'계좌 미등록',PENDING:'서류 확인 대기',APPROVED:'서류 확인 완료',NEEDS_CHANGES:'서류 보완 필요',WITHDRAWN:'철회',EXPIRED:'보관 기간 만료',NOT_CONNECTED:'미집계'})[typeof value==='string'?value:value?.state||value?.status]||'미집계';
  const el=(parent,tag,text,cls)=>{const node=document.createElement(tag);if(text!=null)node.textContent=String(text);if(cls)node.className=cls;parent.append(node);return node;};
  function button(parent,text,onclick,primary=false){const node=el(parent,'button',text,primary?'btn btn-primary':'btn btn-outline');node.type='button';node.onclick=onclick;return node;}
  function status(parent,text){const node=el(parent,'p',text,'members-status');node.setAttribute('role','status');node.setAttribute('aria-live','polite');return node;}
  function field(parent,text,type='text',value=''){
    const wrap=el(parent,'label',null,'members-field');el(wrap,'span',text);const node=el(wrap,type==='textarea'?'textarea':'input');
    if(type!=='textarea')node.type=type;node.value=value;node.className='form-control';return node;
  }
  function select(parent,text,choices,value,enabled=true){
    const wrap=el(parent,'label',null,'members-field');el(wrap,'span',text);const node=el(wrap,'select');node.className='form-control';
    for(const [key,name]of choices){const option=el(node,'option',name);option.value=key;if(!enabled&&key!=='ALL')option.disabled=true;}
    node.value=value;node.disabled=!enabled;return node;
  }
  function values(parent,entries){const list=el(parent,'dl',null,'members-values');for(const [name,value]of entries){el(list,'dt',name);el(list,'dd',value);}return list;}
  function leave(){generation++;dispose();dispose=()=>{};}
  function reset(){leave();states.clear();owner=null;}
  function errorText(error){return ({MEMBERS_NOT_READY:'회원 관리 연결을 준비 중입니다.',MEMBER_SERVICE_UNAVAILABLE:'회원 관리 연결을 준비 중입니다.',
    ACCOUNT_SERVICE_NOT_ACTIVATED:'계정 서비스 연결을 준비 중입니다.',FILTER_NOT_AVAILABLE:'이 검색 조건의 집계가 아직 연결되지 않았습니다. 다른 조건을 선택해주세요.',ADMIN_FORBIDDEN:'이 회원을 관리할 권한이 없습니다.',
    ACCOUNT_NOT_FOUND:'회원 정보를 찾을 수 없습니다.',MEMBER_NOT_FOUND:'회원 정보를 찾을 수 없습니다.',RATE_LIMITED:'요청이 많습니다. 잠시 후 다시 시도해주세요.',
    INVALID_QUERY:'검색 조건을 확인해주세요.',INVALID_INPUT:'입력 내용을 확인해주세요.'})[error?.code]||'결과를 확인하지 못했습니다. 연결과 현재 상태를 확인해주세요.';}
  function validMember(member,kind){return !!member&&idFor(kind,member.id)&&typeof member.displayName==='string'&&typeof member.revision==='string'&&/^(0|[1-9][0-9]{0,18}):[a-f0-9]{32}$/.test(member.revision);}
  async function api(action,payload){return window.WebNovelsAuth.api('/api/v2/admin/members?action='+action,{method:'POST',body:JSON.stringify(payload)});}
  function table(parent,caption,columns,items,renderCell){
    const wrap=el(parent,'div',null,'members-table-wrap'),table=el(wrap,'table',null,'members-table');el(table,'caption',caption);
    const head=el(el(table,'thead'),'tr');for(const name of columns)el(head,'th',name).scope='col';
    const body=el(table,'tbody');for(const item of items){const row=el(body,'tr');renderCell(row,item);}return table;
  }
  async function render(root,{kind='reader',accountId,isCurrent=()=>true,onNavigate,onUnavailable,focusList=false}={}){
    if(typeof accountId==='string'&&uuid.test(accountId))accountId=accountId.toLowerCase();
    if(owner!==actor()?.userId){reset();owner=actor()?.userId||null;}else leave();
    const turn=generation,user=actor()?.userId,current=()=>turn===generation&&actor()?.userId===user&&readable(kind)&&isCurrent()&&root.isConnected!==false;
    root.replaceChildren();const inputs=[];dispose=()=>{inputs.forEach(input=>{input.value='';});root.replaceChildren();};
    if(!['author','reader'].includes(kind)||!readable(kind)){status(root,'이 회원 탭을 볼 권한이 없습니다.');return;}
    if(accountId!=null&&!idFor(kind,String(accountId))){status(root,'회원 ID 형식을 확인해주세요.');return;}
    if(!states.has(kind))states.set(kind,{filters:initial(),pending:new Map()});
    const state=states.get(kind),filters=state.filters,title=kind==='author'?'작가':'독자';
    const section=el(root,'section',null,'admin-members');section.setAttribute('aria-label',title+' 관리');
    section.setAttribute('tabindex','-1');if(focusList)section.focus?.({preventScroll:true});
    el(section,'h3',title+' 검색·상세 관리');
    const feedback=status(section,title+' 목록을 불러오는 중입니다…');section.setAttribute('aria-busy','true');
    const selectMember=id=>{
      if(!current())return;
      if(onNavigate)return onNavigate({kind,...(id?{accountId:id}:{})});
      return render(root,{kind,accountId:id,isCurrent,onNavigate,onUnavailable,focusList:!id});
    };
    const reload=()=>{if(current())return render(root,{kind,accountId,isCurrent,onNavigate,onUnavailable,focusList:true});};
    let loadingList=true;
    try{
      const result=await api('list',{kind,...filters});if(!current())return;
      loadingList=false;
      if(result?.kind!==kind||!Array.isArray(result.items)||result.items.length>50||result.items.some(member=>!validMember(member,kind)))throw Error('INVALID_MEMBERS_RESPONSE');
      const capabilities=result.capabilities||{},available=capabilities.filters||{};
      const search=el(section,'form',null,'members-search');search.autocomplete='off';search.setAttribute('aria-label',title+' 검색 조건');
      const q=field(search,kind==='author'?'필명·작가 ID 검색':'닉네임·독자 ID 검색','search',filters.q);q.maxLength=100;inputs.push(q);
      if(capabilities.canSearchEmail===true)el(search,'p','이메일은 전체 주소를 정확히 입력해 검색할 수 있습니다. 검색어는 주소나 기기 저장소에 보관하지 않습니다.','members-hint');
      el(search,'p','최근 활동은 연결된 계정·이용 기록의 최신 시각을 기준으로 조회합니다.','members-hint');
      const controls={q,status:select(search,'계정 상태',kind==='author'?[['ALL','전체'],['PENDING','승인 대기'],['APPROVED','승인'],['REJECTED','반려'],['SUSPENDED','제한']]:[['ALL','전체'],['ACTIVE','활성'],['SUSPENDED','제한']],filters.status),
        linked:select(search,'계정 연결',[['ALL','전체'],['LINKED','연결됨'],['UNLINKED','미연결']],filters.linked),
        createdFrom:field(search,'가입일 시작','date',filters.createdFrom),createdTo:field(search,'가입일 종료','date',filters.createdTo),
        activity:select(search,'최근 활동',[['ALL','전체'],['7D','최근 7일'],['30D','최근 30일'],['90D','최근 90일']],filters.activity,available.activity===true),
        pending:select(search,'미처리 요청',[['ALL','전체'],['YES','있음'],['NO','없음']],filters.pending,available.requests===true)};
      if(kind==='author'){
        controls.hasWorks=select(search,'작품 등록',[['ALL','전체'],['YES','작품 있음'],['NO','작품 없음']],filters.hasWorks,available.work===true);
        controls.settlement=select(search,'정산 준비',[['ALL','전체'],['REGISTERED','계좌 등록'],['UNREGISTERED','계좌 미등록'],['PENDING','서류 확인 대기'],['APPROVED','서류 확인 완료']],filters.settlement,available.settlement===true&&capabilities.canReadSettlement===true);
      }else{
        select(search,'결제·포인트 필터',[['ALL','금융 집계 연결 준비 중']], 'ALL',false);
        el(search,'p','유료 독자·순결제액·유상/보너스 잔액·주문번호 검색은 금융 원장 연결 후 제공합니다. 현재는 미집계이며 0원으로 판정하지 않습니다.','members-hint');
      }
      const actions=el(search,'div',null,'members-actions'),submit=button(actions,'조건 적용',null,true);submit.type='submit';
      button(actions,'조건 초기화',()=>{if(!current())return;state.filters=initial();return render(root,{kind,isCurrent,onNavigate,onUnavailable,focusList:true});});
      button(actions,'새로고침',reload);
      search.onsubmit=event=>{
        event.preventDefault();if(!current())return;
        const next={...initial()};for(const [key,node]of Object.entries(controls))if(!node.disabled)next[key]=node.value.trim();
        if(next.q.length>100||next.createdFrom&&next.createdTo&&next.createdFrom>next.createdTo){feedback.textContent='검색어 길이와 가입일 범위를 확인해주세요.';return;}
        state.filters=next;return render(root,{kind,isCurrent,onNavigate,onUnavailable,focusList:true});
      };
      inputs.push(...Object.values(controls));
      feedback.textContent=`${title} ${number(result.total)}명 · ${Math.floor(filters.offset/50)+1}페이지`;
      if(!result.items.length)status(section,'검색 조건에 맞는 '+title+'가 없습니다.');
      else table(section,title+' 목록',kind==='author'?['작가','상태·연결','작품·최근 발행','미처리 요청','정산 준비']:['독자','상태·연결','가입·최근 활동','미처리 요청'],result.items,(row,member)=>{
        const identity=el(row,'td');button(identity,member.displayName||'이름 없음',()=>selectMember(member.id));el(identity,'p',title+' ID: '+member.id);el(identity,'small',masked(member.maskedEmail));
        el(row,'td',label(member.status)+' · '+(member.authLinked?'연결됨':'미연결'));
        el(row,'td',kind==='author'?number(member.workCount)+'개 · '+date(member.lastPublishedAt):'가입 '+date(member.createdAt)+' · 최근 활동 '+date(member.lastActivityAt));
        el(row,'td',number(member.pendingRequests));if(kind==='author')el(row,'td',capabilities.canReadSettlement===true?settlementText(member.settlementState):'조회 권한 없음');
      });
      const pager=el(section,'nav',null,'members-actions');pager.setAttribute('aria-label',title+' 목록 페이지');
      if(filters.offset>0)button(pager,'이전 페이지',()=>{if(!current())return;state.filters.offset=Math.max(0,filters.offset-50);return render(root,{kind,isCurrent,onNavigate,onUnavailable,focusList:true});});
      if(result.hasMore===true&&Number.isSafeInteger(result.nextOffset)&&result.nextOffset>filters.offset)button(pager,'다음 페이지',()=>{if(!current())return;state.filters.offset=result.nextOffset;return render(root,{kind,isCurrent,onNavigate,onUnavailable,focusList:true});});
      if(accountId)await detail(section,String(accountId),kind,{current,state,inputs,isCurrent,onNavigate,selectMember});
    }catch(error){if(current()){
      if(loadingList&&typeof onUnavailable==='function'&&(error?.status===503||error?.status==null)&&
        ['ACCOUNT_SERVICE_NOT_ACTIVATED','MEMBERS_NOT_READY','MEMBER_SERVICE_UNAVAILABLE'].includes(error?.code))return onUnavailable();
      feedback.textContent=errorText(error);button(section,'다시 불러오기',reload);
    }}
    finally{if(current())section.setAttribute('aria-busy','false');}
  }
  async function detail(parent,id,kind,{current,state,inputs,isCurrent,onNavigate,selectMember}){
    const section=el(parent,'section',null,'members-detail');section.setAttribute('tabindex','-1');section.setAttribute('aria-label',(kind==='author'?'작가':'독자')+' 상세');
    const feedback=status(section,'회원 상세를 불러오는 중입니다…');section.setAttribute('aria-busy','true');
    try{
      const result=await api('detail',{kind,accountId:id});if(!current())return;
      if(result?.kind!==kind||!validMember(result.member,kind)||result.member.id!==id)throw Error('INVALID_MEMBER_RESPONSE');
      section.replaceChildren();const member=result.member,capabilities=result.capabilities||{},author=kind==='author';
      el(section,'h3',member.displayName+' · '+(author?'작가':'독자')+' 상세');button(section,'상세 닫기',()=>selectMember());
      const account=el(section,'section');el(account,'h4',author?'기본 정보':'계정');
      values(account,[[author?'작가 ID':'독자 ID',id],[author?'필명':'닉네임',member.displayName],['계정 상태',label(member.status)],['이메일',masked(member.maskedEmail)],
        ['계정 연결',member.authLinked?'연결됨':'미연결'],['이메일 인증',member.emailConfirmed?'확인':'미확인'],['가입일',date(member.createdAt)],['최근 활동',date(member.lastActivityAt)]]);
      if(author)el(account,'p',member.bio||'등록된 소개가 없습니다.');
      el(account,'p','비밀번호·이메일·실명·계좌·계정 연결은 이 화면에서 변경하지 않습니다. 본인은 로그인 화면의 비밀번호 재설정을 이용할 수 있습니다.','members-hint');
      if(capabilities.canEditPublic===true&&actor()?.admin?.role==='SUPER_ADMIN')edit(account,member,kind,{current,state,inputs,selectMember});
      if(author){
        const works=el(section,'section');el(works,'h4','작품');
        if(!Array.isArray(result.works)||!result.works.length)status(works,'표시할 작품이 없습니다.');
        else table(works,'작가 작품 (최대 50개)',['작품','유형·상태','발행 회차','최근 발행'],result.works.slice(0,50),(row,work)=>{
          const cell=el(row,'td',work.title);if(/^[1-9][0-9]{0,18}$/.test(String(work.id))){const link=el(cell,'a','독자 화면');link.href='/works/'+encodeURIComponent(work.id);}
          el(row,'td',label(work.type)+' · '+label(work.status));el(row,'td',number(work.episodeCount));el(row,'td',date(work.lastPublishedAt));
        });
        const settlement=el(section,'section');el(settlement,'h4','정산');
        if(capabilities.canReadSettlement===true){values(settlement,[['준비 상태',settlementText(result.settlement||member.settlementState)]]);el(settlement,'p','서류 확인 완료는 PASS 인증·은행 예금주 확인·지급 완료를 뜻하지 않습니다.');}
        else status(settlement,'정산 준비 상태를 볼 권한이 없습니다.');
        status(settlement,'출금 가능액·정산 요청액은 수익 원장 연결 전 미집계입니다.');
      }else{
        const finance=el(section,'section');el(finance,'h4','결제·포인트');status(finance,'금융 집계 미연결 · 결제액·순결제액·유상 포인트·보너스 포인트는 미집계입니다.');
        const rights=el(section,'section');el(rights,'h4','구매·열람권');
        if(!Array.isArray(result.rights)||!result.rights.length)status(rights,'열람권 원천 연결 여부를 확인해야 합니다. 연결 전에는 구매 이력 없음으로 판정하지 않습니다.');
        else result.rights.slice(0,50).forEach(right=>el(rights,'p',right.label||'열람권 기록'));
      }
      const requests=el(section,'section');el(requests,'h4','요청·이력');
      if(!Array.isArray(result.requests)||!result.requests.length)status(requests,capabilities.filters?.requests===true?'표시할 요청이 없습니다.':'요청 집계 연결 준비 중입니다.');
      else result.requests.slice(0,50).forEach(request=>{const item=el(requests,'article',null,'members-request');el(item,'p',(request.label||'요청')+' · '+label(request.status));el(item,'small',date(request.createdAt));});
      const links=el(requests,'div',null,'members-actions');
      for(const [href,text]of [['/admin/inbox?tab=support','문의 처리함'],...(author?[['/admin/inbox?tab=cases','공개본 변경 검토함']]:[])]){const link=el(links,'a',text,'btn btn-outline');link.href=href;}
      el(requests,'p','처리함에서는 대상과 요청 종류를 확인해 해당 건을 선택하세요.','members-hint');
      if(Array.isArray(result.history)&&result.history.length){el(requests,'h5','공개 정보 변경 이력');result.history.slice(0,20).forEach(event=>{
        const change=event.before?.displayName&&event.after?.displayName&&event.before.displayName!==event.after.displayName?
          event.before.displayName+' → '+event.after.displayName:'공개 정보 수정';
        el(requests,'p',date(event.createdAt)+' · '+change+' · '+(event.reason||''));
      });}
      section.focus?.({preventScroll:true});
    }catch(error){if(current()){section.replaceChildren();status(section,errorText(error));button(section,'상세 다시 불러오기',()=>selectMember(id));}}
    finally{if(current())section.setAttribute('aria-busy','false');}
  }
  function edit(parent,member,kind,{current,state,inputs,selectMember}){
    const details=el(parent,'details',null,'members-edit');el(details,'summary','공개 정보 수정');
    const form=el(details,'form',null,'members-edit-form');form.autocomplete='off';
    const name=field(form,kind==='author'?'필명 (2~40자)':'닉네임 (2~40자)','text',member.displayName);name.minLength=2;name.maxLength=40;name.required=true;
    const bio=kind==='author'?field(form,'공개 소개 (최대 2,000자)','textarea',member.bio||''):null;if(bio)bio.maxLength=2000;
    const reason=field(form,'수정 사유 (3~500자)','textarea');reason.minLength=3;reason.maxLength=500;reason.required=true;
    const fields=[name,...(bio?[bio]:[]),reason];inputs.push(...fields);
    const feedback=status(form,''),actions=el(form,'div',null,'members-actions'),save=button(actions,'사유를 기록하고 저장',null,true);save.type='submit';
    let busy=false,conflict=false,pending=state.pending.get(member.id)||null;
    if(pending){name.value=pending.displayName;if(bio)bio.value=pending.bio||'';reason.value=pending.reason;fields.forEach(node=>{node.disabled=true;});save.textContent='같은 요청 다시 확인';details.open=true;feedback.textContent='이전 저장 결과를 확인하지 못했습니다. 같은 요청으로 결과를 확인하세요.';}
    const canEdit=()=>current()&&actor()?.admin?.role==='SUPER_ADMIN';
    form.onsubmit=async event=>{
      event.preventDefault();if(!canEdit()||busy||conflict)return;
      if(!pending){
        const displayName=name.value.trim(),text=reason.value.trim();
        if(displayName.length<2||displayName.length>40||/[<>\u0000-\u001f\u007f]/.test(displayName)||text.length<3||text.length>500||bio&&bio.value.length>2000){feedback.textContent='공개 이름, 소개와 수정 사유의 형식·길이를 확인해주세요.';return;}
        pending={kind,accountId:member.id,revision:member.revision,displayName,...(bio?{bio:bio.value}:{}),reason:text,requestId:crypto.randomUUID()};state.pending.set(member.id,pending);
      }
      busy=true;save.disabled=true;fields.forEach(node=>{node.disabled=true;});feedback.textContent='공개 정보를 저장하는 중입니다…';
      try{
        const result=await api('update-profile',pending);if(!canEdit())return;
        if(result?.saved!==true||result.kind!==kind||!validMember(result.member,kind)||result.member.id!==member.id)throw Error('INVALID_MEMBER_SAVE');
        state.pending.delete(member.id);pending=null;conflict=true;feedback.textContent='공개 정보를 저장하고 이력을 기록했습니다.';save.textContent='저장 완료';
        button(actions,'최신 상세 확인',()=>{if(canEdit())return selectMember(member.id);});
      }catch(error){if(!canEdit())return;
        if(error.status===409){state.pending.delete(member.id);pending=null;conflict=true;feedback.textContent='다른 변경과 충돌했습니다. 입력 내용은 유지됩니다. 최신 상세를 확인한 뒤 다시 수정해주세요.';button(actions,'최신 상세 불러오기',()=>{if(canEdit())return selectMember(member.id);});}
        else if(error.status===401||error.status===403){feedback.textContent='세션 또는 수정 권한이 변경되었습니다. 다시 로그인해 주세요.';conflict=true;}
        else if(error.status>=400&&error.status<500){state.pending.delete(member.id);pending=null;fields.forEach(node=>{node.disabled=false;});save.disabled=false;feedback.textContent=errorText(error);}
        else{save.disabled=false;save.textContent='같은 요청 다시 확인';feedback.textContent='저장 결과를 확인하지 못했습니다. 입력을 유지한 같은 요청으로 다시 확인하세요.';}
      }finally{busy=false;}
    };
  }
  window.AdminMembers=Object.freeze({active,render,leave,reset});
})();
