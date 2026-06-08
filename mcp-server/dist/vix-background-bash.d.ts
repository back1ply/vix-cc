export interface BashJob {
    id: string;
    pid: number | undefined;
    logPath: string;
    rcPath: string;
    startedAt: number;
}
export interface BackgroundBashArgs {
    command: string;
    timeout?: number;
    reason: string;
}
export declare function handleBackgroundBash(args: BackgroundBashArgs, bashJobs: Map<string, BashJob>): Promise<string>;
export declare function killAllJobs(bashJobs: Map<string, BashJob>): void;
