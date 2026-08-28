import { DemoDataSeedService } from '../src/services/demoDataSeed.service.js';

async function main() {
  console.log('Seeding Prisma DB with 30 dataset...');
  await DemoDataSeedService.seed();
  console.log('Prisma DB 30 Dataset Seed Complete!');
}

main().catch(console.error);
