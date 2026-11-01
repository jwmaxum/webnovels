/* OP-03: one explicit, administrator-selected display document. */
(function(){
  'use strict';
  const actor=()=>window.WebNovelsAuth?.getActor();
  const allowed=()=>!!actor()?.userId&&!!actor()?.admin&&actor().admin.is_active!==false&&
    (actor().admin.role==='SUPER_ADMIN'||actor().admin.permissions?.includes('CURATION_WRITE'));
  const active=()=>!!actor()?.accountServiceReady;
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const decimal=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value)&&BigInt(value)<=9223372036854775807n;
  const workId=value=>decimal(value)&&value!=='0';
  const blockNames={hero:'대표 추천',recommendations:'추천 작품 목록',latest:'최신 연재',ranking:'인기 랭킹',notice:'공지·안내'};
  const menuNames={home:'홈',novel:'웹소설',webtoon:'웹툰',recommendations:'추천',ranking:'랭킹'};
  const clone=value=>JSON.parse(JSON.stringify(value));
  const kst=value=>value&&Number.isFinite(Date.parse(value))?new Date(Date.parse(value)+9*3600000).toISOString().slice(0,16):'';
  const utc=value=>{if(!value)return null;if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('한국 시간의 날짜와 시각을 확인해주세요.');
    const stamp=new Date(value+'+09:00');if(!Number.isFinite(stamp.getTime())||kst(stamp.toISOString())!==value)throw Error('한국 시간의 날짜와 시각을 확인해주세요.');return stamp.toISOString();};
  const date=value=>value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' KST':'제한 없음';
  const href=value=>value===''||typeof value==='string'&&(/^(?:\/home|\/discover|\/recommendations)\/?$/.test(value)||/^\/company\/$/.test(value)||/^\/policies\/(?:terms|privacy|refund|settlement)\/$/.test(value)||/^\/works\/[1-9][0-9]*$/.test(value)&&workId(value.slice(7)));
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[<>\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)&&!/[\uD800-\uDFFF]/u.test(value);
  const timestamp=value=>value===null||typeof value==='string'&&Number.isFinite(Date.parse(value));
  let owner=null,generation=0,dispose=()=>{},state=null;
  const fresh=()=>({document:null,revision:null,dirty:false,conflict:false,canEdit:false,pending:null,preview:null,reason:'',
    cards:new Map(),query:{q:'',type:'ALL',offset:0},legacyOffset:0,server:null,settingsOpen:false,releasesOpen:false,legacyOpen:false,publishMode:'NOW',publishStart:kst(new Date(Date.now()+3600000).toISOString()),publishEnd:'',previewAt:kst(new Date().toISOString()),message:''});
  const el=(parent,tag,value,cls)=>{const node=document.createElement(tag);if(value!=null)node.textContent=String(value);if(cls)node.className=cls;parent.append(node);return node;};
  function button(parent,label,action,primary=false){const node=el(parent,'button',label,primary?'btn btn-primary':'btn btn-outline');node.type='button';node.onclick=action;return node;}
  function field(parent,label,type='text',value='',max){const wrap=el(parent,'label',null,'display-field');el(wrap,'span',label);
    const node=el(wrap,type==='textarea'?'textarea':'input');if(type!=='textarea')node.type=type;node.value=value;node.className='form-control';if(max)node.maxLength=max;return node;}
  function check(parent,label,value,action){const wrap=el(parent,'label',null,'display-check'),node=el(wrap,'input');node.type='checkbox';node.checked=value===true;el(wrap,'span',label);node.onchange=()=>action(node.checked);return node;}
  function select(parent,label,options,value,action){const wrap=el(parent,'label',null,'display-field');el(wrap,'span',label);const node=el(wrap,'select');node.className='form-control';
    for(const [key,name]of options){const item=el(node,'option',name);item.value=key;}node.value=value;node.onchange=()=>action(node.value);return node;}
  function status(parent,value){const node=el(parent,'p',value,'display-status');node.setAttribute('role','status');node.setAttribute('aria-live','polite');return node;}
  function leave(){generation++;dispose();dispose=()=>{};}
  function reset(){leave();owner=null;state=null;}
  const errorText=error=>({ADMIN_FORBIDDEN:'추천·전시 관리 권한이 없습니다.',DISPLAY_NOT_READY:'추천·전시 서비스 연결을 준비 중입니다.',
    ACCOUNT_SERVICE_NOT_ACTIVATED:'계정 서비스 연결을 준비 중입니다.',DISPLAY_CONFLICT:'다른 관리자의 변경과 충돌했습니다.',REVISION_CONFLICT:'다른 관리자의 변경과 충돌했습니다.',
    RATE_LIMITED:'요청이 많습니다. 잠시 후 다시 시도해주세요.',INVALID_DOCUMENT:'선정 목록과 전시 설정을 확인해주세요.',INVALID_DISPLAY_DOCUMENT:'전시 문구의 형식·길이와 날짜를 확인해주세요. 꺾쇠(<, >)와 HTML 태그는 지원하지 않습니다.',INVALID_DISPLAY_REQUEST:'입력 형식을 확인해주세요.'})[error?.code]||'요청 결과를 확인하지 못했습니다. 연결과 현재 상태를 확인해주세요.';
  async function api(action,body={}){return window.WebNovelsAuth.api('/api/v2/admin/display?action='+action,{method:'POST',body:JSON.stringify(body)});}
  function validDocument(doc){
    if(!object(doc)||!Array.isArray(doc.selections)||doc.selections.length>200||!Array.isArray(doc.blocks)||!Array.isArray(doc.menus)||!Array.isArray(doc.notices)||doc.notices.length>10||!text(doc.footerNote,300))return false;
    const ids=new Set(),works=new Set();
    for(const row of doc.selections){if(!object(row)||!uuid.test(row.id||'')||!workId(row.workId)||ids.has(row.id)||works.has(row.workId)||!['NONE','HERO','FEATURED'].includes(row.home)||typeof row.enabled!=='boolean'||!text(row.caption,120)||!timestamp(row.startsAt)||!timestamp(row.endsAt)||row.startsAt&&row.endsAt&&Date.parse(row.endsAt)<=Date.parse(row.startsAt))return false;ids.add(row.id);works.add(row.workId);}
    if(doc.selections.filter(row=>row.enabled&&row.home==='FEATURED').length>8)return false;
    const heroes=doc.selections.filter(row=>row.enabled&&row.home==='HERO');for(let a=0;a<heroes.length;a++)for(let b=a+1;b<heroes.length;b++)if(Math.max(heroes[a].startsAt?Date.parse(heroes[a].startsAt):-Infinity,heroes[b].startsAt?Date.parse(heroes[b].startsAt):-Infinity)<Math.min(heroes[a].endsAt?Date.parse(heroes[a].endsAt):Infinity,heroes[b].endsAt?Date.parse(heroes[b].endsAt):Infinity))return false;
    for(const [rows,names,key]of [[doc.blocks,blockNames,'key'],[doc.menus,menuNames,'key']]){
      if(rows.length!==5||new Set(rows.map(row=>row?.[key])).size!==5||rows.some(row=>!Object.hasOwn(names,row?.[key])))return false;
    }
    if(doc.blocks.some(row=>typeof row.enabled!=='boolean'||!text(row.title,60)||!row.title.trim())||doc.menus.some(row=>typeof row.visible!=='boolean'||!text(row.label,20)||!row.label.trim())||doc.menus.find(row=>row.key==='home')?.visible!==true)return false;
    const notices=new Set();for(const row of doc.notices){if(!object(row)||!uuid.test(row.id||'')||notices.has(row.id.toLowerCase())||!text(row.title,80)||!row.title.trim()||!text(row.body,2000)||!href(row.href)||typeof row.enabled!=='boolean'||!timestamp(row.startsAt)||!timestamp(row.endsAt)||row.startsAt&&row.endsAt&&Date.parse(row.endsAt)<=Date.parse(row.startsAt))return false;notices.add(row.id.toLowerCase());}
    return true;
  }
  function validGet(result){return result?.ready===true&&object(result.draft)&&decimal(result.draft.revision)&&validDocument(result.draft.document)&&Array.isArray(result.releases)&&result.releases.every(row=>uuid.test(row.id||'')&&timestamp(row.startsAt)&&row.startsAt!==null&&timestamp(row.endsAt));}
  function remember(result){for(const card of result.selectionCards||[])if(object(card)&&workId(card.id))state.cards.set(card.id,card);}
  async function render(root,{isCurrent=()=>true}={}){
    if(owner!==actor()?.userId){reset();owner=actor()?.userId||null;}else leave();if(!state)state=fresh();
    const turn=generation,user=actor()?.userId,current=()=>turn===generation&&actor()?.userId===user&&allowed()&&isCurrent()&&root.isConnected!==false;
    root.replaceChildren();dispose=()=>root.replaceChildren();
    if(!allowed()){status(root,'이 추천·전시 화면을 볼 권한이 없습니다.');return;}
    let feedback,controls=[],protectedControls=new Set(),busy=false,searchTurn=0,publishControl=null,previewControl=null,sectionNode=null,selectionNodes=new Map();
    status(root,'추천·전시 설정을 불러오는 중입니다…');
    try{
      const result=await api('get');if(!current())return;if(!validGet(result))throw Error('INVALID_DISPLAY_RESPONSE');
      remember(result);state.server=result;state.canEdit=result.capabilities?.canEdit===true;
      if(!state.document||!state.dirty&&!state.pending){state.document=clone(result.draft.document);state.revision=result.draft.revision;state.conflict=false;}
      else if(!state.pending&&state.revision!==result.draft.revision){state.conflict=true;state.message='서버 초안이 바뀌었습니다. 작성 내용은 유지됩니다. 최신 초안을 명시적으로 불러온 뒤 다시 편집해주세요.';}
      draw();
    }catch(error){if(current()){root.replaceChildren();status(root,errorText(error));button(root,'다시 불러오기',()=>render(root,{isCurrent}));}}
    function editable(){return current()&&state.canEdit&&!state.pending&&!state.conflict;}
    function changed(){state.dirty=true;state.preview=null;if(publishControl)publishControl.disabled=true;if(previewControl)previewControl.disabled=true;}
    function change(fn,focusId){if(!editable())return;fn();changed();draw();(selectionNodes.get(focusId)||sectionNode)?.focus?.({preventScroll:true});}
    function move(rows,index,direction){const focusId=rows===state.document.selections?rows[index]?.id:null;change(()=>{const target=index+direction;if(target>=0&&target<rows.length)[rows[index],rows[target]]=[rows[target],rows[index]];},focusId);}
    async function mutate(action,payload){
      if(!current()||!state.canEdit||state.conflict||busy)return;
      if(!state.pending){
        if(action==='publish'&&(state.dirty||state.preview?.revision!==state.revision)){feedback.textContent='현재 초안을 저장하고 미리보기를 확인한 뒤 발행해주세요.';return;}
        const invalid=controls.find(node=>node.checkValidity?.()===false);if(invalid){invalid.reportValidity?.();feedback.textContent='입력값의 형식과 길이를 확인해주세요.';return;}
        if(state.reason.trim().length<3||state.reason.length>500){feedback.textContent='변경 사유를 3~500자로 입력해주세요.';return;}
        if(!validDocument(state.document)){feedback.textContent='선정 목록, 날짜, 메뉴와 공지의 형식·길이를 확인해주세요. 전시 문구에 꺾쇠(<, >)와 HTML 태그는 사용할 수 없습니다.';return;}
        try{payload=payload();}catch(error){feedback.textContent=error.message;return;}
        state.pending={action,body:{...payload,reason:state.reason.trim(),requestId:crypto.randomUUID()}};
      }
      busy=true;draw();
      try{
        const result=await api(state.pending.action,clone(state.pending.body));if(!current())return;if(!validGet(result)||['save','publish'].includes(state.pending.action)&&result.saved!==true)throw Error('INVALID_DISPLAY_RESPONSE');
        remember(result);state.server=result;state.document=clone(result.draft.document);state.revision=result.draft.revision;state.dirty=false;state.conflict=false;state.pending=null;state.preview=null;state.reason='';state.message='요청을 처리하고 이력을 기록했습니다.';
      }catch(error){if(!current())return;
        if(error.status===409){state.pending=null;state.conflict=true;state.message='다른 변경과 충돌했습니다. 작성 내용은 유지됩니다. 최신 초안을 불러온 뒤 다시 확인해주세요.';}
        else if(error.status===401||error.status===403){state.conflict=true;state.message='세션 또는 관리 권한이 바뀌었습니다. 다시 로그인해 주세요.';}
        else if(error.status>=400&&error.status<500){state.pending=null;state.message=errorText(error);}
        else state.message='결과를 확인하지 못했습니다. 내용을 유지한 동일 요청으로 다시 확인하세요.';
      }finally{busy=false;if(current())draw();}
    }
    function draw(){
      if(!current())return;root.replaceChildren();controls=[];protectedControls=new Set();publishControl=null;previewControl=null;selectionNodes=new Map();const section=el(root,'section',null,'admin-display');sectionNode=section;section.setAttribute('aria-label','추천·전시 CMS');section.setAttribute('tabindex','-1');section.setAttribute('aria-busy',busy?'true':'false');
      el(section,'h3','관리자 직접 선정 추천·전시');el(section,'p','저장한 작품만 선정 목록에 포함됩니다. 랭킹이나 인기작으로 빈 추천 영역을 자동 채우지 않습니다.','display-hint');
      el(section,'p','공지·메뉴·추천 문구 등은 일반 텍스트로 입력해주세요. 꺾쇠(<, >)와 HTML 태그는 지원하지 않습니다.','display-hint');
      feedback=status(section,state.message||'초안을 저장하고 미리보기를 확인한 뒤 발행하세요.');
      const summary=el(section,'dl',null,'display-values');for(const [key,value]of [['초안 버전',state.revision],['작성 상태',state.dirty?'저장 전 변경 있음':'서버 저장본'],['발행 이력',String(state.server.releases.length)+'건']]){el(summary,'dt',key);el(summary,'dd',value);}
      if(!state.canEdit)status(section,'조회 전용입니다. 전시 내용을 변경할 수 없습니다.');
      if(state.conflict){const reload=button(section,'최신 초안 불러오기',()=>{if(!current())return;state.document=null;state.dirty=false;state.conflict=false;state.preview=null;return render(root,{isCurrent});});reload.disabled=busy||!!state.pending;}
      if(state.pending){status(section,'결과 미확인 요청이 보관되어 있습니다. 새 변경을 만들지 않고 같은 요청을 확인합니다.');const retry=button(section,'같은 요청 다시 확인',()=>mutate(state.pending.action,()=>({})),true);retry.disabled=busy||state.conflict||!state.canEdit;}
      const layout=el(section,'div',null,'display-editor-grid');searchPanel(layout);selectionPanel(layout);
      const settings=el(section,'details',null,'display-details');settings.open=state.settingsOpen;settings.ontoggle=()=>{if(current())state.settingsOpen=settings.open;};el(settings,'summary','홈 블록·공지·메뉴·푸터 편집');documentSettings(settings);
      const actions=el(section,'section',null,'display-panel');el(actions,'h4','저장·미리보기·발행');
      const reason=field(actions,'변경 사유 (3~500자)','textarea',state.reason,500);reason.oninput=()=>{state.reason=reason.value;};reason.minLength=3;controls.push(reason);
      const toolbar=el(actions,'div',null,'display-actions');const save=button(toolbar,'초안 저장',()=>{state.reason=reason.value;return mutate('save',()=>({revision:state.revision,document:clone(state.document)}));},true);save.disabled=!editable();
      const previewTime=field(actions,'미리보기 시각 (한국 시간 KST)','datetime-local',state.previewAt);previewTime.oninput=()=>{state.previewAt=previewTime.value;state.preview=null;};controls.push(previewTime);
      const preview=button(toolbar,'저장한 초안 미리보기',()=>previewDraft(previewTime.value));previewControl=preview;preview.disabled=!current()||busy||!!state.pending||state.conflict||state.dirty;
      const mode=select(actions,'발행 방식',[['NOW','지금 발행'],['SCHEDULED','예약 발행']],state.publishMode,next=>{if(!editable())return;state.publishMode=next;if(next==='SCHEDULED'&&(!state.publishStart||Date.parse(utc(state.publishStart))<=Date.now()))state.publishStart=kst(new Date(Date.now()+3600000).toISOString());draw();});controls.push(mode);
      el(actions,'p','지금 발행은 실제 실행 시각을 사용합니다. 예약 발행은 한국 시간으로 입력하세요.','display-hint');
      const starts=field(actions,'발행 시작 (한국 시간 KST)','datetime-local',state.publishMode==='SCHEDULED'?state.publishStart:''),ends=field(actions,'발행 종료 (선택·한국 시간 KST)','datetime-local',state.publishEnd);
      if(state.publishMode==='NOW')protectedControls.add(starts);
      starts.oninput=()=>state.publishStart=starts.value;ends.oninput=()=>state.publishEnd=ends.value;controls.push(starts,ends);
      const publish=button(toolbar,'확인한 초안 발행·예약',()=>{state.reason=reason.value;return mutate('publish',()=>{const startsAt=state.publishMode==='NOW'?new Date().toISOString():utc(starts.value),endsAt=utc(ends.value);if(!startsAt||endsAt&&Date.parse(endsAt)<=Date.parse(startsAt))throw Error('발행 시작과 종료 시각을 확인해주세요.');return {revision:state.revision,startsAt,endsAt};});},true);
      publishControl=publish;publish.disabled=!editable()||state.dirty||state.preview?.revision!==state.revision;
      if(state.preview?.revision===state.revision)previewPanel(section,state.preview);
      releases(section,reason);
      controls.forEach(node=>{node.disabled=!editable()||protectedControls.has(node);});previewTime.disabled=busy||!!state.pending||state.conflict;
    }
    function bind(parent,label,type,value,max,write){const node=field(parent,label,type,value,max);controls.push(node);node.oninput=()=>{if(!editable())return;write(node.value);changed();};return node;}
    function toggle(parent,label,value,write){const node=check(parent,label,value,next=>{if(editable()){write(next);changed();}});controls.push(node);return node;}
    function schedule(parent,row){for(const [key,label]of [['startsAt','시작 (선택·한국 시간 KST)'],['endsAt','종료 (선택·한국 시간 KST)']]){
      const node=field(parent,label,'datetime-local',kst(row[key]));controls.push(node);node.onchange=()=>{if(!editable())return;try{const next=kst(row[key])===node.value?row[key]:utc(node.value);row[key]=next;node.setCustomValidity?.('');changed();feedback.textContent='날짜 변경을 초안에 반영했습니다. 저장한 뒤 미리보기를 확인하세요.';}catch(error){node.setCustomValidity?.(error.message);feedback.textContent=error.message;}};
    }}
    function workSummary(parent,card,id){const panel=el(parent,'div',null,'display-work-summary');el(panel,'strong',typeof card?.title==='string'?card.title:'작품 #'+id);
      el(panel,'p',`작품 ID ${id} · ${typeof card?.author==='string'?card.author:typeof card?.author_name==='string'?card.author_name:'작가 정보 확인 필요'} · ${card?.content_type==='WEBTOON'?'웹툰':'웹소설'}`);
      if(card?.eligible===false)el(panel,'p','현재 공개 제외: '+(card.exclusionReason||'현재 공개 조건 미충족'),'display-hint');return panel;}
    function add(card){if(!editable()||!workId(card?.id))return;if(state.document.selections.some(row=>row.workId===card.id)){feedback.textContent='이미 선정한 작품입니다.';return;}if(state.document.selections.length>=200){feedback.textContent='선정 작품은 최대 200개입니다.';return;}
      state.cards.set(card.id,card);const id=crypto.randomUUID();change(()=>state.document.selections.push({id,workId:card.id,home:'NONE',startsAt:null,endsAt:null,enabled:true,caption:''}),id);}
    function searchPanel(parent){const panel=el(parent,'section',null,'display-panel');el(panel,'h4','작품 검색·선정');const form=el(panel,'form',null,'display-form');form.setAttribute('aria-label','추천 작품 검색');
      const q=field(form,'작품명·필명·작품 ID','search',state.query.q,100),type=select(form,'작품 유형',[['ALL','전체'],['NOVEL','웹소설'],['WEBTOON','웹툰']],state.query.type,()=>{}),actions=el(form,'div',null,'display-actions'),submit=button(actions,'작품 검색',null);submit.type='submit';
      const result=el(panel,'div');
      form.onsubmit=event=>{event.preventDefault();state.query={q:q.value.trim(),type:type.value,offset:0};return loadSearch(result);};
      button(actions,'검색 결과 다시 보기',()=>loadSearch(result));
      const legacy=el(panel,'details',null,'display-details');legacy.open=state.legacyOpen;legacy.ontoggle=()=>{if(current())state.legacyOpen=legacy.open;};el(legacy,'summary','이전 추천 자료 검토');el(legacy,'p','이전 플래그·예약은 확인 자료입니다. 항목을 직접 선택해야 새 초안에 추가됩니다.','display-hint');const legacyResult=el(legacy,'div');button(legacy,'이전 자료 불러오기',()=>loadLegacy(legacyResult));
    }
    function pager(parent,response,load){const nav=el(parent,'nav',null,'display-actions');nav.setAttribute('aria-label','작품 결과 페이지');if(response.offset>0)button(nav,'이전 결과',()=>load(Math.max(0,response.offset-50)));
      if(response.hasMore&&Number.isInteger(response.nextOffset))button(nav,'다음 결과',()=>load(response.nextOffset));}
    async function loadSearch(parent){const seq=++searchTurn,query=clone(state.query);parent.replaceChildren();status(parent,'검색 중입니다…');
      try{const response=await api('search',query);if(!current()||seq!==searchTurn)return;if(!Array.isArray(response.items)||response.items.length>50||response.items.some(card=>!workId(card?.id)))throw Error('INVALID_SEARCH_RESPONSE');parent.replaceChildren();status(parent,`검색 결과 ${response.total??'확인 필요'}건`);
        const list=el(parent,'ul',null,'display-work-list');for(const card of response.items){state.cards.set(card.id,card);const li=el(list,'li',null,'display-work');workSummary(li,card,card.id);const addButton=button(li,'이 작품 선정',()=>add(card));addButton.setAttribute('aria-label',(card.title||'작품 #'+card.id)+' 선정');addButton.disabled=!editable()||state.document.selections.some(row=>row.workId===card.id);}
        if(!response.items.length)status(parent,'검색 결과가 없습니다.');pager(parent,response,offset=>{state.query.offset=offset;return loadSearch(parent);});
      }catch(error){if(current()&&seq===searchTurn){parent.replaceChildren();status(parent,errorText(error));}}
    }
    async function loadLegacy(parent){parent.replaceChildren();status(parent,'이전 자료를 확인하는 중입니다…');try{
      const response=await api('legacy',{offset:state.legacyOffset});if(!current())return;if(!Array.isArray(response.items)||response.items.length>50||response.items.some(item=>!workId(item?.work?.id)))throw Error('INVALID_LEGACY_RESPONSE');parent.replaceChildren();const selected=new Set(),list=el(parent,'ul',null,'display-work-list');
      for(const item of response.items){const li=el(list,'li',null,'display-work');workSummary(li,item.work,item.work.id);el(li,'p','이전 원천: '+(Array.isArray(item.origins)?item.origins.map(origin=>typeof origin==='string'?origin:'이전 편집 자료').join(', '):'검토 필요'),'display-hint');const choice=check(li,'이 작품을 새 초안에 선정',false,yes=>{if(yes)selected.add(item.work.id);else selected.delete(item.work.id);});choice.disabled=!editable()||state.document.selections.some(row=>row.workId===item.work.id);}
      const apply=button(parent,'체크한 작품만 초안에 추가',()=>{if(!editable())return;const rows=response.items.filter(item=>selected.has(item.work.id));if(!rows.length){feedback.textContent='직접 확인한 작품을 체크해주세요.';return;}for(const item of rows){if(state.document.selections.length>=200)break;if(state.document.selections.some(row=>row.workId===item.work.id))continue;state.cards.set(item.work.id,item.work);state.document.selections.push({id:crypto.randomUUID(),workId:item.work.id,home:'NONE',startsAt:null,endsAt:null,enabled:true,caption:''});}changed();draw();});apply.disabled=!editable();
      if(!response.items.length)status(parent,'검토할 이전 추천 자료가 없습니다.');pager(parent,response,offset=>{state.legacyOffset=offset;return loadLegacy(parent);});
    }catch(error){if(current()){parent.replaceChildren();status(parent,errorText(error));}}}
    function selectionPanel(parent){const panel=el(parent,'section',null,'display-panel');el(panel,'h4','선정 작품 · '+state.document.selections.length+'개');el(panel,'p','배열 순서가 추천 페이지 순서입니다. 홈 노출은 같은 선정 항목에서 지정합니다.','display-hint');
      const list=el(panel,'ol',null,'display-selected');state.document.selections.forEach((row,index)=>{const item=el(list,'li',null,'display-work');item.setAttribute('tabindex','-1');selectionNodes.set(row.id,item);el(item,'p',String(index+1)+'번째','display-order');workSummary(item,state.cards.get(row.workId),row.workId);
        const actions=el(item,'div',null,'display-actions');const up=button(actions,'위로: '+row.workId,()=>move(state.document.selections,index,-1)),down=button(actions,'아래로: '+row.workId,()=>move(state.document.selections,index,1)),remove=button(actions,'선정 해제: '+row.workId,()=>{const focusId=(state.document.selections[index+1]||state.document.selections[index-1])?.id;change(()=>state.document.selections.splice(index,1),focusId);});up.disabled=!editable()||index===0;down.disabled=!editable()||index===state.document.selections.length-1;remove.disabled=!editable();
        toggle(item,'추천 노출 활성',row.enabled,next=>row.enabled=next);const home=select(item,'홈 노출',[['NONE','추천 페이지만'],['HERO','홈 대표 추천'],['FEATURED','홈 추천 목록']],row.home,next=>{if(editable()){row.home=next;changed();}});controls.push(home);
        bind(item,'추천 문구 (최대 120자)','text',row.caption,120,next=>row.caption=next);schedule(item,row);
      });if(!state.document.selections.length)status(panel,'선정한 작품이 없습니다. 직접 검색하거나 이전 자료를 검토해 추가하세요.');
    }
    function ordering(parent,rows,index,label){const actions=el(parent,'div',null,'display-actions'),up=button(actions,'위로: '+label,()=>move(rows,index,-1)),down=button(actions,'아래로: '+label,()=>move(rows,index,1));up.disabled=!editable()||index===0;down.disabled=!editable()||index===rows.length-1;}
    function documentSettings(parent){
      const blocks=el(parent,'section',null,'display-panel');el(blocks,'h4','홈 블록 순서·표시');state.document.blocks.forEach((row,index)=>{const item=el(blocks,'div',null,'display-work');el(item,'h5',blockNames[row.key]);ordering(item,state.document.blocks,index,blockNames[row.key]);toggle(item,'이 블록 표시',row.enabled,next=>row.enabled=next);bind(item,'블록 제목: '+blockNames[row.key],'text',row.title,60,next=>row.title=next);});
      const notices=el(parent,'section',null,'display-panel');el(notices,'h4','공지·안내');state.document.notices.forEach((row,index)=>{const item=el(notices,'div',null,'display-work');ordering(item,state.document.notices,index,'공지 '+(index+1));const remove=button(item,'공지 삭제: '+(index+1),()=>change(()=>state.document.notices.splice(index,1)));remove.disabled=!editable();
        toggle(item,'이 공지 표시',row.enabled,next=>row.enabled=next);bind(item,'공지 제목','text',row.title,80,next=>row.title=next);bind(item,'공지 본문 (일반 텍스트)','textarea',row.body,2000,next=>row.body=next);bind(item,'공지 연결 경로','text',row.href,120,next=>row.href=next);schedule(item,row);
      });const add=button(notices,'공지 추가',()=>change(()=>{if(state.document.notices.length<10)state.document.notices.push({id:crypto.randomUUID(),title:'새 안내',body:'',href:'',startsAt:null,endsAt:null,enabled:true});}));add.disabled=!editable()||state.document.notices.length>=10;
      const menus=el(parent,'section',null,'display-panel');el(menus,'h4','공개 메뉴 순서·표시명');state.document.menus.forEach((row,index)=>{const item=el(menus,'div',null,'display-work');el(item,'h5',menuNames[row.key]);ordering(item,state.document.menus,index,menuNames[row.key]);const visible=toggle(item,'이 메뉴 표시',row.visible,next=>row.visible=next);if(row.key==='home')protectedControls.add(visible);bind(item,'메뉴 표시명: '+menuNames[row.key],'text',row.label,20,next=>row.label=next);});
      const footer=el(parent,'section',null,'display-panel');el(footer,'h4','필수 회사·정책·고객지원');el(footer,'p','회사 정보·연락처·고객지원과 필수 정책 링크는 이 편집기에서 삭제하거나 다른 주소로 바꾸지 않습니다.','display-hint');const links=el(footer,'div',null,'display-required-links');for(const [path,label]of [['/company/','회사 정보·고객지원'],['/policies/terms/','이용약관'],['/policies/privacy/','개인정보처리방침'],['/policies/refund/','환불정책'],['/policies/settlement/','정산 안내']]){const link=el(links,'a',label);link.href=path;}
      bind(footer,'푸터 추가 안내 (최대 300자)','textarea',state.document.footerNote,300,next=>state.document.footerNote=next);
    }
    async function previewDraft(value){if(!current()||busy||state.pending||state.dirty||state.conflict)return;let at;try{at=utc(value);if(!at)throw Error('미리보기 시각을 입력해주세요.');}catch(error){feedback.textContent=error.message;return;}
      const revision=state.revision;feedback.textContent='저장한 초안의 실제 공개 적격성을 확인하는 중입니다…';try{const result=await api('preview',{revision,at,offset:0});if(!current()||state.dirty||state.revision!==revision)return;
        if(result.revision!==revision||Date.parse(result.at)!==Date.parse(at)||result.public?.ready!==true||!Array.isArray(result.public.items)||result.public.items.length>24||result.public.items.some(card=>!workId(card?.id))||!Array.isArray(result.excluded))throw Error('INVALID_PREVIEW');state.preview=result;for(const card of result.public.items)if(workId(card.id))state.cards.set(card.id,card);state.message='저장한 초안의 미리보기를 확인했습니다. 현재 공개 적격성 기준이며 미래 작품 공개를 보장하지 않습니다.';draw();
      }catch(error){if(current())feedback.textContent=errorText(error);}}
    function previewPanel(parent,result){const panel=el(parent,'section',null,'display-preview');panel.setAttribute('tabindex','-1');el(panel,'h4','관리자 전용 미리보기');el(panel,'p','확인 시각: '+date(result.at));
      const menu=el(panel,'nav',null,'display-required-links');menu.setAttribute('aria-label','미리보기 공개 메뉴');for(const row of result.public.menus||[])if(row.visible)el(menu,'span',row.label);
      const home=result.public.home;for(const block of result.public.blocks||[]){if(!block.enabled)continue;const item=el(panel,'section',null,'display-work');el(item,'h5',block.title||blockNames[block.key]);
        if(block.key==='hero')el(item,'p',home?.hero?.title||'이 시각의 대표 추천 없음');
        else if(block.key==='recommendations')el(item,'p',(home?.featured||[]).map(card=>card.title).join(', ')||'이 시각의 홈 추천 없음');
        else if(block.key==='latest')el(item,'p','공개 화면의 실제 최신 발행 목록을 표시하는 영역입니다. 편집 추천으로 채우지 않습니다.');
        else if(block.key==='ranking')el(item,'p','공개 화면의 실제 열람 랭킹을 표시하는 영역입니다. 추천 선정과 별개입니다.');
        else if(block.key==='notice')for(const notice of result.public.notices||[]){el(item,'strong',notice.title);el(item,'p',notice.body,'display-notice');}
      }
      el(panel,'h5','추천 페이지 · 저장 순서');
      if(!result.public.items.length)status(panel,'이 시각에 공개 가능한 선정 작품이 없습니다. 다른 인기작으로 자동 대체하지 않습니다.');
      const list=el(panel,'ol',null,'display-selected');for(const card of result.public.items){const item=el(list,'li',null,'display-work');workSummary(item,card,card.id);if(card.caption)el(item,'p',card.caption);}
      if(result.excluded.length){el(panel,'h5','현재 공개 제외');for(const item of result.excluded)el(panel,'p','작품 #'+item.workId+' · '+item.reason);}
      el(panel,'p','추천 페이지 첫 24개를 확인합니다. 전체 선정 목록과 홈의 대표·추천 노출은 같은 전시 문서를 사용합니다.','display-hint');
      if(result.public.footerNote)el(panel,'p',result.public.footerNote,'display-notice');
      el(panel,'p','필수 회사·고객지원·약관·개인정보·환불·정산 링크는 계속 유지됩니다.','display-hint');
      panel.focus?.({preventScroll:true});
    }
    function releases(parent,reason){const panel=el(parent,'details',null,'display-details');panel.open=state.releasesOpen;panel.ontoggle=()=>{if(current())state.releasesOpen=panel.open;};el(panel,'summary','발행·예약 이력과 초안 복구');
      if(!state.server.releases.length)status(panel,'발행 이력이 없습니다.');for(const row of state.server.releases){const item=el(panel,'article',null,'display-panel');el(item,'h4',row.id);el(item,'p',date(row.startsAt)+' ~ '+date(row.endsAt));el(item,'p',row.cancelled?'예약 취소':row.stopped?'게시 중단':'발행·예약');if(row.reason)el(item,'p','사유: '+row.reason);
        const actions=el(item,'div',null,'display-actions'),restore=button(actions,'이 버전으로 초안 복구',()=>{state.reason=reason.value;return mutate('restore',()=>({releaseId:row.id,revision:state.revision}));});restore.disabled=!editable();
        if(!row.stopped&&!row.cancelled){const stop=button(actions,Date.parse(row.startsAt)>Date.now()?'이 예약 취소':'이 발행본 게시 중단',()=>{state.reason=reason.value;return mutate('stop',()=>({releaseId:row.id}));});stop.disabled=!editable();}
      }
    }
  }
  window.AdminDisplay=Object.freeze({active,render,leave,reset});
})();
