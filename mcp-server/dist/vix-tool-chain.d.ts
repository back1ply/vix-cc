export interface ToolChainArgs {
    workflow: string;
    description: string;
}
export declare function handleToolChain(args: ToolChainArgs): Promise<string>;
