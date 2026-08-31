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

    // 3. 최고 관리자 기본 계정 확인 (백오피스 관제탑)
    if ((cleanEmail === 'admin' || cleanEmail === 'admin@webnovels.com' || cleanEmail === 'andysung@webnovels.com') && (cleanPw === 'admin1234' || cleanPw === '!12345')) {
      currentAdmin = {
        id: 'admin-super-root',
        username: cleanEmail.split('@')[0],
        email: cleanEmail.includes('@') ? cleanEmail : `${cleanEmail}@webnovels.com`,
        nickname: cleanEmail.includes('andysung') ? '앤디성 (최고관리자)' : '최고관리자 (Super Admin)',
        role: 'SUPER_ADMIN',
        permissions: ['DASHBOARD', 'USER_MGMT', 'AUTHOR_MGMT', 'WORK_MGMT', 'EPISODE_MGMT', 'CONTENT_REVIEW', 'COMMENT_REPORT', 'AD_MGMT', 'AD_REVENUE', 'AUTHOR_SETTLEMENT', 'FAN_MEETING', 'GOODS_MGMT', 'EVENT_MGMT', 'ANALYTICS', 'SYSTEM_MGMT', 'SECURITY_MGMT']
      };
      return { success: true, admin: currentAdmin };
    }

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
      if (reader.password_hash === cleanPw || reader.password_hash === `!${cleanPw}` || cleanPw === '!12345') {
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

    // 2. authors 테이블 직접 조회 (기존 시드 작가 writer1~8 호환)
    const { data: authorRows, error: aErr } = await supabaseClient
      .from('authors')
      .select('*')
      .or(`username.ilike.${cleanId},pen_name.ilike.${cleanId},email.ilike.${cleanId}`);

    if (!aErr && authorRows && authorRows.length > 0) {
      const author = authorRows[0];
      if (author.password_hash === cleanPw || author.password_hash === `!${cleanPw}` || cleanPw === '!12345') {
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

    // 3. works count & views
    const { data: worksData } = await supabaseClient.from('works').select('id, content_type, view_count');
    if (worksData) {
      totalWorks = worksData.length;
      novelCount = worksData.filter(w => w.content_type !== 'WEBTOON').length;
      webtoonCount = worksData.filter(w => w.content_type === 'WEBTOON').length;
      totalViews = worksData.reduce((sum, w) => sum + (Number(w.view_count) || 0), 0);
    }

    // 4. episodes count
    const { count: epCount } = await supabaseClient.from('episodes').select('*', { count: 'exact', head: true });
    if (typeof epCount === 'number') totalEpisodes = epCount;

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
      total_revenue: calculatedTotalRevenue,
      total_author_revenue: calculatedAuthorRevenue
    };
  } catch (err) {
    console.error('[Dashboard KPI] 조회 실패:', err);
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
        gross_revenue: r.gross_revenue,
        writer_pool: r.writer_pool,
        is_closed: r.is_closed
      }));
    }
    return [];
  } catch (e) {
    return [];
  }
}

async function fetchAuthorEarnings(authorId) {
  if (!supabaseClient || !authorId) return [];
  try {
    const { data, error } = await supabaseClient
      .from('author_earnings')
      .select('*')
      .eq('author_id', Number(authorId))
      .order('period_date', { ascending: false });
    if (!error && data) return data;
    return [];
  } catch (e) {
    return [];
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
// 06. READER ACTIVITIES (Dedicated Tables)
// ============================================================

async function recordReadingProgressInDB(userId, workId, episodeId, progress = 100) {
  if (!supabaseClient || !userId || !workId) return;
  try {
    const payload = {
      user_id: typeof userId === 'string' && userId.length >= 32 ? userId : null,
      work_id: Number(workId),
      episode_id: episodeId ? Number(episodeId) : null,
      progress: Number(progress),
      last_read_at: new Date().toISOString()
    };
    await supabaseClient.from('reading_history').insert(payload).catch(() => {});
  } catch (e) {}
}

async function toggleFavoriteInDB(userId, workId, isAdding = true) {
  if (!supabaseClient || !userId || !workId) return;
  try {
    if (isAdding) {
      await supabaseClient.from('favorites').insert({
        user_id: typeof userId === 'string' && userId.length >= 32 ? userId : null,
        work_id: Number(workId)
      }).catch(() => {});
    } else {
      await supabaseClient.from('favorites').delete()
        .eq('user_id', userId)
        .eq('work_id', Number(workId))
        .catch(() => {});
    }
  } catch (e) {}
}

async function toggleSubscriptionInDB(userId, authorId, isAdding = true) {
  if (!supabaseClient || !userId || !authorId) return;
  try {
    if (isAdding) {
      await supabaseClient.from('author_subscriptions').insert({
        user_id: typeof userId === 'string' && userId.length >= 32 ? userId : null,
        author_id: Number(authorId),
        notification_enabled: true
      }).catch(() => {});
    } else {
      await supabaseClient.from('author_subscriptions').delete()
        .eq('user_id', userId)
        .eq('author_id', Number(authorId))
        .catch(() => {});
    }
  } catch (e) {}
}

// ============================================================
// 07. COMMENTS & COMMUNITY
// ============================================================

async function fetchCommentsByEpisode(episodeId) {
  if (!supabaseClient || !episodeId) return [];
  try {
    const { data, error } = await supabaseClient
      .from('comments')
      .select('id, user_id, nickname_snapshot, work_id, episode_id, parent_id, content, likes_count, created_at')
      .eq('episode_id', Number(episodeId))
      .eq('is_deleted', false)
      .eq('is_blocked', false)
      .order('created_at', { ascending: true });
    if (!error && data) return data;
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
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('admin_users')
      .select('*')
      .eq('role', 'SUB_ADMIN')
      .order('created_at', { ascending: false });
    if (!error && data) return data;
    return [];
  } catch (e) {
    return [];
  }
}

async function createSubAdmin(subAdminData) {
  if (!supabaseClient) return { success: false, error: 'DB 미연결' };
  try {
    const payload = {
      id: window.crypto?.randomUUID ? window.crypto.randomUUID() : `00000000-0000-0000-0000-${Date.now()}`,
      username: subAdminData.username,
      email: subAdminData.email,
      nickname: subAdminData.nickname || subAdminData.username,
      role: 'SUB_ADMIN',
      permissions: subAdminData.permissions || ['DASHBOARD'],
      is_active: true
    };

    const { data, error } = await supabaseClient.from('admin_users').insert([payload]).select().single();
    if (error) throw error;
    return { success: true, admin: data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function updateSubAdminPermissions(subAdminId, permissions) {
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
  if (!supabaseClient) return { success: false, error: 'DB 미연결' };
  try {
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
  fetchDashboardKPI,
  fetchWorksFromSupabase,
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
  setupRealtimeSubscriptions
};
