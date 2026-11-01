// Stage 8 owner operations. Every mutation is checked again by the service RPC.
(function(){
  'use strict';
  const active=()=>window.WEBNOVELS_CONFIG?.authorOperationsEnabled===true;
  const actor=()=>window.WebNovelsAuth?.getActor();
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text=(parent,tag,value)=>{const el=document.createElement(tag);el.textContent=value;parent.append(el);return el;};
  let turn=0;
  let publishedPreviewDispose=null;
  function clearPublishedPreview(){publishedPreviewDispose?.();publishedPreviewDispose=null;}
  const readCount=value=>typeof value==='string'&&/^(0|[1-9]\d{0,18})$/.test(value)?BigInt(value).toLocaleString('ko-KR'):'확인 필요';
  const publicationDate=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'발행 기록 없음';
  async function api(action,workId,data){
    const user=actor()?.userId;
    if(!user||!actor()?.author)throw Error('AUTHOR_REQUIRED');
    const query=new URLSearchParams({action,workId:String(workId)});
    const result=await window.WebNovelsAuth.api('/api/v2/creator/operations?'+query,
      data===undefined?undefined:{method:'POST',body:JSON.stringify(data)});
    if(actor()?.userId!==user)throw Error('SESSION_CHANGED');
    return result;
  }
  function reportError(error){return error?.code||error?.message||'요청을 처리하지 못했습니다.';}
  async function home(){
    const root=document.getElementById('creatorHomeContent');
    if(!root||!active())return;
    const seq=++turn,user=actor()?.userId;
    root.textContent='최근 작업을 확인하는 중입니다…';
    try{
      const works=await window.WebNovelsAuth.api('/api/v2/creator/works?filter=all&after=0');
      if(seq!==turn||actor()?.userId!==user)return;
      if(!works.works?.length){
        root.innerHTML='<p>아직 작품이 없습니다.</p><button type="button" class="btn btn-primary" id="coNew">첫 작품 만들기</button>';
        root.querySelector('#coNew').onclick=()=>window.CreatorWorks.navigate('/creator/works/new');return;
      }
      const result=await api('home',works.works[0].id);
      if(seq!==turn)return;
      root.replaceChildren();
      text(root,'h3','이어 쓸 원고');
      if(!result.drafts?.length)text(root,'p','진행 중인 원고가 없습니다.');
      for(const draft of result.drafts||[]){
        const button=text(root,'button',draft.title||'제목 없는 원고');
        button.type='button';button.className='btn btn-outline';
        button.onclick=()=>window.CreatorDraftEditor.openWork(draft.workId,draft.id);
      }
      text(root,'h3','실패한 예약');
      if(!result.failedSchedules?.length)text(root,'p','확인할 예약 실패가 없습니다.');
      for(const row of result.failedSchedules||[]){
        const entry=text(root,'p',`${row.episode_number}화 · ${row.last_error_code||'실행 실패'}`);
        entry.setAttribute('role','alert');
      }
      const next=text(root,'button','다음 회차 원고 시작');
      next.type='button';next.className='btn btn-outline';
      next.onclick=()=>window.CreatorDraftEditor.startNext(works.works[0].id);
      const link=text(root,'button','내 작품 관리');
      link.type='button';link.className='btn btn-primary';
      link.onclick=()=>window.CreatorWorks.navigate('/creator/works');
    }catch(error){if(seq===turn)root.textContent='홈을 불러오지 못했습니다. '+reportError(error);}
  }
  async function episodes(root,workId){
    if(!root||!active())return;
    clearPublishedPreview();
    const seq=++turn,user=actor()?.userId,valid=()=>seq===turn&&actor()?.userId===user&&actor()?.author?.status==='APPROVED'&&root.isConnected!==false;
    root.textContent='회차를 불러오는 중입니다…';root.setAttribute('aria-busy','true');
    try{
      const result=await window.WebNovelsAuth.api('/api/v2/creator/works/'+encodeURIComponent(workId)+'/episodes');
      if(!valid())return;
      const rows=result.episodes||[];
      root.innerHTML='<label>회차 검색 <input id="coEpisodeSearch" class="form-control" type="search"></label>'+
        '<label>상태 <select id="coEpisodeFilter" class="form-control"><option value="all">전체</option>'+
        '<option value="PUBLISHED">공개</option><option value="DRAFT">비공개</option>'+
        '<option value="PENDING">예약</option><option value="FAILED">실패</option></select></label>'+
        '<p id="coEpisodeMetricHelp">회원 열람수는 로그인한 독자의 시간당 중복을 제외한 열람 횟수입니다. 비회원 열람은 포함하지 않습니다. 최종 발행일은 현재 발행본의 반영 시각(한국 시간)입니다.</p>'+
        '<div class="studio-episode-table-wrap"><table class="studio-episode-table" aria-describedby="coEpisodeMetricHelp"><caption>회차별 발행 현황과 독자 열람</caption><thead><tr><th scope="col">회차·제목</th><th scope="col">최종 발행일</th><th scope="col">회원 열람수</th><th scope="col">상태</th><th scope="col">관리</th></tr></thead><tbody id="coEpisodeRows"></tbody></table></div>'+
        '<nav class="studio-work-actions" aria-label="회차 목록 페이지"><button type="button" class="btn btn-outline" id="coEpisodePrevious">이전 50회차</button><span id="coEpisodePage" role="status"></span><button type="button" class="btn btn-outline" id="coEpisodeNext">다음 50회차</button></nav><p id="coEpisodeMessage" role="status"></p>'+
        '<section id="coPublishedPreview" class="studio-published-preview" aria-labelledby="coPublishedTitle" tabindex="-1" hidden><button type="button" class="btn btn-outline" id="coPublishedClose">발행본 닫기</button><h4 id="coPublishedTitle"></h4><p id="coPublishedMeta"></p><div id="coPublishedBody" class="reader-content"></div><div id="coPublishedComment"></div></section>';
      const list=root.querySelector('#coEpisodeRows'),message=root.querySelector('#coEpisodeMessage');
      text(root,'p','비공개 원고는 자유롭게 수정·저장하고 작가가 직접 발행합니다. 예약 원고 수정은 기존 예약을 취소한 뒤 이어 쓰며, 이미 공개한 내용의 수정·철회는 검토를 요청합니다.');
      const preview=root.querySelector('#coPublishedPreview'),previewBody=root.querySelector('#coPublishedBody');
      let previewTurn=0,previewOpener=null;
      const closePreview=()=>{previewTurn++;clearPublishedPreview();preview.hidden=true;previewBody.replaceChildren();root.querySelector('#coPublishedComment').replaceChildren();};
      root.querySelector('#coPublishedClose').onclick=()=>{closePreview();if(valid())previewOpener?.focus();};
      const showPublished=async(row,opener)=>{
        if(!valid())return;closePreview();const request=++previewTurn;previewOpener=opener;message.textContent='발행한 내용을 불러오는 중입니다…';
        const current=()=>valid()&&request===previewTurn;
        try{
          const response=await window.WebNovelsAuth.api('/api/v2/creator/works/'+encodeURIComponent(workId)+'/episodes/'+encodeURIComponent(row.id));
          if(!current())return;const episode=response.episode;
          if(!episode||String(episode.id)!==String(row.id)||String(episode.workId)!==String(workId))throw Error('EPISODE_WORKSPACE_UNAVAILABLE');
          root.querySelector('#coPublishedTitle').textContent=episode.episode_number+'화 · '+episode.title;
          root.querySelector('#coPublishedMeta').textContent='최종 발행일 '+publicationDate(episode.published_at)+' · 회원 열람수 '+readCount(episode.member_read_count)+' · 발행한 내용 (읽기 전용)';
          const comment=root.querySelector('#coPublishedComment');
          preview.hidden=false;
          if(episode.contentType==='WEBTOON'){
            if(!window.ReaderWebtoon?.render||!episode.webtoon?.panels)throw Error('WEBTOON_UNAVAILABLE');
            publishedPreviewDispose=window.ReaderWebtoon.render(previewBody,episode.webtoon.panels,{valid:current,
              load:(panel,format,signal)=>window.WebNovelsAuth.api('/api/v2/creator/webtoon/panel/'+encodeURIComponent(panel.assetId)+'?workId='+encodeURIComponent(workId)+'&panelId='+encodeURIComponent(panel.id)+'&format='+format,{responseType:'blob',signal})});
            comment.textContent=[window.ReaderWebtoon.formatCredits?.(episode.webtoon.credits),episode.authorComment].filter(Boolean).join('\n');
          }else{
            if(!window.ReaderContent?.render)throw Error('CONTENT_UNAVAILABLE');
            window.ReaderContent.render(previewBody,comment,episode);
          }
          message.textContent='발행본을 열었습니다. 수정 중인 원고와 예약본은 반영되지 않습니다.';preview.focus();preview.scrollIntoView?.({block:'start'});
        }catch(error){if(current()){closePreview();message.textContent='발행본을 불러오지 못했습니다. '+reportError(error);}}
      };
      let page=0;
      const render=()=>{
        if(!valid())return;
        const q=root.querySelector('#coEpisodeSearch').value.toLowerCase().trim();
        const filter=root.querySelector('#coEpisodeFilter').value;
        const filtered=rows.filter(r=>(filter==='all'||(r.schedule_status||r.status)===filter)&&
          (!q||String(r.episode_number).includes(q)||String(r.title).toLowerCase().includes(q)));
        const pages=Math.max(1,Math.ceil(filtered.length/50));page=Math.min(page,pages-1);
        root.querySelector('#coEpisodePage').textContent=filtered.length+'회차 · '+(page+1)+' / '+pages;
        root.querySelector('#coEpisodePrevious').disabled=page===0;root.querySelector('#coEpisodeNext').disabled=page>=pages-1;
        list.replaceChildren();
        for(const row of filtered.slice(page*50,(page+1)*50)){
          const item=document.createElement('tr');item.className='co-episode';
          const state=row.schedule_status||row.status;
          const titleCell=text(item,'td',''),title=text(titleCell,row.has_head?'button':'span',`${row.episode_number}화 · ${row.title}`);
          if(row.has_head){title.type='button';title.className='studio-episode-title';title.setAttribute('aria-label',`${row.episode_number}화 ${row.title} 발행한 본문 보기`);title.onclick=()=>showPublished(row,title);}
          text(item,'td',publicationDate(row.published_at));text(item,'td',readCount(row.member_read_count));
          text(item,'td',({PUBLISHED:'공개',DRAFT:'비공개',PENDING:'예약',FAILED:'예약 실패',RUNNING:'발행 처리 중',CANCELLED:'예약 취소'}[state]||state));
          const actions=text(text(item,'td',''),'div','');actions.className='studio-episode-actions';
          const canEdit=row.status==='PUBLISHED'&&!row.schedule_status;
          const manage=text(actions,'button',['PENDING','FAILED','RUNNING'].includes(row.schedule_status)?'예약 원고·시각 관리':canEdit?'수정 원고 작성':row.has_head?'발행·검토 관리':'원고·발행 관리');
          manage.type='button';manage.className='btn btn-outline btn-sm';
          let editing=false,editRequest=null;
          manage.onclick=async()=>{
            if(!valid()||editing)return;
            if(!canEdit)return window.CreatorPublications.open(workId,{focusEpisodeId:String(row.id)});
            editing=true;manage.disabled=true;message.textContent='수정 원고를 여는 중입니다…';
            try{
              editRequest=editRequest||{key:crypto.randomUUID(),draftId:crypto.randomUUID()};
              const edited=await window.WebNovelsAuth.api('/api/v2/creator/publications/edit/'+encodeURIComponent(row.id)+'?workId='+encodeURIComponent(workId),{method:'POST',headers:{'Idempotency-Key':editRequest.key},body:JSON.stringify({draftId:editRequest.draftId})});
              if(!valid())return;
              if(!edited?.draft?.id||String(edited.draft.workId)!==String(workId))throw Error('DRAFT_NOT_FOUND');
              message.textContent='수정 원고를 저장한 뒤 관리자 승인을 요청하세요. 승인 전까지 발행본은 유지됩니다.';
              await window.CreatorDraftEditor.openWork(workId,edited.draft.id);
            }catch(error){if(valid())message.textContent='수정 원고를 열지 못했습니다. '+reportError(error);}
            finally{if(valid()){editing=false;manage.disabled=false;}}
          };
          if((row.status==='PUBLISHED'||(row.status==='DRAFT'&&row.has_head))&&!row.schedule_status){
            const withdraw=row.status==='PUBLISHED';
            const toggle=text(actions,'button',withdraw?'공개 철회 검토 요청':'공개 복구 검토 요청');
            toggle.type='button';toggle.className='btn btn-outline btn-sm';
            let submitting=false;
            toggle.onclick=async()=>{
              if(!valid()||submitting)return;
              if(!confirm(withdraw?'회차를 비공개로 전환할까요? 댓글과 공개본 이력은 보존됩니다.':'기존 공개본을 다시 공개할까요?'))return;
              submitting=true;toggle.disabled=true;
              try{
                const saved=await api(withdraw?'withdraw':'restore-episode',workId,{episodeId:row.id});
                if(!valid())return;
                if(saved.reviewRequired){message.textContent='공개 상태 변경 검토를 요청했습니다. 승인 전까지 기존 공개 상태를 유지합니다.';return;}
                await window.refreshReaderCatalog?.(true);
                await episodes(root,workId);
              }catch(error){if(valid())message.textContent=reportError(error);}
              finally{if(valid()){submitting=false;toggle.disabled=false;}}
            };
          }
          list.append(item);
        }
        if(!list.childNodes.length){const empty=text(list,'tr','');text(empty,'td','해당 회차가 없습니다.').setAttribute('colspan','5');}
      };
      root.querySelector('#coEpisodeSearch').oninput=()=>{page=0;render();};
      root.querySelector('#coEpisodeFilter').onchange=()=>{page=0;render();};
      root.querySelector('#coEpisodePrevious').onclick=()=>{if(valid()&&page>0){page--;render();}};
      root.querySelector('#coEpisodeNext').onclick=()=>{if(valid()){page++;render();}};
      render();
    }catch(error){if(valid())root.textContent='회차를 불러오지 못했습니다. '+reportError(error);}
    finally{if(valid())root.setAttribute('aria-busy','false');}
  }
  async function serial(work,root){
    if(!root||!active())return;
    root.innerHTML='<form id="coSerialForm"><h4>연재 상태와 예약</h4>'+
      '<label>연재 상태 <select name="serialState" class="form-control">'+
      '<option value="ONGOING">연재 중</option><option value="HIATUS">휴재</option>'+
      '<option value="COMPLETED">완결</option></select></label>'+
      '<label>기존 예약 <select name="schedulePolicy" class="form-control">'+
      '<option value="KEEP">유지: 예약 시각에 게시</option>'+
      '<option value="CANCEL">취소: 예약본은 비공개 보존</option></select></label>'+
      '<p>휴재·완결만 바꾸면 기존 예약은 계속 실행됩니다. 취소를 선택한 경우 실행 중인 예약과 충돌하면 변경 전체가 중단됩니다.</p>'+
      '<button type="submit" class="btn btn-primary">연재 상태 저장</button></form><p id="coSerialMessage" role="status"></p>';
    const form=root.querySelector('form');form.elements.serialState.value=work.serial_state;
    form.onsubmit=async event=>{
      event.preventDefault();
      const message=root.querySelector('#coSerialMessage');
      const data={serialState:form.elements.serialState.value,
        schedulePolicy:form.elements.schedulePolicy.value,version:String(work.version)};
      try{
        const result=await api('serial-state',work.id,data);
        const confirmation=result.reviewRequired?'연재 상태 변경 검토를 요청했습니다. 승인 전까지 기존 설정을 유지합니다.':`저장했습니다. 기존 예약 ${result.cancelledSchedules}건 취소, 나머지는 ${data.schedulePolicy==='KEEP'?'유지':'없음'}입니다.`;
        await window.CreatorWorks.loadFromRoute();
        const updated=document.getElementById('coSerialMessage');
        if(updated)updated.textContent=confirmation;
      }catch(error){message.textContent='저장 실패: '+reportError(error);}
    };
  }
  async function reactions(root,workId){
    if(!root||!active())return;
    root.innerHTML='<section class="co-panel"><h4>댓글 정책</h4><form id="coPolicy">'+
      '<label><input type="checkbox" name="enabled"> 댓글 허용</label>'+
      '<label>최소 완독 회차 <input type="number" name="minRead" min="0" max="100" class="form-control"></label>'+
      '<label>금칙어 (줄마다 하나) <textarea name="terms" rows="3" class="form-control"></textarea></label>'+
      '<button class="btn btn-primary" type="submit">정책 저장</button></form><div id="coBlocks"></div></section>'+
      '<section class="co-panel"><h4>최근 댓글</h4><div id="coComments"></div></section>'+
      '<section class="co-panel"><h4>독자 통계</h4><div id="coStats"></div></section>'+
      '<section class="co-panel"><h4>중요 알림</h4><div id="coNotices"></div></section>'+
      (window.WebNovelsAppeals?.active()?'<section class="co-panel" id="coAppeals"></section>':'')+
      '<p id="coMessage" role="status"></p>';
    window.WebNovelsAppeals?.mount(root.querySelector('#coAppeals'));
    const message=root.querySelector('#coMessage');
    const fail=e=>{message.textContent=reportError(e);};
    try{
      const [policy,comments,stats,notices]=await Promise.all([
        api('policy',workId),api('comments',workId),api('statistics',workId),api('notices',workId)]);
      const form=root.querySelector('#coPolicy');
      form.elements.enabled.checked=policy.policy.commentsEnabled;
      form.elements.minRead.value=policy.policy.minReadEpisodes;
      form.elements.terms.value=(policy.policy.blockedTerms||[]).join('\n');
      form.onsubmit=async event=>{
        event.preventDefault();
        try{
          await api('policy-save',workId,{commentsEnabled:form.elements.enabled.checked,
            minReadEpisodes:Number(form.elements.minRead.value),
            blockedTerms:form.elements.terms.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)});
          message.textContent='댓글 정책을 저장했습니다.';
        }catch(error){fail(error);}
      };
      const blocks=root.querySelector('#coBlocks');
      for(const block of policy.blocks||[]){
        const line=document.createElement('p');
        text(line,'span','차단된 독자 '+block.readerUserId+' ');
        const button=text(line,'button','차단 해제');
        button.type='button';button.className='btn btn-outline btn-sm';
        button.onclick=async()=>{try{await api('unblock',workId,{readerUserId:block.readerUserId});
          line.remove();message.textContent='작품 댓글 차단을 해제했습니다.';}catch(error){fail(error);}};
        blocks.append(line);
      }
      const list=root.querySelector('#coComments');
      if(!comments.comments?.length)text(list,'p','아직 댓글이 없습니다.');
      for(const comment of comments.comments||[]){
        const item=document.createElement('article');item.className='co-comment';
        text(item,'p',`${comment.nickname} · ${comment.content}`);
        if(comment.quote_text)text(item,'p','과거 문맥: '+comment.quote_text);
        text(item,'small',comment.is_hidden_by_author?'작가가 숨김':'표시 중');
        for(const [action,label] of [[comment.is_hidden_by_author?'unhide':'hide',
          comment.is_hidden_by_author?'숨김 해제':'숨김'],['block','이 독자 차단'],['report','신고']]){
          const button=text(item,'button',label);button.type='button';button.className='btn btn-outline btn-sm';
          button.onclick=async()=>{
            const reason=action==='report'?prompt('신고 사유 (3자 이상)'):undefined;
            if(action==='report'&&(!reason||reason.trim().length<3))return;
            try{await api(action,workId,{commentId:comment.id,...(reason?{reason}: {})});
              message.textContent='처리했습니다. 기록은 보존됩니다.';
              if(action!=='report')await reactions(root,workId);
            }catch(error){fail(error);}
          };
        }
        list.append(item);
      }
      const stat=root.querySelector('#coStats');
      if(stats.state==='EMPTY')text(stat,'p','최근 30일 독자 활동 0건입니다.');
      else if(stats.state==='INSUFFICIENT')text(stat,'p','최근 30일 표본이 5명 미만이라 회차별 수치를 숨깁니다.');
      else {
        text(stat,'p',`최근 30일 고유 독자 ${stats.sample}명 · 관심 ${stats.favorites}건 · 댓글 ${stats.comments}건`);
        for(const row of stats.recentEpisodes||[])text(stat,'p',`${row.episode_number}화 · ${row.readers==null?'표본 부족':'고유 독자 '+row.readers+'명'}`);
      }
      const inbox=root.querySelector('#coNotices');
      if(!notices.notices?.length)text(inbox,'p','확인할 알림이 없습니다.');
      for(const notice of notices.notices||[]){
        const line=document.createElement('p');
        text(line,'span',`${notice.kind} · ${notice.title} · ${notice.detail||''} `);
        if(!notice.read_at){
          const button=text(line,'button','읽음');
          button.type='button';button.className='btn btn-outline btn-sm';
          button.onclick=async()=>{try{await api('notice-read',workId,{noticeId:notice.id});
            button.remove();}catch(error){fail(error);}};
        }
        inbox.append(line);
      }
    }catch(error){
      fail(error);
      root.querySelector('#coStats').textContent=error?.status===403?'통계를 볼 권한이 없습니다.':
        error?.status===503?'통계 서버에 연결할 수 없습니다. 다시 시도해주세요.':
        '통계 또는 댓글을 불러오지 못했습니다.';
    }
  }
  window.CreatorOperations=Object.freeze({active,api,home,episodes,serial,reactions,reset(){turn++;clearPublishedPreview();}});
})();
