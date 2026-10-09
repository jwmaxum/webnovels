// Synthetic, script-free HWPX packages using Hancom's documented 2011 namespaces.
// These are format/negative-test inputs, not author manuscripts or hosted acceptance.
import {zipSync,strToU8} from 'fflate';
export const ns={section:'http://www.hancom.co.kr/hwpml/2011/section',paragraph:'http://www.hancom.co.kr/hwpml/2011/paragraph',head:'http://www.hancom.co.kr/hwpml/2011/head',opf:'http://www.idpf.org/2007/opf/',container:'urn:oasis:names:tc:opendocument:xmlns:container'};
export const paragraph=text=>'<hp:p><hp:run><hp:t>'+text+'</hp:t></hp:run></hp:p>';
export const section=body=>'<hs:sec xmlns:hs="'+ns.section+'" xmlns:hp="'+ns.paragraph+'">'+body+'</hs:sec>';
export function packageFiles({sections=[paragraph('한글 😀 &amp; “인용”')],order=sections.map((_,i)=>i),manifest='',overrides={}}={}){
 const files={mimetype:'application/hwp+zip','META-INF/container.xml':'<container xmlns="'+ns.container+'"><rootfiles><rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></rootfiles></container>',
  'Contents/header.xml':'<hh:head xmlns:hh="'+ns.head+'" secCnt="'+sections.length+'"/>',
  'Contents/content.hpf':'<opf:package xmlns:opf="'+ns.opf+'"><opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>'+sections.map((_,i)=>'<opf:item id="section'+i+'" href="Contents/section'+i+'.xml" media-type="application/xml"/>').join('')+manifest+'</opf:manifest><opf:spine><opf:itemref idref="header"/>'+order.map(i=>'<opf:itemref idref="section'+i+'"/>').join('')+'</opf:spine></opf:package>'};
 sections.forEach((body,i)=>files['Contents/section'+i+'.xml']=section(body));return {...files,...overrides};
}
export function hwpx(options={}){return zipSync(Object.fromEntries(Object.entries(packageFiles(options)).map(([name,value])=>[name,typeof value==='string'?strToU8(value):value])),{level:6});}
