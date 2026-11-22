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
}

export interface Group {
  id: string;
  title: string;
  url: string;
  dir: string;
  createdAt: number;
}

export interface Settings {
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
}

export interface PlaylistEntry {
  index: number;
  url: string;
  title: string;
  unavailable: boolean;
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
