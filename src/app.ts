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

import path from 'path';

export const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// Admin Web Application Page Serving
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

// API Routes Router Mounting
app.use('/api/auth', authRouter);
app.use('/api/works', workRouter);
app.use('/api/episodes', episodeRouter);
app.use('/api/ads', adRouter);
app.use('/api/creator', creatorRouter);
app.use('/api/admin', adminRouter);
app.use('/api/community', communityRouter);
app.use('/api/payments', paymentRouter);

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: '요청하신 API 경로를 찾을 수 없습니다.' });
});
