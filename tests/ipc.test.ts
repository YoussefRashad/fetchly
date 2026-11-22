import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createHandlers, type HandlerDeps } from '../src/main/ipc';
import { InvalidUrl, ProbeError } from '../src/main/probe';
import type { AddRequest, GroupVerb, JobVerb, ProbeResult, Settings, Snapshot } from '../src/shared/types';
import { makeJob, makeSettings } from './helpers';

let dir: string;
let added: AddRequest[];
let verbs: [string, JobVerb | GroupVerb][];
let snapshot: Snapshot;
let settings: Settings;
let savedSettings: Settings[];
let queueSettings: Settings[];
let opened: string[];
let shown: string[];
let probeImpl: (url: string) => Promise<ProbeResult>;
let queueReady: boolean;
let installed: number;
let installFails: boolean;

const media: ProbeResult = { kind: 'media', title: 'Talk', thumbnail: null, heights: [1080] };
const list: ProbeResult = {
  kind: 'playlist',
  title: 'Course',
  entries: [
    { index: 1, url: 'https://example.com/v/1', title: 'One', unavailable: false },
    { index: 2, url: 'https://example.com/v/2', title: 'Two', unavailable: false },
  ],
};

function deps(): HandlerDeps {
  return {
    queue: () =>
      queueReady
        ? {
            add: (r) => added.push(r),
            job: async (id, verb) => void verbs.push([id, verb]),
            group: async (id, verb) => void verbs.push([id, verb]),
            snapshot: () => snapshot,
            setSettings: (s) => queueSettings.push(s),
          }
        : null,
    getSettings: () => settings,
    saveSettings: (s) => {
      settings = s;
      savedSettings.push(s);
    },
    validateUrl: (raw) => {
      if (!raw.trim().startsWith('http')) throw new InvalidUrl();
      return raw.trim();
    },
    probe: (url) => probeImpl(url),
    binaries: {
      status: async () => [{ name: 'yt-dlp', installed: true, version: '1' }],
      ensureAll: async (onProgress) => {
        if (installFails) throw new Error('could not download ffmpeg: server answered 404');
        onProgress('ffmpeg', 100);
      },
      updateYtDlp: async () => '2026.11.01',
    },
    onInstallProgress: () => undefined,
    afterInstall: async () => void (installed += 1),
    pickFolder: async () => 'D:\\Picked',
    openPath: async (p) => void opened.push(p),
    showItem: (p) => void shown.push(p),
    startupNotice: () => 'jobs.json.corrupt-1',
  };
}

const request = (over: Partial<AddRequest> = {}): AddRequest => ({
  url: 'https://example.com/v',
  probe: media,
  quality: { kind: 'best' },
  subtitleLangs: [],
  dir,
  selectedIndexes: null,
  ...over,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hammel-ipc-'));
  added = [];
  verbs = [];
  snapshot = { jobs: [], groups: [] };
  settings = makeSettings({ downloadDir: dir });
  savedSettings = [];
  queueSettings = [];
  opened = [];
  shown = [];
  probeImpl = async () => media;
  queueReady = true;
  installed = 0;
  installFails = false;
});

describe('probe', () => {
  it('returns the probe result', async () => {
    expect(await createHandlers(deps()).probe(' https://example.com/v ')).toEqual({ ok: true, value: media });
  });

  it('explains what a link must look like', async () => {
    expect(await createHandlers(deps()).probe('ftp://x')).toEqual({
      ok: false,
      error: 'Enter a link that starts with http:// or https://',
    });
  });

  it('passes on why a link cannot be downloaded', async () => {
    probeImpl = async () => {
      throw new ProbeError('private');
    };
    expect(await createHandlers(deps()).probe('https://x.y')).toEqual({ ok: false, error: 'private' });
  });

  it('never throws across the boundary', async () => {
    probeImpl = async () => {
      throw new Error('boom');
    };
    expect(await createHandlers(deps()).probe('https://x.y')).toEqual({ ok: false, error: 'Something went wrong: boom' });
  });

  it('rejects a value that is not text', async () => {
    expect(await createHandlers(deps()).probe(42 as unknown as string)).toMatchObject({ ok: false });
  });
});

describe('add', () => {
  it('queues a valid request', async () => {
    expect(await createHandlers(deps()).add(request())).toEqual({ ok: true, value: null });
    expect(added).toHaveLength(1);
  });

  it('creates the download folder when it is missing', async () => {
    const target = join(dir, 'new', 'deep');
    await createHandlers(deps()).add(request({ dir: target }));
    expect(existsSync(target)).toBe(true);
    expect(added).toHaveLength(1);
  });

  it('refuses a relative folder', async () => {
    expect(await createHandlers(deps()).add(request({ dir: 'downloads' }))).toMatchObject({ ok: false });
    expect(added).toEqual([]);
  });

  it('reports a folder that cannot be created', async () => {
    writeFileSync(join(dir, 'blocker'), 'a file, not a folder');
    const res = await createHandlers(deps()).add(request({ dir: join(dir, 'blocker', 'sub') }));
    expect(res).toEqual({ ok: false, error: 'cannot write to folder' });
    expect(added).toEqual([]);
  });

  it('asks for at least one playlist item', async () => {
    const res = await createHandlers(deps()).add(request({ probe: list, selectedIndexes: [] }));
    expect(res).toEqual({ ok: false, error: 'Select at least one item' });
  });

  it('refuses a selection that is not in the playlist', async () => {
    expect(await createHandlers(deps()).add(request({ probe: list, selectedIndexes: [1, 7] }))).toMatchObject({ ok: false });
    expect(added).toEqual([]);
  });

  it('accepts a playlist with everything selected', async () => {
    expect(await createHandlers(deps()).add(request({ probe: list, selectedIndexes: [1, 2] }))).toMatchObject({ ok: true });
  });

  it.each([
    ['a non-http link', { url: 'file:///C:/x' }],
    ['a media request without a usable quality', { quality: { kind: 'max', height: 999 } as never }],
    ['a subtitle language that is not a language code', { subtitleLangs: ['en', '--exec calc'] }],
    ['a playlist entry with a non-http link', { probe: { ...list, entries: [{ index: 1, url: 'file:///x', title: 'x', unavailable: false }] } }],
    ['a file name that carries a path', { probe: { kind: 'file', fileName: '..\\evil.exe', size: 1, resumable: true } as ProbeResult, quality: null }],
  ])('refuses %s', async (_name, over) => {
    expect(await createHandlers(deps()).add(request(over))).toMatchObject({ ok: false });
    expect(added).toEqual([]);
  });

  it('refuses malformed input instead of throwing', async () => {
    expect(await createHandlers(deps()).add(null as unknown as AddRequest)).toMatchObject({ ok: false });
    expect(await createHandlers(deps()).add({} as AddRequest)).toMatchObject({ ok: false });
  });

  it('says so when the download tools are not installed yet', async () => {
    queueReady = false;
    expect(await createHandlers(deps()).add(request())).toEqual({ ok: false, error: 'Install the download tools first' });
  });
});

describe('job and group actions', () => {
  it('forwards a known verb', async () => {
    const h = createHandlers(deps());
    expect(await h.job('j1', 'pause')).toEqual({ ok: true, value: null });
    expect(await h.group('g1', 'cancel')).toEqual({ ok: true, value: null });
    expect(verbs).toEqual([
      ['j1', 'pause'],
      ['g1', 'cancel'],
    ]);
  });

  it('refuses an unknown verb', async () => {
    const h = createHandlers(deps());
    expect(await h.job('j1', 'explode' as JobVerb)).toMatchObject({ ok: false });
    expect(await h.group('g1', 'remove' as GroupVerb)).toMatchObject({ ok: false });
    expect(verbs).toEqual([]);
  });

  it('gives an empty snapshot before the queue exists', async () => {
    queueReady = false;
    expect(await createHandlers(deps()).snapshot()).toEqual({ jobs: [], groups: [] });
  });
});

describe('settings', () => {
  it('clamps, saves and applies new settings', async () => {
    const res = await createHandlers(deps()).setSettings(makeSettings({ downloadDir: dir, maxConcurrent: 99 }));
    expect(res).toMatchObject({ ok: true, value: { maxConcurrent: 8 } });
    expect(savedSettings[0]?.maxConcurrent).toBe(8);
    expect(queueSettings[0]?.maxConcurrent).toBe(8);
  });

  it('refuses a relative download folder', async () => {
    expect(await createHandlers(deps()).setSettings(makeSettings({ downloadDir: 'here' }))).toMatchObject({ ok: false });
    expect(savedSettings).toEqual([]);
  });

  it('refuses a broken default quality or subtitle list', async () => {
    const h = createHandlers(deps());
    expect(await h.setSettings(makeSettings({ downloadDir: dir, defaultQuality: { kind: 'nope' } as never }))).toMatchObject({ ok: false });
    expect(await h.setSettings(makeSettings({ downloadDir: dir, subtitleLangs: ['-x'] }))).toMatchObject({ ok: false });
  });

  it('saves settings even before the queue exists', async () => {
    queueReady = false;
    expect(await createHandlers(deps()).setSettings(makeSettings({ downloadDir: dir }))).toMatchObject({ ok: true });
    expect(savedSettings).toHaveLength(1);
  });
});

describe('opening files', () => {
  const doneJob = () => makeJob({ id: 'j1', state: 'done', dir, fileName: 'Talk.mp4' });

  it('opens the finished file of a job', async () => {
    writeFileSync(join(dir, 'Talk.mp4'), 'video');
    snapshot = { jobs: [doneJob()], groups: [] };
    expect(await createHandlers(deps()).openFile('j1')).toEqual({ ok: true, value: null });
    expect(opened).toEqual([join(dir, 'Talk.mp4')]);
  });

  it('says so when the file is gone', async () => {
    snapshot = { jobs: [doneJob()], groups: [] };
    expect(await createHandlers(deps()).openFile('j1')).toEqual({ ok: false, error: 'The file is no longer there' });
    expect(opened).toEqual([]);
  });

  it('does not open anything for an unfinished or unknown job', async () => {
    snapshot = { jobs: [makeJob({ id: 'j2', state: 'downloading', dir })], groups: [] };
    const h = createHandlers(deps());
    expect(await h.openFile('j2')).toMatchObject({ ok: false });
    expect(await h.openFile('nope')).toMatchObject({ ok: false });
    expect(opened).toEqual([]);
  });

  it('shows the finished file in its folder', async () => {
    writeFileSync(join(dir, 'Talk.mp4'), 'video');
    snapshot = { jobs: [doneJob()], groups: [] };
    await createHandlers(deps()).openFolder('j1');
    expect(shown).toEqual([join(dir, 'Talk.mp4')]);
  });

  it('opens the folder itself when there is no finished file yet', async () => {
    snapshot = { jobs: [makeJob({ id: 'j2', state: 'downloading', dir })], groups: [] };
    expect(await createHandlers(deps()).openFolder('j2')).toEqual({ ok: true, value: null });
    expect(opened).toEqual([dir]);
  });

  it('says so when the folder is gone', async () => {
    snapshot = { jobs: [makeJob({ id: 'j2', state: 'paused', dir: join(dir, 'gone') })], groups: [] };
    expect(await createHandlers(deps()).openFolder('j2')).toEqual({ ok: false, error: 'The folder is no longer there' });
  });
});

describe('download tools', () => {
  it('installs and then starts the engines', async () => {
    expect(await createHandlers(deps()).installBinaries()).toEqual({ ok: true, value: null });
    expect(installed).toBe(1);
  });

  it('reports a failed install and does not start the engines', async () => {
    installFails = true;
    expect(await createHandlers(deps()).installBinaries()).toEqual({
      ok: false,
      error: 'could not download ffmpeg: server answered 404',
    });
    expect(installed).toBe(0);
  });

  it('updates yt-dlp and returns the version', async () => {
    expect(await createHandlers(deps()).updateYtDlp()).toEqual({ ok: true, value: '2026.11.01' });
  });

  it('passes the startup notice on', async () => {
    expect(await createHandlers(deps()).startupNotice()).toBe('jobs.json.corrupt-1');
  });
});

describe('cleanup', () => {
  it('leaves the temp folder removable', () => {
    rmSync(dir, { recursive: true, force: true });
    expect(existsSync(dir)).toBe(false);
  });
});
