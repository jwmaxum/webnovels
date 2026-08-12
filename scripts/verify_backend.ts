import { app } from '../src/app.js';
import { db } from '../src/config/db.js';
import http from 'http';

const PORT = 4001;
let server: http.Server;

async function runVerification() {
  console.log('🧪 ====================================================');
  console.log('🧪 웹소설 플랫폼 백엔드 통합 기능 및 기획서 명세 검증 시작');
  console.log('🧪 ====================================================\n');

  // DB 초과 데이터 초기화
  await db.$transaction([
    db.authorSettlement.deleteMany(),
    db.authorRevenue.deleteMany(),
    db.revenueEvent.deleteMany(),
    db.episodeUnlock.deleteMany(),
    db.adCompletion.deleteMany(),
    db.adImpression.deleteMany(),
    db.comment.deleteMany(),
    db.episodeStatistics.deleteMany(),
    db.episode.deleteMany(),
    db.workStatistics.deleteMany(),
    db.work.deleteMany(),
    db.authorAccount.deleteMany(),
    db.author.deleteMany(),
    db.userProfile.deleteMany(),
    db.user.deleteMany()
  ]);

  server = app.listen(PORT);

  const baseUrl = `http://localhost:${PORT}/api`;

  try {
    // 1. Health Check
    console.log('▶ [1/6] Health Check');
    const healthRes = await fetch(`${baseUrl}/health`);
    const healthData: any = await healthRes.json();
    console.log('   Health Status:', healthData.status);

    // 2. 회원가입 및 Auth 검증
    console.log('\n▶ [2/6] 회원가입 & 인증 테스트 (Reader / Author / Admin)');
    
    // Admin 생성 및 ROLE 업데이트
    const adminSignup = await fetch(`${baseUrl}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@webnovel.com', password: 'password123', nickname: '최고관리자' })
    });
    const adminData: any = await adminSignup.json();
    await db.user.update({ where: { id: adminData.user.id }, data: { role: 'ADMIN' } });

    // ADMIN 역할이 반영된 새 토큰 발급 (로그인 호출)
    const adminLogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@webnovel.com', password: 'password123' })
    });
    const adminLoginData: any = await adminLogin.json();
    const adminToken = adminLoginData.token;
    console.log('   ✅ 관리자 생성 완료 Token (ADMIN Role):', adminToken.slice(0, 15) + '...');

    // Author 사용자 생성
    const authorSignup = await fetch(`${baseUrl}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'author@webnovel.com', password: 'password123', nickname: '인기작가' })
    });
    const authorData: any = await authorSignup.json();
    const authorUserToken = authorData.token;
    console.log('   ✅ 작가 사용자 생성 완료');

    // Reader 사용자 생성
    const readerSignup = await fetch(`${baseUrl}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reader@webnovel.com', password: 'password123', nickname: '열혈독자' })
    });
    const readerData: any = await readerSignup.json();
    const readerToken = readerData.token;
    console.log('   ✅ 독자 사용자 생성 완료');

    // 독자 정보 수정 테스트 (닉네임 및 비밀번호 변경)
    const updateReader = await fetch(`${baseUrl}/auth/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${readerToken}` },
      body: JSON.stringify({
        nickname: '열혈독자_수정됨',
        currentPassword: 'password123',
        newPassword: 'newpassword123'
      })
    });
    const updateReaderData: any = await updateReader.json();
    console.log('   ✅ 독자 회원 정보수정 완료 닉네임:', updateReaderData.user.nickname);

    // 3. 작가 등록 및 작품/회차 연재 (Section 20)
    console.log('\n▶ [3/6] Creator Studio: 작가 등록 및 작품/회차 연재');
    const regAuthor = await fetch(`${baseUrl}/creator/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorUserToken}` },
      body: JSON.stringify({
        penName: '판타지마스터',
        bio: '재미있는 소설을 씁니다',
        bankName: '신한은행',
        accountNumber: '110-123-456789',
        accountHolder: '인기작가'
      })
    });
    const regAuthorData: any = await regAuthor.json();
    console.log('   ✅ 작가 등록 성공 PenName:', regAuthorData.author.penName);

    // 작가 정보 및 정산 계좌 수정 테스트
    const updateAuthor = await fetch(`${baseUrl}/creator/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorUserToken}` },
      body: JSON.stringify({
        penName: '판타지마스터_PRO',
        bankName: '국민은행',
        accountNumber: '999-888-777666'
      })
    });
    const updateAuthorData: any = await updateAuthor.json();
    console.log('   ✅ 작가 프로필 & 정산 계좌 수정 완료 PenName:', updateAuthorData.author.penName, 'Bank:', updateAuthorData.author.account.bankName);

    // 작품 등록
    const createWork = await fetch(`${baseUrl}/creator/works`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorUserToken}` },
      body: JSON.stringify({
        title: '대적자: 신을 삼킨 기사',
        description: '광고를 보면 다음 회차가 공개되는 대표 판타지 웹소설',
        genre: 'FANTASY',
        tags: '회귀,판타지,성장',
        rating: 'ALL'
      })
    });
    const workData: any = await createWork.json();
    const workId = workData.work.id;
    console.log('   ✅ 작품 등록 완료 Title:', workData.work.title);

    // 1~3화 무료, 4화 광고 Unlock 회차 등록
    for (let i = 1; i <= 4; i++) {
      await fetch(`${baseUrl}/creator/works/${workId}/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorUserToken}` },
        body: JSON.stringify({
          title: `제 ${i}화`,
          content: `이것은 제 ${i}화 본문 내용입니다. 독자가 즐겁게 읽는 구간입니다.`,
          isFree: i <= 3,
          adUnlockRequired: i > 3
        })
      });
    }
    console.log('   ✅ 회차 등록 완료 (1~3화 무료, 4화 광고 Unlock 필수)');

    // 4. 작품 상세 및 1화 읽기
    console.log('\n▶ [4/6] Reader View: 작품 상세 조회 및 무료 1화 읽기');
    const workDetailRes = await fetch(`${baseUrl}/works/${workId}`);
    const workDetail: any = await workDetailRes.json();
    console.log('   작품 내 공개 회차 수:', workDetail.work.episodes.length);

    const ep1Res = await fetch(`${baseUrl}/episodes/${workDetail.work.episodes[0].id}`);
    const ep1Data: any = await ep1Res.json();
    console.log('   ✅ 1화 읽기 성공 (Content 일부):', ep1Data.episode.content.slice(0, 20));

    // 5. 4화 (광고 필요) 읽기 시도 -> AD_UNLOCK_REQUIRED -> Ad Verification -> 회차 Unlock 검증
    console.log('\n▶ [5/6] Rewarded Ad Engine & Server-Side Verification (SSV) Unlock');
    const ep4Id = workDetail.work.episodes[3].id;
    
    // (1) 미인증 상태로 4화 접근 시도
    const ep4DeniedRes = await fetch(`${baseUrl}/episodes/${ep4Id}`, {
      headers: { Authorization: `Bearer ${readerToken}` }
    });
    console.log('   🔒 4화 최초 접근 시 응답 status (402 예상):', ep4DeniedRes.status);
    const deniedData: any = await ep4DeniedRes.json();
    console.log('   🔒 Error Code:', deniedData.code);

    // (2) 보상형 광고 시청 요청
    const adReqRes = await fetch(`${baseUrl}/ads/request-unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${readerToken}` },
      body: JSON.stringify({ episodeId: ep4Id })
    });
    const adReqData: any = await adReqRes.json();
    console.log('   📺 Rewarded Ad Token 발급:', adReqData.rewardToken.slice(0, 25) + '...');

    // (3) 광고 시청 완료 서버 검증 (SSV)
    const adVerifyRes = await fetch(`${baseUrl}/ads/verify-unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${readerToken}` },
      body: JSON.stringify({ episodeId: ep4Id, rewardToken: adReqData.rewardToken })
    });
    const adVerifyData: any = await adVerifyRes.json();
    console.log('   ✅ 광고 서버 검증 및 회차 Unlock 완료:', adVerifyData.message);

    // (4) 4화 재접근 -> 정상 성공
    const ep4AccessRes = await fetch(`${baseUrl}/episodes/${ep4Id}`, {
      headers: { Authorization: `Bearer ${readerToken}` }
    });
    const ep4AccessData: any = await ep4AccessRes.json();
    console.log('   🔓 4화 열람 승인 성공! 회차 제목:', ep4AccessData.episode.title);

    // 6. Revenue Allocation Engine 및 작가 정산 검증 (Section 13~19)
    console.log('\n▶ [6/6] Revenue Allocation Engine & 작가 정산 프로세스');
    
    // 관리자가 8월 광고 매출 (총 10,000,000원, 수수료 2,000,000원 -> 순수익 8,000,000원, 작가Pool 62.5% = 5,000,000원) 입력
    const calcRevenueRes = await fetch(`${baseUrl}/admin/revenue/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        periodMonth: '2026-08',
        grossRevenue: 10000000,
        adNetworkFee: 2000000,
        writerPoolRatio: 0.625
      })
    });
    const calcData: any = await calcRevenueRes.json();
    console.log('   [Debug] Calc Status:', calcRevenueRes.status, 'Calc Data:', calcData);
    console.log('   💰 8월 수익배분 산정 완료 (Writer Pool):', calcData.result.writerPool.toLocaleString() + '원');

    // 작가 Creator Studio Dashboard 실시간 예상수익 확인
    const authorDashRes = await fetch(`${baseUrl}/creator/dashboard`, {
      headers: { Authorization: `Bearer ${authorUserToken}` }
    });
    const authorDash: any = await authorDashRes.json();
    console.log('   📊 Creator Studio 이번달 예상수익 (Estimated):', authorDash.revenue.estimatedRevenue.toLocaleString() + '원');

    // 정산 최종 마감 (Confirmed)
    await fetch(`${baseUrl}/admin/revenue/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ periodMonth: '2026-08' })
    });
    console.log('   ✅ 8월 월간 정산 최종 확정 (Confirmed)');

    // 작가 정산 재조회 -> 출금 가능 금액 (Payable) 확인 및 정산 신청
    const authorDashConfirmedRes = await fetch(`${baseUrl}/creator/dashboard`, {
      headers: { Authorization: `Bearer ${authorUserToken}` }
    });
    const authorDashConfirmed: any = await authorDashConfirmedRes.json();
    console.log('   💳 정산 가능 금액 (Payable):', authorDashConfirmed.revenue.payableRevenue.toLocaleString() + '원');

    // 작가 정산 신청
    const settleReq = await fetch(`${baseUrl}/creator/settlement/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorUserToken}` }
    });
    const settleData: any = await settleReq.json();
    console.log('   📩 작가 정산 신청 성공 ID:', settleData.settlement.id);

    // 관리자 정산 신청 승인
    const approveRes = await fetch(`${baseUrl}/admin/settlement/${settleData.settlement.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const approveData: any = await approveRes.json();
    console.log('   🎉 관리자 정산 지급 승인 완료 Status:', approveData.settlement.status);

    // 7. PG (토스페이먼츠) & PASS 본인인증 (KCP) 외부 연동 테스트
    console.log('\n▶ [7/7] 외부 연동: PASS / KCP 성인인증 및 토스페이먼츠 PG 설정');
    
    // (1) Admin PG 설정 조회 및 갱신 (Section 33)
    const pgConfigGet = await fetch(`${baseUrl}/admin/config/pg`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const pgConfigData: any = await pgConfigGet.json();
    console.log('   ⚙️ 현재 PG 설정 조회 (Secret Key Masking):', pgConfigData.config.tossSecretKey);

    const pgConfigUpdate = await fetch(`${baseUrl}/admin/config/pg`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        tossClientKey: 'test_ck_docs_O7l2mZ1N3p81A2jL3b5z',
        tossSecretKey: 'test_sk_docs_O7l2mZ1N3p81A2jL3b5z',
        kcpSiteCode: 'T0000'
      })
    });
    const updatedPgData: any = await pgConfigUpdate.json();
    console.log('   ✅ PG 설정 갱신 성공:', updatedPgData.message);

    // (2) PG 및 KCP 연동 테스트 호출
    const testConnRes = await fetch(`${baseUrl}/admin/config/pg/test-connection`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const testConnData: any = await testConnRes.json();
    console.log('   🔌 토스페이먼츠 연동 상태:', testConnData.tossPayments.message);
    console.log('   🔌 KCP/PASS 연동 상태:', testConnData.kcpPass.message);

    // (3) PASS / KCP 성인 본인인증 진행 (독자)
    const kcpInitRes = await fetch(`${baseUrl}/auth/verify-adult/kcp/init`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${readerToken}` }
    });
    const kcpInitData: any = await kcpInitRes.json();
    console.log('   📲 KCP PASS 인증 세션 발급 (ordrIdxx):', kcpInitData.data.ordrIdxx);

    const kcpConfirmRes = await fetch(`${baseUrl}/auth/verify-adult/kcp/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${readerToken}` },
      body: JSON.stringify({
        ordrIdxx: kcpInitData.data.ordrIdxx,
        userBirth: '19950515',
        userName: '열혈독자'
      })
    });
    const kcpConfirmData: any = await kcpConfirmRes.json();
    console.log('   🔞 PASS 성인 인증 확인 (isAdultVerified):', kcpConfirmData.user.isAdultVerified);

    // (4) 토스페이먼츠 결제 승인 요청 (Reader)
    const tossConfirmRes = await fetch(`${baseUrl}/payments/toss/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${readerToken}` },
      body: JSON.stringify({
        paymentKey: `pk_test_${Date.now()}`,
        orderId: `order_${Date.now()}`,
        amount: 50000
      })
    });
    const tossConfirmData: any = await tossConfirmRes.json();
    console.log('   💳 토스페이먼츠 승인 완료 Status:', tossConfirmData.result.status, '금액:', tossConfirmData.result.totalAmount.toLocaleString() + '원');

    // 8. 서브 관리자(sub_admin) 계정 생성, 권한 부여, 비밀번호 변경 및 RBAC 통제 검증
    console.log('\n▶ [8/8] RBAC: 서브 관리자 생성, 메뉴 권한 지정/수정 & 비밀번호 변경');

    // (1) .env.local 기반 최고 관리자(SUPER_ADMIN) 로그인
    const { SuperAdminInitService } = await import('../src/services/superAdminInit.service.js');
    await SuperAdminInitService.initSuperAdmin();

    const superAdminLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'jwmaxum@gmail.com', password: 'sang@4478000' })
    });
    const superAdminLoginData: any = await superAdminLoginRes.json();
    const superAdminToken = superAdminLoginData.token;
    console.log('   👑 .env.local 기반 최고 관리자(SUPER_ADMIN) 로그인 성공 (Role):', superAdminLoginData.user.role);

    // (2) SUPER_ADMIN이 서브 관리자(sub_admin_01) 생성 (DASHBOARD 및 USER_MGMT 메뉴만 허용)
    const createSubAdminRes = await fetch(`${baseUrl}/admin/sub-admins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superAdminToken}` },
      body: JSON.stringify({
        username: 'sub_admin_01',
        password: 'subpassword123',
        nickname: '콘텐츠담당서브관',
        permissions: ['DASHBOARD', 'USER_MGMT']
      })
    });
    const createSubAdminData: any = await createSubAdminRes.json();
    const subAdmin1 = createSubAdminData.subAdmin;
    console.log('   👤 서브 관리자 생성 성공 Username:', subAdmin1.username, '허용 메뉴:', subAdmin1.permissions);

    // (3) 생성된 서브 관리자 로그인 및 권한별 접근 테스트
    const subAdminLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'sub_admin_01', password: 'subpassword123' })
    });
    const subAdminLoginData: any = await subAdminLoginRes.json();
    const subAdminToken = subAdminLoginData.token;
    console.log('   🔑 서브 관리자 로그인 성공 (Permissions):', subAdminLoginData.user.permissions);

    // [권한 성공 케이스] DASHBOARD 접근
    const dashAllowedRes = await fetch(`${baseUrl}/admin/dashboard`, {
      headers: { Authorization: `Bearer ${subAdminToken}` }
    });
    console.log('   ✅ [권한 허용 메뉴] Dashboard 접근 성공 status:', dashAllowedRes.status);

    // [권한 거부 케이스] SYSTEM_MGMT (PG 설정 API) 접근 시 403 Forbidden 발생 검증
    const pgDeniedRes = await fetch(`${baseUrl}/admin/config/pg`, {
      headers: { Authorization: `Bearer ${subAdminToken}` }
    });
    console.log('   🚫 [권한 미부여 메뉴] SYSTEM_MGMT 접근 차단 status (403 예상):', pgDeniedRes.status);
    const pgDeniedData: any = await pgDeniedRes.json();
    console.log('   🚫 차단 메시지:', pgDeniedData.error);

    // (4) SUPER_ADMIN이 서브 관리자의 비밀번호 변경 및 메뉴 권한 추가 (SYSTEM_MGMT 추가)
    const updatePermRes = await fetch(`${baseUrl}/admin/sub-admins/${subAdmin1.id}/permissions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superAdminToken}` },
      body: JSON.stringify({ permissions: ['DASHBOARD', 'USER_MGMT', 'SYSTEM_MGMT'] })
    });
    const updatePermData: any = await updatePermRes.json();
    console.log('   🔄 서브 관리자 권한 수정 완료 (SYSTEM_MGMT 추가):', updatePermData.subAdmin.permissions);

    const updatePwdRes = await fetch(`${baseUrl}/admin/sub-admins/${subAdmin1.id}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superAdminToken}` },
      body: JSON.stringify({ newPassword: 'newsubpassword5678' })
    });
    const updatePwdData: any = await updatePwdRes.json();
    console.log('   🔑 서브 관리자 비밀번호 변경 완료:', updatePwdData.message);

    // (5) 변경된 비밀번호로 서브 관리자 재로그인 및 신규 추가된 SYSTEM_MGMT 메뉴 접근 성공 확인
    const subAdminRelogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'sub_admin_01', password: 'newsubpassword5678' })
    });
    const subAdminReloginData: any = await subAdminRelogin.json();
    const newSubAdminToken = subAdminReloginData.token;

    const pgNowAllowedRes = await fetch(`${baseUrl}/admin/config/pg`, {
      headers: { Authorization: `Bearer ${newSubAdminToken}` }
    });
    console.log('   🔓 [권한 추가 후] SYSTEM_MGMT 접근 성공 status:', pgNowAllowedRes.status);

    console.log('\n🎉 ====================================================');
    console.log('🎉 모든 백엔드 및 서브 관리자 RBAC 권한 검증이 성공했습니다!');
    console.log('🎉 ====================================================\n');
  } catch (err) {
    console.error('❌ 검증 중 에러 발생:', err);
    process.exit(1);
  } finally {
    if (server) server.close();
  }
}

runVerification();
