// Read-only configuration facts. Configuration is never external acceptance evidence.
const testKey=(v,kind)=>typeof v==='string'&&new RegExp('^test_(?:g)?'+kind+'_[A-Za-z0-9_-]+$').test(v)&&!v.includes('_docs_');
export function operationsReadiness({env={},items=[]}={}){
 const source=env.PROVIDER_SETTINGS_SOURCE==='database'?'DATABASE':'ENVIRONMENT';
 const stored=Array.isArray(items)?items.find(x=>x.provider==='TOSS'&&x.mode==='TEST'):null;
 let paymentConfiguration='MISSING';
 if(source==='DATABASE')paymentConfiguration=stored?.complete===true?'CONFIGURED':stored?.configuredFields?.length?'INCOMPLETE':'MISSING';
 else{
  const values=[env.TOSS_TEST_CLIENT_KEY,env.TOSS_TEST_SECRET_KEY,env.TOSS_TEST_MERCHANT_ID];
  if(values.some(Boolean))paymentConfiguration=!values.every(Boolean)?'INCOMPLETE':testKey(values[0],'ck')&&testKey(values[1],'sk')&&/^[A-Za-z0-9_=-]{1,200}$/.test(values[2])?'CONFIGURED':'INVALID';
 }
 const configured=paymentConfiguration==='CONFIGURED';
 return {schemaVersion:1,activationAvailable:false,liveReady:false,source,paymentConfiguration,
  checks:[
   {id:'payment-keys',label:'카드결제 TEST 설정',status:paymentConfiguration,detail:configured?'설정 입력 완료 · 실제 승인/조회/취소 인수는 별도입니다.':'TEST 클라이언트 키·시크릿 키·상점 ID를 준비하세요.'},
   {id:'payment-evidence',label:'실제 결제 TEST 결과',status:'NOT_VERIFIED',detail:'제공자 응답과 주문·금액·취소 원장을 대조한 인수 기록이 필요합니다.'},
   {id:'payout-provider',label:'작가 지급 제공자',status:'NOT_VERIFIED',detail:'PG 수납과 작가 지급은 별도입니다. 지급 계약·개별 키·셀러 및 지급 결과 연동을 인수해야 합니다.'},
   {id:'bank-identity',label:'계좌·실명 확인',status:'NOT_VERIFIED',detail:'TEST 계좌 인증의 모의 성공과 수동 서류 승인은 실제 은행 확인을 대신하지 않습니다.'},
   {id:'privacy-tax',label:'개인정보·세무·배분 계약',status:'NOT_VERIFIED',detail:'개인·사업자·법인별 처리, 국외 보관 조건과 실제 계약 배분율을 확정해야 합니다.'},
   {id:'hosted-recovery',label:'운영 복원 인수',status:'NOT_VERIFIED',detail:'운영과 다른 Supabase 대상에서 Auth·권한·원장·private Storage 바이트 복원을 검증해야 합니다.'},
   {id:'activation',label:'운영 전환',status:'BLOCKED',detail:'이 화면은 준비 상태 조회입니다. 키 저장·합성 검증으로 실제 결제나 지급을 활성화하지 않습니다.'}
  ]};
}
