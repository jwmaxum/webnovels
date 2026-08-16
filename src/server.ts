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
