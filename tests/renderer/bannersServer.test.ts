// A1 Task 10: the server banner of the window. The server state is part of AppStatus (status.server);
// banners() adds { id: 'server' } for portBusy and error, between the engine banner and the save banner:
// engine, server, save, cutOff.
// Fields enumerated: AppStatus { engine, saveError, server }; ServerStatus { listening(port) | portBusy(port) |
// error(message) } (the plan has no "starting": status() exists only once a state is decided); Banner { id, text, action }.
import { afterEach, describe, expect, it } from 'vitest';
import { banners } from '../../src/renderer/src/banners';
import { setLanguage } from '../../src/renderer/src/strings';
import { fsi } from '../../src/shared/i18n';
import type { AppStatus, EngineStatus, ServerStatus, Snapshot } from '../../src/shared/types';
import { makeJob } from '../helpers';

afterEach(() => setLanguage('en'));

const CUT_OFF_TEXT =
  'Some downloads were cut off and Fetchly could not check that their old processes are gone. End yt-dlp, ffmpeg and aria2c in Task Manager, then confirm.';

const READY: EngineStatus = { state: 'ready' };
const LISTENING: ServerStatus = { state: 'listening', port: 38917 };

function status(server: ServerStatus, engine: EngineStatus = READY, saveError: string | null = null): AppStatus {
  return { engine, saveError, server };
}

const snap = (interrupted = false): Snapshot => ({ jobs: interrupted ? [makeJob({ state: 'paused', interrupted: true })] : [], groups: [] });

describe('the server banner', () => {
  it('portBusy shows the port in use with a pointer to Settings and no button', () => {
    expect(banners(status({ state: 'portBusy', port: 38917 }), snap())).toEqual([
      { id: 'server', text: 'port 38917 is in use; change it in Settings', action: null },
    ]);
  });

  it.each([1024, 40000, 65535])('portBusy names the port %i', (port) => {
    const result = banners(status({ state: 'portBusy', port }), snap());
    expect(result).toEqual([{ id: 'server', text: `port ${port} is in use; change it in Settings`, action: null }]);
  });

  it('error shows its message as it is, with no button', () => {
    const message = 'port 80 cannot be used on this PC; choose another in Settings';
    expect(banners(status({ state: 'error', message }), snap())).toEqual([{ id: 'server', text: message, action: null }]);
  });

  it('error shows an empty message as it is (the text is not replaced)', () => {
    expect(banners(status({ state: 'error', message: '' }), snap())).toEqual([{ id: 'server', text: '', action: null }]);
  });

  it('listening shows no banner', () => {
    expect(banners(status(LISTENING), snap())).toEqual([]);
  });

  it('the banner has no button: a retry is a click on Save in Settings, not a banner action', () => {
    for (const server of [{ state: 'portBusy', port: 38917 }, { state: 'error', message: 'x' }] as ServerStatus[]) {
      expect(banners(status(server), snap()).every((b) => b.action === null)).toBe(true);
    }
  });

  it('follows the status: busy, then listening, then busy again', () => {
    expect(banners(status({ state: 'portBusy', port: 38917 }), snap()).map((b) => b.id)).toEqual(['server']);
    expect(banners(status(LISTENING), snap())).toEqual([]);
    expect(banners(status({ state: 'portBusy', port: 40000 }), snap())).toEqual([
      { id: 'server', text: 'port 40000 is in use; change it in Settings', action: null },
    ]);
  });
});

describe('the order of the banners', () => {
  it('engine, server, save, cutOff when all four are present', () => {
    const result = banners(status({ state: 'portBusy', port: 38917 }, { state: 'error', message: 'engine down' }, 'disk full'), snap(true));
    expect(result.map((b) => b.id)).toEqual(['engine', 'server', 'save', 'cutOff']);
    expect(result).toEqual([
      { id: 'engine', text: 'engine down', action: 'retryEngines' },
      { id: 'server', text: 'port 38917 is in use; change it in Settings', action: null },
      { id: 'save', text: 'disk full', action: null },
      { id: 'cutOff', text: CUT_OFF_TEXT, action: 'confirmStraysGone' },
    ]);
  });

  it('server before save (the other two absent)', () => {
    expect(banners(status({ state: 'error', message: 'm' }, READY, 'disk full'), snap()).map((b) => b.id)).toEqual(['server', 'save']);
  });

  it('engine before server (the other two absent)', () => {
    expect(banners(status({ state: 'portBusy', port: 38917 }, { state: 'error', message: 'e' }), snap()).map((b) => b.id)).toEqual(['engine', 'server']);
  });

  it('server before cutOff (the other two absent)', () => {
    expect(banners(status({ state: 'portBusy', port: 38917 }), snap(true)).map((b) => b.id)).toEqual(['server', 'cutOff']);
  });

  it('a server banner shows whatever the engine state', () => {
    const engines: EngineStatus[] = [{ state: 'notInstalled' }, { state: 'starting' }, READY];
    for (const engine of engines) {
      expect(banners(status({ state: 'portBusy', port: 38917 }, engine), snap())).toEqual([
        { id: 'server', text: 'port 38917 is in use; change it in Settings', action: null },
      ]);
    }
  });

  it('a healthy server leaves the other three banners as they were', () => {
    const result = banners(status(LISTENING, { state: 'error', message: 'engine down' }, 'disk full'), snap(true));
    expect(result.map((b) => b.id)).toEqual(['engine', 'save', 'cutOff']);
  });
});

// Task D, item 2: the server banner shows the text of the language in use. A coded server status holds the English
// message and a code (and a port for portUnusable); English output is the message itself, so the English cases above
// did not change. A status without a code shows its message as it came (Arabic: inside one isolate).
describe('the translated server banner (Task D, item 2)', () => {
  const SERVER_TEXT = [
    ['serverStartFailed', 'The browser connection could not start; save Settings to try again', 'تعذّر بدء الاتصال بالمتصفح؛ احفظ الإعدادات للمحاولة من جديد'],
    ['serverBroken', 'The browser connection stopped working; save Settings to start it again', 'توقف الاتصال بالمتصفح عن العمل؛ احفظ الإعدادات لتشغيله من جديد'],
    ['serverStarting', 'The browser connection is starting', 'جارٍ بدء الاتصال بالمتصفح'],
    ['serverStopped', 'The browser connection is stopped', 'الاتصال بالمتصفح متوقف'],
  ] as const;

  it.each(SERVER_TEXT)('%s: the message in English, the translation in Arabic, no button', (code, en, ar) => {
    const server = { state: 'error', message: en, code } as ServerStatus;
    expect(banners(status(server), snap())).toEqual([{ id: 'server', text: en, action: null }]);
    setLanguage('ar');
    expect(banners(status(server), snap())).toEqual([{ id: 'server', text: ar, action: null }]);
  });

  it('portUnusable: the port inside one isolate in Arabic', () => {
    const message = 'port 38917 cannot be used on this PC; choose another in Settings';
    const server: ServerStatus = { state: 'error', message, code: 'portUnusable', port: 38917 };
    expect(banners(status(server), snap())).toEqual([{ id: 'server', text: message, action: null }]);
    setLanguage('ar');
    expect(banners(status(server), snap())).toEqual([
      { id: 'server', text: `لا يمكن استخدام المنفذ ${fsi('38917')} على هذا الكمبيوتر؛ اختر منفذًا آخر من الإعدادات`, action: null },
    ]);
  });

  it.each([
    ['missing', undefined],
    ['text', '38917'],
    ['a fraction', 38917.5],
  ])('portUnusable with a port that is %s falls back to the message as it came', (_name, port) => {
    const message = 'port 38917 cannot be used on this PC; choose another in Settings';
    const server = { state: 'error', message, code: 'portUnusable', port } as ServerStatus;
    expect(banners(status(server), snap())).toEqual([{ id: 'server', text: message, action: null }]);
    setLanguage('ar');
    expect(banners(status(server), snap())).toEqual([{ id: 'server', text: fsi(message), action: null }]);
  });

  it('an error without a code: the message as it came, in Arabic inside one isolate', () => {
    expect(banners(status({ state: 'error', message: 'a text no table knows' }), snap())).toEqual([
      { id: 'server', text: 'a text no table knows', action: null },
    ]);
    setLanguage('ar');
    expect(banners(status({ state: 'error', message: 'a text no table knows' }), snap())).toEqual([
      { id: 'server', text: fsi('a text no table knows'), action: null },
    ]);
  });

  it('an unknown code falls back to the message as it came', () => {
    const server = { state: 'error', message: 'MESSAGE-AS-SENT', code: 'toString' } as unknown as ServerStatus;
    expect(banners(status(server), snap())[0]?.text).toBe('MESSAGE-AS-SENT');
    setLanguage('ar');
    expect(banners(status(server), snap())[0]?.text).toBe(fsi('MESSAGE-AS-SENT'));
  });

  it('portBusy still shows the port banner in Arabic, the port inside one isolate', () => {
    setLanguage('ar');
    expect(banners(status({ state: 'portBusy', port: 38917 }), snap())).toEqual([
      { id: 'server', text: `المنفذ ${fsi('38917')} مستخدم؛ غيّره من الإعدادات`, action: null },
    ]);
  });

  it('the server banner keeps its place between the engine and save banners in Arabic', () => {
    setLanguage('ar');
    const server: ServerStatus = { state: 'error', message: 'The browser connection is stopped', code: 'serverStopped' };
    const engine: EngineStatus = { state: 'error', message: 'The file download service stopped', code: 'fileServiceStopped' };
    const result = banners(status(server, engine, 'could not save the download list: disk full'), snap());
    expect(result.map((b) => b.id)).toEqual(['engine', 'server', 'save']);
    expect(result.map((b) => b.text)).toEqual(['توقفت خدمة تنزيل الملفات', 'الاتصال بالمتصفح متوقف', `تعذّر حفظ قائمة التنزيلات: ${fsi('disk full')}`]);
  });

  it('a server banner follows the language at every call', () => {
    const server: ServerStatus = { state: 'error', message: 'The browser connection is stopped', code: 'serverStopped' };
    const texts: string[] = [];
    for (const lang of ['en', 'ar', 'en'] as const) {
      setLanguage(lang);
      texts.push(banners(status(server), snap())[0]?.text ?? '');
    }
    expect(texts).toEqual(['The browser connection is stopped', 'الاتصال بالمتصفح متوقف', 'The browser connection is stopped']);
  });
});
