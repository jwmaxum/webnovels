/* Guidance only. Ownership, metadata and publication permission remain server decisions. */
(function() {
  'use strict';
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Genre values match the current reader filters; tags match src/config/tags.ts.
  const genres=['판타지','현대 판타지','무협','로맨스','로맨스 판타지','SF','미스터리','공포','일상'];
  const tags=[['regression','회귀',['회귀물']],['possession','빙의',['빙의물']],['reincarnation','환생',['환생물']],
    ['misunderstanding','착각계'],['catharsis','사이다'],['academy','아카데미'],['professional','전문직'],
    ['system','시스템'],['game','게임빙의'],['hunter','헌터'],['dungeon','던전'],['growth','성장'],['survival','생존'],
    ['politics','정치'],['war','전쟁'],['romance','로맨스'],['romance-fantasy','로맨스판타지',['로판']],
    ['martial-arts','무협'],['modern-fantasy','현대판타지',['현판']],['healing','힐링'],['mystery','미스터리'],
    ['horror','공포'],['sf','SF'],['slice-of-life','일상'],['comedy','코미디'],['revenge','복수'],['family','육아'],
    ['chef','요리'],['sports','스포츠'],['medical','의학'],['business','경영'],['historical','대체역사']];
  const item=(label,state,detail,action)=>({label,state,detail,action});
  function workItems(work,config=window.WEBNOVELS_CONFIG||{}) {
    const missing=work.publication_missing;
    config={...config};if(window.WebNovelsAuth?.getActor()?.authorWorkspaceReady===true){config.authorFilesEnabled=false;config.authorPublishEnabled=false;}
    const blocked=!!work.trashed_at||work.moderation_state!=='CLEAR'||work.rating==='AGE_19'||(work.content_type==='WEBTOON'&&config.webtoonServiceEnabled!==true);
    return [
      item('작품 정보',Array.isArray(missing)&&!missing.length?'done':'pending',
        Array.isArray(missing)?missing.length?'확인 필요: '+missing.join(', '):'소개·장르·등급·AI 표기 입력 완료':'서버에서 작품 정보를 다시 확인해주세요.','settings'),
      item('게시 범위',blocked?'blocked':'done',work.trashed_at?'휴지통에서 복구해주세요.':work.moderation_state!=='CLEAR'?'운영 제한 상태를 확인해주세요.':work.rating==='AGE_19'?'성인 게시·열람은 별도 준비 중입니다.':work.content_type==='WEBTOON'?(config.webtoonServiceEnabled===true?'처리 완료된 이미지로 무료 회차를 게시할 수 있습니다.':'웹툰 제작 기능이 아직 활성화되지 않았습니다.'):'현재 신규 게시 범위는 웹소설입니다. 작품 유형·권한은 서버가 최종 확인합니다.'),
      item('첫 원고', 'pending','작성 중 원고와 기기·서버 사본을 선택해 이어서 쓸 수 있습니다.','draft'),
      item('표지·파일', 'optional',config.authorFilesEnabled===true?'TXT/DOCX 가져오기·표지·내보내기. 표지는 선택 사항입니다.':'파일 기능은 준비 중입니다. 본문 직접 입력과 제목 기본 표지를 사용할 수 있습니다.',config.authorFilesEnabled===true?'files':null),
      item('연재 방식', 'optional','작품 설정에서 제공되는 비독점·외부 링크 설정을 확인하세요. 권리 진술은 유통 계약이 아닙니다.','settings'),
      item('미리보기·게시',config.authorPublishEnabled===true?'pending':'blocked',config.authorPublishEnabled===true?'저장된 원고 버전·게시 권리를 확인한 뒤 공개 또는 예약합니다.':'게시 기능은 준비 중입니다. 비공개 원고 작성·복구를 계속할 수 있습니다.',config.authorPublishEnabled===true?'publication':null)
    ];
  }
  function draftItems(c) {
    return [item('원고 제목·본문',c.snapshot.title.trim()&&(c.snapshot.webtoon?c.snapshot.webtoon.assetIds.length>0:c.snapshot.content.trim())?'done':'pending',c.snapshot.webtoon?'제목과 처리 완료된 이미지를 등록해주세요.':'제목과 본문을 입력해주세요.'),
      item('저장 버전',c.conflict?'blocked':c.serverSeq===c.seq&&!c.pending&&c.revision!=='0'?'done':'pending',
        c.conflict?'충돌한 양쪽 사본을 비교하고 해결해주세요.':c.lifecycle!=='ACTIVE'?'보관 원고입니다. 다음 원고는 새로 시작해주세요.':c.serverSeq===c.seq&&!c.pending?'서버 버전 '+c.revision:'기기 사본을 보존하며 서버 동기화를 기다립니다.')];
  }
  function publicationItems(work,c,rights,config=window.WEBNOVELS_CONFIG||{}) {
    return [...workItems(work,config).filter(x=>['작품 정보','게시 범위'].includes(x.label)),
      ...draftItems({...c,serverSeq:c.seq,pending:null,lifecycle:'ACTIVE',conflict:null}),
      item('게시 기능',config.authorPublishEnabled===true?'done':'blocked',config.authorPublishEnabled===true?'공개·예약 요청 가능':'게시 기능은 준비 중입니다.'),
      item('게시 권리',rights?'done':'pending',rights?'이 버전의 게시 권리를 확인했습니다.':'아래에서 게시 권리·작품 정보를 직접 확인해주세요.')];
  }
  function render(items,actions=false) {
    return '<ul class="creator-readiness">'+items.map(x=>`<li data-state="${esc(x.state)}"><strong>${esc({done:'확인',pending:'확인 필요',optional:'선택',blocked:'준비·제한'}[x.state])} · ${esc(x.label)}</strong><span>${esc(x.detail)}</span>${actions&&x.action?`<button type="button" class="btn btn-outline btn-sm" data-ready-action="${esc(x.action)}">${esc({settings:'작품 설정',draft:'원고 작성·복구',files:'파일·표지',publication:'미리보기·게시'}[x.action])}</button>`:''}</li>`).join('')+'</ul>';
  }
  const split=value=>[...new Set(String(value||'').split(',').map(x=>x.trim()).filter(Boolean))];
  function values(field,value,original) {
    // Do not rewrite legacy/custom values when only another field was edited.
    if(value===(original||[]).join(', '))return [...(original||[])];
    const result=split(value).map(v=>field==='tags'?(tags.find(([slug,label,aliases=[]])=>v===slug||v===label||aliases.includes(v))?.[0]||v):v);
    const unique=[...new Set(result)];if(unique.length>10)throw Object.assign(Error('INVALID_FIELD'),{code:'INVALID_FIELD'});return unique;
  }
  function choices(field,current) {
    const options=field==='genre'?genres.map(v=>[v,v]):tags;
    return `<div class="creator-choices" role="group" aria-label="${field==='genre'?'장르':'태그'} 선택">`+options.map(([value,label])=>`<button type="button" class="btn btn-outline btn-sm" data-choice-field="${field}" data-choice-value="${esc(value)}" aria-pressed="${current.includes(value)}">${esc(label)}</button>`).join('')+'</div>';
  }
  function bindChoices(root) {
    const buttons=root.querySelectorAll('[data-choice-field]');
    const refresh=()=>buttons.forEach(b=>b.setAttribute('aria-pressed',split(root.querySelector(b.dataset.choiceField==='genre'?'#cwGenre':'#cwTags').value).includes(b.dataset.choiceValue)));
    buttons.forEach(b=>b.onclick=()=>{
      const input=root.querySelector(b.dataset.choiceField==='genre'?'#cwGenre':'#cwTags'),current=split(input.value),value=b.dataset.choiceValue;
      if(current.includes(value))input.value=current.filter(x=>x!==value).join(', ');
      else if(current.length<10)input.value=[...current,value].join(', ');
      else {root.querySelector('#cwMessage').textContent='최대 10개를 선택할 수 있습니다. 기존 항목을 먼저 해제해주세요.';return;}
      refresh();
    });
    for(const id of ['#cwGenre','#cwTags'])root.querySelector(id)?.addEventListener?.('input',refresh);
  }
  window.CreatorReadiness={workItems,draftItems,publicationItems,render,values,choices,bindChoices,tags,genres};
})();
