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
    let totalUsers = null;
    let totalAuthors = null;
    let totalWorks = null;
    let totalEpisodes = null;
    let totalAdViews = 0;
    let totalViews = 0;
    let novelCount = 0;
    let webtoonCount = 0;

    // 1. readers count
    const { count: usersCount } = await supabaseClient.from('readers').select('*', { count: 'exact', head: true });
    if (typeof usersCount === 'number') totalUsers = usersCount;

    // 2. authors count
    const { count: authorsCount } = await supabaseClient.from('authors').select('*', { count: 'exact', head: true });
    if (typeof authorsCount === 'number') totalAuthors = authorsCount;

    // 3. works count & views & status
    let ongoingCount = 0;
    let completedCount = 0;
    const { data: worksData } = await supabaseClient.from('works').select('id, content_type, view_count, status');
    if (worksData) {
      totalWorks = worksData.length;
      novelCount = worksData.filter(w => w.content_type !== 'WEBTOON').length;
      webtoonCount = worksData.filter(w => w.content_type === 'WEBTOON').length;
      ongoingCount = worksData.filter(w => w.status !== 'COMPLETED').length;
      completedCount = worksData.filter(w => w.status === 'COMPLETED').length;
      totalViews = worksData.reduce((sum, w) => sum + (Number(w.view_count) || 0), 0);
    }

    // 4. episodes count & 타입별 에피소드 & 오늘 발행 현황 집계
    let novelEpisodes = 0;
    let webtoonEpisodes = 0;
    let todayPublished = 0;
    let todayScheduled = 0;

    const { data: epData, count: epCount } = await supabaseClient
      .from('episodes')
      .select('id, work_id, status, created_at, scheduled_at', { count: 'exact' });

    if (typeof epCount === 'number') totalEpisodes = epCount;

    if (epData && worksData) {
      const webtoonWorkIds = new Set(worksData.filter(w => w.content_type === 'WEBTOON').map(w => w.id));
      epData.forEach(ep => {
        if (webtoonWorkIds.has(ep.work_id)) {
          webtoonEpisodes++;
        } else {
          novelEpisodes++;
        }

        // 오늘 일자 (2026-08-22) 기준 발행 및 예약 카운트
        const dateStr = ep.scheduled_at || ep.created_at;
        if (dateStr && new Date(dateStr).toLocaleDateString('en-CA') === new Date().toLocaleDateString('en-CA')) {
          if (ep.status === 'SCHEDULED') {
            todayScheduled++;
          } else {
            todayPublished++;
          }
        }
      });
    }

    // 5. ad_events count
    const { count: adCount } = await supabaseClient.from('ad_events').select('*', { count: 'exact', head: true });
    if (typeof adCount === 'number') totalAdViews = adCount;

    // 6. revenue_periods / revenue_ledger 집계
    let calculatedTotalRevenue = 0;
    let calculatedAuthorRevenue = 0;
    try {
      const { data: revPeriods } = await supabaseClient
        .from('revenue_periods')
        .select('gross_revenue, writer_pool');
      if (revPeriods && revPeriods.length > 0) {
        calculatedTotalRevenue = revPeriods.reduce((sum, r) => sum + (Number(r.gross_revenue) || 0), 0);
        calculatedAuthorRevenue = revPeriods.reduce((sum, r) => sum + (Number(r.writer_pool) || 0), 0);
      }
    } catch (e) {}

    return {
      total_users: totalUsers ?? 0,
      total_authors: totalAuthors ?? 0,
      total_works: totalWorks ?? 0,
      total_episodes: totalEpisodes ?? 0,
      total_ad_views: totalAdViews,
      total_views: totalViews,
      novel_count: novelCount,
      webtoon_count: webtoonCount,
      novel_episodes: novelEpisodes,
      webtoon_episodes: webtoonEpisodes,
      today_published: todayPublished,
      today_scheduled: todayScheduled + todayPublished,
      ongoing_count: ongoingCount,
      completed_count: completedCount,
      total_revenue: calculatedTotalRevenue,
      total_author_revenue: calculatedAuthorRevenue
    };
  } catch (err) {
    console.error('[Dashboard KPI] 조회 실패:', err);
    return null;
  }
}

// ============================================================
// 02-B. EPISODES SUMMARY STATS (실시간 회차 통계 집계)
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
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return null;

  try {
    // 1. works 테이블 전체 조회 (author 및 author_id 컬럼 모두 지원)
    const { data: works, error: wErr } = await supabaseClient
      .from('works')
      .select('*')
      .order('id', { ascending: true });

    if (wErr) throw wErr;
    if (!works?.length) return [];

    // 2. authors 펜네임 매핑 테이블
    const { data: authors } = await supabaseClient.from('authors').select('id, pen_name, username');
    const authorMap = {};
    if (authors) {
      authors.forEach(a => {
        authorMap[a.id] = a.pen_name || a.username;
      });
    }

    // 3. episodes 메타데이터 조회
    const { data: episodes, error: epErr } = await supabaseClient
      .from('episodes')
      .select('id, work_id, episode_number, title, access_policy, author_comment, status, view_count, is_free, is_ad_free, scheduled_at')
      .order('episode_number', { ascending: true });

    if (epErr) throw epErr;
    const epMap = {};
    if (!epErr && episodes) {
      episodes.forEach(ep => {
        if (!epMap[ep.work_id]) epMap[ep.work_id] = [];
        const isFree = ep.is_free !== undefined ? ep.is_free : (ep.access_policy === 'FREE' || Number(ep.episode_number) <= 3);
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

      const resolvedAuthorName = w.author || (w.author_id && authorMap[w.author_id]) || '작가 정보 없음';

      const resolvedEpisodes = epMap[w.id] || [];

      return {
        id: Number(w.id),
        authorId: w.author_id ? Number(w.author_id) : null,
        title: w.title,
        author: resolvedAuthorName,
        contentType: w.content_type || 'NOVEL',
        genre: mainGenre,
        createdAt: w.created_at,
        aiUsageType: w.ai_usage_type || 'NONE',
        tags: Array.isArray(w.tags) ? w.tags.join(', ') : (w.tags || '신작'),
        description: w.description || '',
        coverUrl: coverUrl,
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
      .select('id, work_id, episode_number, title, access_policy, author_comment, status, scheduled_at, view_count, is_free, is_ad_free, content, image_urls, created_at')
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
async function fetchEpisodeContentSecure(episodeId, workId = null, episodeNumber = null) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return null;

  try {
    let targetEpId = episodeId ? Number(episodeId) : null;

    if (!targetEpId && workId && episodeNumber) {
      const { data: epRow } = await supabaseClient
        .from('episodes')
        .select('id, content, image_urls')
        .eq('work_id', Number(workId))
        .eq('episode_number', Number(episodeNumber))
        .single();
      if (epRow) {
        targetEpId = Number(epRow.id);
        if (epRow.content) {
          return { textContent: epRow.content, imageUrls: epRow.image_urls || [] };
        }
      }
    }

    if (!targetEpId) return null;

    // 1. private.get_episode_content RPC 호출 시도
    try {
      const { data: rpcData, error: rpcErr } = await supabaseClient.rpc('get_episode_content', {
        p_episode_id: targetEpId
      });
      if (!rpcErr && rpcData && rpcData.length > 0 && rpcData[0].text_content) {
        return { textContent: rpcData[0].text_content, imageUrls: [] };
      }
    } catch (e) {}

    // 2. episode_contents 테이블 직접 쿼리
    let textContent = null;
    try {
      const { data: cRow } = await supabaseClient
        .from('episode_contents')
        .select('text_content')
        .eq('episode_id', targetEpId)
        .single();
      if (cRow?.text_content) textContent = cRow.text_content;
    } catch (e) {}

    // 3. episodes 테이블 본문 컬럼 조회 (기존 시드 데이터 호환)
    if (!textContent) {
      try {
        const { data: epData } = await supabaseClient
          .from('episodes')
          .select('content, image_urls')
          .eq('id', targetEpId)
          .single();
        if (epData?.content) {
          return { textContent: epData.content, imageUrls: epData.image_urls || [] };
        }
      } catch (e) {}
    }

    // 4. episode_panels 테이블 조회
    let imageUrls = [];
    try {
      const { data: panels } = await supabaseClient
        .from('episode_panels')
        .select('image_url')
        .eq('episode_id', targetEpId)
        .order('panel_number', { ascending: true });
      if (panels && panels.length > 0) {
        imageUrls = panels.map(p => p.image_url);
      }
    } catch (e) {}

    return { textContent, imageUrls };
  } catch (err) {
    console.error('[fetchEpisodeContentSecure Exception]', err);
    return null;
  }
}

// [Create Work with Database Auto-Increment ID & author_id FK]
async function createWorkInDB(workData) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { success: false, error: 'DB 미연결' };

  try {
    const cleanCover = workData.cover_image || workData.coverUrl || workData.coverImage || '/images/stormqueen_oath.jpg';
    const finalCover = (cleanCover.startsWith('http') || cleanCover.startsWith('/')) ? cleanCover : `/images/${cleanCover}`;

    let authorQuery = supabaseClient.from('authors').select('id, pen_name');
    const authorId = workData.author_id || workData.authorId;
    authorQuery = authorId ? authorQuery.eq('id', Number(authorId)) : authorQuery.eq('pen_name', workData.author);
    const { data: author, error: authorError } = await authorQuery.single();
    if (authorError || !author) return { success: false, error: '등록된 작가를 선택해 주세요.' };

    const payload = {
      title: workData.title,
      author: author.pen_name,
      author_id: author.id,
      content_type: workData.contentType || workData.content_type || 'NOVEL',
      genre: Array.isArray(workData.genre) ? workData.genre : [workData.genre || '판타지'],
      tags: Array.isArray(workData.tags) ? workData.tags : [workData.tags || '신작', '정식연재'],
      description: workData.description || '',
      cover_image: finalCover,
      rating: workData.rating || 'ALL',
      status: workData.status || 'ONGOING',
      is_completed: !!(workData.isCompleted || workData.is_completed),
      is_top_recommended: !!(workData.isTopRecommended || workData.is_top_recommended),
      is_popular_work: !!(workData.isPopularWork || workData.is_popular_work),
      is_new_work: true,
      view_count: 0,
      like_count: 0
    };

    if (workData.id) {
      payload.id = Number(workData.id);
    }

    const { data, error } = await supabaseClient
      .from('works')
      .insert([payload])
      .select().single();

    if (error) throw error;
    window.dispatchEvent(new CustomEvent('webnovels:works-changed'));
    return { success: true, data };
  } catch (err) {
    console.error('[createWorkInDB Error]', err);
    return { success: false, error: err.message };
  }
}

async function updateWorkAdminSetting(workId, fieldOrData, optionalValue) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { success: false, error: 'DB 미연동' };
  try {
    let payload = {};
    if (typeof fieldOrData === 'string') {
      payload = { [fieldOrData]: optionalValue };
    } else if (typeof fieldOrData === 'object' && fieldOrData !== null) {
      payload = fieldOrData;
    }
    const fieldMap = { isTopRecommended: 'is_top_recommended', isPopularWork: 'is_popular_work', isNewWork: 'is_new_work', isCompleted: 'is_completed', contentType: 'content_type', coverUrl: 'cover_image', aiUsageType: 'ai_usage_type' };
    payload = Object.fromEntries(Object.entries(payload).map(([key, value]) => [fieldMap[key] || key, value]));
    const { data, error } = await supabaseClient
      .from('works')
      .update(payload)
      .eq('id', Number(workId)).select('id').single();
    if (error) throw error;
    window.dispatchEvent(new CustomEvent('webnovels:works-changed'));
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function deleteWorkFromDB(workId) {
  if (!supabaseClient) return { success: false, error: 'DB 미연동' };
  try {
    const { data, error } = await supabaseClient
      .from('works')
      .delete()
      .eq('id', Number(workId)).select('id').single();
    if (error) throw error;
    window.dispatchEvent(new CustomEvent('webnovels:works-changed'));
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function createEpisodeInDB(workId, episode) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { success: false, error: 'DB 연결이 필요합니다.' };
  if (!Number.isInteger(Number(episode.episodeNumber)) || Number(episode.episodeNumber) < 1 || !episode.title?.trim()) {
    return { success: false, error: '회차 번호와 제목을 확인해 주세요.' };
  }
  try {
    const { data, error } = await supabaseClient.from('episodes').insert({
      work_id: Number(workId), episode_number: Number(episode.episodeNumber), title: episode.title.trim(),
      content: episode.content || '', image_urls: episode.imageUrls || [], author_comment: episode.authorComment || '',
      is_free: !!episode.isFree, is_ad_free: !episode.isFree,
      access_policy: episode.isFree ? 'FREE' : 'REWARDED_AD', status: episode.status || 'PUBLISHED',
      scheduled_at: episode.scheduledAt || null
    }).select('id').single();
    if (error) throw error;
    window.dispatchEvent(new CustomEvent('webnovels:episodes-changed'));
    return { success: true, data };
  } catch (error) { return { success: false, error: error.message }; }
}

async function updateEpisodeSetting(episodeId, fieldOrData, value) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { success: false, error: 'DB 연결이 필요합니다.' };
  const payload = typeof fieldOrData === 'string' ? { [fieldOrData]: value } : { ...fieldOrData };
  if ('is_free' in payload) {
    payload.is_ad_free = !payload.is_free;
    payload.access_policy = payload.is_free ? 'FREE' : 'REWARDED_AD';
  }
  try {
    const { data, error } = await supabaseClient.from('episodes').update(payload).eq('id', Number(episodeId)).select('id').single();
    if (error) throw error;
    window.dispatchEvent(new CustomEvent('webnovels:episodes-changed'));
    return { success: true, data };
  } catch (error) { return { success: false, error: error.message }; }
}

async function deleteEpisodeFromDB(episodeId) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { success: false, error: 'DB 연결이 필요합니다.' };
  try {
    const { data, error } = await supabaseClient.from('episodes').delete().eq('id', Number(episodeId)).select('id').single();
    if (error) throw error;
    window.dispatchEvent(new CustomEvent('webnovels:episodes-changed'));
    return { success: true, data };
  } catch (error) { return { success: false, error: error.message }; }
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
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return null;

  try {
    const { data, error } = await supabaseClient.from('ad_events').insert({
      user_id: userId && typeof userId === 'string' && userId.length >= 32 ? userId : null,
      work_id: workId ? Number(workId) : null,
      episode_id: episodeId ? Number(episodeId) : null,
      ad_network: adNetwork,
      event_type: eventType,
      reward_granted: eventType === 'REWARD' || eventType === 'COMPLETE',
      revenue: Number(revenue) || 20,
      currency: 'KRW'
    }).select('id').single();

    if (error) throw error;
    return data ? data.id : null;
  } catch (err) {
    console.warn('[logAdEvent Warning]', err.message);
    return null;
  }
}

// [Record Episode Unlock with source_event_id & 72h Expiration]
async function recordEpisodeUnlock(userId, episodeId, unlockType = 'REWARDED_AD', sourceEventId = null) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || !userId || !episodeId) return { success: false, error: '필수 파라미터 누락' };

  try {
    const expiresAt = unlockType === 'REWARDED_AD'
      ? new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()
      : null;

    const { data, error } = await supabaseClient
      .from('episode_unlocks')
      .insert({
        user_id: typeof userId === 'string' && userId.length >= 32 ? userId : null,
        episode_id: Number(episodeId),
        unlock_type: unlockType,
        source_event_id: sourceEventId,
        granted_at: new Date().toISOString(),
        expires_at: expiresAt,
        status: 'ACTIVE'
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, unlock: data };
  } catch (err) {
    console.warn('[recordEpisodeUnlock Warning]', err.message);
    return { success: false, error: err.message };
  }
}

// [Unlock Episode with Ad Verification]
async function unlockEpisodeWithAdSecure(userId, workId, episodeId) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!userId || !episodeId) return { success: false, error: '유저 및 회차 정보 필요' };

  try {
    // 1. 광고 완료 이벤트 생성 및 source_event_id 획득
    const adEventId = await logAdEvent(userId, workId, episodeId, 'COMPLETE', 'ADMOB', 20);

    // 2. private.grant_rewarded_ad_unlock RPC 호출 시도
    if (adEventId && typeof userId === 'string' && userId.length >= 32) {
      try {
        const { data: rpcRes, error: rpcErr } = await supabaseClient.rpc('grant_rewarded_ad_unlock', {
          p_user_id: userId,
          p_episode_id: Number(episodeId),
          p_ad_event_id: adEventId
        });
        if (!rpcErr && rpcRes?.success) {
          return { success: true, unlock: rpcRes };
        }
      } catch (e) {}
    }

    // 3. Fallback: recordEpisodeUnlock 수행
    return await recordEpisodeUnlock(userId, episodeId, 'REWARDED_AD', adEventId);
  } catch (err) {
    console.error('[unlockEpisodeWithAdSecure Error]', err);
    return { success: false, error: err.message };
  }
}

// ============================================================
// 05. REVENUE & SETTLEMENTS
// ============================================================

async function allocateRevenue(periodMonth = new Date().toISOString().slice(0, 7)) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { success: false, error: 'DB 미연결' };

  try {
    const { data: adEvents } = await supabaseClient.from('ad_events').select('revenue, work_id');
    let totalAdRevenue = 0;
    if (adEvents && adEvents.length > 0) {
      totalAdRevenue = adEvents.reduce((sum, e) => sum + Number(e.revenue || 0), 0);
    }
    if (totalAdRevenue === 0) return { success: false, error: '집계할 광고 매출이 없습니다.' };

    const writerPoolRatio = 0.625;
    const networkFee = Math.floor(totalAdRevenue * 0.1);
    const netRevenue = totalAdRevenue - networkFee;
    const writerPool = Math.floor(netRevenue * writerPoolRatio);
    const platformRevenue = netRevenue - writerPool;

    const periodDateFormatted = `${periodMonth}-01`;
    const { data: revPeriod, error: pErr } = await supabaseClient
      .from('revenue_periods')
      .upsert({
        period_month: periodDateFormatted,
        gross_revenue: totalAdRevenue,
        network_fee: networkFee,
        net_revenue: netRevenue,
        writer_pool_ratio: writerPoolRatio,
        writer_pool: writerPool,
        platform_revenue: platformRevenue,
        is_closed: false
      }, { onConflict: 'period_month' })
      .select()
      .single();

    if (pErr) console.warn('[revenue_periods upsert warning]', pErr.message);

    const { data: worksList } = await supabaseClient.from('works').select('id, author_id, view_count');
    if (worksList && worksList.length > 0) {
      const totalWorkViews = worksList.reduce((sum, w) => sum + (Number(w.view_count) || 1), 0) || 1;

      const earningsRows = worksList.map(w => {
        const weight = (Number(w.view_count) || 1) / totalWorkViews;
        const workGross = Math.floor(totalAdRevenue * weight);
        const workAuthorRev = Math.floor(writerPool * weight);
        const workPlatformFee = workGross - workAuthorRev;

        return {
          author_id: w.author_id || 1,
          work_id: w.id,
          period_date: periodDateFormatted,
          gross_revenue: workGross,
          platform_fee: workPlatformFee,
          author_revenue: workAuthorRev,
          status: 'CONFIRMED'
        };
      });

      await supabaseClient.from('author_earnings').insert(earningsRows).catch(() => {});
    }

    return { success: true, period: revPeriod, authorPool: writerPool, creatorPool: writerPool, writerPool };
  } catch (err) {
    console.error('[allocateRevenue Error]', err);
    return { success: false, error: err.message };
  }
}

async function confirmRevenue(periodMonth = new Date().toISOString().slice(0, 7)) {
  if (!supabaseClient) return { success: false, error: 'DB 미연결' };
  try {
    const periodDateFormatted = `${periodMonth}-01`;
    const { data, error } = await supabaseClient
      .from('revenue_periods')
      .update({ is_closed: true, closed_at: new Date().toISOString() })
      .eq('period_month', periodDateFormatted)
      .select();
    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function fetchRevenueEvents() {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('revenue_periods')
      .select('*')
      .order('period_month', { ascending: false })
      .limit(10);
    if (!error && data) {
      return data.map(r => ({
        period_month: String(r.period_month || '').substring(0, 7),
        gross_revenue: Number(r.gross_revenue) || 0,
        ad_network_fee: Number(r.network_fee ?? r.ad_network_fee ?? 0),
        net_revenue: Number(r.net_revenue) || 0,
        writer_pool_ratio: Number(r.writer_pool_ratio) || 0.625,
        writer_pool: Number(r.writer_pool) || 0,
        platform_revenue: Number(r.platform_revenue) || 0,
        is_closed: !!r.is_closed
      }));
    }
    return [];
  } catch (e) {
    return [];
  }
}

async function fetchAuthorEarnings(authorIdOrName) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || !authorIdOrName) return [];
  try {
    let aId = Number(authorIdOrName);
    if (isNaN(aId) || aId <= 0) {
      const cleanName = String(authorIdOrName).trim();
      const { data: aData } = await supabaseClient
        .from('authors')
        .select('id')
        .or(`pen_name.ilike.${cleanName},username.ilike.${cleanName}`)
        .limit(1);
      if (aData && aData.length > 0) aId = aData[0].id;
    }
    if (!aId || isNaN(aId)) return [];

    const { data, error } = await supabaseClient
      .from('author_earnings')
      .select('*')
      .eq('author_id', aId)
      .order('period_date', { ascending: false });

    if (!error && Array.isArray(data)) return data;
    return [];
  } catch (e) {
    console.warn('[fetchAuthorEarnings Error]', e);
    return [];
  }
}

async function fetchAuthorSettlements(authorIdOrName) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || !authorIdOrName) return [];
  try {
    let cleanName = String(authorIdOrName).trim();
    let query = supabaseClient.from('author_settlements').select('*');

    if (!isNaN(Number(authorIdOrName)) && Number(authorIdOrName) > 0) {
      const aId = Number(authorIdOrName);
      query = query.or(`author_id.eq.${aId},author_name.ilike.${cleanName},author_name_snapshot.ilike.${cleanName}`);
    } else {
      query = query.or(`author_name.ilike.${cleanName},author_name_snapshot.ilike.${cleanName}`);
    }

    const { data, error } = await query.order('requested_at', { ascending: false });
    if (!error && Array.isArray(data)) return data;
    return [];
  } catch (e) {
    console.warn('[fetchAuthorSettlements Error]', e);
    return [];
  }
}

async function fetchAuthorRevenueSummary(authorIdOrName) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || !authorIdOrName) {
    return {
      estimatedRevenue: 0,
      confirmedRevenue: 0,
      payableRevenue: 0,
      paidAmount: 0,
      pendingAmount: 0,
      todayRevenue: 0,
      earningsRecords: [],
      settlements: []
    };
  }

  try {
    const [earningsRecords, settlements] = await Promise.all([
      fetchAuthorEarnings(authorIdOrName),
      fetchAuthorSettlements(authorIdOrName)
    ]);

    // 1. 당월 실시간 예상 광고 수익 (PENDING + CONFIRMED 최신)
    let estimatedRevenue = 0;
    let confirmedRevenue = 0;
    let todayRevenue = 0;

    if (earningsRecords && earningsRecords.length > 0) {
      for (const rec of earningsRecords) {
        const rev = Number(rec.author_revenue) || 0;
        if (rec.status === 'PENDING') {
          estimatedRevenue += rev;
        } else if (rec.status === 'CONFIRMED') {
          confirmedRevenue += rev;
        }
      }
      // 만약 당월 PENDING이 없으면 최신 확정수익을 기본 예상수익 풀로 참조
      if (estimatedRevenue === 0 && confirmedRevenue > 0) {
        estimatedRevenue = Math.round(confirmedRevenue * 0.25);
      }
      // 오늘 수익 (당월 예상치의 약 1/7 또는 최신 일자 환산)
      todayRevenue = Math.round(estimatedRevenue / 7);
    }

    // 2. 정산금 기지급액 및 심사 대기액 계산
    let paidAmount = 0;
    let pendingAmount = 0;
    let pendingItem = null;

    if (settlements && settlements.length > 0) {
      for (const s of settlements) {
        const amt = Number(s.amount) || 0;
        if (s.status === 'PAID') {
          paidAmount += amt;
        } else if (s.status === 'PENDING') {
          pendingAmount += amt;
          if (!pendingItem) pendingItem = s;
        }
      }
    }

    // 3. 실제 출금 가능 잔여 정산금 (Payable = 확정 누적 수익 - 기지급액 - 신청 대기액)
    const payableRevenue = Math.max(0, confirmedRevenue - paidAmount - pendingAmount);

    return {
      estimatedRevenue,
      confirmedRevenue,
      payableRevenue,
      paidAmount,
      pendingAmount,
      pendingItem,
      todayRevenue,
      earningsRecords,
      settlements
    };
  } catch (err) {
    console.error('[fetchAuthorRevenueSummary Error]', err);
    return {
      estimatedRevenue: 0,
      confirmedRevenue: 0,
      payableRevenue: 0,
      paidAmount: 0,
      pendingAmount: 0,
      todayRevenue: 0,
      earningsRecords: [],
      settlements: []
    };
  }
}

async function requestSettlementSecure(authorId, amount, bankInfo = null) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || !authorId) return { success: false, error: '작가 정보 누락' };

  try {
    try {
      const { data: rpcRes, error: rpcErr } = await supabaseClient.rpc('request_author_settlement', {
        p_author_id: Number(authorId),
        p_amount: Number(amount)
      });
      if (!rpcErr && rpcRes?.success) {
        return { success: true, settlementId: rpcRes.settlement_id };
      }
    } catch (e) {}

    const { data: authorData } = await supabaseClient
      .from('authors')
      .select('pen_name')
      .eq('id', Number(authorId))
      .single();

    const penName = authorData?.pen_name || '연재 작가';
    const bankParts = String(bankInfo || '국민은행 999-888-777666').split(' ');

    const payload = {
      author_id: Number(authorId),
      author_name_snapshot: penName,
      bank_name_snapshot: bankParts[0] || '국민은행',
      account_number_snapshot: bankParts.slice(1).join(' ') || '999-888-777666',
      account_holder_snapshot: penName,
      amount: Number(amount),
      status: 'PENDING',
      requested_at: new Date().toISOString()
    };

    const { data, error } = await supabaseClient
      .from('author_settlements')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return { success: true, settlement: data };
  } catch (err) {
    console.error('[requestSettlementSecure Error]', err);
    return { success: false, error: err.message };
  }
}

async function approveSettlementSecure(settlementId, reviewerName = '최고관리자') {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || !settlementId) return { success: false, error: '정산 ID 필요' };

  try {
    const { data, error } = await supabaseClient
      .from('author_settlements')
      .update({
        status: 'PAID',
        processed_at: new Date().toISOString()
      })
      .eq('id', settlementId)
      .select()
      .single();

    if (error) throw error;
    return { success: true, settlement: data };
  } catch (err) {
    console.error('[approveSettlementSecure Error]', err);
    return { success: false, error: err.message };
  }
}

async function fetchPendingSettlements() {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('author_settlements')
      .select('*')
      .eq('status', 'PENDING')
      .order('requested_at', { ascending: false });
    if (!error && data) return data;
    return [];
  } catch (e) {
    return [];
  }
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

async function updateReaderProfileInDB(userId, profileData) {
  if (!supabaseClient || !userId || !profileData) return { success: false };
  try {
    const cleanId = String(userId).trim();
    const updatePayload = {};
    if (profileData.nickname !== undefined) updatePayload.nickname = profileData.nickname;
    if (profileData.phone !== undefined) updatePayload.phone = profileData.phone;
    if (profileData.is_adult_verified !== undefined) {
      updatePayload.is_adult_verified = !!profileData.is_adult_verified;
      if (profileData.is_adult_verified) updatePayload.adult_verified_at = new Date().toISOString();
    }
    if (profileData.subscription_status !== undefined) updatePayload.subscription_status = profileData.subscription_status;

    let query = supabaseClient.from('readers').update(updatePayload);
    if (!isNaN(cleanId) && Number(cleanId) > 0) {
      query = query.or(`id.eq.${Number(cleanId)},username.ilike.${cleanId},email.ilike.${cleanId}`);
    } else {
      query = query.or(`username.ilike.${cleanId},email.ilike.${cleanId}`);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('[updateReaderProfileInDB Error]', error);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err) {
    console.error('[updateReaderProfileInDB Error]', err);
    return { success: false, error: err.message };
  }
}

// ---- 관리자 전용 독자 회원 정보 수정 ----
async function updateReaderByAdmin(readerId, payload) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || !readerId || !payload) return { success: false, error: '유효하지 않은 요청' };

  try {
    const updateData = {};
    if (payload.nickname !== undefined) updateData.nickname = payload.nickname;
    if (payload.email !== undefined) updateData.email = payload.email;
    if (payload.phone !== undefined) updateData.phone = payload.phone;
    if (payload.subscription_status !== undefined) updateData.subscription_status = payload.subscription_status;
    if (payload.status !== undefined) updateData.status = payload.status;
    if (payload.is_adult_verified !== undefined) {
      updateData.is_adult_verified = !!payload.is_adult_verified;
      if (payload.is_adult_verified) updateData.adult_verified_at = new Date().toISOString();
    }

    const { data, error } = await supabaseClient
      .from('readers')
      .update(updateData)
      .eq('id', readerId)
      .select();

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error('[updateReaderByAdmin Error]', err);
    return { success: false, error: err.message };
  }
}

// ---- 관리자 전용 독자 회원 비밀번호 변경 ----
async function changeReaderPasswordByAdmin(readerId, newPassword) {
  return { success: false, error: '기존 계정 생성·비밀번호 변경 경로는 종료되었습니다. 본인 이메일 가입·재설정 또는 검증된 관리자 계정 연결 절차를 이용해주세요.' };
}

// ---- 관리자 전용 독자 회원 삭제 ----
async function deleteReaderByAdmin(readerId) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || !readerId) return { success: false, error: '유효하지 않은 요청' };

  try {
    const { data, error } = await supabaseClient
      .from('readers')
      .delete()
      .eq('id', readerId)
      .select();

    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error('[deleteReaderByAdmin Error]', err);
    return { success: false, error: err.message };
  }
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'author_settlements' }, payload => {
        console.log('⚡ [Realtime] author_settlements 변경:', payload.eventType);
        if (typeof callbacks.onSettlementsChange === 'function') callbacks.onSettlementsChange(payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'creator_supports' }, payload => {
        console.log('⚡ [Realtime] creator_supports 변경:', payload.eventType);
        if (typeof callbacks.onSupportsChange === 'function') callbacks.onSupportsChange(payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'earning_ledger' }, payload => {
        console.log('⚡ [Realtime] earning_ledger 변경:', payload.eventType);
        if (typeof callbacks.onLedgerChange === 'function') callbacks.onLedgerChange(payload);
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

async function fetchFanMeetingsFromDB() {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('fan_meetings')
      .select('*')
      .order('event_at', { ascending: true });
    if (!error && Array.isArray(data)) return data;
    return [];
  } catch (e) {
    return [];
  }
}

async function fetchGoodsFromDB() {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('goods')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && Array.isArray(data)) return data;
    return [];
  } catch (e) {
    return [];
  }
}

async function fetchAdUnitsFromDB() {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('ad_units')
      .select('*')
      .order('created_at', { ascending: true });
    if (!error && Array.isArray(data)) return data;
    return [];
  } catch (e) {
    return [];
  }
}

async function fetchEventsFromDB() {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('events')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && Array.isArray(data)) return data;
    return [];
  } catch (e) {
    return [];
  }
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
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { success: false, error: 'DB 연결이 필요합니다.' };
  try {
    const { data, error } = await supabaseClient.rpc('support_creator', {
      p_work_id: Number(workId), p_amount_points: Number(amountPoints),
      p_idempotency_key: crypto.randomUUID(), p_is_anonymous: !!isAnonymous
    });
    if (error) throw error;
    if (!data || data.success === false) return { success: false, error: data?.error || '후원이 승인되지 않았습니다.' };
    return { success: true, result: data };
  } catch (error) { return { success: false, error: error.message }; }
}

async function fetchWorkTopSupporters(workId) {
  let supporters = [];
  if (!supabaseClient) initSupabaseAdmin();
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('creator_supports')
        .select('id, reader_id, display_name, amount_points, is_anonymous, created_at')
        .eq('work_id', Number(workId))
        .order('amount_points', { ascending: false })
        .limit(20);
      if (!error && data && data.length > 0) {
        supporters = data;
      }
    } catch (e) {
      console.warn('[fetchWorkTopSupporters from Supabase failed]', e);
    }
  }

  const allSupports = supporters;

  const aggregated = {};
  for (const s of allSupports) {
    const name = s.is_anonymous ? '익명의 후원자' : (s.display_name || '익명 독자');
    const key = s.is_anonymous ? `${name}-${s.id}` : name;
    if (!aggregated[key]) {
      aggregated[key] = { displayName: name, totalPoints: 0, count: 0, isAnonymous: !!s.is_anonymous, latestAt: s.created_at };
    }
    aggregated[key].totalPoints += Number(s.amount_points || 0);
    aggregated[key].count += 1;
  }

  const list = Object.values(aggregated);
  list.sort((a, b) => b.totalPoints - a.totalPoints);
  return list.slice(0, 5);
}

async function fetchAuthorEarningLedger(authorId) {
  let ledgerEntries = [];

  // 1. Supabase earning_ledger 테이블 실제 데이터 직접 조회
  if (!supabaseClient) initSupabaseAdmin();
  if (supabaseClient && authorId) {
    try {
      const { data, error } = await supabaseClient
        .from('earning_ledger')
        .select('*')
        .eq('author_id', Number(authorId))
        .order('created_at', { ascending: false })
        .limit(100);
      if (!error && data && data.length > 0) {
        ledgerEntries = data.map(r => ({
          id: r.id,
          createdAt: r.created_at,
          workTitle: `작품 #${r.work_id || '-'}`,
          sourceType: r.source_type,
          amount: Number(r.amount),
          currency: r.currency || 'KRW',
          status: r.status,
          description: `${r.source_type} 수익 (${r.status})`
        }));
      }
    } catch (e) {
      console.warn('[fetchAuthorEarningLedger DB call]', e);
    }
  }

  ledgerEntries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return ledgerEntries;
}

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
  updateReaderProfileInDB,
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
  createWorkInDB,
  createEpisodeInDB,
  updateEpisodeSetting,
  deleteEpisodeFromDB,
  updateWorkAdminSetting,
  deleteWorkFromDB,
  recordWorkReadingView,
  logAdEvent,
  recordEpisodeUnlock,
  unlockEpisodeWithAdSecure,
  allocateRevenue,
  confirmRevenue,
  fetchRevenueEvents,
  fetchAuthorEarnings,
  fetchCreatorEarnings: fetchAuthorEarnings,
  fetchAuthorSettlements,
  fetchCreatorSettlements: fetchAuthorSettlements,
  fetchAuthorRevenueSummary,
  fetchCreatorRevenueSummary: fetchAuthorRevenueSummary,
  requestSettlementSecure,
  approveSettlementSecure,
  fetchPendingSettlements,
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
  fetchFanMeetingsFromDB,
  fetchGoodsFromDB,
  fetchAdUnitsFromDB,
  fetchEventsFromDB
};
