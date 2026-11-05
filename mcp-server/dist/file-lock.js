// Per-file lock so read→modify→write sequences on the same path don't
// interleave (upstream fileMutexFor).
const fileMutex = new Map();
export async function withFileLock(path, fn) {
    const prev = fileMutex.get(path) ?? Promise.resolve();
    let release;
    const next = new Promise((r) => { release = r; });
    fileMutex.set(path, next);
    try {
        await prev;
        return await fn();
    }
    finally {
        release();
        if (fileMutex.get(path) === next)
            fileMutex.delete(path);
    }
}
//# sourceMappingURL=file-lock.js.map