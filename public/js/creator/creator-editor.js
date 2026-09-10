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

  // ============================================================
  // [Diff Engine] 순수 JS 기반 라인 단위 및 문단 단위 Diff 알고리즘
  // ============================================================
  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function computeLineDiff(oldText, newText) {
    const oldLines = oldText ? oldText.split('\n') : [];
    const newLines = newText ? newText.split('\n') : [];
    const m = oldLines.length;
    const n = newLines.length;

    // Safety fallback for very large texts to avoid O(M*N) memory spikes
    if (m * n > 250000) {
      return oldLines.map((line, i) => ({
        type: line === newLines[i] ? 'same' : 'del',
        text: line,
        oldNum: i + 1,
        newNum: i + 1
      }));
    }

    // Dynamic programming matrix for Longest Common Subsequence (LCS)
    const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        if (oldLines[i] === newLines[j]) {
          dp[i + 1][j + 1] = dp[i][j] + 1;
        } else {
          dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }

    // Backtrack to build diff ops
    const diff = [];
    let i = m;
    let j = n;

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        diff.unshift({ type: 'same', text: oldLines[i - 1], oldNum: i, newNum: j });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        diff.unshift({ type: 'ins', text: newLines[j - 1], oldNum: null, newNum: j });
        j--;
      } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
        diff.unshift({ type: 'del', text: oldLines[i - 1], oldNum: i, newNum: null });
        i--;
      }
    }

    return diff;
  }

  // ============================================================
  // [Version Diff & Restore Modal]
  // ============================================================
  let activeSelectedRevision = null;
  let cachedRevisions = [];

  async function openDiffModal() {
    if (!currentKey) return;
    const revisions = await dbRequest(REVISION_STORE, 'readonly', (store) => store.index('draftKey').getAll(currentKey));
    cachedRevisions = (revisions || []).sort((a, b) => b.id - a.id);

    if (!cachedRevisions.length) {
      if (window.showToast) showToast('비교 및 복구할 저장된 버전이 아직 없습니다. [버전 저장]을 먼저 눌러주세요.');
      return;
    }

    renderRevisionSidebar();
    selectRevisionForDiff(cachedRevisions[0]);
    if (window.openModal) window.openModal('modalDraftDiff');
    else $('modalDraftDiff')?.classList.add('active');
    if (window.lucide?.createIcons) window.lucide.createIcons({ root: $('modalDraftDiff') });
  }

  function renderRevisionSidebar() {
    const listEl = $('diffVersionList');
    if (!listEl) return;

    const currentContent = $('newEpContent')?.value || '';
    const currentTotalChars = currentContent.length;

    listEl.innerHTML = cachedRevisions.map((rev, index) => {
      const date = new Date(rev.createdAt);
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const dateStr = date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
      const revChars = (rev.content || '').length;
      const charDiff = currentTotalChars - revChars;
      const diffBadge = charDiff > 0 ? `+${charDiff.toLocaleString()}자` : charDiff < 0 ? `${charDiff.toLocaleString()}자` : '동일';
      const isSelected = activeSelectedRevision?.id === rev.id;

      return `
        <div class="diff-version-card ${isSelected ? 'active' : ''}" data-revision-id="${rev.id}" onclick="window.CreatorDraftEditor.selectRevision(${rev.id})">
          <div class="diff-card-header">
            <span class="diff-card-num">#${index + 1} 버전</span>
            <span class="diff-card-time">${dateStr} ${timeStr}</span>
          </div>
          <div class="diff-card-title">${escapeHtml(rev.title || '(제목 없음)')}</div>
          <div class="diff-card-meta">
            <span>${revChars.toLocaleString()}자</span>
            <span class="diff-delta-badge ${charDiff > 0 ? 'pos' : charDiff < 0 ? 'neg' : 'zero'}">현재 대비 ${diffBadge}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  function selectRevisionForDiff(revision) {
    if (!revision) return;
    activeSelectedRevision = revision;

    document.querySelectorAll('.diff-version-card').forEach((card) => {
      card.classList.toggle('active', Number(card.dataset.revisionId) === revision.id);
    });

    renderDiffComparison(revision);
    const restoreBtn = $('btnConfirmRestoreRevision');
    if (restoreBtn) restoreBtn.disabled = false;
  }

  function renderDiffComparison(rev) {
    const headerEl = $('diffPreviewHeader');
    const containerEl = $('diffSectionsContainer');
    if (!containerEl) return;

    const currentTitle = $('newEpTitle')?.value || '';
    const currentContent = $('newEpContent')?.value || '';
    const currentComment = $('newEpAuthorComment')?.value || '';

    const revDate = new Date(rev.createdAt).toLocaleString();
    const currentChars = currentContent.length;
    const revChars = (rev.content || '').length;

    if (headerEl) {
      headerEl.innerHTML = `
        <div class="diff-header-grid">
          <div class="diff-col-box old">
            <span class="badge-tag">선택 버전 (${revDate})</span>
            <strong>${escapeHtml(rev.title || '(무제)')}</strong>
            <small class="text-muted">본문 ${revChars.toLocaleString()}자</small>
          </div>
          <div class="diff-col-arrow"><i data-lucide="arrow-right"></i></div>
          <div class="diff-col-box new">
            <span class="badge-tag curr">현재 에디터 원고</span>
            <strong>${escapeHtml(currentTitle || '(무제)')}</strong>
            <small class="text-muted">본문 ${currentChars.toLocaleString()}자</small>
          </div>
        </div>
      `;
    }

    const titleChanged = (rev.title || '') !== currentTitle;
    const commentChanged = (rev.authorComment || '') !== currentComment;
    const contentDiff = computeLineDiff(rev.content || '', currentContent);

    const addedLines = contentDiff.filter(d => d.type === 'ins').length;
    const deletedLines = contentDiff.filter(d => d.type === 'del').length;
    const sameLines = contentDiff.filter(d => d.type === 'same').length;

    let metaDiffHtml = '';
    if (titleChanged || commentChanged) {
      metaDiffHtml = `
        <div class="diff-meta-box">
          ${titleChanged ? `
            <div class="diff-meta-row">
              <span class="diff-meta-label">제목 변경:</span>
              <del class="diff-del-inline">${escapeHtml(rev.title || '(제목 없음)')}</del>
              <i data-lucide="chevrons-right" style="width:14px;height:14px;vertical-align:middle;"></i>
              <ins class="diff-ins-inline">${escapeHtml(currentTitle || '(제목 없음)')}</ins>
            </div>
          ` : ''}
          ${commentChanged ? `
            <div class="diff-meta-row">
              <span class="diff-meta-label">작가의 말:</span>
              <del class="diff-del-inline">${escapeHtml(rev.authorComment || '(작가의 말 없음)')}</del>
              <i data-lucide="chevrons-right" style="width:14px;height:14px;vertical-align:middle;"></i>
              <ins class="diff-ins-inline">${escapeHtml(currentComment || '(작가의 말 없음)')}</ins>
            </div>
          ` : ''}
        </div>
      `;
    }

    const summaryHtml = `
      <div class="diff-stat-bar">
        <span>본문 줄 비교:</span>
        <span class="diff-badge ins">+${addedLines}줄 추가됨</span>
        <span class="diff-badge del">-${deletedLines}줄 삭제됨</span>
        <span class="text-muted">${sameLines}줄 일치</span>
      </div>
    `;

    const linesHtml = contentDiff.map((d) => {
      const prefix = d.type === 'ins' ? '+' : d.type === 'del' ? '-' : ' ';
      const lineNum = d.type === 'del' ? (d.oldNum || '') : (d.newNum || '');
      return `
        <div class="diff-line-row diff-type-${d.type}">
          <span class="diff-line-num">${lineNum}</span>
          <span class="diff-line-prefix">${prefix}</span>
          <span class="diff-line-content">${escapeHtml(d.text) || '&nbsp;'}</span>
        </div>
      `;
    }).join('');

    containerEl.innerHTML = `
      ${metaDiffHtml}
      ${summaryHtml}
      <div class="diff-code-wrapper">
        <div class="diff-lines-container">${linesHtml}</div>
      </div>
    `;

    if (window.lucide?.createIcons) window.lucide.createIcons({ root: containerEl });
  }

  async function confirmRestoreRevision() {
    if (!activeSelectedRevision) return;
    const targetRev = activeSelectedRevision;

    // 1. 복구 직전 현재 원고를 안전하게 새 버전으로 자동 백업
    const current = formData();
    if (current.content || current.title) {
      await addLocalRevision({
        ...current,
        title: current.title || '복구 직전 원고 백업'
      });
    }

    // 2. 선택된 버전 복구 적용
    applyDraft({
      title: targetRev.title,
      content: targetRev.content,
      authorComment: targetRev.authorComment,
      serverRevision
    });

    // 3. 로컬 DB 갱신
    await saveLocal({ revision: false });

    // 4. 모달 닫기 및 피드백
    if (window.closeModal) window.closeModal('modalDraftDiff');
    else $('modalDraftDiff')?.classList.remove('active');

    if (window.showToast) {
      showToast('선택한 버전으로 안전하게 복구되었습니다. (복구 직전 원고도 새 버전으로 백업됨)');
    }
  }

  // ============================================================
  // [Formatting Tools] 웹소설 전문 서식 정규화 도구
  // ============================================================

  // 1. 들여쓰기 정돈: 대화문("...") 외 일반 서술 문단 첫머리에 공백(2칸) 일괄 정돈
  function formatIndentation() {
    const textarea = $('newEpContent');
    if (!textarea) return;
    const content = textarea.value;
    if (!content.trim()) return;

    // 복구 대비 백업
    addLocalRevision(formData());

    const quoteChars = ['"', '“', '‘', "'", '(', '[', '<', '「', '『'];
    const lines = content.split('\n');
    let modified = 0;

    const formatted = lines.map((line) => {
      const trimmed = line.trimStart();
      if (!trimmed) return ''; // 빈 줄 유지

      const isQuote = quoteChars.some(q => trimmed.startsWith(q));
      if (isQuote) {
        // 대화문은 들여쓰기 없이 깔끔하게 유지
        return trimmed;
      } else {
        // 서술문은 2칸 들여쓰기 표준화
        modified++;
        return '  ' + trimmed;
      }
    });

    textarea.value = formatted.join('\n');
    saveSoon();
    if (window.showToast) showToast(`각 서술 문단(${modified}건)의 첫머리 들여쓰기를 정돈했습니다.`);
  }

  // 2. 대화문 정돈: 대화문 앞뒤 빈 줄 및 줄바꿈 구조화
  function formatDialogue() {
    const textarea = $('newEpContent');
    if (!textarea) return;
    const content = textarea.value;
    if (!content.trim()) return;

    // 복구 대비 백업
    addLocalRevision(formData());

    const lines = content.split('\n');
    const quoteChars = ['"', '“', '‘', "'", '「', '『'];
    const result = [];

    for (let i = 0; i < lines.length; i++) {
      const current = lines[i].trim();
      if (!current) {
        result.push('');
        continue;
      }

      const isDialogue = quoteChars.some(q => current.startsWith(q));
      const prevLine = result.length > 0 ? result[result.length - 1] : null;

      // 이전 줄이 일반 서술문이고 이번 줄이 대화문이면 1줄 띄우기
      if (isDialogue && prevLine && prevLine.trim() !== '') {
        result.push('');
      }

      result.push(current);
    }

    textarea.value = result.join('\n');
    saveSoon();
    if (window.showToast) showToast('대화문과 서술문의 줄바꿈 간격을 보기 쉽게 정돈했습니다.');
  }

  // 3. 다중 빈 줄 및 불필요한 공백 정리
  function formatCleanSpacing() {
    const textarea = $('newEpContent');
    if (!textarea) return;
    const content = textarea.value;
    if (!content.trim()) return;

    // 복구 대비 백업
    addLocalRevision(formData());

    let cleaned = content
      // 3개 이상의 연속된 줄바꿈을 2개로 축소
      .replace(/\n{3,}/g, '\n\n')
      // 각 라인의 끝부분 공백(trailing space) 제거
      .split('\n')
      .map(line => line.trimEnd())
      .join('\n')
      // 탭 문자를 스페이스 2칸으로 표준화
      .replace(/\t/g, '  ');

    textarea.value = cleaned;
    saveSoon();
    if (window.showToast) showToast('다중 빈 줄 및 불필요한 줄끝 공백을 깔끔하게 정리했습니다.');
  }

  // ============================================================
  // [Mobile & Viewport Optimization]
  // ============================================================
  function setupMobileViewportHandling() {
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        const textarea = $('newEpContent');
        if (document.activeElement === textarea) {
          // 키보드가 올라왔을 때 커서 위치로 부드럽게 스크롤
          textarea.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      });
    }

    // 미저장 변경사항이 있을 때만 브라우저 이탈 방지 경고
    window.addEventListener('beforeunload', (e) => {
      const statusEl = $('creatorDraftStatus');
      if (statusEl && statusEl.classList.contains('is-saving')) {
        e.preventDefault();
        e.returnValue = '원고가 아직 기기 또는 서버에 저장 중입니다. 페이지를 벗어나시겠습니까?';
        return e.returnValue;
      }
    });
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

    // 버전 저장 및 복구
    $('btnSaveDraftVersion')?.addEventListener('click', async () => {
      await saveLocal({ revision: true });
      if (window.showToast) showToast('현재 원고를 복구 가능한 버전으로 저장했습니다.');
    });
    $('btnRestoreDraftVersion')?.addEventListener('click', openDiffModal);
    $('btnConfirmRestoreRevision')?.addEventListener('click', confirmRestoreRevision);

    // 웹소설 서식 정규화 버튼 이벤트
    $('btnFormatIndent')?.addEventListener('click', formatIndentation);
    $('btnFormatDialogue')?.addEventListener('click', formatDialogue);
    $('btnFormatClean')?.addEventListener('click', formatCleanSpacing);

    // 모바일 뷰포트 핸들링
    setupMobileViewportHandling();

    window.addEventListener('online', syncServer);
    syncTimer = window.setInterval(syncServer, SYNC_INTERVAL);
    await loadDraft();
  }

  window.CreatorDraftEditor = {
    initialize,
    loadDraft,
    syncServer,
    clearCurrentDraft,
    openDiffModal,
    selectRevision: (id) => {
      const rev = cachedRevisions.find(r => r.id === id);
      if (rev) selectRevisionForDiff(rev);
    },
    formatIndentation,
    formatDialogue,
    formatCleanSpacing
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
}());

