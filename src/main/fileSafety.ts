import { writeFileSync } from 'node:fs';
import { extname } from 'node:path';

/**
 * File types that Windows runs, installs, mounts or follows when opened, rather than shows.
 * Opening one of these from a download asks the user first.
 */
const RUNNABLE = new Set([
  '.appref-ms', '.application', '.appx', '.appxbundle', '.bat', '.chm', '.cmd', '.com', '.cpl',
  '.gadget', '.hta', '.img', '.inf', '.iso', '.jar', '.js', '.jse', '.library-ms', '.lnk', '.msc',
  '.msi', '.msix', '.msixbundle', '.msp', '.mst', '.pif', '.ps1', '.psd1', '.psm1', '.reg', '.scf',
  '.scr', '.search-ms', '.settingcontent-ms', '.url', '.vbe', '.vbs', '.vhd', '.vhdx', '.ws', '.wsc',
  '.wsf', '.wsh', '.xll', '.exe',
]);

/** True when opening `fileName` could run a program. Case and trailing dots or spaces are ignored, as Windows ignores them. */
export function isRunnableFile(fileName: string): boolean {
  return RUNNABLE.has(extname(fileName.replace(/[. ]+$/u, '')).toLowerCase());
}

/**
 * The Zone.Identifier text Windows reads to treat a file as downloaded from the internet
 * (zone 3), so SmartScreen and Office Protected View still apply to it. User name and password
 * are left out of the link; a link that does not parse is recorded as about:internet.
 */
export function zoneIdentifier(url: string): string {
  let host = 'about:internet';
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    host = u.href;
  } catch {
    // keep about:internet
  }
  // eslint-disable-next-line no-control-regex
  host = host.replace(/[\u0000-\u001f\u007f]/gu, '');
  return `[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=${host}\r\n`;
}

/**
 * Marks a finished download as coming from the internet (Mark-of-the-Web) on Windows. Best effort:
 * a drive without alternate data streams (FAT32, some network shares) cannot hold the mark, and
 * that never fails the download. Returns whether the mark was written.
 */
export function markFromInternet(
  path: string,
  url: string,
  opts: { platform?: NodeJS.Platform; write?: (path: string, data: string) => void } = {},
): boolean {
  if ((opts.platform ?? process.platform) !== 'win32') return false;
  try {
    (opts.write ?? ((p, d) => writeFileSync(p, d)))(`${path}:Zone.Identifier`, zoneIdentifier(url));
    return true;
  } catch {
    return false;
  }
}
