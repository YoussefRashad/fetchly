import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { Group, Job, Settings, Snapshot } from '../../shared/types';
import { ACTIVE } from './state';

export function DEFAULT_SETTINGS(downloadsDir: string): Settings {
  return {
    downloadDir: join(downloadsDir, 'Hammel'),
    askEveryTime: false,
    maxConcurrent: 3,
    speedLimitKbps: 0,
    autoResumeOnStart: false,
    preferMp4Max1080: false,
    defaultQuality: { kind: 'best' },
    subtitleLangs: [],
  };
}

/** Clamps the numeric settings into their allowed ranges. */
export function normalizeSettings(s: Settings): Settings {
  const max = Number.isFinite(s.maxConcurrent) ? Math.floor(s.maxConcurrent) : 3;
  const limit = Number.isFinite(s.speedLimitKbps) ? Math.floor(s.speedLimitKbps) : 0;
  return {
    ...s,
    maxConcurrent: Math.min(8, Math.max(1, max)),
    speedLimitKbps: Math.max(0, limit),
  };
}

export interface Loaded {
  snapshot: Snapshot;
  settings: Settings;
  /** path of the set-aside jobs file when it could not be read */
  recoveredCorrupt: string | null;
}

export class Store {
  private readonly jobsPath: string;
  private readonly settingsPath: string;

  constructor(
    private readonly dataDir: string,
    private readonly downloadsDir: string,
  ) {
    this.jobsPath = join(dataDir, 'jobs.json');
    this.settingsPath = join(dataDir, 'settings.json');
  }

  load(): Loaded {
    const { snapshot, recoveredCorrupt } = this.loadSnapshot();
    return { snapshot, settings: this.loadSettings(), recoveredCorrupt };
  }

  saveSnapshot(s: Snapshot): void {
    this.writeAtomic(this.jobsPath, JSON.stringify({ version: 1, jobs: s.jobs, groups: s.groups }));
  }

  saveSettings(s: Settings): void {
    this.writeAtomic(this.settingsPath, JSON.stringify(normalizeSettings(s), null, 2));
  }

  private loadSnapshot(): { snapshot: Snapshot; recoveredCorrupt: string | null } {
    if (!existsSync(this.jobsPath)) return { snapshot: { jobs: [], groups: [] }, recoveredCorrupt: null };
    try {
      const raw: unknown = JSON.parse(readFileSync(this.jobsPath, 'utf8'));
      if (!isSnapshotFile(raw)) throw new Error('unexpected shape');
      // The processes behind active jobs are gone after a restart.
      const jobs = raw.jobs.map((j) => (ACTIVE.has(j.state) ? { ...j, state: 'paused' as const, speed: 0, eta: null } : j));
      return { snapshot: { jobs, groups: raw.groups }, recoveredCorrupt: null };
    } catch {
      const aside = `${this.jobsPath}.corrupt-${Date.now()}`;
      renameSync(this.jobsPath, aside);
      return { snapshot: { jobs: [], groups: [] }, recoveredCorrupt: aside };
    }
  }

  private loadSettings(): Settings {
    const defaults = DEFAULT_SETTINGS(this.downloadsDir);
    if (!existsSync(this.settingsPath)) return defaults;
    try {
      const raw: unknown = JSON.parse(readFileSync(this.settingsPath, 'utf8'));
      if (typeof raw !== 'object' || raw === null) return defaults;
      const src = raw as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...defaults };
      for (const key of Object.keys(defaults)) {
        // Only known keys, and only when the saved value has the default's type.
        if (key in src && typeof src[key] === typeof merged[key] && src[key] !== null) merged[key] = src[key];
      }
      return normalizeSettings(merged as unknown as Settings);
    } catch {
      return defaults;
    }
  }

  private writeAtomic(path: string, data: string): void {
    mkdirSync(this.dataDir, { recursive: true });
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
}

function isSnapshotFile(raw: unknown): raw is { jobs: Job[]; groups: Group[] } {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return (
    Array.isArray(r['jobs']) &&
    Array.isArray(r['groups']) &&
    r['jobs'].every((j) => typeof j === 'object' && j !== null && typeof (j as Job).id === 'string' && typeof (j as Job).state === 'string') &&
    r['groups'].every((g) => typeof g === 'object' && g !== null && typeof (g as Group).id === 'string')
  );
}
