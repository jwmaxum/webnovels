// ============================================================
// [Service] Demo Data Seed Service (데모 데이터 초기 시딩 서비스)
//
// [Purpose]
// - 개발 및 테스트 환경에서 즉시 동작 가능한 3명의 독자, 8명의 작가, 8개의 대표 웹소설 작품 및 각 4개 회차(1~3화 무료, 4화 광고 언락 필수)를 DB에 초기 주입
// - 독서 이력, 보관함(관심등록), 작가 팬 구독 데이터 생성
// ============================================================

import bcrypt from 'bcrypt';
import { db } from '../config/db.js';

// 기본 테스트 독자 계정 (reader1, reader2, reader3)
const readers = [
  { username: 'reader1', password: '!12345', email: 'reader1@webnovels.com', phone: '+82-010-111-1111', isAdultVerified: false, subscriptionStatus: '일반 회원' },
  { username: 'reader2', password: '!12345', email: 'reader2@webnovels.com', phone: '+82-010-111-1112', isAdultVerified: true, subscriptionStatus: '프리미엄 구독중' },
  { username: 'reader3', password: '!12345', email: 'reader3@webnovels.com', phone: '+82-010-111-1113', isAdultVerified: true, subscriptionStatus: '프리미엄 구독중' }
];

// 기본 테스트 작가 계정 및 대표 작품 정보 (판타지, 무협, 성인AGE_18, 로맨스, SF, 현대판타지, 호러 등)
const authors = [
  { username: 'writer1', password: '!123456', email: 'writer1@webnovels.com', penName: '판타지마스터', workTitle: '대적자: 신을 삼킨 기사', birthDate: '1990-01-15', address: '서울특별시 강남구 테헤란로 123', bankInfo: '국민은행 999-888-777666', coverImageUrl: '/images/stormqueen_oath.jpg', genre: '판타지', viewCount: 154000 },
  { username: 'writer2', password: '!123456', email: 'writer2@webnovels.com', penName: '무협의신', workTitle: '천마의 귀환', birthDate: '1985-05-20', address: '서울특별시 서초구 반포대로 45', bankInfo: '신한은행 110-222-333444', coverImageUrl: '/images/sword_dao_supreme.jpg', genre: '무협', viewCount: 231000 },
  { username: 'writer3', password: '!123456', email: 'writer3@webnovels.com', penName: '나이트로즈', workTitle: '금기의 계약', birthDate: '1992-08-12', address: '경기도 성남시 분당구 판교로 78', bankInfo: '우리은행 1002-555-666777', coverImageUrl: '/images/velvet_and_thorns.jpg', genre: '성인', rating: 'AGE_18', viewCount: 189000 },
  { username: 'writer4', password: '!123456', email: 'writer4@webnovels.com', penName: '로맨스퀸', workTitle: '황제의 유일한 후궁', birthDate: '1994-11-03', address: '서울특별시 마포구 월드컵북로 99', bankInfo: '하나은행 222-333-444555', coverImageUrl: '/images/flower_blooming.jpg', genre: '로맨스', viewCount: 312000 },
  { username: 'writer5', password: '!123456', email: 'writer5@webnovels.com', penName: '스페이스로그', workTitle: '성간 항로: 마지막 항해사', birthDate: '1988-03-30', address: '대전광역시 유성구 대학로 100', bankInfo: '농협 301-777-888999', coverImageUrl: '/images/stellar_horizon.jpg', genre: 'SF', viewCount: 97000 },
  { username: 'writer6', password: '!123456', email: 'writer6@webnovels.com', penName: '도시마법사', workTitle: '서울에 나타난 마왕', birthDate: '1995-07-07', address: '서울특별시 송파구 올림픽로 200', bankInfo: '카카오뱅크 3333-01-234567', coverImageUrl: '/images/seoul_sorcerer.jpg', genre: '현대 판타지', viewCount: 278000 },
  { username: 'writer7', password: '!123456', email: 'writer7@webnovels.com', penName: '공포작가', workTitle: '죽은 자들의 학교', birthDate: '1991-10-31', address: '부산광역시 해운대구 센텀서로 30', bankInfo: '기업은행 010-9999-8888', coverImageUrl: '/images/darkness_swallowed_classroom.jpg', genre: '호러', viewCount: 84000 },
  { username: 'writer8', password: '!123456', email: 'writer8@webnovels.com', penName: '검성', workTitle: '검의 전설: 천하제일인', birthDate: '1987-12-25', address: '대구광역시 수성구 달구벌대로 500', bankInfo: '대구은행 508-12-345678', coverImageUrl: '/images/sword_dao_defies_heavens.jpg', genre: '무협', viewCount: 195000 }
];

// 회차별 본문 샘플 데이터
const episodeContent = [
  ['신의 저주로 멸망한 왕국에서 한 기사가 깨어나 처음으로 자신의 힘을 깨닫는다.', '기사는 폐허가 된 성에서 고대의 검을 발견하고 신의 잔당과 첫 전투를 벌인다.', '동료를 잃은 기사는 복수를 다짐하며 신의 사도가 숨은 탑으로 향한다.', '탑 정상에서 마주한 신은 기사에게 충격적인 진실을 알려준다.'],
  ['천마는 수백 년의 봉인에서 깨어나 자신이 누구인지 기억해 내기 시작한다.', '옛 제자들의 후손을 만난 천마는 무림의 변화를 확인하고 첫 번째 적을 쓰러뜨린다.', '천마는 잃어버린 검법을 되찾기 위해 금지된 동굴로 들어간다.', '동굴 안에서 천마는 자신을 봉인한 자의 후예와 운명적인 대면을 한다.'],
  ['여주인공은 빚을 갚기 위해 정체불명의 남자와 위험한 계약을 맺는다.', '계약의 첫 번째 조건이 실행되고, 두 사람 사이에 묘한 긴장감이 흐른다.', '남자의 정체가 조금씩 드러나며 여주인공은 빠져나올 수 없는 감정에 휩싸인다.', '계약의 진짜 목적이 밝혀지고, 두 사람의 관계는 돌이킬 수 없는 방향으로 흐른다.'],
  ['평범한 처녀가 황제의 간택을 받아 궁에 들어가며 새로운 삶을 시작한다.', '황제와의 첫 대면에서 그녀는 그의 차가운 눈빛 속에 숨겨진 외로움을 느낀다.', '후궁들의 시기 속에서 그녀는 황제의 유일한 관심을 받게 된다.', '황제가 그녀에게만 보여 주는 부드러운 모습에 마음이 흔들리기 시작한다.'],
  ['마지막 항해사는 지구가 멸망한 후 남은 인류를 태우고 미지의 별로 출발한다.', '항해 중 발견한 고대 외계 유물에서 충격적인 메시지가 해독된다.', '함선에 침입한 미지의 존재가 승무원들을 하나씩 사라지게 만든다.', '항해사는 함선의 AI와 함께 적의 정체를 밝혀내고 생존을 위한 결단을 내린다.'],
  ['평범한 회사원 김현우는 퇴근길에 마왕의 힘이 자신에게 깃드는 것을 느낀다.', '처음으로 마법을 사용한 현우는 우연히 마족을 쓰러뜨리고 자신의 정체를 숨기려 한다.', '마법사 협회가 그를 추적하기 시작하고, 현우는 도망치며 힘을 다스리는 법을 배운다.', '현우는 자신을 노리는 진짜 적이 마족이 아닌 인간이라는 사실을 알게 된다.'],
  ['폐교 탐사를 온 학생들은 이상한 발소리와 함께 문이 저절로 닫히는 것을 경험한다.', '한 명이 사라지고, 남은 학생들은 복도 끝에서 교복을 입은 그림자를 목격한다.', '학교 지하실에서 발견된 일기장은 과거에 일어난 참극을 상세히 기록하고 있다.', '일기장의 주인공이 눈앞에 나타나며, 학생들은 자신들이 이미 죽은 존재일지도 모른다는 공포에 휩싸인다.'],
  ['하급 무사 이천은 우연히 전설의 검을 손에 넣고 자신의 운명이 바뀌는 것을 느낀다.', '검을 노리는 암살자들을 물리친 이천은 검에 깃든 고대 검성의 기억을 일부 받아들인다.', '이천은 무림맹의 초대를 받아 처음으로 강호에 자신의 이름을 알리기 시작한다.', '천하제일인 자리에서 마주한 강자는 이천에게 검의 진짜 주인에 대한 비밀을 암시한다.']
];

function splitBankInfo(bankInfo: string) {
  const [bankName, ...accountParts] = bankInfo.split(' ');
  return { bankName, accountNumber: accountParts.join(' ') };
}

export class DemoDataSeedService {
  // ============================================================
  // [Function] seed
  // [Purpose] 전체 데모 데이터(독자, 작가, 작품, 회차, 정산계좌) DB upsert 실행
  // ============================================================
  static async seed() {
    const passwordHashes = new Map<string, string>();
    for (const password of ['!12345', '!123456']) {
      passwordHashes.set(password, await bcrypt.hash(password, 10));
    }

    const seededReaders = [];
    for (const reader of readers) {
      const user = await db.user.upsert({
        where: { username: reader.username },
        update: {
          email: reader.email,
          passwordHash: passwordHashes.get(reader.password)!,
          nickname: reader.username,
          phone: reader.phone,
          role: 'READER',
          isAdultVerified: reader.isAdultVerified,
          profile: {
            upsert: {
              create: { subscriptionStatus: reader.subscriptionStatus },
              update: { subscriptionStatus: reader.subscriptionStatus }
            }
          }
        },
        create: {
          email: reader.email,
          username: reader.username,
          passwordHash: passwordHashes.get(reader.password)!,
          nickname: reader.username,
          phone: reader.phone,
          role: 'READER',
          isAdultVerified: reader.isAdultVerified,
          profile: { create: { subscriptionStatus: reader.subscriptionStatus } }
        }
      });
      seededReaders.push(user);
    }

    const seededWorks = [];
    const seededAuthors = [];
    for (const [index, authorSeed] of authors.entries()) {
      const user = await db.user.upsert({
        where: { username: authorSeed.username },
        update: {
          email: authorSeed.email,
          passwordHash: passwordHashes.get(authorSeed.password)!,
          nickname: authorSeed.penName,
          role: 'AUTHOR',
          isAdultVerified: true,
          profile: {
            upsert: {
              create: { birthDate: authorSeed.birthDate, address: authorSeed.address, subscriptionStatus: '작가 회원' },
              update: { birthDate: authorSeed.birthDate, address: authorSeed.address, subscriptionStatus: '작가 회원' }
            }
          }
        },
        create: {
          email: authorSeed.email,
          username: authorSeed.username,
          passwordHash: passwordHashes.get(authorSeed.password)!,
          nickname: authorSeed.penName,
          role: 'AUTHOR',
          isAdultVerified: true,
          profile: { create: { birthDate: authorSeed.birthDate, address: authorSeed.address, subscriptionStatus: '작가 회원' } }
        }
      });

      const author = await db.author.upsert({
        where: { userId: user.id },
        update: { penName: authorSeed.penName, copyrightAgreed: true },
        create: { userId: user.id, penName: authorSeed.penName, copyrightAgreed: true }
      });
      seededAuthors.push(author);

      const bank = splitBankInfo(authorSeed.bankInfo);
      await db.authorAccount.upsert({
        where: { authorId: author.id },
        update: { ...bank, accountHolder: authorSeed.penName },
        create: { authorId: author.id, ...bank, accountHolder: authorSeed.penName }
      });

      let work = await db.work.findFirst({ where: { title: authorSeed.workTitle, authorId: author.id } });
      const workData = {
        authorId: author.id,
        title: authorSeed.workTitle,
        coverImageUrl: authorSeed.coverImageUrl,
        description: `${authorSeed.workTitle} - 1~3화 즉시 무료 & 4화부터 광고 보고 무료 열람!`,
        genre: authorSeed.genre,
        tags: 'AI NONE',
        rating: authorSeed.rating || 'ALL',
        aiUsageType: 'NONE',
        status: 'ONGOING',
        publishDays: 'MON,WED,FRI',
        viewCount: authorSeed.viewCount
      };
      work = work
        ? await db.work.update({ where: { id: work.id }, data: workData })
        : await db.work.create({ data: { ...workData, statistics: { create: { totalReads: authorSeed.viewCount, subscriberCount: 100 + index * 15 } } } });

      await db.workStatistics.upsert({
        where: { workId: work.id },
        update: { totalReads: authorSeed.viewCount, subscriberCount: 100 + index * 15 },
        create: { workId: work.id, totalReads: authorSeed.viewCount, subscriberCount: 100 + index * 15 }
      });

      for (let episodeNumber = 1; episodeNumber <= 4; episodeNumber++) {
        const existingEpisode = await db.episode.findFirst({ where: { workId: work.id, episodeNumber } });
        const episodeData = {
          workId: work.id,
          episodeNumber,
          title: `제${episodeNumber}화`,
          content: episodeContent[index][episodeNumber - 1],
          isFree: episodeNumber <= 3,
          adUnlockRequired: episodeNumber > 3,
          isPublished: true
        };
        const episode = existingEpisode
          ? await db.episode.update({ where: { id: existingEpisode.id }, data: episodeData })
          : await db.episode.create({ data: { ...episodeData, statistics: { create: { readCount: Math.floor(authorSeed.viewCount / 10) } } } });

        await db.episodeStatistics.upsert({
          where: { episodeId: episode.id },
          update: { readCount: Math.floor(authorSeed.viewCount / 10) },
          create: { episodeId: episode.id, readCount: Math.floor(authorSeed.viewCount / 10) }
        });
      }

      seededWorks.push(work);
    }

    await this.seedLibraryData(seededReaders, seededWorks, seededAuthors);
    console.log(`✅ [DemoDataSeed] 독자 ${seededReaders.length}명, 작가 ${seededAuthors.length}명, 작품 ${seededWorks.length}개 DB 시드 완료`);
  }

  // ============================================================
  // [Function] seedLibraryData
  // [Purpose] 독자별 독서 이력(UserReadingHistory), 보관함(WorkFavorite), 구독(AuthorSubscription) 시딩
  // ============================================================
  private static async seedLibraryData(readersData: Array<{ id: string }>, worksData: Array<{ id: string; authorId: string }>, authorsData: Array<{ id: string }>) {
    const readerPlans = [
      { reading: [0, 1, 3], favorites: [0, 1, 3, 5, 7], subscriptions: [0, 1] },
      { reading: [2, 3, 5], favorites: [2, 3, 5, 6], subscriptions: [2, 3, 5] },
      { reading: [1, 4, 7], favorites: [1, 4, 7], subscriptions: [1, 4, 7] }
    ];

    for (const [readerIndex, reader] of readersData.entries()) {
      const plan = readerPlans[readerIndex];
      for (const [historyIndex, workIndex] of plan.reading.entries()) {
        const work = worksData[workIndex];
        const episode = await db.episode.findFirst({ where: { workId: work.id, episodeNumber: historyIndex + 1 } });
        if (!episode) continue;

        const existing = await db.userReadingHistory.findFirst({ where: { userId: reader.id, workId: work.id, episodeId: episode.id } });
        if (!existing) {
          await db.userReadingHistory.create({
            data: {
              userId: reader.id,
              workId: work.id,
              episodeId: episode.id,
              readTimeSeconds: 420 + historyIndex * 180
            }
          });
        }
      }

      for (const workIndex of plan.favorites) {
        await db.workFavorite.upsert({
          where: { userId_workId: { userId: reader.id, workId: worksData[workIndex].id } },
          update: {},
          create: { userId: reader.id, workId: worksData[workIndex].id }
        });
      }

      for (const authorIndex of plan.subscriptions) {
        await db.authorSubscription.upsert({
          where: { userId_authorId: { userId: reader.id, authorId: authorsData[authorIndex].id } },
          update: {},
          create: { userId: reader.id, authorId: authorsData[authorIndex].id }
        });
      }
    }
  }
}

