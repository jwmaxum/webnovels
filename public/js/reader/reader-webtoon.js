/* Shared vertical renderer. Reserved geometry; three fetches, at most five resident panels. */
(function(){
 'use strict';
 const instances=new Map();
 const element=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 function destroy(root){instances.get(root)?.();instances.delete(root);}
 function reset(){for(const dispose of instances.values())dispose();instances.clear();}
 function render(root,panels,{load,valid=()=>true}={}){
  destroy(root);root.replaceChildren();let stopped=false,flight=0;const queue=[],slots=[];let frame=null;
  const current=()=>!stopped&&valid();
  function release(s){s.generation++;s.controller?.abort();s.controller=null;if(s.url)URL.revokeObjectURL(s.url);s.url=null;s.img.onload=null;s.img.onerror=null;s.img.removeAttribute('src');s.loaded=false;s.decoding=false;s.box.dataset.loaded='false';}
  async function start(s){
   if(!current()||s.loading||s.loaded||s.decoding)return;s.loading=true;flight++;const generation=++s.generation;
   const live=()=>current()&&s.generation===generation;
   s.retry.hidden=true;s.controller=new AbortController();
   try{
    const blob=await load(s.panel,s.format||'webp',s.controller.signal);if(!live())return;
    if(s.url)URL.revokeObjectURL(s.url);s.url=URL.createObjectURL(blob);s.decoding=true;
    s.img.onload=()=>{if(live()){s.loaded=true;s.decoding=false;s.box.dataset.loaded='true';s.img.onload=null;}};
    s.img.onerror=()=>{if(!live())return;const fallback=s.format==='png';release(s);
     if(fallback){s.failed=true;s.retry.hidden=false;}else{s.format='png';request(s);}
    };s.img.src=s.url;
   }catch(error){if(live()&&error.name!=='AbortError'){s.failed=true;s.retry.hidden=false;s.retry.textContent=error.status===404?'공개 상태를 다시 확인해주세요':'이미지 다시 불러오기';}}
   finally{s.loading=false;flight--;if(current()&&s.wanted&&s.generation!==generation)request(s);pump();}
  }
  function pump(){while(current()&&flight<3&&queue.length){const s=queue.shift();s.queued=false;if(s.wanted&&!s.loaded&&!s.loading)start(s);}}
  function request(s){if(!s.failed&&!s.loaded&&!s.loading&&!s.decoding&&!s.queued){s.queued=true;queue.push(s);}pump();}
  function update(){frame=null;if(!current())return;
   const candidates=slots.map(s=>({s,r:s.box.getBoundingClientRect()})).filter(x=>x.r.bottom>=-800&&x.r.top<=window.innerHeight+800)
    .sort((a,b)=>Math.abs(a.r.top)-Math.abs(b.r.top)).slice(0,5);const wanted=new Set(candidates.map(x=>x.s));
   for(const s of slots){s.wanted=wanted.has(s);if(!s.wanted&&(s.url||s.controller))release(s);}
   for(const {s} of candidates)request(s);
  }
  function schedule(){if(frame==null)frame=requestAnimationFrame(update);}
  panels.forEach((panel,index)=>{
   const box=element('div'),img=element('img'),retry=element('button','이미지 다시 불러오기');
   box.className='webtoon-panel';box.dataset.panelIndex=String(index);box.dataset.loaded='false';box.style.aspectRatio=panel.width+'/'+panel.height;box.style.maxWidth=panel.width+'px';
   img.alt=(index+1)+'번째 웹툰 이미지';img.width=panel.width;img.height=panel.height;img.decoding='async';retry.type='button';retry.hidden=true;
   const s={panel,box,img,retry,url:null,generation:0,loaded:false,loading:false,queued:false,wanted:false};slots.push(s);
   retry.onclick=()=>{s.failed=false;release(s);s.wanted=true;request(s);};box.append(img,retry);root.append(box);
  });
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(schedule,{rootMargin:'800px'}):null;
  for(const s of slots)observer?.observe(s.box);
  window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);
  const dispose=()=>{stopped=true;if(frame!=null)cancelAnimationFrame(frame);observer?.disconnect();window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);slots.forEach(release);};
  instances.set(root,dispose);schedule();return dispose;
 }
 async function publicLoad(panel,format,signal){
  const path=format==='png'?panel.fallbackUrl:panel.url;
  if(typeof path!=='string'||!/^\/api\/v2\/webtoon\/images\//.test(path)||path.includes('..'))throw Error('INVALID_IMAGE_URL');
  const response=await fetch(path,{credentials:'omit',cache:'no-store',signal});if(!response.ok)throw Object.assign(Error('IMAGE_UNAVAILABLE'),{status:response.status});return response.blob();
 }
 window.ReaderWebtoon=Object.freeze({render,destroy,reset,publicLoad});
})();
