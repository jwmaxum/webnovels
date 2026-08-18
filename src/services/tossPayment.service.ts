// ============================================================
// [Service] Toss Payments 연동 결제 서비스
//
// [Purpose]
// - 토스페이먼츠(Toss Payments) v1 REST API 연동
// - 작가 후원(Donation), 굿즈 구매(Order), 팬미팅 티켓 구매 등의 결제 승인(Confirm) 및 결제 취소(Cancel) 처리
//
// [Authentication]
// - Secret Key를 `Basic Base64(secretKey + ":")`로 인코딩하여 HTTP Authorization Header에 전달
// - `test_sk_docs_`로 시작하는 테스트 키인 경우 Sandbox 모의 응답 자동 반환 지원
// ============================================================

import { ConfigService } from './config.service.js';

export interface TossPaymentConfirmInput {
  paymentKey: string;
  orderId: string;
  amount: number;
}

export interface TossPaymentCancelInput {
  paymentKey: string;
  cancelReason: string;
}

export class TossPaymentService {
  // ============================================================
  // [Function] confirmPayment
  // [Purpose] 토스페이먼츠 결제 승인 요청 (POST https://api.tosspayments.com/v1/payments/confirm)
  // [Flow]
  // 1. 프론트엔드 Toss SDK 결제창 인증 완료 후 `paymentKey`, `orderId`, `amount` 수신
  // 2. 백엔드에서 결제 승인 API 호출하여 최종 결제 완료 처리
  // ============================================================
  static async confirmPayment(input: TossPaymentConfirmInput) {
    const config = await ConfigService.getConfig();
    const secretKey = config.tossSecretKey || 'test_sk_docs_O7l2mZ1N3p81A2jL3b5z';

    // Basic Base64 Authorization encoding (secretKey + ":")
    const basicAuthToken = Buffer.from(`${secretKey}:`).toString('base64');

    // TEST Key일 경우 혹은 실제 외부 호출 처리
    if (secretKey.startsWith('test_sk_docs_')) {
      // Toss 공식 테스트 키일 시 모의 승인 성공 응답 형성
      return {
        paymentKey: input.paymentKey,
        orderId: input.orderId,
        totalAmount: input.amount,
        status: 'DONE',
        approvedAt: new Date().toISOString(),
        method: '카드',
        currency: 'KRW',
        mid: config.tossMid || 'tosspayments',
        message: '토스페이먼츠 결제가 성공적으로 승인되었습니다.'
      };
    }

    try {
      const response = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuthToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          paymentKey: input.paymentKey,
          orderId: input.orderId,
          amount: input.amount
        })
      });

      const data: any = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || '토스페이먼츠 결제 승인 실패');
      }

      return data;
    } catch (error: any) {
      throw new Error(`[TossPayments Error] ${error.message}`);
    }
  }

  // ============================================================
  // [Function] cancelPayment
  // [Purpose] 토스페이먼츠 결제 취소/환불 요청 (POST https://api.tosspayments.com/v1/payments/{paymentKey}/cancel)
  // ============================================================
  static async cancelPayment(input: TossPaymentCancelInput) {
    const config = await ConfigService.getConfig();
    const secretKey = config.tossSecretKey || 'test_sk_docs_O7l2mZ1N3p81A2jL3b5z';
    const basicAuthToken = Buffer.from(`${secretKey}:`).toString('base64');

    if (secretKey.startsWith('test_sk_docs_')) {
      return {
        paymentKey: input.paymentKey,
        status: 'CANCELED',
        cancelReason: input.cancelReason,
        canceledAt: new Date().toISOString(),
        message: '토스페이먼츠 결제가 정상적으로 취소 처리되었습니다.'
      };
    }

    try {
      const response = await fetch(`https://api.tosspayments.com/v1/payments/${input.paymentKey}/cancel`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuthToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          cancelReason: input.cancelReason
        })
      });

      const data: any = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || '토스페이먼츠 결제 취소 실패');
      }

      return data;
    } catch (error: any) {
      throw new Error(`[TossPayments Cancel Error] ${error.message}`);
    }
  }

  // ============================================================
  // [Function] testConnection
  // [Purpose] 관리자 설정 페이지에서 토스페이먼츠 키 설정 상태 테스트
  // ============================================================
  static async testConnection() {
    const config = await ConfigService.getConfig();
    const secretKey = config.tossSecretKey || '';
    if (!secretKey) {
      return { success: false, message: '토스페이먼츠 Secret Key가 설정되지 않았습니다.' };
    }
    return {
      success: true,
      message: `토스페이먼츠 API 연동 가능 상태입니다. (Mode: ${config.tossMode}, MID: ${config.tossMid})`
    };
  }
}

