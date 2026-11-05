import { readFile } from 'fs/promises';
import { detectLanguage, ensureInit, minify } from './minifier.js';
// Upstream sliceLines: apply 1-based offset/limit to text.
function sliceLines(lines, offset, limit) {
    let start = offset != null && offset >= 1 ? offset - 1 : 0;
    let end = limit != null ? start + limit : lines.length;
    if (start > lines.length)
        start = lines.length;
    if (end > lines.length)
        end = lines.length;
    return { start, lines: lines.slice(start, end) };
}
export async function handleReadMinified(args, readFiles) {
    const { path, offset, limit } = args;
    let content;
    try {
        content = await readFile(path, 'utf8');
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`vix_read_minified: cannot read ${path}: ${msg}`);
    }
    readFiles.add(path);
    const sliced = sliceLines(content.split('\n'), offset, limit);
    const lang = detectLanguage(path);
    // Unsupported language: plain numbered read (upstream readFileImpl).
    if (!lang) {
        return sliced.lines.map((line, i) => `${String(sliced.start + i + 1).padStart(5)}\t${line}`).join('\n');
    }
    // Supported language: minified text, unnumbered; raw slice if it can't be
    // minified (upstream VfsRead).
    await ensureInit();
    const text = sliced.lines.join('\n');
    return (await minify(text, lang)) ?? text;
}
//# sourceMappingURL=vix-read-minified.js.map