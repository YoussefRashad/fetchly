import { win32 } from 'node:path';

const MAX_NAME_LENGTH = 150;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function stripTrailing(name: string): string {
  return name.replace(/[. ]+$/u, '');
}

/** Cuts to at most `max` UTF-16 units without splitting a surrogate pair. */
function truncate(name: string, max: number): string {
  if (name.length <= max) return name;
  let cut = name.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}

/** Turns any title into a name Windows accepts for a file or folder. */
export function sanitizeName(raw: string): string {
  let name = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  name = stripTrailing(truncate(stripTrailing(name), MAX_NAME_LENGTH));
  if (name === '') return 'untitled';
  const stem = name.split('.')[0] ?? name;
  if (RESERVED.test(stem.trim())) name = `_${name}`;
  return name;
}

/** `NN - title` inside a playlist, the bare title outside one. */
export function itemBaseName(title: string, index: number | null, total: number | null): string {
  const clean = sanitizeName(title);
  if (index === null) return clean;
  const width = Math.max(2, String(total ?? index).length);
  return `${String(index).padStart(width, '0')} - ${clean}`;
}

const MAX_EXT_LENGTH = 16;
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]/gu;

/**
 * Turns a name chosen by a server or sent by the window into one Windows file name:
 * the last path segment only, no forbidden character, an extension of at most 16
 * characters, at most 150 characters in all, no trailing dot or space, no device
 * name. Applying it twice gives the same result.
 */
export function sanitizeFileName(raw: string): string {
  const leaf = raw.split(/[\\/]/u).pop() ?? '';
  // Split before trimming the start, so that `???.pdf` keeps its extension.
  const cleaned = stripTrailing(leaf.replace(FORBIDDEN, ' ').replace(/\s+/gu, ' '));
  const dot = cleaned.lastIndexOf('.');
  const ext = dot <= 0 ? '' : truncate(cleaned.slice(dot + 1).replace(/\s+/gu, ''), MAX_EXT_LENGTH);
  const room = MAX_NAME_LENGTH - (ext === '' ? 0 : ext.length + 1);
  const rawStem = (dot <= 0 ? cleaned : cleaned.slice(0, dot)).trim();
  let stem = stripTrailing(truncate(stripTrailing(rawStem), room));
  if (stem === '') stem = 'download';
  if (RESERVED.test((stem.split('.')[0] ?? stem).trim())) stem = `_${stripTrailing(truncate(stem, room - 1))}`;
  return ext === '' ? stem : `${stem}.${ext}`;
}

/** One key per folder however it is spelled: resolved, lower-cased like NTFS compares. */
export function dirKey(dir: string): string {
  return win32.resolve(dir).toLowerCase();
}

/**
 * Whether `candidate` would share files with a name already used in the same folder.
 * Another job's name `c` collides when it is equal, or when either name is the other
 * plus a dot and more (`Clip` and `Clip.f137`: one job's parts look like the other's).
 * A file `d` on disk collides when it is equal or starts with `candidate.`: the
 * output or a partial file of a job with that name. Case-insensitive.
 */
export function nameConflicts(candidate: string, claims: Iterable<string>, disk: Iterable<string>): boolean {
  const cand = candidate.toLowerCase();
  for (const claim of claims) {
    const c = claim.toLowerCase();
    if (c === cand || cand.startsWith(`${c}.`) || c.startsWith(`${cand}.`)) return true;
  }
  for (const file of disk) {
    const d = file.toLowerCase();
    if (d === cand || d.startsWith(`${cand}.`)) return true;
  }
  return false;
}

/**
 * The first free name among `base.ext`, then for n = 2, 3…: `base (n).ext` and
 * `head (n)tail.ext`, where `head` is `base` up to its first dot. The second form is
 * the one that frees a name that extends another job's name (`Clip.f137` next to
 * `Clip` becomes `Clip (2).f137`).
 */
export function freeName(base: string, ext: string, taken: (name: string) => boolean): string {
  const suffix = ext === '' ? '' : `.${ext}`;
  if (!taken(`${base}${suffix}`)) return `${base}${suffix}`;
  const dot = base.indexOf('.');
  const head = dot < 0 ? base : base.slice(0, dot) || '_';
  const tail = dot < 0 ? '' : base.slice(dot);
  for (let n = 2; ; n += 1) {
    const plain = `${base} (${n})${suffix}`;
    if (!taken(plain)) return plain;
    const split = `${head} (${n})${tail}${suffix}`;
    if (dot >= 0 && !taken(split)) return split;
  }
}

/** Kept until the queue moves to `freeName` with the folder's claims and files. */
export function uniqueName(base: string, ext: string, taken: ReadonlySet<string>): string {
  const lower = new Set([...taken].map((n) => n.toLowerCase()));
  return freeName(base, ext, (name) => lower.has(name.toLowerCase()));
}
