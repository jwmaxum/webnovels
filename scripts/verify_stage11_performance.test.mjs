import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import vm from 'node:vm';

test('long manuscript diff preview stays bounded without changing either snapshot',()=>{
  const context=vm.createContext({});
  vm.runInContext(readFileSync('public/js/creator/draft-diff.js','utf8'),context);
  const oldText='가나다\n'.repeat(20000),newText='가나다 수정\n'.repeat(20000);
  const before=performance.now();
  const diff=context.draftLineDiff(oldText,newText);
  const elapsed=performance.now()-before;
  assert.ok(diff.length<=202,`Unbounded preview: ${diff.length} rows`);
  assert.ok(diff.some(row=>row.type==='summary'));
  assert.ok(diff.some(row=>row.type==='del')&&diff.some(row=>row.type==='ins'));
  assert.equal(oldText.length,80000);
  assert.equal(newText.length,140000);
  assert.ok(elapsed<5000,`Long diff blocked for ${elapsed.toFixed(0)} ms`);
  console.log(`Long diff: ${diff.length} rows in ${elapsed.toFixed(1)} ms`);
});
