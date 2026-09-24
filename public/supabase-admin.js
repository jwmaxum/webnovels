// ============================================================
// WebNovels Production v1 DB 연동 모듈 (Single Source of Truth)
// 스키마: WebNovels_Production_v1.sql & 실제 Supabase DB 데이터 100% 호환
// ============================================================

const SUPABASE_URL = window.WEBNOVELS_CONFIG?.supabaseUrl;
const SUPABASE_ANON_KEY = window.WEBNOVELS_CONFIG?.supabaseAnonKey;

let supabaseClient = null;
let currentAdmin = null;
let currentAuthUser = null;

// window.WebNovelsAdmin 즉시 선언
window.WebNovelsAdmin = window.WebNovelsAdmin || {};

// ---- Supabase 클라이언트 초기화 ----
function initSupabaseAdmin() {
  if (supabaseClient) return true;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('[WebNovels] Supabase 공개 연결 설정을 불러오지 못했습니다.');
    return false;
  }
  if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
    try {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      console.log('⚡ [WebNovels Admin] Production Supabase v1 클라이언트 초기화 완료');
      return true;
    } catch(e) {
      console.warn('[WebNovels Admin] Supabase createClient 에러:', e);
    }
  }
  return false;
}

initSupabaseAdmin();
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', initSupabaseAdmin);
}

// ============================================================
// 01. AUTH (Supabase Auth & DB 계정 인증 지원)
// ============================================================

// Compatibility adapters; all roles come from the current server actor.
async function loginForRole(email, password, role) {
  try {
    if (!window.WebNovelsAuth) return { success: false, error: '인증 모듈을 사용할 수 없습니다.' };
    const actor = await window.WebNovelsAuth.login(email, password);
    if (!actor[role]) { await window.WebNovelsAuth.logout(); return { success: false, error: '해당 계정 권한이 없습니다.' }; }
    return { success: true, [role]: actor[role] };
  } catch (error) { return { success: false, error: error.message }; }
}
async function adminLogin(email, password) { return loginForRole(email,password,'admin'); }
async function readerLogin(email, password) { return loginForRole(email,password,'reader'); }
async function authorLogin(email, password) { return loginForRole(email,password,'author'); }
function adminLogout() { currentAdmin = null; currentAuthUser = null; return window.WebNovelsAuth?.logout(); }
function getCurrentAdmin() { return window.WebNovelsAuth?.getActor()?.admin || null; }

// [Fetch Readers & Authors for Admin CMS]
async function fetchReadersFromSupabase() {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('readers')
      .select('id,username,nickname,email,status,created_at')
      .order('id', { ascending: true });
    if (!error && data) return data;
    return [];
  } catch (e) {
    return [];
  }
}

async function fetchAuthorsFromSupabase() {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('authors')
      .select('id, username, pen_name, profile_image, bio, status')
      .order('id', { ascending: true });
    if (!error && data) return data;
    return [];
  } catch (e) {
    return [];
  }
}

// ============================================================
// 02. DASHBOARD KPI (Single Truth Counts & Ledger Aggregation)
// ============================================================
async function fetchDashboardKPI() {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return null;

  try {
    const tables = ['readers', 'authors', 'works', 'episodes'];
    const results = await Promise.all(tables.map(table =>
      supabaseClient.from(table).select('*', { count: 'exact', head: true })
    ));
    if (results.some(result => result.error || typeof result.count !== 'number')) {
      throw new Error('Dashboard counts unavailable');
    }
    return {
      total_users: results[0].count,
      total_authors: results[1].count,
      total_works: results[2].count,
      total_episodes: results[3].count
    };
  } catch (err) {
    console.error('[Dashboard KPI] load failed:', err);
    return null;
  }
}

// ============================================================
// // 02-B. EPISODES SUMMARY STATS (실시간 회차 통계 집계)
// ============================================================
async function fetchEpisodeSummaryStats() {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return null;

  try {
    const [allRes, pubRes, schedRes, draftRes] = await Promise.all([
      supabaseClient.from('episodes').select('*', { count: 'exact', head: true }),
      supabaseClient.from('episodes').select('*', { count: 'exact', head: true }).or('status.eq.PUBLISHED,status.is.null'),
      supabaseClient.from('episodes').select('*', { count: 'exact', head: true }).eq('status', 'SCHEDULED'),
      supabaseClient.from('episodes').select('*', { count: 'exact', head: true }).eq('status', 'DRAFT')
    ]);

    return {
      total: allRes.count ?? 0,
      published: pubRes.count ?? 0,
      scheduled: schedRes.count ?? 0,
      draft: draftRes.count ?? 0
    };
  } catch (err) {
    console.error('[WebNovelsAdmin] fetchEpisodeSummaryStats Error:', err);
    return null;
  }
}

// ============================================================
// 03. WORKS & EPISODES (실제 DB 30개 작품 완벽 로드)
// ============================================================

// [Fetch Works with Authors & Episode Metadata]
async function fetchWorksFromSupabase() {
  try {
    let works, authors=[], episodes;
    if (window.WEBNOVELS_CONFIG?.readerServiceEnabled) {
      const response=await fetch('/api/v2/catalog',{credentials:'omit'});
      if(!response.ok)throw Error('PUBLIC_CATALOG_UNAVAILABLE');
      const catalog=await response.json();
      works=catalog.works;episodes=catalog.episodes;
    } else {
      if (!supabaseClient) initSupabaseAdmin();
      if (!supabaseClient) return null;
      const publicationSafeFields = 'id,title,author,author_id,genre,tags,description,cover_image,view_count,like_count,created_at,status,is_top_recommended,is_popular_work,is_new_work,content_type,is_completed,rating,ai_usage_type,published_at';
      const workResult = await supabaseClient.from('works')
        .select(publicationSafeFields)
        .order('id', { ascending: true });
      if (workResult.error) throw workResult.error;
      works=workResult.data;
      const authorResult=await supabaseClient.from('authors').select('id, pen_name, username');
      authors=authorResult.data||[];
      const episodeResult=await supabaseClient.from('episodes')
        .select('id, work_id, episode_number, title, access_policy, author_comment, status, view_count, is_free, is_ad_free, scheduled_at')
        .order('episode_number', { ascending: true });
      if (episodeResult.error) throw episodeResult.error;
      episodes=episodeResult.data;
    }
    if (!works?.length) return [];
    const authorMap = {};
    if (authors) {
      authors.forEach(a => {
        authorMap[a.id] = a.pen_name || a.username;
      });
    }

    // 3. episodes 메타데이터 조회
    const epMap = {};
    if (episodes) {
      episodes.forEach(ep => {
        if (!epMap[ep.work_id]) epMap[ep.work_id] = [];
        const isFree = ep.is_free === true && ep.access_policy === 'FREE';
        epMap[ep.work_id].push({
          id: ep.id,
          episodeNumber: Number(ep.episode_number),
          title: ep.title,
          accessPolicy: ep.access_policy || (isFree ? 'FREE' : 'REWARDED_AD'),
          isFree: isFree,
          isAdFree: !isFree,
          scheduledAt: ep.scheduled_at,
          authorComment: ep.author_comment || '',
          status: ep.status || 'PUBLISHED',
          viewCount: Number(ep.view_count || 0)
        });
      });
    }

    return works.map(w => {
      const isAdult = w.rating === 'AGE_19' || w.genre === '성인' || (Array.isArray(w.genre) && (w.genre.includes('성인') || w.genre.includes('19세 이상')));
      const mainGenre = Array.isArray(w.genre) && w.genre.length > 0 ? w.genre[0] : (w.genre || '판타지');
      const coverUrl = w.cover_image 
        ? (w.cover_image.startsWith('/') || w.cover_image.startsWith('http') ? w.cover_image : `/images/${w.cover_image}`)
        : '/images/stormqueen_oath.jpg';
      const publicCoverUrl = window.WEBNOVELS_CONFIG?.readerServiceEnabled &&
        (!/^(\/(?!\/)|https:\/\/)/.test(coverUrl) || /[<>"'`()\\;\s]/.test(coverUrl))
        ? '/images/stormqueen_oath.jpg' : coverUrl;

      const resolvedAuthorName = w.author || (w.author_id && authorMap[w.author_id]) || '작가 정보 없음';

      const resolvedEpisodes = epMap[w.id] || [];

      return {
        id: window.WEBNOVELS_CONFIG?.readerServiceEnabled ? String(w.id) : Number(w.id),
        authorId: w.author_id ? (window.WEBNOVELS_CONFIG?.readerServiceEnabled ? String(w.author_id) : Number(w.author_id)) : null,
        title: w.title,
        author: resolvedAuthorName,
        contentType: w.content_type || 'NOVEL',
        genre: mainGenre,
        createdAt: w.created_at,
        aiUsageType: w.ai_usage_type || 'NONE',
        tags: Array.isArray(w.tags) ? w.tags.join(', ') : (w.tags || '신작'),
        description: w.description || '',
        coverUrl: publicCoverUrl,
        viewCount: Number(w.view_count || 0),
        likeCount: Number(w.like_count || 0),
        status: w.status || 'ONGOING',
        isCompleted: !!w.is_completed,
        isTopRecommended: !!w.is_top_recommended,
        isPopularWork: !!w.is_popular_work,
        isNewWork: !!w.is_new_work,
        rating: isAdult ? 'AGE_19' : (w.rating || 'ALL'),
        episodes: resolvedEpisodes
      };
    });
  } catch (err) {
    console.error('[fetchWorksFromSupabase Error]', err);
    throw err;
  }
}

// [Fetch Episodes By Work ID with Full Metadata]
async function fetchEpisodesByWorkId(workId) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return [];

  try {
    const { data, error } = await supabaseClient
      .from('episodes')
      .select('id, work_id, episode_number, title, access_policy, author_comment, status, scheduled_at, view_count, is_free, is_ad_free, created_at')
      .eq('work_id', Number(workId))
      .order('episode_number', { ascending: true });

    if (error) {
      console.warn('[fetchEpisodesByWorkId] 조회 에러:', error);
      return [];
    }

    return (data || []).map(ep => ({
      id: ep.id,
      workId: ep.work_id,
      episodeNumber: ep.episode_number,
      title: ep.title,
      isFree: ep.is_free,
      isAdFree: ep.is_ad_free,
      status: ep.status || 'PUBLISHED',
      scheduledAt: ep.scheduled_at,
      viewCount: Number(ep.view_count || 0),
      views: Number(ep.view_count || 0),
      content: ep.content,
      imageUrls: Array.isArray(ep.image_urls) ? ep.image_urls : (ep.image_urls ? [ep.image_urls] : []),
      authorComment: ep.author_comment || '',
      createdAt: ep.created_at
    }));
  } catch (err) {
    console.error('[fetchEpisodesByWorkId Error]', err);
    return [];
  }
}

// [Fetch Publishing Calendar Events from Supabase]
async function fetchPublishingCalendarEvents(year = new Date().getFullYear(), month = new Date().getMonth() + 1) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return {};

  try {
    const { data, error } = await supabaseClient
      .from('episodes')
      .select('id, scheduled_at, created_at, status, episode_number, title, work_id');

    if (error || !data) {
      console.warn('[fetchPublishingCalendarEvents] 에러:', error);
      return {};
    }

    const eventMap = {};
    data.forEach(ep => {
      const dateStr = ep.scheduled_at || ep.created_at;
      if (!dateStr) return;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return;
      if (d.getFullYear() === Number(year) && (d.getMonth() + 1) === Number(month)) {
        const day = d.getDate();
        if (!eventMap[day]) {
          eventMap[day] = { published: 0, scheduled: 0, total: 0, items: [] };
        }
        if (ep.status === 'SCHEDULED') {
          eventMap[day].scheduled++;
        } else {
          eventMap[day].published++;
        }
        eventMap[day].total++;
        eventMap[day].items.push(ep);
      }
    });

    return eventMap;
  } catch (err) {
    console.error('[fetchPublishingCalendarEvents Error]', err);
    return {};
  }
}

// [Fetch Work Series Dashboard Live Analytics]
async function fetchWorkSeriesDashboardData(workId) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return null;

  try {
    const id = Number(workId);
    // 1. work detail
    const { data: work, error: wErr } = await supabaseClient
      .from('works')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (wErr || !work) {
      console.warn('[fetchWorkSeriesDashboardData] 작품 없음:', wErr);
      return null;
    }

    // 2. episodes list
    const { data: episodes } = await supabaseClient
      .from('episodes')
      .select('id, episode_number, title, status, created_at, scheduled_at, view_count')
      .eq('work_id', id)
      .order('episode_number', { ascending: true });

    const epList = episodes || [];
    const epCount = epList.length;

    // 3. favorites count
    const { count: favCount } = await supabaseClient
      .from('favorites')
      .select('*', { count: 'exact', head: true })
      .eq('work_id', id);

    // 4. author earnings/settlements
    let totalRevenue = 0;
    if (work.author_id) {
      const { data: earnings } = await supabaseClient
        .from('author_earnings')
        .select('total_earnings')
        .eq('author_id', work.author_id);
      if (earnings && earnings.length > 0) {
        totalRevenue = earnings.reduce((sum, r) => sum + (Number(r.total_earnings) || 0), 0);
      }
    }

    // 5. Health score dynamic calculation
    const isCompleted = work.status === 'COMPLETED' || work.is_completed;
    const scoreSchedule = isCompleted ? 100 : (epCount >= 5 ? 95 : 85);
    const scoreTraffic = Math.min(95, Math.max(60, Math.round(Number(work.view_count || 0) * 1.5 + 50)));
    const scoreRetention = epCount > 1 ? Math.min(95, Math.max(70, Math.round(85 + (Number(favCount || 0) * 3)))) : 80;
    const scoreStock = epCount >= 6 ? 90 : (epCount >= 3 ? 80 : 70);
    const healthScore = Math.round((scoreSchedule + scoreTraffic + scoreRetention + scoreStock) / 4);

    // 6. Latest & Next Schedule text
    const latestEp = epList.length > 0 ? epList[epList.length - 1] : null;
    let latestPubText = '-';
    if (latestEp) {
      const d = new Date(latestEp.scheduled_at || latestEp.created_at);
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      latestPubText = `${m}/${day} (제 ${latestEp.episode_number}화) - 정상 완료`;
    }

    let nextPubText = '-';
    if (isCompleted) {
      nextPubText = '완결 (연재 종료)';
    } else {
      const scheduledEp = epList.find(e => e.status === 'SCHEDULED');
      if (scheduledEp) {
        const d = new Date(scheduledEp.scheduled_at || scheduledEp.created_at);
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        nextPubText = `${m}/${day} (제 ${scheduledEp.episode_number}화) - 예약 대기`;
      } else {
        nextPubText = `제 ${epCount + 1}화 차주 연재 준비중`;
      }
    }

    return {
      work,
      epCount,
      viewTotal: Number(work.view_count || 0),
      fansCount: Number(favCount || 0) + Number(work.like_count || 0),
      totalRevenue,
      healthScore,
      scoreSchedule,
      scoreTraffic,
      scoreRetention,
      scoreStock,
      latestPubText,
      nextPubText
    };
  } catch (err) {
    console.error('[fetchWorkSeriesDashboardData Error]', err);
    return null;
  }
}

// [Fetch Episode Protected Content on Demand]
async function fetchEpisodeContentSecure(episodeId) {
  const id = String(episodeId || '');
  if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) return null;
  const path = '/api/v2/episodes/' + encodeURIComponent(id) + '/content';
  try {
    let result;
    if (window.WebNovelsAuth?.getActor()) result = await window.WebNovelsAuth.api(path);
    else {
      const response = await fetch(path, { credentials: 'omit' });
      if (!response.ok) return null;
      result = await response.json();
    }
    if (!result?.episode) return null;
    return { textContent: result.episode.content || '', imageUrls: result.episode.image_urls || [] };
  } catch { return null; }
}

// [Record View Count with Atomic Increment]
async function recordWorkReadingView(workId, episodeNumber) {
  if (!supabaseClient || !workId) return;

  try {
    // 1. Supabase RPC increment_work_view 원자적 호출
    try {
      await supabaseClient.rpc('increment_work_view', { p_work_id: Number(workId) });
    } catch (e) {}

    // 2. episodes view_count 증가
    if (episodeNumber) {
      const { data: epData } = await supabaseClient
        .from('episodes')
        .select('view_count')
        .eq('work_id', Number(workId))
        .eq('episode_number', Number(episodeNumber))
        .single();

      if (epData) {
        await supabaseClient
          .from('episodes')
          .update({ view_count: (Number(epData.view_count) || 0) + 1 })
          .eq('work_id', Number(workId))
          .eq('episode_number', Number(episodeNumber));
      }
    }
  } catch (e) {
    console.warn('[recordWorkReadingView Warning]', e.message);
  }
}

// ============================================================
// 04. AD EVENTS & EPISODE UNLOCKS
// ============================================================

// [Log Ad Event]
async function logAdEvent(userId, workId, episodeId, eventType = 'COMPLETE', adNetwork = 'ADMOB', revenue = 20) {
  // An ad event must come from a verified server callback, never the browser.
  return null;
}

// [Record Episode Unlock with source_event_id & 72h Expiration]
async function recordEpisodeUnlock(userId, episodeId, unlockType = 'REWARDED_AD', sourceEventId = null) {
  return { success: false, error: 'MONETIZATION_NOT_ACTIVATED' };
}

// [Unlock Episode with Ad Verification]
async function unlockEpisodeWithAdSecure(userId, workId, episodeId) {
  return { success: false, error: 'MONETIZATION_NOT_ACTIVATED' };
}

// ============================================================
// 05. REVENUE & SETTLEMENTS
// ============================================================

async function fetchAuthorEarnings() { return []; }

async function fetchAuthorSettlements() { return []; }

async function fetchAuthorRevenueSummary() { return null; }

async function requestSettlementSecure(authorId, amount, bankInfo = null) {
  return { success: false, error: 'MONETIZATION_NOT_ACTIVATED' };
}

// ============================================================
// 06. READER ACTIVITIES (Supabase DB 실시간 동기화)
// ============================================================

async function findReaderProfile(identifier) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) throw new Error('DB 연결이 필요합니다.');
  let query = supabaseClient.from('readers').select('id, username, nickname, points, is_adult_verified');
  const key = String(identifier).trim();
  query = /^\d+$/.test(key) ? query.eq('id', Number(key)) : key.includes('@') ? query.eq('email', key) : query.eq('username', key);
  const { data, error } = await query.single();
  if (error) throw error;
  return data;
}

async function fetchReaderActivity(identifier) {
  if (!identifier) return null;
  const reader = await findReaderProfile(identifier);
  const key = reader.username || String(reader.id);
  const [favs, subs, history] = await Promise.all([
    supabaseClient.from('favorites').select('work_id').eq('user_id', key),
    supabaseClient.from('author_subscriptions').select('author_name').eq('user_id', key),
    supabaseClient.from('reading_history').select('work_id, episode_id, progress, last_read_at').eq('user_id', key).order('last_read_at', { ascending: false })
  ]);
  for (const result of [favs, subs, history]) if (result.error) throw result.error;
  const ids = [...new Set(history.data.map(r => r.episode_id).filter(Boolean))];
  const episodes = ids.length ? await supabaseClient.from('episodes').select('id, work_id, episode_number').in('id', ids) : { data: [] };
  if (episodes.error) throw episodes.error;
  return {
    favorites: favs.data.map(r => Number(r.work_id)),
    subscribedAuthors: subs.data.map(r => r.author_name).filter(Boolean),
    readingHistory: history.data.flatMap(r => {
      const ep = episodes.data.find(e => Number(e.id) === Number(r.episode_id) && Number(e.work_id) === Number(r.work_id));
      return ep ? [{ workId: Number(r.work_id), episodeNumber: ep.episode_number, progress: r.progress, updatedAt: r.last_read_at }] : [];
    }),
    nickname: reader.nickname, points: Number(reader.points || 0), isAdultVerified: !!reader.is_adult_verified
  };
}

async function updateReaderActivity(identifier, activityData) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || !identifier || !activityData) return { success: false };
  try {
    const cleanId = String(identifier).trim();
    
    // 대상 독자 레코드 식별
    let findQuery = supabaseClient.from('readers').select('id, username');
    if (!isNaN(cleanId) && Number(cleanId) > 0) {
      findQuery = findQuery.or(`id.eq.${Number(cleanId)},username.ilike.${cleanId},email.ilike.${cleanId}`);
    } else {
      findQuery = findQuery.or(`username.ilike.${cleanId},email.ilike.${cleanId}`);
    }
    const { data: rows } = await findQuery;
    if (!rows || rows.length === 0) return { success: false, error: 'User not found' };
    const reader = rows[0];
    const targetId = reader.id;
    const userKey = reader.username || String(reader.id);

    // 1. readers 테이블 JSONB 컬럼 업데이트
    const updatePayload = {};
    if (activityData.readingHistory !== undefined) updatePayload.reading_history = activityData.readingHistory;
    if (activityData.favorites !== undefined) updatePayload.favorites = activityData.favorites;
    const subsToUpdate = activityData.subscribedCreators !== undefined ? activityData.subscribedCreators : activityData.subscribedAuthors;
    if (subsToUpdate !== undefined) updatePayload.subscribed_authors = subsToUpdate;
    if (activityData.isAdultVerified !== undefined) updatePayload.is_adult_verified = !!activityData.isAdultVerified;
    if (activityData.nickname !== undefined) updatePayload.nickname = activityData.nickname;

    const { error } = await supabaseClient.from('readers').update(updatePayload).eq('id', targetId);
    if (error) {
      console.warn('[updateReaderActivity Error]', error);
      return { success: false, error: error.message };
    }

    // 2. 독립 테이블(Dual Persistence)에도 백그라운드 동기화
    try {
      if (Array.isArray(activityData.favorites)) {
        for (const wId of activityData.favorites) {
          const numId = Number(wId);
          if (!isNaN(numId) && numId > 0) {
            await supabaseClient.from('favorites').upsert({
              user_id: userKey,
              work_id: numId
            }, { onConflict: 'user_id,work_id' }).catch(() => {});
          }
        }
      }

      if (Array.isArray(activityData.readingHistory)) {
        for (const h of activityData.readingHistory) {
          const numId = Number(h.workId);
          const epNum = Number(h.episodeNumber || h.episodeId || 1);
          if (!isNaN(numId) && numId > 0) {
            await supabaseClient.from('reading_history').upsert({
              user_id: userKey,
              work_id: numId,
              episode_id: epNum,
              progress: Number(h.progress) || 100,
              last_read_at: h.updatedAt || new Date().toISOString()
            }, { onConflict: 'user_id,work_id' }).catch(() => {});
          }
        }
      }
    } catch (dualErr) {
      console.warn('[updateReaderActivity Dual Persistence sync error]', dualErr);
    }

    return { success: true };
  } catch (err) {
    console.error('[updateReaderActivity Error]', err);
    return { success: false, error: err.message };
  }
}

async function recordReadingProgressInDB(userId, workId, episodeNumber, progress = 0) {
  try {
    const reader = await findReaderProfile(userId);
    const episode = await supabaseClient.from('episodes').select('id').eq('work_id', Number(workId)).eq('episode_number', Number(episodeNumber)).single();
    if (episode.error) throw episode.error;
    const result = await supabaseClient.from('reading_history').upsert({
      user_id: reader.username || String(reader.id), work_id: Number(workId), episode_id: episode.data.id,
      progress: Math.max(0, Math.min(100, Number(progress) || 0)), last_read_at: new Date().toISOString()
    }, { onConflict: 'user_id,work_id' }).select('id').single();
    if (result.error) throw result.error;
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
}

async function toggleFavoriteInDB(userId, workId, isAdding = true) {
  try {
    const reader = await findReaderProfile(userId);
    const key = reader.username || String(reader.id);
    const result = isAdding
      ? await supabaseClient.from('favorites').upsert({ user_id: key, work_id: Number(workId) }, { onConflict: 'user_id,work_id' }).select('id').single()
      : await supabaseClient.from('favorites').delete().eq('user_id', key).eq('work_id', Number(workId)).select('id').single();
    if (result.error) throw result.error;
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
}

async function toggleSubscriptionInDB(userId, authorNameOrId, isAdding = true) {
  try {
    const reader = await findReaderProfile(userId);
    let query = supabaseClient.from('authors').select('id, pen_name');
    query = typeof authorNameOrId === 'number' ? query.eq('id', authorNameOrId) : query.eq('pen_name', authorNameOrId);
    const author = await query.single();
    if (author.error) throw author.error;
    const key = reader.username || String(reader.id);
    const result = isAdding
      ? await supabaseClient.from('author_subscriptions').upsert({ user_id: key, author_id: author.data.id, author_name: author.data.pen_name }, { onConflict: 'user_id,author_id' }).select('id').single()
      : await supabaseClient.from('author_subscriptions').delete().eq('user_id', key).eq('author_id', author.data.id).select('id').single();
    if (result.error) throw result.error;
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
}

// ---- 관리자 전용 독자 회원 정보 수정 ----
async function updateReaderByAdmin(readerId, payload) {
  return { success: false, error: '기존 관리자 독자 정보 수정은 종료되었습니다. 검증된 계정 지원 절차를 이용해주세요.' };
}

// ---- 관리자 전용 독자 회원 비밀번호 변경 ----
async function changeReaderPasswordByAdmin(readerId, newPassword) {
  return { success: false, error: '기존 계정 생성·비밀번호 변경 경로는 종료되었습니다. 본인 이메일 가입·재설정 또는 검증된 관리자 계정 연결 절차를 이용해주세요.' };
}

// ---- 관리자 전용 독자 회원 삭제 ----
async function deleteReaderByAdmin(readerId) {
  return { success: false, error: '기존 관리자 독자 계정 삭제는 종료되었습니다. 검증된 계정 지원 절차를 이용해주세요.' };
}

async function checkReaderExists(username, email) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return false;
  try {
    const u = String(username || '').trim();
    const e = String(email || '').trim();
    const query = supabaseClient.from('readers').select('id');
    if (u && e) {
      query.or(`username.ilike.${u},email.ilike.${e}`);
    } else if (u) {
      query.ilike('username', u);
    } else if (e) {
      query.ilike('email', e);
    } else {
      return false;
    }
    const { data, error } = await query;
    return !error && data && data.length > 0;
  } catch (e) {
    return false;
  }
}

async function createReaderInDB(userData) {
  return { success: false, error: '기존 계정 생성·비밀번호 변경 경로는 종료되었습니다. 본인 이메일 가입·재설정 또는 검증된 관리자 계정 연결 절차를 이용해주세요.' };
}

// ============================================================
// 07. COMMENTS & COMMUNITY
// ============================================================

async function fetchCommentsByEpisode(arg1, arg2) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return [];
  try {
    let query = supabaseClient
      .from('comments')
      .select('id, user_id, nickname, nickname_snapshot, work_id, episode_id, parent_id, content, likes_count, quote_text, anchor_paragraph, content_version, is_spoiler, created_at')
      .eq('is_deleted', false)
      .eq('is_blocked', false);

    if (arg2 !== undefined && arg2 !== null) {
      // (workId, episodeId) 전달 시
      query = query.eq('work_id', Number(arg1)).eq('episode_id', Number(arg2));
    } else if (arg1) {
      // (episodeId) 단독 전달 시
      query = query.eq('episode_id', Number(arg1));
    } else {
      return [];
    }

    const { data, error } = await query.order('created_at', { ascending: true });
    if (!error && Array.isArray(data)) {
      return data.map(c => ({
        ...c,
        nickname: c.nickname_snapshot || c.nickname || '독자'
      }));
    }
    return [];
  } catch (e) {
    return [];
  }
}

async function addCommentToEpisode(workId, episodeId, userId, nickname, content, parentId = null, meta = {}) {
  if (!supabaseClient || !episodeId || !content) return { success: false };
  try {
    const { data, error } = await supabaseClient
      .from('comments')
      .insert({
        user_id: typeof userId === 'string' && userId.length >= 32 ? userId : null,
        nickname_snapshot: nickname || '독자',
        work_id: Number(workId),
        episode_id: Number(episodeId),
        parent_id: parentId || null,
        content: content.trim(),
        anchor_paragraph: Number.isInteger(meta.anchorParagraph) ? meta.anchorParagraph : null,
        quote_text: meta.quoteText ? String(meta.quoteText).slice(0, 300) : null,
        content_version: meta.contentVersion ? String(meta.contentVersion).slice(0, 100) : null,
        is_spoiler: !!meta.isSpoiler,
        likes_count: 0
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, comment: data };
  } catch (err) {
    console.error('[addCommentToEpisode Error]', err);
    return { success: false, error: err.message };
  }
}

// ============================================================
// 08. SUB-ADMINS & SYSTEM CONFIG
// ============================================================

async function fetchSubAdmins() {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return [];
  try {
    // 1. Try RPC get_sub_admins first (Security Definer RPC)
    try {
      const { data: rpcData, error: rpcErr } = await supabaseClient.rpc('get_sub_admins');
      if (!rpcErr && Array.isArray(rpcData) && rpcData.length > 0) {
        return rpcData;
      }
      if (!rpcErr && Array.isArray(rpcData)) {
        // RPC returned empty array, but check direct table as well
      }
    } catch (e) {}

    // 2. Direct table query
    const { data, error } = await supabaseClient
      .from('admin_users')
      .select('id, username, nickname, email, role, permissions, is_active, created_at')
      .eq('role', 'SUB_ADMIN')
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data)) return data;
    if (error) {
      console.warn('[fetchSubAdmins Warning] DB 조회 제한:', error.message);
    }
    return [];
  } catch (e) {
    console.error('[fetchSubAdmins Error]', e);
    return [];
  }
}

async function createSubAdmin(arg1, arg2, arg3, arg4, arg5) {
  return { success: false, error: '기존 계정 생성·비밀번호 변경 경로는 종료되었습니다. 본인 이메일 가입·재설정 또는 검증된 관리자 계정 연결 절차를 이용해주세요.' };
}

async function updateSubAdminPermissions(subAdminId, permissions) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { success: false, error: 'DB 미연결' };
  try {
    const { data, error } = await supabaseClient
      .from('admin_users')
      .update({ permissions })
      .eq('id', subAdminId);
    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function deleteSubAdmin(subAdminId) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { success: false, error: 'DB 미연결' };
  try {
    // 1. Try RPC delete_sub_admin first
    try {
      const { data: rpcRes, error: rpcErr } = await supabaseClient.rpc('delete_sub_admin', {
        p_id: String(subAdminId)
      });
      if (!rpcErr && rpcRes?.success) return { success: true };
    } catch (e) {}

    // 2. Direct delete fallback
    const { data, error } = await supabaseClient
      .from('admin_users')
      .delete()
      .eq('id', subAdminId);
    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function fetchSystemConfig() {
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient
      .from('system_config')
      .select('*')
      .eq('id', 'default')
      .single();
    if (!error && data) return data;
    return null;
  } catch (e) {
    return null;
  }
}

// ============================================================
// 09. REALTIME BROADCAST SUBSCRIPTION
// ============================================================

let realtimeChannelInstance = null;
function setupRealtimeSubscriptions(callbacks = {}) {
  if (window.WEBNOVELS_CONFIG?.readerServiceEnabled ||
      window.WEBNOVELS_CONFIG?.adminOperationsEnabled) return;
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || realtimeChannelInstance) return;

  try {
    realtimeChannelInstance = supabaseClient
      .channel('public-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'works' }, payload => {
        console.log('⚡ [Realtime] works 변경:', payload.eventType);
        if (typeof callbacks.onWorksChange === 'function') callbacks.onWorksChange(payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'authors' }, payload => {
        if (typeof callbacks.onAuthorsChange === 'function') callbacks.onAuthorsChange(payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'episodes' }, payload => {
        console.log('⚡ [Realtime] episodes 변경:', payload.eventType);
        if (typeof callbacks.onEpisodesChange === 'function') callbacks.onEpisodesChange(payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, payload => {
        console.log('⚡ [Realtime] comments 변경:', payload.eventType);
        if (typeof callbacks.onCommentsChange === 'function') callbacks.onCommentsChange(payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, payload => {
        console.log('⚡ [Realtime] reports 변경:', payload.eventType);
        if (typeof callbacks.onReportsChange === 'function') callbacks.onReportsChange(payload);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('⚡ [Realtime] Supabase WebSocket 채널 연결 완료 (7대 핵심 테이블 실시간 감지)');
        }
      });
  } catch (err) {
    console.warn('[setupRealtimeSubscriptions Error]', err);
  }
}

// ============================================================
// ============================================================
// 09-1. PHASE 2 ADMIN CMS SERVICES (REPORTS, REVIEWS, LOGS, FANMEETINGS, GOODS, ADS)
// ============================================================

async function fetchReportsFromDB() {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('reports')
      .select('id, reporter_id, target_type, target_id, reason, status, resolved_action, created_at')
      .order('created_at', { ascending: false });
    if (!error && Array.isArray(data)) return data;
    return [];
  } catch (e) {
    return [];
  }
}

async function resolveReportInDB(reportId, action = '블라인드 처리') {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || !reportId) return { success: false, error: 'DB 미연결' };
  try {
    const { data, error } = await supabaseClient
      .from('reports')
      .update({
        status: 'RESOLVED',
        resolved_action: action
      })
      .eq('id', reportId)
      .select()
      .single();
    if (error) throw error;
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function fetchContentReviewsFromDB() {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('content_reviews')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && Array.isArray(data)) return data;
    return [];
  } catch (e) {
    return [];
  }
}

async function updateContentReviewInDB(reviewId, status = 'APPROVED', rejectReason = null) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || !reviewId) return { success: false, error: 'DB 미연결' };
  try {
    const admin = getCurrentAdmin();
    if (!admin) return { success: false, error: '관리자 인증이 필요합니다.' };
    const { data, error } = await supabaseClient
      .from('content_reviews')
      .update({
        status,
        reject_reason: rejectReason,
        reviewer_name: admin.nickname || '관리자',
        reviewed_at: new Date().toISOString()
      })
      .eq('id', reviewId)
      .select()
      .single();
    if (error) throw error;
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function fetchAuditLogsFromDB() {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('audit_logs')
      .select('id, admin_id, action, target_type, target_id, new_data, ip_address, created_at')
      .order('created_at', { ascending: false })
      .limit(20);
    if (!error && Array.isArray(data)) return data;
    return [];
  } catch (e) {
    return [];
  }
}

async function recordAuditLogInDB(action, targetType, targetId, newData = {}) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return;
  try {
    await supabaseClient.from('audit_logs').insert({
      action,
      target_type: targetType,
      target_id: String(targetId),
      new_data: newData,
      ip_address: '127.0.0.1'
    });
  } catch (e) {}
}

// ============================================================
// 09-B. AUTHOR-FIRST: Supabase discovery, moderation, analytics and support
// ============================================================
async function fetchGoldenBestFromDB() {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return [];
  try {
    const { data: latest } = await supabaseClient.from('golden_best_snapshots').select('period_hour').order('period_hour', { ascending: false }).limit(1).maybeSingle();
    if (latest?.period_hour) {
      const { data, error } = await supabaseClient.from('golden_best_snapshots').select('rank, score, reason, works(id, title, author, genre, tags, cover_image, view_count)').eq('period_hour', latest.period_hour).order('rank').limit(20);
      if (error) throw error;
      return (data || []).map(row => ({ ...(row.works || {}), goldenBest: { rank: row.rank, score: row.score, reason: row.reason } }));
    }
    const { data, error } = await supabaseClient.from('v_golden_best_current').select('*').order('rank').limit(20);
    if (error) throw error;
    return (data || []).map(row => ({ id: row.work_id, title: row.title, author: row.author, genre: row.genre, tags: row.tags, cover_image: row.cover_image, view_count: row.view_count, goldenBest: { rank: row.rank, score: row.score, reason: row.reason } }));
  } catch (error) { console.warn('[fetchGoldenBestFromDB]', error); return []; }
}

async function updateWorkCommentPolicy(workId, policy) {
  if (!supabaseClient) initSupabaseAdmin();
  const payload = {
    work_id: Number(workId),
    comments_enabled: policy.commentsEnabled !== false && policy.comments_enabled !== false,
    blocked_terms: (policy.blockedTerms || policy.blocked_terms || []).map(term => String(term).trim().toLowerCase()).filter(Boolean).slice(0, 50),
    min_read_episodes: Math.max(0, Math.min(100, Number(policy.minReadEpisodes ?? policy.min_read_episodes) || 0)),
    updated_at: new Date().toISOString()
  };
  localStorage.setItem(`work_comment_policy_${workId}`, JSON.stringify(payload));
  if (!supabaseClient) return { success: true, policy: payload };

  const { data, error } = await supabaseClient.from('work_comment_policies').upsert(payload, { onConflict: 'work_id' }).select().single();
  return error ? { success: false, error: error.message } : { success: true, policy: data };
}

async function fetchWorkCommentPolicy(workId) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) {
    const local = JSON.parse(localStorage.getItem(`work_comment_policy_${workId}`) || 'null');
    return local || { work_id: Number(workId), comments_enabled: true, blocked_terms: [], min_read_episodes: 0 };
  }
  try {
    const { data, error } = await supabaseClient.from('work_comment_policies').select('*').eq('work_id', Number(workId)).maybeSingle();
    if (error) throw error;
    if (data) return data;
    const local = JSON.parse(localStorage.getItem(`work_comment_policy_${workId}`) || 'null');
    return local || { work_id: Number(workId), comments_enabled: true, blocked_terms: [], min_read_episodes: 0 };
  } catch (err) {
    const local = JSON.parse(localStorage.getItem(`work_comment_policy_${workId}`) || 'null');
    return local || { work_id: Number(workId), comments_enabled: true, blocked_terms: [], min_read_episodes: 0 };
  }
}

async function fetchBlockedReaders(workId) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) {
    return JSON.parse(localStorage.getItem(`work_blocked_readers_${workId}`) || '[]');
  }
  try {
    const { data, error } = await supabaseClient.from('creator_comment_blocks').select('*').eq('work_id', Number(workId)).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    return JSON.parse(localStorage.getItem(`work_blocked_readers_${workId}`) || '[]');
  }
}

async function unblockReaderComments(workId, readerId) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) {
    let local = JSON.parse(localStorage.getItem(`work_blocked_readers_${workId}`) || '[]');
    local = local.filter(b => b.reader_id !== String(readerId));
    localStorage.setItem(`work_blocked_readers_${workId}`, JSON.stringify(local));
    return { success: true };
  }
  try {
    const { error } = await supabaseClient.from('creator_comment_blocks').delete().eq('work_id', Number(workId)).eq('reader_id', String(readerId));
    if (error) throw error;
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function setCommentHiddenByAuthor(commentId, hidden = true) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { success: false, error: 'DB 미연결' };
  const { data, error } = await supabaseClient.from('comments').update({ is_hidden_by_author: !!hidden }).eq('id', commentId).select().single();
  return error ? { success: false, error: error.message } : { success: true, comment: data };
}

async function blockReaderComments(workId, creatorId, readerId) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { success: false, error: 'DB 미연결' };
  const { data, error } = await supabaseClient.from('creator_comment_blocks').upsert({ work_id: Number(workId), creator_id: Number(creatorId), reader_id: String(readerId) }, { onConflict: 'work_id,reader_id' }).select().single();
  return error ? { success: false, error: error.message } : { success: true, block: data };
}

async function recordReaderEventInDB(workId, episodeId, eventType, progress = 0, contentVersion = null) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return;
  const { data: sessionData } = await supabaseClient.auth.getSession();
  if (!sessionData?.session) return;
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return null;
  const { data, error } = await supabaseClient.rpc('record_reader_event', { p_work_id: Number(workId), p_episode_id: Number(episodeId), p_event_type: eventType, p_progress: Number(progress) || 0, p_content_version: contentVersion });
  if (error) { console.warn('[recordReaderEventInDB]', error.message); return null; }
  return data;
}

async function fetchCreatorReaderAnalytics(authorId) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { completionRate: 0, avgProgress: 0, events: [], episodeRows: [] };
  try {
    const { data: works, error: worksError } = await supabaseClient.from('works').select('id, title, episodes(id, episode_number, title)').eq('author_id', Number(authorId));
    if (worksError) throw worksError;
    const episodeRows = (works || []).flatMap(work => (work.episodes || []).map(episode => ({ ...episode, workTitle: work.title })));
    const ids = episodeRows.map(episode => episode.id);
    if (!ids.length) return { completionRate: 0, avgProgress: 0, events: [], episodeRows: [] };
    const { data: events, error } = await supabaseClient.from('reader_events').select('episode_id,event_type,progress,occurred_at').in('episode_id', ids).order('occurred_at', { ascending: false }).limit(5000);
    if (error) throw error;
    const rows = events || [];
    const complete = rows.filter(event => event.event_type === 'COMPLETE').length;
    const opens = rows.filter(event => event.event_type === 'OPEN').length;
    return { completionRate: opens ? Math.round((complete / opens) * 1000) / 10 : 0, avgProgress: rows.length ? Math.round(rows.reduce((sum, event) => sum + Number(event.progress || 0), 0) / rows.length) : 0, events: rows, episodeRows };
  } catch (error) { console.warn('[fetchCreatorReaderAnalytics]', error); return { completionRate: 0, avgProgress: 0, events: [], episodeRows: [] }; }
}

async function supportCreator(workId, amountPoints, isAnonymous = false) {
  return { success: false, error: 'MONETIZATION_NOT_ACTIVATED' };
}

async function fetchWorkTopSupporters() { return []; }

async function fetchAuthorEarningLedger() { return []; }

async function fetchEpisodeDraftFromDB() { throw new Error('USE_CREATOR_DRAFTS_API'); }
async function saveEpisodeDraftToDB() { return { success: false, error: 'USE_CREATOR_DRAFTS_API' }; }

async function fetchReaderPreferencesFromDB(identifier) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || !identifier) return null;
  try {
    const cleanId = String(identifier).trim();
    let query = supabaseClient.from('readers').select('reader_preferences');
    if (!isNaN(cleanId) && Number(cleanId) > 0) {
      query = query.or(`id.eq.${Number(cleanId)},username.ilike.${cleanId},email.ilike.${cleanId}`);
    } else {
      query = query.or(`username.ilike.${cleanId},email.ilike.${cleanId}`);
    }
    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;
    return data.reader_preferences || null;
  } catch (err) {
    console.warn('[fetchReaderPreferencesFromDB]', err.message);
    return null;
  }
}

async function saveReaderPreferencesToDB(identifier, preferences) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || !identifier) return { success: false, error: 'DB 미연결 또는 미인증' };
  try {
    const cleanId = String(identifier).trim();
    let query = supabaseClient.from('readers').update({ reader_preferences: preferences, updated_at: new Date().toISOString() });
    if (!isNaN(cleanId) && Number(cleanId) > 0) {
      query = query.or(`id.eq.${Number(cleanId)},username.ilike.${cleanId},email.ilike.${cleanId}`);
    } else {
      query = query.or(`username.ilike.${cleanId},email.ilike.${cleanId}`);
    }
    const { data, error } = await query;
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// 10. GLOBAL EXPORT
// ============================================================

window.WebNovelsAdmin = {
  init: initSupabaseAdmin,
  login: adminLogin,
  logout: adminLogout,
  getCurrentAdmin,
  readerLogin,
  authorLogin,
  creatorLogin: authorLogin,
  fetchReadersFromSupabase,
  fetchAuthorsFromSupabase,
  fetchCreatorsFromSupabase: fetchAuthorsFromSupabase,
  fetchReaderActivity,
  updateReaderActivity,
  checkReaderExists,
  createReaderInDB,
  updateReaderByAdmin,
  changeReaderPasswordByAdmin,
  deleteReaderByAdmin,
  fetchDashboardKPI,
  fetchEpisodeSummaryStats,
  fetchWorksFromSupabase,
  fetchEpisodesByWorkId,
  fetchPublishingCalendarEvents,
  fetchWorkSeriesDashboardData,
  fetchEpisodeContentSecure,
  recordWorkReadingView,
  logAdEvent,
  recordEpisodeUnlock,
  unlockEpisodeWithAdSecure,
  fetchAuthorEarnings,
  fetchCreatorEarnings: fetchAuthorEarnings,
  fetchAuthorSettlements,
  fetchCreatorSettlements: fetchAuthorSettlements,
  fetchAuthorRevenueSummary,
  fetchCreatorRevenueSummary: fetchAuthorRevenueSummary,
  requestSettlementSecure,
  recordReadingProgressInDB,
  toggleFavoriteInDB,
  toggleSubscriptionInDB,
  fetchCommentsByEpisode,
  addCommentToEpisode,
  fetchGoldenBestFromDB,
  updateWorkCommentPolicy,
  fetchWorkCommentPolicy,
  setCommentHiddenByAuthor,
  blockReaderComments,
  fetchBlockedReaders,
  unblockReaderComments,
  recordReaderEventInDB,
  fetchCreatorReaderAnalytics,
  supportCreator,
  fetchWorkTopSupporters,
  fetchAuthorEarningLedger,
  fetchCreatorEarningLedger: fetchAuthorEarningLedger,
  fetchEpisodeDraftFromDB,
  saveEpisodeDraftToDB,
  fetchReaderPreferences: fetchReaderPreferencesFromDB,
  fetchReaderPreferencesFromDB,
  saveReaderPreferences: saveReaderPreferencesToDB,
  saveReaderPreferencesToDB,
  fetchSubAdmins,
  createSubAdmin,
  updateSubAdminPermissions,
  deleteSubAdmin,
  fetchSystemConfig,
  setupRealtimeSubscriptions,
  fetchReportsFromDB,
  resolveReportInDB,
  fetchContentReviewsFromDB,
  updateContentReviewInDB,
  fetchAuditLogsFromDB,
  recordAuditLogInDB,
};
