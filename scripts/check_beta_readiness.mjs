import { readFile, lstat, realpath, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateBetaEvidence } from './lib/beta-evidence.mjs';

export async function verifyEvidenceProof(proof, root = process.cwd()) {
  const base = await realpath(root);
  const parts = proof.file.split('/');
  if (parts.slice(0,3).join('/') !== 'scratch/launch/evidence' || parts.some(part => !part || part === '.' || part === '..' || part.includes('\\'))) return false;
  let file = base;
  for (const part of parts) {
    file = path.join(file, part);
    if ((await lstat(file)).isSymbolicLink()) return false;
  }
  const info = await lstat(file);
  if (!info.isFile() || info.size > 2 * 1024 * 1024) return false;
  return createHash('sha256').update(await readFile(file)).digest('hex') === proof.sha256;
}
async function main() {
  const [file, candidate, origin, scope] = process.argv.slice(2);
  if (!file || !candidate || !origin || !scope) throw Error('BETA_ARGUMENTS_REQUIRED');
  const bytes = await readFile(file);
  if (bytes.length > 2 * 1024 * 1024) throw Error('BETA_DOCUMENT_TOO_LARGE');
  const report = await evaluateBetaEvidence(JSON.parse(bytes), { candidate, origin, scope, verifyProof: verifyEvidenceProof });
  await mkdir('scratch/stage19', { recursive: true });
  await writeFile('scratch/stage19/beta-readiness.json', JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if (report.decision !== 'READY_FOR_HUMAN_APPROVAL') process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(() => { console.error('BETA_CHECK_FAILED_DETAILS_WITHHELD'); process.exitCode = 2; });
