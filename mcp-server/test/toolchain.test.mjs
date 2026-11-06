// vix_tool_chain tests: grep with an include filter, grep with no match,
// bash output. Needs python and rg on PATH. Usage: node test/toolchain.test.mjs
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const { handleToolChain } = await import(pathToFileURL(join(here, '..', 'dist', 'vix-tool-chain.js')));

const dir = mkdtempSync(join(tmpdir(), 'vixcc-chain-'));
writeFileSync(join(dir, 'a.py'), 'alpha\n');
writeFileSync(join(dir, 'b.js'), 'alpha\n');
process.chdir(dir);

const wf = [
  "    r = grep('alpha', include='*.py')",
  "    n = grep('nomatch_zz')",
  "    b = bash('echo hi')",
  "    return {'grep': r, 'none': n, 'bash': b}",
].join('\n');
const out = JSON.parse(await handleToolChain({ workflow: wf, description: 'test' }));
const res = out.result ?? out;
if (typeof res !== 'object' || res === null) {
  console.log('FAIL tool chain returned an error:\n' + res);
  process.exit(1);
}
let fail = 0;
const ok = (name, cond) => { if (!cond) { fail++; console.log('FAIL ' + name + '\n  ' + JSON.stringify(res)); } };
ok('grep include filters files', JSON.stringify(res.grep).includes('a.py') && !JSON.stringify(res.grep).includes('b.js'));
ok('grep no match is empty', Array.isArray(res.none) && res.none.length === 0);
ok('bash output', String(res.bash).trim() === 'hi');
console.log(`toolchain: ${3 - fail} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
