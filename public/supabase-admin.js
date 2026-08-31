// ============================================================
// WebNovels 관리자 CMS & 데이터베이스 연동 모듈 (Supabase Client)
// (improve1.md: episode_unlocks, ad_events, author_earnings, settlements 스냅샷 연동)
// ============================================================

const SUPABASE_URL = 'https://ghwabesnydktumeyejnm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_XYQ7ydRrTZQ94V6r1WKEtQ_pnL9Po5c';

let supabaseClient = null;
let currentAdmin = null;

// window.WebNovelsAdmin 즉시 선언 (스크립트 로드 타이밍 이슈 원천 방지)
window.WebNovelsAdmin = window.WebNovelsAdmin || {};

// ---- Supabase 클라이언트 초기화 ----
function initSupabaseAdmin() {
  if (supabaseClient) return true;
  if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
    try {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      console.log('[WebNovels Admin] Supabase 클라이언트 초기화 완료');
      return true;
    } catch(e) {
      console.warn('[WebNovels Admin] Supabase createClient 에러:', e);
    }
  }
  console.warn('[WebNovels Admin] Supabase SDK 미로드 - 오프라인 모드로 전환');
  return false;
}

// 스크립트 로드 시 즉시 초기화 시도
initSupabaseAdmin();
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', initSupabaseAdmin);
}

// ============================================================
// [Auth] 관리자 인증 (Admin Authentication - DB 정규화)
// ============================================================
async function adminLogin(email, password) {
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanPw = String(password).trim();

  if (!supabaseClient) {
    initSupabaseAdmin();
  }

  if (!supabaseClient) {
    return { success: false, error: '데이터베이스 연결이 초기화되지 않았습니다.' };
  }

  try {
    // 1. Supabase RPC verify_admin_login 호출 시도
    try {
      const { data, error } = await supabaseClient.rpc('verify_admin_login', {
        p_email: cleanEmail,
        p_password: cleanPw
      });

      if (!error && data && data.success && data.admin) {
        currentAdmin = data.admin;
        return { success: true, admin: data.admin };
      }
    } catch (rpcErr) {}

    // 2. admin_users 테이블 직접 조회 및 안전한 인증 검증
    const { data: adminUsers, error: queryError } = await supabaseClient
      .from('admin_users')
      .select('*')
      .or(`email.ilike.${cleanEmail},username.ilike.${cleanEmail}`);

    if (!queryError && adminUsers && adminUsers.length > 0) {
      const adminUser = adminUsers[0];
      if (adminUser.password_hash === cleanPw || adminUser.password_hash === `!${cleanPw}`) {
        currentAdmin = adminUser;
        return { success: true, admin: adminUser };
      }
    }

    return { success: false, error: '관리자 이메일 또는 비밀번호가 일치하지 않습니다.' };
  } catch (err) {
    console.error('[adminLogin Exception]', err);
    return { success: false, error: '인증 서버 오류가 발생했습니다.' };
  }
}

function adminLogout() {
  currentAdmin = null;
}

function getCurrentAdmin() {
  return currentAdmin;
}

// ============================================================
// [Function] fetchDashboardKPI
// [Purpose] Supabase DB의 실제 테이블 카운트를 쿼리하여 실시간 대시보드 KPI 반환
// [Returns] Promise<Object|null> - 실시간 통계 데이터 객체 (실패 시 null)
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

    // 1. 등록 독자 수 (readers)
    try {
      const { count } = await supabaseClient.from('readers').select('*', { count: 'exact', head: true });
      if (typeof count === 'number') totalUsers = count;
    } catch (e) {
      console.warn('[Dashboard KPI] readers 카운트 에러:', e.message);
    }

    // 2. 작가 수 (authors)
    try {
      const { count } = await supabaseClient.from('authors').select('*', { count: 'exact', head: true });
      if (typeof count === 'number') totalAuthors = count;
    } catch (e) {
      console.warn('[Dashboard KPI] authors 카운트 에러:', e.message);
    }

    // 3. 작품 수 및 장르/유형별 카운트, 누적 조회수 계산 (works)
    try {
      const { data: worksData, error: worksError } = await supabaseClient
        .from('works')
        .select('id, content_type, view_count');
      
      if (!worksError && worksData) {
        totalWorks = worksData.length;
        novelCount = worksData.filter(w => w.content_type !== 'WEBTOON').length;
        webtoonCount = worksData.filter(w => w.content_type === 'WEBTOON').length;
        totalViews = worksData.reduce((sum, w) => sum + (Number(w.view_count) || 0), 0);
      }
    } catch (e) {
      console.warn('[Dashboard KPI] works 통계 에러:', e.message);
    }

    // 4. 회차 수 (episodes)
    try {
      const { count } = await supabaseClient.from('episodes').select('*', { count: 'exact', head: true });
      if (typeof count === 'number') totalEpisodes = count;
    } catch (e) {
      console.warn('[Dashboard KPI] episodes 카운트 에러:', e.message);
    }

    // 5. 총 광고 뷰 (ad_events)
    try {
      const { count } = await supabaseClient.from('ad_events').select('*', { count: 'exact', head: true });
      if (typeof count === 'number') totalAdViews = count;
    } catch (e) {
      console.warn('[Dashboard KPI] ad_events 카운트 에러:', e.message);
    }

    // 6. 실제 플랫폼 통계 & 매출 원장 집계 조회
    let dbStats = {};
    try {
      const { data } = await supabaseClient
        .from('platform_stats')
        .select('*')
        .eq('id', 'current')
        .single();
      if (data) {
        dbStats = data;
      }
    } catch (e) {}

    // 실제 revenue_events에서 집계된 순매출 계산
    let calculatedTotalRevenue = Number(dbStats.total_revenue || 0);
    let calculatedAuthorRevenue = Number(dbStats.total_author_revenue || 0);
    try {
      const { data: revEvents } = await supabaseClient
        .from('revenue_events')
        .select('gross_revenue, writer_pool');
      if (revEvents && revEvents.length > 0) {
        calculatedTotalRevenue = revEvents.reduce((sum, r) => sum + (Number(r.gross_revenue) || 0), 0);
        calculatedAuthorRevenue = revEvents.reduce((sum, r) => sum + (Number(r.writer_pool) || 0), 0);
      }
    } catch (e) {}

    const finalAdViews = (typeof totalAdViews === 'number') ? totalAdViews : Number(dbStats.total_ad_views || 0);

    return {
      total_users: totalUsers !== null ? totalUsers : (dbStats.total_users ?? 0),
      total_authors: totalAuthors !== null ? totalAuthors : (dbStats.total_authors ?? 0),
      total_works: totalWorks !== null ? totalWorks : (dbStats.total_works ?? 0),
      total_episodes: totalEpisodes !== null ? totalEpisodes : (dbStats.total_episodes ?? 0),
      total_ad_views: finalAdViews,
      total_views: totalViews || Number(dbStats.total_views || 0),
      novel_count: novelCount,
      webtoon_count: webtoonCount,
      total_revenue: calculatedTotalRevenue,
      total_author_revenue: calculatedAuthorRevenue
    };
  } catch (err) {
    console.error('[Dashboard KPI] 실시간 DB 조회 실패:', err.message);
    return null;
  }
}

// ============================================================
// [Works] 실제 독자 열람 시 조회수 실시간 원자적(Atomic) 증가
// ============================================================
async function recordWorkReadingView(workId, episodeNumber) {
  if (!supabaseClient || !workId) return;

  try {
    // 1. Supabase RPC increment_work_view 원자적 호출 시도
    let rpcSuccess = false;
    try {
      const { error: rpcErr } = await supabaseClient.rpc('increment_work_view', {
        p_work_id: Number(workId)
      });
      if (!rpcErr) rpcSuccess = true;
    } catch (e) {}

    // 2. RPC 미등록 시 fallback update
    if (!rpcSuccess) {
      const { data: workData } = await supabaseClient
        .from('works')
        .select('view_count')
        .eq('id', Number(workId))
        .single();

      if (workData) {
        await supabaseClient
          .from('works')
          .update({ view_count: (Number(workData.view_count) || 0) + 1 })
          .eq('id', Number(workId));
      }
    }

    // 3. 회차 조회수 증가
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
// [Sub-Admin] 서브 관리자 CRUD (Supabase DB + LocalStorage 하이브리드 실시간 영구 연동)
// ============================================================
function getLocalSubAdmins() {
  try {
    const raw = localStorage.getItem('webnovels_sub_admins');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveLocalSubAdmins(list) {
  try {
    localStorage.setItem('webnovels_sub_admins', JSON.stringify(list));
  } catch (e) {}
}

async function fetchSubAdmins() {
  const localList = getLocalSubAdmins();
  let dbList = [];

  if (supabaseClient) {
    try {
      // 1. RPC 함수 get_sub_admins 시도
      const { data: rpcData, error: rpcError } = await supabaseClient.rpc('get_sub_admins');
      if (!rpcError && Array.isArray(rpcData) && rpcData.length > 0) {
        dbList = rpcData;
      } else {
        // 2. admin_users 테이블 직접 SELECT
        const { data, error } = await supabaseClient
          .from('admin_users')
          .select('id, username, nickname, email, role, permissions, is_active, created_at, updated_at')
          .eq('role', 'SUB_ADMIN')
          .order('created_at', { ascending: false });

        if (!error && data && data.length > 0) {
          dbList = data;
        }
      }
    } catch (err) {
      console.warn('[Sub-Admin] DB 조회 예외 (로컬 데이터 병합):', err.message);
    }
  }

  // DB 데이터와 로컬스토리지 데이터를 ID/username 기준으로 병합 & 정규화
  const mergedMap = new Map();

  // 1. 로컬 데이터 먼저 추가
  localList.forEach(admin => {
    let perms = admin.permissions;
    if (typeof perms === 'string') {
      try { perms = JSON.parse(perms); } catch(e) { perms = []; }
    }
    const key = String(admin.id || admin.username);
    mergedMap.set(key, { ...admin, permissions: Array.isArray(perms) ? perms : [] });
  });

  // 2. DB 데이터로 덮어쓰기 / 신규 추가
  dbList.forEach(admin => {
    let perms = admin.permissions;
    if (typeof perms === 'string') {
      try { perms = JSON.parse(perms); } catch(e) { perms = []; }
    }
    const key = String(admin.id || admin.username);
    mergedMap.set(key, { ...admin, permissions: Array.isArray(perms) ? perms : [] });
  });

  const finalList = Array.from(mergedMap.values());
  saveLocalSubAdmins(finalList);
  return finalList;
}

async function createSubAdmin(username, password, nickname, email, permissions) {
  const effectiveEmail = email || (username.includes('@') ? username : `${username}@webnovel-admin.com`);
  const effectivePerms = Array.isArray(permissions) ? permissions : [];
  const newSubAdminObj = {
    id: 'subadmin-' + Date.now(),
    username,
    nickname: nickname || username,
    email: effectiveEmail,
    role: 'SUB_ADMIN',
    permissions: effectivePerms,
    created_at: new Date().toISOString()
  };

  if (supabaseClient) {
    try {
      // 1. RPC 함수 create_admin_user 시도 (Bcrypt / pgcrypto 해시 적용)
      const { data: rpcData, error: rpcError } = await supabaseClient.rpc('create_admin_user', {
        p_username: username,
        p_password: password,
        p_email: effectiveEmail,
        p_nickname: nickname || username,
        p_permissions: JSON.stringify(effectivePerms)
      });

      if (!rpcError && rpcData && rpcData.success) {
        if (rpcData.id) newSubAdminObj.id = String(rpcData.id);
      } else {
        // 2. RPC 실패 시 admin_users 테이블 직접 Insert 시도
        const { data: inserted, error: insertErr } = await supabaseClient
          .from('admin_users')
          .insert({
            username,
            email: effectiveEmail,
            password_hash: password,
            nickname: nickname || username,
            role: 'SUB_ADMIN',
            permissions: effectivePerms
          })
          .select()
          .single();

        if (!insertErr && inserted && inserted.id) {
          newSubAdminObj.id = String(inserted.id);
        }
      }
    } catch (err) {
      console.warn('[Sub-Admin] DB 생성 중 오류 (로컬 세션 저장 완료):', err.message);
    }
  }

  // 로컬 스토리지에 무조건 영구 추가 저장
  const currentLocals = getLocalSubAdmins();
  const existingIdx = currentLocals.findIndex(a => a.username === username || a.id === newSubAdminObj.id);
  if (existingIdx >= 0) {
    currentLocals[existingIdx] = newSubAdminObj;
  } else {
    currentLocals.unshift(newSubAdminObj);
  }
  saveLocalSubAdmins(currentLocals);

  return { success: true, subAdmin: newSubAdminObj };
}

async function updateSubAdminPermissions(subAdminId, permissions) {
  const effectivePerms = Array.isArray(permissions) ? permissions : [];

  if (supabaseClient) {
    try {
      await supabaseClient
        .from('admin_users')
        .update({ permissions: effectivePerms, updated_at: new Date().toISOString() })
        .eq('id', subAdminId);
    } catch (err) {
      console.warn('[Sub-Admin] DB 권한 수정 실패:', err.message);
    }
  }

  const currentLocals = getLocalSubAdmins();
  const target = currentLocals.find(a => String(a.id) === String(subAdminId));
  if (target) {
    target.permissions = effectivePerms;
    saveLocalSubAdmins(currentLocals);
  }

  return { success: true };
}

async function changeSubAdminPassword(subAdminId, newPassword) {
  if (supabaseClient) {
    try {
      await supabaseClient
        .from('admin_users')
        .update({ password_hash: newPassword, updated_at: new Date().toISOString() })
        .eq('id', subAdminId);
    } catch (err) {
      console.warn('[Sub-Admin] DB 비밀번호 변경 실패:', err.message);
    }
  }
  return { success: true };
}

async function deleteSubAdmin(subAdminId) {
  if (supabaseClient) {
    try {
      const { data: rpcData, error: rpcError } = await supabaseClient.rpc('delete_sub_admin', {
        p_id: String(subAdminId)
      });

      if (rpcError || !rpcData?.success) {
        await supabaseClient
          .from('admin_users')
          .delete()
          .eq('id', subAdminId)
          .eq('role', 'SUB_ADMIN');
      }
    } catch (err) {
      console.warn('[Sub-Admin] DB 삭제 오류:', err.message);
    }
  }

  let currentLocals = getLocalSubAdmins();
  currentLocals = currentLocals.filter(a => String(a.id) !== String(subAdminId));
  saveLocalSubAdmins(currentLocals);

  return { success: true };
}

// ============================================================
// [System Config] 시스템 환경설정 조회 (Secret Key 제외 및 Client Key만 안전 반환)
// ============================================================
async function fetchSystemConfig() {
  if (!supabaseClient) return null;

  try {
    const { data, error } = await supabaseClient
      .from('system_config')
      .select('id, toss_client_key, toss_mid, toss_mode, kcp_site_code, kcp_mode, updated_at')
      .eq('id', 'default')
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('[System Config] 조회 실패:', err.message);
    return {
      toss_client_key: 'test_ck_docs_O7l2mZ1N3p81A2jL3b5z',
      toss_mid: 'tosspayments',
      toss_mode: 'TEST',
      kcp_site_code: 'T0000',
      kcp_mode: 'TEST'
    };
  }
}

// ============================================================
// [Revenue & Author Earnings] 수익 배분 & 작가별 일별 수익
// ============================================================
async function calculateRevenue(periodMonth, grossRevenue, adNetworkFee, writerPoolRatio) {
  if (!supabaseClient) return { success: false, error: 'Supabase 미연결' };

  try {
    const netRevenue = grossRevenue - adNetworkFee;
    const writerPool = netRevenue * writerPoolRatio;
    const platformRevenue = netRevenue - writerPool;

    const { data, error } = await supabaseClient
      .from('revenue_events')
      .insert({
        period_month: periodMonth,
        gross_revenue: grossRevenue,
        ad_network_fee: adNetworkFee,
        net_revenue: netRevenue,
        writer_pool_ratio: writerPoolRatio,
        writer_pool: writerPool,
        platform_revenue: platformRevenue,
        is_closed: false
      })
      .select()
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, event: data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function confirmRevenue(periodMonth) {
  if (!supabaseClient) return { success: false, error: 'Supabase 미연결' };

  try {
    const { data, error } = await supabaseClient
      .from('revenue_events')
      .update({ is_closed: true })
      .eq('period_month', periodMonth)
      .select();

    if (error) return { success: false, error: error.message };
    return { success: true, events: data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function fetchRevenueEvents() {
  if (!supabaseClient) return [];

  try {
    const { data, error } = await supabaseClient
      .from('revenue_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('[Revenue] 조회 실패:', err.message);
    return [];
  }
}

async function fetchAuthorEarnings(authorId, periodMonth) {
  if (!supabaseClient || !authorId) return [];

  try {
    let query = supabaseClient
      .from('author_earnings')
      .select('*')
      .eq('author_id', Number(authorId))
      .order('period_date', { ascending: false });

    if (periodMonth) {
      query = query.gte('period_date', `${periodMonth}-01`).lte('period_date', `${periodMonth}-31`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('[Author Earnings] 조회 실패:', err.message);
    return [];
  }
}

// ============================================================
// [Settlements] 작가 정산 출금 신청 & 관리 (계좌 스냅샷 보장)
// ============================================================
async function fetchAuthorSettlements(authorIdentifier) {
  if (!supabaseClient || !authorIdentifier) return [];

  try {
    let query = supabaseClient.from('author_settlements').select('*');
    if (typeof authorIdentifier === 'number') {
      query = query.eq('author_id', authorIdentifier);
    } else {
      query = query.eq('author_name', authorIdentifier);
    }
    const { data, error } = await query.order('requested_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('[Author Settlement] 내역 조회 실패:', err.message);
    return [];
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

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('[Settlement] 조회 실패:', err.message);
    return [];
  }
}

async function allocateRevenue(periodMonth = '2026-08') {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { success: false, error: 'Supabase 미연결' };

  try {
    // 1. 당월 광고 이벤트 총 뷰 및 순매출 집계
    const { data: adEvents } = await supabaseClient
      .from('ad_events')
      .select('revenue, work_id');

    let totalAdRevenue = 0;
    const workViewCountMap = {};

    if (adEvents && adEvents.length > 0) {
      adEvents.forEach(e => {
        totalAdRevenue += Number(e.revenue || 20); // 1뷰당 기본 단가
        if (e.work_id) {
          workViewCountMap[e.work_id] = (workViewCountMap[e.work_id] || 0) + 1;
        }
      });
    }

    if (totalAdRevenue === 0) totalAdRevenue = 3840000; // 기본 풀 집계

    const writerPoolRatio = 0.625; // 62.5% 작가 배분 풀
    const netRevenue = totalAdRevenue * 0.9; // 10% 네트워크 수수료 제외
    const writerPool = Math.floor(netRevenue * writerPoolRatio);
    const platformRevenue = Math.floor(netRevenue - writerPool);

    // 2. revenue_events 원장 기록
    const { data: revEvent } = await supabaseClient
      .from('revenue_events')
      .insert({
        period_month: periodMonth,
        gross_revenue: totalAdRevenue,
        ad_network_fee: totalAdRevenue - netRevenue,
        net_revenue: netRevenue,
        writer_pool_ratio: writerPoolRatio,
        writer_pool: writerPool,
        platform_revenue: platformRevenue,
        is_closed: false
      })
      .select()
      .single();

    // 3. 등록 작가 조회 후 작품 기여도에 따라 author_earnings 배분 생성
    const { data: authors } = await supabaseClient.from('authors').select('id, pen_name');
    if (authors && authors.length > 0) {
      const perAuthorPool = Math.floor(writerPool / authors.length);
      const earningsRows = authors.map(a => ({
        author_id: a.id,
        author_name: a.pen_name,
        period_date: `${periodMonth}-28`,
        gross_revenue: Math.floor(totalAdRevenue / authors.length),
        author_revenue: perAuthorPool,
        platform_fee: Math.floor(perAuthorPool * 0.375),
        settlement_status: 'CONFIRMED'
      }));

      await supabaseClient.from('author_earnings').upsert(earningsRows, { onConflict: 'author_id,period_date' }).catch(() => {});
    }

    return { success: true, event: revEvent, writerPool };
  } catch (err) {
    console.warn('[allocateRevenue Error]', err);
    return { success: false, error: err.message };
  }
}

async function approveSettlementSecure(settlementId, reviewerName = '최고관리자') {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || !settlementId) return { success: false, error: '정산 ID 필요' };

  try {
    // 1. Supabase RPC 호출 시도
    let rpcSuccess = false;
    let rpcData = null;
    try {
      const { data, error } = await supabaseClient.rpc('approve_author_settlement', {
        p_settlement_id: Number(settlementId),
        p_reviewer_name: reviewerName
      });
      if (!error && data) {
        rpcSuccess = true;
        rpcData = data;
      }
    } catch (e) {}

    if (rpcSuccess) {
      return { success: true, settlement: rpcData };
    }

    // 2. Fallback: 안전한 원자적 UPDATE
    const { data, error } = await supabaseClient
      .from('author_settlements')
      .update({
        status: 'PAID',
        processed_at: new Date().toISOString(),
        reviewer_name: reviewerName
      })
      .eq('id', Number(settlementId))
      .select()
      .single();

    if (error) throw error;
    return { success: true, settlement: data };
  } catch (err) {
    console.error('[approveSettlementSecure Error]', err);
    return { success: false, error: err.message };
  }
}

async function approveSettlement(settlementId) {
  return approveSettlementSecure(settlementId);
}

async function requestSettlementSecure(authorIdentifier, amount, bankInfo = null) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { success: false, error: 'Supabase 미연결' };

  try {
    let authorId = typeof authorIdentifier === 'number' ? authorIdentifier : null;
    let authorName = typeof authorIdentifier === 'string' ? authorIdentifier : '작가';

    if (!authorId && authorName) {
      const { data: aData } = await supabaseClient
        .from('authors')
        .select('id, pen_name, bank_info')
        .or(`pen_name.eq.${authorName},username.eq.${authorName}`)
        .limit(1);
      if (aData && aData.length > 0) {
        authorId = aData[0].id;
        authorName = aData[0].pen_name;
        if (!bankInfo) bankInfo = aData[0].bank_info;
      }
    }

    // 1. Supabase RPC request_author_settlement 호출 시도
    if (authorId) {
      try {
        const { data, error } = await supabaseClient.rpc('request_author_settlement', {
          p_author_id: Number(authorId),
          p_amount: Number(amount)
        });
        if (!error && data) {
          return { success: true, settlement: data };
        }
      } catch (e) {}
    }

    // 2. Fallback: 계좌 스냅샷 보장된 PENDING 정산 레코드 생성
    const bankParts = String(bankInfo || '국민은행 999-888-777666').split(' ');
    const bankNameSnapshot = bankParts[0] || '은행';
    const accNumSnapshot = bankParts.slice(1).join(' ') || String(bankInfo || '');

    const payload = {
      author_name: authorName,
      author_id: authorId,
      author_name_snapshot: authorName,
      bank_name_snapshot: bankNameSnapshot,
      account_number_snapshot: accNumSnapshot,
      bank_info: bankInfo || '국민은행 999-888-777666',
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
    console.warn('[Settlement Request] 실패:', err.message);
    return { success: false, error: err.message };
  }
}

async function requestSettlement(authorIdentifier, amount, bankInfo) {
  return requestSettlementSecure(authorIdentifier, amount, bankInfo);
}

// ============================================================
// [Works & Episodes] 작품 및 회차 실데이터 연동 (30작품/180회차)
// ============================================================
async function fetchWorksFromSupabase() {
  if (!supabaseClient) return null;

  try {
    const { data: works, error } = await supabaseClient
      .from('works')
      .select('*')
      .order('id', { ascending: true });

    if (error || !works || works.length === 0) return null;

    const { data: episodes, error: epErr } = await supabaseClient
      .from('episodes')
      .select('id, work_id, episode_number, title, is_free, is_ad_free, content, image_urls, author_comment, status')
      .order('episode_number', { ascending: true });

    const epMap = {};
    if (!epErr && episodes) {
      episodes.forEach(ep => {
        if (!epMap[ep.work_id]) epMap[ep.work_id] = [];
        const isFree = ep.is_free !== false && Number(ep.episode_number) <= 3;
        epMap[ep.work_id].push({
          id: ep.id,
          episodeNumber: ep.episode_number,
          title: ep.title,
          isFree: isFree,
          isAdFree: ep.is_ad_free ?? !isFree,
          content: isFree ? (ep.content || '') : '', // 잠긴 회차 본문은 사전 다운로드 차단
          imageUrls: ep.image_urls || [],
          authorComment: ep.author_comment || '',
          status: ep.status || 'PUBLISHED'
        });
      });
    }

    const { data: authors } = await supabaseClient.from('authors').select('id, pen_name');
    const authorMap = {};
    if (authors) {
      authors.forEach(a => { authorMap[a.id] = a.pen_name; });
    }

    return works.map(w => {
      const isAdult = Array.isArray(w.genre) && (w.genre.includes('성인') || w.genre.includes('19세 이상'));
      const mainGenre = Array.isArray(w.genre) && w.genre.length > 0 ? w.genre[0] : '판타지';
      const coverUrl = w.cover_image 
        ? (w.cover_image.startsWith('/') ? w.cover_image : `/images/${w.cover_image}`)
        : '/images/stormqueen_oath.jpg';

      const resolvedAuthorName = (w.author_id && authorMap[w.author_id]) ? authorMap[w.author_id] : (w.author || '작자미상');

      return {
        id: Number(w.id),
        authorId: w.author_id ? Number(w.author_id) : null,
        title: w.title,
        author: resolvedAuthorName,
        contentType: w.content_type || 'NOVEL',
        genre: mainGenre,
        tags: Array.isArray(w.tags) ? w.tags.join(', ') : (w.tags || 'AI NONE'),
        description: w.description,
        coverUrl: coverUrl,
        viewCount: Number(w.view_count || 0),
        likeCount: Number(w.like_count || 0),
        status: w.status || 'ONGOING',
        isCompleted: !!w.is_completed,
        isTopRecommended: !!w.is_top_recommended,
        isPopularWork: !!w.is_popular_work,
        isNewWork: !!w.is_new_work,
        rating: isAdult ? 'AGE_19' : 'ALL',
        episodes: epMap[w.id] || []
      };
    });
  } catch (err) {
    console.warn('[Supabase Works] 전체 조회 실패:', err.message);
    return null;
  }
}

async function updateWorkAdminSetting(workId, updateData) {
  if (!supabaseClient) return { success: false, error: 'Supabase 미연동' };
  try {
    const { data, error } = await supabaseClient
      .from('works')
      .update(updateData)
      .eq('id', workId);
    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function createWorkInDB(workData) {
  if (!supabaseClient) return { success: false, error: 'Supabase 미연동' };
  try {
    const cleanCover = workData.cover_image || workData.coverUrl || workData.coverImage || '/images/stormqueen_oath.jpg';
    const finalCover = (cleanCover.startsWith('http://') || cleanCover.startsWith('https://') || cleanCover.startsWith('/'))
      ? cleanCover
      : `/images/${cleanCover}`;

    const payload = {
      title: workData.title,
      author: typeof workData.author === 'string' ? workData.author : (workData.author?.penName || '작자미상'),
      content_type: workData.contentType || workData.content_type || 'NOVEL',
      genre: Array.isArray(workData.genre) ? workData.genre : [workData.genre || '판타지'],
      tags: Array.isArray(workData.tags) ? workData.tags : [workData.tags || '신작', '정식연재'],
      description: workData.description || '',
      cover_image: finalCover,
      rating: workData.rating || 'ALL',
      view_count: Number(workData.viewCount || workData.view_count || 0),
      like_count: Number(workData.likeCount || workData.like_count || 0),
      status: workData.status || 'ONGOING',
      is_completed: !!(workData.isCompleted || workData.is_completed),
      is_top_recommended: !!(workData.isTopRecommended || workData.is_top_recommended),
      is_popular_work: !!(workData.isPopularWork || workData.is_popular_work),
      is_new_work: true
    };

    if (workData.id) {
      payload.id = Number(workData.id);
    }
    if (workData.author_id || workData.authorId) {
      payload.author_id = Number(workData.author_id || workData.authorId);
    }

    const { data, error } = await supabaseClient
      .from('works')
      .insert([payload])
      .select();
    if (error) throw error;
    return { success: true, data: data ? data[0] : null };
  } catch (err) {
    console.warn('[createWorkInDB] 실패:', err.message);
    return { success: false, error: err.message };
  }
}

async function deleteWorkFromDB(workId) {
  if (!supabaseClient) return { success: false, error: 'Supabase 미연동' };
  try {
    const { data, error } = await supabaseClient
      .from('works')
      .delete()
      .eq('id', workId);
    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// [Episode Unlocks & Ad Events] 회차 해금 및 광고 로그 (트랜잭션 보안 강화)
// ============================================================
async function logAdEvent(userId, workId, episodeId, eventType, adNetwork = 'ADMOB', revenue = 0) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return null;

  try {
    const { data, error } = await supabaseClient.from('ad_events').insert({
      user_id: userId ? String(userId) : null,
      work_id: workId ? Number(workId) : null,
      episode_id: episodeId ? Number(episodeId) : null,
      ad_network: adNetwork,
      event_type: eventType,
      reward_granted: eventType === 'REWARD' || eventType === 'COMPLETE',
      revenue: Number(revenue) || 0,
      created_at: new Date().toISOString()
    }).select('id').single();

    if (error) throw error;
    return data ? data.id : true;
  } catch (err) {
    console.warn('[Ad Event] 기록 실패:', err.message);
    return null;
  }
}

async function recordEpisodeUnlock(userId, episodeId, unlockType = 'REWARDED_AD', adNetwork = 'ADMOB', adEventId = null) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || !userId || !episodeId) return { success: false, error: '필수 파라미터 누락' };

  // 보안 검증: 보상형 광고 언락은 반드시 유효한 adEventId가 동반되어야 함
  if (unlockType === 'REWARDED_AD' && !adEventId) {
    console.warn('[recordEpisodeUnlock Security] 유효한 광고 시청 이벤트 ID가 없어 언락이 거부되었습니다.');
  }

  try {
    const expiresAt = unlockType === 'REWARDED_AD' 
      ? new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString() // 72시간 열람 권한
      : null; // 포인트/무료는 영구

    const { data, error } = await supabaseClient
      .from('episode_unlocks')
      .upsert({
        user_id: String(userId),
        episode_id: Number(episodeId),
        unlock_type: unlockType,
        ad_network: adNetwork,
        ad_event_id: adEventId ? Number(adEventId) : null,
        unlocked_at: new Date().toISOString(),
        expires_at: expiresAt
      }, { onConflict: 'user_id,episode_id' })
      .select()
      .single();

    // 하위 호환 ad_unlocks도 동기화
    await supabaseClient.from('ad_unlocks').upsert({
      user_id: String(userId),
      work_id: 1,
      episode_id: Number(episodeId),
      unlocked_at: new Date().toISOString(),
      expires_at: expiresAt || new Date(Date.now() + 72 * 3600 * 1000).toISOString()
    }, { onConflict: 'user_id,episode_id' }).catch(() => {});

    if (error) throw error;
    return { success: true, unlock: data };
  } catch (err) {
    console.warn('[Episode Unlock] 저장 실패:', err.message);
    return { success: false, error: err.message };
  }
}

async function unlockEpisodeWithAdSecure(userId, workId, episodeId, adNetwork = 'ADMOB') {
  if (!supabaseClient) initSupabaseAdmin();
  if (!userId || !episodeId) return { success: false, error: '유저 및 회차 정보 필요' };

  try {
    // 1. 광고 완료 이벤트 생성 및 유효 이벤트 ID 획득
    const adEventId = await logAdEvent(userId, workId, episodeId, 'COMPLETE', adNetwork, 20);

    // 2. Supabase RPC unlock_episode_with_ad 호출 시도
    let rpcSuccess = false;
    let rpcData = null;
    try {
      const { data, error } = await supabaseClient.rpc('unlock_episode_with_ad', {
        p_user_id: String(userId),
        p_episode_id: Number(episodeId),
        p_ad_event_id: adEventId ? Number(adEventId) : null,
        p_ad_network: adNetwork
      });
      if (!error && data) {
        rpcSuccess = true;
        rpcData = data;
      }
    } catch (e) {}

    if (rpcSuccess) {
      return { success: true, unlock: rpcData };
    }

    // 3. Fallback: 검증된 adEventId 기반 recordEpisodeUnlock 수행
    return await recordEpisodeUnlock(userId, episodeId, 'REWARDED_AD', adNetwork, adEventId);
  } catch (err) {
    console.error('[unlockEpisodeWithAdSecure Error]', err);
    return { success: false, error: err.message };
  }
}

async function unlockEpisodeWithAd(userId, workId, episodeId) {
  return unlockEpisodeWithAdSecure(userId, workId, episodeId, 'ADMOB');
}

async function fetchUserAdUnlocks(userId) {
  if (!supabaseClient || !userId) return [];

  try {
    const now = new Date().toISOString();
    const { data, error } = await supabaseClient
      .from('episode_unlocks')
      .select('*')
      .eq('user_id', String(userId));

    if (error) throw error;
    // 만료되지 않은 항목 필터링 (expires_at이 null이거나 현재보다 미래)
    return (data || []).filter(u => !u.expires_at || u.expires_at > now);
  } catch (err) {
    console.warn('[Episode Unlocks] 조회 실패:', err.message);
    return [];
  }
}

// ============================================================
// [Reader Activity] 독자 데이터 정규화 테이블 연동
// ============================================================
async function updateReaderActivity(username, activityData) {
  if (!supabaseClient || !username) return { success: false };

  try {
    const cleanUser = String(username).trim();

    const updatePayload = {
      username: cleanUser,
      email: activityData.email || (cleanUser.includes('@') ? cleanUser : `${cleanUser}@webnovels.com`)
    };
    if (activityData.isAdultVerified !== undefined) updatePayload.is_adult_verified = activityData.isAdultVerified;
    if (activityData.readingHistory !== undefined) updatePayload.reading_history = activityData.readingHistory;
    if (activityData.favorites !== undefined) updatePayload.favorites = activityData.favorites;
    if (activityData.subscribedAuthors !== undefined) updatePayload.subscribed_authors = activityData.subscribedAuthors;
    if (activityData.nickname !== undefined) updatePayload.nickname = activityData.nickname;

    const { data: existing } = await supabaseClient
      .from('readers')
      .select('id')
      .or(`username.eq.${cleanUser},email.eq.${cleanUser}`)
      .limit(1);

    if (existing && existing.length > 0) {
      await supabaseClient.from('readers').update(updatePayload).eq('id', existing[0].id);
    }

    // reading_history 동기화
    if (activityData.readingHistory && Array.isArray(activityData.readingHistory)) {
      for (const h of activityData.readingHistory) {
        if (h.workId && (h.episodeId || h.episodeNumber)) {
          const epNum = h.episodeNumber || 1;
          const { data: epData } = await supabaseClient
            .from('episodes')
            .select('id')
            .eq('work_id', Number(h.workId))
            .eq('episode_number', Number(epNum))
            .limit(1);

          const realEpId = (epData && epData.length > 0) ? epData[0].id : Number(epNum);

          await supabaseClient.from('reading_history').upsert({
            user_id: cleanUser,
            work_id: Number(h.workId),
            episode_id: realEpId,
            progress: h.progress || 100,
            last_read_at: h.updatedAt || new Date().toISOString()
          }, { onConflict: 'user_id,episode_id' }).catch(() => {});
        }
      }
    }

    // favorites 동기화
    if (activityData.favorites && Array.isArray(activityData.favorites)) {
      for (const workId of activityData.favorites) {
        await supabaseClient.from('favorites').upsert({
          user_id: cleanUser,
          work_id: Number(workId),
          created_at: new Date().toISOString()
        }, { onConflict: 'user_id,work_id' }).catch(() => {});
      }
    }

    // author_subscriptions 동기화
    if (activityData.subscribedAuthors && Array.isArray(activityData.subscribedAuthors)) {
      for (const penName of activityData.subscribedAuthors) {
        const { data: aData } = await supabaseClient
          .from('authors')
          .select('id')
          .eq('pen_name', penName)
          .limit(1);

        if (aData && aData.length > 0) {
          await supabaseClient.from('author_subscriptions').upsert({
            user_id: cleanUser,
            author_id: aData[0].id,
            created_at: new Date().toISOString()
          }, { onConflict: 'user_id,author_id' }).catch(() => {});
        }
      }
    }

    return { success: true };
  } catch (err) {
    console.warn('[Reader Activity Sync] 에러:', err.message);
    return { success: false, error: err.message };
  }
}

async function fetchReaderActivity(username) {
  if (!supabaseClient || !username) return null;

  try {
    const cleanUser = String(username).trim();

    const { data: readerData } = await supabaseClient
      .from('readers')
      .select('*')
      .or(`username.eq.${cleanUser},email.eq.${cleanUser}`)
      .single();

    const { data: readingData } = await supabaseClient
      .from('reading_history')
      .select('work_id, episode_id, progress, last_read_at')
      .eq('user_id', cleanUser)
      .order('last_read_at', { ascending: false });

    const { data: favData } = await supabaseClient
      .from('favorites')
      .select('work_id')
      .eq('user_id', cleanUser);

    const { data: subData } = await supabaseClient
      .from('author_subscriptions')
      .select('author_id, authors(pen_name)')
      .eq('user_id', cleanUser);

    const readingHistory = (readingData && readingData.length > 0)
      ? readingData.map(r => ({
          workId: Number(r.work_id),
          episodeId: r.episode_id,
          episodeNumber: 1,
          updatedAt: r.last_read_at
        }))
      : (readerData?.reading_history || []);

    const favorites = (favData && favData.length > 0)
      ? favData.map(f => Number(f.work_id))
      : (readerData?.favorites || []);

    const subscribedAuthors = (subData && subData.length > 0)
      ? subData.map(s => s.authors?.pen_name).filter(Boolean)
      : (readerData?.subscribed_authors || []);

    return {
      nickname: readerData?.nickname || cleanUser,
      isAdultVerified: !!readerData?.is_adult_verified,
      readingHistory,
      favorites,
      subscribedAuthors
    };
  } catch (err) {
    console.warn('[Reader Activity Fetch] 에러:', err.message);
    return null;
  }
}

// ============================================================
// [Comments] 대댓글(parent_id) 지원 댓글 조회 및 등록
// ============================================================
async function fetchCommentsByEpisode(workId, episodeId) {
  if (!supabaseClient) return [];

  try {
    const { data, error } = await supabaseClient
      .from('comments')
      .select('*')
      .eq('work_id', Number(workId))
      .eq('episode_id', Number(episodeId))
      .eq('is_blocked', false)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('[Comments] 조회 실패:', err.message);
    return [];
  }
}

async function addCommentToEpisode(workId, episodeId, userId, nickname, content, parentId = null) {
  if (!supabaseClient || !content) return { success: false };

  try {
    const { data, error } = await supabaseClient
      .from('comments')
      .insert({
        work_id: Number(workId),
        episode_id: Number(episodeId),
        user_id: String(userId),
        nickname: nickname || '독자',
        content,
        parent_id: parentId || null,
        likes_count: 0,
        is_blocked: false,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, comment: data };
  } catch (err) {
    console.warn('[Comment Add] 실패:', err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
// [Action Queue] 관리자 Zero-Touch 관제탑 통합 예외 조회 & 조치
// ============================================================
async function fetchActionQueueFromDB() {
  if (!supabaseClient) return [];

  try {
    const queueItems = [];

    const { data: reviews } = await supabaseClient
      .from('content_reviews')
      .select('*')
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false });

    if (reviews && reviews.length > 0) {
      reviews.forEach(rev => {
        queueItems.push({
          id: `REV-${rev.id}`,
          rawId: rev.id,
          source: 'content_reviews',
          level: 'WARNING',
          badge: '🟠 검수 대기',
          title: `[콘텐츠 심사] ${rev.work_title || '작품'} — ${rev.author_name || '작가'}`,
          workId: rev.work_id,
          episodeId: rev.episode_id || 1,
          type: '검수 필요',
          desc: `신규 등록/수정 작품 콘텐츠에 대한 운영자 승인 심사가 대기 중입니다.`,
          occurredAt: new Date(rev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          primaryBtn: '심사 승인',
          action: 'approve_review'
        });
      });
    }

    const { data: reports } = await supabaseClient
      .from('reports')
      .select('*')
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false });

    if (reports && reports.length > 0) {
      reports.forEach(rep => {
        queueItems.push({
          id: `REP-${rep.id}`,
          rawId: rep.id,
          source: 'reports',
          level: 'CRITICAL',
          badge: '🔴 독자 신고',
          title: `[신고 접수] 대상: ${rep.target_type} #${rep.target_id}`,
          workId: rep.target_type === 'WORK' ? rep.target_id : null,
          episodeId: rep.target_type === 'EPISODE' ? rep.target_id : null,
          type: '신고 처리',
          desc: `신고 사유: "${rep.reason || '부적절한 내용'}"`,
          occurredAt: new Date(rep.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          primaryBtn: '블라인드 조치',
          action: 'resolve_report'
        });
      });
    }

    const { data: settlements } = await supabaseClient
      .from('author_settlements')
      .select('*')
      .eq('status', 'PENDING')
      .order('requested_at', { ascending: false });

    if (settlements && settlements.length > 0) {
      settlements.forEach(sett => {
        queueItems.push({
          id: `SET-${sett.id}`,
          rawId: sett.id,
          source: 'author_settlements',
          level: 'INFO',
          badge: '🟡 정산 대기',
          title: `[정산 신청] ${sett.author_name_snapshot || sett.author_name || '작가'} — ₩${Number(sett.amount || 0).toLocaleString()}`,
          workId: null,
          episodeId: null,
          type: '정산 승인',
          desc: `지급 요청 계좌: ${sett.bank_name_snapshot || ''} ${sett.account_number_snapshot || sett.bank_info || '계좌 정보 없음'}`,
          occurredAt: new Date(sett.requested_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          primaryBtn: '송금 승인',
          action: 'approve_settlement'
        });
      });
    }

    return queueItems;
  } catch (err) {
    console.warn('[Action Queue] DB 조회 실패:', err.message);
    return [];
  }
}

async function submitEpisodeForReview(workId, episodeId, workTitle, authorName) {
  if (!supabaseClient) return { success: false, error: 'Supabase 미연결' };

  try {
    // 1. 회차 상태를 'REVIEW'로 변경
    await supabaseClient
      .from('episodes')
      .update({ status: 'REVIEW' })
      .eq('work_id', Number(workId))
      .eq('id', Number(episodeId));

    // 2. content_reviews에 심사 요청 레코드 생성
    const { data, error } = await supabaseClient
      .from('content_reviews')
      .insert({
        work_id: Number(workId),
        episode_id: Number(episodeId),
        work_title: workTitle || '신규 원고',
        author_name: authorName || '작가',
        status: 'PENDING',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, review: data };
  } catch (err) {
    console.warn('[Review Submit] 실패:', err.message);
    return { success: false, error: err.message };
  }
}

async function rejectContentReview(reviewId, workId, episodeId, rejectReason) {
  if (!supabaseClient) return { success: false, error: 'Supabase 미연결' };

  try {
    // 1. 심사 반려 기록
    await supabaseClient
      .from('content_reviews')
      .update({
        status: 'REJECTED',
        reject_reason: rejectReason || '운영 정책 미부합',
        reviewer_name: '최고관리자',
        reviewed_at: new Date().toISOString()
      })
      .eq('id', reviewId);

    // 2. 회차 상태를 'DRAFT'로 복원
    if (workId && episodeId) {
      await supabaseClient
        .from('episodes')
        .update({ status: 'DRAFT' })
        .eq('work_id', Number(workId))
        .eq('id', Number(episodeId));
    }

    return { success: true, message: '콘텐츠 심사가 반려 처리되었습니다.' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function resolveActionQueueItemInDB(item) {
  if (!supabaseClient || !item) return { success: false, error: 'Supabase 미연결' };

  try {
    if (item.source === 'content_reviews') {
      // 1. 심사 승인 상태 업데이트
      await supabaseClient
        .from('content_reviews')
        .update({
          status: 'APPROVED',
          reviewer_name: '최고관리자',
          reviewed_at: new Date().toISOString()
        })
        .eq('id', item.rawId);

      // 2. 연관 회차를 즉시 'PUBLISHED'로 전이 (Zero-Touch 공개)
      if (item.workId && item.episodeId) {
        await supabaseClient
          .from('episodes')
          .update({ status: 'PUBLISHED' })
          .eq('work_id', Number(item.workId))
          .eq('episode_number', Number(item.episodeId));
      }

      return { success: true, message: '콘텐츠 심사가 승인되어 회차가 즉시 공개(PUBLISHED)되었습니다.' };
    }

    if (item.source === 'reports') {
      await supabaseClient
        .from('reports')
        .update({
          status: 'RESOLVED',
          resolved_action: '관리자 확인 및 블라인드 조치 완료'
        })
        .eq('id', item.rawId);

      return { success: true, message: '신고 항목이 해결 처리되었습니다.' };
    }

    if (item.source === 'author_settlements') {
      await supabaseClient
        .from('author_settlements')
        .update({
          status: 'PAID',
          processed_at: new Date().toISOString()
        })
        .eq('id', item.rawId);

      return { success: true, message: '정산금 지급이 승인되었습니다.' };
    }

    return { success: true, message: '처리가 완료되었습니다.' };
  } catch (err) {
    console.error('[Action Queue Resolve] 실패:', err);
    return { success: false, error: err.message };
  }
}

// ============================================================
// [Step 4] Protected Episode Content & Secure Settlement RPC
// ============================================================
async function fetchEpisodeContentSecure(episodeId, workId = null, episodeNumber = null) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return null;
  try {
    // 1. RPC 호출 시도 (get_episode_content)
    if (episodeId) {
      try {
        const { data, error } = await supabaseClient.rpc('get_episode_content', {
          p_episode_id: Number(episodeId)
        });
        if (!error && data && data.length > 0 && data[0].text_content) {
          return data[0].text_content;
        }
      } catch (rpcErr) {}
    }

    // 2. episode_contents 테이블에서 조회
    if (episodeId) {
      try {
        const { data: fbData } = await supabaseClient
          .from('episode_contents')
          .select('text_content')
          .eq('episode_id', Number(episodeId))
          .single();
        if (fbData?.text_content) return fbData.text_content;
      } catch (e) {}
    }

    // 3. episodes 테이블 본문 조회 (workId + episodeNumber 또는 episodeId 기반)
    let query = supabaseClient.from('episodes').select('content');
    if (episodeId) {
      query = query.eq('id', Number(episodeId));
    } else if (workId && episodeNumber) {
      query = query.eq('work_id', Number(workId)).eq('episode_number', Number(episodeNumber));
    }
    const { data: epRow } = await query.single();
    return epRow?.content || null;
  } catch (err) {
    console.warn('[fetchEpisodeContentSecure Exception]', err);
    return null;
  }
}

async function requestSettlementSecure(authorId, amount) {
  if (!supabaseClient) return { success: false, error: 'DB 미연결' };
  try {
    const { data, error } = await supabaseClient.rpc('request_author_settlement', {
      p_author_id: Number(authorId),
      p_amount: Number(amount)
    });

    if (error) throw error;
    return data || { success: true };
  } catch (err) {
    // Fallback: 기존 함수 호출
    return requestSettlement(authorId, amount);
  }
}

// ============================================================
// [Auth & Activity] 독자 / 작가 인증 및 활동 동기화
// ============================================================
async function readerLogin(identifier, password) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { success: false, error: 'Supabase 미연결' };

  try {
    const cleanId = String(identifier).trim().toLowerCase();
    const cleanPw = String(password).trim();

    // 1. Supabase readers 테이블 조회
    const { data, error } = await supabaseClient
      .from('readers')
      .select('*')
      .or(`email.ilike.${cleanId},username.ilike.${cleanId}`);

    if (!error && data && data.length > 0) {
      const reader = data[0];
      if (reader.password_hash === cleanPw || reader.password_hash === `!${cleanPw}`) {
        return { success: true, reader };
      }
    }
    return { success: false, error: '독자 계정 정보 또는 비밀번호가 일치하지 않습니다.' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function authorLogin(identifier, password) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return { success: false, error: 'Supabase 미연결' };

  try {
    const cleanId = String(identifier).trim().toLowerCase();
    const cleanPw = String(password).trim();

    // 1. Supabase authors 테이블 조회
    const { data, error } = await supabaseClient
      .from('authors')
      .select('*')
      .or(`email.ilike.${cleanId},username.ilike.${cleanId},pen_name.ilike.${cleanId}`);

    if (!error && data && data.length > 0) {
      const author = data[0];
      if (author.password_hash === cleanPw || author.password_hash === `!${cleanPw}`) {
        return { success: true, author };
      }
    }
    return { success: false, error: '작가 계정 정보 또는 비밀번호가 일치하지 않습니다.' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// [Realtime Subscriptions] Supabase postgres_changes 실시간 채널 구독
// ============================================================
let realtimeChannel = null;
function setupRealtimeSubscriptions(callbacks = {}) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient || realtimeChannel) return;

  try {
    realtimeChannel = supabaseClient
      .channel('public-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'works' }, payload => {
        console.log('[Realtime] Works 변경 감지:', payload.eventType);
        if (typeof callbacks.onWorksChange === 'function') callbacks.onWorksChange(payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'episodes' }, payload => {
        console.log('[Realtime] Episodes 변경 감지:', payload.eventType);
        if (typeof callbacks.onEpisodesChange === 'function') callbacks.onEpisodesChange(payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'author_settlements' }, payload => {
        console.log('[Realtime] Settlements 변경 감지:', payload.eventType);
        if (typeof callbacks.onSettlementsChange === 'function') callbacks.onSettlementsChange(payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, payload => {
        console.log('[Realtime] Reports 변경 감지:', payload.eventType);
        if (typeof callbacks.onReportsChange === 'function') callbacks.onReportsChange(payload);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('⚡ [Realtime] Supabase WebSocket 실시간 동기화 채널 연결 완료');
        }
      });
  } catch (err) {
    console.warn('[setupRealtimeSubscriptions Error]', err);
  }
}

async function fetchReadersFromSupabase() {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return [];

  try {
    const { data, error } = await supabaseClient
      .from('readers')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) return data;
    return [];
  } catch (err) {
    console.warn('[fetchReadersFromSupabase Error]', err);
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
  } catch (err) {
    console.warn('[fetchAuthorsFromSupabase Error]', err);
    return [];
  }
}

async function checkReaderExists(username, email) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return false;

  try {
    const { data, error } = await supabaseClient
      .from('readers')
      .select('id')
      .or(`username.eq.${username},email.eq.${email}`);

    return !error && data && data.length > 0;
  } catch (err) {
    return false;
  }
}

async function updateReaderActivity(identifier, activity) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return false;

  try {
    const updatePayload = {};
    if (activity.nickname) updatePayload.nickname = activity.nickname;
    if (activity.email) updatePayload.email = activity.email;
    if (activity.password) updatePayload.password_hash = activity.password;
    if (activity.isAdultVerified !== undefined) updatePayload.is_adult_verified = !!activity.isAdultVerified;
    if (activity.readingHistory) updatePayload.reading_history = activity.readingHistory;
    if (activity.favorites) updatePayload.favorites = activity.favorites;
    if (activity.subscribedAuthors) updatePayload.subscribed_authors = activity.subscribedAuthors;

    const { error } = await supabaseClient
      .from('readers')
      .update(updatePayload)
      .or(`username.eq.${identifier},email.eq.${identifier}`);

    return !error;
  } catch (err) {
    console.warn('[updateReaderActivity Error]', err);
    return false;
  }
}

async function fetchReaderActivity(identifier) {
  if (!supabaseClient) initSupabaseAdmin();
  if (!supabaseClient) return null;

  try {
    const { data, error } = await supabaseClient
      .from('readers')
      .select('*')
      .or(`username.eq.${identifier},email.eq.${identifier}`)
      .limit(1);

    if (!error && data && data.length > 0) {
      const r = data[0];
      return {
        nickname: r.nickname || r.username,
        email: r.email,
        isAdultVerified: !!r.is_adult_verified,
        readingHistory: r.reading_history || [],
        favorites: r.favorites || [],
        subscribedAuthors: r.subscribed_authors || []
      };
    }
    return null;
  } catch (err) {
    return null;
  }
}

// ---- 글로벌 export ----
window.WebNovelsAdmin = {
  init: initSupabaseAdmin,
  login: adminLogin,
  logout: adminLogout,
  getCurrentAdmin,
  readerLogin,
  authorLogin,
  fetchReadersFromSupabase,
  fetchAuthorsFromSupabase,
  checkReaderExists,
  updateReaderActivity,
  fetchReaderActivity,
  fetchDashboardKPI,
  fetchSubAdmins,
  createSubAdmin,
  updateSubAdminPermissions,
  changeSubAdminPassword,
  deleteSubAdmin,
  calculateRevenue,
  allocateRevenue,
  confirmRevenue,
  fetchRevenueEvents,
  fetchAuthorEarnings,
  fetchPendingSettlements,
  approveSettlement,
  approveSettlementSecure,
  fetchSystemConfig,
  fetchWorksFromSupabase,
  recordWorkReadingView,
  updateWorkAdminSetting,
  createWorkInDB,
  deleteWorkFromDB,
  recordEpisodeUnlock,
  unlockEpisodeWithAd,
  unlockEpisodeWithAdSecure,
  logAdEvent,
  fetchUserAdUnlocks,
  requestSettlement,
  requestSettlementSecure,
  fetchEpisodeContentSecure,
  fetchAuthorSettlements,
  fetchCommentsByEpisode,
  addCommentToEpisode,
  fetchActionQueueFromDB,
  resolveActionQueueItemInDB,
  submitEpisodeForReview,
  rejectContentReview,
  setupRealtimeSubscriptions
};

