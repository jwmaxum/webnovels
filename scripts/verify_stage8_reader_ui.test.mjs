import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/js/reader/reader-hub.js',import.meta.url),'utf8');
test('reader cache and late responses never cross Auth account boundaries',async()=>{
  let account='a',release;
  const requests=[];
  const window={WEBNOVELS_CONFIG:{readerServiceEnabled:true},
    WebNovelsAuth:{
      getActor:()=>({userId:account,reader:{id:account}}),
      api:async path=>{
        requests.push({account,path});
        if(account==='a')return new Promise(resolve=>{release=resolve;});
        return {readingHistory:[{workId:'20'}],favorites:[],subscriptions:[]};
      }
    }};
  vm.runInNewContext(source,{window,URLSearchParams,fetch:async()=>{throw Error('unexpected');}});
  const first=window.ReaderHub.activity();
  account='b';
  const second=await window.ReaderHub.activity();
  assert.equal(second.readingHistory[0].workId,'20');
  release({readingHistory:[{workId:'10'}],favorites:[],subscriptions:[]});
  await assert.rejects(first,/SESSION_CHANGED/);
  assert.equal(window.ReaderHub.cached.readingHistory[0].workId,'20');
  assert.equal(requests.length,2);
});
