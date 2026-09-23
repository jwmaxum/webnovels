// Supabase owns credentials; only /api/v2/me establishes application roles.
(function () {
  'use strict';
  let actor = null, refreshFlight = null, initFlight = null, generation = 0;
  let recovery = false, authMutation = false;
  const keys = ['webnovels_token','webnovels_admin_token','webnovels_user','webnovels_author','webnovels_creator','token','authToken',
    'webnovels_reading_history','webnovels_favorites','webnovels_subscribed_authors','webnovels_subscribed_creators'];
  const messages = {
    INVALID_CREDENTIALS: '이메일 또는 비밀번호를 확인해주세요.',
    EMAIL_CONFIRMATION_REQUIRED: '이메일의 확인 링크를 먼저 열어주세요.',
    ACCOUNT_NOT_LINKED: '이메일 확인이 완료되었습니다. 가입 유형과 필명을 입력하여 가입을 마쳐주세요.',
    ACCOUNT_INACTIVE: '이용이 제한된 계정입니다. 운영자에게 문의해주세요.',
    CONFLICT: '기존 계정 연결 또는 가입 정보 확인이 필요합니다. 운영자에게 문의해주세요.',
    RATE_LIMITED: '요청이 많습니다. 잠시 후 다시 시도해주세요.',
    INVALID_SIGNUP: '이메일, 8자 이상 비밀번호, 2~40자 필명을 확인해주세요.',
    AUTH_REQUIRED: '다시 로그인해주세요.', INVALID_SESSION: '세션이 만료되었습니다. 다시 로그인해주세요.',
    ADMIN_FORBIDDEN: '관리자 권한이 없습니다.',
    AUTH_IN_PROGRESS: '인증 요청을 처리 중입니다. 잠시 기다려주세요.'
  };
  function error(code, status, requestId) { return Object.assign(new Error(messages[code] || '인증 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해주세요.'), { code, status, requestId }); }
  function sdk() {
    if (!initSupabaseAdmin() || !supabaseClient?.auth) throw error('AUTH_UNAVAILABLE',503);
    return supabaseClient.auth;
  }
  function clear() {
    window.CreatorDraftEditor?.onAuthLost();
    generation++; actor = null;
    window.CreatorWorks?.reset();
    keys.forEach(k => localStorage.removeItem(k));
    if (typeof isAdminLoggedIn !== 'undefined') isAdminLoggedIn = false;
    if (typeof currentLoggedAuthor !== 'undefined') currentLoggedAuthor = null;
    if (typeof currentLoggedCreator !== 'undefined') currentLoggedCreator = null;
    window.currentLoggedAuthor = window.currentLoggedCreator = null;
    window._isAdultVerified = false;
    if (typeof unlockedEpisodes !== 'undefined') unlockedEpisodes.clear();
    if (typeof userPoints !== 'undefined') userPoints = 0;
    window.userPoints = 0;
    if (typeof SAMPLE_READERS !== 'undefined') SAMPLE_READERS.length = 0;
    if (typeof updateMemberHeader === 'function') updateMemberHeader(null);
  }
  function publish(value) {
    actor = value;
    const profile = value.admin || value.author || value.reader;
    const user = { ...profile, role: value.admin?.role || (value.author ? 'AUTHOR' : 'READER') };
    // Presentation compatibility only. No duplicate access tokens or persisted role authority.
    localStorage.setItem('webnovels_user', JSON.stringify(user));
    if (typeof isAdminLoggedIn !== 'undefined') isAdminLoggedIn = !!value.admin;
    if (typeof currentLoggedAuthor !== 'undefined') currentLoggedAuthor = value.author;
    if (typeof currentLoggedCreator !== 'undefined') currentLoggedCreator = value.author;
    window.currentLoggedAuthor = window.currentLoggedCreator = value.author;
    if (typeof updateMemberHeader === 'function') updateMemberHeader(user);
    return value;
  }
  function providerError(e) {
    if (e?.code === 'email_not_confirmed') return error('EMAIL_CONFIRMATION_REQUIRED',403);
    if (e?.status === 429) return error('RATE_LIMITED',429);
    return error(e?.status >= 500 || !e?.status ? 'AUTH_UNAVAILABLE' : 'INVALID_CREDENTIALS', e?.status || 503);
  }
  async function token() {
    const { data, error: e } = await sdk().getSession();
    if (e) throw providerError(e);
    if (!data.session) { clear(); throw error('AUTH_REQUIRED',401); }
    return data.session.access_token;
  }
  async function api(path, options = {}) {
    if (!/^\/api\/v2\//.test(path) || path.includes('..')) throw error('INVALID_REQUEST',400);
    const epoch = generation;
    const send = async () => fetch(path, { ...options, signal: options.signal || globalThis.AbortSignal?.timeout?.(15000), credentials: 'omit', headers: {
      'Content-Type': 'application/json', ...options.headers, Authorization: 'Bearer ' + await token()
    }});
    let response = await send();
    // One auth refresh only. Never retry network failures or writes with unknown outcomes.
    if (response.status === 401) {
      if (!refreshFlight) refreshFlight = sdk().refreshSession().finally(() => { refreshFlight = null; });
      const refreshed = await refreshFlight;
      if (refreshed.error || !refreshed.data?.session) { clear(); throw error('INVALID_SESSION',401); }
      if (epoch !== generation) throw error('INVALID_SESSION',401);
      response = await send();
    }
    const body = await response.json();
    if (epoch !== generation) throw error('INVALID_SESSION',401);
    if (!response.ok) {
      if ([401,403].includes(response.status)) clear();
      throw error(body.error,response.status,body.requestId || response.headers.get('X-Request-ID'));
    }
    return body;
  }
  async function validate() {
    const epoch = generation;
    try { const result = await api('/api/v2/me'); if (epoch !== generation) throw error('INVALID_SESSION',401); return publish(result); }
    catch(e) { clear(); throw e; }
  }
  async function logout() {
    await window.CreatorDraftEditor?.beforeAccountChange();
    clear(); recovery = false;
    const { error: e } = await sdk().signOut();
    if (e) { await sdk().signOut({ scope: 'local' }); throw providerError(e); }
  }
  async function login(email, password) {
    if (authMutation) throw error('AUTH_IN_PROGRESS',409);
    await window.CreatorDraftEditor?.beforeAccountChange();
    clear();
    authMutation = true;
    try {
      const signedOut = await sdk().signOut({ scope: 'local' });
      if (signedOut.error) throw providerError(signedOut.error);
      const { error: e } = await sdk().signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (e) throw providerError(e);
      return await validate();
    } finally { authMutation = false; }
  }
  function checkName(name) { return typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 40 && !/[<>\x00-\x1f\x7f]/.test(name); }
  async function signup(kind, email, password, displayName) {
    if (!['reader','author'].includes(kind) || !checkName(displayName) || password.length < 8 || !email.includes('@')) throw error('INVALID_SIGNUP',400);
    const readiness = await fetch('/api/v2/auth/readiness', { credentials: 'omit' });
    if (!readiness.ok) throw error('ONBOARDING_NOT_ACTIVATED',503);
    if (authMutation) throw error('AUTH_IN_PROGRESS',409);
    await window.CreatorDraftEditor?.beforeAccountChange();
    clear();
    authMutation = true;
    try {
      const signedOut = await sdk().signOut({ scope: 'local' });
      if (signedOut.error) throw providerError(signedOut.error);
      const { data, error: e } = await sdk().signUp({ email: email.trim().toLowerCase(), password,
        options: { emailRedirectTo: location.origin + '/?auth=confirm' } });
      if (e) throw providerError(e);
      if (data?.session) { await complete(kind,displayName); return '가입이 완료되었습니다.'; }
      return '확인 메일을 확인해주세요. 링크를 연 뒤 로그인하여 가입 유형과 필명을 입력하면 가입을 마칠 수 있습니다.';
    } finally { authMutation = false; }
  }
  async function complete(kind,displayName) {
    const result = await api('/api/v2/onboarding', { method: 'POST', body: JSON.stringify({ kind,displayName }) });
    return publish(result.actor);
  }
  async function reset(email) {
    const { error: e } = await sdk().resetPasswordForEmail(email.trim(), { redirectTo: location.origin + '/?auth=recovery' });
    if (e) throw providerError(e);
  }
  async function changePassword(password) {
    if (!recovery || password.length < 8) throw error('INVALID_SIGNUP',400);
    const { error: e } = await sdk().updateUser({ password });
    if (e) throw providerError(e);
    await logout();
  }
  function init() {
    if (initFlight) return initFlight;
    clear();
    initFlight = (async () => {
      sdk().onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') clear();
        if (!authMutation && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
          if (actor?.userId !== session?.user?.id) clear();
          setTimeout(() => validate().catch(() => {}),0);
        }
        if (event === 'PASSWORD_RECOVERY') { recovery = true; setTimeout(() => window.showAuthRecovery?.(),0); }
        // Do not await SDK methods inside its auth callback.
        if (event === 'TOKEN_REFRESHED') setTimeout(() => validate().catch(() => {}),0);
      });
      try { await validate(); }
      catch(e) { if (e.code === 'ACCOUNT_NOT_LINKED') window.showAuthOnboarding?.(); else if (e.status !== 401) window.showToast?.(e.message); }
    })().catch(e => { clear(); window.showToast?.(messages.AUTH_UNAVAILABLE || '인증 서비스를 사용할 수 없습니다.'); });
    return initFlight;
  }
  window.WebNovelsAuth = { init, api, login, logout, signup, complete, reset, changePassword, validate,
    getActor: () => actor, message: e => e?.message || '인증 요청에 실패했습니다. 잠시 후 다시 시도해주세요.' };
})();
