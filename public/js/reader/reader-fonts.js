// Enable the existing reading stylesheet only inside the reader. This is layout,
// never an authentication gate; no URL, font choice or account data is changed.
(function(){
  'use strict';
  const watchers=new Set();
  let state='IDLE';
  const notify=value=>{state=value;for(const watcher of [...watchers])watcher(value);};
  function start(){
    if(window.currentActiveView!=='view-reader')return state;
    const link=document.getElementById('readerFontStylesheet');
    if(!link){notify('UNAVAILABLE');return state;}
    if(link.sheet&&!link.disabled){if(state!=='LOADED')notify('LOADED');return state;}
    if(['LOADING','LOADED','ERROR'].includes(state))return state;
    const loaded=()=>{cleanup();notify('LOADED');},failed=()=>{cleanup();notify('ERROR');};
    const cleanup=()=>{link.removeEventListener('load',loaded);link.removeEventListener('error',failed);};
    link.addEventListener('load',loaded);link.addEventListener('error',failed);
    state='LOADING';link.disabled=false;
    return state;
  }
  function waitForLayout(root,{valid=()=>true,signal,font}={}){
    return new Promise(resolve=>{
      let finished=false,timer=null,body=root,waiting=false;
      const finish=value=>{
        if(finished)return;finished=true;watchers.delete(changed);clearTimeout(timer);
        signal?.removeEventListener('abort',cancel);body=null;
        resolve(valid()?value:'STALE');
      };
      const cancel=()=>finish('CANCELLED');
      const changed=value=>{
        if(finished)return;if(!valid()){finish('STALE');return;}
        if(['ERROR','UNAVAILABLE'].includes(value)){finish(value);return;}
        if(value!=='LOADED'||waiting)return;waiting=true;
        try{
          // Register the rendered text's actual font use before taking fonts.ready.
          // It waits used faces/layout, not every unused declared family/weight.
          body?.getBoundingClientRect?.();
          const ready=document.fonts?.ready;
          if(!ready||typeof ready.then!=='function'){finish('UNAVAILABLE');return;}
          Promise.resolve(ready).then(()=>{
            if(finished)return;
            if(!valid()){finish('STALE');return;}
            try{const descriptor=typeof font==='function'?font():font;
              finish(descriptor&&document.fonts.check&&!document.fonts.check(descriptor,body?.textContent||'가나다')?'FALLBACK':'READY');}
            catch{finish('ERROR');}
          },()=>finish('ERROR'));
        }catch{finish('ERROR');}
      };
      if(!valid()){finish('STALE');return;}
      if(signal?.aborted){finish('CANCELLED');return;}
      signal?.addEventListener('abort',cancel,{once:true});
      timer=setTimeout(()=>finish('TIMEOUT'),3000);watchers.add(changed);
      changed(start());
    });
  }
  window.ReaderFonts=Object.freeze({start,waitForLayout,get state(){return state;}});
})();
