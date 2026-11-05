// vix_write_minified — port of upstream VfsWrite (get-vix/vix e68a25c): write
// content given in minified form, then run the language's formatter to restore
// properly formatted source.
import { mkdir, writeFile, access } from 'fs/promises';
import { spawn } from 'child_process';
import { dirname, delimiter, join } from 'path';
import { detectLanguage } from './minifier.js';
import { withFileLock } from './file-lock.js';

export interface WriteMinifiedArgs {
  path: string;
  content: string;
  reason?: string;
}

// Formatter per language — the commands upstream's own round-trip tests use.
const FORMATTERS: Record<string, { cmd: string; args: string[] }> = {
  go: { cmd: 'gofmt', args: ['-w'] },
  c: { cmd: 'clang-format', args: ['-i'] },
  cpp: { cmd: 'clang-format', args: ['-i'] },
  rust: { cmd: 'rustfmt', args: [] },
  python: { cmd: 'black', args: ['-q'] },
  javascript: { cmd: 'prettier', args: ['--write'] },
  typescript: { cmd: 'prettier', args: ['--write'] },
  tsx: { cmd: 'prettier', args: ['--write'] },
  html: { cmd: 'prettier', args: ['--write'] },
  css: { cmd: 'prettier', args: ['--write'] },
  json: { cmd: 'prettier', args: ['--write'] },
  java: { cmd: 'google-java-format', args: ['--replace'] },
  kotlin: { cmd: 'ktfmt', args: [] },
  csharp: { cmd: 'csharpier', args: ['format'] },
  ruby: { cmd: 'rubyfmt', args: ['-i'] },
  php: { cmd: 'php-cs-fixer', args: ['fix', '--rules=@PSR12'] },
  bash: { cmd: 'shfmt', args: ['-w'] },
};

const isWindows = process.platform === 'win32';

// Find a command on PATH (with PATHEXT on Windows, where tools like prettier
// are .cmd shims that plain spawn can't run).
async function findOnPath(cmd: string): Promise<string | null> {
  const exts = isWindows ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, cmd + ext.toLowerCase());
      try {
        await access(candidate);
        return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

function quoteForCmd(arg: string): string {
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

function runFormatter(exe: string, args: string[]): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const useShell = isWindows && /\.(cmd|bat)$/i.test(exe);
    const proc = useShell
      ? spawn([exe, ...args].map(quoteForCmd).join(' '), { shell: true, stdio: ['ignore', 'ignore', 'pipe'] })
      : spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr += String(d); });
    proc.on('error', (e) => resolve({ ok: false, detail: e.message }));
    proc.on('close', (code) => resolve({ ok: code === 0, detail: `exit code ${code}${stderr.trim() ? ': ' + stderr.trim().slice(0, 300) : ''}` }));
  });
}

async function doWrite(args: WriteMinifiedArgs, readFiles: Set<string>): Promise<string> {
  const { path, content } = args;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  readFiles.add(path);

  let msg = `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${path}`;
  const lang = detectLanguage(path);
  const fmt = lang ? FORMATTERS[lang] : undefined;
  if (!fmt) return msg; // no formatter for this language: plain write (upstream fallback)

  const exe = await findOnPath(fmt.cmd);
  if (!exe) {
    return msg + `\n\nWARNING: formatter "${fmt.cmd}" not found on PATH. File is left on disk in minified form.`;
  }
  const result = await runFormatter(exe, [...fmt.args, path]);
  if (!result.ok) {
    msg += `\n\nWARNING: formatter "${fmt.cmd}" failed (${result.detail}). File is left on disk in minified form.`;
  }
  return msg;
}

export async function handleWriteMinified(args: WriteMinifiedArgs, readFiles: Set<string>): Promise<string> {
  return withFileLock(args.path, () => doWrite(args, readFiles));
}
