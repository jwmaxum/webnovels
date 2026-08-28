const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// 1. 환경 설정 로드
const envLocal = dotenv.parse(fs.readFileSync(path.join(__dirname, '..', '.env.local')));
const SUPABASE_URL = envLocal.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = envLocal.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const OPENROUTER_KEY = envLocal.OpenRouter_API_Key;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Supabase 환경 변수가 누락되었습니다.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 기존 1~10번 작품 (안전하게 보존)
const EXISTING_WORKS = [
  {
    id: 1,
    title: '대적자: 신을 삼킨 기사',
    author: '판타지마스터',
    contentType: 'NOVEL',
    genre: ['판타지', '전체이용가'],
    tags: ['AI NONE', '기사', '성장'],
    description: '신들의 몰락과 기사의 재림! 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!',
    coverImage: 'stormqueen_oath.jpg',
    viewCount: 154000,
    status: 'ONGOING',
    isCompleted: false,
    isTopRecommended: true,
    isPopularWork: true,
    isNewWork: false
  },
  {
    id: 2,
    title: '천마의 귀환',
    author: '무협의신',
    contentType: 'NOVEL',
    genre: ['무협', '전체이용가'],
    tags: ['AI NONE', '천마', '회귀'],
    description: '천마가 다시 눈을 떴다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!',
    coverImage: 'sword_dao_supreme.jpg',
    viewCount: 231000,
    status: 'ONGOING',
    isCompleted: false,
    isTopRecommended: true,
    isPopularWork: true,
    isNewWork: false
  },
  {
    id: 3,
    title: '금기의 계약',
    author: '나이트로즈',
    contentType: 'NOVEL',
    genre: ['성인', '19세 이상'],
    tags: ['AI NONE', '치명적', '로맨스'],
    description: '금지된 계약으로 시작된 위험한 욕망. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!',
    coverImage: 'velvet_and_thorns.jpg',
    viewCount: 189000,
    status: 'ONGOING',
    isCompleted: false,
    isTopRecommended: false,
    isPopularWork: true,
    isNewWork: false
  },
  {
    id: 4,
    title: '황제의 유일한 후궁',
    author: '로맨스퀸',
    contentType: 'NOVEL',
    genre: ['로맨스', '전체이용가'],
    tags: ['AI NONE', '궁중', '애절'],
    description: '황제의 후궁이 된 그녀, 그리고 금지된 사랑. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!',
    coverImage: 'flower_blooming.jpg',
    viewCount: 312000,
    status: 'ONGOING',
    isCompleted: false,
    isTopRecommended: true,
    isPopularWork: true,
    isNewWork: false
  },
  {
    id: 5,
    title: '성간 항로: 마지막 항해사',
    author: '스페이스로그',
    contentType: 'NOVEL',
    genre: ['SF', '전체이용가'],
    tags: ['AI NONE', '우주', '생존'],
    description: '인류 최후의 항해사가 별들을 건너다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!',
    coverImage: 'stellar_horizon.jpg',
    viewCount: 97000,
    status: 'ONGOING',
    isCompleted: false,
    isTopRecommended: false,
    isPopularWork: false,
    isNewWork: true
  },
  {
    id: 6,
    title: '서울에 나타난 마왕',
    author: '도시마법사',
    contentType: 'NOVEL',
    genre: ['현대 판타지', '전체이용가'],
    tags: ['AI NONE', '현대', '마왕'],
    description: '현대 서울에 마왕이 강림했다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!',
    coverImage: 'seoul_sorcerer.jpg',
    viewCount: 278000,
    status: 'ONGOING',
    isCompleted: false,
    isTopRecommended: false,
    isPopularWork: true,
    isNewWork: true
  },
  {
    id: 7,
    title: '죽은 자들의 학교',
    author: '공포작가',
    contentType: 'NOVEL',
    genre: ['호러', '전체이용가'],
    tags: ['AI NONE', '폐교', '미스터리'],
    description: '폐교에 남은 것들. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!',
    coverImage: 'darkness_swallowed_classroom.jpg',
    viewCount: 84000,
    status: 'COMPLETED',
    isCompleted: true,
    isTopRecommended: false,
    isPopularWork: false,
    isNewWork: true
  },
  {
    id: 8,
    title: '검의 전설: 천하제일인',
    author: '검성',
    contentType: 'NOVEL',
    genre: ['무협', '전체이용가'],
    tags: ['AI NONE', '검술', '절대자'],
    description: '천하를 제패할 검이 깨어난다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!',
    coverImage: 'sword_dao_defies_heavens.jpg',
    viewCount: 195000,
    status: 'COMPLETED',
    isCompleted: true,
    isTopRecommended: false,
    isPopularWork: true,
    isNewWork: false
  },
  {
    id: 9,
    title: '[웹툰] 신의 기사단',
    author: '스튜디오노바',
    contentType: 'WEBTOON',
    genre: ['판타지', '액션'],
    tags: ['웹툰', '풀컬러', '고화질'],
    description: '대적자 스핀오프 공식 웹툰! 화려한 작화로 펼쳐지는 기사단의 모험.',
    coverImage: 'webtoon_1.svg',
    viewCount: 89000,
    status: 'ONGOING',
    isCompleted: false,
    isTopRecommended: false,
    isPopularWork: true,
    isNewWork: true
  },
  {
    id: 10,
    title: '[웹툰] 황후의 비밀 화원',
    author: '로즈코믹스',
    contentType: 'WEBTOON',
    genre: ['로맨스', '순정'],
    tags: ['웹툰', '궁중로맨스', '풀컬러'],
    description: '황실 최고의 비밀이 담긴 화원에서 피어나는 은밀하고 달콤한 로맨스 웹툰.',
    coverImage: 'webtoon_2.svg',
    viewCount: 124000,
    status: 'ONGOING',
    isCompleted: false,
    isTopRecommended: false,
    isPopularWork: true,
    isNewWork: true
  }
];

// Gemini API로 5개씩 배치 생성
async function generateBatchWithGemini(startId, count, genreTheme) {
  console.log(`🤖 Gemini API 호출: ID ${startId}~${startId + count - 1} (${genreTheme}) 생성 중...`);
  
  const prompt = `
한국 웹소설/웹툰 플랫폼용 작품 ${count}개 (ID ${startId}부터 ${startId + count - 1}까지, 테마: ${genreTheme})의 메타데이터를 JSON 배열로 생성해줘.
JSON 포맷:
[
  {
    "id": ${startId},
    "title": "한국어 제목 (웹툰인 경우 [웹툰] 접두사)",
    "author": "한국어 작가 필명",
    "contentType": "NOVEL" 또는 "WEBTOON",
    "genre": ["장르", "전체이용가" 또는 "19세 이상"],
    "tags": ["태그1", "태그2", "태그3"],
    "description": "매력적인 시놉시스 1~2문장",
    "coverImage": "novel_1.svg" (소설) 또는 "webtoon_1.svg" (웹툰),
    "viewCount": 50000 ~ 350000,
    "isCompleted": false,
    "isTopRecommended": true 또는 false,
    "isPopularWork": true 또는 false,
    "isNewWork": true 또는 false,
    "authorBirthdate": "1990-05-15",
    "authorAddress": "서울특별시 OO구 OO로 OO",
    "bankInfo": "국민은행 111-222-333444"
  }
]
반드시 유효한 JSON 배열만 출력해줘.
`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1500,
        response_format: { type: 'json_object' }
      })
    });

    const json = await res.json();
    let text = json.choices?.[0]?.message?.content;
    if (!text) throw new Error('Gemini 응답 비어있음');

    let parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      parsed = parsed.works || parsed.items || parsed.data || Object.values(parsed)[0];
    }

    if (Array.isArray(parsed) && parsed.length > 0) {
      console.log(`✅ Gemini ID ${startId}~${startId + count - 1} 생성 완료 (${parsed.length}건)`);
      return parsed;
    }
  } catch (e) {
    console.warn(`Gemini batch (${startId}) 실패, 기본 템플릿 사용:`, e.message);
  }

  // 폴백
  return getCuratedNewWorks().slice(startId - 11, startId - 11 + count);
}

// 20개 정예 데이터셋 (Gemini 배치 실패 시 완벽 보장)
function getCuratedNewWorks() {
  const list = [
    { id: 11, title: 'SSS급 헌터의 편의점', author: '밤샘작가', contentType: 'NOVEL', genre: ['현대 판타지', '전체이용가'], tags: ['헌터', '각성', '힐링'], description: '던전 앞 편의점에서 물건을 팔았을 뿐인데 세계 최강이 되었다.', coverImage: 'novel_1.svg', viewCount: 310000, isTopRecommended: true, isPopularWork: true, isNewWork: false },
    { id: 12, title: '화산파 막내 제자의 검', author: '청명검', contentType: 'NOVEL', genre: ['무협', '전체이용가'], tags: ['화산파', '검술', '환생'], description: '멸망한 화산을 재건하기 위해 300년 전으로 환생한 매화검객의 전설.', coverImage: 'novel_3.svg', viewCount: 285000, isTopRecommended: true, isPopularWork: true, isNewWork: false },
    { id: 13, title: '악녀는 조용히 살고 싶다', author: '로즈가든', contentType: 'NOVEL', genre: ['로맨스', '전체이용가'], tags: ['로판', '악녀빙의', '사이다'], description: '소설 속 악녀로 빙의했다. 파멸을 피하기 위해 조용히 살려는데 황태자가 집착한다.', coverImage: 'novel_2.svg', viewCount: 242000, isTopRecommended: false, isPopularWork: true, isNewWork: false },
    { id: 14, title: '네크로맨서로 살아남기', author: '영혼술사', contentType: 'NOVEL', genre: ['판타지', '전체이용가'], tags: ['네크로맨서', '언데드', '성장'], description: '죽은 자들을 이끌고 최악의 미궁을 탈출하는 어둠의 마도사 일대기.', coverImage: 'novel_1.svg', viewCount: 198000, isTopRecommended: false, isPopularWork: false, isNewWork: true },
    { id: 15, title: '달콤한 오피스 스캔들', author: '초코라떼', contentType: 'NOVEL', genre: ['성인', '19세 이상'], tags: ['오피스', '비밀연애', '사내로맨스'], description: '냉철한 대표님과 야근 중 벌어진 아찔하고 은밀한 하룻밤.', coverImage: 'novel_2.svg', viewCount: 175000, isTopRecommended: false, isPopularWork: true, isNewWork: false },
    { id: 16, title: '사이버펑크 2099: 네온 서울', author: '메카닉스', contentType: 'NOVEL', genre: ['SF', '전체이용가'], tags: ['사이버펑크', '해커', '디스토피아'], description: '인공지능과 거대 기업이 지배하는 2099년 서울, 한 해커의 마지막 저항.', coverImage: 'novel_4.svg', viewCount: 112000, isTopRecommended: false, isPopularWork: false, isNewWork: true },
    { id: 17, title: '퇴마록: 어둠의 사냥꾼', author: '퇴마사', contentType: 'NOVEL', genre: ['호러', '전체이용가'], tags: ['퇴마', '오컬트', '괴담'], description: '도심 속에 숨어든 악귀들을 사냥하는 퇴마 기사단의 처절한 사투.', coverImage: 'novel_4.svg', viewCount: 93000, isCompleted: true, isTopRecommended: false, isPopularWork: false, isNewWork: false },
    { id: 18, title: '아카데미 천재 마법사', author: '룬마스터', contentType: 'NOVEL', genre: ['판타지', '전체이용가'], tags: ['아카데미', '마법', '먼치킨'], description: '마법 명문 아카데미에 입학한 낙제생, 사실은 마법의 근원을 본 자였다.', coverImage: 'novel_1.svg', viewCount: 340000, isTopRecommended: true, isPopularWork: true, isNewWork: false },
    { id: 19, title: '재벌집 막내아들의 비밀투자', author: '머니파워', contentType: 'NOVEL', genre: ['현대 판타지', '전체이용가'], tags: ['재벌', '투자', '회귀'], description: '과거로 돌아간 흙수저, 미래의 지식으로 대한민국 1위 재벌이 되다.', coverImage: 'novel_3.svg', viewCount: 290000, isTopRecommended: false, isPopularWork: true, isNewWork: false },
    { id: 20, title: '망겜의 성기사가 되었다', author: '홀리나이트', contentType: 'NOVEL', genre: ['판타지', '전체이용가'], tags: ['게임빙의', '성기사', '사이다'], description: '서비스 종료 직전의 망겜 속 최고 난이도 성기사 캐릭터에 빙의했다.', coverImage: 'novel_1.svg', viewCount: 165000, isTopRecommended: false, isPopularWork: false, isNewWork: true },
    { id: 21, title: '[웹툰] 그림자 군주의 재림', author: '블랙툰', contentType: 'WEBTOON', genre: ['판타지', '액션'], tags: ['웹툰', '군주', '풀컬러'], description: '그림자를 지배하는 군주가 현대에 다시 깨어났다! 박진감 넘치는 액션 웹툰.', coverImage: 'webtoon_1.svg', viewCount: 210000, isTopRecommended: true, isPopularWork: true, isNewWork: false },
    { id: 22, title: '[웹툰] 공작가의 시한부 영애', author: '핑크베리', contentType: 'WEBTOON', genre: ['로맨스', '순정'], tags: ['웹툰', '시한부', '로판'], description: '시한부 판정을 받은 영애의 후회 없는 인생 역전과 눈부신 로맨스.', coverImage: 'webtoon_2.svg', viewCount: 184000, isTopRecommended: false, isPopularWork: true, isNewWork: false },
    { id: 23, title: '[웹툰] 던전 브레이크 헌터', author: '썬더스튜디오', contentType: 'WEBTOON', genre: ['현대 판타지', '액션'], tags: ['웹툰', '헌터', '던전'], description: '서울 한복판에 터진 SS급 던전 브레이크를 막아선 유일한 헌터의 이야기.', coverImage: 'webtoon_3.svg', viewCount: 156000, isTopRecommended: false, isPopularWork: false, isNewWork: true },
    { id: 24, title: '[웹툰] 마왕님은 카페 알바중', author: '코믹스쿨', contentType: 'WEBTOON', genre: ['일상', '개그'], tags: ['웹툰', '개그', '일상힐링'], description: '마계에서 쫓겨나 홍대 카페에서 라떼를 만드는 마왕님의 좌충우돌 일상.', coverImage: 'webtoon_4.svg', viewCount: 142000, isTopRecommended: false, isPopularWork: true, isNewWork: true },
    { id: 25, title: '[웹툰] 천하제일 마교교주', author: '무협코믹스', contentType: 'WEBTOON', genre: ['무협', '액션'], tags: ['웹툰', '마교', '절대자'], description: '무림을 전율케 한 마교 교주의 통쾌한 무협 액션 활극.', coverImage: 'webtoon_1.svg', viewCount: 195000, isTopRecommended: false, isPopularWork: true, isNewWork: false },
    { id: 26, title: '차원 이동자의 레벨업', author: '디멘션', contentType: 'NOVEL', genre: ['판타지', '전체이용가'], tags: ['차원이동', '상태창', '먼치킨'], description: '이세계로 소환되어 끝없는 한계를 돌파하는 레벨업 판타지 대서사시.', coverImage: 'novel_1.svg', viewCount: 178000, isTopRecommended: false, isPopularWork: false, isNewWork: false },
    { id: 27, title: '비선실세가 된 셰프', author: '고메마스터', contentType: 'NOVEL', genre: ['현대 판타지', '전체이용가'], tags: ['요리', '전문직', '회귀'], description: '환상의 맛으로 전 세계 VVIP들을 사로잡은 천재 요리사의 이야기.', coverImage: 'novel_3.svg', viewCount: 220000, isTopRecommended: false, isPopularWork: true, isNewWork: false },
    { id: 28, title: '버림받은 황녀의 복수극', author: '스칼렛', contentType: 'NOVEL', genre: ['로맨스', '전체이용가'], tags: ['궁중암투', '복수', '걸크러시'], description: '독주를 마시고 죽었던 황녀가 5년 전 과거로 회귀하여 제국을 뒤흔든다.', coverImage: 'novel_2.svg', viewCount: 135000, isCompleted: true, isTopRecommended: false, isPopularWork: false, isNewWork: false },
    { id: 29, title: '[웹툰] 드래곤 하트', author: '드래곤랩', contentType: 'WEBTOON', genre: ['판타지', '모험'], tags: ['웹툰', '드래곤', '모험'], description: '고대 드래곤의 심장을 품은 소년의 대륙 횡단 대모험.', coverImage: 'webtoon_3.svg', viewCount: 167000, isTopRecommended: false, isPopularWork: false, isNewWork: true },
    { id: 30, title: '심야 라디오 괴담', author: '미드나잇', contentType: 'NOVEL', genre: ['호러', '전체이용가'], tags: ['괴담', '라디오', '단편'], description: '자정이 되면 주파수를 맞추세요. 당신만을 위한 섬뜩한 사연이 흘러나옵니다.', coverImage: 'novel_4.svg', viewCount: 88000, isCompleted: true, isTopRecommended: false, isPopularWork: false, isNewWork: true }
  ];

  return list.map((w, idx) => ({
    ...w,
    status: w.isCompleted ? 'COMPLETED' : 'ONGOING',
    isCompleted: !!w.isCompleted,
    authorUsername: `writer${11 + idx}`,
    authorEmail: `writer${11 + idx}@webnovels.com`,
    authorBirthdate: `199${idx % 10}-0${(idx % 9) + 1}-15`,
    authorAddress: `서울특별시 강남구 테헤란로 ${100 + idx}`,
    bankInfo: `카카오뱅크 3333-0${idx}-123456`
  }));
}

// 3. 회차 생성기 (1~6화)
function generateEpisodesForWork(work) {
  const isWebtoon = work.contentType === 'WEBTOON';
  const episodes = [];

  for (let epNum = 1; epNum <= 6; epNum++) {
    const isFree = epNum <= 3;
    const isAdFree = epNum > 3;
    let content = '';
    let imageUrls = [];

    if (isWebtoon) {
      const cut1 = work.coverImage || 'webtoon_1.svg';
      const cut2 = epNum % 2 === 1 ? 'webtoon_2.svg' : 'webtoon_3.svg';
      imageUrls = [`/images/${cut1}`, `/images/${cut2}`];
    } else {
      if (isFree) {
        content = `본 회차는 ${epNum}회차 입니다.\n\n[${work.title} - 제 ${epNum} 화]\n${work.description}\n\n주인공은 운명의 기로에 서서 결의를 다졌다. 한 걸음 내딛는 순간 거대한 바람이 불며 새로운 모험의 서막이 열렸다.\n\n"더 이상 물러서지 않는다. 내가 가야 할 길은 오직 하나뿐이다."\n\n1~3화는 100% 무료로 즉시 열람하실 수 있습니다. 다음 회차도 기대해 주세요!`;
      } else {
        content = `본 회차는 ${epNum}회차 입니다.\n\n[${work.title} - 제 ${epNum} 화]\n💡 광고 시청 또는 포인트를 통해 성공적으로 해금된 ${epNum}회차 본문입니다.\n\n적들의 강력한 공세 속에서 주인공의 진정한 능력이 각성하기 시작했다. 눈앞을 가로막던 어둠이 걷히며 전설로 전해지던 비전의 힘이 폭발한다.\n\n"지금이다! 결판을 내자!"\n\n치열한 혈투 끝에 놀라운 진실이 밝혀지는데...`;
      }
    }

    episodes.push({
      work_id: work.id,
      episode_number: epNum,
      title: `제 ${epNum} 화${isWebtoon ? ': ' + (['서막', '각성', '동료', '결전', '비밀', '운명'][epNum - 1]) : ''}`,
      is_free: isFree,
      is_ad_free: isAdFree,
      content: content,
      image_urls: isWebtoon ? imageUrls : [],
      author_comment: epNum === 1 ? `${work.title} 연재를 시작합니다! 많은 관심 부탁드립니다.` : (epNum === 6 ? `6화까지 정주행해 주셔서 감사합니다! 다음 화도 준비 중입니다.` : `댓글과 추천은 작가에게 큰 힘이 됩니다.`)
    });
  }

  return episodes;
}

// 4. 메인 시딩 파이프라인
async function runSeeding() {
  console.log('🚀 [30 Dataset Seed] Supabase DB 실시간 연동 시딩을 시작합니다...');

  // Step 2-1: 11~30번 작품 데이터 생성 (Gemini API 4개 배치)
  const b1 = await generateBatchWithGemini(11, 5, '판타지 & 헌터 & 무협');
  const b2 = await generateBatchWithGemini(16, 5, 'SF & 호러 & 아카데미');
  const b3 = await generateBatchWithGemini(21, 5, '액션/로맨스/개그 웹툰');
  const b4 = await generateBatchWithGemini(26, 5, '차원이동/전문직/복수/호러');

  const newWorksRaw = [...b1, ...b2, ...b3, ...b4];
  const newWorks = newWorksRaw.map((w, idx) => {
    const fallbackItem = getCuratedNewWorks()[idx];
    const isWb = w.contentType === 'WEBTOON' || (w.title && w.title.includes('[웹툰]'));
    return {
      id: 11 + idx,
      title: w.title || fallbackItem.title,
      author: w.author || fallbackItem.author,
      contentType: isWb ? 'WEBTOON' : 'NOVEL',
      genre: Array.isArray(w.genre) ? w.genre : fallbackItem.genre,
      tags: Array.isArray(w.tags) ? w.tags : fallbackItem.tags,
      description: w.description || fallbackItem.description,
      coverImage: w.coverImage || (isWb ? `webtoon_${(idx % 4) + 1}.svg` : `novel_${(idx % 4) + 1}.svg`),
      viewCount: w.viewCount || fallbackItem.viewCount,
      status: w.isCompleted ? 'COMPLETED' : 'ONGOING',
      isCompleted: !!w.isCompleted,
      isTopRecommended: !!w.isTopRecommended,
      isPopularWork: !!w.isPopularWork,
      isNewWork: !!w.isNewWork,
      authorUsername: `writer${11 + idx}`,
      authorEmail: `writer${11 + idx}@webnovels.com`,
      authorBirthdate: w.authorBirthdate || `199${idx % 10}-0${(idx % 9) + 1}-15`,
      authorAddress: w.authorAddress || `서울특별시 강남구 테헤란로 ${100 + idx}`,
      bankInfo: w.bankInfo || `카카오뱅크 3333-0${idx}-123456`
    };
  });

  const all30Works = [...EXISTING_WORKS, ...newWorks];
  console.log(`📊 총 ${all30Works.length}개 작품 데이터 준비 완료 (소설: ${all30Works.filter(w => w.contentType === 'NOVEL').length}개, 웹툰: ${all30Works.filter(w => w.contentType === 'WEBTOON').length}개)`);

  // Step 2-2: works 테이블 Upsert
  console.log('📥 1. works 테이블 Upsert 진행 중...');
  for (const w of all30Works) {
    const { error } = await supabase.from('works').upsert({
      id: w.id,
      title: w.title,
      author: w.author,
      content_type: w.contentType,
      genre: Array.isArray(w.genre) ? w.genre : [w.genre, '전체이용가'],
      tags: Array.isArray(w.tags) ? w.tags : ['AI NONE'],
      description: w.description,
      cover_image: w.coverImage,
      view_count: w.viewCount,
      status: w.status,
      is_completed: w.isCompleted,
      is_top_recommended: w.isTopRecommended,
      is_popular_work: w.isPopularWork,
      is_new_work: w.isNewWork
    });
    if (error) console.error(`Work ID ${w.id} Upsert Error:`, error.message);
  }
  console.log('✅ works 테이블 30개 작품 반영 완료!');

  // Step 2-3: authors 테이블 Upsert (30명 작가)
  console.log('📥 2. authors 테이블 (30명 작가) Upsert 진행 중...');
  const authorsList = [
    { id: 1, username: 'writer1', pen_name: '판타지마스터', work_title: '대적자: 신을 삼킨 기사', birthdate: '1990-01-15', address: '서울특별시 강남구 테헤란로 123', bank_info: '국민은행 999-888-777666' },
    { id: 2, username: 'writer2', pen_name: '무협의신', work_title: '천마의 귀환', birthdate: '1985-05-20', address: '서울특별시 서초구 반포대로 45', bank_info: '신한은행 110-222-333444' },
    { id: 3, username: 'writer3', pen_name: '나이트로즈', work_title: '금기의 계약', birthdate: '1992-08-12', address: '경기도 성남시 분당구 판교로 78', bank_info: '우리은행 1002-555-666777' },
    { id: 4, username: 'writer4', pen_name: '로맨스퀸', work_title: '황제의 유일한 후궁', birthdate: '1994-11-03', address: '서울특별시 마포구 월드컵북로 99', bank_info: '하나은행 222-333-444555' },
    { id: 5, username: 'writer5', pen_name: '스페이스로그', work_title: '성간 항로: 마지막 항해사', birthdate: '1988-03-30', address: '대전광역시 유성구 대학로 100', bank_info: '농협 301-777-888999' },
    { id: 6, username: 'writer6', pen_name: '도시마법사', work_title: '서울에 나타난 마왕', birthdate: '1995-07-07', address: '서울특별시 송파구 올림픽로 200', bank_info: '카카오뱅크 3333-01-234567' },
    { id: 7, username: 'writer7', pen_name: '공포작가', work_title: '죽은 자들의 학교', birthdate: '1991-10-31', address: '부산광역시 해운대구 센텀서로 30', bank_info: '기업은행 010-9999-8888' },
    { id: 8, username: 'writer8', pen_name: '검성', work_title: '검의 전설: 천하제일인', birthdate: '1987-12-25', address: '대구광역시 수성구 달구벌대로 500', bank_info: '대구은행 508-12-345678' },
    { id: 9, username: 'writer9', pen_name: '스튜디오노바', work_title: '[웹툰] 신의 기사단', birthdate: '1993-04-10', address: '서울특별시 마포구 독막로 50', bank_info: '국민은행 111-222-333444' },
    { id: 10, username: 'writer10', pen_name: '로즈코믹스', work_title: '[웹툰] 황후의 비밀 화원', birthdate: '1996-09-18', address: '서울특별시 강남구 학동로 20', bank_info: '신한은행 333-444-555666' }
  ];

  for (let i = 11; i <= 30; i++) {
    const w = all30Works[i - 1];
    authorsList.push({
      id: i,
      username: `writer${i}`,
      pen_name: w.author,
      work_title: w.title,
      birthdate: w.authorBirthdate || `199${i % 10}-05-15`,
      address: w.authorAddress || `서울특별시 마포구 월드컵로 ${100 + i}`,
      bank_info: w.bankInfo || `카카오뱅크 3333-0${i}-123456`
    });
  }

  for (const a of authorsList) {
    const { error } = await supabase.from('authors').upsert({
      id: a.id,
      username: a.username,
      password_hash: '!12345',
      email: `${a.username}@webnovels.com`,
      pen_name: a.pen_name,
      work_title: a.work_title,
      birthdate: a.birthdate,
      address: a.address,
      bank_info: a.bank_info,
      status: '공식 인증 작가'
    });
    if (error) console.error(`Author ID ${a.id} Upsert Error:`, error.message);
  }
  console.log('✅ authors 테이블 30명 작가 반영 완료!');

  // Step 2-4: readers 테이블 Upsert (10명 독자)
  console.log('📥 3. readers 테이블 (10명 독자) Upsert 진행 중...');
  const readersList = [
    { id: 1, username: 'reader1', email: 'reader1@webnovels.com', phone: '+82-010-111-1111', is_adult_verified: false, subscription_status: '일반 회원', reading_history: [1, 2, 4], favorites: [1, 2, 4, 9, 11, 13], subscribed_authors: ['판타지마스터', '무협의신', '밤샘작가'] },
    { id: 2, username: 'reader2', email: 'reader2@webnovels.com', phone: '+82-010-111-1112', is_adult_verified: true, subscription_status: '프리미엄 구독중', reading_history: [3, 4, 6, 12], favorites: [3, 4, 6, 12, 15, 21], subscribed_authors: ['나이트로즈', '로맨스퀸', '청명검'] },
    { id: 3, username: 'reader3', email: 'reader3@webnovels.com', phone: '+82-010-111-1113', is_adult_verified: true, subscription_status: '프리미엄 구독중', reading_history: [2, 8, 10, 21], favorites: [2, 8, 10, 18, 21, 25], subscribed_authors: ['검성', '블랙툰', '스튜디오노바'] },
    { id: 4, username: 'reader4', email: 'reader4@webnovels.com', phone: '+82-010-111-1114', is_adult_verified: false, subscription_status: '일반 회원', reading_history: [9, 10, 21, 22], favorites: [9, 10, 21, 22, 23, 24], subscribed_authors: ['스튜디오노바', '로즈코믹스', '핑크베리'] },
    { id: 5, username: 'reader5', email: 'reader5@webnovels.com', phone: '+82-010-111-1115', is_adult_verified: true, subscription_status: 'VIP 회원', reading_history: [1, 3, 5, 11, 16], favorites: [1, 3, 5, 11, 16, 17, 30], subscribed_authors: ['스페이스로그', '퇴마사', '미드나잇'] },
    { id: 6, username: 'reader6', email: 'reader6@webnovels.com', phone: '+82-010-111-1116', is_adult_verified: true, subscription_status: '프리미엄 구독중', reading_history: [18, 19, 20], favorites: [18, 19, 20, 27], subscribed_authors: ['룬마스터', '머니파워', '고메마스터'] },
    { id: 7, username: 'reader7', email: 'reader7@webnovels.com', phone: '+82-010-111-1117', is_adult_verified: false, subscription_status: '일반 회원', reading_history: [7, 14, 26], favorites: [7, 14, 26, 29], subscribed_authors: ['공포작가', '영혼술사', '디멘션'] },
    { id: 8, username: 'reader8', email: 'reader8@webnovels.com', phone: '+82-010-111-1118', is_adult_verified: true, subscription_status: '일반 회원', reading_history: [13, 28], favorites: [4, 13, 28], subscribed_authors: ['로맨스퀸', '로즈가든', '스칼렛'] },
    { id: 9, username: 'reader9', email: 'reader9@webnovels.com', phone: '+82-010-111-1119', is_adult_verified: true, subscription_status: 'VIP 회원', reading_history: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], favorites: [1, 2, 3, 4, 9, 10, 11, 12, 21, 22], subscribed_authors: ['판타지마스터', '무협의신', '블랙툰'] },
    { id: 10, username: 'reader10', email: 'reader10@webnovels.com', phone: '+82-010-111-1120', is_adult_verified: true, subscription_status: '프리미엄 구독중', reading_history: [11, 12, 13, 14, 15], favorites: [11, 12, 13, 14, 15, 23, 24], subscribed_authors: ['밤샘작가', '청명검', '초코라떼'] }
  ];

  for (const r of readersList) {
    const { error } = await supabase.from('readers').upsert({
      id: r.id,
      username: r.username,
      password_hash: '!12345',
      email: r.email,
      phone: r.phone,
      is_adult_verified: r.is_adult_verified,
      subscription_status: r.subscription_status
    });
    if (error) console.error(`Reader ID ${r.id} Upsert Error:`, error.message);
  }
  console.log('✅ readers 테이블 10명 독자 반영 완료!');

  // Step 2-5: episodes 테이블 Upsert (30작품 * 6회차 = 180회차)
  console.log('📥 4. episodes 테이블 (총 180개 회차) Upsert 진행 중...');
  let totalEps = 0;
  for (const w of all30Works) {
    const eps = generateEpisodesForWork(w);
    for (const ep of eps) {
      const { error } = await supabase.from('episodes').upsert({
        work_id: ep.work_id,
        episode_number: ep.episode_number,
        title: ep.title,
        is_free: ep.is_free,
        is_ad_free: ep.is_ad_free,
        content: ep.content,
        image_urls: ep.image_urls,
        author_comment: ep.author_comment
      }, { onConflict: 'work_id,episode_number' });
      if (error) console.error(`Episode W${ep.work_id}-E${ep.episode_number} Error:`, error.message);
      else totalEps++;
    }
  }
  console.log(`✅ episodes 테이블 총 ${totalEps}개 회차 반영 완료!`);

  // Step 2-6: comments & comment_likes 시딩
  console.log('📥 5. comments (댓글) 및 좋아요 시딩 진행 중...');
  const sampleComments = [
    { user_id: 'reader1', nickname: '새벽독자', work_id: 1, content: '1화부터 몰입감 엄청나네요! 기사의 결의가 느껴집니다.', likes_count: 24 },
    { user_id: 'reader2', nickname: '판타지러버', work_id: 1, content: '광고 보고 4화까지 정주행 완료했습니다. 작화와 문체가 일품이에요!', likes_count: 18 },
    { user_id: 'reader3', nickname: '무협지존', work_id: 2, content: '천마의 귀환 역시 명작입니다. 다음 화가 너무 기대돼요.', likes_count: 32 },
    { user_id: 'reader5', nickname: '소설마니아', work_id: 4, content: '황제와 후궁의 감정선이 너무 섬세해서 가슴이 먹먹하네요.', likes_count: 15 },
    { user_id: 'reader4', nickname: '웹툰홀릭', work_id: 9, content: '웹툰 작화 퀄리티가 미쳤습니다! 풀컬러 연출 최고예요!', likes_count: 41 },
    { user_id: 'reader9', nickname: '정주행러', work_id: 11, content: '헌터 편의점 소재 진짜 신선하고 재밌습니다 ㅋㅋㅋ 번창하세요 작가님!', likes_count: 29 },
    { user_id: 'reader10', nickname: '매화검', work_id: 12, content: '화산파 매화검술 묘사가 살아 숨쉬네요. 강력 추천합니다.', likes_count: 27 },
    { user_id: 'reader6', nickname: '달콤한밤', work_id: 13, content: '악녀 언니 성격 너무 시원시원해요 사이다 원샷한 기분!', likes_count: 19 },
    { user_id: 'reader7', nickname: '오컬트광', work_id: 17, content: '밤에 불 끄고 보다가 소름 돋았습니다... 필력 대박!', likes_count: 12 },
    { user_id: 'reader8', nickname: '코믹천국', work_id: 24, content: '마왕님이 카페 라떼 아트 하는 거 보고 빵 터졌어요 ㅋㅋㅋ', likes_count: 35 }
  ];

  for (const c of sampleComments) {
    await supabase.from('comments').insert({
      user_id: c.user_id,
      nickname: c.nickname,
      work_id: c.work_id,
      content: c.content,
      likes_count: c.likes_count,
      is_blocked: false
    });
  }
  console.log('✅ comments 댓글 시딩 완료!');

  // Step 2-7: author_settlements (작가 정산 신청) 시딩
  console.log('📥 6. author_settlements (작가 정산 신청) 시딩 진행 중...');
  const settlements = [
    { author_name: '판타지마스터', amount: 3850000, status: 'PAID', bank_info: '국민은행 999-888-777666' },
    { author_name: '무협의신', amount: 5775000, status: 'PAID', bank_info: '신한은행 110-222-333444' },
    { author_name: '로맨스퀸', amount: 7800000, status: 'PAID', bank_info: '하나은행 222-333-444555' },
    { author_name: '도시마법사', amount: 6950000, status: 'CONFIRMED', bank_info: '카카오뱅크 3333-01-234567' },
    { author_name: '밤샘작가', amount: 7750000, status: 'PENDING', bank_info: '카카오뱅크 3333-01-123456' },
    { author_name: '청명검', amount: 7125000, status: 'PENDING', bank_info: '신한은행 110-333-555666' },
    { author_name: '스튜디오노바', amount: 2225000, status: 'PENDING', bank_info: '국민은행 111-222-333444' },
    { author_name: '블랙툰', amount: 5250000, status: 'PENDING', bank_info: '우리은행 1002-777-888999' }
  ];

  for (const s of settlements) {
    await supabase.from('author_settlements').insert({
      author_name: s.author_name,
      amount: s.amount,
      status: s.status,
      bank_info: s.bank_info,
      requested_at: new Date(Date.now() - Math.random() * 86400000 * 10).toISOString(),
      processed_at: s.status === 'PAID' ? new Date().toISOString() : null
    });
  }
  console.log('✅ author_settlements 정산 내역 반영 완료!');

  // Step 2-8: revenue_events (월별 광고 매출) 시딩
  console.log('📥 7. revenue_events (월별 매출) 시딩 진행 중...');
  const revenueEvents = [
    { period_month: '2026-05', gross_revenue: 19800000, ad_network_fee: 1980000, net_revenue: 17820000, writer_pool_ratio: 0.625, writer_pool: 11137500, platform_revenue: 6682500, is_closed: true },
    { period_month: '2026-06', gross_revenue: 22500000, ad_network_fee: 2250000, net_revenue: 20250000, writer_pool_ratio: 0.625, writer_pool: 12656250, platform_revenue: 7593750, is_closed: true },
    { period_month: '2026-07', gross_revenue: 26400000, ad_network_fee: 2640000, net_revenue: 23760000, writer_pool_ratio: 0.625, writer_pool: 14850000, platform_revenue: 8910000, is_closed: true },
    { period_month: '2026-08', gross_revenue: 31200000, ad_network_fee: 3120000, net_revenue: 28080000, writer_pool_ratio: 0.625, writer_pool: 17550000, platform_revenue: 10530000, is_closed: false }
  ];

  for (const rev of revenueEvents) {
    await supabase.from('revenue_events').upsert(rev, { onConflict: 'period_month' });
  }
  console.log('✅ revenue_events 월별 매출 데이터 반영 완료!');

  // Step 2-9: content_reviews (운영자 콘텐츠 심사) 시딩
  console.log('📥 8. content_reviews (콘텐츠 심사) 시딩 진행 중...');
  const reviews = [
    { work_id: 11, work_title: 'SSS급 헌터의 편의점', author_name: '밤샘작가', status: 'APPROVED', reviewer_name: '최고관리자', reviewed_at: new Date().toISOString() },
    { work_id: 12, work_title: '화산파 막내 제자의 검', author_name: '청명검', status: 'APPROVED', reviewer_name: '최고관리자', reviewed_at: new Date().toISOString() },
    { work_id: 15, work_title: '달콤한 오피스 스캔들', author_name: '초코라떼', status: 'APPROVED', reviewer_name: '최고관리자', reviewed_at: new Date().toISOString() },
    { work_id: 21, work_title: '[웹툰] 그림자 군주의 재림', author_name: '블랙툰', status: 'APPROVED', reviewer_name: '최고관리자', reviewed_at: new Date().toISOString() },
    { work_id: 24, work_title: '[웹툰] 마왕님은 카페 알바중', author_name: '코믹스쿨', status: 'PENDING', reviewer_name: null, reviewed_at: null },
    { work_id: 30, work_title: '심야 라디오 괴담', author_name: '미드나잇', status: 'PENDING', reviewer_name: null, reviewed_at: null }
  ];

  for (const cr of reviews) {
    await supabase.from('content_reviews').insert(cr);
  }
  console.log('✅ content_reviews 심사 내역 반영 완료!');

  // Step 2-10: reports (사용자 신고) 시딩
  console.log('📥 9. reports (사용자 신고) 시딩 진행 중...');
  const reports = [
    { reporter_id: 'reader3', target_type: 'COMMENT', target_id: 'c1', reason: '회차 핵심 결말 스포일러 포함', status: 'RESOLVED', resolved_action: '블라인드 처리' },
    { reporter_id: 'reader5', target_type: 'COMMENT', target_id: 'c2', reason: '욕설 및 비방성 문구 사용', status: 'RESOLVED', resolved_action: '경고 조치' },
    { reporter_id: 'reader2', target_type: 'WORK', target_id: '15', reason: '연령 등급 19세 이상 확인 요청', status: 'RESOLVED', resolved_action: '성인인증 필수 확인 완료' },
    { reporter_id: 'reader7', target_type: 'COMMENT', target_id: 'c3', reason: '타 플랫폼 홍보 스팸 링크', status: 'PENDING', resolved_action: null }
  ];

  for (const rep of reports) {
    await supabase.from('reports').insert(rep);
  }
  console.log('✅ reports 신고 데이터 반영 완료!');

  // Step 2-11: platform_stats (대시보드 KPI 갱신)
  console.log('📥 10. platform_stats (대시보드 KPI) 갱신 진행 중...');
  await supabase.from('platform_stats').upsert({
    id: 'current',
    total_users: 1480,
    total_authors: 30,
    total_works: 30,
    total_episodes: 180,
    total_ad_views: 142500,
    updated_at: new Date().toISOString()
  });
  console.log('✅ platform_stats 대시보드 KPI 갱신 완료!');

  // Step 2-12: 로컬 백엔드/프론트엔드용 JSON 백업 저장
  const staticDatasetPath = path.join(__dirname, '..', 'public', 'dataset_30_works.json');
  fs.writeFileSync(staticDatasetPath, JSON.stringify({
    works: all30Works,
    authors: authorsList,
    readers: readersList
  }, null, 2), 'utf-8');
  console.log(`📁 public/dataset_30_works.json 파일 저장 완료!`);

  console.log('\n🎉 [성공] 30개 작품/작가/독자/회차/댓글/정산/KPI 데이터셋 Supabase DB 실시간 반영 완료!');
}

runSeeding().catch(err => {
  console.error('시딩 중 오류 발생:', err);
  process.exit(1);
});
