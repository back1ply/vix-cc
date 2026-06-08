import { Parser, Language } from 'web-tree-sitter';
import type { Node as TSNode } from 'web-tree-sitter';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODE_MODULES = join(__dirname, '..', 'node_modules');

// comment node types per language (tree-sitter type names)
const COMMENT_TYPES: Record<string, string[]> = {
  javascript: ['comment'],
  typescript: ['comment'],
  tsx: ['comment'],
  python: ['comment'],
  go: ['comment'],
  rust: ['line_comment', 'block_comment'],
  c: ['comment'],
  cpp: ['comment'],
  java: ['comment', 'block_comment', 'line_comment'],
  ruby: ['comment'],
  json: [],
  css: ['comment'],
  html: ['comment'],
  bash: ['comment'],
};

const WASM_PATHS: Record<string, string> = {
  javascript: join(NODE_MODULES, 'tree-sitter-javascript', 'tree-sitter-javascript.wasm'),
  typescript: join(NODE_MODULES, 'tree-sitter-typescript', 'tree-sitter-typescript.wasm'),
  tsx: join(NODE_MODULES, 'tree-sitter-typescript', 'tree-sitter-tsx.wasm'),
  python: join(NODE_MODULES, 'tree-sitter-python', 'tree-sitter-python.wasm'),
  go: join(NODE_MODULES, 'tree-sitter-go', 'tree-sitter-go.wasm'),
  rust: join(NODE_MODULES, 'tree-sitter-rust', 'tree-sitter-rust.wasm'),
  c: join(NODE_MODULES, 'tree-sitter-c', 'tree-sitter-c.wasm'),
  cpp: join(NODE_MODULES, 'tree-sitter-cpp', 'tree-sitter-cpp.wasm'),
  java: join(NODE_MODULES, 'tree-sitter-java', 'tree-sitter-java.wasm'),
  ruby: join(NODE_MODULES, 'tree-sitter-ruby', 'tree-sitter-ruby.wasm'),
  json: join(NODE_MODULES, 'tree-sitter-json', 'tree-sitter-json.wasm'),
  css: join(NODE_MODULES, 'tree-sitter-css', 'tree-sitter-css.wasm'),
  html: join(NODE_MODULES, 'tree-sitter-html', 'tree-sitter-html.wasm'),
  bash: join(NODE_MODULES, 'tree-sitter-bash', 'tree-sitter-bash.wasm'),
};

const EXT_TO_LANG: Record<string, string> = {
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
  '.rb': 'ruby',
  '.json': 'json',
  '.css': 'css',
  '.html': 'html',
  '.htm': 'html',
  '.sh': 'bash',
  '.bash': 'bash',
};

let initialized = false;
const parserCache = new Map<string, { parser: Parser; commentTypes: string[] }>();

export async function ensureInit(): Promise<void> {
  if (!initialized) {
    await Parser.init();
    initialized = true;
  }
}

export function detectLanguage(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  return EXT_TO_LANG[ext] ?? null;
}

async function getParser(lang: string): Promise<{ parser: Parser; commentTypes: string[] } | null> {
  if (parserCache.has(lang)) return parserCache.get(lang)!;

  const wasmPath = WASM_PATHS[lang];
  if (!wasmPath) return null;

  try {
    const language = await Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(language);
    const entry = { parser, commentTypes: COMMENT_TYPES[lang] ?? [] };
    parserCache.set(lang, entry);
    return entry;
  } catch {
    return null;
  }
}

function collectCommentRanges(
  node: TSNode,
  commentTypes: string[],
  acc: Array<{ start: number; end: number }>
): void {
  if (commentTypes.includes(node.type)) {
    acc.push({ start: node.startIndex, end: node.endIndex });
    return; // don't recurse into comments
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) collectCommentRanges(child, commentTypes, acc);
  }
}

export async function minify(content: string, lang: string): Promise<string> {
  const entry = await getParser(lang);
  if (!entry || entry.commentTypes.length === 0) {
    // language has no comments (JSON) or parser unavailable — return raw
    return content;
  }

  const { parser, commentTypes } = entry;
  const tree = parser.parse(content);
  if (!tree) return content;
  const ranges: Array<{ start: number; end: number }> = [];
  collectCommentRanges(tree.rootNode, commentTypes, ranges);

  // remove comments back-to-front to preserve indices
  ranges.sort((a, b) => b.start - a.start);
  let result = content;
  for (const { start, end } of ranges) {
    result = result.slice(0, start) + result.slice(end);
  }

  // collapse multiple blank lines → single blank line
  result = result.replace(/\n{3,}/g, '\n\n');
  return result;
}

export async function minifyFile(filePath: string, content: string): Promise<string> {
  await ensureInit();
  const lang = detectLanguage(filePath);
  if (!lang) return content; // unsupported — return raw
  return minify(content, lang);
}
