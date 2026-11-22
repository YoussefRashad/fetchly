import { existsSync, mkdirSync } from 'node:fs';
import { join, win32 } from 'node:path';
import {
  HEIGHTS,
  type AddRequest,
  type BinName,
  type BinStatus,
  type GroupVerb,
  type JobVerb,
  type ProbeResult,
  type Quality,
  type Result,
  type Settings,
  type Snapshot,
} from '../shared/types';
import { normalizeSettings } from './jobs/store';
import { InvalidUrl, ProbeError } from './probe';

/** The part of the queue the window can reach. */
export interface QueueLike {
  add(req: AddRequest): void;
  job(id: string, verb: JobVerb): Promise<void>;
  group(id: string, verb: GroupVerb): Promise<void>;
  snapshot(): Snapshot;
  setSettings(s: Settings): void;
}

export interface HandlerDeps {
  /** null until the download tools are installed and the engines are running */
  queue(): QueueLike | null;
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
  /** starts the engines once the tools are in place */
  afterInstall(): Promise<void>;
  pickFolder(): Promise<string | null>;
  openPath(path: string): Promise<void>;
  showItem(path: string): void;
  startupNotice(): string | null;
}

const JOB_VERBS: readonly string[] = ['pause', 'resume', 'cancel', 'retry', 'remove', 'removeWithFile'];
const GROUP_VERBS: readonly string[] = ['pause', 'resume', 'cancel'];
const NOT_READY = 'Install the download tools first';
const BAD_REQUEST = 'That request is not valid';

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isQuality(v: unknown): v is Quality {
  if (!isObject(v)) return false;
  if (v['kind'] === 'best') return true;
  if (v['kind'] === 'max') return (HEIGHTS as readonly unknown[]).includes(v['height']);
  if (v['kind'] === 'audio') return v['format'] === 'm4a' || v['format'] === 'mp3';
  return false;
}

/** Language codes only (en, ar, pt-BR): they end up on yt-dlp's command line. */
function isLangList(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= 10 && v.every((l) => typeof l === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/u.test(l));
}

function isAbsoluteDir(v: unknown): v is string {
  return typeof v === 'string' && win32.isAbsolute(v);
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

function validProbe(probe: unknown, validateUrl: (raw: string) => string): probe is ProbeResult {
  if (!isObject(probe)) return false;
  if (probe['kind'] === 'media') return typeof probe['title'] === 'string';
  if (probe['kind'] === 'file') {
    const name = probe['fileName'];
    return typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && !/[\\/]/u.test(name);
  }
  if (probe['kind'] === 'playlist') {
    const entries = probe['entries'];
    if (typeof probe['title'] !== 'string' || !Array.isArray(entries)) return false;
    return entries.every((e: unknown) => {
      if (!isObject(e) || typeof e['index'] !== 'number' || typeof e['title'] !== 'string' || typeof e['url'] !== 'string') return false;
      if (e['unavailable'] === true) return true;
      try {
        validateUrl(e['url']);
        return true;
      } catch {
        return false;
      }
    });
  }
  return false;
}

export function createHandlers(deps: HandlerDeps) {
  return {
    probe: (raw: string): Promise<Result<ProbeResult>> =>
      guarded(async () => {
        if (typeof raw !== 'string') return fail(describe(new InvalidUrl()));
        return ok(await deps.probe(deps.validateUrl(raw)));
      }),

    add: (req: AddRequest): Promise<Result<null>> =>
      guarded(async () => {
        if (!isObject(req) || typeof req.url !== 'string') return fail(BAD_REQUEST);
        const queue = deps.queue();
        if (!queue) return fail(NOT_READY);

        const url = deps.validateUrl(req.url);
        if (!validProbe(req.probe, deps.validateUrl)) return fail(BAD_REQUEST);
        if (!isAbsoluteDir(req.dir)) return fail('Choose a download folder');
        if (!isLangList(req.subtitleLangs)) return fail('Subtitle languages must be codes like en or ar');
        if (req.probe.kind !== 'file' && !isQuality(req.quality)) return fail(BAD_REQUEST);

        let selected: number[] | null = null;
        if (req.probe.kind === 'playlist') {
          const available = new Set(req.probe.entries.filter((e) => !e.unavailable).map((e) => e.index));
          const wanted = req.selectedIndexes ?? [...available];
          if (!Array.isArray(wanted) || !wanted.every((i) => available.has(i))) return fail(BAD_REQUEST);
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
          quality: req.probe.kind === 'file' ? null : req.quality,
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
        if (!queue) return fail(NOT_READY);
        await queue.job(id, verb);
        return ok(null);
      }),

    group: (id: string, verb: GroupVerb): Promise<Result<null>> =>
      guarded(async () => {
        if (typeof id !== 'string' || !GROUP_VERBS.includes(verb)) return fail(BAD_REQUEST);
        const queue = deps.queue();
        if (!queue) return fail(NOT_READY);
        await queue.group(id, verb);
        return ok(null);
      }),

    snapshot: async (): Promise<Snapshot> => deps.queue()?.snapshot() ?? { jobs: [], groups: [] },

    getSettings: async (): Promise<Settings> => deps.getSettings(),

    setSettings: (s: Settings): Promise<Result<Settings>> =>
      guarded(async () => {
        if (!isObject(s)) return fail(BAD_REQUEST);
        if (!isAbsoluteDir(s.downloadDir)) return fail('Choose a download folder');
        if (!isQuality(s.defaultQuality)) return fail(BAD_REQUEST);
        if (!isLangList(s.subtitleLangs)) return fail('Subtitle languages must be codes like en or ar');
        const next = normalizeSettings({
          downloadDir: s.downloadDir,
          askEveryTime: s.askEveryTime === true,
          maxConcurrent: Number(s.maxConcurrent),
          speedLimitKbps: Number(s.speedLimitKbps),
          autoResumeOnStart: s.autoResumeOnStart === true,
          preferMp4Max1080: s.preferMp4Max1080 === true,
          defaultQuality: s.defaultQuality,
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
          return ok(null);
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
