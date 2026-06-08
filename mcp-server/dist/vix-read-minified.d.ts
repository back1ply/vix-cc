export interface ReadMinifiedArgs {
    path: string;
    offset?: number;
    limit?: number;
    reason: string;
}
export declare function handleReadMinified(args: ReadMinifiedArgs, readFiles: Set<string>): Promise<string>;
