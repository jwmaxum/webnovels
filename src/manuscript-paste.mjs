import {parseFragment} from 'parse5';

// parse5 has no DOM, networking or script execution. Project only supported Word semantics.
export function fromHTML(html) {
  if(typeof html!=='string'||html.length>2000000)throw Error('PASTE_TOO_LARGE');
  const paragraphs=[], warnings=new Set(), blocked=new Set(['script','style','iframe','object','embed','img','svg','math','link','meta','head','noscript']);
  const alignments=new Set(['left','center','right','justify']),listNumbers=new WeakMap();
  let current=null, nodes=0;
  const fresh=(align='left',indent=0)=>{current={align,indent,runs:[]};paragraphs.push(current);};
  const attribute=(node,name)=>node.attrs?.find(a=>a.name===name)?.value;
  function alignment(node,style,inherited) {
    const inline=style['text-align']?.replace(/\s*!important$/,'').trim();
    if(alignments.has(inline))return inline;
    if(inline==='inherit'||inline==='unset')return inherited;
    if(inline==='initial')return 'left';
    if(inline)warnings.add('지원하지 않는 문단 정렬');
    const legacy=attribute(node,'align')?.trim().toLowerCase();
    if(alignments.has(legacy))return legacy;
    if(legacy)warnings.add('지원하지 않는 문단 정렬');
    return inherited;
  }
  function listInteger(value,fallback) {
    if(value===undefined)return fallback;
    const raw=value.trim(),number=raw.length<=8&&/^[+-]?\d+$/.test(raw)?Number(raw):NaN;
    if(Number.isSafeInteger(number)&&Math.abs(number)<=1000000)return number;
    warnings.add('지원하지 않는 목록 번호');return fallback;
  }
  function listPrefix(node) {
    const parent=node.parentNode;
    if(parent?.tagName!=='ol')return '• ';
    if(!listNumbers.has(parent)) {
      const items=(parent.childNodes||[]).filter(child=>child.tagName==='li');
      if(items.length>50000)throw Error('PASTE_TOO_COMPLEX');
      const reversed=attribute(parent,'reversed')!==undefined,numbers=new Map();
      let number=listInteger(attribute(parent,'start'),reversed?items.length:1);
      for(const item of items){number=listInteger(attribute(item,'value'),number);numbers.set(item,number+'. ');number+=reversed?-1:1;}
      listNumbers.set(parent,numbers);
    }
    return listNumbers.get(parent).get(node);
  }
  function add(text,marks,align='left') {
    text=text.replace(/\r\n?/g,'\n').replace(/\u0000/g,'');
    if(!text)return;if(!current)fresh(align);
    const parts=text.split('\n\n');
    parts.forEach((part,i)=>{if(i)fresh(current.align,current.indent);current.runs.push({text:part,...marks});});
  }
  function walk(node,marks={},depth=0,inheritedAlign='left') {
    if(++nodes>50000||depth>80)throw Error('PASTE_TOO_COMPLEX');
    const tag=node.tagName;
    if(blocked.has(tag)){warnings.add('이미지·링크·실행 요소');return;}
    if(node.nodeName==='#text'){if(current||node.value.trim())add(node.value,marks,inheritedAlign);return;}
    const style=Object.fromEntries((node.attrs?.find(a=>a.name==='style')?.value||'').split(';').map(s=>s.split(':').map(x=>x.trim().toLowerCase())).filter(a=>a.length===2));
    const align=alignment(node,style,inheritedAlign);
    if(['ol','li'].includes(tag)&&((attribute(node,'type')||'1')!=='1'||style['list-style-type']&&style['list-style-type']!=='decimal'))warnings.add('목록 기호 양식');
    const next={...marks};
    if(style['font-weight']==='normal'||/^[1-5]00$/.test(style['font-weight']||''))delete next.bold;
    if(style['font-style']==='normal')delete next.italic;
    if(style['text-decoration']==='none')delete next.underline;
    if(['b','strong'].includes(tag)||style['font-weight']==='bold'||/^[6-9]00$/.test(style['font-weight']||''))next.bold=true;
    if(['i','em'].includes(tag)||style['font-style']==='italic')next.italic=true;
    if(tag==='u'||style['text-decoration']?.includes('underline'))next.underline=true;
    const block=['p','div','h1','h2','h3','h4','h5','h6','li','blockquote','tr'].includes(tag);
    if(block) {
      if(current&&!current.runs.length)paragraphs.pop();
      fresh(align,parseFloat(style['text-indent'])>0?1:0);
      if(tag==='li')add(listPrefix(node),next);
      if(tag==='tr')warnings.add('표의 셀 배치');
    }
    if(tag==='br')add('\n',next,align);
    else for(const child of node.childNodes||[])walk(child,next,depth+1,align);
    if(block&&current){if(!current.runs.length)current.runs.push({text:''});current=null;}
  }
  walk(parseFragment(html));
  const normalized=[];
  for(const p of paragraphs) {
    let target={...p,runs:[]};normalized.push(target);
    for(const run of p.runs)for(const char of run.text) {
      const last=target.runs.at(-1);
      if(char==='\n'&&last?.text.endsWith('\n')){last.text=last.text.slice(0,-1);target={...p,runs:[]};normalized.push(target);continue;}
      if(last&&['bold','italic','underline'].every(k=>!!last[k]===!!run[k]))last.text+=char;
      else target.runs.push({...run,text:char});
    }
  }
  const document={version:1,paragraphs:normalized.length?normalized:[{align:'left',indent:0,runs:[{text:''}]}]};
  for(const p of document.paragraphs)if(!p.runs.length)p.runs.push({text:''});
  if(!globalThis.ManuscriptDocument.valid(document))throw Error('PASTE_TOO_LARGE');
  return {document,warnings:[...warnings]};
}
globalThis.ManuscriptPaste=Object.freeze({fromHTML});
