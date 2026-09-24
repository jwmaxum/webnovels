// Read-only GitHub status of this repository; auth tokens and API response bodies are never logged.
const fs = require('node:fs');
const { loadEnv } = require('./lib/launch-access.cjs');
async function main() {
  const env = loadEnv(), sha = process.argv[2];
  if (sha && !/^[a-f0-9]{40}$/.test(sha)) throw Error('INVALID_COMMIT_SHA');
  const token = env.GITHUB_PERSONAL_ACCESS_TOKEN || env.GH_TOKEN || env.GITHUB_TOKEN;
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'webnovels-release-status',
    'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const base = 'https://api.github.com/repos/jwmaxum/webnovels';
  const get = async path => {
    const response = await fetch(base + path, { headers, signal: AbortSignal.timeout(20000), redirect: 'error' });
    return { status: response.status, scopes: response.headers.get('x-oauth-scopes'),
      data: response.ok ? await response.json() : null };
  };
  const repo = await get('');
  const report = { checkedAt: new Date().toISOString(), commit: sha || null, repositoryStatus: repo.status,
    pushPermission: repo.data?.permissions?.push ?? null, workflowScope: repo.scopes ? repo.scopes.split(',').map(value=>value.trim()).includes('workflow') : null,
    defaultBranch: repo.data?.default_branch ?? null };
  if (repo.status === 200 && sha) {
    const [checks, statuses, runs] = await Promise.all([
      get(`/commits/${sha}/check-runs`), get(`/commits/${sha}/status`), get(`/actions/runs?head_sha=${sha}`)
    ]);
    report.checksStatus = checks.status;
    report.checks = (checks.data?.check_runs || []).map(row => ({ name: row.name, status: row.status,
      conclusion: row.conclusion, url: row.html_url, detailsUrl: row.details_url }));
    report.statuses = (statuses.data?.statuses || []).map(row => ({ context: row.context, state: row.state, url: row.target_url }));
    report.runs = (runs.data?.workflow_runs || []).map(row => ({ name: row.name, status: row.status,
      conclusion: row.conclusion, url: row.html_url }));
  }
  fs.mkdirSync('scratch', { recursive: true });
  fs.writeFileSync('scratch/github-release-status.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (repo.status !== 200) process.exitCode = 2;
}
main().catch(() => { console.error('GITHUB_STATUS_UNAVAILABLE (details redacted)'); process.exitCode = 2; });
