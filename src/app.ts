// ============================================================
// [Application] Express Application Bootstrap & Middleware Config
//
// [Purpose]
// - Express 앱 인스턴스 초기화, 전역 미들웨어(CORS, JSON Parser, Static File Serving) 설정
// - 모든 도메인별 REST API 라우터 마운트 및 404 Not Found 핸들러 등록
//
// [Mounted Route Table]
// - /api/auth      -> authRouter (인증/회원가입/성인인증/프로필)
// - /api/works     -> workRouter (작품목록/홈큐레이션/검색/상세/관심)
// - /api/episodes  -> episodeRouter (회차본문열람/권한검증)
// - /api/ads       -> adRouter (보상형광고토큰발급/SSV검증언락)
// - /api/creator   -> creatorRouter (크리에이터스튜디오/수익대시보드/정산신청/작품등록)
// - /api/admin     -> adminRouter (관리자CMS/서브관리자RBAC/PG설정/KPI/정산마감)
// - /api/community -> communityRouter (댓글/좋아요/신고)
// - /api/payments  -> paymentRouter (토스페이먼츠 승인/취소)
// ============================================================

import express, { Request, Response } from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.router.js';
import { workRouter } from './routes/work.router.js';
import { episodeRouter } from './routes/episode.router.js';
import { adRouter } from './routes/ad.router.js';
import { creatorRouter } from './routes/creator.router.js';
import { adminRouter } from './routes/admin.router.js';
import { communityRouter } from './routes/community.router.js';
import { paymentRouter } from './routes/payment.router.js';
import { revenueRouter } from './routes/revenue.router.js';

import path from 'path';

export const app = express();

// 전역 미들웨어
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// Web SPA Frontend Page Serving
app.get(['/', '/admin'], (req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// Health Check API
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'Ad-Based Web Novel Creator Platform Backend API',
    timestamp: new Date().toISOString()
  });
});

// 도메인별 API 라우터 마운트
app.use('/api/auth', authRouter);
app.use('/api/works', workRouter);
app.use('/api/episodes', episodeRouter);
app.use('/api/ads', adRouter);
app.use('/api/creator', creatorRouter);
app.use('/api/revenue', revenueRouter);
app.use('/api/admin', adminRouter);
app.use('/api/community', communityRouter);
app.use('/api/payments', paymentRouter);

// 404 Not Found Fallback Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: '요청하신 API 경로를 찾을 수 없습니다.' });
});

