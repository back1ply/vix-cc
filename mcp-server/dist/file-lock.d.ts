export declare function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T>;
