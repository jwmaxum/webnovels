import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BETA_GATES, evaluateBetaEvidence } from './lib/beta-evidence.mjs';
import { verifyEvidenceProof } from './check_beta_readiness.mjs';

const candidate = 'a'.repeat(40), origin = 'https://staging.example.test', now = Date.parse('2026-10-09T01:00:00Z');
function evidence(scope = 'NOVEL_FREE') {
  return { schemaVersion:1, candidate, origin, scope, p0Open:0,
    participants:{novelAuthors:5,webtoonAuthors:3,readers:30},
    operations:{ownerConfirmed:true,supportConfirmed:true,supportHoursConfirmed:true,stopCriteriaConfirmed:true},
    evidence:BETA_GATES.filter(gate => scope !== 'NOVEL_FREE' || !gate.webtoon).map(gate => ({
      gate:gate.id,status:'PASS',kind:gate.kinds[0],candidate,origin,observedAt:'2026-10-09T00:00:00Z',
      proof:{file:'scratch/launch/evidence/'+gate.id+'.json',sha256:'b'.repeat(64)}
    })) };
}
const evaluate = (input, options = {}) => evaluateBetaEvidence(input,{candidate,origin,scope:input.scope,now,verifyProof:async()=>true,...options});
test('complete real evidence becomes eligible for review without activating or approving a launch',async()=>{
  const result = await evaluate(evidence());
  assert.equal(result.decision,'READY_FOR_HUMAN_APPROVAL');assert.equal(result.activated,false);
  assert.ok(result.gates.every(gate=>gate.status==='PASS'));assert.ok(result.gates.every(gate=>gate.issue&&gate.scenarios.length));
});
test('local unit and synthetic restore results cannot close hosted or device gates',async()=>{
  const input=evidence();input.evidence.find(row=>row.gate==='RESTORE').kind='SYNTHETIC_RESTORE';
  input.evidence.find(row=>row.gate==='DEVICE_INPUT').kind='LOCAL_UNIT';
  const result=await evaluate(input);assert.equal(result.decision,'NO_GO');
  assert.deepEqual(result.blockers.filter(row=>row.code==='EVIDENCE_KIND_NOT_ACCEPTED').map(row=>row.gate),['RESTORE','DEVICE_INPUT']);
});
test('candidate, environment, missing proof, future or stale evidence and duplicate gates stay blocked',async()=>{
  for(const mutate of [
    input=>{input.candidate='c'.repeat(40);},input=>{input.origin='https://other.example.test';},
    input=>{input.evidence[0].observedAt='2026-10-10T00:00:00Z';},
    input=>{input.evidence[0].observedAt='2026-09-01T00:00:00Z';},
    input=>input.evidence.push({...input.evidence[0]}),input=>input.evidence.pop()
  ]){const input=evidence();mutate(input);assert.equal((await evaluate(input)).decision,'NO_GO');}
  assert.equal((await evaluate(evidence(),{verifyProof:async()=>false})).decision,'NO_GO');
  assert.equal((await evaluate(evidence(),{verifyProof:async()=>{throw Error('private file content');}})).decision,'NO_GO');
});
test('webtoon scope requires its own actual image, device and moderation acceptance',async()=>{
  const input=evidence('NOVEL_WEBTOON_FREE');input.evidence=input.evidence.filter(row=>!row.gate.startsWith('WEBTOON'));
  assert.equal((await evaluate(input)).blockers.filter(row=>row.code==='EVIDENCE_MISSING').length,3);
  assert.equal((await evaluate(evidence('NOVEL_WEBTOON_FREE'))).decision,'READY_FOR_HUMAN_APPROVAL');
  assert.equal((await evaluate(evidence(),{scope:'NOVEL_WEBTOON_FREE'})).decision,'NO_GO');
});
test('P0 incidents, unconfirmed support and insufficient actual participants block beta',async()=>{
  for(const mutate of [input=>input.p0Open=1,input=>input.operations.ownerConfirmed=false,
    input=>input.operations.supportHoursConfirmed=false,input=>input.participants.readers=29,
    input=>input.participants.novelAuthors=4]){const input=evidence();mutate(input);assert.equal((await evaluate(input)).decision,'NO_GO');}
  const input=evidence('NOVEL_WEBTOON_FREE');input.participants.webtoonAuthors=2;assert.equal((await evaluate(input)).decision,'NO_GO');
});
test('strict evidence schema rejects secret fields, unsafe proof paths and credential URLs without disclosure',async()=>{
  for(const mutate of [input=>input.token='private-value',input=>input.evidence[0].proof.file='scratch/launch/evidence/../../.env.local',
    input=>input.origin='https://user:private@staging.example.test',input=>input.origin='https://localhost']) {
    const input=evidence();mutate(input);const result=await evaluate(input);
    assert.equal(result.decision,'NO_GO');assert.equal(result.blockers[0].code,'INVALID_EVIDENCE_DOCUMENT');
    assert.ok(!JSON.stringify(result).includes('private-value'));assert.ok(!JSON.stringify(result).includes('.env.local'));
  }
});
test('evidence bytes bind the declared hash and symlink or path escape proof is rejected',async()=>{
  const root=await mkdtemp(path.resolve('scratch/stage19/evidence-test-'));
  await mkdir(path.join(root,'scratch/launch/evidence'),{recursive:true});
  const bytes=Buffer.from('safe acceptance log'),file='scratch/launch/evidence/test.txt';
  await writeFile(path.join(root,file),bytes);
  const sha256=createHash('sha256').update(bytes).digest('hex');assert.equal(await verifyEvidenceProof({file,sha256},root),true);
  assert.equal(await verifyEvidenceProof({file,sha256:'a'.repeat(64)},root),false);
  assert.equal(await verifyEvidenceProof({file:'scratch/launch/evidence/../test.txt',sha256},root),false);
  const linked=path.join(root,'scratch/launch/evidence/link');
  try {await symlink(path.dirname(path.join(root,file)),linked,'junction');}catch(error){if(!['EPERM','EACCES'].includes(error.code))throw error;return;}
  assert.equal(await verifyEvidenceProof({file:'scratch/launch/evidence/link/test.txt',sha256},root),false);
});
