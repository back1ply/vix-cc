import { readFile } from 'fs/promises';
import { minifyFile } from './minifier.js';
export async function handleReadMinified(args, readFiles) {
    const { path, offset, limit, reason: _reason } = args;
    let content;
    try {
        content = await readFile(path, 'utf8');
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`vix_read_minified: cannot read ${path}: ${msg}`);
    }
    // Apply line range before minifying so tree-sitter parses the right slice
    const lines = content.split('\n');
    const startLine = offset != null ? Math.max(0, offset - 1) : 0;
    const endLine = limit != null ? Math.min(lines.length, startLine + limit) : lines.length;
    const sliced = lines.slice(startLine, endLine).join('\n');
    const minified = await minifyFile(path, sliced);
    // Add line numbers
    const numberedLines = minified
        .split('\n')
        .map((line, i) => `${startLine + i + 1}\t${line}`)
        .join('\n');
    // Mark as read
    readFiles.add(path);
    return numberedLines;
}
//# sourceMappingURL=vix-read-minified.js.map