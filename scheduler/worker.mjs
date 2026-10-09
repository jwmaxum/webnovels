// Deploy separately from Pages. Only the scheduled event can call the service-only RPC.
export default {
  async scheduled(_event, env, context) {
    if (env.AUTHOR_PUBLISH_ENABLED !== 'true' && env.GROWTH_SERVICE_ENABLED !== 'true') return;
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(env.SUPABASE_URL || '') ||
        !env.SUPABASE_SECRET_KEY) throw Error('Scheduler configuration missing');
    const invoke=async name=>{
    const response = await fetch(new URL('/rest/v1/rpc/'+name, env.SUPABASE_URL), {
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
    };
    // Separate disabled-by-default preparation job. It never changes a tier or sends messages.
    // Run jobs independently so a publication failure cannot starve the growth batch.
    const jobs=[];
    if(env.AUTHOR_PUBLISH_ENABLED==='true')jobs.push(invoke(env.WEBTOON_SERVICE_ENABLED==='true'?'run_creator_schedules_v18':'run_creator_schedules'));
    if(env.GROWTH_SERVICE_ENABLED==='true')jobs.push(invoke('run_growth_evaluations'));
    if(env.GROWTH_SERVICE_ENABLED==='true'&&env.GROWTH_MEASUREMENT_ENABLED==='true')jobs.push(invoke('prune_growth_measurements'));
    const results=await Promise.allSettled(jobs);
    if(results.some(x=>x.status==='rejected'))throw Error('Scheduled job failed; inspect RPC status');
  },
  async fetch() {
    return new Response('Not found', { status: 404 });
  }
};
