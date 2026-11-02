import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'parse5';
import {transform} from 'esbuild';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const [html, css, loader] = await Promise.all([
  'public/index.html', 'public/css/admin-shell.css', 'public/js/core/role-modules.js'
].map(read));
const attr = (node, key) => node?.attrs?.find(item => item.name === key)?.value;
const text = node => (node?.childNodes || []).map(child => child.value || text(child)).join('');
const hasClass = (node, name) => (attr(node, 'class') || '').split(/\s+/).includes(name);
const inside = (node, parent) => {
  for (let at = node; at; at = at.parentNode) if (at === parent) return true;
  return false;
};
const errors = [], document = parse(html, {onParseError: error => errors.push(error)}), nodes = [];
function walk(node) {
  if (node.tagName) nodes.push(node);
  for (const child of node.childNodes || []) walk(child);
}
walk(document);
const byId = id => nodes.find(node => attr(node, 'id') === id);
const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(match => ({selector: match[1].trim(), body: match[2]}));
const ruleFor = (selector, declaration) => rules.some(rule => rule.selector === selector && declaration.test(rule.body));

test('OP-01 stylesheet parses and cannot restyle reader, author or account surfaces', async () => {
  const parsed = await transform(css, {loader: 'css'});
  assert.deepEqual(parsed.warnings, []);
  assert(rules.length > 30);
  for (const rule of rules) {
    assert(rule.selector.startsWith('#view-admin-cms '), 'unscoped selector: ' + rule.selector);
  }
  assert.doesNotMatch(clean, /@import|url\s*\(|@font-face|animation\s*:|position\s*:\s*fixed/i);
  assert.doesNotMatch(clean, /#(?:[a-f\d]{3}){1,2}\b|rgba?\(/i, 'use existing theme roles');
  assert(ruleFor('#view-admin-cms #adminOperationsShell [hidden]', /display:\s*none\s*!important/), 'permission-hidden surfaces stay hidden');
  for (const token of ['text-primary', 'text-secondary', 'text-strong', 'selected-bg', 'selected-fg', 'border-focus']) {
    assert(css.includes('var(--' + token + ')'), 'missing theme role ' + token);
  }
});

test('OP-01 navigation and search retain touch targets and visible keyboard focus', () => {
  assert(ruleFor('#view-admin-cms #adminOperationsNav.admin-primary-nav :is(a, button)', /min-height:\s*48px/));
  assert(ruleFor('#view-admin-cms .admin-section-tabs :is(a, button)', /min-height:\s*44px/));
  assert(ruleFor('#view-admin-cms .admin-global-search :is(input, select)', /min-height:\s*44px/));
  assert(ruleFor('#view-admin-cms .admin-global-search button', /min-height:\s*44px/));
  assert(ruleFor('#view-admin-cms .admin-tool-links summary', /display:\s*list-item/), 'native disclosure marker remains visible');
  const focus = rules.filter(rule => rule.selector.endsWith(':focus-visible'));
  assert(focus.some(rule => rule.selector.includes('.admin-primary-nav') && rule.selector.includes('.admin-global-search')));
  assert(focus.some(rule => rule.selector === '#view-admin-cms .admin-overview-card:focus-visible'));
  for (const rule of focus) {
    assert.match(rule.body, /outline:\s*3px solid var\(--border-focus\)/);
    assert.match(rule.body, /outline-offset:\s*3px/);
  }
});

test('OP-01 mobile navigation wraps and the workspace can shrink without hiding content', () => {
  assert(ruleFor('#view-admin-cms .admin-workspace', /min-width:\s*0/));
  assert(ruleFor('#view-admin-cms .admin-section-tabs', /flex-wrap:\s*wrap/));
  assert(ruleFor('#view-admin-cms .admin-section-tabs :is(a, button)', /white-space:\s*normal/));
  assert(ruleFor('#view-admin-cms .admin-global-search :is(input, select)', /min-width:\s*0/));
  assert.match(css, /@media\s*\(max-width:\s*1000px\)\s*\{[\s\S]*?#adminOperationsNav\.admin-primary-nav\s*\{[^}]*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  const mobile = css.slice(css.indexOf('@media (max-width: 600px)'));
  assert.match(mobile, /#adminOperationsNav\.admin-primary-nav\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(mobile, /\.admin-global-search\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(mobile, /\.admin-overview-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(clean, /overflow(?:-x)?\s*:\s*hidden|white-space\s*:\s*nowrap/);
});

test('OP-01 shipped shell preserves legacy work regions and labelled native navigation', () => {
  assert.deepEqual(errors, []);
  const ids = nodes.map(node => attr(node, 'id')).filter(Boolean);
  assert.equal(ids.length, new Set(ids).size, 'duplicate DOM ID');
  const view = byId('view-admin-cms'), shell = byId('adminOperationsShell'), content = byId('adminOperationsContent');
  assert(inside(shell, view));
  assert.notEqual(attr(shell, 'hidden'), undefined, 'authentication reveals the shell');
  assert(inside(content, shell));
  assert.equal(attr(content, 'role'), 'region');
  assert.equal(attr(content, 'tabindex'), '-1');
  assert(attr(content, 'aria-label') || attr(content, 'aria-labelledby'));
  const workspace = nodes.find(node => hasClass(node, 'admin-workspace') && inside(content, node));
  assert(workspace, 'new wrapper must retain the original content region');
  for (const id of ['adminOperationsNav', 'adminSectionTabs', 'adminBreadcrumbs']) {
    const nav = byId(id);
    assert(inside(nav, shell), id);
    assert.equal(nav.tagName, 'nav', id + ' uses native navigation');
    assert(attr(nav, 'aria-label') || attr(nav, 'aria-labelledby'), id + ' needs a navigation label');
    assert.notEqual(attr(nav, 'role'), 'tablist', 'ordinary destinations do not require custom tab keyboard behavior');
  }
  assert(hasClass(byId('adminOperationsNav'), 'admin-primary-nav'));
  assert(hasClass(byId('adminSectionTabs'), 'admin-section-tabs'));
  assert.equal(byId('adminWorkspaceHeading')?.tagName, 'h2');
  assert(inside(byId('adminWorkspaceHeading'), workspace));
  assert(inside(byId('adminWorkspaceDescription'), workspace));
});

test('OP-01 menu finder is a labelled native form outside domain forms', () => {
  const form = byId('adminGlobalSearch'), input = byId('adminGlobalSearchInput');
  assert.equal(form?.tagName, 'form');
  assert(hasClass(form, 'admin-global-search'));
  assert(inside(form, byId('adminOperationsShell')));
  assert(inside(input, form));
  assert.equal(input.tagName, 'input');
  assert.equal(attr(input, 'type'), 'search');
  const label = nodes.find(node => node.tagName === 'label' && attr(node, 'for') === 'adminGlobalSearchInput');
  assert(inside(label, form));
  assert.match(text(label), /메뉴·업무 찾기/);
  assert(nodes.some(node => node.tagName === 'button' && attr(node, 'type') === 'submit' && inside(node, form)));
  const results = byId('adminGlobalSearchResults');
  assert(hasClass(results, 'admin-search-results'));
  assert(inside(results, byId('adminOperationsShell')));
  assert.notEqual(attr(results, 'hidden'), undefined, 'results remain hidden until a menu search');
  for (const item of nodes.filter(node => node.tagName === 'form')) {
    assert(!nodes.some(parent => parent !== item && parent.tagName === 'form' && inside(item, parent)), 'nested form');
  }
});

test('OP-01 assets are versioned and load after their existing compatibility dependencies', async () => {
  const styles = nodes.filter(node => node.tagName === 'link').map(node => attr(node, 'href')).filter(Boolean);
  const originalStyle = styles.findIndex(href => href.startsWith('/css/operations-account.css?'));
  const shellStyle = styles.indexOf('/css/admin-shell.css?v=20261101op01');
  assert(originalStyle >= 0 && shellStyle > originalStyle, 'shell overrides load after the operations stylesheet');
  const navigation = '/js/admin/admin-navigation.js?v=20261101op02';
  const operations = '/js/admin/admin-operations.js?v=20261102op10';
  assert(loader.includes(navigation) && loader.includes(operations));
  assert(loader.indexOf(navigation) < loader.indexOf(operations), 'navigation model must exist before admin operations');
  for (const asset of [navigation, operations]) await read('public' + asset.split('?')[0]);
  assert(nodes.some(node => node.tagName === 'script' && attr(node, 'src') === '/js/core/role-modules.js?v=20261102op12'));
});
