export declare function ensureInit(): Promise<void>;
export declare function detectLanguage(filePath: string): string | null;
export interface MappedMinify {
    text: string;
    map: Int32Array;
    indent?: string;
}
/**
 * Minify source with a position map back to it. Returns null when the file
 * can't be minified (unsupported language, empty output, or the minified
 * output no longer parses although the input did).
 */
export declare function minifyMapped(content: string, lang: string, keepComments?: boolean): Promise<MappedMinify | null>;
export declare function minify(content: string, lang: string, keepComments?: boolean): Promise<string | null>;
/**
 * Map a range of minified text back to the source (upstream projectSpan).
 * Boundaries that land on inserted separators snap inward to the nearest real
 * character. Returns null if the range contains no source characters.
 */
export declare function projectSpan(map: Int32Array, outStart: number, outEnd: number): {
    start: number;
    end: number;
} | null;
