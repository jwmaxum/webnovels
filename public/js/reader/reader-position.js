// Reader location is bound to an authenticated session and an immutable publication.
(function() {
  'use strict';
  const actorId = () => window.WebNovelsAuth?.getActor()?.userId || null;
  const clamp = value => Math.max(0, Math.min(1, value));
  const line = 96;
  let generation = 0, current = null, comments = 0;
  function cleanup() { window._readerScrollCleanup?.(); window._readerScrollCleanup = null; }
  function reset() {
    generation++; comments++; cleanup(); current = null;
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
    if (webtoon && Array.from(body.querySelectorAll('img')).some(img => !img.complete || !img.naturalHeight)) return null;
    const bounds = body.getBoundingClientRect();
    if (!(bounds.height > 0) || !(window.innerHeight > line)) return null;
    const progress = Math.round(clamp((window.innerHeight - bounds.top) / bounds.height) * 100);
    let position;
    if (!webtoon && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(versionId || ''))) {
      const paragraphs = Array.from(body.querySelectorAll('.reader-paragraph'));
      const paragraph = paragraphs.find(item => item.getBoundingClientRect().bottom > line) || paragraphs.at(-1);
      if (paragraph) {
        const rect = paragraph.getBoundingClientRect(), index = Number(paragraph.dataset.paragraphIndex);
        if (Number.isInteger(index) && index >= 0) position = {versionId, paragraphIndex: index,
          offset: Math.round(clamp((line - rect.top) / Math.max(rect.height, 1)) * 10000) / 10000};
      }
    }
    return position ? {progress, position} : {progress};
  }
  function restore(body, position, versionId) {
    if (!position) return 'NONE';
    if (String(position.versionId) !== String(versionId)) return 'VERSION_CHANGED';
    if (!Number.isInteger(position.paragraphIndex) || position.paragraphIndex < 0 ||
        !Number.isFinite(position.offset) || position.offset < 0 || position.offset > 1) return 'UNAVAILABLE';
    const paragraph = Array.from(body?.querySelectorAll('.reader-paragraph') || [])
      .find(item => Number(item.dataset.paragraphIndex) === position.paragraphIndex);
    if (!paragraph) return 'UNAVAILABLE';
    const rect = paragraph.getBoundingClientRect();
    window.scrollTo({top: Math.max(0, window.scrollY + rect.top + rect.height * position.offset - line), behavior: 'instant'});
    return 'RESTORED';
  }
  window.ReaderPosition = Object.freeze({measure, restore});
})();

(function() {
  'use strict';
  let generation = 0;
  const user = () => window.WebNovelsAuth?.getActor()?.userId || null;
  const missing = error => error?.status === 404 || /^(?:NOT_FOUND|PUBLIC_WORK_NOT_FOUND|PUBLIC_EPISODE_NOT_FOUND|WORK_NOT_FOUND|EPISODE_NOT_FOUND)$/.test(error?.code || error?.message || '');
  const node = (tag, text, className) => { const el=document.createElement(tag); if(text!=null)el.textContent=text;if(className)el.className=className;return el; };
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
    const status=node('p',text);status.setAttribute('role','status');container.replaceChildren(status);
    if(retry){const button=node('button','다시 시도','btn btn-outline');button.type='button';button.onclick=retry;container.append(button);}
  }
  async function render(limit=20) {
    const ticket=++generation, account=user();
    const valid=()=>ticket===generation&&account===user();
    const recent=document.getElementById('libraryContinueList'), favorites=document.getElementById('libraryFavoritesList');
    const authors=document.getElementById('libraryCreatorsList')||document.getElementById('libraryAuthorsList');
    const retry=()=>render(limit);
    if(!account||!window.WebNovelsAuth?.getActor()?.reader){for(const el of [recent,favorites,authors])message(el,'독자 로그인 후 이용해주세요.');return;}
    for(const el of [recent,favorites,authors])message(el,'서재를 불러오는 중입니다.');
    try {
      const activity=await window.ReaderHub.activity(true);if(!valid())return;
      const unique=new Set(),history=(activity.readingHistory||[]).filter(item=>{
        if(unique.has(String(item.workId)))return false;unique.add(String(item.workId));return true;
      });
      const entries=[];
      for(let offset=0;offset<Math.min(history.length,limit);offset+=4){
        entries.push(...await Promise.all(history.slice(offset,Math.min(offset+4,limit)).map(resolve)));if(!valid())return;
      }
      const favoriteWorks=[];
      const ids=activity.favorites||[];
      for(let offset=0;offset<Math.min(ids.length,limit);offset+=4){
        favoriteWorks.push(...await Promise.all(ids.slice(offset,Math.min(offset+4,limit)).map(async id=>{
          try{return await window.ReaderCatalog.work(id);}catch(error){if(missing(error))return null;throw error;}
        })));if(!valid())return;
      }
      if(recent){
        recent.replaceChildren();
        for(const entry of entries.filter(Boolean)){
          const {work,item}=entry,pct=Math.max(0,Math.min(100,Math.round(Number(item.progress)||0)));
          const button=node('button',null,'library-row');button.type='button';
          button.append(node('strong',work.title),node('span',`${item.episodeNumber}화 · 현재 회차 ${pct}% · 이어보기`));
          button.onclick=()=>{if(valid())window.openReaderDirect(work.id,item.episodeNumber);};recent.append(button);
        }
        if(!recent.children.length)message(recent,'이어볼 수 있는 공개 회차가 없습니다.');
      }
      if(favorites){
        favorites.replaceChildren();
        for(const work of favoriteWorks.filter(Boolean)){
          const button=node('button',work.title,'library-row');button.type='button';
          button.onclick=()=>{if(valid())window.openWorkDetailDirect(work.id);};favorites.append(button);
        }
        if(!favorites.children.length)message(favorites,'등록된 공개 관심 작품이 없습니다.');
      }
      if(authors){authors.replaceChildren();for(const author of activity.subscriptions||[]){
        const label=node('p',author.name,'library-author-card');authors.append(label);
      }if(!authors.children.length)message(authors,'구독 중인 작가가 없습니다.');}
      for(const [id,count] of [['statReadingCount',history.length],['statFavoriteCount',ids.length],['statCreatorCount',(activity.subscriptions||[]).length]]){
        const el=document.getElementById(id);if(el)el.textContent=String(count);
      }
      if(history.length>limit||ids.length>limit){const more=node('button','서재 더 보기','btn btn-outline');more.type='button';more.onclick=()=>{if(valid())render(limit+20);};recent?.append(more);}
    } catch(error) {if(valid())for(const el of [recent,favorites,authors])message(el,'서재를 불러오지 못했습니다. 연결 상태를 확인하고 다시 시도해주세요.',retry);}
  }
  function reset(){generation++;for(const id of ['libraryContinueList','libraryFavoritesList','libraryCreatorsList','libraryAuthorsList'])document.getElementById(id)?.replaceChildren();}
  window.ReaderLibrary=Object.freeze({resolve,latest,render,reset});
})();
