import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { ensureInit } from './minifier.js';
import { handleReadMinified } from './vix-read-minified.js';
import { handleEditMinified } from './vix-edit-minified.js';
import { handleBackgroundBash, killAllJobs } from './vix-background-bash.js';
import { handleToolChain } from './vix-tool-chain.js';
// Session state — resets when Claude Code restarts the MCP server
const readFiles = new Set();
const bashJobs = new Map();
const server = new Server({ name: 'vix', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'vix_read_minified',
            description: 'Read a file from disk and automatically minify it using Tree-sitter (stripping comments, collapsing whitespace) for token-efficient output. ' +
                'The minified content is exactly the code that is on disk, just with whitespace and comments removed. Optionally extract a line range before minifying. ' +
                'Marks the file as read for the session (required before vix_edit_minified). Returns content with line numbers.',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute path to the file' },
                    offset: { type: 'number', description: 'Start line (1-based, optional)' },
                    limit: { type: 'number', description: 'Max lines to read (optional)' },
                    reason: {
                        type: 'string',
                        description: 'Why this file, what you expect to find, how it helps the current goal',
                    },
                },
                required: ['path', 'reason'],
            },
        },
        {
            name: 'vix_edit_minified',
            description: 'Edit a file through the virtual filesystem. The file is minified with Tree-sitter, the match is performed on the minified representation, and a formatter restores valid source. ' +
                'Both old_string and new_string must use the minified format (as returned by vix_read_minified). ' +
                'The file MUST have been read with vix_read_minified first. Formatter applied after write (prettier/black/gofmt/rustfmt).',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute path to the file' },
                    old_string: {
                        type: 'string',
                        description: 'Exact string to find in the minified representation (must match exactly once)',
                    },
                    new_string: {
                        type: 'string',
                        description: 'Replacement string (in minified form)',
                    },
                    reason: { type: 'string', description: 'Why this edit is needed' },
                },
                required: ['path', 'old_string', 'new_string'],
            },
        },
        {
            name: 'vix_background_bash',
            description: 'Spawn a shell command detached and return immediately with a job_id plus paths to a log file and an rc file. ' +
                'Poll with ordinary bash: `test -f <rc> && cat <rc>` (empty = still running), `tail -n 50 <log>`. ' +
                'The timeout param is a wall-clock cap on the detached child (default 3600 s), NOT a cap on this tool call — the tool call returns in under a second. ' +
                'Use this when a command will exceed the foreground cap, or when you want to race multiple approaches in parallel.',
            inputSchema: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Shell command to run in the background' },
                    timeout: {
                        type: 'number',
                        description: 'Max seconds before killing the job (default 3600, max 3600)',
                    },
                    reason: { type: 'string', description: 'Why this needs to run in the background' },
                },
                required: ['command', 'reason'],
            },
        },
        {
            name: 'vix_tool_chain',
            description: 'Execute a Python workflow that chains multiple tool calls (read_file, grep, glob_files, bash, edit_file, write_file, delete_file) in a single round-trip. ' +
                'The workflow script has access to tool functions and must return a dict with results. ' +
                'A CWD variable is available with the project root path. Use relative paths (resolved against CWD) or os.path.join(CWD, ...) for file operations. ' +
                'Signatures: read_file(path), write_file(path, content), edit_file(path, old_string, new_string), delete_file(path), bash(command), grep(pattern, path=None, include=None), glob_files(pattern, path=None).',
            inputSchema: {
                type: 'object',
                properties: {
                    workflow: {
                        type: 'string',
                        description: 'Python function body (indented). May use read_file, write_file, edit_file, ' +
                            'delete_file, bash, grep, glob_files. Return a dict or string as the result.',
                    },
                    description: {
                        type: 'string',
                        description: 'Short summary of what this workflow does',
                    },
                },
                required: ['workflow', 'description'],
            },
        },
    ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const ok = (text) => ({ content: [{ type: 'text', text }] });
    const err = (text) => ({
        content: [{ type: 'text', text }],
        isError: true,
    });
    try {
        switch (name) {
            case 'vix_read_minified': {
                const result = await handleReadMinified(args, readFiles);
                return ok(result);
            }
            case 'vix_edit_minified': {
                const result = await handleEditMinified(args, readFiles);
                return ok(result);
            }
            case 'vix_background_bash': {
                const result = await handleBackgroundBash(args, bashJobs);
                return ok(result);
            }
            case 'vix_tool_chain': {
                const result = await handleToolChain(args);
                return ok(result);
            }
            default:
                return err(`Unknown tool: ${name}`);
        }
    }
    catch (e) {
        return err(e instanceof Error ? e.message : String(e));
    }
});
// Graceful shutdown — kill background jobs
process.on('SIGINT', () => { killAllJobs(bashJobs); process.exit(0); });
process.on('SIGTERM', () => { killAllJobs(bashJobs); process.exit(0); });
// Initialize web-tree-sitter WASM runtime before accepting requests
await ensureInit();
const transport = new StdioServerTransport();
await server.connect(transport);
//# sourceMappingURL=index.js.map