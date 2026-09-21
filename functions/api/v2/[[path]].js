import { handleSecureApi } from '../../../server/secure-api.mjs';

// Cloudflare Pages Functions. Runtime env contains server-only secrets.
export function onRequest(context) {
  return handleSecureApi(context.request, context.env);
}
