import path from 'node:path';
import ts from 'typescript';

export const RUNTIME_FILES = Object.freeze(['index.html', 'runtime.css', 'runtime.mjs', 'producer.html', 'producer-frame.mjs', 'producer-host.html', 'producer-host.mjs', 'adapter.mjs', 'bridge.mjs', 'protocol.mjs', 'routes.mjs', 'route-geometry.mjs', 'pathfinder.mjs', 'model-capture.mjs', 'capture-input.mjs', 'preparation-input.mjs', 'capture-evidence.mjs']);
const refuse = code => { throw new Error(code); };

/** Check only explicitly deployed first-party modules. Vendor SDK bytes retain
 * their separate pinned inventory; no import can silently extend this allowlist.
 * AST parsing deliberately ignores comments/string contents and follows literal
 * dynamic imports as well as static imports and re-exports.
 */
export async function validateRuntimeModuleClosure(files, readModule) {
  if (!Array.isArray(files) || new Set(files).size !== files.length || files.some(name => typeof name !== 'string' || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$(?![\s\S])/u.test(name) || name.split('/').some(part => part === '.' || part === '..'))) refuse('VIEWER_RUNTIME_INVALID_MODULE_INVENTORY');
  const allowed = new Set(files), modules = files.filter(name => name.endsWith('.mjs'));
  const edges = [];
  for (const name of modules) {
    const source = ts.createSourceFile(name, await readModule(name), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (source.parseDiagnostics.length) refuse('VIEWER_RUNTIME_MODULE_PARSE_FAILED');
    const dependency = specifier => {
      if ((!specifier.startsWith('./') && !specifier.startsWith('../')) || /[\\%?#:\u0000-\u0020\u007f-\u009f]/u.test(specifier)) refuse('VIEWER_RUNTIME_UNSAFE_MODULE_IMPORT');
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier));
      if (target === '..' || target.startsWith('../') || !target.endsWith('.mjs') || !allowed.has(target)) refuse('VIEWER_RUNTIME_MODULE_MISSING');
      edges.push({ source: name, target });
    };
    const visit = node => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier) {
          if (!ts.isStringLiteral(node.moduleSpecifier)) refuse('VIEWER_RUNTIME_NON_LITERAL_IMPORT');
          dependency(node.moduleSpecifier.text);
        }
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        if (!argument || !(ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) refuse('VIEWER_RUNTIME_NON_LITERAL_IMPORT');
        dependency(argument.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { moduleCount: modules.length, localImportCount: edges.length };
}
