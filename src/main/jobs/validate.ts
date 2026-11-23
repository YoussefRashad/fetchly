import { win32 } from 'node:path';
import { DEFAULT_SERVER_PORT, isServerPort } from '../../shared/protocol';
import { CONTROL } from '../../shared/text';
import { isLanguageSetting, isThemeSetting } from '../../shared/i18n';
import { HEIGHTS, type Group, type Job, type JobKind, type JobState, type Quality, type Settings, type Snapshot } from '../../shared/types';

type Obj = Record<string, unknown>;

const JOB_STATES: readonly JobState[] = ['queued', 'probing', 'downloading', 'paused', 'merging', 'done', 'failed', 'skipped'];
const JOB_KINDS: readonly JobKind[] = ['media', 'file'];
const BASE_NAME_FORBIDDEN = /[\\/:*?"<>|]/u;
const FILE_NAME_FORBIDDEN = /[\\/:]/u;

function isPlainObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isNonNegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const orNull =
  <T>(check: (v: unknown) => v is T) =>
  (v: unknown): v is T | null =>
    v === null || check(v);

export function isQuality(v: unknown): v is Quality {
  if (!isPlainObject(v)) return false;
  if (v['kind'] === 'best') return true;
  if (v['kind'] === 'max') return (HEIGHTS as readonly unknown[]).includes(v['height']);
  if (v['kind'] === 'audio') return v['format'] === 'm4a' || v['format'] === 'mp3';
  return false;
}

/**
 * A new Quality with its declared fields only, so no extra key is carried into the
 * next save. Expects a value isQuality accepted.
 */
export function copyQuality(q: Quality): Quality {
  if (q.kind === 'max') return { kind: 'max', height: q.height };
  if (q.kind === 'audio') return { kind: 'audio', format: q.format };
  return { kind: 'best' };
}

/**
 * Checks a list one position at a time, so a hole reads as undefined and fails the
 * check. every, some, map and filter skip holes, so they are never used for lists
 * that come from the window.
 */
export function everyPosition(list: readonly unknown[], check: (v: unknown) => boolean): boolean {
  for (let i = 0; i < list.length; i += 1) {
    if (!check(list[i])) return false;
  }
  return true;
}

const isLangCode = (l: unknown): boolean => typeof l === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/u.test(l);

/** Language codes only (en, ar, pt-BR): they end up on yt-dlp's command line. A hole fails. */
export function isLangList(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= 10 && everyPosition(v, isLangCode);
}

export function isAbsoluteDir(v: unknown): v is string {
  return typeof v === 'string' && win32.isAbsolute(v);
}

/**
 * An http(s) link by the rule the window's links are checked with (validateUrl):
 * trimmed first, so a link with spaces around it that IPC accepted loads again.
 * The caller keeps the stored url as it was.
 */
function isHttpUrl(v: string): boolean {
  try {
    const { protocol } = new URL(v.trim());
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** A media job's name without extension, as the app gives it: one Windows name segment. */
function isBaseName(v: unknown): v is string {
  return isString(v) && v !== '' && v.length <= 200 && !BASE_NAME_FORBIDDEN.test(v) && !CONTROL.test(v) && !/[. ]$/u.test(v);
}

/**
 * A stored file name only has to stay inside its folder, with no length cap: names
 * saved by earlier versions may be longer than today's limit or be a device name.
 * The length and device-name rules apply when a job is added (sanitizeFileName).
 */
function isStoredFileName(v: unknown): v is string {
  return isString(v) && v !== '' && v !== '.' && v !== '..' && !FILE_NAME_FORBIDDEN.test(v) && !CONTROL.test(v);
}

/**
 * The name a new `done` event may save: the stored-name rule, and not made only of
 * whitespace and dots (no usable file has such a name). Old stored names are not
 * held to this; they only need isStoredFileName.
 */
export function isUsableDoneName(v: unknown): v is string {
  return isStoredFileName(v) && !/^[\s.]*$/u.test(v);
}

/** A count or duration: finite and >= 0. */
const meter = (v: unknown): number | null => (isNonNegative(v) ? v : null);
/** A height: finite and > 0. */
const height = (v: unknown): number | null => (isPositive(v) ? v : null);

function parseGroup(raw: unknown): Group | null {
  if (!isPlainObject(raw)) return null;
  const { id, title, url, dir, createdAt } = raw;
  if (!isString(id) || id === '' || !isString(title) || !isString(url) || !isAbsoluteDir(dir)) return null;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
  return { id, title, url, dir, createdAt };
}

function parseJob(raw: unknown, groupIds: ReadonlySet<string>): Job | null {
  if (!isPlainObject(raw)) return null;
  const r = raw;
  const kind = r['kind'];
  const state = r['state'];
  if (!JOB_KINDS.includes(kind as JobKind) || !JOB_STATES.includes(state as JobState)) return null;

  const id = r['id'];
  const groupId = r['groupId'];
  const url = r['url'];
  const quality = r['quality'];
  const baseName = r['baseName'];
  const fileName = r['fileName'];
  const index = r['index'];
  const attempts = r['attempts'];
  const createdAt = r['createdAt'];
  // Added after the first version: only an absent value means the old default.
  // (JSON has no undefined, so undefined is the key being absent.)
  const interrupted = r['interrupted'] === undefined ? false : r['interrupted'];

  const media = kind === 'media';
  const valid =
    isString(id) &&
    id !== '' &&
    (groupId === null || (isString(groupId) && groupIds.has(groupId))) &&
    isString(url) &&
    // A skipped placeholder keeps whatever the playlist gave it (often '' or a bare id).
    (state === 'skipped' || isHttpUrl(url)) &&
    isString(r['title']) &&
    orNull(isString)(r['reason']) &&
    (media ? isQuality(quality) : quality === null) &&
    isLangList(r['subtitleLangs']) &&
    isAbsoluteDir(r['dir']) &&
    (media ? isBaseName(baseName) : baseName === null) &&
    (media ? orNull(isStoredFileName)(fileName) : isStoredFileName(fileName)) &&
    (index === null || (Number.isInteger(index) && (index as number) >= 1)) &&
    typeof r['resumable'] === 'boolean' &&
    typeof interrupted === 'boolean' &&
    Number.isInteger(attempts) &&
    (attempts as number) >= 0 &&
    typeof createdAt === 'number' &&
    Number.isFinite(createdAt);
  if (!valid) return null;

  // Built from known keys only, so nothing unknown is carried into the next save.
  // The meters only describe progress: a value out of range becomes its neutral value
  // instead of setting the whole list aside.
  return {
    id: id as string,
    groupId: groupId as string | null,
    kind: kind as JobKind,
    url: url as string,
    title: r['title'] as string,
    state: state as JobState,
    reason: r['reason'] as string | null,
    quality: quality === null ? null : copyQuality(quality as Quality),
    subtitleLangs: [...(r['subtitleLangs'] as string[])],
    dir: r['dir'] as string,
    baseName: baseName as string | null,
    fileName: fileName as string | null,
    index: index as number | null,
    bytesDone: meter(r['bytesDone']) ?? 0,
    bytesTotal: meter(r['bytesTotal']),
    speed: meter(r['speed']) ?? 0,
    eta: meter(r['eta']),
    actualHeight: height(r['actualHeight']),
    resumable: r['resumable'] as boolean,
    attempts: attempts as number,
    createdAt: createdAt as number,
    interrupted: interrupted as boolean,
    sourceHeight: height(r['sourceHeight']),
  };
}

/**
 * Reads the contents of jobs.json. Any invalid job or group makes the whole file
 * invalid (null), so the caller can set it aside untouched for repair by hand.
 * Groups without members are dropped. A file of the first version, without the
 * fields added since, is valid. The six meters (bytesDone, bytesTotal, speed, eta,
 * actualHeight, sourceHeight) never make a job invalid: a bad one is loaded as 0 or null.
 */
export function parseSnapshotFile(raw: unknown): Snapshot | null {
  if (!isPlainObject(raw)) return null;
  if (raw['version'] !== undefined && raw['version'] !== 1) return null;
  const rawJobs = raw['jobs'];
  const rawGroups = raw['groups'];
  if (!Array.isArray(rawJobs) || !Array.isArray(rawGroups)) return null;

  const groups: Group[] = [];
  for (const g of rawGroups) {
    const group = parseGroup(g);
    if (!group || groups.some((x) => x.id === group.id)) return null;
    groups.push(group);
  }
  const groupIds = new Set(groups.map((g) => g.id));

  const jobs: Job[] = [];
  const ids = new Set<string>();
  for (const j of rawJobs) {
    const job = parseJob(j, groupIds);
    if (!job || ids.has(job.id)) return null;
    ids.add(job.id);
    jobs.push(job);
  }
  const used = new Set(jobs.map((j) => j.groupId));
  return { jobs, groups: groups.filter((g) => used.has(g.id)) };
}

const SETTING_CHECKS: { [K in keyof Settings]: (v: unknown) => boolean } = {
  language: isLanguageSetting,
  theme: isThemeSetting,
  downloadDir: isAbsoluteDir,
  askEveryTime: (v) => typeof v === 'boolean',
  maxConcurrent: (v) => typeof v === 'number' && Number.isFinite(v),
  speedLimitKbps: (v) => typeof v === 'number' && Number.isFinite(v),
  autoResumeOnStart: (v) => typeof v === 'boolean',
  preferMp4Max1080: (v) => typeof v === 'boolean',
  defaultQuality: isQuality,
  subtitleLangs: isLangList,
  serverPort: isServerPort,
};

/**
 * Clamps the numeric settings into their allowed ranges. An invalid server port becomes the default
 * port, never a clamped one: a clamp could land on a port another program uses.
 */
export function normalizeSettings(s: Settings): Settings {
  const max = Number.isFinite(s.maxConcurrent) ? Math.floor(s.maxConcurrent) : 3;
  const limit = Number.isFinite(s.speedLimitKbps) ? Math.floor(s.speedLimitKbps) : 0;
  return {
    ...s,
    maxConcurrent: Math.min(8, Math.max(1, max)),
    speedLimitKbps: Math.max(0, limit),
    serverPort: isServerPort(s.serverPort) ? s.serverPort : DEFAULT_SERVER_PORT,
  };
}

/** Reads the contents of settings.json: each invalid or missing field falls back to its default alone. */
export function parseSettings(raw: unknown, defaults: Settings): Settings {
  const merged: Settings = { ...defaults };
  if (isPlainObject(raw)) {
    for (const key of Object.keys(SETTING_CHECKS) as (keyof Settings)[]) {
      if (SETTING_CHECKS[key](raw[key])) Object.assign(merged, { [key]: raw[key] });
    }
  }
  return normalizeSettings({ ...merged, defaultQuality: copyQuality(merged.defaultQuality), subtitleLangs: [...merged.subtitleLangs] });
}
