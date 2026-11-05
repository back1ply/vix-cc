import { readFile, writeFile } from 'fs/promises';
import { minifyMapped, detectLanguage, ensureInit, projectSpan } from './minifier.js';
import { withFileLock } from './file-lock.js';

export interface EditMinifiedArgs {
  path: string;
  old_string: string;
  new_string: string;
  reason?: string;
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// Adapt minified new_string to the file before splicing (vix-cc fix; upstream
// splices it verbatim):
// - Python: the minified view indents one space per level; convert continuation
//   lines back to the indent unit the minifier detected, so blocks stay valid.
// - CRLF files: use CRLF for inserted line breaks.
function adaptNewString(newString: string, content: string, indentUnit: string | undefined): string {
  let out = newString;
  if (indentUnit !== undefined && out.includes('\n')) {
    const unit = indentUnit;
    out = out
      .split('\n')
      .map((line, i) => {
        if (i === 0) return line;
        const level = /^ */.exec(line)![0].length;
        return unit.repeat(level) + line.slice(level);
      })
      .join('\n');
  }
  if (content.includes('\r\n')) {
    out = out.replace(/\r?\n/g, '\r\n');
  }
  return out;
}

// Upstream fallback: plain literal edit when the file can't be minified.
function literalEdit(path: string, content: string, old_string: string, new_string: string): string {
  const count = countOccurrences(content, old_string);
  if (count === 0) {
    throw new Error(`vix_edit_minified: old_string not found in ${path}.`);
  }
  if (count > 1) {
    throw new Error(
      `vix_edit_minified: old_string matches ${count} times in ${path} — must match exactly once. ` +
        `Include more surrounding text in old_string to make it unique.`
    );
  }
  const idx = content.indexOf(old_string);
  return content.slice(0, idx) + new_string + content.slice(idx + old_string.length);
}

async function doEdit(args: EditMinifiedArgs, readFiles: Set<string>): Promise<string> {
  const { path, old_string, new_string } = args;

  if (!readFiles.has(path)) {
    throw new Error(
      `vix_edit_minified blocked: ${path} has not been read this session. Call vix_read_minified first.`
    );
  }
  if (old_string.length === 0) {
    throw new Error('vix_edit_minified: old_string must not be empty.');
  }

  const content = await readFile(path, 'utf8');
  const lang = detectLanguage(path);
  await ensureInit();
  const mapped = lang ? await minifyMapped(content, lang) : null;

  let updated: string;
  if (!mapped) {
    updated = literalEdit(path, content, old_string, new_string);
  } else {
    const count = countOccurrences(mapped.text, old_string);
    if (count === 0) {
      throw new Error(
        `vix_edit_minified: old_string not found in minified representation of ${path}. ` +
          `old_string must be copied from vix_read_minified output (comments stripped, whitespace collapsed), not from the original source. ` +
          `Re-read the file with vix_read_minified and copy the exact text.`
      );
    }
    if (count > 1) {
      throw new Error(
        `vix_edit_minified: old_string matches ${count} times in ${path} — must match exactly once. ` +
          `Include more surrounding text in old_string to make it unique.`
      );
    }

    // Project the match back onto the original source and splice only that
    // range, leaving comments and formatting elsewhere untouched.
    const outStart = mapped.text.indexOf(old_string);
    const span = projectSpan(mapped.map, outStart, outStart + old_string.length);
    if (!span) {
      throw new Error(
        'vix_edit_minified: old_string matched only inserted separators and cannot be mapped back to the source file.'
      );
    }
    updated = content.slice(0, span.start) + adaptNewString(new_string, content, mapped.indent) + content.slice(span.end);
  }

  await writeFile(path, updated, 'utf8');
  readFiles.add(path);

  return `Edited ${path} (replaced 1 occurrence).`;
}

export async function handleEditMinified(
  args: EditMinifiedArgs,
  readFiles: Set<string>
): Promise<string> {
  return withFileLock(args.path, () => doEdit(args, readFiles));
}
