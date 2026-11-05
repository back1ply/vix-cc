// Runs upstream vix's minifier golden files (internal/daemon/testdata at
// e68a25c) against our port: exact output match and idempotency, for both
// comment modes. Usage: node test/golden.test.mjs
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const fx = join(here, 'fixtures');
const m = await import(pathToFileURL(join(here, '..', 'dist', 'minifier.js')));
await m.ensureInit();

// swift is upstream-only (no compatible grammar build).
const exts = ['go', 'cpp', 'c', 'cs', 'java', 'js', 'py', 'rb', 'rs', 'php', 'sh', 'ts', 'html', 'css', 'json', 'kt'];
const modes = [['with_comments', true], ['without_comments', false]];
let pass = 0, fail = 0;
const report = (ok, name, detail = '') => {
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}${detail ? '\n' + detail : ''}`); }
};
const firstDiff = (a, b) => {
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  return `  at ${i}\n  got:  ${JSON.stringify(a.slice(Math.max(0, i - 40), i + 60))}\n  want: ${JSON.stringify(b.slice(Math.max(0, i - 40), i + 60))}`;
};

for (const [dir, keep] of modes) {
  for (const ext of exts) {
    const lang = m.detectLanguage('tmp.' + ext);
    const golden = readFileSync(join(fx, dir, 'tmp.min.' + ext), 'utf8').trim();
    const srcPath = join(fx, 'tmp.' + ext);
    if (existsSync(srcPath)) {
      const got = ((await m.minify(readFileSync(srcPath, 'utf8'), lang, keep)) ?? '<null>').trim();
      report(got === golden, `golden ${dir}/${ext}`, got === golden ? '' : firstDiff(got, golden));
    }
    const again = ((await m.minify(golden, lang, keep)) ?? '<null>').trim();
    report(again === golden, `idempotent ${dir}/${ext}`, again === golden ? '' : firstDiff(again, golden));
  }
}
console.log(`golden: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
