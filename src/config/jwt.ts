// ============================================================
// [Configuration] JWT Authentication Secrets
//
// [Purpose]
// - 사용자 및 관리자 인증에 사용하는 JWT(JSON Web Token) 서명/검증 비밀키 및 유효 기간 정의
//
// [Security Note]
// - 프로덕션 환경 배포 시 반드시 `.env` 파일의 `JWT_SECRET` 환경 변수를 안전한 임의 키로 설정해야 함
// ============================================================

export const JWT_SECRET = process.env.JWT_SECRET || 'webnovel-super-secret-jwt-key-2026';
export const JWT_EXPIRES_IN = '7d';
