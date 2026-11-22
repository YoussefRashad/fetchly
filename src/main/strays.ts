import { execFile } from 'node:child_process';

type Runner = (file: string, args: string[]) => Promise<void>;

/**
 * PowerShell that ends tool processes left over from a run of the app that
 * was killed. Such a process keeps writing its partial file, and resuming the
 * same download next to it would corrupt that file. Only processes started
 * from the app's own tool folder are touched, never the user's own yt-dlp.
 *
 * The filter is written once, in $f, and run twice: once to end what it finds,
 * and again after 500 ms. The script exits 1 when a match is still there, and a
 * failed query ends it with a non-zero code ($ErrorActionPreference='Stop')
 * instead of reading as "none left". A process that already ended while being
 * stopped is not a failure: the second query decides.
 */
export function strayKillScript(binDir: string): string {
  const prefix = `${binDir.replace(/[\\/]+$/u, '')}\\`.replaceAll("'", "''");
  const filter = [
    `Get-CimInstance Win32_Process -Filter "Name='yt-dlp.exe' OR Name='ffmpeg.exe' OR Name='aria2c.exe'"`,
    `Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${prefix}', [System.StringComparison]::OrdinalIgnoreCase) }`,
  ].join(' | ');
  return [
    `$ErrorActionPreference='Stop'`,
    `$f = { ${filter} }`,
    `& $f | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    `Start-Sleep -Milliseconds 500`,
    `if (@(& $f).Count -gt 0) { exit 1 }`,
  ].join('; ');
}

const runPowerShell: Runner = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 15000 }, (err) => (err ? reject(err) : resolve()));
  });

/**
 * Ends leftover tool processes. true = the script ran and exited 0, so no
 * matching process is left; false = PowerShell could not run, the query failed,
 * a process survived or the time limit ended the script. Never rejects: a
 * failure here must never keep the app from starting.
 */
export async function killStrays(binDir: string, run: Runner = runPowerShell): Promise<boolean> {
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', strayKillScript(binDir)]);
    return true;
  } catch {
    return false;
  }
}
