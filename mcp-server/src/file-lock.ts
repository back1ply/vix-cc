// Per-file lock so read→modify→write sequences on the same path don't
// interleave (upstream fileMutexFor).
const fileMutex = new Map<string, Promise<void>>();

export async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = fileMutex.get(path) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => { release = r; });
  fileMutex.set(path, next);
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (fileMutex.get(path) === next) fileMutex.delete(path);
  }
}
