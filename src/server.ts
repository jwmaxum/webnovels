// ============================================================
// [Server Entry Point] HTTP Server Bootstrap
//
// [Purpose]
// - HTTP 서버 포트 바인딩 (기본 4000) 및 초기 기동 프로세스 실행
// - 기동 시 `SuperAdminInitService.initSuperAdmin()`과 `DemoDataSeedService.seed()`를 호출하여 필수 관리자 계정 및 데모 데이터 자동 초기화
// ============================================================

import { app } from './app.js';
import dotenv from 'dotenv';
import { SuperAdminInitService } from './services/superAdminInit.service.js';
import { DemoDataSeedService } from './services/demoDataSeed.service.js';

dotenv.config();

const PORT = process.env.PORT || 4000;

app.listen(PORT, async () => {
  console.log(`🚀 [WebNovel Backend] Server is running at http://localhost:${PORT}`);
  try {
    await SuperAdminInitService.initSuperAdmin();
    await DemoDataSeedService.seed();
  } catch (err) {
    console.error('⚠️ [SuperAdminInit Error]', err);
  }
});

