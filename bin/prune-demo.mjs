import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';

const target = new URL('../src/original/services/api/usageService.ts', import.meta.url);
let text = readFileSync(target, 'utf8');
const source = ts.createSourceFile('usageService.ts', text, ts.ScriptTarget.Latest, true);
for (const statement of [...source.statements].reverse()) {
  const names = ts.isVariableStatement(statement)
    ? statement.declarationList.declarations.map((item) => item.name.getText(source))
    : ts.isFunctionDeclaration(statement) ? [statement.name?.text ?? ''] : [];
  if (names.some((name) => /demo/i.test(name))) {
    text = text.slice(0, statement.getFullStart()) + text.slice(statement.end);
  }
}
writeFileSync(target, text);