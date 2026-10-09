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
  if (!response.ok) throw new Error(response.status >= 500 || response.status === 409 ? 'PAYMENT_RESULT_UNKNOWN' : 'PAYMENT_REJECTED');
  let data;
  try { data = await response.json(); } catch { throw new Error('PAYMENT_RESULT_UNKNOWN'); }
  if (data.orderId !== order.id || data.paymentKey !== paymentKey || data.totalAmount !== order.amount_krw || data.currency !== 'KRW' || data.status !== 'DONE' || !Number.isFinite(Date.parse(data.approvedAt))) throw new Error('PAYMENT_CONFIRMATION_MISMATCH');
  return { orderId: data.orderId, paymentKey: data.paymentKey, amountKrw: data.totalAmount, currency: 'KRW', status: 'DONE', approvedAt: data.approvedAt };
}

// Stage20 transport: card / KRW / TEST only. No secrets or raw provider bodies leave this module.
const reference = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
function sandboxConfig(order, secretKey) {
  if (order?.mode !== 'TEST' || !/^test_(?:g)?sk_/.test(secretKey || '') || secretKey.includes('_docs_') ||
      !reference(order?.merchant_id) || !reference(order?.id) || !reference(order?.payment_key) ||
      !Number.isSafeInteger(order.amount_krw) || order.amount_krw < 1 || order.currency !== 'KRW')
    throw new Error('TOSS_SANDBOX_CONFIGURATION_REQUIRED');
}
export function verifyEpisodePayment(data, order) {
  const mismatch = () => { throw new Error('PAYMENT_CONFIRMATION_MISMATCH'); };
  if (!data || data.orderId !== order.id || data.paymentKey !== order.payment_key ||
      data.mId !== order.merchant_id || data.currency !== 'KRW' || data.totalAmount !== order.amount_krw ||
      data.type !== 'NORMAL' || data.method !== '카드' || !Number.isSafeInteger(data.balanceAmount) ||
      data.balanceAmount < 0 || data.balanceAmount > data.totalAmount ||
      (data.status === 'DONE' && data.balanceAmount !== data.totalAmount)) mismatch();
  const result = { paymentKey: data.paymentKey, merchantId: data.mId, mode: 'TEST',
    amountKrw: data.totalAmount, currency: 'KRW' };
  if (['ABORTED', 'EXPIRED'].includes(data.status) && !data.approvedAt && data.balanceAmount === data.totalAmount)
    return { ...result, state: 'NOT_PAID' };
  if (['READY', 'IN_PROGRESS'].includes(data.status) && !data.approvedAt && data.balanceAmount === data.totalAmount)
    return { ...result, state: 'PENDING' };
  if (!date(data.approvedAt) || !reference(data.lastTransactionKey)) mismatch();
  if (data.status === 'DONE' && data.balanceAmount === data.totalAmount && (!data.cancels || data.cancels.length === 0))
    return { ...result, state: 'APPROVED', approvedAt: data.approvedAt, transactionKey: data.lastTransactionKey };
  if (data.status === 'CANCELED' && data.balanceAmount === 0 && Array.isArray(data.cancels) && data.cancels.length === 1) {
    const cancel = data.cancels[0];
    if (cancel.cancelAmount !== order.amount_krw || cancel.cancelStatus !== 'DONE' ||
        cancel.transactionKey !== data.lastTransactionKey || !date(cancel.canceledAt) ||
        Date.parse(cancel.canceledAt) < Date.parse(data.approvedAt)) mismatch();
    return { ...result, state: 'CANCELLED', approvedAt: data.approvedAt,
      cancelledAt: cancel.canceledAt, transactionKey: cancel.transactionKey };
  }
  // Partial / asynchronous cancellation cannot be represented as a completed full refund.
  return { ...result, state: 'REVIEW' };
}
export async function episodeTossRequest({ operation, order, secretKey, reason }, fetchImpl = fetch) {
  sandboxConfig(order, secretKey);
  if (!['confirm', 'query', 'cancel'].includes(operation)) throw new Error('INVALID_PAYMENT_OPERATION');
  if (operation === 'cancel' && (typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 200))
    throw new Error('REFUND_REASON_REQUIRED');
  const query = operation === 'query';
  const endpoint = operation === 'confirm' ? '/v1/payments/confirm' :
    '/v1/payments/' + encodeURIComponent(order.payment_key) + (query ? '' : '/cancel');
  const headers = { Authorization: 'Basic ' + btoa(secretKey + ':'), 'Content-Type': 'application/json' };
  // Different operations have different immutable keys; lease retries reuse the same key.
  if (!query) headers['Idempotency-Key'] = 'wn20-' + operation + '-' + order.id;
  const body = operation === 'confirm' ? { paymentKey: order.payment_key, orderId: order.id, amount: order.amount_krw } :
    { cancelReason: reason, cancelAmount: order.amount_krw };
  let response, data;
  try {
    response = await fetchImpl('https://api.tosspayments.com' + endpoint, {
      method: query ? 'GET' : 'POST', headers, ...(query ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000)
    });
    // A 409 may still be processing. Even a 4xx must be reconciled before local failure/rights changes.
    if (!response.ok) throw new Error('PAYMENT_RESULT_UNKNOWN');
    data = await response.json();
  } catch { throw new Error('PAYMENT_RESULT_UNKNOWN'); }
  return verifyEpisodePayment(data, order);
}
