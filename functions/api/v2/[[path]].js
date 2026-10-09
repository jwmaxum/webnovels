import { handleSecureApi } from '../../../server/secure-api.mjs';
import { withSecurityHeaders } from '../../../server/security-headers.mjs';

// Cloudflare Pages Functions. Runtime env contains server-only secrets.
export async function onRequest(context) {
  return withSecurityHeaders(await handleSecureApi(context.request, context.env));
}
