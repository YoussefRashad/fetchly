import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isLanguageSetting, isThemeSetting } from '../shared/i18n';
import {
  type AddRequest,
  type AppStatus,
  type BinName,
  type BinStatus,
  type EngineStatus,
  type EntryReason,
  type GroupVerb,
  type JobVerb,
  type PlaylistEntry,
  type ProbeResult,
  type Quality,
  type Result,
  type Settings,
  type Snapshot,
} from '../shared/types';
import { isRunnableFile } from './fileSafety';
import { normalizeSettings } from './jobs/store';
import { copyQuality, everyPosition, isAbsoluteDir, isLangList, isQuality } from './jobs/validate';
import { sanitizeFileName } from './naming';
import { InvalidUrl, ProbeError } from './probe';
import { MAX_HEIGHTS } from './ytdlp/parse';

/** The part of the queue the window can reach. */
export interface QueueLike {
  add(req: AddRequest): void;
  job(id: string, verb: JobVerb): Promise<Result<null>>;
  group(id: string, verb: GroupVerb): Promise<Result<null>>;
  /** The user ended the leftover tool processes by hand. */
  confirmStraysGone(): void;
  snapshot(): Snapshot;
  setSettings(s: Settings): void;
}

export interface HandlerDeps {
  /** null until the engines started once; kept after an aria2 exit */
  queue(): QueueLike | null;
  /** The engine status from the host and the last save error. */
  status(): AppStatus;
  /** Starts the engines again after an error (the host's retry); never rejects. */
  retryEngines(): Promise<void>;
  getSettings(): Settings;
  saveSettings(s: Settings): void;
  validateUrl(raw: string): string;
  probe(url: string): Promise<ProbeResult>;
  binaries: {
    status(): Promise<BinStatus[]>;
    ensureAll(onProgress: (name: BinName, pct: number) => void): Promise<void>;
    updateYtDlp(): Promise<string>;
  };
  onInstallProgress(name: BinName, pct: number): void;
  /** starts the engines once the tools are in place (the host's start); never rejects, the outcome is status() */
  afterInstall(): Promise<void>;
  pickFolder(): Promise<string | null>;
  openPath(path: string): Promise<void>;
  /** Asks the user before a downloaded file that can run a program is opened; true = open it. */
  confirmOpenRunnable(fileName: string): Promise<boolean>;
  showItem(path: string): void;
  startupNotice(): string | null;
}

const JOB_VERBS: readonly string[] = ['pause', 'resume', 'cancel', 'retry', 'remove', 'removeWithFile'];
const GROUP_VERBS: readonly string[] = ['pause', 'resume', 'cancel'];
const BAD_REQUEST = 'That request is not valid';

/** The engine status in words: why a handler that needs the queue cannot run, or why a start did not work. */
function statusText(engine: EngineStatus): string {
  if (engine.state === 'notInstalled') return 'Install the download tools first';
  if (engine.state === 'error') return engine.message;
  // 'ready' always comes with a queue, so only 'starting' really reaches this line.
  return 'The download tools are still starting';
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/u;

/** C3: a link that, trimmed, still holds a control character never reaches the queue or a spawn. */
const hasControl = (url: string): boolean => CONTROL.test(url.trim());

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function describe(e: unknown): string {
  if (e instanceof InvalidUrl) return 'Enter a link that starts with http:// or https://';
  if (e instanceof ProbeError) return e.reason;
  return `Something went wrong: ${e instanceof Error ? e.message : String(e)}`;
}

/** Runs a handler body and turns anything thrown into a Result, so nothing throws across IPC. */
async function guarded<T>(body: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await body();
  } catch (e) {
    return fail(describe(e));
  }
}

const ENTRY_REASONS: readonly unknown[] = ['private', 'removed', 'unavailable'] satisfies EntryReason[];

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function acceptsUrl(url: string, validateUrl: (raw: string) => string): boolean {
  try {
    validateUrl(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * One playlist entry as the probe gives it; a placeholder (unavailable) may carry any
 * string url. An available entry's url must be a link without a control character (C3).
 */
function validEntry(e: unknown, validateUrl: (raw: string) => string): e is PlaylistEntry {
  if (!isObject(e)) return false;
  const { index, title, url, unavailable, reason } = e;
  if (!Number.isInteger(index) || (index as number) < 1) return false;
  if (typeof title !== 'string' || typeof url !== 'string' || typeof unavailable !== 'boolean') return false;
  if (unavailable) return ENTRY_REASONS.includes(reason);
  return reason === null && !hasControl(url) && acceptsUrl(url, validateUrl);
}

/**
 * A probe sent back by the window. It may only describe jobs the stored list loads
 * again: a file name exactly as sanitizeFileName gives it, finite counts and heights,
 * whole and unique playlist positions. Lists are checked one position at a time
 * (everyPosition), so a hole fails.
 */
function validProbe(probe: unknown, validateUrl: (raw: string) => string): probe is ProbeResult {
  if (!isObject(probe)) return false;
  if (probe['kind'] === 'media') {
    const heights = probe['heights'];
    return (
      typeof probe['title'] === 'string' &&
      Array.isArray(heights) &&
      heights.length <= MAX_HEIGHTS &&
      everyPosition(heights, (h) => isFiniteNumber(h) && h > 0)
    );
  }
  if (probe['kind'] === 'file') {
    const { fileName, size, resumable } = probe;
    return (
      typeof fileName === 'string' &&
      fileName === sanitizeFileName(fileName) &&
      (size === null || (isFiniteNumber(size) && size >= 0)) &&
      typeof resumable === 'boolean'
    );
  }
  if (probe['kind'] === 'playlist') {
    const entries = probe['entries'];
    if (typeof probe['title'] !== 'string' || !Array.isArray(entries)) return false;
    if (!everyPosition(entries, (e) => validEntry(e, validateUrl))) return false;
    const positions = new Set<number>();
    for (const e of entries as PlaylistEntry[]) positions.add(e.index);
    return positions.size === entries.length;
  }
  return false;
}

export function createHandlers(deps: HandlerDeps) {
  /** The answer of a handler that needs the queue while there is none. */
  const noQueue = (): Result<never> => fail(statusText(deps.status().engine));

  /** The window's link checked and trimmed; a control character inside it is refused like any bad link (C3). */
  const linkOf = (raw: string): string => {
    if (hasControl(raw)) throw new InvalidUrl();
    return deps.validateUrl(raw);
  };

  return {
    probe: (raw: string): Promise<Result<ProbeResult>> =>
      guarded(async () => {
        if (typeof raw !== 'string') return fail(describe(new InvalidUrl()));
        return ok(await deps.probe(linkOf(raw)));
      }),

    add: (req: AddRequest): Promise<Result<null>> =>
      guarded(async () => {
        if (!isObject(req) || typeof req.url !== 'string') return fail(BAD_REQUEST);
        const queue = deps.queue();
        if (!queue) return noQueue();

        const url = linkOf(req.url);
        if (!validProbe(req.probe, deps.validateUrl)) return fail(BAD_REQUEST);
        if (!isAbsoluteDir(req.dir)) return fail('Choose a download folder');
        if (!isLangList(req.subtitleLangs)) return fail('Subtitle languages must be codes like en or ar');
        let quality: Quality | null = null;
        if (req.probe.kind !== 'file') {
          if (!isQuality(req.quality)) return fail(BAD_REQUEST);
          // Rebuilt from its declared fields, so nothing else reaches the next save (C2).
          quality = copyQuality(req.quality);
        }

        let selected: number[] | null = null;
        if (req.probe.kind === 'playlist') {
          const available = new Set(req.probe.entries.filter((e) => !e.unavailable).map((e) => e.index));
          const wanted = req.selectedIndexes ?? [...available];
          // One position at a time, so a hole fails instead of being skipped.
          if (!Array.isArray(wanted) || !everyPosition(wanted, (i) => typeof i === 'number' && available.has(i))) return fail(BAD_REQUEST);
          if (wanted.length === 0) return fail('Select at least one item');
          selected = wanted;
        }

        try {
          mkdirSync(req.dir, { recursive: true });
        } catch {
          return fail('cannot write to folder');
        }
        queue.add({
          url,
          probe: req.probe,
          quality,
          subtitleLangs: req.subtitleLangs,
          dir: req.dir,
          selectedIndexes: selected,
        });
        return ok(null);
      }),

    job: (id: string, verb: JobVerb): Promise<Result<null>> =>
      guarded(async () => {
        if (typeof id !== 'string' || !JOB_VERBS.includes(verb)) return fail(BAD_REQUEST);
        const queue = deps.queue();
        if (!queue) return noQueue();
        return queue.job(id, verb);
      }),

    group: (id: string, verb: GroupVerb): Promise<Result<null>> =>
      guarded(async () => {
        if (typeof id !== 'string' || !GROUP_VERBS.includes(verb)) return fail(BAD_REQUEST);
        const queue = deps.queue();
        if (!queue) return noQueue();
        return queue.group(id, verb);
      }),

    confirmStraysGone: (): Promise<Result<null>> =>
      guarded(async () => {
        const queue = deps.queue();
        if (!queue) return noQueue();
        queue.confirmStraysGone();
        return ok(null);
      }),

    status: async (): Promise<AppStatus> => deps.status(),

    /** Answers by the status after the host's retry: ok only when the engines are ready. */
    retryEngines: (): Promise<Result<null>> =>
      guarded(async () => {
        await deps.retryEngines();
        const { engine } = deps.status();
        return engine.state === 'ready' ? ok(null) : fail(statusText(engine));
      }),

    snapshot: async (): Promise<Snapshot> => deps.queue()?.snapshot() ?? { jobs: [], groups: [] },

    getSettings: async (): Promise<Settings> => deps.getSettings(),

    setSettings: (s: Settings): Promise<Result<Settings>> =>
      guarded(async () => {
        if (!isObject(s)) return fail(BAD_REQUEST);
        if (!isLanguageSetting(s.language) || !isThemeSetting(s.theme)) return fail(BAD_REQUEST);
        if (!isAbsoluteDir(s.downloadDir)) return fail('Choose a download folder');
        if (!isQuality(s.defaultQuality)) return fail(BAD_REQUEST);
        if (!isLangList(s.subtitleLangs)) return fail('Subtitle languages must be codes like en or ar');
        const next = normalizeSettings({
          language: s.language,
          theme: s.theme,
          downloadDir: s.downloadDir,
          askEveryTime: s.askEveryTime === true,
          maxConcurrent: Number(s.maxConcurrent),
          speedLimitKbps: Number(s.speedLimitKbps),
          autoResumeOnStart: s.autoResumeOnStart === true,
          preferMp4Max1080: s.preferMp4Max1080 === true,
          // Rebuilt from its declared fields, so nothing else reaches settings.json or the queue (C2).
          defaultQuality: copyQuality(s.defaultQuality),
          subtitleLangs: s.subtitleLangs,
        });
        deps.saveSettings(next);
        deps.queue()?.setSettings(next);
        return ok(next);
      }),

    pickFolder: (): Promise<string | null> => deps.pickFolder(),

    // The window only ever names a job; the path is worked out here.
    openFile: (jobId: string): Promise<Result<null>> =>
      guarded(async () => {
        const job = deps.queue()?.snapshot().jobs.find((j) => j.id === jobId);
        if (!job || job.state !== 'done' || job.fileName === null) return fail('This download is not finished');
        const path = join(job.dir, job.fileName);
        if (!existsSync(path)) return fail('The file is no longer there');
        // A program, shortcut, script or disk image runs only after the user says yes.
        if (isRunnableFile(job.fileName) && !(await deps.confirmOpenRunnable(job.fileName))) return ok(null);
        await deps.openPath(path);
        return ok(null);
      }),

    openFolder: (jobId: string): Promise<Result<null>> =>
      guarded(async () => {
        const job = deps.queue()?.snapshot().jobs.find((j) => j.id === jobId);
        if (!job) return fail(BAD_REQUEST);
        const file = job.state === 'done' && job.fileName !== null ? join(job.dir, job.fileName) : null;
        if (file !== null && existsSync(file)) {
          deps.showItem(file);
          return ok(null);
        }
        if (!existsSync(job.dir)) return fail('The folder is no longer there');
        await deps.openPath(job.dir);
        return ok(null);
      }),

    binaries: (): Promise<BinStatus[]> => deps.binaries.status(),

    installBinaries: (): Promise<Result<null>> =>
      (async () => {
        try {
          await deps.binaries.ensureAll(deps.onInstallProgress);
          await deps.afterInstall();
          // The tools are in place; a start that did not work is told, not hidden.
          const { engine } = deps.status();
          return engine.state === 'error' ? fail(engine.message) : ok(null);
        } catch (e) {
          // Install errors are already written for people ("could not download ffmpeg: …").
          return fail(e instanceof Error ? e.message : String(e));
        }
      })(),

    updateYtDlp: (): Promise<Result<string>> =>
      (async () => {
        try {
          return ok(await deps.binaries.updateYtDlp());
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      })(),

    startupNotice: async (): Promise<string | null> => deps.startupNotice(),
  };
}

export type Handlers = ReturnType<typeof createHandlers>;
