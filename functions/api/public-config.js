// Cloudflare Pages runtime bindings; never serialize context.env.
export function onRequestGet({ env }) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY;
  let validKey = typeof key === 'string' && key.startsWith('sb_publishable_');
  if (typeof key === 'string' && key.startsWith('eyJ')) {
    try { validKey = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon'; } catch { validKey = false; }
  }
  const headers = { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (!validKey || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url || '')) {
    return new Response('/* Runtime override unavailable; keep public deployment settings. */', { status: 503, headers });
  }
  const config = { supabaseUrl: url, supabaseAnonKey: key, authorPublishEnabled: env.AUTHOR_PUBLISH_ENABLED === 'true',
    readerServiceEnabled: env.READER_SERVICE_ENABLED === 'true',
    authorOperationsEnabled: env.AUTHOR_OPERATIONS_ENABLED === 'true',
    adminOperationsEnabled: env.ADMIN_OPERATIONS_ENABLED === 'true',
    adminRoleChangesEnabled: env.ADMIN_ROLE_CHANGES_ENABLED === 'true' };
  return new Response('window.WEBNOVELS_CONFIG = Object.freeze(' + JSON.stringify(config).replace(/</g, '\\u003c') + ');', { headers });
}
