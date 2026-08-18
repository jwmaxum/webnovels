// ============================================================
// [Serverless Entry Point] Vercel Serverless Function Handler
//
// [Purpose]
// - Vercel 플랫폼 배포 시 Express 애플리케이션(`app`)을 Serverless Handler로 export
// ============================================================

import { app } from '../src/app.js';

export default app;

