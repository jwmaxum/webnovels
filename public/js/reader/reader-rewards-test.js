/* Internal reward TEST only. Browser events never prove advertising completion. */
(function(){
 'use strict';
 const actor=()=>window.WebNovelsAuth?.getActor(),active=()=>window.WEBNOVELS_CONFIG?.adRewardsTestEnabled===true;
 const allowed=()=>!!actor()?.userId&&actor()?.reader?.status==='ACTIVE';
 const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
 const id=v=>typeof v==='string'&&/^[1-9]\d{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
 const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
 const time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
 const marked=v=>v?.mode==='TEST'&&v.provenance==='LOCAL_SIMULATED'&&['NONE','INTERNAL_TEST'].includes(v.provider);
 const policy=v=>uuid(v?.id)&&typeof v.adEnabled==='boolean'&&typeof v.campaignEnabled==='boolean'&&integer(v.rewardHours,1,168)&&integer(v.sessionMinutes,1,30)&&integer(v.graceMinutes,0,60)&&integer(v.dailyLimit,1,100)&&typeof v.campaignTitle==='string'&&(v.campaignStartsAt===null||time(v.campaignStartsAt))&&(v.campaignEndsAt===null||time(v.campaignEndsAt));
 const fallback=v=>v?.kind==='POINTS'&&v.chargePath==='/charging-test'&&v.amountKrw===10000&&v.points===10000&&v.defaultEpisodePoints===100;
 const validOptions=v=>marked(v)&&['UNAVAILABLE','INTERNAL_TEST','ALREADY_ACCESSIBLE'].includes(v.availability)&&typeof v.adAvailable==='boolean'&&typeof v.campaignAvailable==='boolean'&&policy(v.policy)&&fallback(v.fallback)&&(!v.adAvailable||v.provider==='INTERNAL_TEST'&&v.availability==='INTERNAL_TEST');
 const labels={WAITING_EVIDENCE:'서버 증빙 확인 대기',CLOSED_PENDING:'참여 중단 · 이전 완료 증빙 확인 대기',GRANTED:'서버 확인 · 열람권 발급',NO_FILL:'광고 제공 없음',REJECTED:'보상 조건 미충족',EXPIRED:'세션 기한 만료'};
 const grant=(v,kind)=>uuid(v?.id)&&v.kind===kind&&time(v.expiresAt);
 const session=(v,episodeId)=>uuid(v?.id)&&v.episodeId===episodeId&&['AD_REWARD','CAMPAIGN_FREE'].includes(v.kind)&&Object.hasOwn(labels,v.status)&&time(v.createdAt)&&time(v.expiresAt)&&Date.parse(v.expiresAt)>Date.parse(v.createdAt)&&time(v.acceptUntil)&&Date.parse(v.acceptUntil)>=Date.parse(v.expiresAt)&&(v.closedAt===null||time(v.closedAt))&&integer(v.rewardHours,1,168)&&uuid(v.policyVersion)&&(v.grant===null||grant(v.grant,v.kind))&&(v.status!=='GRANTED'||v.grant!==null);
 const clone=v=>JSON.parse(JSON.stringify(v)),date=v=>new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' KST';
 const errorText=e=>({AUTH_REQUIRED:'로그인 후 이용해주세요.',READER_REQUIRED:'활성 독자 계정이 필요합니다.',AD_REWARDS_TEST_NOT_ACTIVATED:'광고 TEST 연결 준비 중입니다. 포인트 구매를 이용해주세요.',PROVIDER_NOT_READY:'광고 제공자가 준비되지 않았습니다. 포인트 구매를 이용해주세요.',RATE_LIMITED:'참여 한도에 도달했습니다. 잠시 후 다시 확인하거나 포인트 구매를 이용해주세요.',IDEMPOTENCY_CONFLICT:'같은 요청 ID의 내용이 다릅니다. 기존 처리 결과를 확인해주세요.',SESSION_NOT_FOUND:'본인 보상 세션을 다시 확인해주세요.',REWARD_POLICY_CHANGED:'보상 조건이 변경됐습니다. 최신 조건을 다시 불러오고 확인한 뒤 새로 동의해주세요. 자동으로 재시작하지 않습니다.',REWARD_SESSION_PENDING:'이 회차는 이전 조건의 세션 확인을 기다리고 있습니다. 기존 세션 결과를 확인하거나 포인트 구매를 이용해주세요.',REWARD_EXPIRED:'임시 열람권이 만료되었습니다. 현재 회차 가격을 다시 확인해주세요.',CONTENT_NOT_AVAILABLE:'현재 열람 가능한 회차인지 다시 확인해주세요.'})[e?.code]||'서버 확인을 완료하지 못했습니다. 권리가 발급됐다고 간주하지 않습니다.';
 let owner=null,episode=null,generation=0,dispose=()=>{},state=null;
 const episodeStates=new Map();
 const fresh=()=>({options:null,session:null,pending:null,agree:false,message:'',notified:null});
 function leave(){generation++;dispose();dispose=()=>{};}
 function reset(){leave();owner=null;episode=null;state=null;episodeStates.clear();}
 const el=(p,tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=String(text);if(cls)n.className=cls;p.append(n);return n;};
 const button=(p,label,action)=>{const n=el(p,'button',label,'btn btn-outline');n.type='button';n.onclick=action;return n;};
 function status(p,text){const n=el(p,'p',text,'rewards-test-status');n.setAttribute('role','status');n.setAttribute('aria-live','polite');return n;}
 async function api(action,data,post=false){const query=new URLSearchParams({action,...(post?{}:data)});return window.WebNovelsAuth.api('/api/v2/ad-rewards-test?'+query,post?{method:'POST',body:JSON.stringify(data)}:undefined);}
 async function render(root,{episodeId,onGranted=()=>{},isCurrent=()=>true}={}){
  if(owner!==actor()?.userId){reset();owner=actor()?.userId||null;}else leave();
  episode=episodeId;state=episodeStates.get(episodeId);if(!state){state=fresh();episodeStates.set(episodeId,state);}
  const turn=generation,user=owner,current=()=>turn===generation&&actor()?.userId===user&&active()&&allowed()&&episode===episodeId&&isCurrent()&&root.isConnected!==false;
  dispose=()=>root.replaceChildren();root.replaceChildren();
  if(!active()){status(root,'광고 TEST는 준비 상태입니다. 광고가 없으면 포인트 구매로 열람할 수 있습니다.');pointsLink(root);return;}
  if(!allowed()||!id(episodeId)){reset();status(root,'활성 독자로 로그인하고 회차를 다시 선택해주세요.');return;}
  let busy=false;state.options=null;draw();await refresh();
  function editable(){return current()&&!busy&&!state.pending&&!!state.options;}
  async function refresh(){if(!current()||busy)return;busy=true;draw();try{const value=await api('options',{episodeId});if(!current())return;if(!validOptions(value))throw Error('INVALID_REWARD_RESPONSE');state.options=value;state.agree=false;state.message=state.pending?'이전 요청 결과를 확인하지 못했습니다. 같은 요청으로 확인해주세요.':'광고 제공 여부와 보상 조건을 서버에서 확인했습니다.';if(state.session){const result=await api('status',{sessionId:state.session.id});if(!current())return;acceptSession(result);} }catch(e){if(current())state.message=errorText(e);}finally{busy=false;if(current())draw();}if(current())notifyGrant();}
  function acceptSession(value){if(!marked(value)||!session(value.session,episodeId))throw Error('INVALID_REWARD_RESPONSE');state.session=clone(value.session);state.message=labels[state.session.status]+'. 브라우저의 완료 신호만으로 권리를 발급하지 않습니다.';}
  async function querySession(){if(!editable()||!state.session)return;busy=true;draw();try{const value=await api('status',{sessionId:state.session.id});if(!current())return;acceptSession(value);}catch(e){if(current())state.message=errorText(e);}finally{busy=false;if(current())draw();}if(current())notifyGrant();}
  async function mutate(action,data){if(!editable())return;state.pending={action,data:clone({...data,...(action==='start'?{policyVersion:state.options.policy.id}:{}),requestId:crypto.randomUUID()})};await dispatch();}
  async function dispatch(){
   if(!current()||busy||!state.pending)return;const pending=state.pending;busy=true;state.message='서버 처리 결과를 확인 중입니다…';draw();
   try{
    const value=await api(pending.action,pending.data,true);if(!current()||state.pending!==pending)return;
    if(value?.session)acceptSession(value);
    else if(marked(value)&&['UNAVAILABLE','ALREADY_ACCESSIBLE'].includes(value.availability)&&fallback(value.fallback)){
     if(state.options){state.options.availability=value.availability;state.options.adAvailable=false;if(value.availability==='ALREADY_ACCESSIBLE')state.options.campaignAvailable=false;}
     state.message=value.availability==='UNAVAILABLE'?'광고가 제공되지 않습니다. 포인트 충전을 기본으로 이용해주세요.':'이미 열람 가능한 회차입니다. 현재 회차 상태를 다시 확인해주세요.';
    }else throw Error('INVALID_REWARD_RESPONSE');
    state.pending=null;state.agree=false;
   }catch(e){if(current()&&state.pending===pending){if(!Number.isInteger(e.status)||e.status>=500)state.message='보상 처리 결과 미확인입니다. 원래 요청과 ID를 보존했습니다. 같은 요청으로 확인해주세요.';else{state.pending=null;if(e.code==='REWARD_POLICY_CHANGED'){state.options=null;state.agree=false;}state.message=errorText(e);}}}
   finally{busy=false;if(current())draw();}if(current())notifyGrant();
  }
  function notifyGrant(){const value=state.session?.grant;if(!current()||!state.session||state.session.status!=='GRANTED'||!value||Date.parse(value.expiresAt)<=Date.now()||state.notified===value.id)return;state.notified=value.id;onGranted({episodeId,grant:clone(value)});}
  function pendingSession(){return state.session&&['WAITING_EVIDENCE','CLOSED_PENDING','EXPIRED'].includes(state.session.status)&&Date.parse(state.session.acceptUntil)>Date.now();}
  function draw(){if(!current())return;root.replaceChildren();const section=el(root,'section',null,'rewards-test reader-rewards-test');el(section,'h4','광고 제공 여부·열람 대안');el(section,'p','TEST · 실제 광고사 연결과 분리된 서버 검증 시험입니다. 광고 클릭·스크롤·타이머로 권리를 만들지 않습니다.','rewards-test-banner');pointsLink(section);status(section,state.message||'서버에서 제공 여부를 확인합니다.');const reload=button(section,'광고 조건·현재 상태 새로고침',refresh);reload.disabled=busy;
   if(state.pending){const panel=el(section,'div',null,'rewards-test-panel');el(panel,'strong','처리 결과 미확인');el(panel,'p','새 참여 요청을 만들지 않고 기존 요청 ID와 내용을 유지합니다.');const retry=button(panel,'같은 보상 요청으로 결과 확인',dispatch);retry.disabled=busy;}
   if(!state.options){status(section,busy?'보상 조건 확인 중…':'광고 연결을 확인하거나 포인트 구매를 이용해주세요.');return;}
   const options=state.options,p=options.policy;el(section,'p',`신규 참여 조건: 보상 확인 시 해당 회차 1개 · 완료 증빙 시각부터 ${p.rewardHours}시간 · 세션 ${p.sessionMinutes}분 · 지연 증빙 유예 ${p.graceMinutes}분 · 일일 참여 한도 ${p.dailyLimit}회`);
   if(options.availability==='ALREADY_ACCESSIBLE'){el(section,'p','현재 열람 가능한 회차입니다. 불필요한 광고 참여를 시작하지 않습니다.');const again=button(section,'현재 회차 상태 확인',()=>{if(editable())onGranted({episodeId});});again.disabled=!editable();}
   else if(!options.adAvailable)el(section,'p','현재 제공 가능한 광고가 없습니다. 포인트를 충전한 뒤 회차 가격을 확인하여 읽어주세요.');
   else{el(section,'p','INTERNAL_TEST · 실제 광고 영상이 없습니다. 별도 테스트 서버의 서명된 완료 증빙을 기다립니다. 브라우저에서 증빙을 생성하지 않습니다.');consent(section,p);const start=button(section,'서버 검증 TEST 세션 시작',()=>{if(state.agree)return mutate('start',{episodeId,kind:'AD_REWARD',consent:true});});start.disabled=!editable()||!state.agree||!!pendingSession();}
   if(options.campaignAvailable&&options.availability!=='ALREADY_ACCESSIBLE'){const panel=el(section,'section',null,'rewards-test-panel');el(panel,'h5','운영자 무료 캠페인 · 광고와 별도');el(panel,'p',p.campaignTitle);if(p.campaignStartsAt&&p.campaignEndsAt)el(panel,'p',date(p.campaignStartsAt)+' ~ '+date(p.campaignEndsAt));el(panel,'p','명시적으로 신청한 회차의 임시권입니다. 유상 포인트나 광고 매출로 기록하지 않습니다.');const claim=button(panel,'무료 캠페인 조건 확인 후 신청',()=>mutate('start',{episodeId,kind:'CAMPAIGN_FREE',consent:true}));claim.disabled=!editable();}
   if(state.session)sessionPanel(section,state.session);
  }
  function consent(parent,p){const wrap=el(parent,'label',null,'rewards-test-check'),input=el(wrap,'input');input.type='checkbox';input.checked=state.agree;el(wrap,'span',`실제 광고가 아닌 내부 TEST이며 완료 증빙 시각부터 ${p.rewardHours}시간 유효한 회차 열람권 조건에 동의합니다.`);input.disabled=!editable()||!!pendingSession();input.onchange=()=>{state.agree=input.checked;const submit=Array.from(parent.querySelectorAll('button')).find(n=>n.textContent.trim()==='서버 검증 TEST 세션 시작');if(submit)submit.disabled=!editable()||!state.agree||!!pendingSession();};}
  function sessionPanel(parent,s){const panel=el(parent,'section',null,'rewards-test-panel');el(panel,'h5','현재 보상 세션');el(panel,'p',labels[s.status]);el(panel,'p',`회차 ${s.episodeId} · ${s.kind==='AD_REWARD'?'내부 광고 검증 TEST':'운영자 무료 캠페인'} · 세션 ${s.id}`);el(panel,'p',`이 세션의 고정 조건: 완료 증빙 시각부터 ${s.rewardHours}시간 · 정책 ${s.policyVersion}`);el(panel,'p',`참여 기한 ${date(s.expiresAt)} · 증빙 수신 기한 ${date(s.acceptUntil)}`);if(s.grant)el(panel,'p',(Date.parse(s.grant.expiresAt)>Date.now()?'임시 열람권 유효: ':'임시 열람권 기간 종료: ')+date(s.grant.expiresAt));const check=button(panel,'서버 보상 결과 확인',querySession);check.disabled=!editable();if(s.status==='WAITING_EVIDENCE'){const close=button(panel,'이 TEST 참여 중단',()=>mutate('close',{sessionId:s.id}));close.disabled=!editable();}if(['NO_FILL','REJECTED','EXPIRED','CLOSED_PENDING'].includes(s.status))el(panel,'p','포인트 충전으로 이어갈 수 있습니다. 닫기 전에 완료한 증빙은 수신 기한 안에 늦게 도착할 수 있습니다.');}
 }
 function pointsLink(parent){const panel=el(parent,'div',null,'rewards-test-fallback');el(panel,'p','기본 대안: 포인트 구매 · 기본 충전 10,000원 → 10,000P · 회차 기본 100P. 실제 판매 상품과 현재 회차 가격을 서버에서 확인합니다.');const link=el(panel,'a','포인트 충전 상품 확인','btn btn-primary');link.href='/charging-test';link.onclick=event=>window.handleReaderRouteClick?.(event);}
 window.ReaderRewardsTest=Object.freeze({active,render,leave,reset});
})();
