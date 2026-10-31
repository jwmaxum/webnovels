/* Uses CreatorDraftEditor snapshots. Upload bytes never enter localStorage or manuscript JSON. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id),actor=()=>window.WebNovelsAuth?.getActor()?.userId;
 const empty=()=>({schemaVersion:1,assetIds:[],thumbnailAssetId:null,credits:{writer:'',artist:'',original:''}});
 const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 let epoch=0,context=null,assets=[],files=new Map(),running=new Map(),previewDispose=null;
 const thumbnails=new Map(),thumbnailRequests=new Map(),previews=new Map();
 const enabled=()=>window.WEBNOVELS_CONFIG?.webtoonServiceEnabled===true;
 const editor=()=>window.CreatorDraftEditor;
 const same=c=>{const draft=editor()?.getFileContext();return context===c&&c.userId===actor()&&draft?.id===c.id&&draft.userId===c.userId&&String(draft.workId)===String(c.workId);};
 const busy=c=>!!c&&(c.batch||running.size>0);
 const url=(c,action='',id='')=>'/api/v2/creator/webtoon'+(action?'/'+action+'/'+id:'')+'?workId='+c.workId;
 const api=(c,action,id,options)=>{if(!same(c))throw Error('SESSION_CHANGED');return window.WebNovelsAuth.api(url(c,action,id),options);};
 const manifest=()=>editor()?.getFileContext()?.snapshot.webtoon||empty();
 const message=text=>{if($('creatorWebtoonMessage'))$('creatorWebtoonMessage').textContent=text;};
 const error=e=>({IMAGE_ORIENTATION_REQUIRED:'회전 정보를 적용한 JPEG/PNG로 다시 내보내주세요.',STATIC_IMAGE_REQUIRED:'움직이지 않는 PNG/JPEG를 선택해주세요.',IMAGE_PIXEL_LIMIT:'원본은 변당 12,000px, 1,200만 화소 이하로 나눠주세요.',FILE_TOO_LARGE:'파일 하나는 8 MiB 이하여야 합니다.',PROCESSING_BUSY:'이 파일을 처리 중입니다. 잠시 후 이어서 처리해주세요.',ASSET_CANCELLED:'업로드가 취소되었습니다. 원본 기록은 보존됩니다.',WEBTOON_NOT_ACTIVATED:'웹툰 제작 기능이 아직 활성화되지 않았습니다.',PROCESSING_LIMIT:'처리 실패가 누적되었습니다. 원본을 보관하고 운영자에게 문의해주세요.'}[e.code||e.message]||'완료된 이미지는 보존했습니다. 연결 상태를 확인하고 파일별로 재시도해주세요.');
 function invalidatePreviews(){for(const record of [...previews.values()])record.stop();previewDispose=null;}
 function revokeThumbnail(id){const value=thumbnails.get(id);if(value)URL.revokeObjectURL(value);thumbnails.delete(id);thumbnailRequests.delete(id);}
 function cacheThumbnail(id,blob){if(thumbnails.has(id))return;thumbnails.set(id,URL.createObjectURL(blob));}
 function set(m){if(!context||context.readOnly||!same(context))return;invalidatePreviews();editor().editWebtoon(m,context);draw();}
 function attach(id){const m=manifest();if(m.assetIds.includes(id))return;const selected=[...m.assetIds],asset=assets.find(a=>a.id===id);
  const next=asset?.batchId?selected.findIndex(key=>{const peer=assets.find(a=>a.id===key);return peer?.batchId===asset.batchId&&peer.queueOrder>asset.queueOrder;}):-1;
  selected.splice(next<0?selected.length:next,0,id);
  if(selected.length>100||assets.filter(a=>selected.includes(a.id)).reduce((n,a)=>n+a.bytes,0)>134217728){message('회차는 이미지 100개, 원본 합계 128 MiB까지 등록할 수 있습니다.');return;}
  set({...m,assetIds:selected,thumbnailAssetId:m.thumbnailAssetId||id});
 }
 function move(from,to){if(!context||context.readOnly||!same(context)||busy(context))return;const m=manifest(),ids=[...m.assetIds];if(!Number.isInteger(from)||from<0||from>=ids.length||to<0||to>=ids.length)return;ids.splice(to,0,ids.splice(from,1)[0]);set({...m,assetIds:ids});}
 function button(label,fn,disabled=false){const owner=context,b=node('button',label);b.type='button';b.className='btn btn-outline btn-sm studio-webtoon-controls';b.disabled=disabled;b.onclick=()=>Promise.resolve().then(()=>{if(b.disabled||owner&&!same(owner))return;return fn();}).catch(e=>{if(!owner||same(owner))message(error(e));});return b;}
 async function thumbnail(c,asset){
  if(!same(c)||thumbnails.has(asset.id)||thumbnailRequests.has(asset.id))return;
  const panel=asset.panels?.[0];if(!panel)return;const token=Symbol('thumbnail');thumbnailRequests.set(asset.id,token);draw();
  try{const blob=await window.WebNovelsAuth.api(url(c,'panel',asset.id)+'&panelId='+encodeURIComponent(panel.id)+'&format=webp',{responseType:'blob'});
   if(!same(c)||thumbnailRequests.get(asset.id)!==token||asset.state==='CANCELLED')return;cacheThumbnail(asset.id,blob);
  }catch(e){if(same(c)&&thumbnailRequests.get(asset.id)===token)message('이미지를 확인하지 못했습니다. 이미지 확인을 눌러 다시 시도해주세요.');}
  finally{if(same(c)&&thumbnailRequests.get(asset.id)===token){thumbnailRequests.delete(asset.id);draw();}}
 }
 function draw(){
  if(!context||!same(context)||!$('creatorWebtoonList'))return;const c=context,m=manifest(),list=$('creatorWebtoonList');list.replaceChildren();list.setAttribute('aria-busy',String(busy(c)));
  c.input.disabled=c.readOnly||!c.loaded||busy(c);c.sort.disabled=c.readOnly||busy(c);
  const ordered=[...m.assetIds.map(id=>assets.find(a=>a.id===id)||{id,name:'원본 정보 불러오는 중',state:'UNKNOWN'}),...assets.filter(a=>!m.assetIds.includes(a.id)&&a.state!=='CANCELLED')];
  c.summary.textContent=`회차에 포함 ${m.assetIds.length}개 · 업로드·처리 대기 ${ordered.filter(asset=>!['READY','UNKNOWN'].includes(asset.state)).length}개${busy(c)?' · 순서대로 처리 중':''}`;
  for(const [position,asset] of ordered.entries()){
   const row=node('div'),index=m.assetIds.indexOf(asset.id),number=node('span',String(position+1));row.className='webtoon-asset studio-webtoon-row';number.className='studio-webtoon-number';number.setAttribute('aria-label',(position+1)+'번째 이미지');row.append(node('strong',asset.name),number);
   const thumb=thumbnails.has(asset.id)?node('img'):node('span','미리보기 없음');thumb.className='studio-webtoon-thumb';if(thumbnails.has(asset.id)){thumb.loading='lazy';thumb.decoding='async';thumb.src=thumbnails.get(asset.id);thumb.alt='';thumb.title=asset.name;thumb.onerror=()=>{if(!same(c)||thumbnails.get(asset.id)!==thumb.src)return;revokeThumbnail(asset.id);message('이미지를 표시하지 못했습니다. 이미지 확인 또는 세로 미리보기로 다시 확인해주세요.');draw();};}row.append(thumb);
   const state=node('span',`${asset.uiFailed&&['LOCAL','PREPARED'].includes(asset.state)?'업로드 실패 · 재시도 가능':{LOCAL:'업로드 대기',PREPARED:'원본 저장 대기',UPLOADED:'이미지 처리 대기',PROCESSING:'이미지 처리 중',FAILED:'처리 실패 · 재시도 가능',READY:'완료',UNKNOWN:'정보 확인 중'}[asset.state]||'상태 확인'} · 분할 ${asset.cursor||0}/${asset.partCount||'?'}${m.thumbnailAssetId===asset.id?' · 대표 이미지':''}`);state.className='studio-webtoon-state';row.append(state);
   const locked=c.readOnly||busy(c);
   if(index>=0){
    row.draggable=!locked;row.ondragstart=e=>e.dataTransfer.setData('text/plain',asset.id);row.ondragover=e=>e.preventDefault();row.ondrop=e=>{e.preventDefault();if(!locked){const from=manifest().assetIds.indexOf(e.dataTransfer.getData('text/plain'));if(from>=0)move(from,index);}};
    row.append(button('위로',()=>move(index,index-1),locked||index===0),button('아래로',()=>move(index,index+1),locked||index===m.assetIds.length-1),
     button('대표 이미지',()=>{if(!busy(c))set({...manifest(),thumbnailAssetId:asset.id});},locked),button('회차에서 제외',()=>{if(busy(c))return;const next=manifest().assetIds.filter(id=>id!==asset.id);set({...manifest(),assetIds:next,thumbnailAssetId:manifest().thumbnailAssetId===asset.id?next[0]||null:manifest().thumbnailAssetId});},locked));
   }else if(asset.state==='READY')row.append(button('회차에 추가',()=>{if(!busy(c))attach(asset.id);},locked));
   if(['LOCAL','PREPARED'].includes(asset.state)&&(asset.uiFailed||asset.state==='PREPARED'&&!files.has(asset.id)))row.append(button(files.has(asset.id)?'업로드 재시도':'같은 원본 선택',()=>{
    if(files.has(asset.id))return process(c,asset.id);
    const input=node('input');input.type='file';input.accept='image/jpeg,image/png';input.onchange=()=>{const file=input.files[0];if(file&&same(c)&&!busy(c)){if(!['image/jpeg','image/png'].includes(file.type)||file.size>8388608){message('JPEG/PNG 파일을 각각 8 MiB 이하로 선택해주세요.');return;}files.set(asset.id,file);cacheThumbnail(asset.id,file);process(c,asset.id).catch(e=>{if(same(c))message(error(e));});}};input.click();
   },locked));
   else if(['UPLOADED','PROCESSING','FAILED'].includes(asset.state))row.append(button('이어서 처리',()=>process(c,asset.id),locked));
   if(!['READY','UNKNOWN','CANCELLED'].includes(asset.state))row.append(button('업로드 취소',async()=>{asset.cancelRequested=true;if(asset.state==='LOCAL'&&!running.has(asset.id)){asset.state='CANCELLED';files.delete(asset.id);revokeThumbnail(asset.id);draw();return;}try{await api(c,'cancel',asset.id,{method:'POST'});}catch(e){asset.cancelRequested=false;const latest=await api(c,'','');if(same(c)){Object.assign(asset,latest.assets.find(a=>a.id===asset.id)||{});draw();}throw e;}if(!same(c))return;asset.state='CANCELLED';files.delete(asset.id);revokeThumbnail(asset.id);draw();},c.readOnly));
   if(asset.state==='READY'&&!thumbnails.has(asset.id)&&asset.panels?.length)row.append(button(thumbnailRequests.has(asset.id)?'이미지 확인 중':'이미지 확인',()=>thumbnail(c,asset),thumbnailRequests.has(asset.id)));
   if(asset.state==='READY')row.append(button('원본 다운로드',async()=>{const blob=await api(c,'original',asset.id,{responseType:'blob'});if(!same(c))return;const href=URL.createObjectURL(blob),a=node('a');a.href=href;a.download=asset.name;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);}));
   for(const control of row.children)if(control.tagName==='BUTTON')control.setAttribute('aria-label',asset.name+' '+control.textContent);
   list.append(row);
  }
  window.CreatorPublications?.refreshAvailability?.();
 }
 async function process(c,id,batch=false){
  if(!same(c)||c.readOnly||running.size>0||c.batch&&!batch)return;let asset=assets.find(a=>a.id===id);if(!asset||asset.state==='CANCELLED')return;
  const token=Symbol('upload');running.set(id,token);asset.uiFailed=false;draw();
  try{
   if(['LOCAL','PREPARED'].includes(asset.state)){
    const file=files.get(id);if(!file)throw Error('FILE_REQUIRED');
    const result=await api(c,'upload',id,{method:'POST',headers:{'Content-Type':file.type,'X-File-Name':encodeURIComponent(file.name),'Idempotency-Key':id},body:file,signal:AbortSignal.timeout(60000)});
    if(!same(c)||asset.cancelRequested||asset.state==='CANCELLED')return;Object.assign(asset,result.asset);draw();
   }
   while(same(c)&&!asset.cancelRequested&&!['READY','CANCELLED'].includes(asset.state)){
    const before={state:asset.state,cursor:asset.cursor};
    const result=await api(c,'process',id,{method:'POST',signal:AbortSignal.timeout(90000)});
    if(!same(c)||asset.cancelRequested||asset.state==='CANCELLED')return;Object.assign(asset,result.asset);draw();
    if(asset.state==='FAILED'||!['READY','CANCELLED'].includes(asset.state)&&asset.state===before.state&&asset.cursor===before.cursor){message('이미지 처리가 완료되지 않았습니다. 잠시 후 이어서 처리를 눌러주세요.');break;}
   }
   if(same(c)&&!asset.cancelRequested&&asset.state==='READY'){files.delete(id);attach(id);message('이미지 처리가 완료되었습니다. 순서를 확인하고 원고를 저장하세요.');}
  }catch(e){if(same(c)&&!asset.cancelRequested&&asset.state!=='CANCELLED')asset.uiFailed=true;throw e;}
  finally{if(same(c)&&running.get(id)===token){running.delete(id);draw();}}
 }
 async function select(selected){
  const c=context;if(!c||c.readOnly||!same(c))return;if(!c.loaded||busy(c)){message('현재 이미지 목록·업로드 처리가 끝난 뒤 선택해주세요.');return;}c.batch=true;
  try{
  const queued=[],batchId=crypto.randomUUID(),included=()=>assets.filter(a=>a.state!=='CANCELLED'&&(manifest().assetIds.includes(a.id)||files.has(a.id)||running.has(a.id)));
  let bytes=included().reduce((n,a)=>n+(a.bytes||0),0);
  for(const file of selected){
   if(!same(c))return;
   if([...files.values()].includes(file)){message('이미 선택한 같은 파일은 중복으로 추가하지 않았습니다.');continue;}
   if(!['image/jpeg','image/png'].includes(file.type)||file.size>8388608){message('JPEG/PNG 파일을 각각 8 MiB 이하로 선택해주세요.');continue;}
   if(included().length>=100){message('한 회차에 이미지 100개까지 등록할 수 있습니다.');break;}
   if(bytes+file.size>134217728){message('원본 합계는 회차당 128 MiB까지입니다.');break;}bytes+=file.size;
   const id=crypto.randomUUID();files.set(id,file);cacheThumbnail(id,file);assets.push({id,name:file.name,bytes:file.size,state:'LOCAL',batchId,queueOrder:queued.length,uiFailed:false});queued.push(id);
  }
  draw();
  for(const id of queued){
   if(!same(c))return;
   const asset=assets.find(a=>a.id===id);if(asset?.state==='CANCELLED')continue;
   try{await process(c,id,true);}catch(e){if(same(c))message(error(e));}
  }
  }finally{c.batch=false;if(same(c))draw();}
 }
 function reset(){epoch++;invalidatePreviews();context=null;assets=[];files=new Map();running=new Map();for(const id of [...thumbnails.keys()])revokeThumbnail(id);thumbnailRequests.clear();if($('creatorWebtoon')){$('creatorWebtoon').replaceChildren();$('creatorWebtoon').hidden=true;}}
 async function mount(work,c,readOnly){
  reset();const text=$('newEpContent')?.closest('.creator-editor-group');if(text)text.hidden=work?.content_type==='WEBTOON';
  if(work?.content_type!=='WEBTOON')return;
  let root=$('creatorWebtoon');if(!root){root=node('section');root.id='creatorWebtoon';$('newEpContent').closest('.creator-editor-group').after(root);}root.hidden=false;
  if(!enabled()){root.textContent='웹툰 제작 기능이 준비 중입니다. 기존 원고와 이미지는 보존됩니다.';return;}
  context={userId:c.userId,workId:c.workId,id:c.id,readOnly};const current=context,turn=epoch;
  const heading=node('h3','웹툰 이미지 원고'),help=node('p','JPEG/PNG · 파일당 8 MiB · 변당 12,000px / 1,200만 화소 · 회차 100개 / 128 MiB. 원본을 보존하며 긴 이미지를 자동 분할합니다.');
  const input=node('input');input.type='file';input.multiple=true;input.accept='image/jpeg,image/png';input.disabled=true;input.setAttribute('aria-label','웹툰 이미지 여러 개 선택');input.onchange=()=>{const selected=[...input.files];input.value='';return select(selected);};
  const order=node('label','추가 순서 '),sort=node('select');for(const [value,label]of [['selection','선택 순서'],['filename','파일명 순서 (1, 2, 10)']]){const option=node('option',label);option.value=value;sort.append(option);}order.className='webtoon-upload-order';order.append(sort);
  const ordered=files=>sort.value==='filename'?[...files].sort((a,b)=>a.name.localeCompare(b.name,'ko',{numeric:true})):files;
  input.onchange=()=>{const selected=ordered([...input.files]);input.value='';return select(selected);};
  root.append(heading,help,order,input,node('p','선택한 파일을 차례대로 처리합니다. 완료 후 위·아래 버튼이나 드래그로 읽는 순서를 정하고 세로 미리보기에서 확인하세요. 독자 화면 너비에 맞춰 표시됩니다.'));root.ondragover=e=>e.preventDefault();root.ondrop=e=>{if(e.dataTransfer.files.length){e.preventDefault();select(ordered([...e.dataTransfer.files]));}};
  for(const [key,label]of [['writer','글'],['artist','그림'],['original','원작']]){const l=node('label',label+' 크레딧'),field=node('input');field.value=manifest().credits[key]||'';field.maxLength=100;field.disabled=readOnly;field.oninput=()=>{const m=manifest();set({...m,credits:{...m.credits,[key]:field.value}});};l.append(field);root.append(l);}
  const status=node('p');status.id='creatorWebtoonMessage';status.setAttribute('role','status');const summary=node('p');summary.className='studio-webtoon-summary';const list=node('div');list.id='creatorWebtoonList';root.append(status,summary,list);Object.assign(current,{input,sort,summary});
  const preview=node('div');preview.className='webtoon-preview';preview.hidden=true;
  root.append(button('세로 미리보기',async()=>{preview.hidden=false;previewDispose=await renderPreview(preview,editor().getFileContext(),()=>same(current));}),preview);
  try{const result=await api(current,'','');if(turn!==epoch||!same(current))return;assets=result.assets;current.loaded=true;input.disabled=readOnly;draw();
   if(!c.snapshot.webtoon&&c.revision!=='0')message('기존 웹툰 자료는 보존됩니다. 외부 이미지 주소는 자동으로 가져오지 않습니다. 원본 파일을 선택해 새 이미지 원고로 저장해주세요.');
  }catch(e){if(same(current)){message(error(e));root.append(button('목록 다시 불러오기',()=>mount(work,c,readOnly)));}}
 }
 async function renderPreview(root,c,valid=()=>actor()===c.userId){
  previews.get(root)?.stop();const turn=epoch,ids=[...(c.snapshot.webtoon?.assetIds||[])],signature=JSON.stringify(ids);
  const record={active:true,dispose:null,stop:null};
  const stop=()=>{if(!record.active)return;record.active=false;record.dispose?.();if(previews.get(root)===record){previews.delete(root);root.replaceChildren();}};record.stop=stop;previews.set(root,record);
  const current=()=>{const draft=editor()?.getFileContext();return record.active&&previews.get(root)===record&&turn===epoch&&valid()&&actor()===c.userId&&draft?.userId===c.userId&&draft.id===c.id&&String(draft.workId)===String(c.workId)&&JSON.stringify(draft.snapshot.webtoon?.assetIds||[])===signature;};
  if(!current()){stop();return ()=>{};}
  try{const result=await window.WebNovelsAuth.api(url(c));if(!current()){stop();return ()=>{};}
   const panels=ids.flatMap(id=>result.assets.find(a=>a.id===id&&a.state==='READY')?.panels||[]);
   record.dispose=window.ReaderWebtoon.render(root,panels,{valid:current,load:(panel,format,signal)=>window.WebNovelsAuth.api(url(c,'panel',panel.assetId)+'&panelId='+encodeURIComponent(panel.id)+'&format='+format,{responseType:'blob',signal})});return stop;
  }catch(e){stop();throw e;}
 }
 function focusUpload(){const root=$('creatorWebtoon');root?.scrollIntoView?.({block:'start'});const input=root?.querySelector?.('input[type="file"]');if(input&&!input.disabled){input.focus();input.click();}else{const text='작품을 선택하고 이미지 업로드 연결 상태를 확인해주세요.';message(text);window.showToast?.(text);}}
 window.CreatorWebtoon={empty,mount,reset,renderPreview,move,select,focusUpload,hasPending:()=>!!context&&(context.batch||files.size>0||running.size>0)};
})();
