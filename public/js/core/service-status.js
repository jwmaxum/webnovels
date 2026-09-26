// Inform visitors when the deployed backend is unavailable; this is not an authorization gate.
(function () {
  'use strict';
  let flight = null;
  async function refresh() {
    if (flight) return flight;
    const banner = document.getElementById('serviceStatus');
    const message = document.getElementById('serviceStatusMessage');
    const button = document.getElementById('serviceStatusRetry');
    if (!banner || !message) return;
    if (button) button.disabled = true;
    flight = (async () => {
      try {
        const response = await fetch('/api/v2/health', {
          credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(8000)
        });
        const body = response.ok ? await response.json() : null;
        const ready = response.ok && body?.status === 'ok';
        const readerReady = window.WEBNOVELS_CONFIG?.readerServiceEnabled &&
          window.WEBNOVELS_CONFIG?.authorPublishEnabled;
        banner.hidden = !!(ready && readerReady);
        message.textContent = ready
          ? '일부 연재·독자 기능을 준비 중입니다. 이용 가능한 기능은 순차적으로 안내하겠습니다.'
          : '서비스 연결을 준비 중입니다. 로그인·가입·연재 기능은 점검이 끝난 뒤 이용할 수 있습니다.';
        if(!ready){
          const accounts=await fetch('/api/v2/accounts/health',{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(8000)});
          const accountBody=accounts.ok?await accounts.json():null;
          if(accountBody?.status==='ok'&&accountBody.scope==='accounts')
            message.textContent=accountBody.authorWorkspaceReady
              ? '작가는 내 작품 등록·수정과 비공개 원고 저장을 이용할 수 있습니다. 신규 가입·독자 열람은 준비 중입니다.'
              : '등록된 계정으로 로그인할 수 있습니다. 신규 가입과 연재·독자 기능은 준비 중입니다.';
        }
      } catch {
        banner.hidden = false;
        message.textContent = '서비스 연결을 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.';
      } finally { if (button) button.disabled = false; flight = null; }
    })();
    return flight;
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('serviceStatusRetry')?.addEventListener('click', refresh);
    refresh();
  });
  window.WebNovelsServiceStatus = Object.freeze({ refresh });
})();
