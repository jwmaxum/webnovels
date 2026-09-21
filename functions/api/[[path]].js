import { onRequestGet as publicConfig } from './public-config.js';

// Pages removes the source file extension from routes; keep the existing .js URL.
export function onRequest(context) {
  if (new URL(context.request.url).pathname === '/api/public-config.js' && context.request.method === 'GET') return publicConfig(context);
  // Unimplemented legacy Express/SQLite routes must never return the SPA as HTTP 200.
  return new Response(JSON.stringify({ error: 'LEGACY_API_NOT_AVAILABLE_ON_CLOUDFLARE' }), {
    status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
