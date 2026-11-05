export interface WriteMinifiedArgs {
    path: string;
    content: string;
    reason?: string;
}
export declare function handleWriteMinified(args: WriteMinifiedArgs, readFiles: Set<string>): Promise<string>;
