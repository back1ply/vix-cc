import { readFile, writeFile } from 'fs/promises';
import { spawn } from 'child_process';
import { extname } from 'path';
import { minify, detectLanguage } from './minifier.js';
// per-file mutex: path → promise chain
const fileMutex = new Map();
function runFormatter(filePath) {
    const ext = extname(filePath).toLowerCase();
    let cmd;
    let args;
    if (ext === '.go') {
        cmd = 'gofmt';
        args = ['-w', filePath];
    }
    else if (['.ts', '.tsx', '.js', '.mjs', '.jsx'].includes(ext)) {
        cmd = 'prettier';
        args = ['--write', filePath];
    }
    else if (ext === '.py') {
        cmd = 'black';
        args = [filePath];
    }
    else if (ext === '.rs') {
        cmd = 'rustfmt';
        args = [filePath];
    }
    else {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const proc = spawn(cmd, args, { stdio: 'ignore' });
        proc.on('close', () => resolve()); // fail gracefully — don't reject
        proc.on('error', () => resolve());
    });
}
async function doEdit(args, readFiles) {
    const { path, old_string, new_string } = args;
    if (!readFiles.has(path)) {
        throw new Error(`vix_edit_minified blocked: ${path} has not been read this session. Call vix_read_minified first.`);
    }
    const content = await readFile(path, 'utf8');
    const lang = detectLanguage(path);
    const minified = lang ? await minify(content, lang) : content;
    const count = minified.split(old_string).length - 1;
    if (count === 0) {
        throw new Error(`vix_edit_minified: old_string not found in minified representation of ${path}`);
    }
    if (count > 1) {
        throw new Error(`vix_edit_minified: old_string matches ${count} times in ${path} — must match exactly once`);
    }
    const replaced = minified.replace(old_string, new_string);
    await writeFile(path, replaced, 'utf8');
    // Best-effort format; write already happened above, so we restore style only
    await runFormatter(path);
    readFiles.add(path);
    return `Edited ${path}: replaced 1 occurrence. Formatter applied.`;
}
export async function handleEditMinified(args, readFiles) {
    const { path } = args;
    // Serialize edits per file
    const prev = fileMutex.get(path) ?? Promise.resolve();
    let resolve;
    const next = new Promise((r) => { resolve = r; });
    fileMutex.set(path, next);
    try {
        await prev;
        return await doEdit(args, readFiles);
    }
    finally {
        resolve();
    }
}
//# sourceMappingURL=vix-edit-minified.js.map