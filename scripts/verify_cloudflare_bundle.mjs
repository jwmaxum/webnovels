// Validate the esbuild CLI output without starting a browser, server, or remote service.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

const root='scratch/step11-cloudflare-bundle';
const files=['api/[[path]].js','api/public-config.js','api/v2/[[path]].js'];
for(const file of files){
  const source=await readFile(join(root,file),'utf8');
  assert.ok(source.length>0,`Empty Pages Function bundle: ${file}`);
  assert.ok(!source.includes('require("node:'),`Node runtime dependency: ${file}`);
  assert.ok(!source.includes('SUPABASE_SECRET_KEY='),`Secret assignment in bundle: ${file}`);
  if(file==='api/v2/[[path]].js')
    assert.ok(source.includes('createSecureApi'),'Secure API missing from v2 bundle');
}
console.log('PASS: 3 Cloudflare Pages Functions bundle for browser/Worker runtime');
