// Build the shippable plugin runtime (no npm install needed at run time):
// - grammars/: the Tree-sitter .wasm files the minifier loads, plus
//   web-tree-sitter's own runtime .wasm, each with its package LICENSE
// - dist/server.mjs: src/index.ts and all its npm dependencies in one file
// Run after tsc (see "build" in package.json).
import { build } from 'esbuild';
import { chmodSync, copyFileSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'grammars');

// [package, wasm file inside the package]
const WASM = [
  ['web-tree-sitter', 'web-tree-sitter.wasm'],
  ['tree-sitter-javascript', 'tree-sitter-javascript.wasm'],
  ['tree-sitter-typescript', 'tree-sitter-typescript.wasm'],
  ['tree-sitter-typescript', 'tree-sitter-tsx.wasm'],
  ['tree-sitter-python', 'tree-sitter-python.wasm'],
  ['tree-sitter-go', 'tree-sitter-go.wasm'],
  ['tree-sitter-rust', 'tree-sitter-rust.wasm'],
  ['tree-sitter-c', 'tree-sitter-c.wasm'],
  ['tree-sitter-cpp', 'tree-sitter-cpp.wasm'],
  ['tree-sitter-java', 'tree-sitter-java.wasm'],
  ['tree-sitter-c-sharp', 'tree-sitter-c_sharp.wasm'],
  ['@tree-sitter-grammars/tree-sitter-kotlin', 'tree-sitter-kotlin.wasm'],
  ['tree-sitter-php', 'tree-sitter-php.wasm'],
  ['tree-sitter-ruby', 'tree-sitter-ruby.wasm'],
  ['tree-sitter-json', 'tree-sitter-json.wasm'],
  ['tree-sitter-css', 'tree-sitter-css.wasm'],
  ['tree-sitter-html', 'tree-sitter-html.wasm'],
  ['tree-sitter-bash', 'tree-sitter-bash.wasm'],
];

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'licenses'), { recursive: true });
// Copy with a fixed, non-executable mode: some packages ship files marked
// executable on Linux, which would make CI's "grammars up to date" check fail.
const copy = (from, to) => {
  copyFileSync(from, to);
  chmodSync(to, 0o644);
};
for (const [pkg, file] of WASM) {
  copy(join(nm, pkg, file), join(out, file));
  copy(join(nm, pkg, 'LICENSE'), join(out, 'licenses', pkg.replace('/', '__') + '.LICENSE'));
}

await build({
  entryPoints: [join(root, 'src', 'index.ts')],
  outfile: join(root, 'dist', 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  legalComments: 'eof',
  // CommonJS dependencies inside an ESM bundle need a real require().
  banner: { js: "import { createRequire as __vixCreateRequire } from 'module'; const require = __vixCreateRequire(import.meta.url);" },
  logLevel: 'warning',
});
console.log(`[bundle] grammars/ (${WASM.length} wasm) and dist/server.mjs written`);
