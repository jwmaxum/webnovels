// Reader location is bound to an authenticated session and an immutable publication.
(function() {
  'use strict';
  const actorId = () => window.WebNovelsAuth?.getActor()?.userId || null;
  const clamp = value => Math.max(0, Math.min(1, value));
  const line = 96;
  let generation = 0, current = null, comments = 0;
  function cleanup() { window._readerScrollCleanup?.(); window._readerScrollCleanup = null; }
  function reset() {
    generation++; comments++; cleanup();window.ReaderWebtoon?.reset(); current = null;
    window._currentReadingWorkId = null; window._currentReadingEpNum = null;
    window._currentContentVersionId = null; window._paragraphComment = null; window._filterParagraphIndex = null;
    for (const id of ['readerBody', 'readerWebtoonViewer', 'readerCommentsList', 'readerAuthorComment', 'readerProgressStatus'])
      document.getElementById(id)?.replaceChildren();
  }
  function begin(workId, episodeNumber) {
    window.ReaderDiscovery?.leave('view-reader');
    reset();
    return current = {generation, userId: actorId(), workId: String(workId), episodeNumber: Number(episodeNumber),
      episode: null, versionId: null, pendingProgress: null, progressFlight: null, positionBlocked: false};
  }
  const valid = token => !!token && token === current && token.generation === generation && token.userId === actorId();
  function leave(viewId) { if (viewId !== 'view-reader') reset(); }
  function commentTicket() { return {token: current, number: ++comments, userId: actorId()}; }
  function commentValid(ticket) {
    return ticket.number === comments && ticket.userId === actorId() &&
      (ticket.token ? valid(ticket.token) : !current);
  }
  window.ReaderSession = Object.freeze({begin, valid, leave, reset, commentTicket, commentValid,
    get current() { return valid(current) ? current : null; }});

  function measure(body, versionId, webtoon = false) {
    if (!body?.getBoundingClientRect) return null;
    const panels=webtoon?Array.from(body.querySelectorAll('.webtoon-panel')).filter(p=>p.dataset?.panelIndex!==undefined&&typeof p.getBoundingClientRect==='function'):[];
    if (webtoon && !panels.length && Array.from(body.querySelectorAll('img')).some(img => !img.complete || !img.naturalHeight)) return null;
    const bounds = body.getBoundingClientRect();
    if (!(bounds.height > 0) || !(window.innerHeight > line)) return null;
    const progress = Math.round(clamp((window.innerHeight - bounds.top) / bounds.height) * 100);
    let position;
    if ((!webtoon||panels.length) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(versionId || ''))) {
      const paragraphs = webtoon?panels:Array.from(body.querySelectorAll('.reader-paragraph'));
      const paragraph = paragraphs.find(item => item.getBoundingClientRect().bottom > line) || paragraphs.at(-1);
      if (paragraph) {
        if(webtoon&&paragraph.dataset.loaded==='false')return null;
        const rect = paragraph.getBoundingClientRect(), index = Number(webtoon?paragraph.dataset.panelIndex:paragraph.dataset.paragraphIndex);
        if (Number.isInteger(index) && index >= 0) position = {versionId, [webtoon?'panelIndex':'paragraphIndex']: index,
          offset: Math.round(clamp((line - rect.top) / Math.max(rect.height, 1)) * 10000) / 10000};
      }
    }
    return position ? {progress, position} : {progress};
  }
  function restore(body, position, versionId) {
    if (!position) return 'NONE';
    if (String(position.versionId) !== String(versionId)) return 'VERSION_CHANGED';
    const webtoon=Object.hasOwn(position,'panelIndex'), index=webtoon?position.panelIndex:position.paragraphIndex;
    if (!Number.isInteger(index) || index < 0 ||
        !Number.isFinite(position.offset) || position.offset < 0 || position.offset > 1) return 'UNAVAILABLE';
    const paragraph = Array.from(body?.querySelectorAll(webtoon?'.webtoon-panel':'.reader-paragraph') || [])
      .find(item => Number(webtoon?item.dataset.panelIndex:item.dataset.paragraphIndex) === index);
    if (!paragraph) return 'UNAVAILABLE';
    const rect = paragraph.getBoundingClientRect();
    window.scrollTo({top: Math.max(0, window.scrollY + rect.top + rect.height * position.offset - line), behavior: 'instant'});
    return 'RESTORED';
  }
  window.ReaderPosition = Object.freeze({measure, restore});
})();

(function() {
  'use strict';
  let generation = 0, renderedLimit = 20;
  const user = () => window.WebNovelsAuth?.getActor()?.userId || null;
  const missing = error => error?.status === 404 || /^(?:NOT_FOUND|PUBLIC_WORK_NOT_FOUND|PUBLIC_EPISODE_NOT_FOUND|WORK_NOT_FOUND|EPISODE_NOT_FOUND)$/.test(error?.code || error?.message || '');
  const node = (tag, text, className) => { const el=document.createElement(tag); if(text!=null)el.textContent=text;if(className)el.className=className;return el; };
  const t = (source, params = {}) => window.ReaderI18n?.t(source, params) ?? source.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? '');
  function localized(el, label, attribute) {
    if (!el) return el;
    const render = typeof label === 'function' ? label : () => t(label);
    if (window.ReaderFeatureCopy) window.ReaderFeatureCopy.bind(el, render, attribute);
    else if (attribute) el.setAttribute(attribute, render());
    else el.textContent = render();
    return el;
  }
  function title(el, work) {
    const copy = () => window.ReaderI18n?.work(work) || work;
    localized(el, () => copy().title);
    localized(el, () => copy().titleLanguage || work.originalLanguage || 'ko', 'lang');
    return el;
  }
  async function resolve(item) {
    if (!Number.isSafeInteger(Number(item?.episodeNumber)) || Number(item.episodeNumber) < 1) return null;
    if (window.ReaderCatalog?.active()) {
      try { const result=await window.ReaderCatalog.reading(item.workId,item.episodeNumber);
        return result?.work && result?.episode ? {item,work:result.work,episode:result.episode} : null;
      } catch(error) {if(missing(error))return null;throw error;}
    }
    const work=getPublishedWorks().find(value=>String(value.id)===String(item.workId));
    const episode=work?.episodes?.find(value=>Number(value.episodeNumber)===Number(item.episodeNumber));
    return episode ? {item,work,episode} : null;
  }
  async function latest(history, valid = () => true) {
    for(const item of history) {const result=await resolve(item);if(!valid())return null;if(result)return result;}
    return null;
  }
  function message(container,text,retry) {
    if(!container)return;
    const status=localized(node('p'),text);status.setAttribute('role','status');container.replaceChildren(status);
    if(retry){const button=localized(node('button',null,'btn btn-outline'),'다시 시도');button.type='button';button.onclick=retry;container.append(button);}
  }
  async function render(limit=20) {
    renderedLimit = limit;
    const ticket=++generation, account=user();
    const valid=()=>ticket===generation&&account===user();
    const recent=document.getElementById('libraryContinueList'), favorites=document.getElementById('libraryFavoritesList');
    const authors=document.getElementById('libraryCreatorsList')||document.getElementById('libraryAuthorsList');
    const retry=()=>render(limit);
    const notice=text=>localized(document.getElementById('libraryLoadStatus'),text);
    const count=(ids,value)=>{for(const id of ids)localized(document.getElementById(id),() => typeof value==='number'?value.toLocaleString(window.ReaderI18n?.locale()||'ko'):String(value));};
    const groups=[['statReadingCount'],['statFavoriteCount'],['statAuthorCount','statCreatorCount']];
    const more=(container,available)=>{
      if(!container||!available)return;
      const button=localized(node('button',null,'btn btn-outline library-more'),'서재 더 보기');button.type='button';
      button.onclick=()=>{if(valid())return render(limit+20);};container.append(button);
    };
    for(const ids of groups)count(ids,'—');
    if(!account||!window.WebNovelsAuth?.getActor()?.reader){
      for(const el of [recent,favorites,authors]){message(el,'독자 로그인 후 이용해주세요.');el?.setAttribute('aria-busy','false');}
      notice('독자 로그인 후 서재를 이용할 수 있습니다.');return;
    }
    for(const el of [recent,favorites,authors]){message(el,'서재를 불러오는 중입니다.');el?.setAttribute('aria-busy','true');}
    notice('서재를 불러오는 중입니다.');
    try {
      const activity=await window.ReaderHub.activity(true);if(!valid())return;
      const unique=new Set(),history=(activity.readingHistory||[]).filter(item=>{
        if(unique.has(String(item.workId)))return false;unique.add(String(item.workId));return true;
      });
      const ids=[...new Set((activity.favorites||[]).map(String))];
      if(authors){authors.replaceChildren();for(const author of activity.subscriptions||[])authors.append(node('p',author.name,'library-author-card'));
        if(!authors.children.length)message(authors,'구독 중인 작가가 없습니다.');authors.setAttribute('aria-busy','false');}
      count(groups[2],(activity.subscriptions||[]).length);
      let failed=false;
      try {
        const entries=[];
        for(let offset=0;offset<Math.min(history.length,limit);offset+=4){
          entries.push(...await Promise.all(history.slice(offset,Math.min(offset+4,limit)).map(async item=>{
            try{return await resolve(item);}catch(error){if(error?.status===403)return null;throw error;}
          })));if(!valid())return;
        }
        if(recent){
          recent.replaceChildren();
          for(const entry of entries.filter(Boolean)){
            const {work,item}=entry,pct=Math.max(0,Math.min(100,Math.round(Number(item.progress)||0)));
            const button=node('button',null,'library-row');button.type='button';
            button.append(title(node('strong'),work),localized(node('span'),() => t('{number}화 · 현재 회차 {progress}% · 이어보기', {number:item.episodeNumber,progress:pct})));
            button.onclick=()=>{if(valid())window.openReaderDirect(work.id,item.episodeNumber);};recent.append(button);
          }
          if(!recent.children.length)message(recent,history.length?'이어볼 수 있는 공개 회차가 없습니다.':'아직 읽은 작품이 없습니다. 작품 탐색에서 읽기를 시작해 보세요.');
          more(recent,history.length>limit);
        }
        count(groups[0],history.length);
      } catch(error) {
        if(!valid())return;failed=true;message(recent,'이어보기 목록을 불러오지 못했습니다. 연결 상태를 확인하고 다시 시도해주세요.',retry);
      } finally {if(valid())recent?.setAttribute('aria-busy','false');}
      if(!valid())return;
      try {
        const favoriteWorks=[];
        for(let offset=0;offset<Math.min(ids.length,limit);offset+=4){
          favoriteWorks.push(...await Promise.all(ids.slice(offset,Math.min(offset+4,limit)).map(async id=>{
            try{return window.ReaderCatalog?.active()?await window.ReaderCatalog.work(id):getPublishedWorks().find(work=>String(work.id)===id)||null;}
            catch(error){if(error?.status===403||missing(error))return null;throw error;}
          })));if(!valid())return;
        }
        if(favorites){
          favorites.replaceChildren();
          for(const work of favoriteWorks.filter(Boolean)){
            const button=title(node('button',null,'library-row'),work);button.type='button';
            button.onclick=()=>{if(valid())window.openWorkDetailDirect(work.id);};favorites.append(button);
          }
          if(!favorites.children.length)message(favorites,'등록된 공개 관심 작품이 없습니다.');
          more(favorites,ids.length>limit);
        }
        count(groups[1],ids.length);
      } catch(error) {
        if(!valid())return;failed=true;message(favorites,'관심 작품 목록을 불러오지 못했습니다. 연결 상태를 확인하고 다시 시도해주세요.',retry);
      } finally {if(valid())favorites?.setAttribute('aria-busy','false');}
      if(valid())notice(failed?'일부 서재 목록을 불러오지 못했습니다. 각 목록에서 다시 시도해 주세요.':'서재를 표시했습니다.');
    } catch(error) {
      if(valid()){
        for(const el of [recent,favorites,authors]){message(el,'서재를 불러오지 못했습니다. 연결 상태를 확인하고 다시 시도해주세요.',retry);el?.setAttribute('aria-busy','false');}
        notice('서재를 불러오지 못했습니다. 다시 시도할 수 있습니다.');
      }
    }
  }
  function reset(){
    generation++;renderedLimit=20;
    for(const id of ['libraryContinueList','libraryFavoritesList','libraryCreatorsList','libraryAuthorsList']){
      const el=document.getElementById(id);el?.replaceChildren();el?.setAttribute('aria-busy','false');
    }
    for(const id of ['statReadingCount','statFavoriteCount','statAuthorCount','statCreatorCount'])localized(document.getElementById(id),'—');
    localized(document.getElementById('libraryLoadStatus'),'');
  }
  window.addEventListener?.('reader:localechange', () => {
    if (window.currentActiveView === 'view-mypage' && window.ReaderCatalog?.active()) void render(renderedLimit);
  });
  window.ReaderLibrary=Object.freeze({resolve,latest,render,reset});
})();
