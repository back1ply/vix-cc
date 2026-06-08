export interface EditMinifiedArgs {
    path: string;
    old_string: string;
    new_string: string;
    reason?: string;
}
export declare function handleEditMinified(args: EditMinifiedArgs, readFiles: Set<string>): Promise<string>;
