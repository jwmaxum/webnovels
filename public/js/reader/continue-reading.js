// This card is rendered only from the latest DB reading-history response.
window.renderContinueReadingHome = async function() {
  const section = document.getElementById('sectionContinueReading');
  if (!section) return;
  section.style.display = 'none';
  if (window.ReaderHub?.active()) {
    if (!window.WebNovelsAuth?.getActor()?.reader) return;
    const user=window.WebNovelsAuth.getActor().userId;
    let history;
    try {history=(await window.ReaderHub.activity()).readingHistory||[];} catch {return;}
    if(window.WebNovelsAuth?.getActor()?.userId!==user)return;
    const works=getPublishedWorks();
    const item=history.find(row=>works.some(w=>String(w.id)===String(row.workId)));
    if(!item)return;
    const work=works.find(w=>String(w.id)===String(item.workId));
    if(!work.episodes.some(ep=>Number(ep.episodeNumber)===Number(item.episodeNumber)))return;
    const progress=Math.max(0,Math.min(100,Number(item.progress)||0));
    document.getElementById('continueCardCover').src=getWorkCover(work);
    document.getElementById('continueCardTitle').textContent=work.title;
    document.getElementById('continueCardMeta').textContent=`${item.episodeNumber}화 읽는 중 · ${work.genre}`;
    document.getElementById('continueCardPct').textContent=`${progress}% 읽음`;
    document.getElementById('continueCardFill').style.width=`${progress}%`;
    document.getElementById('continueReadingCardHome').onclick=()=>openReaderDirect(work.id,item.episodeNumber);
    section.style.display='';
    return;
  }
  if (!localStorage.getItem('webnovels_user')) return;
  let history;
  try { history = JSON.parse(localStorage.getItem('webnovels_reading_history') || '[]'); } catch { return; }
  const works = getPublishedWorks();
  const item = history.find(row => works.some(w => Number(w.id) === Number(row.workId)));
  if (!item) return;
  const work = works.find(w => Number(w.id) === Number(item.workId));
  if (!work.episodes.some(ep => Number(ep.episodeNumber) === Number(item.episodeNumber))) return;
  const progress = Math.max(0, Math.min(100, Number(item.progress) || 0));
  document.getElementById('continueCardCover').src = getWorkCover(work);
  document.getElementById('continueCardTitle').textContent = work.title;
  document.getElementById('continueCardMeta').textContent = `${item.episodeNumber}화 읽는 중 · ${work.genre}`;
  document.getElementById('continueCardPct').textContent = `${progress}% 읽음`;
  document.getElementById('continueCardFill').style.width = `${progress}%`;
  document.getElementById('continueReadingCardHome').onclick = () => openReaderDirect(work.id, item.episodeNumber);
  section.style.display = '';
};
