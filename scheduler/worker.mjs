// Deploy separately from Pages. Only the scheduled event can call the service-only RPC.
export default {
  async scheduled(_event, env, context) {
    if (env.AUTHOR_PUBLISH_ENABLED !== 'true') return;
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(env.SUPABASE_URL || '') ||
        !env.SUPABASE_SECRET_KEY) throw Error('Scheduler configuration missing');
    const response = await fetch(new URL('/rest/v1/rpc/run_creator_schedules', env.SUPABASE_URL), {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        ...(env.SUPABASE_SECRET_KEY.startsWith('eyJ') ? { Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY } : {}),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_limit: 20 }),
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw Error('Schedule RPC failed: ' + response.status);
    const result = await response.json();
    if (result?.failedOrRetrying) console.error('Authoring schedules need attention', {
      failedOrRetrying: result.failedOrRetrying
    });
    // Keep the invocation observable in Cloudflare cron logs without manuscript text.
    context.waitUntil(Promise.resolve(result));
  },
  async fetch() {
    return new Response('Not found', { status: 404 });
  }
};
