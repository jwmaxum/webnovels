import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import {validateRecoveryPacket} from './lib/recovery-evidence.mjs';
import {createHash} from 'node:crypto';
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
test('recovery packet record values preserve valid evidence and reject invalid data under Zod 4',()=>{
 const body={title:'합성 제목',content:'합성 본문',authorComment:''},source={name:'synthetic',refs:['a','b'],empty:null};
 const entry={requestId:crypto.randomUUID(),workId:'1',authorId:'1',draftId:crypto.randomUUID(),episodeId:'1',episodeNumber:'1',revision:'1',sourceRevision:'1',fileId:crypto.randomUUID(),fileSha256:'a'.repeat(64),fileBytes:1,reviewRevision:'0',reviewStatus:'PENDING',contextDigest:'a'.repeat(32),submitted:body,imported:body,submittedSha256:sha(body),importedSha256:sha(body),sourceDigest:sha(source),imageCount:0,blockedReasons:[],source};
 const packet={format:'webnovels-recovery-evidence-packet-v1',projectRef:'a'.repeat(20),snapshotSha256:'a'.repeat(64),capturedAt:new Date().toISOString(),helperSha256:'a'.repeat(64),seedSha256:'a'.repeat(64),missingPrerequisites:[],entries:[entry]};
 assert.deepEqual(validateRecoveryPacket(packet),packet);
 for(const bad of [{...packet,extra:true},{...packet,entries:[{...entry,source:{bad:42}}]},{...packet,entries:[{...entry,source:{...source,name:'tampered'}}]}])assert.throws(()=>validateRecoveryPacket(bad));
});
test('patched Zod rejects oversized constrained collection without traversing members',async()=>{
 const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
 assert.equal(lock.packages['node_modules/zod'].version,'4.6.7');
 let visits=0;const schema=z.array(z.string().refine(()=>{visits++;return true;})).max(2);
 const parsed=schema.safeParse(Array(10000).fill('synthetic'));assert.equal(parsed.success,false);assert.equal(visits,0);
});
