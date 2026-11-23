import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';

/**
 * Writes `data` to `<path>.tmp` in `dir` (created if missing), flushes it to disk, then renames it over
 * `path`, so a crash leaves either the old file or the new one. Throws on any failure; the old file is
 * then left as it was.
 */
export function writeAtomic(dir: string, path: string, data: string): void {
  mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}
