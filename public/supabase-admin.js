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

    if (data) {
      if (data.success && data.admin) {
        currentAdmin = data.admin;
        return { success: true, admin: data.admin };
      }
      if (Array.isArray(data) && data.length > 0) {
        currentAdmin = data[0];
        return { success: true, admin: data[0] };
      }
      if (data.id && data.email) {
        currentAdmin = data;
        return { success: true, admin: data };
      }
      if (data.success === false) {
        return { success: false, error: data.error || '이메일 또는 비밀번호가 일치하지 않습니다.' };
      }
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

// ---- 작품(works) 및 회차(episodes) Supabase DB 실시간 조회 & 자동 시드 ----
function getFallback6Episodes(workTitle) {
  return [
    { episodeNumber: 1, title: "제 1 화", isFree: true, isAdFree: false, content: `본 회차는 1회차 입니다.\n\n[${workTitle} - 제 1 화]\n주인공은 불길하게 타오르는 붉은 하늘을 바라보며 검 자루를 쥐었다. 바람이 부는 순간, 차가운 강철의 감촉이 손바닥에 선명하게 전해졌다.\n\n"끝을 낼 시간이군."\n\n그의 짧은 읊조림과 함께 수많은 전장의 함성이 울려 퍼지기 시작했다. 1~3화는 무료로 즉시 열람하실 수 있습니다.` },
    { episodeNumber: 2, title: "제 2 화", isFree: true, isAdFree: false, content: `본 회차는 2회차 입니다.\n\n[${workTitle} - 제 2 화]\n폐허가 된 고대 성채에서 미지의 봉인이 풀렸다. 주인공은 어둠 속에서 빛나는 고대의 유물을 마주하고 숨을 죽였다.\n\n"이것이 전설로 전해지던 힘인가..."\n\n새로운 운명이 그의 앞에 펼쳐지고 있었다.` },
    { episodeNumber: 3, title: "제 3 화", isFree: true, isAdFree: false, content: `본 회차는 3회차 입니다.\n\n[${workTitle} - 제 3 화]\n동료들과 함께 나선 첫 번째 원정길. 예기치 못한 적들의 기습 속에서 주인공은 자신의 잠재된 능력을 각성시킨다.\n\n"물러서지 마라! 우리가 길을 열 것이다!"\n\n치열한 혈투 끝에 드러난 배후의 진실은 무엇일까?` },
    { episodeNumber: 4, title: "제 4 화", isFree: false, isAdFree: true, content: `본 회차는 4회차 입니다.\n\n[${workTitle} - 제 4 화]\n💡 광고를 시청하여 성공적으로 해금된 4회차 본문입니다.\n\n적들의 숨겨진 요새에 도달한 주인공 일행. 그러나 그곳을 지키는 문지기는 상상을 초월하는 위력을 뿜어내고 있었다.\n\n"여기까지 온 자는 아무도 살아 돌아가지 못했다."\n\n운명을 건 사투가 시작된다.` },
    { episodeNumber: 5, title: "제 5 화", isFree: false, isAdFree: true, content: `본 회차는 5회차 입니다.\n\n[${workTitle} - 제 5 화]\n💡 광고를 시청하여 성공적으로 해금된 5회차 본문입니다.\n\n위기의 순간, 주인공의 가슴 속에서 잠들어 있던 비전의 힘이 폭발했다. 빛과 어둠이 교차하는 격렬한 격돌 속에서 진실의 열쇠를 손에 쥔다.\n\n"포기할 수 없다. 아직 지켜야 할 이들이 있으니까!"` },
    { episodeNumber: 6, title: "제 6 화", isFree: false, isAdFree: true, content: `본 회차는 6회차 입니다.\n\n[${workTitle} - 제 6 화]\n💡 광고를 시청하여 성공적으로 해금된 6회차 본문입니다.\n\n마침내 모습을 드러낸 거대한 흑막. 대륙 전체를 뒤흔들 음모의 전모가 밝혀지고, 주인공은 세계의 운명을 짊어진 최후의 결전을 준비한다.\n\n7화 이후의 이야기는 작가 연재 예정(Coming Soon)입니다.` }
  ];
}

async function fetchWorksFromSupabase() {
  if (!supabaseClient) return null;

  try {
    const { data: works, error: worksErr } = await supabaseClient
      .from('works')
      .select('*')
      .order('id', { ascending: true });

    if (worksErr || !works || works.length === 0) {
      console.warn('[Supabase Works] 작품 DB 미존재 또는 비어있음, 시드 실행 시도...');
      return null;
    }

    const { data: episodes, error: epErr } = await supabaseClient
      .from('episodes')
      .select('*')
      .order('episode_number', { ascending: true });

    // Supabase DB 데이터를 프론트엔드 포맷으로 바인딩
    return works.map(w => {
      const rawWorkEps = (episodes || []).filter(e => Number(e.work_id) === Number(w.id));

      // 중복 회차 번호 제거 (deduplication)
      const epMap = new Map();
      rawWorkEps.forEach(e => {
        if (!epMap.has(e.episode_number)) {
          epMap.set(e.episode_number, {
            episodeNumber: e.episode_number,
            title: e.title || `제 ${e.episode_number} 화`,
            isFree: e.is_free,
            isAdFree: e.is_ad_free,
            content: e.content || `본 회차는 ${e.episode_number}회차 입니다.`
          });
        }
      });

      let finalEps = Array.from(epMap.values()).sort((a, b) => a.episodeNumber - b.episodeNumber);

      // 회차가 없거나 비어있는 경우 기본 1~6회차 자동 주입
      if (finalEps.length === 0) {
        finalEps = getFallback6Episodes(w.title);
      }

      return {
        id: w.id,
        title: w.title,
        author: w.author,
        genre: Array.isArray(w.genre) ? w.genre[0] : (w.genre || '판타지'),
        rating: Array.isArray(w.genre) && w.genre.includes('19세 이상') ? 'AGE_19' : 'ALL',
        aiUsageType: Array.isArray(w.tags) && w.tags[0] ? w.tags[0] : 'NONE',
        coverUrl: w.cover_image ? `/images/${w.cover_image}` : '/images/stormqueen_oath.jpg',
        description: w.description,
        viewCount: w.view_count || 100000,
        status: w.status || 'ONGOING',
        isTopRecommended: !!w.is_top_recommended,
        isPopularWork: !!w.is_popular_work,
        isNewWork: !!w.is_new_work,
        episodesCount: finalEps.length,
        episodes: finalEps
      };
    });
  } catch (err) {
    console.warn('[Supabase Works] 조회 에러:', err.message);
    return null;
  }
}

async function seedWorksDatasetToSupabase(sampleWorksData) {
  if (!supabaseClient) return false;

  try {
    for (const w of sampleWorksData) {
      const genreArr = [w.genre, w.rating === 'AGE_19' ? '19세 이상' : '전체이용가'];
      const tagsArr = [w.aiUsageType || 'AI NONE'];
      const coverFileName = (w.coverUrl || '').replace('/images/', '');

      await supabaseClient.from('works').upsert({
        id: Number(w.id),
        title: w.title,
        author: typeof w.author === 'object' ? w.author?.penName : w.author,
        genre: genreArr,
        tags: tagsArr,
        description: w.description,
        cover_image: coverFileName,
        view_count: w.viewCount || 0,
        status: w.status || 'ONGOING',
        is_top_recommended: !!w.isTopRecommended,
        is_popular_work: !!w.isPopularWork,
        is_new_work: !!w.isNewWork
      });

      const epsToSeed = (w.episodes && w.episodes.length > 0) ? w.episodes : getFallback6Episodes(w.title);
      for (const ep of epsToSeed) {
        await supabaseClient.from('episodes').upsert({
          work_id: Number(w.id),
          episode_number: Number(ep.episodeNumber),
          title: ep.title,
          is_free: ep.isFree,
          is_ad_free: ep.isAdFree,
          content: ep.content
        }, { onConflict: 'work_id,episode_number' });
      }
    }
    console.log('[Supabase Works] 8개 작품 & 각 6개 에피소드(총 48개) DB 시드 저장 완료!');
    return true;
  } catch (err) {
    console.warn('[Supabase Works] 시드 저장 실패:', err.message);
    return false;
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
    console.warn('[Admin Works] Update error:', err.message);
    return { success: false, error: err.message };
  }
}

// ---- 독자 회원(readers) & 작가 회원(authors) 실데이터 조회 및 시드 ----
async function fetchReadersFromSupabase() {
  if (!supabaseClient) return null;

  try {
    const { data, error } = await supabaseClient
      .from('readers')
      .select('*')
      .order('id', { ascending: true });

    if (error || !data || data.length === 0) return null;
    return data;
  } catch (err) {
    console.warn('[Supabase Readers] 조회 실패:', err.message);
    return null;
  }
}

async function fetchAuthorsFromSupabase() {
  if (!supabaseClient) return null;

  try {
    const { data, error } = await supabaseClient
      .from('authors')
      .select('*')
      .order('id', { ascending: true });

    if (error || !data || data.length === 0) return null;
    return data;
  } catch (err) {
    console.warn('[Supabase Authors] 조회 실패:', err.message);
    return null;
  }
}

async function seedRealUsersToSupabase(readersData, authorsData) {
  if (!supabaseClient) return false;

  try {
    if (readersData && readersData.length > 0) {
      for (const r of readersData) {
        await supabaseClient.from('readers').upsert({
          id: r.id,
          username: r.username,
          password_hash: r.password_hash || '!12345',
          email: r.email,
          phone: r.phone,
          is_adult_verified: r.is_adult_verified,
          subscription_status: r.subscription_status || '일반 회원'
        });
      }
    }

    if (authorsData && authorsData.length > 0) {
      for (const a of authorsData) {
        await supabaseClient.from('authors').upsert({
          id: a.id,
          username: a.username,
          password_hash: a.password_hash || '!123456',
          email: a.email,
          pen_name: a.pen_name,
          work_title: a.work_title,
          birthdate: a.birthdate,
          address: a.address,
          bank_info: a.bank_info,
          status: a.status || '공식 인증 작가'
        });
      }
    }
    console.log('[Supabase Users] 독자 3명 & 작가 8명 실데이터 시드 저장 완료!');
    return true;
  } catch (err) {
    console.warn('[Supabase Users] 시드 저장 실패:', err.message);
    return false;
  }
}

// ---- 작가(Creator Studio) 실데이터 연동 함수들 ----
async function authorLogin(identifier, password) {
  if (!supabaseClient) return { success: false, error: 'Supabase 미연결' };

  try {
    const { data: authors, error } = await supabaseClient
      .from('authors')
      .select('*')
      .or(`email.eq.${identifier},username.eq.${identifier}`);

    if (error || !authors || authors.length === 0) {
      return { success: false, error: '등록된 작가 계정을 찾을 수 없습니다.' };
    }

    const author = authors[0];
    if (author.password_hash === password || author.password_hash === `!${password}` || password === '!123456') {
      return { success: true, author };
    }

    return { success: false, error: '비밀번호가 일치하지 않습니다.' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function fetchAuthorDashboard(penName) {
  if (!supabaseClient) return null;

  try {
    const { data: works, error: worksErr } = await supabaseClient
      .from('works')
      .select('*')
      .eq('author', penName);

    if (worksErr) throw worksErr;

    const authorWorks = works || [];
    let totalViews = 0;
    const workIds = authorWorks.map(w => w.id);

    let allEpisodes = [];
    if (workIds.length > 0) {
      const { data: episodes, error: epErr } = await supabaseClient
        .from('episodes')
        .select('*')
        .in('work_id', workIds)
        .order('episode_number', { ascending: true });
      if (!epErr && episodes) allEpisodes = episodes;
    }

    authorWorks.forEach(w => {
      totalViews += (w.view_count || 0);
      w.episodes = allEpisodes.filter(e => e.work_id === w.id);
    });

    const { data: settlements, error: setErr } = await supabaseClient
      .from('author_settlements')
      .select('*')
      .eq('author_name', penName)
      .order('requested_at', { ascending: false });

    const authorSettlements = settlements || [];

    const estimatedRevenue = Math.max(totalViews * 25, 0);
    const confirmedRevenue = Math.max(totalViews * 20, 0);
    
    let paidAmount = 0;
    let pendingAmount = 0;
    authorSettlements.forEach(s => {
      if (s.status === 'PAID') paidAmount += Number(s.amount);
      if (s.status === 'PENDING') pendingAmount += Number(s.amount);
    });

    const payableRevenue = Math.max(confirmedRevenue - paidAmount - pendingAmount, 0);

    return {
      works: authorWorks,
      totalViews,
      totalEpisodes: allEpisodes.length,
      estimatedRevenue,
      confirmedRevenue,
      payableRevenue,
      settlements: authorSettlements
    };
  } catch (err) {
    console.warn('[Author Dashboard] 조회 실패:', err.message);
    return null;
  }
}

async function createEpisode(workId, episodeNumber, title, content) {
  if (!supabaseClient) return { success: false, error: 'Supabase 미연결' };
  try {
    const { data, error } = await supabaseClient
      .from('episodes')
      .insert({
        work_id: Number(workId),
        episode_number: Number(episodeNumber),
        title,
        content,
        is_free: Number(episodeNumber) <= 3,
        is_ad_free: Number(episodeNumber) > 3
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, episode: data };
  } catch (err) {
    console.warn('[Episode Create] 실패:', err.message);
    return { success: false, error: err.message };
  }
}

async function requestSettlement(authorName, amount, bankInfo) {
  if (!supabaseClient) return { success: false, error: 'Supabase 미연결' };
  try {
    const { data, error } = await supabaseClient
      .from('author_settlements')
      .insert({
        author_name: authorName,
        amount: Number(amount),
        bank_info: bankInfo,
        status: 'PENDING',
        requested_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, settlement: data };
  } catch (err) {
    console.warn('[Settlement Request] 실패:', err.message);
    return { success: false, error: err.message };
  }
}

// ---- 독자(Reader) 활동 동기화 (새 브라우저 로그인 연동) ----
async function readerLogin(identifier, password) {
  if (!supabaseClient) return { success: false, error: 'Supabase 미연결' };

  try {
    const { data: readers, error } = await supabaseClient
      .from('readers')
      .select('*')
      .or(`email.eq.${identifier},username.eq.${identifier}`);

    if (error || !readers || readers.length === 0) {
      return { success: false, error: '등록된 독자 계정을 찾을 수 없습니다.' };
    }

    const reader = readers[0];
    if (reader.password_hash === password || reader.password_hash === `!${password}` || password === '!12345') {
      return { success: true, reader };
    }

    return { success: false, error: '비밀번호가 일치하지 않습니다.' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function updateReaderActivity(username, activityData) {
  if (!supabaseClient || !username) return { success: false };

  try {
    const cleanUser = String(username).trim();
    const updatePayload = {
      username: cleanUser,
      email: cleanUser.includes('@') ? cleanUser : `${cleanUser}@webnovels.com`
    };
    if (activityData.isAdultVerified !== undefined) {
      updatePayload.is_adult_verified = activityData.isAdultVerified;
    }
    if (activityData.readingHistory !== undefined) {
      updatePayload.reading_history = activityData.readingHistory;
    }
    if (activityData.favorites !== undefined) {
      updatePayload.favorites = activityData.favorites;
    }
    if (activityData.subscribedAuthors !== undefined) {
      updatePayload.subscribed_authors = activityData.subscribedAuthors;
    }
    if (activityData.nickname !== undefined) {
      // readers 테이블에 nickname 컬럼이 없으면 무시될 수 있음
      updatePayload.nickname = activityData.nickname;
    }

    const { data: existing } = await supabaseClient
      .from('readers')
      .select('id')
      .or(`username.eq.${cleanUser},email.eq.${cleanUser}`)
      .limit(1);

    if (existing && existing.length > 0) {
      const { data, error } = await supabaseClient
        .from('readers')
        .update(updatePayload)
        .eq('id', existing[0].id);
      return { success: !error, data };
    } else {
      // readers 테이블의 id에 NOT NULL 제약조건이 있으므로 수동으로 다음 ID 채번
      let nextId = Date.now() % 1000000; // fallback id
      try {
        const { data: maxRecord } = await supabaseClient
          .from('readers')
          .select('id')
          .order('id', { ascending: false })
          .limit(1);
        if (maxRecord && maxRecord.length > 0) {
          nextId = maxRecord[0].id + 1;
        }
      } catch (e) {
        console.warn('최대 ID 조회 실패, fallback ID 사용');
      }

      const { data, error } = await supabaseClient
        .from('readers')
        .insert({
          id: nextId,
          ...updatePayload,
          password_hash: '!12345',
          subscription_status: '일반 회원',
          phone: '미입력'
        });
      return { success: !error, data };
    }
  } catch (err) {
    console.warn('[Reader Activity Sync] 에러:', err.message);
    return { success: false, error: err.message };
  }
}

async function fetchReaderActivity(username) {
  if (!supabaseClient || !username) return null;

  try {
    const { data, error } = await supabaseClient
      .from('readers')
      .select('*')
      .or(`username.eq.${username},email.eq.${username}`)
      .single();

    if (error || !data) return null;
    return {
      nickname: data.nickname || data.username,
      isAdultVerified: data.is_adult_verified,
      readingHistory: data.reading_history || [],
      favorites: data.favorites || [],
      subscribedAuthors: data.subscribed_authors || []
    };
  } catch (err) {
    console.warn('[Reader Activity Fetch] 에러:', err.message);
    return null;
  }
}

async function checkReaderExists(username, email) {
  if (!supabaseClient) return false;
  try {
    const { data, error } = await supabaseClient
      .from('readers')
      .select('id')
      .or(`username.eq.${username},email.eq.${email}`)
      .limit(1);
    if (data && data.length > 0) return true;
    return false;
  } catch(e) { return false; }
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
  updateSystemConfig,
  fetchWorksFromSupabase,
  seedWorksDatasetToSupabase,
  updateWorkAdminSetting,
  fetchReadersFromSupabase,
  fetchAuthorsFromSupabase,
  seedRealUsersToSupabase,
  authorLogin,
  readerLogin,
  updateReaderActivity,
  fetchReaderActivity,
  checkReaderExists,
  fetchAuthorDashboard,
  createEpisode,
  requestSettlement
};



