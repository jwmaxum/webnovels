/* Contenteditable adapter: canonical textarea/engine IDs and IME autosave stay intact. */
(function() {
  'use strict';
  const $=id=>document.getElementById(id);
  let currentDocument=null, enabled=false, invalid=false, composing=false, initialized=false, listening=false, savedRange=null;
  const commands=['bold','italic','underline','justifyLeft','justifyCenter','justifyRight'];
  let commandState={};
  const model=()=>window.ManuscriptDocument;
  const buttons=()=>Array.from($('creatorRichEditor')?.querySelectorAll('[data-rich-command]')||[]);
  function editable(){
    const state=window.CreatorDraftEditor?.getUiState?.();
    return enabled&&!composing&&$('creatorRichBody')?.contentEditable==='true'&&
      (!state||state.hasDraft&&!state.readOnly&&!state.composing)&&
      (window.currentActiveView==null||window.currentActiveView==='view-creator');
  }
  function ownedRange(){
    const body=$('creatorRichBody'),selection=window.getSelection?.();
    if(!selection?.rangeCount||!body?.contains(selection.anchorNode)||!body.contains(selection.focusNode))return null;
    if(!body.contains(document.activeElement)&&!(savedRange&&buttons().includes(document.activeElement)))return null;
    const range=selection.getRangeAt(0);
    return body.contains(range.startContainer)&&body.contains(range.endContainer)?range:null;
  }
  function toolbarRange(){
    const body=$('creatorRichBody'),selection=window.getSelection?.(),button=document.activeElement;
    if(!savedRange||!buttons().includes(button)||!body?.contains(savedRange.startContainer)||!body.contains(savedRange.endContainer))return null;
    if(selection?.rangeCount&&!(button.contains(selection.anchorNode)&&button.contains(selection.focusNode)))return null;
    return savedRange;
  }
  function updateToolbar(){
    const canEdit=editable(),range=canEdit?ownedRange():null;
    if(range){
      savedRange=range.cloneRange();commandState={};
      for(const command of commands)try{commandState[command]=document.queryCommandState?.(command)===true;}catch{commandState[command]=false;}
      const alignment=['justifyCenter','justifyRight','justifyLeft'].find(command=>commandState[command]);
      for(const command of ['justifyLeft','justifyCenter','justifyRight'])commandState[command]=command===alignment;
    }else if(!canEdit||!toolbarRange()){savedRange=null;commandState={};}
    for(const button of buttons()){
      button.disabled=!canEdit;
      button.setAttribute('aria-pressed',String(canEdit&&commandState[button.dataset.richCommand]===true));
    }
  }
  function watchSelection(active){
    if(active&&!listening){for(const name of ['selectionchange','focusin'])document.addEventListener(name,updateToolbar);listening=true;}
    else if(!active&&listening){for(const name of ['selectionchange','focusin'])document.removeEventListener?.(name,updateToolbar);listening=false;}
  }
  function read() {
    if(!enabled)return null;
    const result=window.ManuscriptPaste.fromHTML($('creatorRichBody').innerHTML);
    return result.document;
  }
  function sync() {
    if(!enabled||$('creatorRichBody')?.contentEditable!=='true')return;
    try{currentDocument=read();invalid=false;$('newEpContent').value=model().text(currentDocument);$('creatorRichNotice').textContent='문단·줄바꿈·강조·정렬을 저장합니다. 글꼴과 글자 크기는 독자 설정을 따릅니다.';
      $('newEpContent').dispatchEvent(new Event('input',{bubbles:true}));
    }catch{invalid=true;if(currentDocument)$('creatorRichBody').replaceChildren(...currentDocument.paragraphs.map(p=>model().paragraph(p)));$('creatorRichNotice').textContent='서식 또는 분량 한도를 넘어 방금 입력은 반영하지 못했습니다. 직전 원고는 유지됩니다. 원고를 나누어 작성해주세요.';}
    updateToolbar();
  }
  function mount(snapshot,readOnly,contentType) {
    const rich=$('creatorRichEditor'),body=$('creatorRichBody'),plain=$('newEpContent');if(!rich||!body||!plain)return;
    invalid=false;composing=false;savedRange=null;commandState={};enabled=window.WEBNOVELS_CONFIG?.authorRichTextEnabled===true&&contentType!=='WEBTOON'&&!snapshot.webtoon;
    rich.hidden=!enabled;plain.hidden=enabled;
    watchSelection(enabled&&!readOnly);
    if(!enabled){currentDocument=null;body.contentEditable='false';updateToolbar();return;}
    currentDocument=model().valid(snapshot.contentDocument,snapshot.content)?snapshot.contentDocument:model().fromText(snapshot.content);
    body.replaceChildren(...currentDocument.paragraphs.map(p=>model().paragraph(p)));body.contentEditable=String(!readOnly);
    updateToolbar();
  }
  function init() {
    const body=$('creatorRichBody');if(!body||initialized)return;initialized=true;
    body.addEventListener('input',sync);
    for(const name of ['keyup','mouseup'])body.addEventListener(name,updateToolbar);
    body.addEventListener('drop',event=>{event.preventDefault();$('creatorRichNotice').textContent='문서는 Word에서 복사한 뒤 붙여넣어주세요. 이미지는 웹툰 이미지 업로더를 이용해주세요.';});
    body.addEventListener('compositionstart',()=>{if(!editable())return;composing=true;$('newEpContent').dispatchEvent(new Event('compositionstart'));updateToolbar();});
    body.addEventListener('compositionend',()=>{if(!composing)return;composing=false;$('newEpContent').dispatchEvent(new Event('compositionend'));updateToolbar();});
    body.addEventListener('paste',event=>{
      if(!enabled||body.contentEditable!=='true')return;
      event.preventDefault();
      if(composing){$('creatorRichNotice').textContent='한글 입력을 마친 뒤 붙여넣어주세요.';return;}
      if(!editable())return;
      try {
        const html=event.clipboardData?.getData('text/html'),plain=event.clipboardData?.getData('text/plain')||'';
        const result=html?window.ManuscriptPaste.fromHTML(html):{document:model().fromText(plain),warnings:[]};
        if(!model().valid(result.document))throw Error('PASTE_TOO_LARGE');
        const selection=window.getSelection();if(!selection?.rangeCount||!body.contains(selection.anchorNode)||!body.contains(selection.focusNode))return;
        if($('newEpContent').value.length+model().text(result.document).length-selection.toString().length>200000)throw Error('PASTE_TOO_LARGE');
        const range=selection.getRangeAt(0),fragment=document.createDocumentFragment();
        for(const p of result.document.paragraphs)fragment.append(model().paragraph(p));
        const last=fragment.lastChild;range.deleteContents();range.insertNode(fragment);range.setStartAfter(last);range.collapse(true);selection.removeAllRanges();selection.addRange(range);sync();
        if(result.warnings.length)$('creatorRichNotice').textContent='본문 서식을 붙여넣었습니다. '+result.warnings.join(', ')+'는 보존되지 않습니다. 발행 전 미리보기를 확인해주세요.';
      }catch{$('creatorRichNotice').textContent='붙여넣지 못했습니다. 원본은 유지됩니다. 내용을 나누어 붙여넣어주세요.';}
    });
    $('creatorRichEditor')?.querySelectorAll('[data-rich-command]').forEach(button=>{
      button.onmousedown=e=>e.preventDefault();
      button.onclick=()=>{
        if(!editable()||!commands.includes(button.dataset.richCommand)||typeof document.execCommand!=='function')return;
        const range=ownedRange()||toolbarRange();
        if(!range){$('creatorRichNotice').textContent='서식을 적용할 본문 위치를 먼저 선택해주세요.';updateToolbar();return;}
        // Keyboard focus may move into the toolbar without losing the selected body range.
        const restored=range.cloneRange(),selection=window.getSelection();body.focus({preventScroll:true});
        selection.removeAllRanges();selection.addRange(restored);
        document.execCommand(button.dataset.richCommand,false);sync();
      };
    });
  }
  window.CreatorRichEditor={mount,assertValid:()=>{if(invalid)throw Error('INVALID_CONTENT_DOCUMENT');},snapshot:()=>enabled?{contentDocument:currentDocument}: {},focus:()=>{if(enabled)$('creatorRichBody').focus();else $('newEpContent')?.focus();}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
