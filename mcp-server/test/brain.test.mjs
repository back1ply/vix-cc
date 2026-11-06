// vix brain tests: runs hooks/brain-log.mjs and dist/brain-context.mjs as the
// hooks would be run (stdin JSON, CLAUDE_PROJECT_DIR / CLAUDE_PLUGIN_DATA env).
// Usage: node test/brain.test.mjs
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, appendFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const here = dirname(fileURLToPath(import.meta.url));
const logScript = join(here, '..', '..', 'hooks', 'brain-log.mjs');
const ctxScript = join(here, '..', 'dist', 'brain-context.mjs');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name}${detail ? '\n  ' + detail : ''}`); }
};

const run = (script, input, env) =>
  spawnSync(process.execPath, [script], { input: JSON.stringify(input), env: { ...process.env, ...env }, encoding: 'utf8' });

function setup() {
  const project = mkdtempSync(join(tmpdir(), 'vixcc-brain-proj-'));
  const data = mkdtempSync(join(tmpdir(), 'vixcc-brain-data-'));
  return { project, data, env: { CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_DATA: data } };
}
const log = (env, tool, toolInput) => run(logScript, { tool_name: tool, tool_input: toolInput, cwd: env.CLAUDE_PROJECT_DIR }, env);
const context = (env) => {
  const r = run(ctxScript, { hook_event_name: 'SessionStart', source: 'startup' }, env);
  return { ...r, ctx: r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '' };
};
const logLines = (data) => {
  const dir = join(data, 'brain');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => readFileSync(join(dir, f), 'utf8').trim().split('\n').filter(Boolean));
};

// --- Logging: path fields, silence, project boundary
{
  const { project, data, env } = setup();
  const a = join(project, 'a.js');
  writeFileSync(a, 'const a = 1; // comment\n');
  const r = log(env, 'Read', { file_path: a });
  ok('logger exits 0 and prints nothing', r.status === 0 && r.stdout === '', JSON.stringify(r));
  log(env, 'mcp__plugin_vix_vix__vix_read_minified', { path: a, reason: 'x' });
  log(env, 'NotebookEdit', { notebook_path: join(project, 'n.ipynb') });
  log(env, 'Read', { file_path: join(tmpdir(), 'outside.txt') });
  log(env, 'Read', { file_path: join(project, '..', 'escape.js') });
  const lines = logLines(data);
  ok('logs file_path, path, notebook_path', lines.length === 3, lines.join('\n'));
  ok('drops files outside the project', !lines.some((l) => l.includes('outside') || l.includes('escape')), lines.join('\n'));
  ok('no .vix folder in project when plugin data is set', !existsSync(join(project, '.vix')));
  const bad = run(logScript, 'not json', env);
  ok('logger survives bad input', bad.status === 0 && bad.stdout === '');
  rmSync(project, { recursive: true, force: true }); rmSync(data, { recursive: true, force: true });
}

// --- Fallback location without CLAUDE_PLUGIN_DATA
{
  const { project } = setup();
  const env = { CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_DATA: '' };
  writeFileSync(join(project, 'f.py'), 'x = 1\n');
  log(env, 'Write', { file_path: join(project, 'f.py') });
  ok('fallback log in .vix with gitignore', existsSync(join(project, '.vix', 'access_log.jsonl')) &&
    readFileSync(join(project, '.vix', '.gitignore'), 'utf8').trim() === '*');
  ok('fallback context works', context(env).ctx.includes('## f.py'));
}

// --- Ranking, normalization, deleted files, minified content
{
  const { project, data, env } = setup();
  const files = { 'hot.js': 'function hot() {\n  return 1; // c\n}\n', 'warm.py': 'def warm():\n    return 2\n', 'gone.ts': 'x' };
  for (const [f, c] of Object.entries(files)) writeFileSync(join(project, f), c);
  for (let i = 0; i < 3; i++) log(env, 'Read', { file_path: join(project, 'hot.js') });
  // Same file spelled with forward slashes counts toward the same entry.
  log(env, 'Edit', { file_path: join(project, 'warm.py').replace(/\\/g, '/') });
  log(env, 'Read', { file_path: join(project, 'warm.py') });
  log(env, 'Read', { file_path: join(project, 'gone.ts') });
  rmSync(join(project, 'gone.ts'));
  // A torn line from concurrent appends is ignored.
  const logFile = join(data, 'brain', readdirSync(join(data, 'brain'))[0]);
  appendFileSync(logFile, '{"p": "half\n');
  const { ctx, status } = context(env);
  ok('context exits 0', status === 0);
  ok('ranked by access count', ctx.indexOf('## hot.js') > -1 && ctx.indexOf('## hot.js') < ctx.indexOf('## warm.py'), ctx);
  ok('path spellings merged', (ctx.match(/## warm\.py/g) ?? []).length === 1);
  ok('deleted files skipped', !ctx.includes('gone.ts'));
  ok('content is minified', ctx.includes('function hot(){return 1;}'), ctx);
  ok('python keeps its structure', ctx.includes('def warm():\n return 2'), ctx);
}

// --- Upstream truncation (500 -> 400 lines) and the character budget
{
  const { project, env } = setup();
  const long = Array.from({ length: 600 }, (_, i) => `line ${i}`).join('\n');
  writeFileSync(join(project, 'long.txt'), long);
  log(env, 'Read', { file_path: join(project, 'long.txt') });
  const huge = Array.from({ length: 300 }, (_, i) => `const v${i} = ${i};`).join('\n');
  mkdirSync(join(project, 'src'));
  for (let i = 0; i < 12; i++) {
    writeFileSync(join(project, 'src', `f${i}.js`), huge);
    for (let k = 0; k <= i; k++) log(env, 'Read', { file_path: join(project, 'src', `f${i}.js`) });
  }
  const { ctx } = context(env);
  ok('context under 10,000 characters', ctx.length > 0 && ctx.length < 10000, String(ctx.length));
  ok('files that do not fit are listed by path', ctx.includes('Also frequently accessed') && ctx.includes('- src/f'), ctx.slice(-400));
  ok('at most 10 files', (ctx.match(/^## |^- /gm) ?? []).length <= 10);
  ok('long.txt not in top 10 (fewest accesses)', !ctx.includes('long.txt'));

  const { project: p2, env: e2 } = setup();
  writeFileSync(join(p2, 'long.txt'), long);
  log(e2, 'Read', { file_path: join(p2, 'long.txt') });
  const c2 = context(e2).ctx;
  ok('over-500-line file shows 400 lines + marker', c2.includes('line 399\n... (truncated)') && !c2.includes('line 400\n'), c2.slice(-200));
}

// --- Empty / missing log: no output
{
  const { env } = setup();
  const r = context(env);
  ok('no log -> no output', r.status === 0 && r.stdout === '');
}

console.log(`brain: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
