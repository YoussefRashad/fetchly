import { afterEach, describe, expect, it } from 'vitest';
import { banners } from '../../src/renderer/src/banners';
import { setLanguage } from '../../src/renderer/src/strings';
import { fsi } from '../../src/shared/i18n';
import type { AppStatus, EngineStatus, Job, JobState, Snapshot } from '../../src/shared/types';
import { DETAIL, FIXED } from '../errorTable';
import { makeJob } from '../helpers';

afterEach(() => setLanguage('en'));

const CUT_OFF_TEXT =
  'Some downloads were cut off and Fetchly could not check that their old processes are gone. End yt-dlp, ffmpeg and aria2c in Task Manager, then confirm.';

function status(engine: EngineStatus, saveError: string | null = null): AppStatus {
  return { engine, saveError, server: { state: 'listening', port: 38917 } };
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

// Task D, item 2: the engine and save banners show the text of the language in use. A status object holds the English
// `message` and a `code`; the window shows S.errors[code] (statusMessage), and the English text of a coded status is
// the message itself, so the English banners above did not change.
describe('translated banners (Task D, item 2)', () => {
  const ENGINE_TEXT = 'The file download service stopped';

  it('a coded engine error: the message in English, the translation in Arabic, the button unchanged', () => {
    const engine: EngineStatus = { state: 'error', message: ENGINE_TEXT, code: 'fileServiceStopped' };
    expect(banners(status(engine), snap())).toEqual([{ id: 'engine', text: ENGINE_TEXT, action: 'retryEngines' }]);
    setLanguage('ar');
    expect(banners(status(engine), snap())).toEqual([{ id: 'engine', text: 'توقفت خدمة تنزيل الملفات', action: 'retryEngines' }]);
  });

  it('the start error carries its detail, isolated once in Arabic', () => {
    const engine: EngineStatus = {
      state: 'error',
      message: 'The download tools could not be started: spawn aria2c ENOENT',
      code: 'toolsStartFailed',
      detail: 'spawn aria2c ENOENT',
    };
    expect(banners(status(engine), snap())).toEqual([
      { id: 'engine', text: 'The download tools could not be started: spawn aria2c ENOENT', action: 'retryEngines' },
    ]);
    setLanguage('ar');
    expect(banners(status(engine), snap())).toEqual([
      { id: 'engine', text: `تعذّر تشغيل أدوات التنزيل: ${fsi('spawn aria2c ENOENT')}`, action: 'retryEngines' },
    ]);
  });

  it('an engine error without a code: English as it came, Arabic the same text inside one isolate', () => {
    const engine: EngineStatus = { state: 'error', message: 'something no table knows' };
    expect(banners(status(engine), snap())).toEqual([{ id: 'engine', text: 'something no table knows', action: 'retryEngines' }]);
    setLanguage('ar');
    expect(banners(status(engine), snap())).toEqual([{ id: 'engine', text: fsi('something no table knows'), action: 'retryEngines' }]);
  });

  it('a start error whose detail is missing falls back to the message as it came', () => {
    const engine = { state: 'error', message: 'The download tools could not be started: x', code: 'toolsStartFailed' } as EngineStatus;
    setLanguage('ar');
    expect(banners(status(engine), snap())).toEqual([{ id: 'engine', text: fsi('The download tools could not be started: x'), action: 'retryEngines' }]);
  });

  it('an unknown code on an engine error falls back to the message as it came', () => {
    const engine = { state: 'error', message: 'MESSAGE-AS-SENT', code: 'constructor' } as unknown as EngineStatus;
    expect(banners(status(engine), snap())[0]?.text).toBe('MESSAGE-AS-SENT');
    setLanguage('ar');
    expect(banners(status(engine), snap())[0]?.text).toBe(fsi('MESSAGE-AS-SENT'));
  });

  it('the save banner translates a save error that starts with the English prefix', () => {
    const text = 'could not save the download list: EACCES: permission denied';
    expect(banners(status(READY, text), snap())).toEqual([{ id: 'save', text, action: null }]);
    setLanguage('ar');
    expect(banners(status(READY, text), snap())).toEqual([
      { id: 'save', text: `تعذّر حفظ قائمة التنزيلات: ${fsi('EACCES: permission denied')}`, action: null },
    ]);
  });

  it('a save error without the prefix: English as it came, Arabic the same text inside one isolate', () => {
    expect(banners(status(READY, 'disk full'), snap())).toEqual([{ id: 'save', text: 'disk full', action: null }]);
    setLanguage('ar');
    expect(banners(status(READY, 'disk full'), snap())).toEqual([{ id: 'save', text: fsi('disk full'), action: null }]);
  });

  it('the banners of one status follow the language at every call', () => {
    const engine: EngineStatus = { state: 'error', message: ENGINE_TEXT, code: 'fileServiceStopped' };
    const texts: string[] = [];
    for (const lang of ['en', 'ar', 'en'] as const) {
      setLanguage(lang);
      texts.push(banners(status(engine), snap())[0]?.text ?? '');
    }
    expect(texts).toEqual([ENGINE_TEXT, 'توقفت خدمة تنزيل الملفات', ENGINE_TEXT]);
  });

  it.each(FIXED)('an engine error with the fixed code %s shows its translation', (code, en, ar) => {
    const engine = { state: 'error', message: 'MESSAGE-AS-SENT', code } as EngineStatus;
    expect(banners(status(engine), snap())[0]?.text).toBe(en);
    setLanguage('ar');
    expect(banners(status(engine), snap())[0]?.text).toBe(ar);
  });

  it.each(DETAIL)('an engine error with the detail code %s shows its translation', (code, en, ar) => {
    const engine = { state: 'error', message: 'MESSAGE-AS-SENT', code, detail: 'D-1' } as EngineStatus;
    expect(banners(status(engine), snap())[0]?.text).toBe(en('D-1'));
    setLanguage('ar');
    expect(banners(status(engine), snap())[0]?.text).toBe(ar('D-1'));
  });
});
