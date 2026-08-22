const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://ghwabesnydktumeyejnm.supabase.co',
  'sb_publishable_XYQ7ydRrTZQ94V6r1WKEtQ_pnL9Po5c'
);

(async () => {
  try {
    const email = 'test1@gmail.com';
    const cleanUser = 'test1'; // username으로 가정한 닉네임 또는 이메일의 앞부분

    const updatePayload = {
      username: cleanUser,
      email: email,
      nickname: '테스트독자',
      is_adult_verified: false,
      reading_history: [],
      favorites: [],
      subscribed_authors: []
    };

    console.log('=== [1] 기존 계정 존재 여부 확인 ===');
    const { data: existing, error: selErr } = await supabase
      .from('readers')
      .select('id')
      .or(`username.eq.${cleanUser},email.eq.${cleanUser}`)
      .limit(1);

    if (selErr) console.log('SELECT ERROR:', selErr);

    if (existing && existing.length > 0) {
      console.log('이미 존재하는 계정입니다:', existing[0]);
    } else {
      console.log('계정이 존재하지 않습니다. 신규 회원가입(INSERT) 절차 진행...');

      // 1. 가장 큰 id 조회
      console.log('=== [2] max(id) 조회 시도 ===');
      let nextId = Date.now() % 1000000;
      const { data: maxRecord, error: maxErr } = await supabase
        .from('readers')
        .select('id')
        .order('id', { ascending: false })
        .limit(1);
      
      if (maxErr) {
        console.log('max(id) 조회 실패 (RLS 차단 의심):', JSON.stringify(maxErr));
      } else {
        if (maxRecord && maxRecord.length > 0) {
          nextId = maxRecord[0].id + 1;
          console.log('max(id) 조회 성공! 부여할 nextId:', nextId);
        } else {
          console.log('테이블이 비어있음, nextId:', nextId);
        }
      }

      // 2. INSERT 시도
      console.log('\n=== [3] INSERT 시도 ===');
      const { data: insData, error: insErr } = await supabase
        .from('readers')
        .insert({
          id: nextId,
          ...updatePayload,
          password_hash: '!12345',
          subscription_status: '일반 회원',
          phone: '미입력'
        })
        .select();

      if (insErr) {
        console.log('INSERT 실패 ERROR:', JSON.stringify(insErr, null, 2));
      } else {
        console.log('INSERT 성공 DATA:', JSON.stringify(insData, null, 2));
      }
    }
  } catch (err) {
    console.error('FATAL ERROR:', err.message);
  }
  process.exit(0);
})();
