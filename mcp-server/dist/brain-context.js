// vix brain, part 2: "Frequently Accessed Files" (port of upstream
// frequentlyAccessedFilesText / doGetTopFiles). Runs as a SessionStart hook:
// ranks the files logged by hooks/brain-log.mjs and returns the top ones as
// additionalContext.
//
// Differences from upstream:
// - Claude Code caps hook context at 10,000 characters (larger output is saved
//   to a file and replaced by a pointer), so contents are minified and packed
//   into BUDGET characters; files that don't fit are listed by path.
// - Paths are shown relative to the project.
//
// Never fails the session: any error means no output.
import { readFileSync, existsSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { join, resolve, relative } from 'path';
import { detectLanguage, ensureInit, minify } from './minifier.js';
const TOP_N = 10; // upstream count
const BUDGET = 9000; // characters, under Claude Code's 10,000 cap
const MAX_FILE_BYTES = 1024 * 1024;
export function normalize(p) {
    const n = resolve(p).replace(/\\/g, '/');
    return process.platform === 'win32' ? n.toLowerCase() : n;
}
// Keep in sync with hooks/brain-log.mjs.
export function logFileFor(projectDir) {
    const data = process.env.CLAUDE_PLUGIN_DATA;
    if (data) {
        const key = createHash('sha1').update(normalize(projectDir)).digest('hex').slice(0, 16);
        return join(data, 'brain', key + '.jsonl');
    }
    return join(projectDir, '.vix', 'access_log.jsonl');
}
export function rankFiles(logText, projectDir) {
    const root = normalize(projectDir);
    const prefix = root.endsWith('/') ? root : root + '/';
    const byKey = new Map();
    for (const line of logText.split('\n')) {
        if (!line.trim())
            continue;
        let e;
        try {
            e = JSON.parse(line);
        }
        catch {
            continue;
        } // skip torn/garbled lines
        if (typeof e.p !== 'string')
            continue;
        const key = normalize(e.p);
        if (!key.startsWith(prefix))
            continue;
        const ts = typeof e.ts === 'number' ? e.ts : 0;
        const r = byKey.get(key);
        if (r) {
            r.count++;
            if (ts >= r.last) {
                r.last = ts;
                r.path = e.p;
            }
        }
        else {
            byKey.set(key, { path: e.p, count: 1, last: ts });
        }
    }
    return [...byKey.values()].sort((a, b) => b.count - a.count || b.last - a.last);
}
// Upstream readFileForTopFiles: files over 500 lines keep their first 400.
export function truncateLines(text) {
    const lines = text.split('\n');
    if (lines.length > 500)
        return [...lines.slice(0, 400), '... (truncated)'].join('\n');
    return text;
}
export async function buildContext(projectDir) {
    const logFile = logFileFor(projectDir);
    if (!existsSync(logFile))
        return '';
    const ranked = rankFiles(readFileSync(logFile, 'utf8'), projectDir);
    const top = [];
    for (const r of ranked) {
        if (top.length >= TOP_N)
            break;
        try {
            if (statSync(r.path).isFile())
                top.push(r);
        }
        catch {
            // deleted or moved: skip, like upstream
        }
    }
    if (top.length === 0)
        return '';
    await ensureInit();
    const header = '\n\n# Frequently Accessed Files\n\n' +
        'Most-used files in this project (vix brain). Contents are minified; read a file before editing it.\n\n';
    let out = header;
    const notShown = [];
    for (const r of top) {
        const rel = relative(projectDir, r.path).replace(/\\/g, '/');
        let block = '';
        if (statSync(r.path).size <= MAX_FILE_BYTES) {
            const text = truncateLines(readFileSync(r.path, 'utf8'));
            const lang = detectLanguage(r.path);
            const body = (lang ? await minify(text, lang) : null) ?? text;
            block = `## ${rel}\n\`\`\`\n${body}\n\`\`\`\n\n`;
        }
        if (block && out.length + block.length <= BUDGET)
            out += block;
        else
            notShown.push(rel);
    }
    if (notShown.length) {
        const list = 'Also frequently accessed (not shown, read when needed):\n' + notShown.map((p) => `- ${p}\n`).join('');
        if (out.length + list.length <= BUDGET)
            out += list;
    }
    return out === header && !notShown.length ? '' : out;
}
async function main() {
    let raw = '';
    for await (const chunk of process.stdin)
        raw += chunk;
    let input = {};
    try {
        input = JSON.parse(raw || '{}');
    }
    catch { /* no input */ }
    const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    const context = await buildContext(projectDir);
    if (context) {
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }));
    }
}
// Run only as the hook entry point (dist/brain-context.mjs), not when the
// tests import the tsc build.
if (process.argv[1] && /brain-context\.mjs$/.test(process.argv[1])) {
    main().catch(() => { }).finally(() => process.exit(0));
}
//# sourceMappingURL=brain-context.js.map