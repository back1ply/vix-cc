// Tree-sitter token minifier — a port of upstream vix internal/daemon/treesitter.go
// (get-vix/vix e68a25c). The source is reduced to its leaf tokens joined with
// the minimum separators each language needs, and a position map ties every
// output character back to the source so edits can be spliced into the
// original file.
//
// Differences from upstream:
// - Offsets are JS string (UTF-16) indices instead of bytes; web-tree-sitter
//   reports node indices in the same units, so the map stays exact.
// - Language-specific passes are chosen by language, not file extension, so
//   .tsx/.jsx/.mjs/.h/.hpp/.zsh etc. get the same handling as their language.
// - Output is re-validated with tree-sitter for every language (upstream uses
//   go/parser for Go).
// - Swift is not supported (no web-tree-sitter-compatible grammar build).
// - `$` (in JS/TS identifiers, never `${`) and non-ASCII letters count as word
//   characters when deciding whether two tokens need a space between them, so
//   `return $x` / `return élan` don't merge into one identifier.
import { Parser, Language } from 'web-tree-sitter';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const NODE_MODULES = join(__dirname, '..', 'node_modules');
const WASM_PATHS = {
    javascript: join(NODE_MODULES, 'tree-sitter-javascript', 'tree-sitter-javascript.wasm'),
    typescript: join(NODE_MODULES, 'tree-sitter-typescript', 'tree-sitter-typescript.wasm'),
    tsx: join(NODE_MODULES, 'tree-sitter-typescript', 'tree-sitter-tsx.wasm'),
    python: join(NODE_MODULES, 'tree-sitter-python', 'tree-sitter-python.wasm'),
    go: join(NODE_MODULES, 'tree-sitter-go', 'tree-sitter-go.wasm'),
    rust: join(NODE_MODULES, 'tree-sitter-rust', 'tree-sitter-rust.wasm'),
    c: join(NODE_MODULES, 'tree-sitter-c', 'tree-sitter-c.wasm'),
    cpp: join(NODE_MODULES, 'tree-sitter-cpp', 'tree-sitter-cpp.wasm'),
    java: join(NODE_MODULES, 'tree-sitter-java', 'tree-sitter-java.wasm'),
    csharp: join(NODE_MODULES, 'tree-sitter-c-sharp', 'tree-sitter-c_sharp.wasm'),
    kotlin: join(NODE_MODULES, '@tree-sitter-grammars', 'tree-sitter-kotlin', 'tree-sitter-kotlin.wasm'),
    php: join(NODE_MODULES, 'tree-sitter-php', 'tree-sitter-php.wasm'),
    ruby: join(NODE_MODULES, 'tree-sitter-ruby', 'tree-sitter-ruby.wasm'),
    json: join(NODE_MODULES, 'tree-sitter-json', 'tree-sitter-json.wasm'),
    css: join(NODE_MODULES, 'tree-sitter-css', 'tree-sitter-css.wasm'),
    html: join(NODE_MODULES, 'tree-sitter-html', 'tree-sitter-html.wasm'),
    bash: join(NODE_MODULES, 'tree-sitter-bash', 'tree-sitter-bash.wasm'),
};
const EXT_TO_LANG = {
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.mts': 'typescript',
    '.cts': 'typescript',
    '.tsx': 'tsx',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.c': 'c',
    '.h': 'c',
    '.cc': 'cpp',
    '.cpp': 'cpp',
    '.cxx': 'cpp',
    '.hpp': 'cpp',
    '.hxx': 'cpp',
    '.java': 'java',
    '.cs': 'csharp',
    '.kt': 'kotlin',
    '.kts': 'kotlin',
    '.php': 'php',
    '.rb': 'ruby',
    '.json': 'json',
    '.css': 'css',
    '.html': 'html',
    '.htm': 'html',
    '.sh': 'bash',
    '.bash': 'bash',
    '.zsh': 'bash',
};
// Languages where `;` may separate statements in the source between tokens
// (upstream usesSemicolonSeparator).
const SEMICOLON_LANGS = new Set([
    'kotlin', 'go', 'ruby', 'bash', 'javascript', 'typescript', 'tsx',
    'java', 'c', 'cpp', 'csharp', 'rust', 'php', 'css',
]);
// Languages where `$` can start or continue an identifier token (`$x`, `a$`).
// Not PHP: its grammar emits `$` and the variable name as separate tokens.
const DOLLAR_WORD_LANGS = new Set(['javascript', 'typescript', 'tsx']);
let initialized = false;
const parserCache = new Map();
export async function ensureInit() {
    if (!initialized) {
        await Parser.init();
        initialized = true;
    }
}
export function detectLanguage(filePath) {
    const ext = extname(filePath).toLowerCase();
    return EXT_TO_LANG[ext] ?? null;
}
async function getParser(lang) {
    const cached = parserCache.get(lang);
    if (cached)
        return cached;
    const wasmPath = WASM_PATHS[lang];
    if (!wasmPath)
        return null;
    try {
        const language = await Language.load(wasmPath);
        const parser = new Parser();
        parser.setLanguage(language);
        parserCache.set(lang, parser);
        return parser;
    }
    catch {
        return null;
    }
}
const COMMENT_KINDS = new Set(['comment', 'line_comment', 'block_comment', 'multiline_comment']);
const PREPROC_KINDS = new Set([
    'preproc_include', 'preproc_def', 'preproc_function_def', 'preproc_call',
    'preproc_ifdef', 'preproc_ifndef', 'preproc_if', 'preproc_elif', 'preproc_else',
    'preproc_endif',
]);
function isAtomicNode(kind) {
    switch (kind) {
        case 'integer_value':
        case 'float_value':
        case 'color_value': // CSS
        case 'format_specifier': // Python f-string format specs
            return true;
    }
    return false;
}
function makeToken(node, source, lineStarts, extra = {}) {
    const row = node.startPosition.row;
    return {
        text: source.slice(node.startIndex, node.endIndex),
        line: row,
        col: node.startIndex - lineStarts[row],
        lineStart: lineStarts[row],
        start: node.startIndex,
        end: node.endIndex,
        separator: '',
        spaceSeparated: false,
        isComment: false,
        parentKind: '',
        ...extra,
    };
}
function collectLeaves(node, source, lineStarts, tokens, spaceSeparated, keepComments, parentKind) {
    if (!node)
        return;
    const kind = node.type;
    if (kind === '\n' || kind === '\t' || kind === ' ')
        return;
    if (COMMENT_KINDS.has(kind)) {
        if (!keepComments)
            return;
        // Comments always get a newline after them so a line comment can't
        // swallow the code that follows it.
        const tok = makeToken(node, source, lineStarts, { separator: '\n', isComment: true });
        if (tok.text !== '')
            tokens.push(tok);
        return;
    }
    if (isAtomicNode(kind)) {
        const tok = makeToken(node, source, lineStarts, { spaceSeparated });
        if (tok.text !== '')
            tokens.push(tok);
        return;
    }
    if (node.childCount === 0) {
        const tok = makeToken(node, source, lineStarts, { spaceSeparated, parentKind });
        if (tok.text !== '' && tok.text !== '\n' && tok.text !== '\t')
            tokens.push(tok);
        return;
    }
    // HTML doctype: the doctype name isn't a child node, so emit it whole.
    if (kind === 'doctype') {
        const tok = makeToken(node, source, lineStarts);
        if (tok.text !== '')
            tokens.push(tok);
        return;
    }
    const isSpaceSep = kind === 'string_array' || kind === 'symbol_array';
    for (let i = 0; i < node.childCount; i++) {
        collectLeaves(node.child(i), source, lineStarts, tokens, spaceSeparated || isSpaceSep, keepComments, kind);
    }
    // C/C++ preprocessor directives must end their line.
    if (PREPROC_KINDS.has(kind) && tokens.length > 0) {
        tokens[tokens.length - 1].separator = '\n';
    }
}
// ---------------------------------------------------------------------------
// Character classes
function isWordCharCode(c, dollarIsWord) {
    return ((c >= 97 && c <= 122) || // a-z
        (c >= 65 && c <= 90) || // A-Z
        (c >= 48 && c <= 57) || // 0-9
        c === 95 || // _
        (dollarIsWord && c === 36) || // $
        c >= 128 // non-ASCII letters (identifiers, text)
    );
}
// Upstream's ASCII-only word check, used by the statement-ending rules.
function isAsciiWordChar(ch) {
    return /[A-Za-z0-9_]/.test(ch);
}
function isOperatorChar(ch) {
    return '=!<>+-*/&|^%~?'.includes(ch) && ch.length === 1;
}
function isOperatorToken(text) {
    if (text.length === 0)
        return false;
    for (const ch of text)
        if (!isOperatorChar(ch))
            return false;
    return true;
}
function lastChar(text) {
    return text.length ? text[text.length - 1] : '';
}
// ---------------------------------------------------------------------------
// Language passes
function annotateComments(tokens) {
    for (let i = 0; i < tokens.length; i++) {
        if (!tokens[i].isComment)
            continue;
        if (i > 0 && tokens[i - 1].separator === '' && tokens[i - 1].text !== ';') {
            tokens[i - 1].separator = '\n';
        }
        if (i + 1 < tokens.length) {
            tokens[i].line = tokens[i + 1].line - 1;
        }
    }
}
function goSemicolonTrigger(text) {
    if (!text)
        return false;
    const c = lastChar(text);
    if (isAsciiWordChar(c))
        return true;
    switch (c) {
        case ')':
        case ']':
        case '}':
        case '"':
        case "'":
        case '`':
            return true;
        case '+':
            return text === '++';
        case '-':
            return text === '--';
    }
    return false;
}
function isClosingToken(text) {
    return text === '}' || text === ')' || text === ']' || text === ',';
}
function annotateGo(tokens) {
    for (let i = 0; i < tokens.length - 1; i++) {
        if (tokens[i].isComment)
            continue;
        let j = i + 1;
        while (j < tokens.length && tokens[j].isComment)
            j++;
        if (j >= tokens.length)
            break;
        const curr = tokens[i];
        const next = tokens[j];
        if (next.line > curr.line && goSemicolonTrigger(curr.text) && !isClosingToken(next.text)) {
            tokens[i].separator = ';';
        }
    }
}
function swiftSemicolonTrigger(text) {
    if (!text)
        return false;
    switch (text) {
        case 'in':
        case 'throws':
        case 'rethrows':
        case 'async':
        case 'try':
        case 'await':
        case 'throw':
            return false;
    }
    const c = lastChar(text);
    if (isAsciiWordChar(c))
        return true;
    switch (c) {
        case ')':
        case ']':
        case '}':
        case '"':
        case "'":
            return true;
        case '>':
            return text === '>';
        case '!':
        case '?':
            return text === '!' || text === '?';
        case '+':
            return text === '++';
        case '-':
            return text === '--';
    }
    return false;
}
function kotlinSemicolonTrigger(tokens, i) {
    const text = tokens[i].text;
    if (swiftSemicolonTrigger(text))
        return true;
    if ((text === '+' || text === '-') && i > 0 && tokens[i - 1].text === text && tokens[i - 1].line === tokens[i].line) {
        return true;
    }
    return false;
}
function kotlinContinuationToken(text) {
    return ['}', ')', ']', ',', '{', '.', 'else', 'catch', 'finally', 'where', 'in'].includes(text);
}
function annotateKotlin(tokens) {
    for (let i = 0; i < tokens.length - 1; i++) {
        const curr = tokens[i];
        const next = tokens[i + 1];
        if (next.line > curr.line && kotlinSemicolonTrigger(tokens, i) && !kotlinContinuationToken(next.text)) {
            tokens[i].separator = ';';
        }
    }
    for (let i = 0; i < tokens.length - 2; i++) {
        const opTok = tokens[i + 1].text;
        const nextTok = tokens[i + 2].text;
        if (opTok === '?' && nextTok === '.')
            continue;
        if (isOperatorToken(opTok) && (nextTok === '.' || isOperatorToken(nextTok))) {
            if (tokens[i].separator === '')
                tokens[i].separator = ' ';
            tokens[i + 1].separator = ' ';
        }
    }
}
function annotateBash(tokens, source) {
    for (let i = 1; i < tokens.length; i++) {
        const start = tokens[i - 1].end;
        const end = tokens[i].start;
        if (start < 0 || end > source.length || start >= end)
            continue;
        let b = '';
        for (const c of source.slice(start, end)) {
            if (c === ' ' || c === '\t' || c === '\n')
                b += c;
        }
        if (b.length > 0) {
            let collapsed = '';
            let prevNL = false;
            for (const c of b) {
                if (c === '\n') {
                    if (prevNL)
                        continue;
                    prevNL = true;
                }
                else {
                    prevNL = false;
                }
                collapsed += c;
            }
            tokens[i - 1].separator = collapsed;
        }
    }
}
function rubySemicolonTrigger(text) {
    if (!text)
        return false;
    const c = lastChar(text);
    if (isAsciiWordChar(c))
        return true;
    return [')', ']', '}', '"', "'"].includes(c);
}
function rubyContinuationToken(text) {
    return ['}', ')', ']', ',', '{', '.', 'do', 'else', 'elsif', 'ensure', 'rescue', 'when', 'then', 'in'].includes(text);
}
function annotateRuby(tokens) {
    for (let i = 0; i < tokens.length - 1; i++) {
        const curr = tokens[i];
        const next = tokens[i + 1];
        if (curr.spaceSeparated && next.spaceSeparated && tokens[i].separator === '') {
            tokens[i].separator = ' ';
            continue;
        }
        if (next.line > curr.line && rubySemicolonTrigger(curr.text) && !rubyContinuationToken(next.text)) {
            tokens[i].separator = ';';
        }
        // `arr<<x` would read as a heredoc; `arr<< x` is the shift operator.
        if (curr.text === '<<' && tokens[i].separator === '' && next.text.length > 0 && isAsciiWordChar(next.text[0])) {
            tokens[i].separator = ' ';
        }
    }
}
// Returns the source text of one indent level (e.g. "    " or "\t") so edits
// can map the minified one-space levels back to the file's indentation.
function annotatePython(tokens, source) {
    if (tokens.length === 0)
        return '    ';
    let indentUnit = 0;
    let unitToken = null;
    for (let i = 1; i < tokens.length; i++) {
        if (tokens[i].line > tokens[i - 1].line && tokens[i].col > 0) {
            if (indentUnit === 0 || tokens[i].col < indentUnit) {
                indentUnit = tokens[i].col;
                unitToken = tokens[i];
            }
        }
    }
    if (indentUnit === 0)
        indentUnit = 4;
    for (let i = 1; i < tokens.length; i++) {
        if (tokens[i].line > tokens[i - 1].line) {
            const level = Math.floor(tokens[i].col / indentUnit);
            tokens[i - 1].separator = '\n' + ' '.repeat(level);
        }
    }
    return unitToken ? source.slice(unitToken.lineStart, unitToken.start) : '    ';
}
function annotateHTML(tokens) {
    for (let i = 0; i < tokens.length - 1; i++) {
        const curr = tokens[i];
        const next = tokens[i + 1];
        if (curr.line !== next.line)
            continue;
        if (next.start > curr.end)
            tokens[i].separator = ' ';
    }
}
function preserveSemicolons(tokens, source, lang) {
    // Kotlin's grammar needs literal newlines in some contexts; keep them all.
    const preserveAllNLs = lang === 'kotlin';
    for (let i = 0; i < tokens.length - 1; i++) {
        const start = tokens[i].end;
        const end = tokens[i + 1].start;
        if (end <= start || end > source.length)
            continue;
        const gap = source.slice(start, end);
        const hasSemi = gap.includes(';');
        const hasNL = gap.includes('\n');
        if (preserveAllNLs && hasNL) {
            if (hasSemi) {
                tokens[i].separator = ';\n';
            }
            else if (tokens[i].separator === '' || tokens[i].separator === ';') {
                tokens[i].separator = tokens[i].separator + '\n';
            }
            continue;
        }
        if (hasSemi && tokens[i].separator !== ';' && tokens[i].separator !== ';\n') {
            tokens[i].separator = ';';
        }
    }
}
function joinTokens(tokens, lang) {
    const dollarIsWord = DOLLAR_WORD_LANGS.has(lang);
    const parts = [];
    const map = [];
    let last = ''; // last character written
    const writeSynthetic = (s) => {
        if (!s)
            return;
        parts.push(s);
        for (let k = 0; k < s.length; k++)
            map.push(-1);
        last = s[s.length - 1];
    };
    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (i > 0) {
            writeSynthetic(tokens[i - 1].separator);
            if (map.length > 0) {
                if (last !== '\n' &&
                    isWordCharCode(last.charCodeAt(0), dollarIsWord) &&
                    isWordCharCode(tok.text.charCodeAt(0), dollarIsWord && !tok.text.startsWith('${'))) {
                    writeSynthetic(' ');
                }
                else if (isOperatorChar(last) && last !== '?' && last !== '!' && tok.text[0] === '.') {
                    writeSynthetic(' ');
                }
            }
        }
        parts.push(tok.text);
        for (let k = 0; k < tok.text.length; k++)
            map.push(tok.start + k);
        last = tok.text[tok.text.length - 1];
    }
    // Upstream trims surrounding whitespace; trim the map in step.
    let text = parts.join('');
    let lo = 0;
    let hi = text.length;
    while (lo < hi && /\s/.test(text[lo]))
        lo++;
    while (hi > lo && /\s/.test(text[hi - 1]))
        hi--;
    text = text.slice(lo, hi);
    return { text, map: Int32Array.from(map.slice(lo, hi)) };
}
// ---------------------------------------------------------------------------
// Entry points
function lineStartsOf(source) {
    const starts = [0];
    for (let i = 0; i < source.length; i++)
        if (source[i] === '\n')
            starts.push(i + 1);
    return starts;
}
/**
 * Minify source with a position map back to it. Returns null when the file
 * can't be minified (unsupported language, empty output, or the minified
 * output no longer parses although the input did).
 */
export async function minifyMapped(content, lang, keepComments = false) {
    const parser = await getParser(lang);
    if (!parser)
        return null;
    const tree = parser.parse(content);
    if (!tree)
        return null;
    try {
        const tokens = [];
        collectLeaves(tree.rootNode, content, lineStartsOf(content), tokens, false, keepComments, '');
        annotateComments(tokens);
        let indent;
        switch (lang) {
            case 'go':
                annotateGo(tokens);
                break;
            case 'kotlin':
                annotateKotlin(tokens);
                break;
            case 'python':
                indent = annotatePython(tokens, content);
                break;
            case 'bash':
                annotateBash(tokens, content);
                break;
            case 'ruby':
                annotateRuby(tokens);
                break;
            case 'html':
                annotateHTML(tokens);
                break;
        }
        if (SEMICOLON_LANGS.has(lang))
            preserveSemicolons(tokens, content, lang);
        const result = joinTokens(tokens, lang);
        if (result.text === '')
            return null;
        // Reject output that introduced syntax errors the input didn't have.
        if (!tree.rootNode.hasError) {
            const verify = parser.parse(result.text);
            const broken = !verify || verify.rootNode.hasError;
            verify?.delete();
            if (broken)
                return null;
        }
        return indent === undefined ? result : { ...result, indent };
    }
    finally {
        tree.delete();
    }
}
export async function minify(content, lang, keepComments = false) {
    const mapped = await minifyMapped(content, lang, keepComments);
    return mapped ? mapped.text : null;
}
/**
 * Map a range of minified text back to the source (upstream projectSpan).
 * Boundaries that land on inserted separators snap inward to the nearest real
 * character. Returns null if the range contains no source characters.
 */
export function projectSpan(map, outStart, outEnd) {
    let i = outStart;
    while (i < outEnd && map[i] < 0)
        i++;
    let j = outEnd - 1;
    while (j >= i && map[j] < 0)
        j--;
    if (i >= outEnd || j < i)
        return null;
    const start = map[i];
    const end = map[j] + 1;
    return start < end ? { start, end } : null;
}
//# sourceMappingURL=minifier.js.map