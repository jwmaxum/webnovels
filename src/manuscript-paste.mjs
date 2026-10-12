import {parseFragment} from 'parse5';

// parse5 has no DOM, networking or script execution. Project only supported Word semantics.
export function fromHTML(html) {
  if(typeof html!=='string'||html.length>2000000)throw Error('PASTE_TOO_LARGE');
  const paragraphs=[], warnings=new Set(), blocked=new Set(['script','style','iframe','object','embed','img','svg','math','link','meta','head','noscript']);
  let current=null, nodes=0;
  const fresh=(align='left',indent=0)=>{current={align,indent,runs:[]};paragraphs.push(current);};
  function add(text,marks) {
    text=text.replace(/\r\n?/g,'\n').replace(/\u0000/g,'');
    if(!text)return;if(!current)fresh();
    const parts=text.split('\n\n');
    parts.forEach((part,i)=>{if(i)fresh(current.align,current.indent);current.runs.push({text:part,...marks});});
  }
  function walk(node,marks={},depth=0) {
    if(++nodes>50000||depth>80)throw Error('PASTE_TOO_COMPLEX');
    const tag=node.tagName;
    if(blocked.has(tag)){warnings.add('이미지·링크·실행 요소');return;}
    if(node.nodeName==='#text'){if(current||node.value.trim())add(node.value,marks);return;}
    const style=Object.fromEntries((node.attrs?.find(a=>a.name==='style')?.value||'').split(';').map(s=>s.split(':').map(x=>x.trim().toLowerCase())).filter(a=>a.length===2));
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
      fresh(['left','center','right','justify'].includes(style['text-align'])?style['text-align']:'left',parseFloat(style['text-indent'])>0?1:0);
      if(tag==='li')add(node.parentNode?.tagName==='ol'?(node.parentNode.childNodes.filter(n=>n.tagName==='li').indexOf(node)+1)+'. ':'• ',next);
      if(tag==='tr')warnings.add('표의 셀 배치');
    }
    if(tag==='br')add('\n',next);
    else for(const child of node.childNodes||[])walk(child,next,depth+1);
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
