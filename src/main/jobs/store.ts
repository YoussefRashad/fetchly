import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { Job, Settings, Snapshot } from '../../shared/types';
import { ACTIVE } from './state';
import { normalizeSettings, parseSettings, parseSnapshotFile } from './validate';

// Defined next to the settings parser; still exported here for the existing callers.
export { normalizeSettings };

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
      const parsed = parseSnapshotFile(JSON.parse(readFileSync(this.jobsPath, 'utf8')));
      if (!parsed) throw new Error('unexpected shape');
      const jobs = parsed.jobs.map((j): Job => {
        // A job that was running when the app last stopped was cut off: its process
        // may still be alive until a check for leftover processes has run.
        if (ACTIVE.has(j.state)) return { ...j, state: 'paused', speed: 0, eta: null, interrupted: true };
        return j.state === 'paused' ? j : { ...j, interrupted: false };
      });
      return { snapshot: { jobs, groups: parsed.groups }, recoveredCorrupt: null };
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
      return parseSettings(JSON.parse(readFileSync(this.settingsPath, 'utf8')), defaults);
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
