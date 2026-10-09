/* Classic script order is a compatibility contract. This loader is not authorization. */
(function () {
  'use strict';
  const groups = {
    creator: [
      '/vendor/fflate/fflate-0.8.3.js', '/js/creator/file-codec.js?v=120',
      '/js/creator/file-image.js?v=106', '/js/creator/file-import-queue.js?v=106',
      '/js/creator/draft-engine.js?v=105', '/js/creator/draft-store.js?v=106',
      '/js/creator/draft-diff.js?v=105', '/js/creator/creator-readiness.js?v=117',
      '/js/creator/creator-webtoon.js?v=118', '/js/creator/creator-editor.js?v=117',
      '/js/creator/creator-publications.js?v=117', '/js/creator/creator-files.js?v=114',
      '/js/creator/creator-dashboard.js?v=115', '/js/creator/creator.js?v=115',
      '/js/creator/creator-works.js?v=117', '/js/creator/creator-distribution.js?v=115',
      '/js/creator/creator-operations.js?v=108'
    ],
    admin: [
      '/js/admin/admin.js?v=120', '/js/admin/admin-console.js?v=113',
      '/js/admin/admin-workflow.js?v=117', '/js/admin/admin-operations.js?v=117',
      '/js/admin/virtual-accounts.js?v=111'
    ]
  };
  const files = new Map(), flights = new Map(), loaded = new Set();
  let navigation = 0;
  const actor = () => window.WebNovelsAuth?.getActor();
  const allowed = group => group === 'creator' ? actor()?.author?.status === 'APPROVED' :
    group === 'admin' && !!actor()?.admin;
  const ready = group => loaded.has(group);
  function cancel() { navigation++; }
  function load(src) {
    if (files.has(src)) return files.get(src);
    const script = document.createElement('script');
    script.src = src;
    if (src === "/vendor/fflate/fflate-0.8.3.js") script.integrity = "sha384-ETfVLWAUsU3zp3SpnQsPDbAyrF6jYv2w8aNYo6KtY2JuyxXhzYLOL7e0ATbLSIHP";
    script.async = false;
    const promise = new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = () => {
        files.delete(src);
        script.remove();
        reject(new Error('MODULE_LOAD_FAILED'));
      };
    });
    files.set(src, promise);
    document.head.appendChild(script);
    return promise;
  }
  async function ensure(group) {
    if (!groups[group] || !allowed(group)) throw new Error('MODULE_ROLE_REQUIRED');
    if (ready(group)) return;
    if (!flights.has(group)) {
      const user = actor().userId;
      const flight = (async () => {
        for (const src of groups[group]) {
          if (actor()?.userId !== user || !allowed(group)) throw new Error('MODULE_SESSION_CHANGED');
          await load(src);
        }
        if (actor()?.userId !== user || !allowed(group)) throw new Error('MODULE_SESSION_CHANGED');
        loaded.add(group);
      })();
      flights.set(group, flight);
      flight.finally(() => flights.delete(group)).catch(() => {});
    }
    return flights.get(group);
  }
  function notice(text, retry) {
    const root = document.getElementById('moduleLoadStatus');
    if (!root) return;
    root.replaceChildren();
    root.hidden = !text;
    if (!text) return;
    const message = document.createElement('span');
    message.textContent = text;
    root.append(message);
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-outline btn-sm';
      button.textContent = '다시 불러오기';
      button.onclick = retry;
      root.append(button);
    }
  }
  async function enter(group, resume) {
    const turn = ++navigation, user = actor()?.userId;
    const valid = () => navigation === turn && actor()?.userId === user && allowed(group);
    notice('화면을 불러오고 있습니다.');
    try {
      await ensure(group);
      if (!valid()) return;
      notice('');
      return resume();
    } catch {
      if (valid()) notice('화면을 불러오지 못했습니다. 입력 내용은 보존됩니다.', () => enter(group, resume));
    }
  }
  window.WebNovelsModules = Object.freeze({ ready, allowed, ensure, enter,
    cancel: () => { cancel(); notice(''); } });
})();
