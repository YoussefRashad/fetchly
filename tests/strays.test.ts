import { describe, expect, it } from 'vitest';
import { killStrays, strayKillScript } from '../src/main/strays';

describe('strayKillScript', () => {
  const script = strayKillScript('C:\\Users\\me\\AppData\\Roaming\\hammel\\bin');

  it('looks only at the three tools', () => {
    expect(script).toContain("Name='yt-dlp.exe' OR Name='ffmpeg.exe' OR Name='aria2c.exe'");
  });

  it('kills only processes started from the app’s own tool folder', () => {
    expect(script).toContain("$_.ExecutablePath -and $_.ExecutablePath.StartsWith('C:\\Users\\me\\AppData\\Roaming\\hammel\\bin\\', [System.StringComparison]::OrdinalIgnoreCase)");
    expect(script).toContain('Stop-Process -Id $_.ProcessId -Force');
  });

  it('keeps a quote in the folder name from ending the string', () => {
    expect(strayKillScript("C:\\Users\\O'Neil\\bin")).toContain("StartsWith('C:\\Users\\O''Neil\\bin\\'");
  });

  it('does not double the trailing separator', () => {
    expect(strayKillScript('C:\\x\\bin\\')).toContain("StartsWith('C:\\x\\bin\\'");
  });
});

describe('killStrays', () => {
  it('runs the script through PowerShell without a profile', async () => {
    const calls: { file: string; args: string[] }[] = [];
    await killStrays('C:\\x\\bin', async (file, args) => void calls.push({ file, args }));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe('powershell.exe');
    expect(calls[0]?.args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command']);
    expect(calls[0]?.args[3]).toBe(strayKillScript('C:\\x\\bin'));
  });

  it('never fails startup when PowerShell cannot be run', async () => {
    await expect(
      killStrays('C:\\x\\bin', async () => {
        throw new Error('powershell missing');
      }),
    ).resolves.toBeUndefined();
  });
});
