import type { ErrorCode } from './errors';
import type { LanguageSetting, ThemeSetting } from './i18n';

export type JobKind = 'media' | 'file';

export type JobState =
  | 'queued'
  | 'probing'
  | 'downloading'
  | 'paused'
  | 'merging'
  | 'done'
  | 'failed'
  | 'skipped';

export const HEIGHTS = [2160, 1440, 1080, 720, 480, 360] as const;
export type Height = (typeof HEIGHTS)[number];

export type Quality =
  | { kind: 'best' }
  | { kind: 'max'; height: Height }
  | { kind: 'audio'; format: 'm4a' | 'mp3' };

export interface Job {
  id: string;
  groupId: string | null;
  kind: JobKind;
  url: string;
  title: string;
  state: JobState;
  reason: string | null;
  /** null for file jobs */
  quality: Quality | null;
  subtitleLangs: string[];
  dir: string;
  /**
   * File name without extension, fixed when the job is added so that pause and
   * resume always address the same partial file. null for file jobs.
   */
  baseName: string | null;
  fileName: string | null;
  /** 1-based position in its group, null outside a group */
  index: number | null;
  bytesDone: number;
  bytesTotal: number | null;
  speed: number;
  eta: number | null;
  actualHeight: number | null;
  resumable: boolean;
  attempts: number;
  createdAt: number;
  /**
   * true = this job's last run was not confirmed stopped, and no check for leftover
   * tool processes has succeeded or been confirmed since. Only ever true while the
   * job is paused; while true, resume is refused.
   */
  interrupted: boolean;
  /** Highest video height the site offered when probed; null = not known. */
  sourceHeight: number | null;
  /**
   * The page a browser hand-off came from, as origin + path only (no query, no hash, no `"`), sent as the
   * Referer header; null = none. A stored value that is not its own reduceReferer() loads as null.
   */
  referer: string | null;
  /** The browser's User-Agent sent with a hand-off (isUserAgent); null = the tool's own. A bad stored value loads as null. */
  userAgent: string | null;
  /**
   * true = the job was added with a sign-in that is held for one run only (A5). Never set to true before A5; a job
   * stored with true does not start until A5 supplies that sign-in. A stored value that is not a boolean makes
   * jobs.json invalid, as a bad `interrupted` does.
   */
  oneShotLogin: boolean;
}

export interface Group {
  id: string;
  title: string;
  url: string;
  dir: string;
  createdAt: number;
}

export interface Settings {
  language: LanguageSetting;
  theme: ThemeSetting;
  downloadDir: string;
  askEveryTime: boolean;
  /** 1..8 */
  maxConcurrent: number;
  /** 0 = unlimited */
  speedLimitKbps: number;
  autoResumeOnStart: boolean;
  preferMp4Max1080: boolean;
  defaultQuality: Quality;
  subtitleLangs: string[];
  /** Loopback port of the browser server, 1024..65535; an invalid value loads as 38917, never clamped. */
  serverPort: number;
}

/** Why a playlist entry cannot be downloaded; becomes the skipped job's reason. */
export type EntryReason = 'private' | 'removed' | 'unavailable';

export interface PlaylistEntry {
  /** 1-based position in the playlist */
  index: number;
  /** '' for a placeholder without a link */
  url: string;
  title: string;
  unavailable: boolean;
  /** non-null exactly when unavailable is true */
  reason: EntryReason | null;
}

export type ProbeResult =
  | { kind: 'media'; title: string; thumbnail: string | null; heights: number[] }
  | { kind: 'playlist'; title: string; entries: PlaylistEntry[] }
  | { kind: 'file'; fileName: string; size: number | null; resumable: boolean };

export interface AddRequest {
  url: string;
  probe: ProbeResult;
  quality: Quality | null;
  subtitleLangs: string[];
  dir: string;
  /** playlist only */
  selectedIndexes: number[] | null;
}

export type JobVerb = 'pause' | 'resume' | 'cancel' | 'retry' | 'remove' | 'removeWithFile';
export type GroupVerb = 'pause' | 'resume' | 'cancel';

export interface Snapshot {
  jobs: Job[];
  groups: Group[];
}

export type BinName = 'yt-dlp' | 'ffmpeg' | 'aria2c';

export interface BinStatus {
  name: BinName;
  installed: boolean;
  version: string | null;
}

/**
 * Why something failed. `error` is the English text; `code` (src/shared/errors.ts) lets the window show it in the
 * language in use, with `detail` the raw part (an OS or tool message) a detail code puts into its text.
 */
export interface ErrorInfo {
  error: string;
  code?: ErrorCode;
  detail?: string;
}

/** `warning`: it worked, but something after it did not (setSettings only). */
export type Result<T> = { ok: true; value: T; warning?: ErrorInfo } | ({ ok: false } & ErrorInfo);

/**
 * State of the download tools (B17).
 * notInstalled: a tool is missing, no queue.
 * starting: tools present, a start or restart is running (also the value before the first start).
 * ready: the queue exists and aria2 runs.
 * error: the start failed (no queue), or aria2 exited (the queue exists, file downloads
 * cannot run); Retry applies. `message` is the English text; `code` and `detail` as in ErrorInfo.
 */
export type EngineStatus =
  | { state: 'notInstalled' }
  | { state: 'starting' }
  | { state: 'ready' }
  | { state: 'error'; message: string; code?: ErrorCode; detail?: string };

/**
 * State of the local server the browser extension talks to.
 * listening: bound to 127.0.0.1 on `port` (the port the socket really has).
 * portBusy: `port` is taken by another program; nothing else was tried.
 * error: no listener, `message` says why (English); `code` translates it, `port` is the port a port code names.
 */
export type ServerStatus =
  | { state: 'listening'; port: number }
  | { state: 'portBusy'; port: number }
  | { state: 'error'; message: string; code?: ErrorCode; port?: number };

export interface AppStatus {
  engine: EngineStatus;
  /** Text of the last failed write of jobs.json; null once a write succeeded. */
  saveError: string | null;
  server: ServerStatus;
}

/** A paired browser as the window sees it: never its origin, token hash or proof key. */
export interface PairingInfo {
  id: string;
  label: string;
  /** Date.now() at pairing, for display only. */
  pairedAt: number;
}

export interface PairingsView {
  pairings: PairingInfo[];
  /** A pairing code is open. */
  codeOpen: boolean;
  /** The last pairing change could not be written to disk yet; it is retried. */
  unsaved: boolean;
}

/** What the window may ask the main process to do. Exposed as `window.fetchly`. */
export interface FetchlyApi {
  probe(url: string): Promise<Result<ProbeResult>>;
  add(req: AddRequest): Promise<Result<null>>;
  job(id: string, verb: JobVerb): Promise<Result<null>>;
  group(id: string, verb: GroupVerb): Promise<Result<null>>;
  snapshot(): Promise<Snapshot>;
  /** Returns the function that stops listening. */
  onChanged(cb: (s: Snapshot) => void): () => void;
  getSettings(): Promise<Settings>;
  setSettings(s: Settings): Promise<Result<Settings>>;
  pickFolder(): Promise<string | null>;
  openFile(jobId: string): Promise<Result<null>>;
  openFolder(jobId: string): Promise<Result<null>>;
  binaries(): Promise<BinStatus[]>;
  installBinaries(): Promise<Result<null>>;
  onInstallProgress(cb: (name: BinName, pct: number) => void): () => void;
  updateYtDlp(): Promise<Result<string>>;
  /** A one-time message about something that happened at startup, or null. */
  startupNotice(): Promise<string | null>;
  /** The state of the download tools and the last save error. */
  status(): Promise<AppStatus>;
  /** Called with the new status whenever it changes. Returns the function that stops listening. */
  onStatus(cb: (s: AppStatus) => void): () => void;
  /** Starts the download tools again after an error. */
  retryEngines(): Promise<Result<null>>;
  /** The user ended the leftover tool processes by hand: cut-off downloads may resume. */
  confirmStraysGone(): Promise<Result<null>>;
  /** Opens a pairing code; the answer is `<listening port>-<code>` and how long it stays valid. */
  pairingStart(): Promise<Result<{ pairingString: string; lifetimeMs: number }>>;
  /** Closes the open pairing code, if any. */
  pairingCancel(): Promise<Result<null>>;
  /** The paired browsers, whether a code is open and whether a change is not saved yet. */
  pairings(): Promise<PairingsView>;
  /** Removes one pairing: its token stops working at once. */
  unpair(id: string): Promise<Result<null>>;
}
