// Provider transport only. Caller must reserve a DB order and finalize it in a transaction.
// Never call this with an order assembled from browser-supplied amount/owner fields.
export async function confirmTossPayment({ order, actorId, paymentKey, clientAmount, secretKey, mode }, fetchImpl = fetch) {
  if (!order || order.auth_user_id !== actorId || order.status !== 'APPROVING') throw new Error('ORDER_NOT_RESERVED');
  if (!Number.isSafeInteger(order.amount_krw) || order.amount_krw <= 0 || order.currency !== 'KRW' || clientAmount !== order.amount_krw) throw new Error('ORDER_AMOUNT_MISMATCH');
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(order.id || '') || typeof paymentKey !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(paymentKey)) throw new Error('INVALID_PAYMENT_REFERENCE');
  const prefix = mode === 'LIVE' ? /^live_(?:g)?sk_/ : mode === 'TEST' ? /^test_(?:g)?sk_/ : /$^/;
  if (!prefix.test(secretKey || '') || secretKey.includes('_docs_')) throw new Error('TOSS_CONFIGURATION_REQUIRED');
  let response;
  try {
    response = await fetchImpl('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST', headers: {
        Authorization: 'Basic ' + btoa(secretKey + ':'), 'Content-Type': 'application/json',
        'Idempotency-Key': 'confirm-' + order.id
      },
      body: JSON.stringify({ paymentKey, orderId: order.id, amount: order.amount_krw }), signal: AbortSignal.timeout(15000)
    });
  } catch { throw new Error('PAYMENT_RESULT_UNKNOWN'); }
  if (!response.ok) throw new Error(response.status >= 500 ? 'PAYMENT_RESULT_UNKNOWN' : 'PAYMENT_REJECTED');
  let data;
  try { data = await response.json(); } catch { throw new Error('PAYMENT_RESULT_UNKNOWN'); }
  if (data.orderId !== order.id || data.paymentKey !== paymentKey || data.totalAmount !== order.amount_krw || data.currency !== 'KRW' || data.status !== 'DONE' || !Number.isFinite(Date.parse(data.approvedAt))) throw new Error('PAYMENT_CONFIRMATION_MISMATCH');
  return { orderId: data.orderId, paymentKey: data.paymentKey, amountKrw: data.totalAmount, currency: 'KRW', status: 'DONE', approvedAt: data.approvedAt };
}
