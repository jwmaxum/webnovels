import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middlewares/auth.middleware.js';
import { TossPaymentService } from '../services/tossPayment.service.js';

export const paymentRouter = Router();

// 모든 결제 요청은 인증된 사용자만 가능
paymentRouter.use(authenticateToken);

/**
 * 토스페이먼츠 결제 승인 요청 API
 */
paymentRouter.post('/toss/confirm', async (req: AuthRequest, res: Response) => {
  try {
    const { paymentKey, orderId, amount } = req.body;

    if (!paymentKey || !orderId || amount === undefined) {
      return res.status(400).json({ error: 'paymentKey, orderId, amount는 필수 파라미터입니다.' });
    }

    const result = await TossPaymentService.confirmPayment({
      paymentKey,
      orderId,
      amount: Number(amount)
    });

    return res.json({
      message: '토스페이먼츠 결제가 성공적으로 승인되었습니다.',
      result
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || '결제 승인 처리 중 오류 발생' });
  }
});

/**
 * 토스페이먼츠 결제 취소 API
 */
paymentRouter.post('/toss/cancel', async (req: AuthRequest, res: Response) => {
  try {
    const { paymentKey, cancelReason } = req.body;

    if (!paymentKey || !cancelReason) {
      return res.status(400).json({ error: 'paymentKey와 cancelReason은 필수 파라미터입니다.' });
    }

    const result = await TossPaymentService.cancelPayment({
      paymentKey,
      cancelReason
    });

    return res.json({
      message: '결제가 성공적으로 취소되었습니다.',
      result
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || '결제 취소 처리 중 오류 발생' });
  }
});
