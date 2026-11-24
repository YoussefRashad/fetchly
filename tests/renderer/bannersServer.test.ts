// A1 Task 10: the server banner of the window. The server state is part of AppStatus (status.server);
// banners() adds { id: 'server' } for portBusy and error, between the engine banner and the save banner:
// engine, server, save, cutOff.
// Fields enumerated: AppStatus { engine, saveError, server }; ServerStatus { listening(port) | portBusy(port) |
// error(message) } (the plan has no "starting": status() exists only once a state is decided);
// Banner { id, text, action, tone, opens } (C2: the portBusy banner names what its button opens in `opens`).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { banners } from '../../src/renderer/src/banners';
import type { AppStatus, EngineStatus, ServerStatus, Snapshot } from '../../src/shared/types';
import { makeJob } from '../helpers';

const CUT_OFF_TEXT =
  'Some downloads were cut off and Fetchly could not check that their old processes are gone. End yt-dlp, ffmpeg and aria2c in Task Manager, then confirm.';

const READY: EngineStatus = { state: 'ready' };
const LISTENING: ServerStatus = { state: 'listening', port: 38917 };

function status(server: ServerStatus, engine: EngineStatus = READY, saveError: string | null = null): AppStatus {
  return { engine, saveError, server };
}

const snap = (interrupted = false): Snapshot => ({ jobs: interrupted ? [makeJob({ state: 'paused', interrupted: true })] : [], groups: [] });

describe('the server banner', () => {
  it('portBusy shows the port in use with a pointer to Settings', () => {
    expect(banners(status({ state: 'portBusy', port: 38917 }), snap())).toEqual([
      { id: 'server', text: 'port 38917 is in use; change it in Settings', action: null, tone: 'warn', opens: 'settingsBrowser' },
    ]);
  });

  it.each([1024, 40000, 65535])('portBusy names the port %i', (port) => {
    const result = banners(status({ state: 'portBusy', port }), snap());
    expect(result).toEqual([
      { id: 'server', text: `port ${port} is in use; change it in Settings`, action: null, tone: 'warn', opens: 'settingsBrowser' },
    ]);
  });

  it('error shows its message as it is, with no button', () => {
    const message = 'port 80 cannot be used on this PC; choose another in Settings';
    expect(banners(status({ state: 'error', message }), snap())).toEqual([{ id: 'server', text: message, action: null, tone: 'warn', opens: null }]);
  });

  it('error shows an empty message as it is (the text is not replaced)', () => {
    expect(banners(status({ state: 'error', message: '' }), snap())).toEqual([{ id: 'server', text: '', action: null, tone: 'warn', opens: null }]);
  });

  it('listening shows no banner', () => {
    expect(banners(status(LISTENING), snap())).toEqual([]);
  });

  it('the server banner has no BannerAction: its button, if any, comes from `opens`', () => {
    for (const server of [{ state: 'portBusy', port: 38917 }, { state: 'error', message: 'x' }] as ServerStatus[]) {
      expect(banners(status(server), snap()).every((b) => b.action === null)).toBe(true);
    }
  });

  it('portBusy has opens: settingsBrowser', () => {
    expect(banners(status({ state: 'portBusy', port: 38917 }), snap()).map((b) => b.opens)).toEqual(['settingsBrowser']);
  });

  it('error has opens: null', () => {
    expect(banners(status({ state: 'error', message: 'x' }), snap()).map((b) => b.opens)).toEqual([null]);
  });

  it('follows the status: busy, then listening, then busy again', () => {
    expect(banners(status({ state: 'portBusy', port: 38917 }), snap()).map((b) => b.id)).toEqual(['server']);
    expect(banners(status(LISTENING), snap())).toEqual([]);
    expect(banners(status({ state: 'portBusy', port: 40000 }), snap())).toEqual([
      { id: 'server', text: 'port 40000 is in use; change it in Settings', action: null, tone: 'warn', opens: 'settingsBrowser' },
    ]);
  });
});

describe('the order of the banners', () => {
  it('engine, server, save, cutOff when all four are present', () => {
    const result = banners(status({ state: 'portBusy', port: 38917 }, { state: 'error', message: 'engine down' }, 'disk full'), snap(true));
    expect(result.map((b) => b.id)).toEqual(['engine', 'server', 'save', 'cutOff']);
    expect(result).toEqual([
      { id: 'engine', text: 'engine down', action: 'retryEngines', tone: 'bad', opens: null },
      { id: 'server', text: 'port 38917 is in use; change it in Settings', action: null, tone: 'warn', opens: 'settingsBrowser' },
      { id: 'save', text: 'disk full', action: null, tone: 'bad', opens: null },
      { id: 'cutOff', text: CUT_OFF_TEXT, action: 'confirmStraysGone', tone: 'warn', opens: null },
    ]);
    // 5.8, all four at once: the tones and the opens of the whole list.
    expect(result.map((b) => b.tone)).toEqual(['bad', 'warn', 'bad', 'warn']);
    expect(result.map((b) => b.opens)).toEqual([null, 'settingsBrowser', null, null]);
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
        { id: 'server', text: 'port 38917 is in use; change it in Settings', action: null, tone: 'warn', opens: 'settingsBrowser' },
      ]);
    }
  });

  it('a healthy server leaves the other three banners as they were', () => {
    const result = banners(status(LISTENING, { state: 'error', message: 'engine down' }, 'disk full'), snap(true));
    expect(result.map((b) => b.id)).toEqual(['engine', 'save', 'cutOff']);
  });
});

// C2 section 5.8, added assertions (+): the tone and opens of the server banner, and the reworded JSDoc sentence.
describe('the tone and opens of the server banner', () => {
  const ENGINES: EngineStatus[] = [{ state: 'notInstalled' }, { state: 'starting' }, READY, { state: 'error', message: 'engine down' }];
  const SERVERS: ServerStatus[] = [LISTENING, { state: 'portBusy', port: 38917 }, { state: 'error', message: 'x' }];
  /** The values of `BannerAction` (a type, so the list is written here). */
  const BANNER_ACTIONS = ['retryEngines', 'confirmStraysGone'];

  it('both server banners are warn', () => {
    expect(banners(status({ state: 'portBusy', port: 38917 }), snap()).map((b) => b.tone)).toEqual(['warn']);
    expect(banners(status({ state: 'error', message: 'x' }), snap()).map((b) => b.tone)).toEqual(['warn']);
  });

  it('every banner has exactly the keys action, id, opens, text, tone', () => {
    for (const server of SERVERS) {
      for (const engine of ENGINES) {
        for (const b of banners(status(server, engine, 'disk full'), snap(true))) {
          expect(Object.keys(b).sort()).toEqual(['action', 'id', 'opens', 'text', 'tone']);
        }
      }
    }
  });

  it('opens is non-null only for the portBusy banner, in every engine state, with or without a save error or a cut-off job', () => {
    let checked = 0;
    for (const server of SERVERS) {
      for (const engine of ENGINES) {
        for (const saveError of [null, 'disk full']) {
          for (const interrupted of [false, true]) {
            const result = banners(status(server, engine, saveError), snap(interrupted));
            const expectedCount =
              (engine.state === 'error' ? 1 : 0) + (server.state === 'listening' ? 0 : 1) + (saveError === null ? 0 : 1) + (interrupted ? 1 : 0);
            expect(result).toHaveLength(expectedCount);
            for (const b of result) expect(b.opens).toBe(b.id === 'server' && server.state === 'portBusy' ? 'settingsBrowser' : null);
            expect(result.filter((b) => b.opens !== null)).toHaveLength(server.state === 'portBusy' ? 1 : 0);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(3 * 4 * 2 * 2);
  });

  it('the portBusy banner\'s action is null: opens is not a BannerAction', () => {
    const [banner] = banners(status({ state: 'portBusy', port: 38917 }), snap());
    expect(banner?.action).toBeNull();
    expect(banner?.opens).not.toBeNull();
    expect(BANNER_ACTIONS).not.toContain(banner?.opens);
  });

  it('no banner has an opens value that is also an action', () => {
    for (const server of SERVERS) {
      for (const b of banners(status(server, { state: 'error', message: 'e' }, 'disk full'), snap(true))) {
        if (b.opens !== null) expect(BANNER_ACTIONS).not.toContain(b.opens);
        if (b.action !== null) expect(BANNER_ACTIONS).toContain(b.action);
      }
    }
  });

  it('the JSDoc of banners() says it: the server banner has no BannerAction; a port-busy banner names what its button opens in `opens`', () => {
    const source = readFileSync(join(__dirname, '../../src/renderer/src/banners.ts'), 'utf8');
    // Comment markers and line breaks collapse to single spaces, so the sentence may be wrapped anywhere.
    const text = source.replace(/\r/gu, '').replace(/\n\s*(\*\s?)?/gu, ' ');
    expect(text).toContain('The server banner has no BannerAction; a port-busy banner names what its button opens in `opens`.');
    expect(text).not.toContain('has no button: saving Settings retries');
    // The rest of that JSDoc is unchanged.
    expect(text).toContain(
      'The persistent banners for the current state, in this order: engine error, browser server (port busy or error), save error, cut-off downloads. Each is state, not an event: it goes away only when its cause does.',
    );
  });
});
