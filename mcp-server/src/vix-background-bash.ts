import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { createWriteStream } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

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

export async function handleBackgroundBash(
  args: BackgroundBashArgs,
  bashJobs: Map<string, BashJob>
): Promise<string> {
  const { command, timeout = 3600, reason: _reason } = args;
  const clampedTimeout = Math.min(timeout, 3600);

  const id = `vix-bg-${randomBytes(4).toString('hex')}`;
  const jobDir = join(tmpdir(), 'vix-jobs', id);
  const logPath = join(jobDir, 'job.log');
  const rcPath = join(jobDir, 'rc');

  await mkdir(jobDir, { recursive: true });

  // Write command to a script file — avoids quote-escaping issues that arise
  // when passing command strings as argv to cmd.exe on Windows. The shell reads
  // the file directly so paths with spaces work without any extra escaping.
  let shell: string;
  let shellArgs: string[];
  if (process.platform === 'win32') {
    const scriptPath = join(jobDir, 'run.bat');
    await writeFile(scriptPath, `@echo off\r\n${command}\r\n`, 'utf8');
    shell = 'cmd.exe';
    shellArgs = ['/c', scriptPath];
  } else {
    const scriptPath = join(jobDir, 'run.sh');
    await writeFile(scriptPath, `#!/bin/sh\n${command}\n`, 'utf8');
    shell = process.env.SHELL || 'sh';
    shellArgs = [scriptPath];
  }

  const logStream = createWriteStream(logPath);

  const child = spawn(shell, shellArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout!.pipe(logStream);
  child.stderr!.pipe(logStream);
  child.unref();

  const job: BashJob = {
    id,
    pid: child.pid,
    logPath,
    rcPath,
    startedAt: Date.now(),
  };
  bashJobs.set(id, job);

  child.on('close', async (code) => {
    logStream.end();
    try {
      await writeFile(rcPath, String(code ?? -1), 'utf8');
    } catch { /* ignore */ }
  });

  setTimeout(() => {
    if (bashJobs.has(id)) {
      try { child.kill(); } catch { /* ignore */ }
      bashJobs.delete(id);
    }
  }, clampedTimeout * 1000);

  return [
    `job_id: ${id}`,
    `log: ${logPath}`,
    `rc: ${rcPath}`,
    `poll: type "${rcPath}" 2>nul || echo still running`,
    `tail: powershell Get-Content "${logPath}" -Tail 50`,
  ].join('\n');
}

export function killAllJobs(bashJobs: Map<string, BashJob>): void {
  for (const job of bashJobs.values()) {
    if (job.pid != null) {
      try { process.kill(job.pid); } catch { /* ignore */ }
    }
  }
  bashJobs.clear();
}
