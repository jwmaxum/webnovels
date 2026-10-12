(function(){
  'use strict';
  const node=(parent,tag,text)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;parent.append(e);return e;};
  const previews=new Set();
  function reset(){for(const root of previews)window.ReaderWebtoon?.destroy(root);previews.clear();}
  const labels={work:'작품 정보·삭제',publication:'공개 회차 수정',operation:'연재·공개 상태',distribution:'연재 형태·외부 링크',file:'표지 변경'};
  async function render(root,valid) {
    if(window.WEBNOVELS_CONFIG?.publicationChangeReviewEnabled!==true)return;
    reset();const section=node(root,'section');section.className='co-panel';node(section,'h3','발행 후 수정·삭제 검토');
    node(section,'p','새 회차는 작가가 직접 발행합니다. 이 목록에서는 이미 발행된 작품의 변경 요청만 검토합니다. 승인 전까지 기존 공개본을 유지합니다.');
    const status=node(section,'p','요청을 불러오는 중입니다.');status.setAttribute('role','status');
    const api=async(action,data={},write=false)=>window.WebNovelsAuth.api('/api/v2/admin/workflow?'+new URLSearchParams({action,...(!write?data:{})}),write?{method:'POST',body:JSON.stringify(data)}:undefined);
    try {
      const result=await api('publication-changes');if(!valid())return;
      status.textContent=result.changes.length?'최근 요청 최대 100건 · 미처리 우선':'검토할 요청이 없습니다.';
      for(const item of result.changes) {
        const card=node(section,'article');card.className='workflow-card';node(card,'h4',item.title+' · '+labels[item.kind]);node(card,'p',item.decision==='APPROVE'?'승인 완료':item.decision==='REJECT'?'반려 완료':'검토 대기');
        const button=node(card,'button','변경 내용 확인');button.type='button';button.className='btn btn-outline btn-sm';
        const body=node(card,'div');button.onclick=async()=>{
          button.disabled=true;
          try{
            const {change}=await api('publication-change',{changeId:item.id});if(!valid())return;body.replaceChildren();
            for(const [side,label,snapshot,panels]of [['before','현재 공개본',change.baseline?.draft,change.beforePanels],['after','변경 요청본',change.candidate?.draft,change.afterPanels]]) {
              if(item.kind==='file'&&side==='before'&&!change.baseline?.state?.cover_file_id)continue;
              if(!snapshot&&item.kind!=='file')continue;
              node(body,'h4',label);const content=node(body,'div');previews.add(content);
              const load=(panel,_format,signal)=>window.WebNovelsAuth.api('/api/v2/admin/workflow?'+new URLSearchParams({action:'publication-image',changeId:item.id,side,...(panel.id?{panelId:panel.id}:{})}),{responseType:'blob',signal});
              if(panels?.length)window.ReaderWebtoon.render(content,panels,{load,valid});
              else if(item.kind==='file')window.ReaderWebtoon.render(content,[{width:600,height:900}],{load,valid});
              else window.ReaderContent.render(content,null,snapshot);
            }
            const details=node(body,'details');node(details,'summary','변경 요청 항목·현재 작품 정보 비교');
            node(details,'p','요청 내용');node(details,'pre',JSON.stringify(change.arguments.data,null,2));
            node(details,'p','검토 기준 작품');node(details,'pre',JSON.stringify(change.baseline.work,null,2));
            if(item.kind==='file')node(body,'p','새 표지의 원본 파일과 크롭 결과를 확인한 뒤 승인하세요.');
            if(item.decision)return;
            const label=node(body,'label','검토 사유 (3~500자)'),reason=node(label,'textarea');reason.maxLength=500;reason.minLength=3;reason.required=true;
            const feedback=node(body,'p','');feedback.setAttribute('role','status');let pending=null,busy=false;
            for(const [decision,text]of [['APPROVE','승인하고 반영'],['REJECT','반려·공개본 유지']]) {
              const commit=node(body,'button',text);commit.type='button';commit.className='btn btn-outline';commit.dataset.reviewDecision=decision;
              commit.onclick=async()=>{
                if(busy||!valid())return;
                if(!pending){if(reason.value.trim().length<3){feedback.textContent='검토 사유를 입력해주세요.';return;}pending={changeId:item.id,decision,reason:reason.value.trim()};}
                busy=true;body.querySelectorAll('button,textarea').forEach(e=>e.disabled=true);
                try{const saved=await api('publication-decision',pending,true);if(!valid())return;item.decision=saved.decision;feedback.textContent=saved.decision==='APPROVE'?'승인한 변경을 반영했습니다.':'반려했습니다. 기존 공개본은 유지됩니다.';pending=null;}
                catch(e){if(valid()){
                  if([400,403,404,409].includes(e.status))pending=null;
                  feedback.textContent=e.code==='REVIEW_BASELINE_CHANGED'||e.code==='DRAFT_REVISION_CONFLICT'?'검토 기준이 변경되었습니다. 이 요청을 반려하고 작가에게 최신 버전으로 다시 요청하도록 안내해주세요.':e.status===403?'검토 권한이 변경되었습니다. 다시 로그인해 확인해주세요.':'처리 결과를 확인하지 못했습니다. 같은 결정으로 재시도해주세요.';
                  reason.disabled=!!pending||e.status===403;
                  body.querySelectorAll('button').forEach(button=>button.disabled=e.status===403||!!pending&&button.dataset.reviewDecision!==pending.decision);
                }}
                finally{busy=false;}
              };
            }
          }catch{if(valid()){body.textContent='변경 내용을 불러오지 못했습니다. 다시 시도해주세요.';button.disabled=false;}}
        };
      }
    }catch{if(valid())status.textContent='검토 목록 연결이 준비되지 않았습니다. 운영 설정을 확인해주세요.';}
  }
  window.AdminPublicationChanges={render,reset};
})();
