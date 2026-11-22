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

/** `base.ext`, or `base (2).ext`, `base (3).ext`… when taken. Case-insensitive like NTFS. */
export function uniqueName(base: string, ext: string, taken: ReadonlySet<string>): string {
  const lower = new Set([...taken].map((n) => n.toLowerCase()));
  const suffix = ext === '' ? '' : `.${ext}`;
  let candidate = `${base}${suffix}`;
  for (let n = 2; lower.has(candidate.toLowerCase()); n += 1) candidate = `${base} (${n})${suffix}`;
  return candidate;
}
