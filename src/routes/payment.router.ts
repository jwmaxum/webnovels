// ============================================================
// [Router] Payment Router (/api/payments)
//
// [Purpose]
// - 토스페이먼츠(Toss Payments) 기반 결제 승인(Confirm) 및 결제 취소/환불(Cancel) 라우팅
// - 작가 후원(Donation), 굿즈/팬미팅 결제 완료 처리
//
// [Endpoints]
// - POST /api/payments/toss/confirm : Toss 결제 승인 요청 (paymentKey, orderId, amount)
// - POST /api/payments/toss/cancel : Toss 결제 취소 요청 (paymentKey, cancelReason)
// ============================================================

import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middlewares/auth.middleware.js';
import { TossPaymentService } from '../services/tossPayment.service.js';

export const paymentRouter = Router();

// 모든 결제 요청은 인증된 사용자만 가능
paymentRouter.use(authenticateToken);

// ============================================================
// [Route] POST /api/payments/toss/confirm
// [Purpose] 토스페이먼츠 클라이언트 SDK 결제창 인증 완료 후 최종 승인 호출
// [Parameters] paymentKey (Toss 발급 키), orderId (주문번호), amount (결제금액)
// ============================================================
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

// ============================================================
// [Route] POST /api/payments/toss/cancel
// [Purpose] 결제 취소 및 환불 요청
// [Parameters] paymentKey, cancelReason
// ============================================================
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

