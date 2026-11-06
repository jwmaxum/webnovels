/* Shared manuscript renderer for owner preview and the public reader. */
(function() {
  'use strict';
  function render(body, comment, snapshot, onParagraph) {
    const text = String(snapshot?.content ?? '').replace(/\r\n?/g, '\n');
    const version = String(snapshot?.version ?? '');
    const fragment = document.createDocumentFragment();
    const formatted=window.ManuscriptDocument?.valid(snapshot?.contentDocument,text)?snapshot.contentDocument:null;
    text.split('\n\n').forEach((part, index) => {
      const paragraph = formatted?window.ManuscriptDocument.paragraph(formatted.paragraphs[index]):document.createElement('p');
      paragraph.className = 'reader-paragraph';
      paragraph.dir = 'auto';
      paragraph.dataset.paragraphIndex = String(index);
      paragraph.style.whiteSpace = 'pre-wrap';
      if (!formatted) { if (part) paragraph.textContent = part; else paragraph.append(document.createElement('br')); }
      if (onParagraph) paragraph.addEventListener('click', () => onParagraph(index, part, version));
      fragment.append(paragraph);
    });
    body.replaceChildren(fragment);
    if (comment) {
      comment.replaceChildren();
      comment.removeAttribute?.('data-i18n');
      const strong = document.createElement('strong');
      if (snapshot?.localizeReaderNote && window.ReaderI18n) window.ReaderI18n.text(strong, '작가의 말: ');
      else strong.textContent = '작가의 말: ';
      const note = document.createElement('bdi');
      note.textContent = String(snapshot?.authorComment ?? '');
      comment.append(strong, note);
    }
  }
  function mountTranslation({panel,body,heading,original,locales,load,isCurrent,onParagraph}) {
    const names={en:'English',ja:'日本語','zh-Hans':'简体中文'};
    const available=Object.keys(names).filter(locale=>locales.includes(locale));
    if(!panel||!available.length)return;
    const label=document.createElement('label'),title=document.createElement('span'),select=document.createElement('select');
    const status=document.createElement('p');status.setAttribute('role','status');status.className='small text-muted';
    const text=(element,key)=>{if(window.ReaderI18n)window.ReaderI18n.text(element,key);else element.textContent=key;};
    text(title,'본문 언어');select.className='form-control';
    for(const locale of ['original',...available]){
      const option=document.createElement('option');option.value=locale;
      if(locale==='original')text(option,'한국어 원문');else{option.lang=locale;option.textContent=names[locale];}
      select.append(option);
    }
    const originalTitle=heading?.textContent||'',originalParagraphs=original.content.replace(/\r\n?/g,'\n').split('\n\n');
    let seq=0;
    select.addEventListener('change',async()=>{
      const request=++seq,locale=select.value;
      let snapshot=original,title=originalTitle,lang='ko',message='';
      if(locale!=='original'){
        text(status,'번역을 불러오는 중입니다.');
        try {
          const translated=await load(locale);
          if(translated?.versionId!==original.version||translated.translation?.locale!==locale||
            typeof translated.translation.content!=='string')throw Error('TRANSLATION_UNAVAILABLE');
          snapshot={...original,...translated.translation};title=translated.translation.title;lang=locale;
        }catch { message='번역을 불러오지 못해 원문을 표시합니다.'; }
      }
      if(seq!==request||!isCurrent()||!panel.contains(select))return;
      if(message)select.value='original';
      const anchor=[...body.children].findIndex(node=>node.getBoundingClientRect().bottom>0);
      const top=body.children[anchor]?.getBoundingClientRect().top;
      render(body,null,snapshot,(index,_paragraph,version)=>onParagraph(index,originalParagraphs[index]||'',version));
      body.lang=lang;if(heading)heading.textContent=title;
      if(top!==undefined&&body.children[anchor])window.scrollBy(0,body.children[anchor].getBoundingClientRect().top-top);
      if(message)text(status,message);else{status.removeAttribute('data-i18n');status.textContent='';}
    });
    label.append(title,select);panel.replaceChildren(label,status);panel.hidden=false;
  }
  window.ReaderContent = Object.freeze({render,mountTranslation});
})();
