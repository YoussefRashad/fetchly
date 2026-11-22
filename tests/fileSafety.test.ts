import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isRunnableFile, markFromInternet, zoneIdentifier } from '../src/main/fileSafety';

describe('isRunnableFile', () => {
  it.each([
    'setup.exe', 'SETUP.EXE', 'run.bat', 'run.cmd', 'x.com', 'saver.scr', 'old.pif', 'tool.msi', 'patch.msp',
    'app.msix', 'app.appx', 'Invoice.pdf.lnk', 'site.url', 'page.hta', 'a.js', 'a.jse', 'a.vbs', 'a.vbe',
    'a.wsf', 'a.ps1', 'a.psm1', 'a.reg', 'a.cpl', 'a.jar', 'a.scf', 'a.inf', 'a.chm', 'disk.iso', 'disk.img',
    'disk.vhd', 'disk.vhdx', 'a.application', 'a.appref-ms', 'a.settingcontent-ms', 'a.library-ms', 'a.xll',
  ])('treats %s as runnable', (name) => {
    expect(isRunnableFile(name)).toBe(true);
  });

  it.each(['tool.exe.', 'tool.exe ', 'tool.exe. . ', 'Tool.ExE'])('ignores case and trailing dots or spaces: %j', (name) => {
    expect(isRunnableFile(name)).toBe(true);
  });

  it.each(['Talk.mp4', 'song.mp3', 'book.pdf', 'archive.zip', 'notes.txt', 'photo.jpg', 'exe', 'setup.exe.mp4', 'README'])(
    'does not ask about %s',
    (name) => {
      expect(isRunnableFile(name)).toBe(false);
    },
  );
});

describe('zoneIdentifier', () => {
  it('marks the file as zone 3 with the link it came from', () => {
    expect(zoneIdentifier('https://example.com/files/setup.exe')).toBe(
      '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://example.com/files/setup.exe\r\n',
    );
  });

  it('leaves the user name and password out of the link', () => {
    expect(zoneIdentifier('https://me:secret@example.com/a.zip')).toBe('[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://example.com/a.zip\r\n');
  });

  it('records a link that does not parse as about:internet', () => {
    expect(zoneIdentifier('not a link')).toBe('[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=about:internet\r\n');
  });

  it('never lets the link add a line of its own', () => {
    const text = zoneIdentifier('https://example.com/a\r\nZoneId=0.zip');
    expect(text.split('\r\n')).toHaveLength(4);
    expect(text).toContain('ZoneId=3\r\n');
    expect(text).not.toContain('\r\nZoneId=0');
  });
});

describe('markFromInternet', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('writes the Zone.Identifier stream next to the file on Windows', () => {
    const writes: [string, string][] = [];
    const marked = markFromInternet('D:\\Dl\\setup.exe', 'https://example.com/setup.exe', {
      platform: 'win32',
      write: (p, d) => void writes.push([p, d]),
    });
    expect(marked).toBe(true);
    expect(writes).toEqual([['D:\\Dl\\setup.exe:Zone.Identifier', zoneIdentifier('https://example.com/setup.exe')]]);
  });

  it('does nothing off Windows', () => {
    const writes: string[] = [];
    expect(markFromInternet('/dl/a.zip', 'https://example.com/a.zip', { platform: 'linux', write: (p) => void writes.push(p) })).toBe(false);
    expect(writes).toEqual([]);
  });

  it('returns false, without throwing, when the drive cannot hold the mark', () => {
    const write = (): void => {
      throw new Error('EINVAL: invalid argument');
    };
    expect(markFromInternet('E:\\a.zip', 'https://example.com/a.zip', { platform: 'win32', write })).toBe(false);
  });

  it.runIf(process.platform === 'win32')('really writes the stream on an NTFS drive', () => {
    dir = mkdtempSync(join(tmpdir(), 'fetchly-motw-'));
    const file = join(dir, 'setup.exe');
    writeFileSync(file, 'MZ');
    expect(markFromInternet(file, 'https://example.com/setup.exe')).toBe(true);
    expect(readFileSync(`${file}:Zone.Identifier`, 'utf8')).toBe(zoneIdentifier('https://example.com/setup.exe'));
    expect(readFileSync(file, 'utf8')).toBe('MZ');
  });
});
