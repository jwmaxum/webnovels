(function(){
  'use strict';
  const node=(parent,tag,text)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;parent.append(e);return e;};
  const previews=new Set();
  let generation=0;
  const actor=()=>window.WebNovelsAuth?.getActor();
  const allowed=()=>!!actor()?.admin&&actor().admin.is_active!==false&&(actor().admin.role==='SUPER_ADMIN'||actor().admin.permissions?.includes('CONTENT_REVIEW'));
  function reset(){generation++;for(const root of previews)window.ReaderWebtoon?.destroy(root);previews.clear();}
  const labels={work:'작품 정보·삭제',publication:'공개 회차 수정',operation:'연재·공개 상태',distribution:'연재 형태·외부 링크',file:'표지 변경'};
  const stateNames={PRIVATE:'비공개',PUBLIC:'공개',ONGOING:'연재 중',HIATUS:'휴재',COMPLETED:'완결',CLEAR:'제한 없음',RESTRICTED:'노출 제한',ALL:'전체이용가',AGE_15:'15세 이상',AGE_19:'19세 이상',NONE:'AI 미사용',ASSISTED:'AI 보조',GENERATED:'AI 생성',NOVEL:'웹소설',WEBTOON:'웹툰',NON_EXCLUSIVE:'비독점',EXCLUSIVE_INTEREST:'독점 제안 희망'};
  function value(value,translate=false){if(value===undefined)return '기준 정보 없음';if(value===null||value==='')return '없음';if(Array.isArray(value))return value.map(item=>typeof item==='string'?item:JSON.stringify(item)).join(' · ')||'없음';return translate&&Object.hasOwn(stateNames,value)?stateNames[value]:String(value);}
  function comparison(root,change,item){
    const before=change.baseline||{},after=change.candidate?.after||{},data=change.arguments?.data||{};
    const section=node(root,'section');section.className='admin-change-comparison';node(section,'h4','검토 기준과 변경 요청 비교');
    node(section,'p','접수 당시 공개 정보와 반영 후보를 비교합니다. 승인 시 기준이 변경되었는지 다시 검사합니다.');
    const fields=[];
    for(const [key,label]of [['title','작품명'],['description','작품 소개'],['genre','장르'],['tags','태그'],['content_type','작품 종류'],['rating','이용등급'],['ai_usage_type','AI 사용']])
      if(Object.hasOwn(before.work||{},key)||Object.hasOwn(after.work||{},key))fields.push([label,before.work?.[key],after.work?.[key],['content_type','rating','ai_usage_type'].includes(key)]);
    for(const [key,label]of [['visibility','공개 여부'],['serial_state','연재 상태'],['moderation_state','운영 제한'],['trashed_at','휴지통 이동']])
      if(Object.hasOwn(before.state||{},key)||Object.hasOwn(after.state||{},key))fields.push([label,before.state?.[key],after.state?.[key],key!=='trashed_at']);
    if(item.kind==='publication')for(const [key,label]of [['title','회차 제목'],['authorComment','작가의 말']])
      if(Object.hasOwn(before.draft||{},key)||Object.hasOwn(change.candidate?.draft||{},key))fields.push([label,before.draft?.[key],change.candidate?.draft?.[key]]);
    const episodeId=data.episodeId||change.arguments?.episode;
    if(episodeId){const a=(before.episodes||[]).find(ep=>String(ep.id)===String(episodeId)),b=(after.episodes||[]).find(ep=>String(ep.id)===String(episodeId));
      for(const [key,label]of [['episode_number','대상 회차'],['title','회차 제목'],['status','회차 공개 상태']])if(a&&Object.hasOwn(a,key)||b&&Object.hasOwn(b,key))fields.push([label,a?.[key],b?.[key],key==='status']);}
    const scroll=node(section,'div');scroll.className='cms-table-wrap';scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','변경 요청 비교표');
    const table=node(scroll,'table');table.className='cms-table';const header=node(node(table,'thead'),'tr');
    for(const label of ['항목','검토 기준','변경 요청'])node(header,'th',label).scope='col';const body=node(table,'tbody');
    for(const [label,a,b,translate]of fields){const row=node(body,'tr');row.className=a!==undefined&&b!==undefined&&JSON.stringify(a)!==JSON.stringify(b)?'admin-change-modified':'';node(row,'th',label).scope='row';node(row,'td',value(a,translate));node(row,'td',value(b,translate));}
    if(!fields.length)node(section,'p','비교 가능한 작품 메타데이터가 없습니다. 아래 요청 내용과 본문·표지를 확인해주세요.');
    const action=change.arguments?.action||item.action;
    if(action)node(section,'p','요청 작업: '+({update:'작품 정보 수정',trash:'작품 삭제·휴지통 이동',restore:'작품 복구',withdraw:'회차 공개 중단','restore-episode':'회차 공개 복구','serial-state':'연재 상태 변경',publish:'공개 회차 수정',commit:'표지 변경'}[action]||action));
    if(item.kind==='distribution'){
      const details=node(section,'div');details.className='admin-change-values';node(details,'h4','연재 형태 변경 요청');
      if(Object.hasOwn(data,'mode'))node(details,'p','요청 연재 형태: '+value(data.mode,true));
      if(Array.isArray(data.externalLinks))node(details,'p','요청 외부 링크: '+value(data.externalLinks));
      node(details,'p','이 요청의 검토 기준에는 이전 연재 형태·링크가 포함되지 않습니다.');
    }
    if(item.kind==='publication'&&data.episodeNumber)node(section,'p','수정 요청 회차: '+data.episodeNumber+'화');
  }
  async function render(root,valid) {
    if(window.WEBNOVELS_CONFIG?.publicationChangeReviewEnabled!==true)return;
    reset();const turn=generation,user=actor()?.userId,current=()=>turn===generation&&actor()?.userId===user&&allowed()&&valid();
    if(!allowed()){node(root,'p','공개 후 변경 검토 권한이 필요합니다.');return;}
    const section=node(root,'section');section.className='co-panel admin-publication-review';node(section,'h3','발행 후 수정·삭제 검토');
    node(section,'p','새 회차는 작가가 직접 발행합니다. 이 목록에서는 이미 발행된 작품의 변경 요청만 검토합니다. 승인 전까지 기존 공개본을 유지합니다.');
    const status=node(section,'p','요청을 불러오는 중입니다.');status.setAttribute('role','status');
    section.setAttribute('aria-busy','true');
    const api=async(action,data={},write=false)=>window.WebNovelsAuth.api('/api/v2/admin/workflow?'+new URLSearchParams({action,...(!write?data:{})}),write?{method:'POST',body:JSON.stringify(data)}:undefined);
    try {
      const result=await api('publication-changes');if(!current())return;
      const summary=()=>{status.textContent=result.changes.length?`불러온 ${result.changes.length}건 · 검토 대기 ${result.changes.filter(item=>!item.decision).length}건 · 최근 최대 100건`:'검토할 요청이 없습니다.';};summary();
      for(const item of result.changes) {
        const card=node(section,'article');card.className='workflow-card';node(card,'h4',item.title+' · '+(labels[item.kind]||'변경 검토'));const decisionStatus=node(card,'p',item.decision==='APPROVE'?'승인 완료':item.decision==='REJECT'?'반려 완료':'검토 대기');
        const button=node(card,'button','변경 내용 확인');button.type='button';button.className='btn btn-outline btn-sm';
        const body=node(card,'div');button.onclick=async()=>{
          if(!current())return;
          button.disabled=true;
          body.setAttribute('aria-busy','true');
          try{
            const {change}=await api('publication-change',{changeId:item.id});if(!current())return;body.replaceChildren();
            comparison(body,change,item);
            for(const [side,label,snapshot,panels]of [['before','요청 당시 공개본',change.baseline?.draft,change.beforePanels],['after','변경 요청본',change.candidate?.draft,change.afterPanels]]) {
              if(item.kind==='file'&&side==='before'&&!change.baseline?.state?.cover_file_id)continue;
              if(!snapshot&&item.kind!=='file')continue;
              node(body,'h4',label);const content=node(body,'div');previews.add(content);
              const load=(panel,_format,signal)=>window.WebNovelsAuth.api('/api/v2/admin/workflow?'+new URLSearchParams({action:'publication-image',changeId:item.id,side,...(panel.id?{panelId:panel.id}:{})}),{responseType:'blob',signal});
              if(panels?.length)window.ReaderWebtoon.render(content,panels,{load,valid:current});
              else if(item.kind==='file')window.ReaderWebtoon.render(content,[{width:600,height:900}],{load,valid:current});
              else window.ReaderContent.render(content,null,snapshot);
            }
            if(item.kind==='file')node(body,'p','새 표지의 원본 파일과 크롭 결과를 확인한 뒤 승인하세요.');
            if(item.decision)return;
            const label=node(body,'label','검토 사유 (3~500자)'),reason=node(label,'textarea');reason.maxLength=500;reason.minLength=3;reason.required=true;
            const feedback=node(body,'p','');feedback.setAttribute('role','status');let pending=null,busy=false;
            for(const [decision,text]of [['APPROVE','승인하고 반영'],['REJECT','반려·공개본 유지']]) {
              const commit=node(body,'button',text);commit.type='button';commit.className='btn btn-outline';commit.dataset.reviewDecision=decision;
              commit.onclick=async()=>{
                if(busy||!current())return;
                if(!pending){if(reason.value.trim().length<3||reason.value.trim().length>500){feedback.textContent='검토 사유를 3~500자로 입력해주세요.';return;}pending={changeId:item.id,decision,reason:reason.value.trim()};}
                busy=true;body.querySelectorAll('button,textarea').forEach(e=>e.disabled=true);
                try{const saved=await api('publication-decision',pending,true);if(!current())return;item.decision=saved.decision;summary();decisionStatus.textContent=saved.decision==='APPROVE'?'승인 완료':'반려 완료';feedback.textContent=saved.decision==='APPROVE'?'승인한 변경을 반영했습니다.':'반려했습니다. 기존 공개본은 유지됩니다.';pending=null;}
                catch(e){if(current()){
                  if([400,403,404,409].includes(e.status))pending=null;
                  feedback.textContent=e.code==='REVIEW_BASELINE_CHANGED'||e.code==='DRAFT_REVISION_CONFLICT'?'검토 기준이 변경되었습니다. 이 요청을 반려하고 작가에게 최신 버전으로 다시 요청하도록 안내해주세요.':e.status===403?'검토 권한이 변경되었습니다. 다시 로그인해 확인해주세요.':'처리 결과를 확인하지 못했습니다. 같은 결정으로 재시도해주세요.';
                  reason.disabled=!!pending||e.status===403;
                  body.querySelectorAll('button').forEach(button=>button.disabled=e.status===403||!!pending&&button.dataset.reviewDecision!==pending.decision);
                }}
                finally{busy=false;}
              };
            }
          }catch{if(current()){body.textContent='변경 내용을 불러오지 못했습니다. 다시 시도해주세요.';button.disabled=false;}}
          finally{if(current())body.setAttribute('aria-busy','false');}
        };
      }
    }catch{if(current()){status.textContent='검토 목록을 불러오지 못했습니다. 연결 상태와 권한을 확인한 뒤 다시 시도해주세요.';const retry=node(section,'button','검토 목록 다시 불러오기');retry.type='button';retry.className='btn btn-outline';retry.onclick=()=>{if(current()){section.replaceChildren();section.hidden=true;return render(root,valid);}};}}
    finally{if(current())section.setAttribute('aria-busy','false');}
  }
  window.AdminPublicationChanges={render,reset};
})();
