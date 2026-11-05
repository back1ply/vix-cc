// Edit/read tests: upstream vix edit_projected_test.go cases (e68a25c) ported
// to our tools, plus vix-cc specific checks. Usage: node test/edit.test.mjs
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const imp = (f) => import(pathToFileURL(join(dist, f)));
const m = await imp('minifier.js');
const { handleEditMinified } = await imp('vix-edit-minified.js');
const { handleReadMinified } = await imp('vix-read-minified.js');
const { handleWriteMinified } = await imp('vix-write-minified.js');
await m.ensureInit();

const dir = mkdtempSync(join(tmpdir(), 'vixcc-edit-'));
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name}${detail ? '\n  ' + detail : ''}`); }
};
const write = (name, content) => { const p = join(dir, name); writeFileSync(p, content); return p; };
const read = (p) => readFileSync(p, 'utf8');
const edit = async (p, oldS, newS, gated = true) => {
  try {
    await handleEditMinified({ path: p, old_string: oldS, new_string: newS }, new Set(gated ? [p] : []));
    return null;
  } catch (e) { return e.message; }
};

// --- projectSpan boundary snapping (upstream TestProjectSpanBoundarySnapping)
{
  const map = Int32Array.from([0, -1, 5]); // "a;b": a@0, inserted ';', b@5
  const cases = [
    ['inside-first-token', 0, 1, { start: 0, end: 1 }],
    ['full-span', 0, 3, { start: 0, end: 6 }],
    ['separator-only', 1, 2, null],
    ['snap-start-forward', 1, 3, { start: 5, end: 6 }],
    ['inside-second-token', 2, 3, { start: 5, end: 6 }],
  ];
  for (const [name, s, e, want] of cases) {
    ok(`projectSpan ${name}`, JSON.stringify(m.projectSpan(map, s, e)) === JSON.stringify(want));
  }
}

// --- Position map invariant on every fixture, both comment modes
const fixtureExts = ['cpp', 'c', 'cs', 'java', 'js', 'py', 'rb', 'rs', 'php', 'sh', 'ts', 'html', 'css', 'json', 'kt'];
for (const ext of fixtureExts) {
  const src = read(join(here, 'fixtures', 'tmp.' + ext));
  for (const keep of [true, false]) {
    const r = await m.minifyMapped(src, m.detectLanguage('tmp.' + ext), keep);
    let good = !!r;
    for (let i = 0; good && i < r.text.length; i++) {
      if (r.map[i] >= 0 && src[r.map[i]] !== r.text[i]) good = false;
    }
    ok(`map invariant ${ext} keep=${keep}`, good);
  }
}

const goSample = 'package main\n\n// Greeter returns a greeting.\nfunc Oldname() string {\n\treturn "hi"\n}\n';

// --- Rename preserves surroundings
{
  const p = write('rename.go', goSample);
  const err = await edit(p, 'Oldname', 'Newname');
  ok('rename preserves surroundings', !err && read(p) === goSample.replace('Oldname', 'Newname'), err ?? read(p));
}
// --- One-char diff
{
  const src = 'package main\n\nfunc f() int {\n\tx := 12345\n\treturn x\n}\n';
  const p = write('onechar.go', src);
  const err = await edit(p, '12345', '12340');
  ok('one-char diff', !err && read(p) === src.replace('12345', '12340'), err ?? read(p));
}
// --- Multi-token span across lines
{
  const src = 'package main\n\nfunc f() int {\n\ta := g(1,\n\t\t2)\n\tkeep := true\n\t_ = keep\n\treturn a\n}\n';
  const p = write('span.go', src);
  const err = await edit(p, 'g(1,2)', 'g(1,2,3)');
  ok('multi-token span', !err && read(p) === src.replace('g(1,\n\t\t2)', 'g(1,2,3)'), err ?? JSON.stringify(read(p)));
}
// --- Round trip A->B->A
{
  const p = write('roundtrip.go', goSample);
  const e1 = await edit(p, 'Oldname', 'Zqxwv');
  const e2 = await edit(p, 'Zqxwv', 'Oldname');
  ok('round trip', !e1 && !e2 && read(p) === goSample, e1 ?? e2 ?? '');
}
// --- Round trip on every fixture via its longest unique identifier
for (const ext of fixtureExts) {
  const src = read(join(here, 'fixtures', 'tmp.' + ext));
  const r = await m.minifyMapped(src, m.detectLanguage('tmp.' + ext));
  const words = r.text.match(/[A-Za-z0-9_]+/g) ?? [];
  let orig = '';
  for (const w of words) {
    if (w.length > orig.length && r.text.split(w).length === 2) orig = w;
  }
  if (!orig) continue;
  const p = write('rt.' + ext, src);
  const e1 = await edit(p, orig, 'Zq9RtX0');
  const e2 = await edit(p, 'Zq9RtX0', orig);
  ok(`fixture round trip ${ext} (${orig})`, !e1 && !e2 && read(p) === src, e1 ?? e2 ?? 'content changed');
}
// --- Uniqueness and not-found
{
  const p = write('dup.go', 'package main\n\nvar dup = 1\nvar other = dup\n');
  ok('ambiguous rejected', (await edit(p, 'dup', 'x'))?.includes('2 times'));
  ok('not found reported', (await edit(p, 'nonexistent', 'x'))?.includes('not found'));
}
// --- UTF-8 around multibyte content
{
  const src = 'package main\n\n// 日本語 comment\nfunc f() string { return "héllo wörld" }\n';
  const p = write('utf8.go', src);
  const err = await edit(p, 'héllo', 'hello');
  ok('utf8 splice', !err && read(p) === src.replace('héllo', 'hello'), err ?? read(p));
}
// --- Unsupported extension falls back to a literal edit
{
  const p = write('notes.txt', 'hello world\n');
  const err = await edit(p, 'hello', 'bye');
  ok('unsupported literal edit', !err && read(p) === 'bye world\n', err ?? read(p));
}
// --- vix-cc: read gate, $ literal, separator-only match
{
  const p = write('gate.js', 'const y = 1;\n');
  ok('read gate', (await edit(p, 'y', 'z', false))?.includes('not been read'));
  const q = write('dollar.js', 'const x = 1; // c\n');
  const err = await edit(q, 'const x=1;', 'const x="$&$1";');
  ok('$ written literally', !err && read(q) === 'const x="$&$1"; // c\n', err ?? read(q));
}
// --- vix-cc: CRLF file, edit inside one line keeps CRLF elsewhere
{
  const src = 'def f():\r\n    x = 1  # c\r\n    return x\r\n';
  const p = write('crlf.py', src);
  const err = await edit(p, 'x=1', 'x=2');
  ok('crlf single-line edit', !err && read(p) === src.replace('x = 1', 'x=2'), err ?? JSON.stringify(read(p)));
}
// --- vix-cc: multi-line edits adapt to the file (Python indent, CRLF)
{
  const src = 'class A:\n    def f(self):\n        x = 1\n        return x\n';
  const p = write('indent.py', src);
  const err = await edit(p, 'x=1\n  return x', 'x=1\n  y=2\n  return x+y');
  const want = 'class A:\n    def f(self):\n        x=1\n        y=2\n        return x+y\n';
  ok('python multi-line edit keeps indent unit', !err && read(p) === want, err ?? JSON.stringify(read(p)));
  const t = write('tabs.py', 'def f():\n\tif x:\n\t\ta()\n');
  const err2 = await edit(t, 'a()', 'a()\n  b()');
  ok('python tab indent', !err2 && read(t) === 'def f():\n\tif x:\n\t\ta()\n\t\tb()\n', err2 ?? JSON.stringify(read(t)));
  const h = write('help.py', 'HELP = """\n  usage: foo\n"""\n\nclass A:\n    def f(self):\n        x = 1\n');
  const err4 = await edit(h, 'x=1', 'x=1\n  y=2');
  ok('python indent ignores string lines', !err4 && read(h).endsWith('        x=1\n        y=2\n'), err4 ?? JSON.stringify(read(h)));
  const tb = write('tabstr.py', 's = """\n\tTabbed\n"""\ndef f():\n    a()\n');
  const err5 = await edit(tb, 'a()', 'a()\n b()');
  ok('python spaces despite tab in string', !err5 && read(tb).endsWith('    a()\n    b()\n'), err5 ?? JSON.stringify(read(tb)));
  const c = write('crlf.js', 'function f() {\r\n  a();\r\n  b();\r\n}\r\n');
  const err3 = await edit(c, 'a();b();', 'a();\nc();\nb();');
  ok('crlf multi-line edit', !err3 && read(c) === 'function f() {\r\n  a();\r\nc();\r\nb();\r\n}\r\n', err3 ?? JSON.stringify(read(c)));
}
// --- vix-cc: word characters don't merge across tokens
for (const [file, src, want] of [
  ['w1.js', 'function f(){ return $x }', 'return $x'],
  ['w2.js', 'const t = typeof $x;', 'typeof $x'],
  ['w3.js', 'function f(){ return élan }', 'return élan'],
  ['w4.ts', 'type E = `on${string}`;', '`on${string}`'],
]) {
  const out = await m.minify(src, m.detectLanguage(file));
  ok(`word chars ${file}`, out?.includes(want), out ?? '<null>');
}
// --- vix-cc: read output format
{
  const p = write('fmt.txt', 'a\nb\n');
  const out = await handleReadMinified({ path: p, reason: 't' }, new Set());
  ok('unsupported read is numbered', out.startsWith('    1\ta\n    2\tb'), JSON.stringify(out));
  const q = write('fmt.js', 'const a = 1; // c\nconst b = 2;\n');
  const out2 = await handleReadMinified({ path: q, reason: 't' }, new Set());
  ok('supported read is minified, unnumbered', out2 === 'const a=1;const b=2;', JSON.stringify(out2));
}

// --- vix_write_minified: creates parent dirs, plain write without formatter, marks read
{
  const p = join(dir, 'new dir', 'w.txt');
  const rf = new Set();
  const msg = await handleWriteMinified({ path: p, content: 'hi' }, rf);
  ok('write creates dirs and writes', read(p) === 'hi' && msg.startsWith('Wrote 2 bytes'), msg);
  ok('write marks file as read', rf.has(p));
}

console.log(`edit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
