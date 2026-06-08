import { spawn } from 'child_process';
import { readFile, writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { randomBytes } from 'crypto';
import { createInterface } from 'readline';
const TIMEOUT_MS = 5 * 60 * 1000;
const PYTHON_PREAMBLE = `import sys, json, os

_original_stdout = sys.stdout
sys.stdout = sys.stderr  # redirect print() to stderr

CWD = os.getcwd()

def _resolve_path(path):
    if not os.path.isabs(path):
        return os.path.join(CWD, path)
    return path

def _call_tool(name, params):
    req = json.dumps({"call": name, "params": params})
    _original_stdout.write(req + "\\n")
    _original_stdout.flush()
    resp = json.loads(input())
    if resp.get("is_error"):
        raise RuntimeError("Tool " + name + " failed: " + resp["output"])
    return resp["output"]

def read_file(path, reason=""):
    return _call_tool("read_file", {"path": _resolve_path(path), "reason": reason})

def grep(pattern, path=None, include=None, reason=""):
    params = {"pattern": pattern, "reason": reason}
    if path: params["path"] = _resolve_path(path)
    if include: params["include"] = include
    raw = _call_tool("grep", params)
    import re
    results = []
    for line in raw.strip().split("\\n"):
        m = re.match(r'^(.*?):(\d+):(.*)', line)
        if m:
            results.append({"file": m.group(1), "line": int(m.group(2)), "text": m.group(3)})
    return results

def glob_files(pattern, path=None, reason=""):
    if isinstance(pattern, str): pattern = [pattern]
    params = {"pattern": pattern, "reason": reason}
    if path:
        if isinstance(path, str): path = [path]
        params["path"] = [_resolve_path(p) for p in path]
    raw = _call_tool("glob_files", params)
    return [f for f in raw.strip().split("\\n") if f]

def bash(command):
    return _call_tool("bash", {"command": command})

def edit_file(path, old_string, new_string):
    try:
        result = _call_tool("edit_file", {"path": _resolve_path(path), "old_string": old_string, "new_string": new_string})
        return {"success": True, "output": result}
    except RuntimeError as e:
        return {"success": False, "error": str(e)}

def write_file(path, content):
    try:
        result = _call_tool("write_file", {"path": _resolve_path(path), "content": content})
        return {"success": True, "output": result}
    except RuntimeError as e:
        return {"success": False, "error": str(e)}

def delete_file(path):
    try:
        result = _call_tool("delete_file", {"path": _resolve_path(path)})
        return {"success": True, "output": result}
    except RuntimeError as e:
        return {"success": False, "error": str(e)}

`;
function makeToolHandlers(cwd) {
    const handlers = new Map();
    handlers.set('read_file', async (p) => {
        const content = await readFile(String(p['path']), 'utf8');
        return content;
    });
    handlers.set('write_file', async (p) => {
        await writeFile(String(p['path']), String(p['content']), 'utf8');
        return 'written';
    });
    handlers.set('edit_file', async (p) => {
        const path = String(p['path']);
        const old = String(p['old_string']);
        const next = String(p['new_string']);
        const content = await readFile(path, 'utf8');
        if (!content.includes(old))
            throw new Error('old_string not found');
        await writeFile(path, content.replace(old, next), 'utf8');
        return 'edited';
    });
    handlers.set('delete_file', async (p) => {
        await unlink(String(p['path']));
        return 'deleted';
    });
    handlers.set('bash', async (p) => {
        const { execSync } = await import('child_process');
        try {
            const out = execSync(String(p['command']), { cwd, timeout: 30000, encoding: 'utf8' });
            return out;
        }
        catch (err) {
            if (err && typeof err === 'object' && 'stdout' in err) {
                return String(err.stdout ?? '');
            }
            throw err;
        }
    });
    handlers.set('grep', async (p) => {
        const { execSync } = await import('child_process');
        const pattern = String(p['pattern']);
        const searchPath = p['path'] ? String(p['path']) : cwd;
        const include = p['include'] ? `--include="${p['include']}"` : '';
        try {
            const out = execSync(`rg -n ${include} "${pattern}" "${searchPath}"`, {
                cwd, timeout: 10000, encoding: 'utf8'
            });
            return out;
        }
        catch {
            return '';
        }
    });
    handlers.set('glob_files', async (p) => {
        const patterns = Array.isArray(p['pattern']) ? p['pattern'].map(String) : [String(p['pattern'])];
        const basePath = p['path'] ? (Array.isArray(p['path']) ? String(p['path'][0]) : String(p['path'])) : cwd;
        const { glob: fsGlob } = await import('fs/promises');
        const results = [];
        for (const pat of patterns) {
            for await (const match of fsGlob(pat, { cwd: basePath })) {
                results.push(resolve(basePath, match));
            }
        }
        return results.join('\n');
    });
    return handlers;
}
export async function handleToolChain(args) {
    const { workflow } = args;
    const cwd = process.cwd();
    // Build full script: preamble + _workflow() wrapper + epilogue
    const indented = workflow.split('\n').map(l => '    ' + l).join('\n');
    const script = `${PYTHON_PREAMBLE}
def _workflow():
${indented}

try:
    _res = _workflow()
    _original_stdout.write(json.dumps({"__done__": True, "result": _res}) + "\\n")
    _original_stdout.flush()
except Exception as _exc:
    import traceback
    _tb = traceback.format_exc()
    print(_tb, file=sys.stderr)
    _original_stdout.write(json.dumps({"__done__": True, "result": "ERROR: " + _tb}) + "\\n")
    _original_stdout.flush()
`;
    const tmpFile = join(tmpdir(), `vix-chain-${randomBytes(4).toString('hex')}.py`);
    await writeFile(tmpFile, script, 'utf8');
    const handlers = makeToolHandlers(cwd);
    return new Promise((resolve, reject) => {
        const child = spawn('python', [tmpFile], {
            cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error('vix_tool_chain: 5-minute timeout exceeded'));
        }, TIMEOUT_MS);
        const rl = createInterface({ input: child.stdout });
        let stderr = '';
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        rl.on('line', async (line) => {
            let msg;
            try {
                msg = JSON.parse(line);
            }
            catch {
                return;
            }
            if (msg['__done__']) {
                clearTimeout(timer);
                await unlink(tmpFile).catch(() => { });
                resolve(JSON.stringify(msg['result']));
                return;
            }
            const callName = String(msg['call'] ?? '');
            const params = (msg['params'] ?? {});
            const handler = handlers.get(callName);
            const resp = handler
                ? await handler(params).then(output => ({ output, is_error: false }), err => ({ output: String(err), is_error: true }))
                : { output: `Tool '${callName}' not allowed in vix_tool_chain`, is_error: true };
            child.stdin.write(JSON.stringify(resp) + '\n');
        });
        child.on('error', (err) => {
            clearTimeout(timer);
            unlink(tmpFile).catch(() => { });
            reject(new Error(`vix_tool_chain: failed to start python: ${err.message}\nstderr: ${stderr}`));
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            unlink(tmpFile).catch(() => { });
            if (code !== 0 && code !== null) {
                reject(new Error(`vix_tool_chain: python exited with code ${code}\nstderr: ${stderr}`));
            }
        });
    });
}
//# sourceMappingURL=vix-tool-chain.js.map