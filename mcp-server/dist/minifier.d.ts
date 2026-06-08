export declare function ensureInit(): Promise<void>;
export declare function detectLanguage(filePath: string): string | null;
export declare function minify(content: string, lang: string): Promise<string>;
export declare function minifyFile(filePath: string, content: string): Promise<string>;
