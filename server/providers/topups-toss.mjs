// Isolated OP-05 TEST transport. No checkout callback or webhook is a receipt.
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const ref=value=>typeof value==='string'&&/^[A-Za-z0-9_=-]{1,200}$/.test(value);
const amount=value=>Number.isSafeInteger(value)&&value>0&&value<=1_000_000;
const date=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));
const iso=value=>new Date(value).toISOString();
const mismatch=()=>{throw Error('PAYMENT_RECEIPT_MISMATCH');};

export function verifyTopupPayment(raw,order){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.orderId!==order.checkoutId||raw.paymentKey!==order.paymentKey||raw.mId!==order.merchantId||raw.currency!=='KRW'||raw.totalAmount!==order.amountKrw||raw.type!=='NORMAL'||raw.method!=='카드'||!Number.isSafeInteger(raw.balanceAmount)||raw.balanceAmount<0||raw.balanceAmount>order.amountKrw)mismatch();
  const cancels=raw.cancels??[];if(!Array.isArray(cancels))mismatch();
  const common={amountKrw:order.amountKrw,merchantId:order.merchantId,paymentKey:order.paymentKey,balanceKrw:raw.balanceAmount};
  if(['READY','IN_PROGRESS','ABORTED','EXPIRED'].includes(raw.status)){
    if(raw.approvedAt||cancels.length||raw.balanceAmount!==order.amountKrw)mismatch();
    return {...common,state:['READY','IN_PROGRESS'].includes(raw.status)?'PENDING':'NOT_PAID'};
  }
  if(!date(raw.approvedAt)||!ref(raw.lastTransactionKey))mismatch();
  if(raw.status==='DONE'){
    if(cancels.length||raw.balanceAmount!==order.amountKrw)mismatch();
    return {...common,state:'APPROVED',approvedAt:iso(raw.approvedAt),transactionKey:raw.lastTransactionKey};
  }
  if(['CANCELED','PARTIAL_CANCELED'].includes(raw.status)){
    // Only the one service-requested cancellation is supported. External or
    // repeated cancellation histories require manual reconciliation.
    if(!amount(order.refundAmountKrw)||!Number.isSafeInteger(order.expectedBalanceKrw)||order.expectedBalanceKrw!==order.amountKrw-order.refundAmountKrw||cancels.length!==1)return {state:'REVIEW'};
    const c=cancels[0];
    if(!c||c.cancelStatus!=='DONE'||c.cancelAmount!==order.refundAmountKrw||c.transactionKey!==raw.lastTransactionKey||!ref(c.transactionKey)||!date(c.canceledAt)||Date.parse(c.canceledAt)<Date.parse(raw.approvedAt)||raw.balanceAmount!==order.expectedBalanceKrw)mismatch();
    if((raw.status==='CANCELED')!==(raw.balanceAmount===0))mismatch();
    return {...common,state:'CANCELLED',approvedAt:iso(raw.approvedAt),transactionKey:c.transactionKey,cancelledAt:iso(c.canceledAt),cancelAmountKrw:c.cancelAmount};
  }
  return {state:'REVIEW'};
}

export async function topupsTossRequest({operation,order,secretKey,reason=order?.reason},fetchImpl=fetch){
  if(!order||order.providerMode!=='PROVIDER_TEST'||typeof secretKey!=='string'||!/^test_(?:g)?sk_[A-Za-z0-9_-]+$/.test(secretKey)||secretKey.includes('_docs_')||!uuid(order.orderId)||order.checkoutId!=='wn05-'+order.orderId||!uuid(order.operationId)||!ref(order.paymentKey)||!ref(order.merchantId)||!amount(order.amountKrw))throw Error('PAYMENT_CONFIGURATION_REQUIRED');
  if(!['confirm','query','cancel'].includes(operation)||operation!==order.operation)throw Error('PAYMENT_OPERATION_INVALID');
  if(!date(order.operationCreatedAt)||Date.parse(order.operationCreatedAt)>Date.now()+60_000||operation!=='query'&&Date.now()-Date.parse(order.operationCreatedAt)>=15*86400_000)throw Error('PAYMENT_OPERATION_EXPIRED');
  if(operation==='cancel'&&(!amount(order.refundAmountKrw)||order.refundAmountKrw>order.amountKrw||order.expectedBalanceKrw!==order.amountKrw-order.refundAmountKrw||typeof reason!=='string'||reason.trim().length<3||reason.length>200||/[\x00-\x1f\x7f]/.test(reason)))throw Error('PAYMENT_REFUND_INVALID');
  const headers={Authorization:'Basic '+btoa(secretKey+':'),'Content-Type':'application/json'};
  const path=operation==='confirm'?'/v1/payments/confirm':'/v1/payments/'+encodeURIComponent(order.paymentKey)+(operation==='cancel'?'/cancel':'');
  const options={method:operation==='query'?'GET':'POST',headers,signal:AbortSignal.timeout(15_000),redirect:'error'};
  if(operation!=='query'){
    headers['Idempotency-Key']='wn05-'+operation+'-'+order.operationId;
    options.body=JSON.stringify(operation==='confirm'?{paymentKey:order.paymentKey,orderId:order.checkoutId,amount:order.amountKrw}:{cancelReason:reason,cancelAmount:order.refundAmountKrw});
  }
  let response,raw;try{
    response=await fetchImpl('https://api.tosspayments.com'+path,options);if(!response?.ok)throw Error();
    const length=response.headers?.get('content-length');if(length!==null&&Number(length)>65536)throw Error();
    const reader=response.body?.getReader();if(!reader)throw Error();const chunks=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw Error();}chunks.push(value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
    raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch{throw Error('PAYMENT_RESULT_UNKNOWN');}
  return verifyTopupPayment(raw,order);
}
