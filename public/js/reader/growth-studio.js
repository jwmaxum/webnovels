(function(){
 'use strict';
 let generation=0;const roots=new Set(),turns=new WeakMap();
 const actor=()=>window.WebNovelsAuth?.getActor();
 const active=()=>window.WEBNOVELS_CONFIG?.growthServiceEnabled===true;
 function el(parent,tag,text){const n=document.createElement(tag);if(text!=null)n.textContent=String(text);parent.append(n);return n;}
 function button(parent,text,fn){const b=el(parent,'button',text);b.type='button';b.className='btn btn-outline';b.onclick=fn;return b;}
 function begin(root){if(!active()||!root)return null;roots.add(root);const g=generation,u=actor()?.userId,n=(turns.get(root)||0)+1;turns.set(root,n);
  root.hidden=false;root.replaceChildren();return ()=>g===generation&&u===actor()?.userId&&turns.get(root)===n&&root.isConnected!==false;}
 function reset(){generation++;for(const r of roots){r.replaceChildren();if(r.id==='growthHome')r.hidden=true;}roots.clear();}
 const api=(role,action,data,query='')=>window.WebNovelsAuth.api('/api/v2/'+role+'/growth?action='+action+query,
  data?{method:'POST',body:JSON.stringify(data)}:undefined);
 const message=(root,text,alert=false)=>{const n=el(root,'p',text);n.setAttribute('role',alert?'alert':'status');return n;};
 function failed(root,valid,retry,error){if(!valid())return;
  const labels={INVALID_POLICY:'가설·대조 기준은 10자 이상, 표본은 5명 이상, 기간은 최대 90일로 입력해주세요. 웹툰의 소설 글자 수 기준은 0입니다.',POLICY_VERSION_CONFLICT:'같은 버전의 기준은 변경할 수 없습니다. 새 버전을 입력해주세요.',POLICY_WINDOW_CONFLICT:'같은 유형의 다른 실험과 기간이 겹칩니다. 기간이나 종료된 실험을 확인해주세요.',WORK_NOT_ELIGIBLE_AT_CUTOFF:'오늘 KST 0시 기준으로 공개 무료 회차가 있는 작품만 평가합니다.',INVALID_DECISION:'표본·관찰 일수·비용과 각 10자 이상의 근거를 입력해주세요.'};
  message(root,labels[error?.code]||'성장 정보를 불러오거나 저장하지 못했습니다. 다시 조회하여 상태를 확인해주세요.',true);button(root,'다시 조회',retry);}
 const reason={RECENT_PUBLIC_SERIAL:'최근 30일 공개 연재 · 새로운 작품 만나기',GENRE_ROTATION:'장르와 작가별 노출 수를 제한한 탐색 추천'};
 async function home(){
  const root=document.getElementById('growthHome'),valid=begin(root);if(!valid)return;
  el(root,'h2','새로운 연재 만나기');message(root,'추천 이유를 확인하고 보고 싶은 장르를 직접 선택하세요.');
  const logged=actor()?.reader?.status==='ACTIVE';
  try{
   let prefs=null;if(logged)prefs=await api('reader','preferences');if(!valid())return;
   const data=logged?await api('reader','feed',{}):await (async()=>{const r=await fetch('/api/v2/reader/growth?action=feed',{credentials:'omit',cache:'no-store'});if(!r.ok)throw Error('FEED');return r.json();})();
   if(!valid())return;
   const cards=el(root,'div');cards.className='works-grid';
   for(const raw of data.works||[]){const w=window.ReaderCatalog.mapWork(raw),a=el(cards,'a');a.href='/works/'+w.id;a.className='work-card';
    el(a,'h3',w.title);el(a,'p',w.author);el(a,'small',reason[raw.reason]||reason.RECENT_PUBLIC_SERIAL);}
   if(!data.works?.length)message(cards,'설정에 맞는 최근 공개 연재가 아직 없습니다.');
   if(!prefs){message(root,'로그인하면 장르 제외와 추천 설정을 저장할 수 있습니다.');return;}
   const form=el(root,'form');form.className='growth-controls';
   const excludedLabel=el(form,'label','추천에서 제외할 장르 (쉼표로 구분, 최대 8개)'),excluded=el(excludedLabel,'input');excluded.type='text';excluded.maxLength=328;excluded.value=prefs.excludedGenres.join(', ');
   const frequencyLabel=el(form,'label','알림 빈도'),frequency=el(frequencyLabel,'select');
   for(const [value,label] of [['OFF','받지 않음'],['WEEKLY','주 1회'],['DAILY','하루 1회']]){const o=el(frequency,'option',label);o.value=value;}frequency.value=prefs.frequency;
   message(form,'빈도 설정은 저장되며 성장 알림은 현재 발송되지 않습니다.');
   const consentLabel=el(form,'label'),consent=el(consentLabel,'input');consent.type='checkbox';consent.checked=prefs.analyticsConsent;
   el(consentLabel,'span','선택: 추천 카드 제공·인증 열람 기록의 성장 분석에 동의');
   message(form,'동의 후 기록으로 분석합니다. 동의를 끄면 새 집계에서 제외되고 카드 제공 기록이 삭제됩니다. 카드 제공 기록은 최대 90일 보존합니다.');
   const save=button(form,'설정 저장');save.type='submit';
   const clear=button(form,'추천 초기화',async()=>{if(!valid()||clear.disabled)return;clear.disabled=true;save.disabled=true;
    try{await api('reader','reset',{});if(valid())home();}catch{failed(root,valid,home);if(valid()){clear.disabled=false;save.disabled=false;}}});
   message(form,'추천 초기화는 장르 제외와 알림 빈도를 초기화합니다. 분석 동의·관심작·열람 위치는 유지됩니다.');
   form.onsubmit=async event=>{event.preventDefault();if(!valid()||save.disabled)return;
    const genres=excluded.value.split(',').map(x=>x.trim()).filter(Boolean);
    if(genres.length>8||genres.some(x=>x.length>40)){message(form,'장르는 항목당 40자, 최대 8개까지 입력해주세요.',true);return;}
    save.disabled=true;clear.disabled=true;
    try{await api('reader','save-preferences',{excludedGenres:genres,frequency:frequency.value,analyticsConsent:consent.checked});if(valid())home();}
    catch{failed(root,valid,home);if(valid()){save.disabled=false;clear.disabled=false;}}
   };
  }catch{failed(root,valid,home);}
 }
 const stat=(value,status='')=>value==null?({EMPTY:'기록 없음',PENDING:'관찰 기간 대기',INSUFFICIENT:'표본 부족'}[status]||'표본 부족'):String(value);
 function metrics(root,m){
  message(root,'동의한 인증 독자의 진행률 요청 대리지표입니다. 체류시간·실제 완독·구매 전환을 뜻하지 않습니다.');
  const d=el(root,'dl');const rows=[['공개 무료 회차',m.episodes],['소설 글자 수 (공백 포함)',m.novelCharactersWithSpaces],['웹툰 원본 이미지 수',m.webtoonAssets],
   ['최근 14일 고유 독자',stat(m.reading?.uniqueReaders,m.reading?.status)],['독자·회차 쌍',stat(m.reading?.readerEpisodePairs,m.reading?.status)],
   ['진행률 90% 이상 비율',m.reading?.completionProxy==null?'표본 부족':(m.reading.completionProxy*100).toFixed(1)+'%'],
   ['현재 관심 등록 (동의 후)',stat(m.favoritesCurrent)]];
  for(const key of ['d7','d28']){const r=m[key];rows.push([key.toUpperCase()+' 정확한 KST 대상일 재방문',r?.rate==null?stat(null,r?.status):(r.rate*100).toFixed(1)+'% ('+r.returned+'/'+r.denominator+')']);}
  for(const [name,value] of rows){el(d,'dt',name);el(d,'dd',value??'확인 대기');}
  if(m.serialSupply)message(root,'새 회차 공개: 최근 14일 '+m.serialSupply.newEpisodes+'화 · '+m.serialSupply.activeKstDays+'일. 이전 공개본 교체 '+m.serialSupply.replacedHeads+'건은 새 회차에서 제외합니다. 성장 집계 시작 전 기록은 기준선입니다.');
  message(root,'D0는 동의 후 최초 기록된 공개 무료 회차 열람입니다. 대상일이 끝난 표본만 집계하며 5명 미만은 숨깁니다.');
  const s=m.providedCards;message(root,'카드 제공 후 7일 내 열람: '+(s?.denominator==null?'표본 부족':s.subsequentReaders+'/'+s.denominator)+'. 실제 화면 노출이나 유입에 따른 첫 열람 전환율은 아닙니다.');
 }
 function creator(parent,works){
  if(!active())return;const root=el(parent,'section'),valid=begin(root);if(!valid)return;
  el(root,'h3','작품 성장 관찰');const report=el(root,'div');
  for(const w of works){const read=async()=>{if(!valid())return;const reportValid=begin(report);
   try{const m=await api('creator','report',null,'&workId='+encodeURIComponent(w.id));if(valid()&&reportValid())metrics(report,m);}
   catch(e){failed(report,()=>valid()&&reportValid(),read,e);}};button(root,w.title+' 성장 지표',read);}
  if(!works.length)message(root,'작품 등록 후 공개 연재의 성장 지표를 확인할 수 있습니다.');
 }
 function field(form,label,type='text',value=''){const l=el(form,'label',label),i=el(l,'input');i.type=type;i.value=String(value);return i;}
 function admin(parent){
  if(!active()||actor()?.admin?.role!=='SUPER_ADMIN')return;const root=el(parent,'section'),valid=begin(root);if(!valid)return;
  el(root,'h3','발견·성장 실험');message(root,'입력값은 시험 가설입니다. 후보 평가는 실제 승격·수익화·독점 승인·알림 발송을 실행하지 않습니다.');
  const report=el(root,'div');let data=null;
  async function load(){const v=begin(report);try{const r=await api('admin','admin');if(!valid()||!v())return;data=r;
   message(report,'최근 공개 무료 작품 최대 50개를 관찰합니다. 전체 장르 공급을 대표하는 표본은 아닙니다.');
   if(r.serialContinuity)message(report,'완료된 KST 7일 구간 간 연재 지속 작가: '+stat(r.serialContinuity.continuedAuthors,r.serialContinuity.status)+' / '+stat(r.serialContinuity.denominator,r.serialContinuity.status)+'. 새 회차 공개만 집계하며 성장 집계 시작 후 14일을 관찰합니다.');
   for(const w of r.works||[]){const details=el(report,'details');el(details,'summary',w.title+' · '+(Array.isArray(w.genre)?w.genre.join(', '):w.genre));metrics(details,w.metrics);}
   for(const e of r.experiments||[])message(report,e.version+' · '+(e.decision||'판정 대기')+' · '+e.config.hypothesis);
   for(const v of r.variantEvidence||[])message(report,v.version+' · '+v.variant+' 카드 제공/후속 열람 쌍 '+stat(v.providedReaderWorkPairs,v.status)+' / '+stat(v.subsequentReadingPairs,v.status)+'. 7일 관찰을 마친 카드 제공 기록이며 실제 노출·첫 열람 전환은 아닙니다.');
   for(const e of r.evaluations||[])message(report,'#'+e.workId+' · '+e.policyVersion+' · '+e.kstDay+' · '+e.decision+' (실제 승격 없음)');
  }catch{failed(report,()=>valid()&&v(),load);}}
  button(root,'지표·편향·후보 조회',load);
  const form=el(root,'form');form.className='growth-controls';el(form,'h4','버전 고정 가설 등록');
  const version=field(form,'새 정책 버전');version.maxLength=60;
  const hypothesis=field(form,'가설 (10자 이상)'),control=field(form,'대조 기준: 동일 필터·장르/작가 제한, 작품 번호 역순');
  const type=el(el(form,'label','콘텐츠 유형'),'select');for(const v of ['NOVEL','WEBTOON']){const o=el(type,'option',v==='NOVEL'?'웹소설':'웹툰');o.value=v;}
  const starts=field(form,'시작 (KST)','datetime-local'),ends=field(form,'종료 (KST, 최대 90일)','datetime-local');
  const definitions=[['minEpisodes','최소 공개 무료 회차',10],['minCharacters','소설 글자 수 (웹툰은 0)',45000],['minReaders','최근 14일 고유 독자',3000],['minFavorites','현재 관심',100],['minCompletionSample','완독 대리 표본',100],['minCompletionRate','90% 진행률 비율 (0~1)',0.65],['costBudgetKrw','비용 예산 (원)',0]];
  const numbers={};for(const [key,label,value] of definitions){numbers[key]=field(form,label,'number',value);numbers[key].step=key==='minCompletionRate'?'0.01':'1';}
  const submit=button(form,'가설 저장');submit.type='submit';
  form.onsubmit=async e=>{e.preventDefault();if(!valid()||submit.disabled)return;submit.disabled=true;
   try{const config={hypothesis:hypothesis.value,control:control.value,type:type.value,startsAt:new Date(starts.value+'+09:00').toISOString(),endsAt:new Date(ends.value+'+09:00').toISOString()};
    for(const key of Object.keys(numbers))config[key]=Number(numbers[key].value);
    await api('admin','configure',{version:version.value,config});if(valid()){message(form,'가설을 저장했습니다. 같은 버전의 기준은 변경할 수 없습니다.');load();}}
   catch(e){failed(form,valid,load,e);}finally{if(valid())submit.disabled=false;}
  };
  const evaluateForm=el(root,'form');const target=field(evaluateForm,'후보 평가 작품 번호'),policy=field(evaluateForm,'저장된 가설 버전');
  const evalButton=button(evaluateForm,'오늘 KST cutoff로 시험 평가');evalButton.type='submit';
  evaluateForm.onsubmit=async e=>{e.preventDefault();if(!valid()||evalButton.disabled)return;evalButton.disabled=true;
   try{await api('admin','evaluate',{workId:target.value,version:policy.value});if(valid())load();}catch(e){failed(evaluateForm,valid,load,e);}finally{if(valid())evalButton.disabled=false;}};
  const decisionForm=el(root,'form');el(decisionForm,'h4','실험 결정 기록');const decisionVersion=field(decisionForm,'정책 버전');
  const decision=el(el(decisionForm,'label','결정'),'select');for(const [v,l] of [['KEEP','유지'],['CHANGE','수정'],['STOP','종료']]){const o=el(decision,'option',l);o.value=v;}
  const why=field(decisionForm,'결정 사유 (10자 이상)'),sample=field(decisionForm,'관찰 표본','number',0),days=field(decisionForm,'관찰 일수','number',0),cost=field(decisionForm,'실제 비용 (원)','number',0);
  const retention=field(decisionForm,'재방문 근거·표본 부족 여부'),supply=field(decisionForm,'신인·장르 공급과 연재 지속 근거'),guardrail=field(decisionForm,'편향·부정 트래픽·문제점');
  const decideButton=button(decisionForm,'결정 근거 저장');decideButton.type='submit';
  decisionForm.onsubmit=async e=>{e.preventDefault();if(!valid()||decideButton.disabled)return;decideButton.disabled=true;
   try{await api('admin','decide',{version:decisionVersion.value,decision:decision.value,reason:why.value,evidence:{sampleSize:Number(sample.value),observedDays:Number(days.value),costKrw:Number(cost.value),retentionSummary:retention.value,supplySummary:supply.value,guardrailSummary:guardrail.value}});
    if(valid()){message(decisionForm,'결정을 기록했습니다. 새 실험은 새 버전으로 등록해주세요.');load();}}
   catch(e){failed(decisionForm,valid,load,e);}finally{if(valid())decideButton.disabled=false;}};
 }
 function leaveHome(){const r=document.getElementById('growthHome');if(r){turns.set(r,(turns.get(r)||0)+1);r.replaceChildren();r.hidden=true;}}
 window.GrowthStudio={home,creator,admin,reset,leaveHome};
})();
