import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const SAMPLE_READERS = [
  { id: 1, username: 'reader1', password_raw: '!12345', email: 'reader1@webnovels.com', phone: '+82-010-111-1111', is_adult_verified: false, subscription_status: '일반 회원' },
  { id: 2, username: 'reader2', password_raw: '!12345', email: 'reader2@webnovels.com', phone: '+82-010-111-1112', is_adult_verified: true, subscription_status: '프리미엄 구독중' },
  { id: 3, username: 'reader3', password_raw: '!12345', email: 'reader3@webnovels.com', phone: '+82-010-111-1113', is_adult_verified: true, subscription_status: '프리미엄 구독중' }
];

const SAMPLE_AUTHORS = [
  { id: 1, username: 'writer1', password_raw: '!123456', email: 'writer1@webnovels.com', pen_name: '판타지마스터', work_title: '대적자: 신을 삼킨 기사', birthdate: '1990-01-15', address: '서울특별시 강남구 테헤란로 123', bank_info: '국민은행 999-888-777666', status: '공식 인증 작가' },
  { id: 2, username: 'writer2', password_raw: '!123456', email: 'writer2@webnovels.com', pen_name: '무협의신', work_title: '천마의 귀환', birthdate: '1985-05-20', address: '서울특별시 서초구 반포대로 45', bank_info: '신한은행 110-222-333444', status: '공식 인증 작가' },
  { id: 3, username: 'writer3', password_raw: '!123456', email: 'writer3@webnovels.com', pen_name: '나이트로즈', work_title: '금기의 계약', birthdate: '1992-08-12', address: '경기도 성남시 분당구 판교로 78', bank_info: '우리은행 1002-555-666777', status: '공식 인증 작가' },
  { id: 4, username: 'writer4', password_raw: '!123456', email: 'writer4@webnovels.com', pen_name: '로맨스퀸', work_title: '황제의 유일한 후궁', birthdate: '1994-11-03', address: '서울특별시 마포구 월드컵북로 99', bank_info: '하나은행 222-333-444555', status: '공식 인증 작가' },
  { id: 5, username: 'writer5', password_raw: '!123456', email: 'writer5@webnovels.com', pen_name: '스페이스로그', work_title: '성간 항로: 마지막 항해사', birthdate: '1988-03-30', address: '대전광역시 유성구 대학로 100', bank_info: '농협 301-777-888999', status: '공식 인증 작가' },
  { id: 6, username: 'writer6', password_raw: '!123456', email: 'writer6@webnovels.com', pen_name: '도시마법사', work_title: '서울에 나타난 마왕', birthdate: '1995-07-07', address: '서울특별시 송파구 올림픽로 200', bank_info: '카카오뱅크 3333-01-234567', status: '공식 인증 작가' },
  { id: 7, username: 'writer7', password_raw: '!123456', email: 'writer7@webnovels.com', pen_name: '공포작가', work_title: '죽은 자들의 학교', birthdate: '1991-10-31', address: '부산광역시 해운대구 센텀서로 30', bank_info: '기업은행 010-9999-8888', status: '공식 인증 작가' },
  { id: 8, username: 'writer8', password_raw: '!123456', email: 'writer8@webnovels.com', pen_name: '검성', work_title: '검의 전설: 천하제일인', birthdate: '1987-12-25', address: '대구광역시 수성구 달구벌대로 500', bank_info: '대구은행 508-12-345678', status: '공식 인증 작가' }
];

async function main() {
  console.log('🌱 더미 독자/작가 회원 시딩 시작...');

  // 1. 독자 회원 생성
  for (const r of SAMPLE_READERS) {
    const existing = await prisma.user.findUnique({ where: { username: r.username } });
    if (!existing) {
      const passwordHash = await bcrypt.hash(r.password_raw, 10);
      await prisma.user.create({
        data: {
          email: r.email,
          username: r.username,
          passwordHash,
          nickname: r.username === 'reader1' ? '열혈독자' : r.username,
          phone: r.phone,
          isAdultVerified: r.is_adult_verified,
          role: 'READER',
          profile: {
            create: {
              subscriptionStatus: r.subscription_status
            }
          }
        }
      });
      console.log(`✅ 독자 가입 완료: ${r.username}`);
    }
  }

  // 2. 작가 회원 생성
  for (const a of SAMPLE_AUTHORS) {
    const existing = await prisma.user.findUnique({ where: { username: a.username } });
    if (!existing) {
      const passwordHash = await bcrypt.hash(a.password_raw, 10);
      const user = await prisma.user.create({
        data: {
          email: a.email,
          username: a.username,
          passwordHash,
          nickname: a.pen_name,
          role: 'AUTHOR',
          isAdultVerified: true,
          profile: {
            create: {
              birthDate: a.birthdate,
              address: a.address
            }
          },
          author: {
            create: {
              penName: a.pen_name,
              account: {
                create: {
                  bankName: a.bank_info.split(' ')[0],
                  accountNumber: a.bank_info.split(' ')[1],
                  accountHolder: a.pen_name
                }
              }
            }
          }
        },
        include: { author: true }
      });

      // 대표 작품 생성
      await prisma.work.create({
        data: {
          authorId: user.author!.id,
          title: a.work_title,
          description: `${a.work_title}의 소개글입니다.`,
          genre: '판타지',
          tags: '신작',
          rating: 'ALL'
        }
      });
      console.log(`✅ 작가 가입 완료: ${a.username} (${a.pen_name})`);
    }
  }

  console.log('✅ 모든 시딩 완료!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
