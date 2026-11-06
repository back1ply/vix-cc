// vix brain, part 1: file access log (port of upstream LogAccess /
// access_stats.go). Runs as an async PostToolUse hook after file tools and
// appends one line per access. No dependencies, never writes to stdout, always
// exits 0 so it can't disturb the session.
//
// Log location: ${CLAUDE_PLUGIN_DATA}/brain/<project key>.jsonl, or
// <project>/.vix/access_log.jsonl when CLAUDE_PLUGIN_DATA isn't set.
// Keep logFileFor() in sync with src/brain-context.ts.
import { appendFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { join, resolve } from 'path';

const PATH_FIELDS = ['file_path', 'notebook_path', 'path'];

function normalize(p) {
  const n = resolve(p).replace(/\\/g, '/');
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

function logFileFor(projectDir) {
  const data = process.env.CLAUDE_PLUGIN_DATA;
  if (data) {
    const key = createHash('sha1').update(normalize(projectDir)).digest('hex').slice(0, 16);
    return join(data, 'brain', key + '.jsonl');
  }
  return join(projectDir, '.vix', 'access_log.jsonl');
}

function ensureDir(file) {
  const dir = join(file, '..');
  mkdirSync(dir, { recursive: true });
  // Fallback location lives inside the user's repo: keep it out of git.
  if (!process.env.CLAUDE_PLUGIN_DATA && !existsSync(join(dir, '.gitignore'))) {
    writeFileSync(join(dir, '.gitignore'), '*\n');
  }
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw);
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd;
  const toolInput = input.tool_input || {};
  const field = PATH_FIELDS.find((f) => typeof toolInput[f] === 'string' && toolInput[f]);
  if (!projectDir || !field) return;

  const abs = resolve(projectDir, toolInput[field]);
  // Only files inside the project: never remember e.g. ~/.ssh or Claude
  // Code's own saved tool results.
  const root = normalize(projectDir);
  const file = normalize(abs);
  if (!file.startsWith(root.endsWith('/') ? root : root + '/')) return;

  const log = logFileFor(projectDir);
  ensureDir(log);
  appendFileSync(log, JSON.stringify({ p: abs, t: input.tool_name || '', ts: Date.now() }) + '\n');
}

main().catch(() => {}).finally(() => process.exit(0));
