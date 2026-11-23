import type { Job, Settings } from '../src/shared/types';

let seq = 0;

export function makeJob(over: Partial<Job> = {}): Job {
  seq += 1;
  return {
    id: `job-${seq}`,
    groupId: null,
    kind: 'media',
    url: 'https://example.com/watch?v=1',
    title: 'Video',
    state: 'queued',
    reason: null,
    quality: { kind: 'best' },
    subtitleLangs: [],
    dir: 'D:\\Dl',
    baseName: 'Video',
    fileName: null,
    index: null,
    bytesDone: 0,
    bytesTotal: null,
    speed: 0,
    eta: null,
    actualHeight: null,
    resumable: true,
    attempts: 0,
    createdAt: seq,
    interrupted: false,
    sourceHeight: null,
    referer: null,
    userAgent: null,
    oneShotLogin: false,
    ...over,
  };
}

/**
 * The three fields the M1 migration adds to a Job (A3, plan 3.2), at their neutral values. The M1 specs spell
 * them out through makeA3Job, so they do not depend on makeJob carrying them (that is M1-literals).
 */
export const A3_NEUTRAL = { referer: null, userAgent: null, oneShotLogin: false } as const;

/** makeJob with referer, userAgent and oneShotLogin set explicitly; `over` wins. Compiles once Job has the fields. */
export function makeA3Job(over: Partial<Job> = {}): Job {
  return makeJob({ ...A3_NEUTRAL, ...over });
}

export function makeSettings(over: Partial<Settings> = {}): Settings {
  return {
    language: 'system',
    theme: 'system',
    downloadDir: 'D:\\Dl',
    askEveryTime: false,
    maxConcurrent: 3,
    speedLimitKbps: 0,
    autoResumeOnStart: false,
    preferMp4Max1080: false,
    defaultQuality: { kind: 'best' },
    subtitleLangs: [],
    serverPort: 38917,
    ...over,
  };
}
