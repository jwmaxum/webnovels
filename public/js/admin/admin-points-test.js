/* Isolated point-policy tools. No provider, live balance or publication writes. */
(function(){
 'use strict';
 const actor=()=>window.WebNovelsAuth?.getActor(),active=()=>window.WEBNOVELS_CONFIG?.pointsTestEnabled===true;
 const allowed=()=>!!actor()?.userId&&actor()?.admin?.is_active===true&&actor().admin.role==='SUPER_ADMIN';
 const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
 const integer=value=>Number.isSafeInteger(value)&&value>=0,points=value=>integer(value)&&value<=1000000;
 const id=value=>typeof value==='string'&&/^[1-9]\d{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n;
 const revision=value=>typeof value==='string'&&/^(0|[1-9]\d{0,18})$/.test(value)&&BigInt(value)<=9223372036854775807n;
 const marker=value=>value?.mode==='TEST'&&value.provenance==='LOCAL_SIMULATED';
 const work=value=>id(value?.id)&&typeof value.title==='string'&&typeof value.author==='string'&&['NOVEL','WEBTOON'].includes(value.contentType);
 const validState=value=>marker(value)&&revision(value.revision)&&value.defaults?.freeEpisodes===2&&points(value.defaults.pricePoints)&&Array.isArray(value.works)&&value.works.length<=1000&&value.works.every(row=>work(row)&&typeof row.enabled==='boolean')&&Array.isArray(value.policies)&&value.policies.length<=100;
 const page=value=>marker(value)&&Array.isArray(value.items)&&value.items.length<=50&&value.items.every(work)&&integer(value.offset)&&value.limit===50&&integer(value.total)&&typeof value.hasMore==='boolean'&&value.hasMore===(value.nextOffset!==null)&&(!value.hasMore||value.nextOffset===value.offset+50);
 const clone=value=>JSON.parse(JSON.stringify(value));
 const kst=value=>new Date(Date.parse(value)+9*3600000).toISOString().slice(0,16);
 function utc(value){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('한국 시간의 시행 일시를 입력해주세요.');const date=new Date(value+'+09:00');if(!Number.isFinite(date.getTime())||kst(date.toISOString())!==value)throw Error('시행 일시를 확인해주세요.');return date.toISOString();}
 const date=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' KST':'확인 필요';
 const errorText=error=>({REVISION_CONFLICT:'다른 관리자가 정책을 변경했습니다. 입력은 유지됩니다. 최신 상태를 불러온 뒤 다시 확인해주세요.',INSUFFICIENT_POINTS:'시험 포인트가 부족합니다.',ADMIN_FORBIDDEN:'최고 관리자만 시험 정책을 관리할 수 있습니다.',IDEMPOTENCY_CONFLICT:'같은 요청 ID의 내용이 다릅니다. 기존 처리 결과를 확인해주세요.',RATE_LIMITED:'요청이 많습니다. 잠시 후 다시 시도해주세요.',POINTS_TEST_NOT_READY:'별도 TEST 환경의 연결을 준비 중입니다.',POINTS_TEST_DISABLED:'별도 TEST 환경을 준비 중입니다.'})[error?.code]||'입력과 TEST 연결 상태를 확인해주세요.';
 let owner=null,generation=0,dispose=()=>{},state=null;
 const fresh=()=>({server:null,search:null,query:{q:'',type:'ALL',offset:0},enrollReason:'',policyEdited:false,policy:{scope:'DEFAULT',targetId:'',points:'100',startsAt:kst(new Date().toISOString()),reason:''},credit:{targetUserId:'',points:'10000',reason:''},pending:null,message:'',conflict:false});
 function leave(){generation++;dispose();dispose=()=>{};}
 function reset(){leave();owner=null;state=null;}
 const el=(parent,tag,text,cls)=>{const node=document.createElement(tag);if(text!=null)node.textContent=String(text);if(cls)node.className=cls;parent.append(node);return node;};
 const button=(parent,label,action)=>{const node=el(parent,'button',label,'btn btn-outline');node.type='button';node.onclick=action;return node;};
 function field(parent,label,type,value,change,max){const wrap=el(parent,'label',null,'points-test-field');el(wrap,'span',label);const node=el(wrap,'input');node.type=type;node.value=value;if(max)node.maxLength=max;node.oninput=()=>change(node.value);return node;}
 function select(parent,label,values,value,change){const wrap=el(parent,'label',null,'points-test-field');el(wrap,'span',label);const node=el(wrap,'select');for(const [key,text]of values){const option=el(node,'option',text);option.value=key;}node.value=value;node.onchange=()=>change(node.value);return node;}
 function status(parent,text){const node=el(parent,'p',text,'points-test-status');node.setAttribute('role','status');node.setAttribute('aria-live','polite');return node;}
 async function api(action,data){return window.WebNovelsAuth.api('/api/v2/admin/points-test?action='+action,{method:'POST',body:JSON.stringify(data)});}
 async function render(root,{isCurrent=()=>true}={}){
  if(owner!==actor()?.userId){reset();owner=actor()?.userId||null;}else leave();if(!state)state=fresh();
  const turn=generation,user=owner,current=()=>turn===generation&&actor()?.userId===user&&allowed()&&active()&&isCurrent()&&root.isConnected!==false;
  dispose=()=>root.replaceChildren();root.replaceChildren();
  if(!allowed()){reset();status(root,'최고 관리자만 TEST 정책을 관리할 수 있습니다.');return;}
  if(!active()){status(root,'포인트 TEST 환경 준비 중입니다. 운영 무료 서비스와 실제 잔액은 변경되지 않습니다.');return;}
  let busy=false,searchTurn=0;
  state.server=null;draw();await refresh();
  async function refresh(){if(!current()||busy)return;busy=true;draw();try{const result=await api('state',{});if(!current())return;if(!validState(result))throw Error('INVALID_TEST_RESPONSE');state.server=result;if(!state.policyEdited&&state.policy.scope==='DEFAULT')state.policy.points=String(result.defaults.pricePoints);state.conflict=false;state.message=state.pending?'미확인 요청이 있습니다. 같은 요청으로 결과를 확인해주세요.':'최신 TEST 정책을 불러왔습니다.';}catch(error){if(current())state.message=errorText(error);}finally{busy=false;if(current())draw();}}
  function editable(){return current()&&!busy&&!state.pending&&!state.conflict&&!!state.server;}
  function reason(value){if(typeof value!=='string'||value.trim().length<3||value.length>500||/[\x00-\x1f\x7f]/.test(value))throw Error('변경 사유를 3~500자로 입력해주세요.');return value.trim();}
  async function mutate(action,build){if(!editable())return;try{const data=build();state.pending={action,data:clone({...data,requestId:crypto.randomUUID()})};}catch(error){state.message=error.message;draw();return;}await dispatch();}
  async function dispatch(){if(!current()||busy||!state.pending)return;const pending=state.pending;busy=true;state.message='TEST 요청 처리 결과를 확인 중입니다…';draw();try{
    const result=await api(pending.action,pending.data);if(!current()||state.pending!==pending)return;
    if(pending.action==='credit'){
     if(!marker(result)||result.targetUserId!==pending.data.targetUserId||!integer(result.balancePoints)||result.creditedPoints!==pending.data.points||typeof result.replayed!=='boolean')throw Error('INVALID_TEST_RESPONSE');
     state.message=`시험 ${result.creditedPoints.toLocaleString()}P 지급 확인 · 잔액 ${result.balancePoints.toLocaleString()}P · 실제 입금·정산 없음`;state.credit.targetUserId='';state.credit.reason='';
    }else{if(!validState(result)||result.saved!==true||typeof result.replayed!=='boolean')throw Error('INVALID_TEST_RESPONSE');state.server=result;state.message='TEST 설정을 저장했습니다. 실제 서비스 정책은 변경하지 않았습니다.';state.conflict=false;}
    state.pending=null;
   }catch(error){if(current()&&state.pending===pending){if(!Number.isInteger(error.status)||error.status>=500){state.message='처리 결과가 미확인 상태입니다. 새 요청을 만들지 말고 같은 요청으로 결과를 확인해주세요.';}else{state.pending=null;state.conflict=error.code==='REVISION_CONFLICT';state.message=errorText(error);}}}
   finally{busy=false;if(current())draw();}
  }
  function controls(parent){for(const node of parent.querySelectorAll?.('input,select,textarea,button')||[])node.disabled=!editable();}
  function draw(){if(!current())return;root.replaceChildren();const section=el(root,'section',null,'points-test admin-points-test');el(section,'h3','포인트·열람권 TEST 정책');el(section,'p','TEST · LOCAL_SIMULATED · 시험용 포인트와 열람권입니다. 실제 결제·충전 수납·작가 정산은 발생하지 않습니다.','points-test-banner');
   const reload=button(section,'최신 TEST 상태 불러오기',refresh);reload.disabled=busy;status(section,state.message||'TEST 정책을 확인합니다.');
   if(state.pending){const panel=el(section,'section',null,'points-test-panel');el(panel,'h4','처리 결과 미확인');el(panel,'p','동작: '+state.pending.action+' · 기존 내용과 요청 ID를 유지합니다.');const retry=button(panel,'같은 요청으로 결과 확인',dispatch);retry.disabled=busy;}
   if(!state.server){status(section,busy?'불러오는 중입니다…':'TEST 정책을 아직 조회하지 못했습니다.');return;}
   el(section,'p',`회원 무료 범위: 1~2화 고정 · 현재 기본 ${state.server.defaults.pricePoints.toLocaleString()}P · 정책 revision ${state.server.revision}`);
   const searchPanel=el(section,'section',null,'points-test-panel');el(searchPanel,'h4','TEST 작품 검색·등록');const form=el(searchPanel,'form',null,'points-test-form');form.setAttribute('aria-label','TEST 작품 검색');
   const q=field(form,'작품명·필명·작품 ID','search',state.query.q,value=>state.query.q=value,100),type=select(form,'작품 유형',[['ALL','전체'],['NOVEL','웹소설'],['WEBTOON','웹툰']],state.query.type,value=>state.query.type=value);
   const submit=button(form,'TEST 작품 검색',null);submit.type='submit';submit.disabled=busy||!!state.pending;form.onsubmit=event=>{event.preventDefault();if(!current()||busy||state.pending)return;state.query={q:q.value.trim(),type:type.value,offset:0};return search();};
   field(searchPanel,'작품 등록·노출 변경 사유 (3~500자)','text',state.enrollReason,value=>state.enrollReason=value,500);
   if(state.search){const list=el(searchPanel,'ul',null,'points-test-list');for(const item of state.search.items){const li=el(list,'li');el(li,'strong',item.title);el(li,'p',`${item.author} · ${item.contentType==='WEBTOON'?'웹툰':'웹소설'} · 작품 ID ${item.id}`);const enrolled=state.server.works.find(row=>row.id===item.id);const add=button(li,enrolled?.enabled?'TEST 등록됨':'TEST 작품 등록',()=>mutate('enroll',()=>({workId:item.id,enabled:true,revision:state.server.revision,reason:reason(state.enrollReason)})));add.disabled=!editable()||enrolled?.enabled===true;}pager(searchPanel,state.search,offset=>{state.query.offset=offset;return search();});}
   const enrolled=el(section,'section',null,'points-test-panel');el(enrolled,'h4','등록한 TEST 작품');if(!state.server.works.length)el(enrolled,'p','등록한 TEST 작품이 없습니다. 검색 후 직접 등록하세요.');for(const item of state.server.works){const row=el(enrolled,'div',null,'points-test-item');el(row,'strong',item.title);el(row,'p',`작품 ID ${item.id} · ${item.enabled?'TEST 노출 중':'TEST 노출 중단'}`);const toggle=button(row,item.enabled?'TEST 노출 중단':'TEST 다시 노출',()=>mutate('enroll',()=>({workId:item.id,enabled:!item.enabled,revision:state.server.revision,reason:reason(state.enrollReason)})));toggle.disabled=!editable();}
   policyPanel(section);creditPanel(section);
   const history=el(section,'details',null,'points-test-panel');el(history,'summary','TEST 가격 정책 이력');for(const row of state.server.policies){const entry=el(history,'p');entry.textContent=`${row.scope} · 대상 ${row.targetId??'플랫폼'} · ${row.points}P · ${date(row.startsAt)} · ${row.reason||''}`;}
   for(const node of [q,type])node.disabled=busy||!!state.pending;
  }
  async function search(){if(!current()||busy||state.pending)return;const seq=++searchTurn,query=clone(state.query);busy=true;draw();try{const result=await api('search',query);if(!current()||seq!==searchTurn)return;if(!page(result)||result.offset!==query.offset)throw Error('INVALID_TEST_RESPONSE');state.search=result;state.message=`TEST 후보 ${result.total}개 · 자동 등록하지 않습니다.`;}catch(error){if(current())state.message=errorText(error);}finally{busy=false;if(current())draw();}}
  function pager(parent,result,load){const nav=el(parent,'nav',null,'points-test-actions');nav.setAttribute('aria-label','TEST 작품 검색 페이지');if(result.offset){const previous=button(nav,'이전 검색 결과',()=>load(Math.max(0,result.offset-50)));previous.disabled=busy||!!state.pending;}if(result.hasMore){const next=button(nav,'다음 검색 결과',()=>load(result.nextOffset));next.disabled=busy||!!state.pending;}}
  function policyPanel(parent){const panel=el(parent,'section',null,'points-test-panel');el(panel,'h4','TEST 가격 버전 설정');el(panel,'p','1~2화 회원 무료는 고정입니다. 이후 회차: 회차 예외 → 작품 예외 → 플랫폼 기본 순서로 적용합니다.');const form=el(panel,'form',null,'points-test-form');form.setAttribute('aria-label','TEST 가격 설정');
   const values=state.policy;let target;const scope=select(form,'가격 적용 범위',[['DEFAULT','플랫폼 기본'],['WORK','작품'],['EPISODE','회차']],values.scope,value=>{state.policyEdited=true;values.scope=value;target.disabled=value==='DEFAULT'||!editable();});target=field(form,'가격 대상 ID','text',values.targetId,value=>{state.policyEdited=true;values.targetId=value;},19);
   const amount=field(form,'회차 가격 (P)','number',values.points,value=>{state.policyEdited=true;values.points=value;});amount.min='0';amount.max='1000000';amount.step='1';field(form,'시행 일시 (한국 시간 KST)','datetime-local',values.startsAt,value=>{state.policyEdited=true;values.startsAt=value;});field(form,'가격 변경 사유 (3~500자)','text',values.reason,value=>{state.policyEdited=true;values.reason=value;},500);
   const save=button(form,'TEST 가격 버전 저장',null);save.type='submit';form.onsubmit=event=>{event.preventDefault();return mutate('policy',()=>{if(!/^(0|[1-9]\d*)$/.test(values.points)||!points(Number(values.points))||values.scope!=='DEFAULT'&&!id(values.targetId))throw Error('대상 ID와 0~1,000,000 사이 정수 포인트를 확인해주세요.');return {scope:values.scope,targetId:values.scope==='DEFAULT'?null:values.targetId,points:Number(values.points),startsAt:utc(values.startsAt),revision:state.server.revision,reason:reason(values.reason)};});};controls(form);target.disabled=values.scope==='DEFAULT'||!editable();scope.disabled=!editable();
  }
  function creditPanel(parent){const panel=el(parent,'section',null,'points-test-panel');el(panel,'h4','시험용 포인트 지급');el(panel,'p','등록된 TEST 독자의 Auth UUID를 입력하세요. 작가 프로필 ID·작품 ID·이메일은 지급 대상 ID가 아닙니다.');const form=el(panel,'form',null,'points-test-form');form.setAttribute('aria-label','TEST 포인트 지급');const values=state.credit;
   field(form,'지급 대상 Auth UUID','text',values.targetUserId,value=>values.targetUserId=value,36);const amount=field(form,'시험 지급 포인트 (P)','number',values.points,value=>values.points=value);amount.min='1';amount.max='1000000';amount.step='1';field(form,'시험 지급 사유 (3~500자)','text',values.reason,value=>values.reason=value,500);const save=button(form,'시험 포인트 지급',null);save.type='submit';form.onsubmit=event=>{event.preventDefault();return mutate('credit',()=>{if(!uuid(values.targetUserId)||!/^\d+$/.test(values.points)||!points(Number(values.points))||Number(values.points)<1)throw Error('Auth UUID와 1~1,000,000 사이 정수 포인트를 확인해주세요.');return {targetUserId:values.targetUserId,points:Number(values.points),reason:reason(values.reason)};});};controls(form);
  }
 }
 window.AdminPointsTest=Object.freeze({active,render,leave,reset});
})();
