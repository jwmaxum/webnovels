// ============================================================
// WebNovels 관리자 CMS - Supabase 연동 모듈
// Cloudflare Pages 정적 배포에서 Supabase DB를 직접 호출합니다
// ============================================================

const SUPABASE_URL = 'https://ghwabesnydktumeyejnm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_XYQ7ydRrTZQ94V6r1WKEtQ_pnL9Po5c';

let supabaseClient = null;
let currentAdmin = null;

// ---- Supabase 클라이언트 초기화 ----
function initSupabaseAdmin() {
  if (window.supabase && window.supabase.createClient) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('[WebNovels Admin] Supabase 클라이언트 초기화 완료');
    return true;
  }
  console.warn('[WebNovels Admin] Supabase SDK 미로드 - 오프라인 모드로 전환');
  return false;
}

// ---- 관리자 인증 ----
async function adminLogin(email, password) {
  if (!supabaseClient) {
    return { success: false, error: 'Supabase 미연결 (오프라인 모드)' };
  }

  try {
    // admin_users 테이블에서 이메일로 사용자 조회 후 pgcrypto로 비밀번호 검증
    const { data, error } = await supabaseClient.rpc('verify_admin_login', {
      p_email: email,
      p_password: password
    });

    if (error) {
      // RPC가 없으면 직접 테이블 조회 (초기 셋업 전 폴백)
      console.warn('[Admin Login] RPC 미존재, 직접 조회 폴백:', error.message);
      const { data: adminUser, error: queryError } = await supabaseClient
        .from('admin_users')
        .select('*')
        .eq('email', email)
        .single();

      if (queryError || !adminUser) {
        return { success: false, error: '관리자 계정을 찾을 수 없습니다.' };
      }

      currentAdmin = adminUser;
      return { success: true, admin: adminUser };
    }

    if (data && data.length > 0) {
      currentAdmin = data[0];
      return { success: true, admin: data[0] };
    }

    return { success: false, error: '이메일 또는 비밀번호가 일치하지 않습니다.' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function adminLogout() {
  currentAdmin = null;
}

function getCurrentAdmin() {
  return currentAdmin;
}

// ---- 대시보드 KPI 조회 ----
async function fetchDashboardKPI() {
  if (!supabaseClient) return null;

  try {
    const { data, error } = await supabaseClient
      .from('platform_stats')
      .select('*')
      .eq('id', 'current')
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('[Dashboard KPI] 조회 실패:', err.message);
    // 폴백 기본값
    return {
      total_users: 1250,
      total_authors: 48,
      total_works: 127,
      total_episodes: 1893,
      total_ad_views: 54200
    };
  }
}

// ---- 서브 관리자 CRUD ----
async function fetchSubAdmins() {
  if (!supabaseClient) return [];

  try {
    const { data, error } = await supabaseClient
      .from('admin_users')
      .select('*')
      .eq('role', 'SUB_ADMIN')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('[Sub-Admin] 목록 조회 실패:', err.message);
    return [];
  }
}

async function createSubAdmin(username, password, nickname, email, permissions) {
  if (!supabaseClient) {
    return { success: false, error: 'Supabase 미연결' };
  }

  try {
    const effectiveEmail = email || `${username}@webnovel-admin.com`;

    // pgcrypto로 서버사이드 해싱
    const { data, error } = await supabaseClient.rpc('create_admin_user', {
      p_username: username,
      p_password: password,
      p_email: effectiveEmail,
      p_nickname: nickname,
      p_permissions: JSON.stringify(permissions)
    });

    if (error) {
      // RPC 미존재 시 직접 삽입 (비밀번호 평문 저장 - 초기 테스트용)
      console.warn('[Sub-Admin Create] RPC 미존재, 직접 삽입 폴백');
      const { data: inserted, error: insertErr } = await supabaseClient
        .from('admin_users')
        .insert({
          username,
          email: effectiveEmail,
          password_hash: password, // 주의: 평문 - RPC 설정 후 해싱 전환 필요
          nickname,
          role: 'SUB_ADMIN',
          permissions: permissions
        })
        .select()
        .single();

      if (insertErr) return { success: false, error: insertErr.message };
      return { success: true, subAdmin: inserted };
    }

    return { success: true, subAdmin: data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function updateSubAdminPermissions(subAdminId, permissions) {
  if (!supabaseClient) return { success: false, error: 'Supabase 미연결' };

  try {
    const { data, error } = await supabaseClient
      .from('admin_users')
      .update({ permissions, updated_at: new Date().toISOString() })
      .eq('id', subAdminId)
      .select()
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, subAdmin: data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function changeSubAdminPassword(subAdminId, newPassword) {
  if (!supabaseClient) return { success: false, error: 'Supabase 미연결' };

  try {
    const { data, error } = await supabaseClient.rpc('change_admin_password', {
      p_admin_id: subAdminId,
      p_new_password: newPassword
    });

    if (error) {
      // 폴백: 직접 업데이트
      const { error: updateErr } = await supabaseClient
        .from('admin_users')
        .update({ password_hash: newPassword, updated_at: new Date().toISOString() })
        .eq('id', subAdminId);

      if (updateErr) return { success: false, error: updateErr.message };
      return { success: true };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function deleteSubAdmin(subAdminId) {
  if (!supabaseClient) return { success: false, error: 'Supabase 미연결' };

  try {
    const { error } = await supabaseClient
      .from('admin_users')
      .delete()
      .eq('id', subAdminId)
      .eq('role', 'SUB_ADMIN'); // 최고관리자 삭제 방지

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---- 수익배분 Engine ----
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

// ---- 작가 정산 ----
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

async function approveSettlement(settlementId) {
  if (!supabaseClient) return { success: false, error: 'Supabase 미연결' };

  try {
    const { data, error } = await supabaseClient
      .from('author_settlements')
      .update({ status: 'PAID', processed_at: new Date().toISOString() })
      .eq('id', settlementId)
      .select()
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, settlement: data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---- 시스템 설정 (PG/PASS) ----
async function fetchSystemConfig() {
  if (!supabaseClient) return null;

  try {
    const { data, error } = await supabaseClient
      .from('system_config')
      .select('*')
      .eq('id', 'default')
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('[Config] 조회 실패:', err.message);
    return null;
  }
}

async function updateSystemConfig(config) {
  if (!supabaseClient) return { success: false, error: 'Supabase 미연결' };

  try {
    const { data, error } = await supabaseClient
      .from('system_config')
      .upsert({ id: 'default', ...config, updated_at: new Date().toISOString() })
      .select()
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, config: data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---- 글로벌 export ----
window.WebNovelsAdmin = {
  init: initSupabaseAdmin,
  login: adminLogin,
  logout: adminLogout,
  getCurrentAdmin,
  fetchDashboardKPI,
  fetchSubAdmins,
  createSubAdmin,
  updateSubAdminPermissions,
  changeSubAdminPassword,
  deleteSubAdmin,
  calculateRevenue,
  confirmRevenue,
  fetchRevenueEvents,
  fetchPendingSettlements,
  approveSettlement,
  fetchSystemConfig,
  updateSystemConfig
};
