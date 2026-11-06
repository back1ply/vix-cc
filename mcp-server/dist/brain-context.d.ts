export declare function normalize(p: string): string;
export declare function logFileFor(projectDir: string): string;
interface Ranked {
    path: string;
    count: number;
    last: number;
}
export declare function rankFiles(logText: string, projectDir: string): Ranked[];
export declare function truncateLines(text: string): string;
export declare function buildContext(projectDir: string): Promise<string>;
export {};
