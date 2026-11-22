import { describe, expect, it } from 'vitest';
import { banners } from '../../src/renderer/src/banners';
import type { AppStatus, EngineStatus, Job, JobState, Snapshot } from '../../src/shared/types';
import { makeJob } from '../helpers';

const CUT_OFF_TEXT =
  'Some downloads were cut off and Fetchly could not check that their old processes are gone. End yt-dlp, ffmpeg and aria2c in Task Manager, then confirm.';

function status(engine: EngineStatus, saveError: string | null = null): AppStatus {
  return { engine, saveError };
}

function snap(jobs: Job[] = []): Snapshot {
  return { jobs, groups: [] };
}

const READY: EngineStatus = { state: 'ready' };

describe('banners', () => {
  it('shows nothing when all is well', () => {
    expect(banners(status(READY), snap())).toEqual([]);
    expect(banners(status(READY), snap([makeJob({ state: 'paused' }), makeJob({ state: 'downloading' })]))).toEqual([]);
  });

  it('shows the engine error with Retry', () => {
    expect(banners(status({ state: 'error', message: 'The file download service stopped' }), snap())).toEqual([
      { id: 'engine', text: 'The file download service stopped', action: 'retryEngines' },
    ]);
  });

  it('shows the engine error text as it is, even when empty', () => {
    expect(banners(status({ state: 'error', message: '' }), snap())).toEqual([{ id: 'engine', text: '', action: 'retryEngines' }]);
  });

  it.each<EngineStatus>([{ state: 'starting' }, { state: 'ready' }, { state: 'notInstalled' }])(
    'shows no engine banner while starting, ready or not installed (%j)',
    (engine) => {
      expect(banners(status(engine), snap())).toEqual([]);
    },
  );

  it('shows the save error without a button', () => {
    expect(banners(status(READY, 'EACCES: permission denied'), snap())).toEqual([
      { id: 'save', text: 'EACCES: permission denied', action: null },
    ]);
  });

  it('shows no save banner once the save error is null', () => {
    expect(banners(status(READY, null), snap()).some((b) => b.id === 'save')).toBe(false);
  });

  it('shows the save banner for an empty error text (only null means saved)', () => {
    expect(banners(status(READY, ''), snap())).toEqual([{ id: 'save', text: '', action: null }]);
  });

  it('shows the save error in every engine state', () => {
    const engines: EngineStatus[] = [{ state: 'notInstalled' }, { state: 'starting' }, { state: 'ready' }];
    for (const engine of engines) {
      expect(banners(status(engine, 'disk full'), snap())).toEqual([{ id: 'save', text: 'disk full', action: null }]);
    }
  });

  describe('shows the cut-off banner only while a job is cut off', () => {
    const cutOff = { id: 'cutOff', text: CUT_OFF_TEXT, action: 'confirmStraysGone' };

    it('no job at all: no banner', () => {
      expect(banners(status(READY), snap())).toEqual([]);
    });

    it('jobs, none cut off: no banner', () => {
      const states: JobState[] = ['queued', 'probing', 'downloading', 'paused', 'merging', 'done', 'failed', 'skipped'];
      expect(banners(status(READY), snap(states.map((state) => makeJob({ state, interrupted: false }))))).toEqual([]);
    });

    it('one paused job cut off: the banner with They are gone', () => {
      expect(banners(status(READY), snap([makeJob({ state: 'paused', interrupted: true })]))).toEqual([cutOff]);
    });

    it('one cut-off job among others: one banner', () => {
      const jobs = [makeJob({ state: 'done' }), makeJob({ state: 'paused', interrupted: true }), makeJob({ state: 'paused', interrupted: true })];
      expect(banners(status(READY), snap(jobs))).toEqual([cutOff]);
    });

    it('a job marked cut off that is not paused still shows it (any job with interrupted)', () => {
      expect(banners(status(READY), snap([makeJob({ state: 'queued', interrupted: true })]))).toEqual([cutOff]);
    });

    it('shows it whatever the engine state', () => {
      const engines: EngineStatus[] = [{ state: 'notInstalled' }, { state: 'starting' }, { state: 'ready' }];
      for (const engine of engines) {
        expect(banners(status(engine), snap([makeJob({ state: 'paused', interrupted: true })]))).toEqual([cutOff]);
      }
    });
  });

  it('orders engine, save, cut-off', () => {
    const result = banners(
      status({ state: 'error', message: 'The download tools could not be started: boom' }, 'disk full'),
      snap([makeJob({ state: 'paused', interrupted: true })]),
    );
    expect(result.map((b) => b.id)).toEqual(['engine', 'save', 'cutOff']);
    expect(result).toEqual([
      { id: 'engine', text: 'The download tools could not be started: boom', action: 'retryEngines' },
      { id: 'save', text: 'disk full', action: null },
      { id: 'cutOff', text: CUT_OFF_TEXT, action: 'confirmStraysGone' },
    ]);
  });

  it('keeps the order when only two causes are present', () => {
    expect(banners(status({ state: 'error', message: 'x' }), snap([makeJob({ state: 'paused', interrupted: true })])).map((b) => b.id)).toEqual([
      'engine',
      'cutOff',
    ]);
    expect(banners(status(READY, 'y'), snap([makeJob({ state: 'paused', interrupted: true })])).map((b) => b.id)).toEqual(['save', 'cutOff']);
  });
});
