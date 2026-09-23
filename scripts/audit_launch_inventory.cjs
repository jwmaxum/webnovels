// Offline, read-only source inventory. Writes documentation only; never loads .env or contacts a service.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'docs/launch');
const report = { formatVersion: 1, limitations: ['Literal/static references only; not a runtime call graph.', 'A route declaration does not prove deployment, authorization, or DB application.', 'Duplicate names retain separate source locations.'], sources: [], adminMenus: [], creatorTabs: [], inlineEvents: [], functions: [], routes: [], dataReferences: [], oldPlanReferences: [] };
function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
}
const files = [...walk('public'), ...walk('src'), ...walk('server'), ...walk('functions'), ...walk('scripts')].filter(f => /\.(?:js|mjs|cjs|ts|html|css)$/.test(f) && f !== 'scripts/audit_launch_inventory.cjs').sort();
const lineAt = (text, pos) => text.slice(0, pos).split('\n').length;
for (const file of files) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  report.sources.push({ file, sha256: crypto.createHash('sha256').update(text).digest('hex') });
  for (const m of text.matchAll(/improve[1-6]\.md/g)) report.oldPlanReferences.push({ file, line: lineAt(text, m.index), reference: m[0] });
  if (file.endsWith('.html')) {
    for (const m of text.matchAll(/<button\b([^>]*\bdata-subtab="([^"]+)"[^>]*)>/g)) {
      report.adminMenus.push({ file, line: lineAt(text, m.index), tab: m[2], permission: m[1].match(/data-perm="([^"]+)"/)?.[1] || null });
    }
    for (const m of text.matchAll(/data-creator-tab="([^"]+)"/g)) report.creatorTabs.push({ file, line: lineAt(text, m.index), tab: m[1] });
    for (const m of text.matchAll(/\b(on(?:click|submit|change|input|keydown|keyup))="([^"]*)"/g)) report.inlineEvents.push({ file, line: lineAt(text, m.index), event: m[1], handler: m[2] });
    continue;
  }
  if (file.endsWith('.css')) continue;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const loc = node => ({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
  const literal = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
  // Keep symbol names, not chained-call argument bodies or embedded literal values.
  function expressionName(node) {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) return `${expressionName(node.expression)}.${node.name.text}`;
    if (ts.isCallExpression(node)) return `${expressionName(node.expression)}()`;
    if (ts.isElementAccessExpression(node)) return `${expressionName(node.expression)}[dynamic]`;
    if (ts.isParenthesizedExpression(node)) return expressionName(node.expression);
    return '<expression>';
  }
  function functionRecord(node) {
    if (ts.isFunctionDeclaration(node) && node.name) return { name: node.name.text, body: node.body };
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && (ts.isFunctionExpression(node.right) || ts.isArrowFunction(node.right))) return { name: node.left.getText(source), body: node.right.body };
    if (ts.isVariableDeclaration(node) && node.initializer && (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer))) return { name: node.name.getText(source), body: node.initializer.body };
    return null;
  }
  function visit(node, owner = null) {
    const definition = functionRecord(node);
    if (definition?.body) {
      owner = { ...loc(node), name: definition.name, calls: [], tables: [], rpcs: [], fetches: [] };
      report.functions.push(owner);
    }
    if (ts.isCallExpression(node)) {
      const callee = expressionName(node.expression);
      if (owner) owner.calls.push(callee);
      const first = literal(node.arguments[0]);
      if (first && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        if (['from', 'rpc'].includes(method)) {
          report.dataReferences.push({ ...loc(node), owner: owner?.name || null, kind: method, target: first });
          if (owner) owner[method === 'from' ? 'tables' : 'rpcs'].push(first);
        }
        if (/Router\.(get|post|put|patch|delete)$/.test(callee)) report.routes.push({ ...loc(node), router: node.expression.expression.getText(source), method: method.toUpperCase(), path: first, middleware: node.arguments.slice(1, -1).map(x => x.getText(source)) });
      }
      if (callee === 'fetch' && owner) owner.fetches.push(first || '<dynamic URL: inspect source>');
    }
    ts.forEachChild(node, child => visit(child, owner));
  }
  visit(source);
}
for (const f of report.functions) for (const k of ['calls', 'tables', 'rpcs', 'fetches']) f[k] = [...new Set(f[k])].sort();
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'static-inventory.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ sources: report.sources.length, adminMenus: report.adminMenus.length, creatorTabs: report.creatorTabs.length, inlineEvents: report.inlineEvents.length, functions: report.functions.length, legacyRoutes: report.routes.length, dataReferences: report.dataReferences.length, oldPlanReferences: report.oldPlanReferences.length }));
