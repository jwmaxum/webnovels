import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/js/shared/manuscript-document.js';
import {fromHTML} from '../src/manuscript-paste.mjs';

const M=globalThis.ManuscriptDocument;
const parse=html=>{
 const result=fromHTML(html);assert.equal(M.valid(result.document),true);
 return {...result,text:M.text(result.document)};
};

test('Word legacy alignment is preserved with emphasis and canonical paragraph fields',()=>{
 const result=parse('<p align=" CENTER "><b>가운데 제목</b></p><p align="right"><u>오른쪽</u></p>');
 assert.equal(result.text,'가운데 제목\n\n오른쪽');assert.deepEqual(result.warnings,[]);
 assert.equal(result.document.paragraphs[0].align,'center');assert.equal(result.document.paragraphs[0].runs[0].bold,true);
 assert.equal(result.document.paragraphs[1].align,'right');assert.equal(result.document.paragraphs[1].runs[0].underline,true);
});

test('nearest allowed inherited alignment reaches nested Word wrappers and plain text after a block',()=>{
 const result=parse('<div style="text-align:center"><p>제목</p><div align="right"><p>오른쪽</p></div><div>가운데 <b>강조</b></div>마지막</div>');
 assert.equal(result.text,'제목\n\n오른쪽\n\n가운데 강조\n\n마지막');
 assert.deepEqual(result.document.paragraphs.map(p=>p.align),['center','right','center','center']);
 assert.deepEqual(result.warnings,[]);
});

test('inline alignment wins legacy hints and safe CSS resets follow inheritance semantics',()=>{
 const result=parse('<div align="center"><p align="right" style="text-align:justify !important">양쪽</p><p align="right" style="text-align:inherit">상속</p><p style="text-align:unset">기본 상속</p><p style="text-align:initial">초깃값</p></div>');
 assert.deepEqual(result.document.paragraphs.map(p=>p.align),['justify','center','center','left']);
 assert.deepEqual(result.warnings,[]);
});

test('unsupported alignment warns without retaining CSS, URLs, events or execution content',()=>{
 const result=parse('<div align="center"><p align="right" style="text-align:garbage" onclick="attack()">보존</p><p align="&lt;img src=x onerror=attack()&gt;" style="text-align:url(javascript:attack())">상속</p><script>attack()</script></div>');
 assert.equal(result.text,'보존\n\n상속');assert.deepEqual(result.document.paragraphs.map(p=>p.align),['right','center']);
 assert(result.warnings.includes('지원하지 않는 문단 정렬'));assert(result.warnings.includes('이미지·링크·실행 요소'));
 assert.doesNotMatch(JSON.stringify(result.document),/attack|javascript|onclick|garbage|onerror|<img/);
});

test('partial Word numbered lists keep their explicit start and per-item continuation value',()=>{
 const result=parse('<ol start="5"><li>다섯째</li><li value="9">아홉째</li><li>열째</li></ol>');
 assert.equal(result.text,'5. 다섯째\n\n9. 아홉째\n\n10. 열째');assert.deepEqual(result.warnings,[]);
});

test('zero, signed starts and negative item values are finite visible counters',()=>{
 assert.equal(parse('<ol start="0"><li>영</li><li value="-2">마이너스 둘</li><li>마이너스 하나</li></ol>').text,'0. 영\n\n-2. 마이너스 둘\n\n-1. 마이너스 하나');
 assert.equal(parse('<ol start="+7"><li>일곱</li><li>여덟</li></ol>').text,'7. 일곱\n\n8. 여덟');
});

test('reversed lists use direct item count by default and explicit values keep countdown direction',()=>{
 assert.equal(parse('<ol reversed><li>셋</li><li>둘</li><li>하나</li></ol>').text,'3. 셋\n\n2. 둘\n\n1. 하나');
 assert.equal(parse('<ol reversed="false" start="10"><li>열</li><li value="3">셋</li><li>둘</li></ol>').text,'10. 열\n\n3. 셋\n\n2. 둘');
});

test('nested counters are independent and outer continuation is unaffected by child item values',()=>{
 const result=parse('<div align="center"><ol start="5"><li>바깥 하나<ol start="8"><li>안쪽 하나</li><li value="11">안쪽 둘</li></ol></li><li>바깥 둘</li></ol></div>');
 assert.equal(result.text,'5. 바깥 하나\n\n8. 안쪽 하나\n\n11. 안쪽 둘\n\n6. 바깥 둘');
 assert(result.document.paragraphs.every(p=>p.align==='center'));assert.deepEqual(result.warnings,[]);
});

test('malformed and excessive list numbers warn and use bounded fallback counters',()=>{
 for(const bad of ['Infinity','NaN','5oops','1e6','1000001','-1000001','9'.repeat(100)]){
  const result=parse(`<ol start="${bad}"><li>하나</li><li value="${bad}">둘</li></ol>`);
  assert.equal(result.text,'1. 하나\n\n2. 둘');assert(result.warnings.includes('지원하지 않는 목록 번호'));
 }
 assert.equal(parse('<ol start="1000000"><li>범위 끝</li><li>다음</li></ol>').text,'1000000. 범위 끝\n\n1000001. 다음');
});

test('unsupported list marker styles warn instead of silently claiming full Word fidelity',()=>{
 const result=parse('<ol type="I"><li>로마식</li><li style="list-style-type:lower-alpha">알파벳</li></ol>');
 assert.equal(result.text,'1. 로마식\n\n2. 알파벳');assert(result.warnings.includes('목록 기호 양식'));
 assert.equal(parse('<ul><li value="9">글머리</li></ul>').text,'• 글머리');
});

test('all items retain linear counters within existing paragraph and complexity limits',()=>{
 const result=parse('<ol start="50">'+'<li>항목</li>'.repeat(4096)+'</ol>');
 assert.equal(result.document.paragraphs.length,4096);assert.equal(result.document.paragraphs[0].runs[0].text,'50. 항목');assert.equal(result.document.paragraphs.at(-1).runs[0].text,'4145. 항목');
 assert.throws(()=>fromHTML('<ol>'+'<li>항목</li>'.repeat(4097)+'</ol>'),/PASTE_TOO_LARGE/);
 assert.throws(()=>fromHTML('<ol>'+'<li>항목</li>'.repeat(50001)+'</ol>'),/PASTE_TOO_COMPLEX/);
});
