import { ENV } from './env.js';

// Strict allowlist: never serialize ENV itself into a browser response.
export function publicSupabaseConfig(url = ENV.SUPABASE_URL, key = ENV.SUPABASE_PUBLISHABLE_KEY) {
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Invalid Supabase URL');
  }
  let publishable = key.startsWith('sb_publishable_');
  if (key.startsWith('eyJ')) {
    try {
      publishable = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon';
    } catch { publishable = false; }
  }
  if (!publishable) throw new Error('Supabase browser configuration requires a publishable or anon key');
  return { supabaseUrl: parsed.origin, supabaseAnonKey: key };
}

// Read-only readiness check, never returns database rows or credentials.
export async function checkSupabaseConnection() {
  const key = ENV.SUPABASE_SECRET_KEY || ENV.SUPABASE_SERVICE_ROLE_KEY;
  if (!ENV.SUPABASE_URL || !key) throw new Error('Supabase server configuration missing');
  const headers: Record<string, string> = { apikey: key };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  const response = await fetch(new URL('/rest/v1/works?select=id&limit=1', ENV.SUPABASE_URL), {
    headers, signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error('Supabase unavailable');
  await response.arrayBuffer();
}
