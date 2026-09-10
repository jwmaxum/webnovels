// ============================================================
// [Creator Safe Writing Editor]
// - IndexedDB first: network failures never block local draft recovery.
// - Optional server sync: only uses a real JWT from the Express API session.
// - Keeps the last 10 local manual/automatic revisions per draft.
// ============================================================
(function () {
  'use strict';

  const DB_NAME = 'webnovels-creator-drafts';
  const STORE_NAME = 'drafts';
  const REVISION_STORE = 'revisions';
  const SAVE_DELAY = 1000;
  const SYNC_INTERVAL = 60_000;
  const MAX_LOCAL_REVISIONS = 10;

  let dbPromise = null;
  let saveTimer = null;
  let syncTimer = null;
  let currentKey = null;
  let serverRevision = null;
  let initialized = false;

  const $ = (id) => document.getElementById(id);

  function openDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('이 브라우저는 안전한 로컬 초안 저장을 지원하지 않습니다.'));
        return;
      }
      const request = window.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(REVISION_STORE)) {
          const revisions = db.createObjectStore(REVISION_STORE, { keyPath: 'id', autoIncrement: true });
          revisions.createIndex('draftKey', 'draftKey', { unique: false });
          revisions.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function dbRequest(storeName, mode, action) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const request = action(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function getAuthorId() {
    for (const key of ['webnovels_creator', 'webnovels_author', 'webnovels_user']) {
      try {
        const value = JSON.parse(localStorage.getItem(key) || 'null');
        if (value) return String(value.creatorId || value.authorId || value.id || value.username || 'local-author');
      } catch (_) {}
    }
    return 'local-author';
  }

  function getIdentity() {
    const workId = String($('newEpWorkSelect')?.value || 'new-work');
    const episodeNumber = Number($('newEpNumber')?.value || 1) || 1;
    return { authorId: getAuthorId(), workId, episodeNumber };
  }

  function makeKey(identity = getIdentity()) {
    return `${identity.authorId}:${identity.workId}:${identity.episodeNumber}`;
  }

  function formData() {
    const identity = getIdentity();
    return {
      key: makeKey(identity),
      ...identity,
      title: $('newEpTitle')?.value || '',
      content: $('newEpContent')?.value || '',
      authorComment: $('newEpAuthorComment')?.value || '',
      serverRevision,
      updatedAt: new Date().toISOString()
    };
  }

  function setStatus(message, kind = '') {
    const status = $('creatorDraftStatus');
    if (!status) return;
    status.textContent = message;
    status.className = `creator-draft-status ${kind}`.trim();
  }

  function updateCounts() {
    const content = $('newEpContent')?.value || '';
    const total = content.length;
    const noWhitespace = content.replace(/\s/g, '').length;
    const paragraphs = content.split(/\n\s*\n/).filter((paragraph) => paragraph.trim()).length;
    const count = $('creatorWordCount');
    const progress = $('creatorWordProgress');
    if (count) count.textContent = `공백 포함 ${total.toLocaleString()}자 · 제외 ${noWhitespace.toLocaleString()}자 · ${paragraphs.toLocaleString()}문단`;
    if (progress) progress.style.width = `${Math.min(100, Math.round((total / 4500) * 100))}%`;
  }

  async function saveLocal({ revision = false } = {}) {
    if (!currentKey) return;
    const draft = formData();
    currentKey = draft.key;
    await dbRequest(STORE_NAME, 'readwrite', (store) => store.put(draft));
    if (revision) await addLocalRevision(draft);
    setStatus('이 기기에 안전하게 저장됨', 'is-saved');
  }

  async function addLocalRevision(draft = formData()) {
    const revision = { draftKey: draft.key, title: draft.title, content: draft.content, authorComment: draft.authorComment, createdAt: new Date().toISOString() };
    await dbRequest(REVISION_STORE, 'readwrite', (store) => store.add(revision));
    const all = await dbRequest(REVISION_STORE, 'readonly', (store) => store.index('draftKey').getAll(draft.key));
    const stale = all.sort((a, b) => b.id - a.id).slice(MAX_LOCAL_REVISIONS);
    for (const item of stale) await dbRequest(REVISION_STORE, 'readwrite', (store) => store.delete(item.id));
  }

  function hasApiSession() {
    const token = localStorage.getItem('webnovels_token') || '';
    return token.split('.').length === 3;
  }

  async function syncServer() {
    if (!currentKey || !navigator.onLine) return;
    const draft = formData();
    setStatus('서버 초안 동기화 중…', 'is-saving');
    try {
      if (window.WebNovelsAdmin?.saveEpisodeDraftToDB && /^\d+$/.test(draft.authorId) && /^\d+$/.test(draft.workId)) {
        const saved = await window.WebNovelsAdmin.saveEpisodeDraftToDB(draft.authorId, draft.workId, draft.episodeNumber, draft);
        if (!saved.success) throw new Error(saved.error || 'Supabase 초안 저장에 실패했습니다.');
        serverRevision = saved.draft.server_revision;
        await saveLocal();
        setStatus(`Supabase 동기화 완료 · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 'is-saved');
        return;
      }
      if (!hasApiSession()) return;
      const token = localStorage.getItem('webnovels_token');
      const response = await fetch(`/api/creator/drafts/${encodeURIComponent(draft.workId)}/${draft.episodeNumber}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: draft.title, content: draft.content, authorComment: draft.authorComment, baseRevision: serverRevision })
      });
      const result = await response.json();
      if (response.status === 409) {
        setStatus('다른 기기에서 수정됨 — 로컬 초안은 보존됨', 'is-error');
        return;
      }
      if (!response.ok) throw new Error(result.error || '서버 저장에 실패했습니다.');
      serverRevision = result.draft.serverRevision;
      await saveLocal();
      setStatus(`서버 동기화 완료 · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 'is-saved');
    } catch (error) {
      console.warn('[Creator draft sync]', error);
      setStatus('오프라인 또는 서버 오류 — 기기에만 저장됨', 'is-error');
    }
  }

  async function fetchServerDraft(identity) {
    if (!navigator.onLine) return null;
    if (window.WebNovelsAdmin?.fetchEpisodeDraftFromDB && /^\d+$/.test(identity.authorId) && /^\d+$/.test(identity.workId)) {
      const draft = await window.WebNovelsAdmin.fetchEpisodeDraftFromDB(identity.authorId, identity.workId, identity.episodeNumber);
      return draft ? { title: draft.title, content: draft.content, authorComment: draft.author_comment, serverRevision: draft.server_revision, updatedAt: draft.updated_at } : null;
    }
    if (!hasApiSession()) return null;
    const token = localStorage.getItem('webnovels_token');
    try {
      const params = new URLSearchParams({ workId: identity.workId, episodeNumber: String(identity.episodeNumber) });
      const response = await fetch(`/api/creator/drafts?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) return null;
      const result = await response.json();
      return result.draft || null;
    } catch (_) {
      return null;
    }
  }

  async function saveSoon() {
    updateCounts();
    setStatus('이 기기에 저장 중…', 'is-saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await saveLocal();
      } catch (error) {
        console.error('[Creator local draft]', error);
        setStatus('초안 저장 실패 — 브라우저 저장공간을 확인해주세요', 'is-error');
      }
    }, SAVE_DELAY);
  }

  function applyDraft(draft) {
    if (!draft) return;
    if ($('newEpTitle')) $('newEpTitle').value = draft.title || '';
    if ($('newEpContent')) $('newEpContent').value = draft.content || '';
    if ($('newEpAuthorComment')) $('newEpAuthorComment').value = draft.authorComment || '';
    serverRevision = draft.serverRevision || null;
    updateCounts();
  }

  async function loadDraft() {
    const nextKey = makeKey();
    if (currentKey === nextKey) return;
    try {
      if (currentKey) await saveLocal();
      currentKey = nextKey;
      serverRevision = null;
      const identity = getIdentity();
      const localDraft = await dbRequest(STORE_NAME, 'readonly', (store) => store.get(currentKey));
      const remoteDraft = await fetchServerDraft(identity);
      const localUpdatedAt = localDraft ? new Date(localDraft.updatedAt).getTime() : 0;
      const remoteUpdatedAt = remoteDraft ? new Date(remoteDraft.updatedAt).getTime() : 0;
      const preferredDraft = remoteUpdatedAt > localUpdatedAt ? remoteDraft : localDraft;
      if (preferredDraft) {
        applyDraft(preferredDraft);
        if (remoteUpdatedAt > localUpdatedAt) {
          await saveLocal();
          setStatus('서버 초안을 복구했습니다', 'is-saved');
        } else {
          setStatus('저장된 로컬 초안을 복구했습니다', 'is-saved');
        }
      } else {
        updateCounts();
        setStatus('새 초안 준비됨');
      }
    } catch (error) {
      console.error('[Creator draft load]', error);
      setStatus('로컬 초안을 불러오지 못했습니다', 'is-error');
    }
  }

  async function restoreLocalRevision() {
    if (!currentKey) return;
    const revisions = await dbRequest(REVISION_STORE, 'readonly', (store) => store.index('draftKey').getAll(currentKey));
    const sorted = revisions.sort((a, b) => b.id - a.id);
    if (!sorted.length) {
      if (window.showToast) showToast('복구할 로컬 버전이 아직 없습니다.');
      return;
    }
    const menu = sorted.map((revision, index) => `${index + 1}. ${new Date(revision.createdAt).toLocaleString()}`).join('\n');
    const chosen = Number(window.prompt(`복구할 버전 번호를 입력하세요.\n${menu}`, '1'));
    if (!Number.isInteger(chosen) || chosen < 1 || chosen > sorted.length) return;
    applyDraft(sorted[chosen - 1]);
    await saveLocal({ revision: true });
    if (window.showToast) showToast('선택한 버전으로 복구했습니다. 현재 원고도 새 버전으로 보관됩니다.');
  }

  async function clearCurrentDraft() {
    if (!currentKey) return;
    const key = currentKey;
    await dbRequest(STORE_NAME, 'readwrite', (store) => store.delete(key));
    currentKey = null;
    serverRevision = null;
    setStatus('발행 완료 — 로컬 초안을 정리했습니다', 'is-saved');
  }

  async function initialize() {
    if (initialized || !$('newEpContent')) return;
    initialized = true;
    const fields = ['newEpTitle', 'newEpContent', 'newEpAuthorComment'];
    fields.forEach((id) => $(id)?.addEventListener('input', saveSoon));
    $('newEpWorkSelect')?.addEventListener('change', loadDraft);
    $('newEpNumber')?.addEventListener('change', loadDraft);
    $('newEpContent')?.addEventListener('blur', () => { saveLocal().then(syncServer); });
    $('btnSaveDraftVersion')?.addEventListener('click', async () => {
      await saveLocal({ revision: true });
      if (window.showToast) showToast('현재 원고를 복구 가능한 버전으로 저장했습니다.');
    });
    $('btnRestoreDraftVersion')?.addEventListener('click', restoreLocalRevision);
    window.addEventListener('online', syncServer);
    syncTimer = window.setInterval(syncServer, SYNC_INTERVAL);
    await loadDraft();
  }

  window.CreatorDraftEditor = { initialize, loadDraft, syncServer, clearCurrentDraft };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
}());
