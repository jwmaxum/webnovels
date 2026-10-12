/* Portable, bounded text format. Never accepts URLs, HTML, fonts or arbitrary CSS. */
(function(root) {
  'use strict';
  const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
  const keys=(x,allowed)=>Object.keys(x).every(k=>allowed.includes(k));
  const text=doc=>doc.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n\n');
  function valid(doc,plain) {
    if(!object(doc)||!keys(doc,['version','paragraphs'])||doc.version!==1||!Array.isArray(doc.paragraphs)||!doc.paragraphs.length||doc.paragraphs.length>4096)return false;
    let runs=0,length=0;
    for(const p of doc.paragraphs) {
      if(!object(p)||!keys(p,['align','indent','runs'])||!['left','center','right','justify'].includes(p.align)||![0,1].includes(p.indent)||!Array.isArray(p.runs)||!p.runs.length)return false;
      for(const r of p.runs) {
        if(++runs>10000||!object(r)||!keys(r,['text','bold','italic','underline'])||typeof r.text!=='string'||/\r|\n\n|\u0000/.test(r.text)||['bold','italic','underline'].some(k=>k in r&&typeof r[k]!=='boolean'))return false;
        length+=r.text.length;if(length>200000)return false;
      }
      if(p.runs.map(r=>r.text).join('').includes('\n\n'))return false;
    }
    const value=text(doc);return value.length<=200000&&(plain===undefined||value===plain);
  }
  function fromText(value) {
    return {version:1,paragraphs:String(value||'').replace(/\r\n?/g,'\n').split('\n\n').map(t=>({align:'left',indent:0,runs:[{text:t}]}))};
  }
  function paragraph(p,doc=document) {
    const node=doc.createElement('p');node.className='reader-paragraph';node.style.whiteSpace='pre-wrap';
    node.style.textAlign=p.align;if(p.indent)node.style.textIndent='1em';
    for(const r of p.runs) {
      let target=node;
      for(const [key,tag]of [['bold','strong'],['italic','em'],['underline','u']])if(r[key]){const el=doc.createElement(tag);target.append(el);target=el;}
      target.append(doc.createTextNode(r.text));
    }
    if(!p.runs.some(r=>r.text))node.append(doc.createElement('br'));
    return node;
  }
  root.ManuscriptDocument=Object.freeze({valid,text,fromText,paragraph});
})(typeof window==='undefined'?globalThis:window);
