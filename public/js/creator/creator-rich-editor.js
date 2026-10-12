/* Contenteditable adapter: canonical textarea/engine IDs and IME autosave stay intact. */
(function() {
  'use strict';
  const $=id=>document.getElementById(id);
  let currentDocument=null, enabled=false, invalid=false;
  const model=()=>window.ManuscriptDocument;
  function read() {
    if(!enabled)return null;
    const result=window.ManuscriptPaste.fromHTML($('creatorRichBody').innerHTML);
    return result.document;
  }
  function sync() {
    try{currentDocument=read();invalid=false;$('newEpContent').value=model().text(currentDocument);$('creatorRichNotice').textContent='문단·줄바꿈·강조·정렬을 저장합니다. 글꼴과 글자 크기는 독자 설정을 따릅니다.';
      $('newEpContent').dispatchEvent(new Event('input',{bubbles:true}));
    }catch{invalid=true;if(currentDocument)$('creatorRichBody').replaceChildren(...currentDocument.paragraphs.map(p=>model().paragraph(p)));$('creatorRichNotice').textContent='서식 또는 분량 한도를 넘어 방금 입력은 반영하지 못했습니다. 직전 원고는 유지됩니다. 원고를 나누어 작성해주세요.';}
  }
  function mount(snapshot,readOnly,contentType) {
    const rich=$('creatorRichEditor'),body=$('creatorRichBody'),plain=$('newEpContent');if(!rich||!body||!plain)return;
    invalid=false;enabled=window.WEBNOVELS_CONFIG?.authorRichTextEnabled===true&&contentType!=='WEBTOON'&&!snapshot.webtoon;
    rich.hidden=!enabled;plain.hidden=enabled;
    if(!enabled){currentDocument=null;return;}
    currentDocument=model().valid(snapshot.contentDocument,snapshot.content)?snapshot.contentDocument:model().fromText(snapshot.content);
    body.replaceChildren(...currentDocument.paragraphs.map(p=>model().paragraph(p)));body.contentEditable=String(!readOnly);
    rich.querySelectorAll('button').forEach(b=>b.disabled=readOnly);
  }
  function init() {
    const body=$('creatorRichBody');if(!body)return;
    body.addEventListener('input',sync);
    body.addEventListener('drop',event=>{event.preventDefault();$('creatorRichNotice').textContent='문서는 Word에서 복사한 뒤 붙여넣어주세요. 이미지는 웹툰 이미지 업로더를 이용해주세요.';});
    for(const name of ['compositionstart','compositionend'])body.addEventListener(name,()=>{$('newEpContent').dispatchEvent(new Event(name));});
    body.addEventListener('paste',event=>{
      if(!enabled||body.contentEditable!=='true')return;
      event.preventDefault();
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
      button.onclick=()=>{if(!enabled||body.contentEditable!=='true')return;body.focus();document.execCommand(button.dataset.richCommand,false);sync();};
    });
  }
  window.CreatorRichEditor={mount,assertValid:()=>{if(invalid)throw Error('INVALID_CONTENT_DOCUMENT');},snapshot:()=>enabled?{contentDocument:currentDocument}: {},focus:()=>{if(enabled)$('creatorRichBody').focus();else $('newEpContent')?.focus();}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
