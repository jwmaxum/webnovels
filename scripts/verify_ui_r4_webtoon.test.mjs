import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/js/reader/reader-webtoon.js',import.meta.url),'utf8');
const tick=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const panels=count=>Array.from({length:count},(_,index)=>({id:String(index+1),width:800,height:100,url:'/api/v2/webtoon/images/'+(index+1),fallbackUrl:'/api/v2/webtoon/images/'+(index+1)+'?format=png'}));
function fixture(){
 const frames=new Map(),events=new Map(),created=[],revoked=[];let sequence=0;
 const element=(tag='div')=>({tag,children:[],dataset:{},style:{},attributes:{},hidden:false,textContent:'',
  append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},setAttribute(key,value){this.attributes[key]=String(value);},getAttribute(key){return this.attributes[key]??null;},removeAttribute(key){delete this.attributes[key];if(key==='src')this.src='';},
  getBoundingClientRect(){const top=Number(this.dataset.panelIndex||0)*100-context.scrollY;return {top,bottom:top+100,height:100};}});
 const context=vm.createContext({Blob,AbortController,innerHeight:300,scrollY:0,
  document:{createElement:element},URL:{createObjectURL(){const url='blob:panel-'+(++sequence);created.push(url);return url;},revokeObjectURL:url=>revoked.push(url)},
  requestAnimationFrame:callback=>{frames.set(++sequence,callback);return sequence;},cancelAnimationFrame:id=>frames.delete(id),
  addEventListener:(key,callback)=>{if(!events.has(key))events.set(key,new Set());events.get(key).add(callback);},removeEventListener:(key,callback)=>events.get(key)?.delete(callback)});
 context.window=context;vm.runInContext(source,context,{filename:'reader-webtoon.js'});
 return {context,element,created,revoked,events,async flush(){const callbacks=[...frames.values()];frames.clear();callbacks.forEach(callback=>callback());await tick();},emit:key=>events.get(key)?.forEach(callback=>callback())};
}

test('panel geometry is reserved while loading and decoding; a loaded panel clears status without a completed placeholder',async()=>{
 const app=fixture(),root=app.element(),pending=gate();
 app.context.ReaderWebtoon.render(root,panels(1),{load:()=>pending.promise});
 const box=root.children[0],[image,retry,status]=box.children;
 assert.equal(box.style.aspectRatio,'800/100');assert.equal(box.style.maxWidth,'800px');assert.equal(image.width,800);assert.equal(image.height,100);
 assert.equal(retry.className,'btn btn-outline');assert.equal(retry.getAttribute('aria-label'),'1번째 이미지 다시 불러오기');assert.equal(status.className,'webtoon-panel-status');
 await app.flush();assert.equal(box.getAttribute('aria-busy'),'true');assert.match(status.textContent,/불러오는 중/);assert.equal(status.getAttribute('aria-live'),null);
 pending.resolve(new Blob(['image']));await tick();assert.match(status.textContent,/표시하는 중/);assert.equal(box.getAttribute('aria-busy'),'true');assert.equal(box.dataset.loaded,'false');
 image.onload();assert.equal(box.dataset.loaded,'true');assert.equal(box.getAttribute('aria-busy'),'false');assert.equal(status.textContent,'');assert.equal(retry.hidden,true);assert.equal(image.onerror,null);
});

test('network failure has an announced recovery message and retries only the failed panel',async()=>{
 const app=fixture(),root=app.element(),calls=[];let fail=true;
 app.context.ReaderWebtoon.render(root,panels(2),{load:async(panel,format)=>{calls.push([panel.id,format]);if(panel.id==='2'&&fail)throw Error('network');return new Blob(['image']);}});
 await app.flush();const [good,bad]=root.children;good.children[0].onload();
 assert.equal(good.dataset.loaded,'true');assert.equal(bad.getAttribute('aria-busy'),'false');assert.equal(bad.children[1].hidden,false);
 assert.match(bad.children[2].textContent,/2번째 이미지를 불러오지 못/);assert.equal(bad.children[2].getAttribute('role'),'status');assert.equal(bad.children[2].getAttribute('aria-live'),'polite');
 app.emit('scroll');await app.flush();assert.equal(calls.length,2);
 fail=false;bad.children[1].onclick();await tick();assert.deepEqual(calls,[['1','webp'],['2','webp'],['2','webp']]);assert.equal(good.dataset.loaded,'true');assert.equal(bad.getAttribute('aria-busy'),'true');
 bad.children[0].onload();assert.equal(bad.children[2].textContent,'');assert.equal(bad.children[2].getAttribute('role'),null);assert.equal(bad.getAttribute('aria-busy'),'false');
});

test('WebP decode failure falls back to PNG once and a failed PNG waits for an explicit retry',async()=>{
 const app=fixture(),root=app.element(),calls=[];
 app.context.ReaderWebtoon.render(root,panels(1),{load:async(panel,format)=>{calls.push(format);return new Blob([format]);}});await app.flush();
 const box=root.children[0],[image,retry,status]=box.children;image.onerror();await tick();
 assert.deepEqual(calls,['webp','png']);assert.equal(box.getAttribute('aria-busy'),'true');assert.equal(box.dataset.loaded,'false');assert.match(status.textContent,/표시하는 중/);
 image.onerror();assert.equal(box.getAttribute('aria-busy'),'false');assert.match(status.textContent,/표시하지 못/);assert.equal(retry.hidden,false);
 app.emit('scroll');await app.flush();assert.deepEqual(calls,['webp','png']);
 retry.onclick();await tick();assert.deepEqual(calls,['webp','png','png']);image.onload();assert.equal(box.dataset.loaded,'true');assert.equal(status.textContent,'');assert.equal(app.revoked.length,2);
});

test('HTTP 404 identifies the panel and preserves a clear labelled retry control',async()=>{
 const app=fixture(),root=app.element();
 app.context.ReaderWebtoon.render(root,panels(1),{load:async()=>{throw Object.assign(Error('unavailable'),{status:404});}});await app.flush();
 const box=root.children[0];assert.match(box.children[2].textContent,/1번째 이미지의 공개 상태/);assert.equal(box.children[1].getAttribute('aria-label'),'1번째 이미지 다시 불러오기');assert.equal(box.children[1].textContent,'이미지 다시 불러오기');assert.equal(box.getAttribute('aria-busy'),'false');
});

test('three fetches and five resident images remain bounded; eviction invalidates old decode callbacks',async()=>{
 const app=fixture(),root=app.element(),requests=[];
 app.context.ReaderWebtoon.render(root,panels(20),{load:(panel,format,signal)=>{const pending=gate();requests.push({panel,format,signal,...pending});return pending.promise;}});await app.flush();
 assert.equal(requests.length,3);assert.equal(root.children.length,20);
 requests.slice().forEach(request=>request.resolve(new Blob(['image'])));await tick();assert.equal(requests.length,5);
 requests.slice(3).forEach(request=>request.resolve(new Blob(['image'])));await tick();assert.equal(app.created.length,5);
 const oldLoad=root.children[0].children[0].onload;
 app.context.scrollY=1500;app.emit('scroll');await app.flush();assert.equal(requests.length,8);assert.equal(app.revoked.length,5);
 oldLoad();assert.equal(root.children[0].dataset.loaded,'false');assert.equal(root.children[0].getAttribute('aria-busy'),'false');assert.equal(root.children[0].children[2].textContent,'');
 requests.slice(5).forEach(request=>request.resolve(new Blob(['next'])));await tick();requests.slice(8).forEach(request=>request.resolve(new Blob(['next'])));await tick();
 assert.ok(app.created.length-app.revoked.length<=5);
});

test('session validity and reset prevent late responses, callbacks and stale retry controls from changing UI',async()=>{
 const app=fixture(),root=app.element(),pending=gate();let valid=true,calls=0;
 app.context.ReaderWebtoon.render(root,panels(1),{load:()=>{calls++;return pending.promise;},valid:()=>valid});await app.flush();
 const box=root.children[0],retry=box.children[1];valid=false;app.context.ReaderWebtoon.reset();
 const after={busy:box.getAttribute('aria-busy'),status:box.children[2].textContent,retry:retry.hidden};
 pending.reject(Error('late network failure'));await tick();retry.onclick();await tick();
 assert.deepEqual({busy:box.getAttribute('aria-busy'),status:box.children[2].textContent,retry:retry.hidden},after);assert.equal(calls,1);assert.equal(app.created.length,0);assert.equal(app.events.get('scroll').size,0);
 const next=app.element();valid=true;app.context.ReaderWebtoon.render(next,panels(1),{load:async()=>new Blob(['image']),valid:()=>valid});await app.flush();
 const callback=next.children[0].children[0].onload;app.context.ReaderWebtoon.destroy(next);callback();
 assert.equal(next.children[0].dataset.loaded,'false');assert.equal(next.children[0].children[2].textContent,'');assert.equal(next.children[0].getAttribute('aria-busy'),'false');
});

test('a failed panel evicted from the viewport keeps recovery available without an automatic network retry',async()=>{
 const app=fixture(),root=app.element();let calls=0;
 app.context.ReaderWebtoon.render(root,panels(20),{load:async()=>{calls++;throw Error('network');}});await app.flush();
 const first=root.children[0],initial=calls;assert.equal(first.children[1].hidden,false);
 app.context.scrollY=1500;app.emit('scroll');await app.flush();const afterScroll=calls;
 app.context.scrollY=0;app.emit('scroll');await app.flush();
 assert.equal(calls,afterScroll);assert.ok(afterScroll>initial);assert.equal(first.children[1].hidden,false);assert.match(first.children[2].textContent,/불러오지 못/);assert.equal(first.getAttribute('aria-busy'),'false');
});
