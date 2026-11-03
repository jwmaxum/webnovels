import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parse} from 'parse5';
import {transform} from 'esbuild';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const tokens=await read('public/css/design-tokens.css'),css=await read('public/styles.css');
const declarations=s=>Object.fromEntries([...s.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m=>[m[1],m[2].trim()]));
const root=declarations(tokens);
function block(source,selector){const start=source.indexOf(selector+' {');assert(start>=0,selector);return source.slice(start+selector.length+2,source.indexOf('}',start));}
function value(key,vars=root,seen=new Set()){
  assert(!seen.has(key),'cyclic alias '+key);seen.add(key);
  const raw=vars[key]||key,m=raw.match(/^var\((--[\w-]+)\)$/);
  return m?value(m[1],vars,seen):raw;
}
function contrast(fg,bg){
  const luminance=hex=>{assert.match(hex,/^#[\da-f]{6}$/i);const [r,g,b]=hex.slice(1).match(/../g).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return r*.2126+g*.7152+b*.0722;};
  const a=luminance(fg),b=luminance(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}

test('R1 palette remains intact; readable text and control roles meet contrast thresholds',async()=>{
  const approved=declarations(await read('docs/design/ui-r1/tokens.css'));
  assert.equal(Object.keys(approved).length,47);
  for(const [key,color]of Object.entries(approved))assert.equal(root[key],color,key);
  const pairs=[['--text-primary','--bg-elevated'],['--text-secondary','--bg-base'],['--action-on-primary','--action-primary'],['--action-on-primary','--action-primary-hover'],['--color-neutral-0','--action-success'],['--text-strong','--color-primary-500'],['--selected-fg','--selected-bg'],['--text-success','--color-success-bg'],['--text-warning','--color-warning-bg'],['--text-error','--color-error-bg'],['--text-info','--color-info-bg'],['--control-fg','--control-bg']];
  for(const [fg,bg]of pairs)assert(contrast(value(fg),value(bg))>=4.5,fg+' on '+bg);
  for(const bg of ['--bg-elevated','--bg-base'])assert(contrast(value('--border-focus'),value(bg))>=3);
  assert(contrast(value('--control-border'),value('--control-bg'))>=3);
  const aliases={...root,...declarations(block(css,':root'))};
  assert(contrast(value('--accent-indigo',aliases),value('--bg-base'))>=4.5);
  assert(contrast(value('--color-neutral-0'),value('--color-primary-500'))<4.5,'bright pink is not a white-label button');
  assert.match(block(css,'.btn-primary, .btn-hero'),/background: var\(--action-primary\)/);
  assert.match(block(css,'.btn-primary, .btn-hero'),/color: var\(--action-on-primary\)/);
});

test('reader theme controls retain contrast without replacing manuscript typography',async()=>{
  for(const selector of ['#view-reader:is(.theme-dark, .theme-oled)','#view-reader.theme-sepia']){
    const scoped=declarations(block(css,selector));
    assert(contrast(scoped['--control-fg'],scoped['--control-bg'])>=4.5,selector);
    assert(contrast(scoped['--control-border'],scoped['--control-bg'])>=3,selector);
  }
  const dark=declarations(block(css,'#view-reader:is(.theme-dark, .theme-oled)'));
  for(const state of ['success','warning','error','info'])assert(contrast(dark['--text-'+state],dark['--color-'+state+'-bg'])>=4.5,state);
  assert(contrast(dark['--selected-fg'],dark['--selected-bg'])>=4.5);
  assert.match(block(css,'.btn-icon:hover'),/background: var\(--selected-bg\)/);
  assert.match(block(css,'.btn-icon:hover'),/color: var\(--selected-fg\)/);
  assert.doesNotMatch(css,/#view-reader:is\(\.theme-dark, \.theme-oled\) \.btn-primary\s*\{/);
  const paper=block(css,'.reader-paper');
  assert.match(paper,/font-family: var\(--reader-font, var\(--font-reader\)\)/);
  assert.match(paper,/font-size: var\(--reader-font-size, 18px\)/);
  assert.match(block(css,'.creator-rich-body'),/font-size:18px;line-height:1.9/);
  assert.match(block(css,'.theme-btn.theme-oled'),/background: #000000 !important/);
  const reader=await read('public/js/reader/reader.js');
  assert.match(reader,/paper\.style\.fontFamily = fontValue/);
  assert.match(reader,/paper\.style\.fontSize = `\$\{this\.pref\.fontSize\}px`/);
});

test('entry points load pinned local UI fonts before legacy styles and preserve reader fonts',async()=>{
  const paths=['public/index.html','public/company/index.html','public/policies/terms/index.html','public/policies/refund/index.html'];
  for(const path of paths){
    const html=await read(path),nodes=[];
    const visit=n=>{if(n.tagName)nodes.push(n);for(const child of n.childNodes||[])visit(child);};visit(parse(html));
    const links=nodes.filter(n=>n.tagName==='link').map(n=>Object.fromEntries(n.attrs.map(a=>[a.name,a.value])));
    const styleLinks=links.filter(l=>l.rel==='stylesheet');
    const index=styleLinks.findIndex(l=>l.href.startsWith('/css/design-tokens.css?'));
    assert(index>=0,path);assert(index<styleLinks.findIndex(l=>/^\/(styles\.css|css\/policies\.css)/.test(l.href)),path);
    assert(links.some(l=>l.rel==='preload'&&l.as==='font'&&'crossorigin'in l&&l.href==='/fonts/suit-v2.0.5/SUIT-Variable.woff2'),path);
    for(const l of styleLinks.filter(l=>l.href.startsWith('/')))await readFile(new URL('../public'+l.href.split('?')[0],import.meta.url));
  }
  const main=await read(paths[0]);assert.match(main,/family=Noto\+Sans\+KR/);assert.match(main,/family=Noto\+Serif\+KR/);assert.doesNotMatch(main,/family=(?:Outfit|Pretendard)/);
  assert.match(tokens,/font-display: swap/);assert.doesNotMatch(tokens,/@import|https?:\/\//);
  const font=await readFile(new URL('../public/fonts/suit-v2.0.5/SUIT-Variable.woff2',import.meta.url));
  assert.equal(font.length,624536);assert.equal(createHash('sha256').update(font).digest('hex'),'aa894a204d5a6fbae259dac6868d350cbd373a390caee0313f92946af741df23');
  assert.match(await read('public/fonts/suit-v2.0.5/SUIT-LICENSE.txt'),/SIL OPEN FONT LICENSE/);
});

test('CSS parses and component state styling preserves hidden and image contracts',async()=>{
  for(const path of ['public/styles.css','public/css/design-tokens.css','public/css/free-beta.css','public/css/beta-operations.css','public/css/webtoon.css','public/css/growth.css','public/css/policies.css']){
    const result=await transform(await read(path),{loader:'css'});assert.equal(result.warnings.length,0,path+': '+result.warnings.map(w=>w.text).join(','));
  }
  assert.match(block(css,'.btn'),/min-height: 44px/);
  assert.doesNotMatch(block(css,'.btn:disabled, .btn[aria-disabled="true"]'),/display\s*:/);
  assert.match(block(css,'.filter-chip.active'),/text-decoration: underline/);
  assert.match(css,/:focus-visible\s*\{\s*outline: 3px solid var\(--border-focus\)/);
  assert.doesNotMatch(css,/outline:\s*none\s*!important/);
  assert.doesNotMatch(block(css,'.admin-input:focus'),/outline:\s*none/);
  assert.match(css,/\.modal-backdrop\[hidden\]\s*\{\s*display:\s*none !important/);
  assert.match(css,/\.studio-action-bar \[hidden\]\{display:none!important/);
  assert.match(await read('public/css/free-beta.css'),/data-beta-unavailable[^\n]+display:none!important/);
  assert.match(block(css,'.webtoon-cut img'),/height: auto/);
  assert.match(await read('public/css/webtoon.css'),/object-fit:contain/);
  assert.match(block(css,'.cdg-card-cover'),/aspect-ratio: 2 \/ 3/);
});

test('live status templates use readable colors and the reader asset version changes with them',async()=>{
  const reader=await read('public/js/reader/reader.js');
  assert.match(reader,/class="badge-status completed">완결/);
  assert.doesNotMatch(reader,/style\.color = '#(?:ef4444|10b981)'/);
  assert.match(reader,/style\.color = 'var\(--text-error\)'/);
  assert.match(reader,/style\.color = 'var\(--text-success\)'/);
  assert.match(await read('public/index.html'),/reader\/reader\.js\?v=20261103op13"/);
});
