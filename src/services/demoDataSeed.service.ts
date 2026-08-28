// ============================================================
// [Service] Demo Data Seed Service (데모 데이터 초기 시딩 서비스)
//
// [Purpose]
// - 개발 및 테스트 환경에서 10명의 독자, 30명의 작가, 30개의 대표 웹소설 및 웹툰 작품 및 회차(1~3화 무료, 4~6화 광고 언락 필수)를 DB에 초기 주입
// - 독서 이력, 보관함(관심등록), 작가 팬 구독 데이터 생성
// ============================================================

import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { db } from '../config/db.js';

interface SeedReader {
  id?: number;
  username: string;
  email?: string;
  phone?: string;
  is_adult_verified?: boolean;
  subscription_status?: string;
}

interface SeedAuthor {
  id?: number;
  username: string;
  pen_name?: string;
  work_title?: string;
  birthdate?: string;
  address?: string;
  bank_info?: string;
}

interface SeedWork {
  id?: number;
  title: string;
  author?: string;
  genre?: string | string[];
  tags?: string | string[];
  description?: string;
  coverImage?: string;
  viewCount?: number;
  contentType?: string;
  status?: string;
  isCompleted?: boolean;
  isTopRecommended?: boolean;
  isPopularWork?: boolean;
  isNewWork?: boolean;
}

interface SeedDataset {
  works: SeedWork[];
  authors: SeedAuthor[];
  readers: SeedReader[];
}

function splitBankInfo(bankInfo: string) {
  const [bankName, ...accountParts] = bankInfo.split(' ');
  return { bankName: bankName || '국민은행', accountNumber: accountParts.join(' ') || '111-222-333444' };
}

export class DemoDataSeedService {
  // ============================================================
  // [Function] seed
  // [Purpose] 전체 30개 데모 데이터(독자, 작가, 작품, 회차, 정산계좌) DB upsert 실행
  // ============================================================
  static async seed() {
    let dataset: SeedDataset = { works: [], authors: [], readers: [] };
    try {
      const jsonPath = path.join(process.cwd(), 'public', 'dataset_30_works.json');
      if (fs.existsSync(jsonPath)) {
        dataset = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      }
    } catch (e) {
      console.warn('[DemoDataSeed] JSON 데이터셋 읽기 실패, 기본 데이터 사용');
    }

    const readers: SeedReader[] = dataset.readers && dataset.readers.length > 0 ? dataset.readers : [
      { id: 1, username: 'reader1', email: 'reader1@webnovels.com', phone: '+82-010-111-1111', is_adult_verified: false, subscription_status: '일반 회원' },
      { id: 2, username: 'reader2', email: 'reader2@webnovels.com', phone: '+82-010-111-1112', is_adult_verified: true, subscription_status: '프리미엄 구독중' },
      { id: 3, username: 'reader3', email: 'reader3@webnovels.com', phone: '+82-010-111-1113', is_adult_verified: true, subscription_status: '프리미엄 구독중' }
    ];

    const authors: SeedAuthor[] = dataset.authors && dataset.authors.length > 0 ? dataset.authors : [
      { id: 1, username: 'writer1', pen_name: '판타지마스터', work_title: '대적자: 신을 삼킨 기사', birthdate: '1990-01-15', address: '서울특별시 강남구 테헤란로 123', bank_info: '국민은행 999-888-777666' }
    ];

    const works: SeedWork[] = dataset.works && dataset.works.length > 0 ? dataset.works : [];

    const passwordHashes = new Map<string, string>();
    for (const password of ['!12345', '!123456']) {
      passwordHashes.set(password, await bcrypt.hash(password, 10));
    }

    const seededReaders = [];
    for (const reader of readers) {
      const user = await db.user.upsert({
        where: { username: reader.username },
        update: {
          email: reader.email || `${reader.username}@webnovels.com`,
          passwordHash: passwordHashes.get('!12345')!,
          nickname: reader.username,
          phone: reader.phone || '+82-010-0000-0000',
          role: 'READER',
          isAdultVerified: !!reader.is_adult_verified,
          profile: {
            upsert: {
              create: { subscriptionStatus: reader.subscription_status || '일반 회원' },
              update: { subscriptionStatus: reader.subscription_status || '일반 회원' }
            }
          }
        },
        create: {
          email: reader.email || `${reader.username}@webnovels.com`,
          username: reader.username,
          passwordHash: passwordHashes.get('!12345')!,
          nickname: reader.username,
          phone: reader.phone || '+82-010-0000-0000',
          role: 'READER',
          isAdultVerified: !!reader.is_adult_verified,
          profile: { create: { subscriptionStatus: reader.subscription_status || '일반 회원' } }
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
          email: `${authorSeed.username}@webnovels.com`,
          passwordHash: passwordHashes.get('!12345')!,
          nickname: authorSeed.pen_name || authorSeed.username,
          role: 'AUTHOR',
          isAdultVerified: true,
          profile: {
            upsert: {
              create: { birthDate: authorSeed.birthdate, address: authorSeed.address, subscriptionStatus: '공식 인증 작가' },
              update: { birthDate: authorSeed.birthdate, address: authorSeed.address, subscriptionStatus: '공식 인증 작가' }
            }
          }
        },
        create: {
          email: `${authorSeed.username}@webnovels.com`,
          username: authorSeed.username,
          passwordHash: passwordHashes.get('!12345')!,
          nickname: authorSeed.pen_name || authorSeed.username,
          role: 'AUTHOR',
          isAdultVerified: true,
          profile: { create: { birthDate: authorSeed.birthdate, address: authorSeed.address, subscriptionStatus: '공식 인증 작가' } }
        }
      });

      const author = await db.author.upsert({
        where: { userId: user.id },
        update: { penName: authorSeed.pen_name || `작가${index + 1}`, copyrightAgreed: true },
        create: { userId: user.id, penName: authorSeed.pen_name || `작가${index + 1}`, copyrightAgreed: true }
      });
      seededAuthors.push(author);

      const bank = splitBankInfo(authorSeed.bank_info || '국민은행 111-222-333444');
      await db.authorAccount.upsert({
        where: { authorId: author.id },
        update: { ...bank, accountHolder: author.penName },
        create: { authorId: author.id, ...bank, accountHolder: author.penName }
      });

      const matchedWork = works.find((w: SeedWork) => w.id === authorSeed.id) || works[index];
      if (matchedWork) {
        const isWebtoon = matchedWork.contentType === 'WEBTOON';
        const coverImg = matchedWork.coverImage 
          ? (matchedWork.coverImage.startsWith('/') ? matchedWork.coverImage : `/images/${matchedWork.coverImage}`)
          : '/images/stormqueen_oath.jpg';

        const workData = {
          authorId: author.id,
          title: matchedWork.title,
          coverImageUrl: coverImg,
          description: matchedWork.description || `${matchedWork.title} - 1~3화 무료 & 4~6화 광고 보고 무료 열람!`,
          genre: Array.isArray(matchedWork.genre) ? matchedWork.genre[0] : (matchedWork.genre || '판타지'),
          tags: Array.isArray(matchedWork.tags) ? matchedWork.tags.join(',') : (matchedWork.tags || 'AI NONE'),
          rating: Array.isArray(matchedWork.genre) && matchedWork.genre.includes('19세 이상') ? 'AGE_19' : 'ALL',
          aiUsageType: 'NONE',
          status: matchedWork.status || 'ONGOING',
          publishDays: 'MON,WED,FRI',
          viewCount: matchedWork.viewCount || 100000,
          contentType: matchedWork.contentType || 'NOVEL',
          isCompleted: !!matchedWork.isCompleted,
          isTopRecommended: !!matchedWork.isTopRecommended,
          isPopularWork: !!matchedWork.isPopularWork,
          isNewWork: !!matchedWork.isNewWork
        };

        let work = await db.work.findFirst({ where: { title: matchedWork.title, authorId: author.id } });
        work = work
          ? await db.work.update({ where: { id: work.id }, data: workData })
          : await db.work.create({ data: { ...workData, statistics: { create: { totalReads: matchedWork.viewCount || 100000, subscriberCount: 150 + index * 20 } } } });

        await db.workStatistics.upsert({
          where: { workId: work.id },
          update: { totalReads: matchedWork.viewCount || 100000, subscriberCount: 150 + index * 20 },
          create: { workId: work.id, totalReads: matchedWork.viewCount || 100000, subscriberCount: 150 + index * 20 }
        });

        for (let episodeNumber = 1; episodeNumber <= 6; episodeNumber++) {
          const existingEpisode = await db.episode.findFirst({ where: { workId: work.id, episodeNumber } });
          const webtoonCuts = isWebtoon
            ? [`/images/${matchedWork.coverImage || 'webtoon_1.svg'}`, `/images/webtoon_${(episodeNumber % 4) + 1}.svg`]
            : [];
          const episodeData = {
            workId: work.id,
            episodeNumber,
            title: `제${episodeNumber}화`,
            content: isWebtoon ? '' : `[${matchedWork.title} - 제 ${episodeNumber} 화]\n주인공의 운명적인 모험이 시작됩니다. ${episodeNumber <= 3 ? '1~3화 무료' : '광고 시청 후 해금 완료'}!`,
            imageUrls: isWebtoon ? JSON.stringify(webtoonCuts) : null,
            isFree: episodeNumber <= 3,
            adUnlockRequired: episodeNumber > 3,
            isPublished: true
          };
          const episode = existingEpisode
            ? await db.episode.update({ where: { id: existingEpisode.id }, data: episodeData })
            : await db.episode.create({ data: { ...episodeData, statistics: { create: { readCount: Math.floor((matchedWork.viewCount || 100000) / 10) } } } });

          await db.episodeStatistics.upsert({
            where: { episodeId: episode.id },
            update: { readCount: Math.floor((matchedWork.viewCount || 100000) / 10) },
            create: { episodeId: episode.id, readCount: Math.floor((matchedWork.viewCount || 100000) / 10) }
          });
        }

        seededWorks.push(work);
      }
    }

    await this.seedLibraryData(seededReaders, seededWorks, seededAuthors);
    console.log(`✅ [DemoDataSeed] 독자 ${seededReaders.length}명, 작가 ${seededAuthors.length}명, 작품 ${seededWorks.length}개 Prisma DB 시드 완료`);
  }

  // ============================================================
  // [Function] seedLibraryData
  // [Purpose] 독자별 독서 이력(UserReadingHistory), 보관함(WorkFavorite), 구독(AuthorSubscription) 시딩
  // ============================================================
  private static async seedLibraryData(readersData: Array<{ id: string }>, worksData: Array<{ id: string; authorId: string }>, authorsData: Array<{ id: string }>) {
    if (worksData.length === 0 || readersData.length === 0) return;

    for (const [readerIndex, reader] of readersData.entries()) {
      const favCount = Math.min(6, worksData.length);
      for (let i = 0; i < favCount; i++) {
        const workIndex = (readerIndex * 3 + i) % worksData.length;
        const work = worksData[workIndex];
        if (!work) continue;

        await db.workFavorite.upsert({
          where: { userId_workId: { userId: reader.id, workId: work.id } },
          update: {},
          create: { userId: reader.id, workId: work.id }
        });
      }

      const subCount = Math.min(3, authorsData.length);
      for (let i = 0; i < subCount; i++) {
        const authorIndex = (readerIndex * 2 + i) % authorsData.length;
        const author = authorsData[authorIndex];
        if (!author) continue;

        await db.authorSubscription.upsert({
          where: { userId_authorId: { userId: reader.id, authorId: author.id } },
          update: {},
          create: { userId: reader.id, authorId: author.id }
        });
      }
    }
  }
}
