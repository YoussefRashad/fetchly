import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ERROR_TEXT, type CodeOfKind } from '../shared/errors';
import { isLanguageSetting, isThemeSetting } from '../shared/i18n';
import {
  type AddRequest,
  type AppStatus,
  type BinName,
  type BinStatus,
  type EngineStatus,
  type EntryReason,
  type ErrorInfo,
  type GroupVerb,
  type JobVerb,
  type PlaylistEntry,
  type ProbeResult,
  type Quality,
  type Result,
  type PairingsView,
  type Settings,
  type Snapshot,
} from '../shared/types';
import { formatPairingString, isServerPort } from '../shared/protocol';
import { CONTROL } from '../shared/text';
import { isRunnableFile } from './fileSafety';
import type { QueueAdd } from './jobs/queue';
import { normalizeSettings } from './jobs/store';
import { copyQuality, everyPosition, isAbsoluteDir, isLangList, isQuality } from './jobs/validate';
import { sanitizeFileName } from './naming';
import { InvalidUrl, ProbeError } from './probe';
import { FOUR_PAIRED_TEXT, NOT_LISTENING_TEXT, type PairingStore } from './server/pairing';
import type { RunningServer } from './server/server';
import { MAX_HEIGHTS } from './ytdlp/parse';

/** The part of the queue the window can reach. */
export interface QueueLike {
  add(req: QueueAdd): void;
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
  /** The browser pairings (code, tokens, pairing.json). */
  pairing: PairingStore;
  /** The local server: its state, and a listen on a port (also the retry after portBusy or an error). */
  server: Pick<RunningServer, 'status' | 'ensure'>;
  /** Asks before a port change removes `count` pairings; true = go on. */
  confirmPortChange(count: number): Promise<boolean>;
}

const JOB_VERBS: readonly string[] = ['pause', 'resume', 'cancel', 'retry', 'remove', 'removeWithFile'];
const GROUP_VERBS: readonly string[] = ['pause', 'resume', 'cancel'];

/** A fixed code with its English text. */
const fixed = (code: CodeOfKind<'fixed'>): ErrorInfo => ({ error: ERROR_TEXT[code], code });

/**
 * The engine status as an ErrorInfo: why a handler that needs the queue cannot run, or why a start did not work.
 * An error status passes on its message, and its code and detail when it has them.
 */
function statusText(engine: EngineStatus): ErrorInfo {
  if (engine.state === 'notInstalled') return fixed('toolsNotInstalled');
  if (engine.state === 'error') {
    const info: ErrorInfo = { error: engine.message };
    if (engine.code !== undefined) info.code = engine.code;
    if (engine.detail !== undefined) info.detail = engine.detail;
    return info;
  }
  // 'ready' always comes with a queue, so only 'starting' really reaches this line.
  return fixed('toolsStarting');
}

/** C3: a link that, trimmed, still holds a control character never reaches the queue or a spawn. */
const hasControl = (url: string): boolean => CONTROL.test(url.trim());

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
/** A failed Result: a fixed code, or an ErrorInfo built elsewhere (its code and detail are kept as they are). */
const fail = (why: CodeOfKind<'fixed'> | ErrorInfo): Result<never> => ({ ok: false, ...(typeof why === 'string' ? fixed(why) : why) });

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** What was thrown, as an ErrorInfo: a bad link, a reason of the link probe (linkProblem), or anything else (unexpected). */
function describe(e: unknown): ErrorInfo {
  if (e instanceof InvalidUrl) return fixed('invalidLink');
  if (e instanceof ProbeError) return { error: e.reason, code: 'linkProblem' };
  const detail = messageOf(e);
  return { error: ERROR_TEXT.unexpected(detail), code: 'unexpected', detail };
}

/**
 * The refusal of the pairing store as a failure. pairing.ts is not coded (D2.5): its two refusal texts are matched by
 * value; any other text is passed on with no code.
 */
function pairingRefusal(error: string): Result<never> {
  if (error === FOUR_PAIRED_TEXT) return fail('fourPaired');
  if (error === NOT_LISTENING_TEXT) return fail('notListening');
  return { ok: false, error };
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
  /** A setSettings call is running (it may be waiting for the port-change dialog). */
  let settingsBusy = false;
  /**
   * The port of the last `ensure` that resolved; the listener is on no other port. It starts as the port the
   * server was started on. getSettings() can already hold a port the listener never moved to, so a port move is
   * decided against this value, not against getSettings() (S15).
   */
  let listenerPort = deps.getSettings().serverPort;

  /** The window's link checked and trimmed; a control character inside it is refused like any bad link (C3). */
  const linkOf = (raw: string): string => {
    if (hasControl(raw)) throw new InvalidUrl();
    return deps.validateUrl(raw);
  };

  return {
    probe: (raw: string): Promise<Result<ProbeResult>> =>
      guarded(async () => {
        if (typeof raw !== 'string') return fail('invalidLink');
        return ok(await deps.probe(linkOf(raw)));
      }),

    add: (req: AddRequest): Promise<Result<null>> =>
      guarded(async () => {
        if (!isObject(req) || typeof req.url !== 'string') return fail('badRequest');
        const queue = deps.queue();
        if (!queue) return noQueue();

        const url = linkOf(req.url);
        if (!validProbe(req.probe, deps.validateUrl)) return fail('badRequest');
        if (!isAbsoluteDir(req.dir)) return fail('chooseFolder');
        if (!isLangList(req.subtitleLangs)) return fail('subtitleLangs');
        let quality: Quality | null = null;
        if (req.probe.kind !== 'file') {
          if (!isQuality(req.quality)) return fail('badRequest');
          // Rebuilt from its declared fields, so nothing else reaches the next save (C2).
          quality = copyQuality(req.quality);
        }

        let selected: number[] | null = null;
        if (req.probe.kind === 'playlist') {
          const available = new Set(req.probe.entries.filter((e) => !e.unavailable).map((e) => e.index));
          const wanted = req.selectedIndexes ?? [...available];
          // One position at a time, so a hole fails instead of being skipped.
          if (!Array.isArray(wanted) || !everyPosition(wanted, (i) => typeof i === 'number' && available.has(i))) return fail('badRequest');
          if (wanted.length === 0) return fail('selectOne');
          selected = wanted;
        }

        try {
          mkdirSync(req.dir, { recursive: true });
        } catch {
          return fail('cannotWriteFolder');
        }
        queue.add({
          url,
          probe: req.probe,
          quality,
          subtitleLangs: req.subtitleLangs,
          dir: req.dir,
          selectedIndexes: selected,
          // Only main supplies these; nothing the window sends reaches them.
          referer: null,
          userAgent: null,
          oneShotLogin: false,
        });
        return ok(null);
      }),

    job: (id: string, verb: JobVerb): Promise<Result<null>> =>
      guarded(async () => {
        if (typeof id !== 'string' || !JOB_VERBS.includes(verb)) return fail('badRequest');
        const queue = deps.queue();
        if (!queue) return noQueue();
        return queue.job(id, verb);
      }),

    group: (id: string, verb: GroupVerb): Promise<Result<null>> =>
      guarded(async () => {
        if (typeof id !== 'string' || !GROUP_VERBS.includes(verb)) return fail('badRequest');
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

    /**
     * Saves the settings. A serverPort other than the port of the last `ensure` that resolved (the listener is on
     * no other port) removes every pairing (after a confirmation when there are any, S15): the code is cancelled
     * and the pairings emptied before the save, and the listener moves after it. A port counts as moved only once
     * `ensure` resolved for it, whatever the status; if the save throws, nothing after it runs and retrying that
     * port is still a new port. A queue that throws after the save does not stop the move: the listener still
     * moves, and the answer is ok with the warning `savedNotApplied`. The same port still calls ensure, so saving
     * retries a busy or failed listener. One call at a time.
     */
    setSettings: async (s: Settings): Promise<Result<Settings>> => {
      if (settingsBusy) return fail('settingsBusy');
      settingsBusy = true;
      try {
        return await guarded(async () => {
          if (!isObject(s)) return fail('badRequest');
          if (!isLanguageSetting(s.language) || !isThemeSetting(s.theme)) return fail('badRequest');
          if (!isAbsoluteDir(s.downloadDir)) return fail('chooseFolder');
          if (!isQuality(s.defaultQuality)) return fail('badRequest');
          if (!isLangList(s.subtitleLangs)) return fail('subtitleLangs');
          // Tested as given, with no Number(...) coercion: "38917" is not a port (S14).
          if (!isServerPort(s.serverPort)) return fail('portInvalid');
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
            serverPort: s.serverPort,
          });
          if (next.serverPort !== listenerPort) {
            const count = deps.pairing.list().length;
            if (count > 0 && !(await deps.confirmPortChange(count))) return fail('portChangeDeclined');
            // One synchronous block: the old pairing string dies, the pairings go (written even when the list
            // was already empty, R2-1), then the save. If the save throws, the listener is not moved.
            deps.pairing.cancel();
            deps.pairing.clear();
          }
          deps.saveSettings(next);
          // The settings are saved: a queue that refuses them must not keep the listener on the old port (D3.1).
          let warning: ErrorInfo | null = null;
          try {
            deps.queue()?.setSettings(next);
          } catch (e) {
            const detail = messageOf(e);
            warning = { error: ERROR_TEXT.savedNotApplied(detail), code: 'savedNotApplied', detail };
          }
          // An ensure that rejects (a contract breach) fails the call and drops the warning (D3.6).
          await deps.server.ensure(next.serverPort);
          listenerPort = next.serverPort;
          return warning === null ? ok(next) : { ok: true, value: next, warning };
        });
      } finally {
        settingsBusy = false;
      }
    },

    /** Opens a pairing code; the string carries the port the server really listens on. */
    pairingStart: (): Promise<Result<{ pairingString: string; lifetimeMs: number }>> =>
      guarded(async () => {
        const server = deps.server.status();
        if (server.state !== 'listening') return fail('notListening');
        const opened = deps.pairing.open();
        if (!opened.ok) return pairingRefusal(opened.error);
        return ok({ pairingString: formatPairingString(server.port, opened.value.code), lifetimeMs: opened.value.lifetimeMs });
      }),

    pairingCancel: (): Promise<Result<null>> =>
      guarded(async () => {
        deps.pairing.cancel();
        return ok(null);
      }),

    /** id, label and pairedAt of each pairing; never its origin or key material. */
    pairings: async (): Promise<PairingsView> => deps.pairing.view(),

    /** Revokes at once; a failed write is retried, and the answer says so. */
    unpair: (id: string): Promise<Result<null>> =>
      guarded(async () => {
        if (typeof id !== 'string') return fail('badRequest');
        if (!deps.pairing.unpair(id)) return fail('notPaired');
        if (deps.pairing.view().unsaved) return fail('unpairUnsaved');
        return ok(null);
      }),

    pickFolder: (): Promise<string | null> => deps.pickFolder(),

    // The window only ever names a job; the path is worked out here.
    openFile: (jobId: string): Promise<Result<null>> =>
      guarded(async () => {
        const job = deps.queue()?.snapshot().jobs.find((j) => j.id === jobId);
        if (!job || job.state !== 'done' || job.fileName === null) return fail('notFinished');
        const path = join(job.dir, job.fileName);
        if (!existsSync(path)) return fail('fileGone');
        // A program, shortcut, script or disk image runs only after the user says yes.
        if (isRunnableFile(job.fileName) && !(await deps.confirmOpenRunnable(job.fileName))) return ok(null);
        await deps.openPath(path);
        return ok(null);
      }),

    openFolder: (jobId: string): Promise<Result<null>> =>
      guarded(async () => {
        const job = deps.queue()?.snapshot().jobs.find((j) => j.id === jobId);
        if (!job) return fail('badRequest');
        const file = job.state === 'done' && job.fileName !== null ? join(job.dir, job.fileName) : null;
        if (file !== null && existsSync(file)) {
          deps.showItem(file);
          return ok(null);
        }
        if (!existsSync(job.dir)) return fail('folderGone');
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
          return engine.state === 'error' ? fail(statusText(engine)) : ok(null);
        } catch (e) {
          // Install errors are already written for people ("could not download ffmpeg: …"); they stay English, no code.
          return fail({ error: messageOf(e) });
        }
      })(),

    updateYtDlp: (): Promise<Result<string>> =>
      (async () => {
        try {
          return ok(await deps.binaries.updateYtDlp());
        } catch (e) {
          return fail({ error: messageOf(e) });
        }
      })(),

    startupNotice: async (): Promise<string | null> => deps.startupNotice(),
  };
}

export type Handlers = ReturnType<typeof createHandlers>;
