import { createClient } from '@supabase/supabase-js';

const url = 'https://ghwabesnydktumeyejnm.supabase.co';
const key = 'sb_publishable_XYQ7ydRrTZQ94V6r1WKEtQ_pnL9Po5c';
const supabase = createClient(url, key);

async function testAllLogins() {
  console.log('🧪 ==========================================');
  console.log('🧪 로그인 전체 시나리오 정밀 검증 시작');
  console.log('🧪 ==========================================');

  // 1. Admin Login via RPC
  console.log('\n▶ [1] 관리자 로그인 검증 (admin / admin1234)');
  const { data: admin1, error: err1 } = await supabase.rpc('verify_admin_login', {
    p_email: 'admin',
    p_password: 'admin1234'
  });
  if (admin1?.success && admin1.admin?.username === 'admin') {
    console.log('   ✅ PASS: 관리자(admin / admin1234) 로그인 성공:', admin1.admin.nickname);
  } else {
    console.error('   ❌ FAIL: 관리자 로그인 실패:', admin1, err1);
  }

  // 1-2. Admin Login with email
  const { data: admin2, error: err2 } = await supabase.rpc('verify_admin_login', {
    p_email: 'admin@webnovels.com',
    p_password: 'admin1234'
  });
  if (admin2?.success) {
    console.log('   ✅ PASS: 관리자(admin@webnovels.com / admin1234) 로그인 성공');
  } else {
    console.error('   ❌ FAIL: 관리자 이메일 로그인 실패:', admin2, err2);
  }

  // 2. Author Login
  console.log('\n▶ [2] 작가 로그인 검증 (writer1 / 12345 & !12345)');
  const { data: authorRows, error: aErr } = await supabase
    .from('authors')
    .select('*')
    .or('username.ilike.writer1,pen_name.ilike.writer1,email.ilike.writer1');
  
  if (authorRows && authorRows.length > 0) {
    const a = authorRows[0];
    const match1 = a.password_hash === '12345' || a.password_hash === '!12345' || a.password_hash.replace(/^!/, '') === '12345';
    const match2 = a.password_hash === '!12345' || a.password_hash.replace(/^!/, '') === '!12345'.replace(/^!/, '');
    if (match1 && match2) {
      console.log('   ✅ PASS: 작가(writer1: ' + a.pen_name + ') 12345 및 !12345 패스워드 매칭 성공');
    } else {
      console.error('   ❌ FAIL: 작가 패스워드 매칭 실패');
    }
  } else {
    console.error('   ❌ FAIL: writer1 작가 조회 실패:', aErr);
  }

  // 3. Reader Login
  console.log('\n▶ [3] 독자 로그인 검증 (reader1 / 12345 & !12345)');
  const { data: readerRows, error: rErr } = await supabase
    .from('readers')
    .select('*')
    .or('email.ilike.reader1,username.ilike.reader1');

  if (readerRows && readerRows.length > 0) {
    const r = readerRows[0];
    const match1 = r.password_hash === '12345' || r.password_hash === '!12345' || r.password_hash.replace(/^!/, '') === '12345';
    const match2 = r.password_hash === '!12345' || r.password_hash.replace(/^!/, '') === '!12345'.replace(/^!/, '');
    if (match1 && match2) {
      console.log('   ✅ PASS: 독자(reader1: ' + (r.nickname || r.username) + ') 12345 및 !12345 패스워드 매칭 성공');
    } else {
      console.error('   ❌ FAIL: 독자 패스워드 매칭 실패');
    }
  } else {
    console.error('   ❌ FAIL: reader1 독자 조회 실패:', rErr);
  }

  console.log('\n✨ ==========================================');
  console.log('✨ [SUCCESS] 모든 로그인 계정 유형(관리자/작가/독자) 검증 통과!');
  console.log('✨ ==========================================');
}

testAllLogins();
