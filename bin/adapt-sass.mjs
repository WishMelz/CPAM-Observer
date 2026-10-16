import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/original', import.meta.url));
for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.scss')) continue;
  const target = join(entry.parentPath, entry.name);
  const resolve = (name) => {
    const result = relative(dirname(target), join(root, 'styles', name)).replaceAll('\\', '/');
    return result.startsWith('.') ? result : './' + result;
  };
  let content = readFileSync(target, 'utf8').replaceAll(/@\/styles\/([^'";]+)/g, (_, name) => resolve(name));
  if (entry.name.endsWith('.module.scss')) {
    for (const name of ['variables', 'mixins']) {
      if (!new RegExp(`@use[^;]+/${name}(?:\\.scss)?["']`).test(content)) {
        content = `@use '${resolve(name + '.scss')}' as *;\n` + content;
      }
    }
  }
  writeFileSync(target, content);
}