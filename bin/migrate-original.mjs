import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(project, '../CPA-Manager-Plus-main/apps/web/src');
const destination = path.join(project, 'src/original');
const visited = new Set();
const packages = new Set();
const overrides = new Set(['router/MainRoutes.tsx', 'stores/useAuthStore.ts', 'hooks/usePanelFeatureAvailability.ts']);

function resolveFile(base) {
  return [base, ...['.ts', '.tsx', '.json', '.scss', '.css', '/index.ts', '/index.tsx'].map((extension) => base + extension)].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function copy(relative) {
  relative = relative.replaceAll('\\', '/');
  if (visited.has(relative)) return;
  visited.add(relative);
  if (overrides.has(relative)) return;
  const filename = path.join(source, relative);
  let text = fs.readFileSync(filename, 'utf8');
  const edits = [];
  const dependencies = [];
  if (/\.[cm]?[jt]sx?$/.test(relative)) {
    const ast = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
    function inspect(node) {
      if (ts.isIfStatement(node) && node.expression.getText(ast).includes('__DEMO_SITE__')) {
        edits.push([node.getStart(ast), node.end, node.elseStatement?.getText(ast) || '']);
        if (node.elseStatement) inspect(node.elseStatement);
        return;
      }
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        if (/features\/demo\/(demoApi|demoFixtures)$/.test(specifier)) {
          edits.push([node.getStart(ast), node.end, '']);
          return;
        }
        if (specifier.startsWith('.') || specifier.startsWith('@/')) {
          const target = resolveFile(specifier.startsWith('@/') ? path.join(source, specifier.slice(2)) : path.resolve(path.dirname(filename), specifier));
          if (!target) throw new Error(`Unresolved ${specifier} in ${relative}`);
          const child = path.relative(source, target).replaceAll('\\', '/');
          if (/\.(svg|png|jpg|jpeg|webp|gif|woff2?|ico)$/.test(target)) {
            const asset = path.join(project, 'public/original-assets', child);
            fs.mkdirSync(path.dirname(asset), { recursive: true });
            fs.copyFileSync(target, asset);
            if (ts.isImportDeclaration(node) && node.importClause?.name) edits.push([node.getStart(ast), node.end, `const ${node.importClause.name.text} = ${JSON.stringify('/original-assets/' + child)};`]);
          } else dependencies.push(child);
        } else packages.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(ast);
    for (const [start, end, replacement] of edits.sort((left, right) => right[0] - left[0])) text = text.slice(0, start) + replacement + text.slice(end);
    text = text.replaceAll('__DEMO_SITE__', 'false').replaceAll('import.meta.env.VITE_DEFAULT_CPA_BASE_URL', "''");
  } else if (/\.s?css$/.test(relative)) {
    for (const match of text.matchAll(/@(?:use|forward|import)\s+['"]([^'"]+)['"]/g)) {
      if (!match[1].startsWith('.')) continue;
      const base = path.resolve(path.dirname(filename), match[1]);
      const resolved = resolveFile(base) || resolveFile(path.join(path.dirname(base), '_' + path.basename(base)));
      if (!resolved) throw new Error(`Unresolved stylesheet ${match[1]}`);
      dependencies.push(path.relative(source, resolved));
    }
  }
  const target = path.join(destination, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
  dependencies.forEach(copy);
}

for (const entry of [
  'features/usage-analytics/UsageAnalyticsPage.tsx', 'features/monitoring/MonitoringCenterPage.tsx',
  'features/accounts/AccountsPage.tsx', 'components/layout/MainLayout.tsx',
  'app/AppLifecycle.tsx', 'styles/global.scss', 'i18n/index.ts',
  'components/common/NotificationContainer.tsx',
]) copy(entry);
console.log(JSON.stringify({ files: visited.size, dependencies: [...packages].sort() }, null, 2));