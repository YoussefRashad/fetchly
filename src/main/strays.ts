import { execFile } from 'node:child_process';

type Runner = (file: string, args: string[]) => Promise<void>;

/**
 * PowerShell that ends tool processes left over from a run of the app that
 * was killed. Such a process keeps writing its partial file, and resuming the
 * same download next to it would corrupt that file. Only processes started
 * from the app's own tool folder are touched, never the user's own yt-dlp.
 */
export function strayKillScript(binDir: string): string {
  const prefix = `${binDir.replace(/[\\/]+$/u, '')}\\`.replaceAll("'", "''");
  return [
    `Get-CimInstance Win32_Process -Filter "Name='yt-dlp.exe' OR Name='ffmpeg.exe' OR Name='aria2c.exe'"`,
    `Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${prefix}', [System.StringComparison]::OrdinalIgnoreCase) }`,
    `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
  ].join(' | ');
}

const runPowerShell: Runner = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 15000 }, (err) => (err ? reject(err) : resolve()));
  });

/** Best effort: a failure here must never keep the app from starting. */
export async function killStrays(binDir: string, run: Runner = runPowerShell): Promise<void> {
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', strayKillScript(binDir)]);
  } catch {
    // PowerShell missing or blocked: carry on without the cleanup.
  }
}
