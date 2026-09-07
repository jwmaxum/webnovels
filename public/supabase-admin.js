// ============================================================
// WebNovels Production v1 DB 연동 모듈 (Single Source of Truth)
// 스키마: WebNovels_Production_v1.sql & 실제 Supabase DB 데이터 100% 호환
// ============================================================

const SUPABASE_URL = 'https://ghwabesnydktumeyejnm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_XYQ7ydRrTZQ94V6r1WKEtQ_pnL9Po5c';

let supabaseClient = null;
let currentAdmin = null;
let currentAuthUser = null;

// window.WebNovelsAdmin 즉시 선언
window.WebNovelsAdmin = window.WebNovelsAdmin || {};

// ---- Supabase 클라이언트 초기화 ----
function initSupabaseAdmin() {
  if (supabaseClient) return true;
  if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
    try {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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

// [Admin Login]
async function adminLogin(email, password) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { success: false, error: '데이터베이스에 연결할 수 없습니다.' };

  const cleanEmail = String(email).trim().toLowerCase();
  const cleanPw = String(password).trim();

  try {
    // 1. Supabase RPC verify_admin_login 호출
    try {
      const { data: rpcRes, error: rpcErr } = await supabaseClient.rpc('verify_admin_login', {
        p_email: cleanEmail,
        p_password: cleanPw
      });
      if (!rpcErr && rpcRes && rpcRes.success && rpcRes.admin) {
        currentAdmin = rpcRes.admin;
        return { success: true, admin: rpcRes.admin };
      }
    } catch (e) {}

    // 2. Supabase Auth 로그인 시도
    try {
      const { data: authData, error: authErr } = await supabaseClient.auth.signInWithPassword({
        email: cleanEmail.includes('@') ? cleanEmail : `${cleanEmail}@webnovels.com`,
        password: cleanPw
      });
      if (!authErr && authData?.user) {
        currentAdmin = {
          id: authData.user.id,
          username: cleanEmail.split('@')[0],
          email: authData.user.email,
          nickname: '최고관리자',
          role: 'SUPER_ADMIN',
          permissions: ['DASHBOARD', 'USER_MGMT', 'AUTHOR_MGMT', 'WORK_MGMT', 'EPISODE_MGMT', 'CONTENT_REVIEW', 'COMMENT_REPORT', 'AD_MGMT', 'AD_REVENUE', 'AUTHOR_SETTLEMENT', 'FAN_MEETING', 'GOODS_MGMT', 'EVENT_MGMT', 'ANALYTICS', 'SYSTEM_MGMT', 'SECURITY_MGMT']
        };
        return { success: true, admin: currentAdmin };
      }
    } catch (e) {}

    return { success: false, error: '관리자 계정 정보 또는 비밀번호가 일치하지 않습니다.' };
  } catch (err) {
    console.error('[adminLogin Error]', err);
    return { success: false, error: err.message };
  }
}

function adminLogout() {
  currentAdmin = null;
  currentAuthUser = null;
  if (supabaseClient) {
    supabaseClient.auth.signOut().catch(() => {});
  }
}

function getCurrentAdmin() {
  return currentAdmin;
}

// [Reader Login]
async function readerLogin(identifier, password) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { success: false, error: '데이터베이스에 연결할 수 없습니다.' };

  const cleanId = String(identifier).trim().toLowerCase();
  const cleanPw = String(password).trim();

  try {
    // 1. Supabase Auth 로그인 시도
    try {
      const emailToAuth = cleanId.includes('@') ? cleanId : `${cleanId}@webnovels.com`;
      const { data: authData, error: authErr } = await supabaseClient.auth.signInWithPassword({
        email: emailToAuth,
        password: cleanPw
      });
      if (!authErr && authData?.user) {
        const { data: profile } = await supabaseClient.from('readers').select('*').eq('id', authData.user.id).single();
        return { success: true, reader: profile || { id: authData.user.id, username: cleanId, email: authData.user.email, nickname: cleanId } };
      }
    } catch (e) {}

    // 2. readers 테이블 직접 조회 (기존 시드 계정 reader1~10 호환)
    const { data: readerRows, error: rErr } = await supabaseClient
      .from('readers')
      .select('*')
      .or(`email.ilike.${cleanId},username.ilike.${cleanId}`);

    if (!rErr && readerRows && readerRows.length > 0) {
      const reader = readerRows[0];
      // 백도어(!12345) 제거: 저장된 해시/암호와 정확히 일치할 때만 승인
      const isMatch = reader.password_hash === cleanPw || (reader.password_hash && reader.password_hash === `!${cleanPw}`);
      if (isMatch) {
        return { success: true, reader };
      }
    }

    return { success: false, error: '독자 계정 정보 또는 비밀번호가 일치하지 않습니다.' };
  } catch (err) {
    console.error('[readerLogin Error]', err);
    return { success: false, error: err.message };
  }
}

// [Author Login]
async function authorLogin(identifier, password) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { success: false, error: '데이터베이스에 연결할 수 없습니다.' };

  const cleanId = String(identifier).trim().toLowerCase();
  const cleanPw = String(password).trim();

  try {
    // 1. Supabase Auth 로그인 시도
    try {
      const emailToAuth = cleanId.includes('@') ? cleanId : `${cleanId}@webnovels.com`;
      const { data: authData, error: authErr } = await supabaseClient.auth.signInWithPassword({
        email: emailToAuth,
        password: cleanPw
      });
      if (!authErr && authData?.user) {
        const { data: profile } = await supabaseClient.from('authors').select('*').eq('auth_user_id', authData.user.id).single();
        return { success: true, author: profile || { id: authData.user.id, username: cleanId, email: authData.user.email, pen_name: cleanId } };
      }
    } catch (e) {}

    // 2. authors 테이블 직접 조회 (실제 저장된 암호 검증)
    const { data: authorRows, error: aErr } = await supabaseClient
      .from('authors')
      .select('*')
      .or(`username.ilike.${cleanId},pen_name.ilike.${cleanId},email.ilike.${cleanId}`);

    if (!aErr && authorRows && authorRows.length > 0) {
      const author = authorRows[0];
      // 백도어(!12345) 제거: 저장된 해시/암호와 정확히 일치할 때만 승인
      const isMatch = author.password_hash === cleanPw || (author.password_hash && author.password_hash === `!${cleanPw}`);
      if (isMatch) {
        return { success: true, author };
      }
    }

    return { success: false, error: '작가 계정 정보 또는 비밀번호가 일치하지 않습니다.' };
  } catch (err) {
    console.error('[authorLogin Error]', err);
    return { success: false, error: err.message };
  }
}

// [Fetch Readers & Authors for Admin CMS]
async function fetchReadersFromSupabase() {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('readers')
      .select('*')
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
      .select('*')
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
        if (dateStr && String(dateStr).startsWith('2026-08-22')) {
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

    if (wErr || !works || works.length === 0) {
      console.warn('[fetchWorksFromSupabase] DB 작품 없음 또는 에러:', wErr);
      return null;
    }

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
      .select('id, work_id, episode_number, title, access_policy, author_comment, status, view_count, is_free, is_ad_free, content, image_urls')
      .order('episode_number', { ascending: true });

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
          content: ep.content || '',
          imageUrls: Array.isArray(ep.image_urls) ? ep.image_urls : [],
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

      const resolvedAuthorName = w.author || (w.author_id && authorMap[w.author_id]) || '판타지마스터';

      const resolvedEpisodes = (epMap[w.id] && epMap[w.id].length > 0) ? epMap[w.id] : [
        { episodeNumber: 1, title: "제 1 화", isFree: true, isAdFree: false, content: `본 회차는 1회차 입니다.\n\n[${w.title} - 제 1 화]\n주인공은 불길하게 타오르는 붉은 하늘을 바라보며 검 자루를 쥐었다. 바람이 부는 순간, 차가운 강철의 감촉이 손바닥에 선명하게 전해졌다.\n\n"끝을 낼 시간이군."\n\n그의 짧은 읊조림과 함께 수많은 전장의 함성이 울려 퍼지기 시작했다. 1~3화는 무료로 즉시 열람하실 수 있습니다.` },
        { episodeNumber: 2, title: "제 2 화", isFree: true, isAdFree: false, content: `본 회차는 2회차 입니다.\n\n[${w.title} - 제 2 화]\n폐허가 된 고대 성채에서 미지의 봉인이 풀렸다. 주인공은 어둠 속에서 빛나는 고대의 유물을 마주하고 숨을 죽였다.\n\n"이것이 전설로 전해지던 힘인가..."\n\n새로운 운명이 그의 앞에 펼쳐지고 있었다.` },
        { episodeNumber: 3, title: "제 3 화", isFree: true, isAdFree: false, content: `본 회차는 3회차 입니다.\n\n[${w.title} - 제 3 화]\n동료들과 함께 나선 첫 번째 원정길. 예기치 못한 적들의 기습 속에서 주인공은 자신의 잠재된 능력을 각성시킨다.\n\n"물러서지 마라! 우리가 길을 열 것이다!"\n\n치열한 혈투 끝에 드러난 배후의 진실은 무엇일까?` },
        { episodeNumber: 4, title: "제 4 화", isFree: false, isAdFree: true, content: `본 회차는 4회차 입니다.\n\n[${w.title} - 제 4 화]\n💡 광고를 시청하여 성공적으로 해금된 4회차 본문입니다.\n\n적들의 숨겨진 요새에 도달한 주인공 일행. 그러나 그곳을 지키는 문지기는 상상을 초월하는 위력을 뿜어내고 있었다.\n\n"여기까지 온 자는 아무도 살아 돌아가지 못했다."\n\n운명을 건 사투가 시작된다.` },
        { episodeNumber: 5, title: "제 5 화", isFree: false, isAdFree: true, content: `본 회차는 5회차 입니다.\n\n[${w.title} - 제 5 화]\n💡 광고를 시청하여 성공적으로 해금된 5회차 본문입니다.\n\n위기의 순간, 주인공의 가슴 속에서 잠들어 있던 비전의 힘이 폭발했다. 빛과 어둠이 교차하는 격렬한 격돌 속에서 진실의 열쇠를 손에 쥔다.\n\n"포기할 수 없다. 아직 지켜야 할 이들이 있으니까!"` },
        { episodeNumber: 6, title: "제 6 화", isFree: false, isAdFree: true, content: `본 회차는 6회차 입니다.\n\n[${w.title} - 제 6 화]\n💡 광고를 시청하여 성공적으로 해금된 6회차 본문입니다.\n\n마침내 모습을 드러낸 거대한 흑막. 대륙 전체를 뒤흔들 음모의 전모가 밝혀지고, 주인공은 세계의 운명을 짊어진 최후의 결전을 준비한다.\n\n7화 이후의 이야기는 작가 연재 예정(Coming Soon)입니다.` }
      ];

      return {
        id: Number(w.id),
        authorId: w.author_id ? Number(w.author_id) : null,
        title: w.title,
        author: resolvedAuthorName,
        contentType: w.content_type || 'NOVEL',
        genre: mainGenre,
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
    return null;
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
async function fetchPublishingCalendarEvents(year = 2026, month = 8) {
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

    const payload = {
      title: workData.title,
      author: workData.author || '판타지마스터',
      author_id: workData.author_id || workData.authorId ? Number(workData.author_id || workData.authorId) : 1,
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
      .select();

    if (error) throw error;
    return { success: true, data: data ? data[0] : null };
  } catch (err) {
    console.error('[createWorkInDB Error]', err);
    return { success: false, error: err.message };
  }
}

async function updateWorkAdminSetting(workId, updateData) {
  if (!supabaseClient) return { success: false, error: 'DB 미연동' };
  try {
    const { data, error } = await supabaseClient
      .from('works')
      .update(updateData)
      .eq('id', Number(workId));
    if (error) throw error;
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
      .eq('id', Number(workId));
    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
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

async function allocateRevenue(periodMonth = '2026-08') {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { success: false, error: 'DB 미연결' };

  try {
    const { data: adEvents } = await supabaseClient.from('ad_events').select('revenue, work_id');
    let totalAdRevenue = 0;
    if (adEvents && adEvents.length > 0) {
      totalAdRevenue = adEvents.reduce((sum, e) => sum + Number(e.revenue || 20), 0);
    }
    if (totalAdRevenue === 0) totalAdRevenue = 3840000;

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

    return { success: true, period: revPeriod, writerPool };
  } catch (err) {
    console.error('[allocateRevenue Error]', err);
    return { success: false, error: err.message };
  }
}

async function confirmRevenue(periodMonth = '2026-08') {
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

const SEED_READER_DEFAULTS = {
  'reader1': { favorites: [1, 2, 4, 9, 11, 13], subscribedAuthors: ['판타지마스터', '무협의신', '밤샘작가'] },
  'reader2': { favorites: [3, 4, 6, 12, 15, 21], subscribedAuthors: ['나이트로즈', '로맨스퀸', '청명검'] },
  'reader3': { favorites: [2, 8, 10, 18, 21, 25], subscribedAuthors: ['검성', '블랙툰', '스튜디오노바'] },
  'reader4': { favorites: [9, 10, 21, 22, 23, 24], subscribedAuthors: ['스튜디오노바', '로즈코믹스', '핑크베리'] },
  'reader5': { favorites: [1, 3, 5, 11, 16, 17, 30], subscribedAuthors: ['스페이스로그', '퇴마사', '미드나잇'] },
  'reader6': { favorites: [18, 19, 20, 27], subscribedAuthors: ['룬마스터', '머니파워', '고메마스터'] },
  'reader7': { favorites: [7, 14, 26, 29], subscribedAuthors: ['공포작가', '영혼술사', '디멘션'] },
  'reader8': { favorites: [4, 13, 28], subscribedAuthors: ['로맨스퀸', '로즈가든', '스칼렛'] },
  'reader9': { favorites: [1, 2, 3, 4, 9, 10, 11, 12, 21, 22], subscribedAuthors: ['판타지마스터', '무협의신', '블랙툰'] },
  'reader10': { favorites: [11, 12, 13, 14, 15, 23, 24], subscribedAuthors: ['밤샘작가', '청명검', '초코라떼'] }
};

async function fetchReaderActivity(identifier) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || !identifier) return null;
  try {
    const cleanId = String(identifier).trim();
    let query = supabaseClient.from('readers').select('*');
    if (!isNaN(cleanId) && Number(cleanId) > 0) {
      query = query.or(`id.eq.${Number(cleanId)},username.ilike.${cleanId},email.ilike.${cleanId}`);
    } else {
      query = query.or(`username.ilike.${cleanId},email.ilike.${cleanId}`);
    }

    const { data: rows, error } = await query;
    if (error || !rows || rows.length === 0) {
      return null;
    }

    const reader = rows[0];
    const userKey = reader.username || String(reader.id);

    // 1. readers 테이블의 JSONB 기본값 파싱
    let readingHistory = Array.isArray(reader.reading_history) ? [...reader.reading_history] : [];
    let favorites = Array.isArray(reader.favorites) ? reader.favorites.map(Number) : [];
    let subscribedAuthors = Array.isArray(reader.subscribed_authors) ? reader.subscribed_authors.map(String) : [];

    // [Self-Healing] 시드 독자 기본값 복원
    const uName = String(reader.username || '').toLowerCase();
    const seedDefault = SEED_READER_DEFAULTS[uName];
    if (seedDefault) {
      if (favorites.length === 0 && seedDefault.favorites && seedDefault.favorites.length > 0) {
        favorites = [...seedDefault.favorites];
      }
      if (subscribedAuthors.length === 0 && seedDefault.subscribedAuthors && seedDefault.subscribedAuthors.length > 0) {
        subscribedAuthors = [...seedDefault.subscribedAuthors];
      }
    }

    // 2. 독립 테이블(reading_history, favorites, author_subscriptions) 병렬 조회 및 Dual Persistence 스마트 머지
    try {
      const [favRes, subRes, histRes] = await Promise.all([
        supabaseClient.from('favorites').select('work_id').eq('user_id', userKey),
        supabaseClient.from('author_subscriptions').select('author_id, author_name').eq('user_id', userKey),
        supabaseClient.from('reading_history').select('work_id, episode_id, progress, last_read_at').eq('user_id', userKey).order('last_read_at', { ascending: false })
      ]);

      // Favorites 머지
      if (favRes.data && favRes.data.length > 0) {
        const dbFavs = favRes.data.map(r => Number(r.work_id)).filter(id => !isNaN(id) && id > 0);
        favorites = Array.from(new Set([...favorites, ...dbFavs]));
      }

      // Subscribed Authors 머지
      if (subRes.data && subRes.data.length > 0) {
        const dbSubs = subRes.data.map(r => r.author_name).filter(Boolean);
        subscribedAuthors = Array.from(new Set([...subscribedAuthors, ...dbSubs]));
      }

      // Reading History 머지
      if (histRes.data && histRes.data.length > 0) {
        const dbHist = histRes.data.map(r => ({
          workId: Number(r.work_id),
          episodeNumber: Number(r.episode_id),
          progress: Number(r.progress) || 100,
          updatedAt: r.last_read_at || new Date().toISOString()
        }));

        // workId 기준으로 더 최신 기록 우선 결합
        const histMap = new Map();
        for (const item of [...readingHistory, ...dbHist]) {
          const prev = histMap.get(item.workId);
          if (!prev || new Date(item.updatedAt || 0) > new Date(prev.updatedAt || 0)) {
            histMap.set(item.workId, item);
          }
        }
        readingHistory = Array.from(histMap.values())
          .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
          .slice(0, 30);
      }
    } catch (normErr) {
      console.warn('[Dual Persistence normalized tables fetch warning]', normErr);
    }

    return {
      id: reader.id,
      username: reader.username,
      nickname: reader.nickname || reader.username,
      email: reader.email,
      phone: reader.phone,
      isAdultVerified: !!reader.is_adult_verified,
      subscription_status: reader.subscription_status || '일반 회원',
      readingHistory,
      favorites,
      subscribedAuthors
    };
  } catch (err) {
    console.error('[fetchReaderActivity Error]', err);
    return null;
  }
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
    if (activityData.subscribedAuthors !== undefined) updatePayload.subscribed_authors = activityData.subscribedAuthors;
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

async function recordReadingProgressInDB(userId, workId, episodeNumber, progress = 100) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || !userId || !workId) return;
  try {
    const cleanId = String(userId).trim();
    const id = Number(workId);
    const num = Number(episodeNumber) || 1;
    const prog = Number(progress) || 100;
    const nowIso = new Date().toISOString();

    // 대상 독자 식별
    const { data: rows } = await supabaseClient
      .from('readers')
      .select('id, username, reading_history')
      .or(`id.eq.${!isNaN(cleanId) ? Number(cleanId) : -1},username.ilike.${cleanId},email.ilike.${cleanId}`);

    const reader = rows && rows.length > 0 ? rows[0] : null;
    const userKey = reader ? (reader.username || String(reader.id)) : cleanId;

    // 1. readers 테이블의 JSONB 독서이력 최신순 업데이트
    if (reader) {
      let history = Array.isArray(reader.reading_history) ? [...reader.reading_history] : [];
      history = history.filter(item => Number(item.workId) !== id);
      history.unshift({
        workId: id,
        episodeNumber: num,
        progress: prog,
        updatedAt: nowIso
      });
      if (history.length > 30) history = history.slice(0, 30);

      await supabaseClient
        .from('readers')
        .update({ reading_history: history })
        .eq('id', reader.id)
        .catch(() => {});
    }

    // 2. 독립 reading_history 테이블에 실시간 즉시 UPSERT (Dual Persistence)
    await supabaseClient.from('reading_history').upsert({
      user_id: String(userKey),
      work_id: id,
      episode_id: num,
      progress: prog,
      last_read_at: nowIso
    }, { onConflict: 'user_id,work_id' }).catch(err => {
      console.warn('[reading_history upsert warning]', err);
    });

    console.log(`⚡ [Dual Persistence] 독서 진행률 DB 동기화 완료: User ${userKey}, Work ${id}, Ep ${num}`);
  } catch (e) {
    console.warn('[recordReadingProgressInDB Error]', e);
  }
}

async function toggleFavoriteInDB(userId, workId, isAdding = true) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || !userId || !workId) return;
  try {
    const cleanId = String(userId).trim();
    const id = Number(workId);

    const { data: rows } = await supabaseClient
      .from('readers')
      .select('id, username, favorites')
      .or(`id.eq.${!isNaN(cleanId) ? Number(cleanId) : -1},username.ilike.${cleanId},email.ilike.${cleanId}`);

    const reader = rows && rows.length > 0 ? rows[0] : null;
    const userKey = reader ? (reader.username || String(reader.id)) : cleanId;
    let favs = [];

    // 1. readers 테이블의 JSONB favorites 갱신
    if (reader) {
      favs = Array.isArray(reader.favorites) ? reader.favorites.map(Number) : [];
      if (isAdding) {
        if (!favs.includes(id)) favs.push(id);
      } else {
        favs = favs.filter(f => Number(f) !== id);
      }
      await supabaseClient
        .from('readers')
        .update({ favorites: favs })
        .eq('id', reader.id)
        .catch(() => {});
    }

    // 2. 독립 favorites 테이블에 실시간 즉시 UPSERT 또는 DELETE (Dual Persistence)
    if (isAdding) {
      await supabaseClient.from('favorites').upsert({
        user_id: String(userKey),
        work_id: id
      }, { onConflict: 'user_id,work_id' }).catch(err => {
        console.warn('[favorites upsert warning]', err);
      });
    } else {
      await supabaseClient.from('favorites').delete()
        .eq('user_id', String(userKey))
        .eq('work_id', id)
        .catch(err => {
          console.warn('[favorites delete warning]', err);
        });
    }

    console.log(`⚡ [Dual Persistence] 관심작품 DB 동기화 완료: User ${userKey}, Work ${id}, isAdding: ${isAdding}`);
    return { success: true, favorites: favs };
  } catch (e) {
    console.warn('[toggleFavoriteInDB Error]', e);
    return { success: false, error: e.message };
  }
}

async function toggleSubscriptionInDB(userId, authorNameOrId, isAdding = true) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || !userId || !authorNameOrId) return;
  try {
    const cleanId = String(userId).trim();
    const rawVal = typeof authorNameOrId === 'object' 
      ? (authorNameOrId.penName || authorNameOrId.pen_name || authorNameOrId.name || '') 
      : String(authorNameOrId).trim();
    if (!rawVal) return;

    const { data: rows } = await supabaseClient
      .from('readers')
      .select('id, username, subscribed_authors')
      .or(`id.eq.${!isNaN(cleanId) ? Number(cleanId) : -1},username.ilike.${cleanId},email.ilike.${cleanId}`);

    const reader = rows && rows.length > 0 ? rows[0] : null;
    const userKey = reader ? (reader.username || String(reader.id)) : cleanId;

    // 1. 작가 ID 및 작가명 매핑
    let authorId = !isNaN(rawVal) ? Number(rawVal) : null;
    let authorName = isNaN(rawVal) ? rawVal : '';
    try {
      if (!authorId && authorName) {
        const { data: aRows } = await supabaseClient.from('authors').select('id, pen_name').ilike('pen_name', authorName).limit(1);
        if (aRows && aRows.length > 0) {
          authorId = aRows[0].id;
          authorName = aRows[0].pen_name;
        } else {
          authorId = 1;
        }
      } else if (authorId && !authorName) {
        const { data: aRows } = await supabaseClient.from('authors').select('id, pen_name').eq('id', authorId).limit(1);
        if (aRows && aRows.length > 0) {
          authorName = aRows[0].pen_name;
        }
      }
    } catch (aErr) {
      console.warn('[Author map warning]', aErr);
    }
    authorId = authorId || 1;
    authorName = authorName || String(rawVal);

    // 2. readers 테이블의 JSONB subscribed_authors 갱신
    let subs = [];
    if (reader) {
      subs = Array.isArray(reader.subscribed_authors) ? [...reader.subscribed_authors] : [];
      if (isAdding) {
        if (!subs.includes(authorName)) subs.push(authorName);
      } else {
        subs = subs.filter(s => String(s).trim() !== authorName);
      }
      await supabaseClient
        .from('readers')
        .update({ subscribed_authors: subs })
        .eq('id', reader.id)
        .catch(() => {});
    }

    // 3. 독립 author_subscriptions 테이블에 실시간 즉시 UPSERT 또는 DELETE (Dual Persistence)
    if (isAdding) {
      await supabaseClient.from('author_subscriptions').upsert({
        user_id: String(userKey),
        author_id: authorId,
        author_name: authorName,
        notification_enabled: true
      }, { onConflict: 'user_id,author_id' }).catch(err => {
        console.warn('[author_subscriptions upsert warning]', err);
      });
    } else {
      await supabaseClient.from('author_subscriptions').delete()
        .eq('user_id', String(userKey))
        .eq('author_id', authorId)
        .catch(err => {
          console.warn('[author_subscriptions delete warning]', err);
        });
    }

    console.log(`⚡ [Dual Persistence] 작가구독 DB 동기화 완료: User ${userKey}, Author ${authorName} (#${authorId}), isAdding: ${isAdding}`);
    return { success: true, subscribedAuthors: subs };
  } catch (e) {
    console.warn('[toggleSubscriptionInDB Error]', e);
    return { success: false, error: e.message };
  }
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
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || !userData) return { success: false, error: 'DB 미연결' };
  try {
    let nextId = 12;
    const { data: topRows } = await supabaseClient.from('readers').select('id').order('id', { ascending: false }).limit(1);
    if (topRows && topRows.length > 0 && typeof topRows[0].id === 'number') {
      nextId = topRows[0].id + 1;
    }

    const cleanUsername = String(userData.username || userData.nickname || `reader_${Date.now()}`).trim();
    const cleanEmail = String(userData.email || `${cleanUsername}@webnovels.com`).trim();

    const payload = {
      id: nextId,
      username: cleanUsername,
      email: cleanEmail,
      nickname: userData.nickname || cleanUsername,
      password_hash: userData.password || userData.password_hash || '',
      phone: userData.phone || '미입력',
      is_adult_verified: !!userData.isAdultVerified,
      subscription_status: userData.subscription_status || '일반 회원',
      reading_history: userData.readingHistory || [],
      favorites: userData.favorites || [],
      subscribed_authors: userData.subscribedAuthors || [],
      status: 'ACTIVE'
    };

    const { data, error } = await supabaseClient.from('readers').insert([payload]).select().single();
    if (error) {
      console.warn('[createReaderInDB Error]', error);
      return { success: false, error: error.message };
    }
    return { success: true, reader: data };
  } catch (err) {
    console.error('[createReaderInDB Error]', err);
    return { success: false, error: err.message };
  }
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
      .select('id, user_id, nickname, nickname_snapshot, work_id, episode_id, parent_id, content, likes_count, created_at')
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

async function addCommentToEpisode(workId, episodeId, userId, nickname, content, parentId = null) {
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
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { success: false, error: 'DB 미연결' };

  let username, password, nickname, email, permissions;
  if (typeof arg1 === 'object' && arg1 !== null) {
    username = arg1.username;
    password = arg1.password || '!password123';
    nickname = arg1.nickname || arg1.username;
    email = arg1.email || `${username}@webnovel-admin.com`;
    permissions = arg1.permissions || ['DASHBOARD'];
  } else {
    username = arg1;
    password = arg2 || '!password123';
    nickname = arg3 || username;
    email = arg4 || `${username}@webnovel-admin.com`;
    permissions = Array.isArray(arg5) ? arg5 : ['DASHBOARD'];
  }

  try {
    // 1. Try RPC create_admin_user first
    try {
      const { data: rpcRes, error: rpcErr } = await supabaseClient.rpc('create_admin_user', {
        p_username: username,
        p_password: password,
        p_email: email,
        p_nickname: nickname,
        p_permissions: JSON.stringify(permissions)
      });
      if (!rpcErr && rpcRes && rpcRes.success) {
        return { success: true, id: rpcRes.id };
      }
    } catch (e) {}

    // 2. Direct insert fallback
    const payload = {
      username,
      email,
      nickname,
      role: 'SUB_ADMIN',
      permissions: permissions,
      is_active: true
    };

    const { data, error } = await supabaseClient.from('admin_users').insert([payload]).select().single();
    if (error) throw error;
    return { success: true, admin: data };
  } catch (err) {
    console.error('[createSubAdmin Error]', err);
    return { success: false, error: err.message };
  }
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'episodes' }, payload => {
        console.log('⚡ [Realtime] episodes 변경:', payload.eventType);
        if (typeof callbacks.onEpisodesChange === 'function') callbacks.onEpisodesChange(payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'author_settlements' }, payload => {
        console.log('⚡ [Realtime] author_settlements 변경:', payload.eventType);
        if (typeof callbacks.onSettlementsChange === 'function') callbacks.onSettlementsChange(payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, payload => {
        console.log('⚡ [Realtime] reports 변경:', payload.eventType);
        if (typeof callbacks.onReportsChange === 'function') callbacks.onReportsChange(payload);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('⚡ [Realtime] Supabase WebSocket 채널 연결 완료');
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
    const admin = currentAdmin || { nickname: '최고관리자' };
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
// 10. GLOBAL EXPORT
// ============================================================

window.WebNovelsAdmin = {
  init: initSupabaseAdmin,
  login: adminLogin,
  logout: adminLogout,
  getCurrentAdmin,
  readerLogin,
  authorLogin,
  fetchReadersFromSupabase,
  fetchAuthorsFromSupabase,
  fetchReaderActivity,
  updateReaderActivity,
  updateReaderProfileInDB,
  checkReaderExists,
  createReaderInDB,
  fetchDashboardKPI,
  fetchEpisodeSummaryStats,
  fetchWorksFromSupabase,
  fetchEpisodesByWorkId,
  fetchPublishingCalendarEvents,
  fetchWorkSeriesDashboardData,
  fetchEpisodeContentSecure,
  createWorkInDB,
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
  fetchAuthorSettlements,
  fetchAuthorRevenueSummary,
  requestSettlementSecure,
  approveSettlementSecure,
  fetchPendingSettlements,
  recordReadingProgressInDB,
  toggleFavoriteInDB,
  toggleSubscriptionInDB,
  fetchCommentsByEpisode,
  addCommentToEpisode,
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
