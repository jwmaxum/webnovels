import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parse} from 'parse5';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const languages = ['en','ko','ja','zh-Hans','ar'];
const scripts = ['reader-static-messages','reader-feature-messages','reader-shell-messages','reader-arabic-messages','reader-i18n'];

function element(attributes = {}) {
  const events = new Map();
  return {
    attributes, value: '', textContent: '',
    getAttribute: name => attributes[name],
    setAttribute(name, value) { attributes[name] = value; },
    addEventListener: (name, callback) => events.set(name, callback),
    emit: name => events.get(name)?.()
  };
}

function fixture(stored, navigator, pathname = '/') {
  const selector = element({'data-reader-locale':''}), viewerSelector = element({'data-reader-locale':''});
  const notice = element({'data-i18n':'작품을 찾을 수 없습니다.'});
  const field = element({'data-i18n-placeholder':'이메일을 입력해주세요.'});
  field.value = 'already-entered';
  const labels = [selector, viewerSelector, notice, field], events = new Map(), writes = [];
  const document = {
    documentElement: {lang:'ko'}, readyState:'complete',
    querySelectorAll: query => labels.filter(node => Object.hasOwn(node.attributes, query.slice(1, -1)))
  };
  const context = vm.createContext({document, CustomEvent, navigator, location: {pathname},
    localStorage: {getItem: () => stored, setItem: (...args) => writes.push(args), removeItem: (...args) => writes.push(args)},
    addEventListener: (name, callback) => events.set(name, callback),
    dispatchEvent: event => events.get(event.type)?.(event)
  });
  context.window = context;
  for (const file of scripts) vm.runInContext(read('public/js/core/' + file + '.js'), context);
  return {context, api:context.ReaderI18n, document, selector, viewerSelector, notice, field, writes};
}

test('all static reader bindings have five strings, preserve child controls and load before the reader', () => {
  const {context} = fixture('ko');
  const markup = parse(read('public/index.html'));
  const keys = new Set(), loaded = [], pickers = [];
  function visit(node) {
    const attrs = Object.fromEntries((node.attrs ?? []).map(({name,value})=>[name,value]));
    for (const [name, value] of Object.entries(attrs)) {
      if (!/^data-i18n(?:-(?:placeholder|aria-label|title|alt))?$/.test(name)) continue;
      keys.add(value);
      if (name === 'data-i18n') assert(!(node.childNodes ?? []).some(child=>child.tagName), value);
    }
    if (Object.hasOwn(attrs,'data-reader-locale')) pickers.push(node);
    if (node.tagName==='script' && attrs.src) loaded.push(attrs.src);
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(markup);
  assert(keys.size > 120);
  for (const key of keys) for (const language of languages) {
    const catalog = language === 'ar' ? context.ReaderArabicMessages : context.ReaderStaticMessages[language];
    assert.equal(typeof catalog[key], 'string', `${language}: ${key}`);
  }
  assert.equal(pickers.length,2);
  for (const picker of pickers) assert.deepEqual(picker.childNodes.filter(n=>n.tagName==='option').map(n=>n.attrs.find(a=>a.name==='value').value),['auto',...languages]);
  const index = file => loaded.findIndex(src=>src.includes('/'+file+'.js?v='));
  assert(index('reader-static-messages')>=0 && index('reader-static-messages')<index('reader-i18n'));
  assert(index('reader-arabic-messages')>=0 && index('reader-arabic-messages')<index('reader-i18n'));
  assert(index('reader-i18n')<index('reader'));
});

test('language change updates both controls and accessible text while preserving input', () => {
  const f=fixture('xx');
  assert.equal(f.api.locale(),'en');
  assert.equal(f.selector.value,'auto');
  for (const language of languages) {
    f.viewerSelector.value=language;f.viewerSelector.emit('change');
    assert.equal(f.selector.value,language);
    assert.equal(f.document.documentElement.lang,language);
    assert.equal(f.document.documentElement.dir,language === 'ar' ? 'rtl' : 'ltr');
    assert.equal(f.notice.textContent,f.api.t('작품을 찾을 수 없습니다.'));
    assert.equal(f.field.attributes.placeholder,f.api.t('이메일을 입력해주세요.'));
    assert.equal(f.field.value,'already-entered');
  }
  assert.equal(f.api.setLocale('en<script>'),false);
  assert.deepEqual(f.writes,languages.map(locale=>['webnovels_reader_locale',locale]));
});

test('device locale uses preference order, regional variants and English fallback', () => {
  const cases = [
    [{languages:['fr-CA','ar-SA','en-US']}, 'ar'],
    [{languages:['ko-KR','en-US']}, 'ko'],
    [{languages:['ja-JP','ar-EG']}, 'ja'],
    [{languages:[],language:'zh-TW'}, 'zh-Hans'],
    [{language:'ar-EG'}, 'ar'],
    [{languages:['fr-CA','de-DE']}, 'en'],
    [undefined, 'en']
  ];
  for (const [navigator, locale] of cases) {
    const f=fixture(null,navigator);
    assert.equal(f.api.locale(),locale);
    assert.equal(f.selector.value,'auto');
    assert.equal(f.document.documentElement.dir,locale === 'ar' ? 'rtl' : 'ltr');
    assert.deepEqual(f.writes,[]);
  }
});

test('returning to automatic rechecks device language and portals keep their direction', () => {
  const navigator={languages:['ar-SA']};
  const f=fixture('ja',navigator,'/creator/episodes');
  assert.equal(f.api.locale(),'ja');
  assert.equal(f.document.documentElement.lang,'ko');
  f.context.location.pathname='/library';
  f.api.syncDocumentLanguage('view-mypage');
  assert.equal(f.document.documentElement.lang,'ja');
  f.api.setLocale('auto');
  assert.equal(f.api.locale(),'ar');
  assert.equal(f.document.documentElement.dir,'rtl');
  assert.equal(f.viewerSelector.value,'auto');
  assert.deepEqual(f.writes,[['webnovels_reader_locale']]);
  navigator.languages=['ko-KR'];
  f.context.dispatchEvent({type:'languagechange'});
  assert.equal(f.api.locale(),'ko');
  assert.equal(f.document.documentElement.dir,'ltr');
});

test('Arabic covers existing dynamic reader messages and preserves interpolation slots', () => {
  const {context,api}=fixture('ar');
  const {ReaderShellMessages,ReaderFeatureMessages,ReaderStaticMessages,ReaderArabicMessages}=context;
  const english={...ReaderShellMessages.en,...ReaderFeatureMessages.en,...ReaderStaticMessages.en};
  const slots=value=>[...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(match=>match[1]).sort();
  assert.deepEqual(Object.keys(ReaderArabicMessages).sort(),Object.keys(english).sort());
  for (const [key,value] of Object.entries(english)) assert.deepEqual(slots(ReaderArabicMessages[key]),slots(value),key);
  assert.equal(api.t('static.login'),'تسجيل الدخول');
  assert.equal(api.t('{number}화',{number:4}),'الحلقة 4');
});

test('approved titles overlay display only, and old source values cannot reuse cached translations', () => {
  const f=fixture('ja'), original={id:'17',title:'원제',description:'원문 소개',rating:'AGE_19'};
  const approved={...original,localization:{locale:'ja',sourceLocale:'ko',title:'日本語の題名'}};
  f.api.rememberWork(approved);
  const displayed=f.api.work(original);
  assert.equal(displayed.title,'日本語の題名');
  assert.equal(displayed.titleLanguage,'ja');assert.equal(displayed.descriptionLanguage,'ko');
  assert.equal(displayed.id,'17');assert.equal(displayed.rating,'AGE_19');assert.equal(original.title,'원제');
  assert.equal(f.api.work({...original,title:'새 원제'}).title,'새 원제');
  f.api.setLocale('zh-Hans');assert.equal(f.api.work(original).title,'원제');
  f.api.setLocale('ja');f.api.rememberWork(original,'ja');assert.equal(f.api.work(original).title,'원제');
});
