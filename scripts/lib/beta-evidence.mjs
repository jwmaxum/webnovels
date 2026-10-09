import { z } from 'zod';

// Evidence completeness is assessed here; human reviewers establish its authenticity.
export const BETA_GATES = Object.freeze([
  { id: 'CI', kinds: ['REMOTE_CI'], issue: 'R02', scenarios: ['OPS-02'] },
  { id: 'DEPLOYMENT', kinds: ['HOSTED_API'], issue: 'R02', scenarios: ['OPS-02'] },
  { id: 'DEPLOYMENT_BLOCK', kinds: ['OPERATIONS_DRILL'], issue: 'R02', scenarios: ['OPS-02'] },
  { id: 'DB_SECURITY', kinds: ['HOSTED_API'], issue: 'S03/S04', scenarios: ['SEC-01','SEC-02'] },
  { id: 'ROLES', kinds: ['HOSTED_API'], issue: 'R01', scenarios: ['AUTH-03','SEC-01','SEC-03','SEC-04'] },
  { id: 'AUTH_MAIL', kinds: ['OPERATIONS_DRILL'], issue: 'R01', scenarios: ['AUTH-01','AUTH-02'] },
  { id: 'AUTHOR_FLOW', kinds: ['DEVICE'], issue: 'R01', scenarios: ['WORK-01','DRAFT-01','DRAFT-03','PUB-02','SCH-01','SCH-02'] },
  { id: 'NOVEL_READER', kinds: ['DEVICE'], issue: 'R01', scenarios: ['PUB-01','READ-01','READ-02'] },
  { id: 'RESTORE', kinds: ['HOSTED_RESTORE'], issue: 'R04', scenarios: ['OPS-01'] },
  { id: 'DEVICE_INPUT', kinds: ['DEVICE'], issue: 'R05', scenarios: ['OPS-03','DRAFT-04','DRAFT-06'] },
  { id: 'XSS', kinds: ['HOSTED_API','DEVICE'], issue: 'S04', scenarios: ['SEC-05'] },
  { id: 'MONITORING', kinds: ['OPERATIONS_DRILL'], issue: 'R04', scenarios: ['OPS-04','SCH-03'] },
  { id: 'POLICY', kinds: ['POLICY_REVIEW'], issue: 'R03/R04', scenarios: ['ADMIN-01'] },
  { id: 'BETA', kinds: ['HUMAN_BETA'], issue: 'R01/R04', scenarios: ['WORK-01','PUB-01','READ-01'] },
  { id: 'WEBTOON_IMAGES', kinds: ['HOSTED_API'], issue: 'R01', scenarios: ['TOON-01','TOON-02','SEC-02'], webtoon: true },
  { id: 'WEBTOON_READER', kinds: ['DEVICE'], issue: 'R05', scenarios: ['TOON-03','TOON-04'], webtoon: true },
  { id: 'WEBTOON_MODERATION', kinds: ['HOSTED_API'], issue: 'R01', scenarios: ['TOON-05','SEC-04'], webtoon: true }
]);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const origin = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
    url.pathname === '/' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname);
});
const proofPath = z.string().max(240).regex(/^scratch\/launch\/evidence\/[a-zA-Z0-9_./-]+$/)
  .refine(value => !value.split('/').some(part => !part || part === '.' || part === '..'));
const evidenceSchema = z.object({
  gate: z.enum(BETA_GATES.map(gate => gate.id)),
  status: z.enum(['PASS','FAIL','PENDING']),
  kind: z.enum(['REMOTE_CI','HOSTED_API','HOSTED_RESTORE','DEVICE','HUMAN_BETA','POLICY_REVIEW','OPERATIONS_DRILL','LOCAL_UNIT','SYNTHETIC_RESTORE']),
  candidate: sha, origin, observedAt: z.string().datetime(),
  proof: z.object({ file: proofPath, sha256: digest }).strict()
}).strict();
export const betaSchema = z.object({
  schemaVersion: z.literal(1), candidate: sha, origin, scope: z.enum(['NOVEL_FREE','NOVEL_WEBTOON_FREE']),
  p0Open: z.number().int().nonnegative(),
  participants: z.object({ novelAuthors: z.number().int().nonnegative(), webtoonAuthors: z.number().int().nonnegative(), readers: z.number().int().nonnegative() }).strict(),
  operations: z.object({ ownerConfirmed: z.boolean(), supportConfirmed: z.boolean(), supportHoursConfirmed: z.boolean(), stopCriteriaConfirmed: z.boolean() }).strict(),
  evidence: z.array(evidenceSchema).max(50)
}).strict();

export async function evaluateBetaEvidence(input, { candidate, origin: expectedOrigin, scope, now = Date.now(), verifyProof = async () => false } = {}) {
  const parsed = betaSchema.safeParse(input);
  if (!parsed.success) return { decision: 'NO_GO', blockers: [{ code: 'INVALID_EVIDENCE_DOCUMENT' }], gates: [] };
  const document = parsed.data, blockers = [], gates = [];
  const add = (code, gate) => blockers.push({ code, ...(gate ? { gate } : {}) });
  if (!sha.safeParse(candidate).success || candidate !== document.candidate) add('CANDIDATE_MISMATCH');
  if (!expectedOrigin || expectedOrigin !== document.origin) add('ENVIRONMENT_MISMATCH');
  if (!scope || scope !== document.scope) add('SCOPE_MISMATCH');
  if (document.p0Open) add('OPEN_P0_ISSUES');
  if (Object.values(document.operations).some(value => !value)) add('OPERATIONS_NOT_CONFIRMED');
  const webtoon = document.scope === 'NOVEL_WEBTOON_FREE';
  if (document.participants.novelAuthors < 5 || document.participants.readers < 30 || (webtoon && document.participants.webtoonAuthors < 3)) add('BETA_SAMPLE_INSUFFICIENT');
  const seen = new Set();
  for (const row of document.evidence) {
    if (seen.has(row.gate)) add('DUPLICATE_GATE', row.gate);
    seen.add(row.gate);
  }
  for (const gate of BETA_GATES.filter(gate => webtoon || !gate.webtoon)) {
    const row = document.evidence.find(row => row.gate === gate.id);
    let valid = true;
    const reject = code => { add(code, gate.id); valid = false; };
    if (!row) reject('EVIDENCE_MISSING');
    else {
      if (row.status !== 'PASS') reject('EVIDENCE_NOT_PASSED');
      if (!gate.kinds.includes(row.kind)) reject('EVIDENCE_KIND_NOT_ACCEPTED');
      if (row.candidate !== candidate || row.origin !== expectedOrigin) reject('EVIDENCE_CONTEXT_MISMATCH');
      const age = now - Date.parse(row.observedAt);
      if (!Number.isFinite(age) || age < 0 || age > 14 * 86400000) reject('EVIDENCE_STALE');
      let proofValid = false;
      try { proofValid = await verifyProof(row.proof); } catch { /* Safe rejection without file content. */ }
      if (!proofValid) reject('EVIDENCE_PROOF_MISMATCH');
    }
    gates.push({ id: gate.id, issue: gate.issue, scenarios: gate.scenarios, status: valid ? 'PASS' : 'BLOCKED' });
  }
  return { schemaVersion: 1, candidate: document.candidate, scope: document.scope,
    decision: blockers.length ? 'NO_GO' : 'READY_FOR_HUMAN_APPROVAL', blockers, gates,
    activated: false, limitation: 'Evidence provenance and launch approval require human review; this tool never changes service flags.' };
}
