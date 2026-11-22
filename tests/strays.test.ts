import { describe, expect, it } from 'vitest';
import { killStrays, strayKillScript } from '../src/main/strays';

/** How many times a pattern (with the g flag) matches. */
const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;

describe('strayKillScript', () => {
  const script = strayKillScript('C:\\Users\\me\\AppData\\Roaming\\fetchly\\bin');

  it('looks only at the three tools', () => {
    expect(script).toContain("Name='yt-dlp.exe' OR Name='ffmpeg.exe' OR Name='aria2c.exe'");
  });

  it('kills only processes started from the app’s own tool folder', () => {
    expect(script).toContain("$_.ExecutablePath -and $_.ExecutablePath.StartsWith('C:\\Users\\me\\AppData\\Roaming\\fetchly\\bin\\', [System.StringComparison]::OrdinalIgnoreCase)");
    expect(script).toContain('Stop-Process -Id $_.ProcessId -Force');
  });

  it('keeps a quote in the folder name from ending the string', () => {
    expect(strayKillScript("C:\\Users\\O'Neil\\bin")).toContain("StartsWith('C:\\Users\\O''Neil\\bin\\'");
  });

  it('does not double the trailing separator', () => {
    expect(strayKillScript('C:\\x\\bin\\')).toContain("StartsWith('C:\\x\\bin\\'");
  });

  describe('result of the check (B13, C6)', () => {
    const FOLDER = 'C:\\Users\\me\\AppData\\Roaming\\fetchly\\bin';
    const filter = (prefix: string) =>
      `Get-CimInstance Win32_Process -Filter "Name='yt-dlp.exe' OR Name='ffmpeg.exe' OR Name='aria2c.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${prefix}', [System.StringComparison]::OrdinalIgnoreCase) }`;
    /** The exact text of Task 9.1, with the folder (and its trailing backslash) put in. */
    const exact = (prefix: string) =>
      `$ErrorActionPreference='Stop'; $f = { ${filter(prefix)} }; & $f | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 500; if (@(& $f).Count -gt 0) { exit 1 }`;

    it('is exactly the text of the plan', () => {
      expect(strayKillScript(FOLDER)).toBe(exact(`${FOLDER}\\`));
    });

    it('is exactly the text of the plan for a folder with a quote and a trailing separator too', () => {
      expect(strayKillScript("C:\\Users\\O'Neil\\bin\\")).toBe(exact("C:\\Users\\O''Neil\\bin\\"));
    });

    it('stops on a failed query instead of reporting success', () => {
      expect(script.startsWith("$ErrorActionPreference='Stop';")).toBe(true);
      // The one preference line is the very first statement, before the filter is defined.
      expect(script.indexOf('$ErrorActionPreference')).toBe(0);
      expect(count(script, /\$ErrorActionPreference/gu)).toBe(1);
      expect(script.indexOf('$ErrorActionPreference')).toBeLessThan(script.indexOf('$f = {'));
    });

    it('checks again after ending the processes', () => {
      expect(count(script, /& \$f/gu)).toBe(2);
      expect(script).toContain('Start-Sleep -Milliseconds 500');
      expect(script.endsWith('if (@(& $f).Count -gt 0) { exit 1 }')).toBe(true);
    });

    it('queries, ends, waits and only then queries again', () => {
      const ending = script.indexOf('& $f | ForEach-Object');
      const waiting = script.indexOf('Start-Sleep -Milliseconds 500');
      const again = script.indexOf('if (@(& $f).Count -gt 0)');
      expect(script.indexOf('$f = {')).toBeGreaterThan(-1);
      expect(script.indexOf('$f = {')).toBeLessThan(ending);
      expect(ending).toBeLessThan(waiting);
      expect(waiting).toBeLessThan(again);
    });

    it('writes the filter once, inside $f, and runs it twice', () => {
      expect(count(script, /Get-CimInstance/gu)).toBe(1);
      expect(count(script, /Where-Object/gu)).toBe(1);
      expect(count(script, /StartsWith\(/gu)).toBe(1);
      expect(count(script, /ExecutablePath -and/gu)).toBe(1);
      expect(count(script, /\$f/gu)).toBe(3); // the definition and the two runs
      // The filter sits between the braces of the definition.
      const open = script.indexOf('$f = {') + '$f = {'.length;
      const close = script.indexOf('}; & $f');
      expect(script.slice(open, close)).toContain('Get-CimInstance');
      expect(script.slice(open, close)).toContain('StartsWith(');
    });

    it('does not fail on a process that is already gone', () => {
      expect(script).toContain('Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue');
      expect(count(script, /Stop-Process/gu)).toBe(1);
    });

    it('lets the second query decide: it is the only thing that exits with 1', () => {
      expect(count(script, /exit /gu)).toBe(1);
      expect(script).toContain('{ exit 1 }');
      expect(script).not.toContain('exit 0');
    });

    it('waits 500 ms, not another time', () => {
      expect(count(script, /Start-Sleep/gu)).toBe(1);
      expect(script).not.toMatch(/Start-Sleep -Milliseconds (?!500\b)/u);
      expect(script).not.toContain('-Seconds');
    });

    it('still keeps a quote in the folder name out of the one StartsWith', () => {
      const quoted = strayKillScript("C:\\Users\\O'Neil\\bin");
      expect(count(quoted, /O''Neil/gu)).toBe(1);
      expect(quoted).not.toContain("O'Neil"); // the quote only ever appears doubled
    });
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

  it('reports success when the script ran', async () => {
    expect(await killStrays('C:\\x\\bin', async () => undefined)).toBe(true);
  });

  it('reports success only after the script has ended', async () => {
    let finish: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let result: boolean | null = null;
    const pending = killStrays('C:\\x\\bin', () => running).then((r) => {
      result = r;
    });
    await new Promise((r) => setImmediate(r));
    expect(result).toBeNull();
    finish();
    await pending;
    expect(result).toBe(true);
  });

  const FAILURES: [string, () => Promise<void>][] = [
    [
      'PowerShell is missing',
      async () => {
        throw Object.assign(new Error('spawn powershell.exe ENOENT'), { code: 'ENOENT' });
      },
    ],
    [
      'the script exits 1 because a process survived',
      async () => {
        throw Object.assign(new Error('Command failed: powershell.exe'), { code: 1 });
      },
    ],
    [
      'the script exits 1 because the query failed',
      async () => {
        throw Object.assign(new Error('Command failed: powershell.exe'), { code: 1, killed: false });
      },
    ],
    [
      'the 15 s limit ended the script',
      async () => {
        throw Object.assign(new Error('Command failed: powershell.exe'), { killed: true, signal: 'SIGTERM', code: null });
      },
    ],
    [
      'the runner rejects with something that is not an Error',
      () => Promise.reject('refused' as unknown as Error),
    ],
    [
      'the runner rejects with nothing',
      () => Promise.reject(undefined as unknown as Error),
    ],
  ];

  it.each(FAILURES)('reports failure when %s', async (_name, runner) => {
    expect(await killStrays('C:\\x\\bin', runner)).toBe(false);
  });

  it('reports failure when PowerShell cannot be run or a process survived, and never rejects', async () => {
    const failing = killStrays('C:\\x\\bin', async () => {
      throw new Error('powershell missing');
    });
    await expect(failing).resolves.toBe(false);
  });

  it('reports failure when the runner throws before it returns a promise', async () => {
    const throwing = (): Promise<void> => {
      throw new Error('could not start');
    };
    await expect(killStrays('C:\\x\\bin', throwing)).resolves.toBe(false);
  });

  it('runs the script once, with no retry, whether it worked or not (C5)', async () => {
    let calls = 0;
    await killStrays('C:\\x\\bin', async () => void (calls += 1));
    expect(calls).toBe(1);
    calls = 0;
    await killStrays('C:\\x\\bin', async () => {
      calls += 1;
      throw new Error('x');
    });
    expect(calls).toBe(1);
  });

  it('sends the same script to PowerShell when it fails as when it works', async () => {
    const seen: string[][] = [];
    await killStrays('C:\\x\\bin', async (_file, args) => {
      seen.push(args);
      throw new Error('x');
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(['-NoProfile', '-NonInteractive', '-Command', strayKillScript('C:\\x\\bin')]);
  });
});
