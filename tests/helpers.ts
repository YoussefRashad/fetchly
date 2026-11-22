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
    ...over,
  };
}

export function makeSettings(over: Partial<Settings> = {}): Settings {
  return {
    downloadDir: 'D:\\Dl',
    askEveryTime: false,
    maxConcurrent: 3,
    speedLimitKbps: 0,
    autoResumeOnStart: false,
    preferMp4Max1080: false,
    defaultQuality: { kind: 'best' },
    subtitleLangs: [],
    ...over,
  };
}
