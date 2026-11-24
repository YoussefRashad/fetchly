// A3 (plan 3.1): `killTree` moves unchanged from engines/media.ts to src/main/killTree.ts. What it promises is what
// MediaEngineOptions.kill and the plan say: taskkill /T /F on the child's pid (so yt-dlp's ffmpeg dies with it),
// child.kill() as the fallback when taskkill fails, and nothing at all for a child that has no pid.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { killTree } from '../src/main/killTree';
import { waitFor } from './wait';

const hooks = vi.hoisted(() => ({ execFile: null as null | ((...args: unknown[]) => unknown) }));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const wrapped = vi.fn((...args: unknown[]) => (hooks.execFile ?? (actual.execFile as (...a: unknown[]) => unknown))(...args));
  return { ...actual, execFile: wrapped };
});
const { execFile } = await import('node:child_process');

const FAKE_PATH = resolve('tests/fakes/fake-ytdlp.mjs');

type Callback = (err: Error | null) => void;
/** A child as killTree sees it: a pid and a kill. */
function fakeChild(pid: number | undefined): { child: ChildProcess; kill: ReturnType<typeof vi.fn> } {
  const kill = vi.fn(() => true);
  return { child: { pid, kill } as unknown as ChildProcess, kill };
}

beforeEach(() => {
  vi.mocked(execFile).mockClear();
});
afterEach(() => {
  hooks.execFile = null;
});

describe('killTree', () => {
  it('runs taskkill /PID <pid> /T /F, hidden, on the pid of the child', () => {
    hooks.execFile = (_cmd, _args, _opts, cb) => (cb as Callback)(null);
    killTree(fakeChild(4242).child);
    const calls = vi.mocked(execFile).mock.calls as unknown as [string, string[], Record<string, unknown>, Callback][];
    expect(calls).toHaveLength(1);
    const [command, args, options] = calls[0] ?? [];
    expect(command).toBe('taskkill');
    expect(args).toEqual(['/PID', '4242', '/T', '/F']);
    expect(options).toMatchObject({ windowsHide: true });
    expect(options?.['shell']).not.toBe(true);
  });

  it('does not call child.kill() when taskkill worked', () => {
    hooks.execFile = (_cmd, _args, _opts, cb) => (cb as Callback)(null);
    const { child, kill } = fakeChild(4242);
    killTree(child);
    expect(kill).not.toHaveBeenCalled();
  });

  it('falls back to child.kill() once, and only after taskkill failed', () => {
    let finish: Callback = () => undefined;
    hooks.execFile = (_cmd, _args, _opts, cb) => {
      finish = cb as Callback;
    };
    const { child, kill } = fakeChild(4242);
    killTree(child);
    expect(kill).not.toHaveBeenCalled(); // taskkill has not answered yet
    finish(new Error('taskkill failed'));
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith();
  });

  it('does nothing for a child that has no pid: no taskkill, no kill', () => {
    const { child, kill } = fakeChild(undefined);
    killTree(child);
    expect(execFile).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  });

  it('returns at once and gives nothing back (it is a request to end the tree)', () => {
    hooks.execFile = () => undefined;
    expect(killTree(fakeChild(4242).child)).toBeUndefined();
  });

  describe('on a real process tree', () => {
    let dir: string;
    const pids: number[] = [];

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'fetchly-killtree-'));
    });
    afterEach(() => {
      for (const pid of pids.splice(0)) {
        try {
          process.kill(pid);
        } catch {
          // already gone
        }
      }
    });

    const alive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    it('ends the process and the child that holds its stdout', async () => {
      const pidFile = join(dir, 'pids.json');
      const child = spawn(process.execPath, [FAKE_PATH, '-J', '--flat-playlist'], {
        env: { ...process.env, FAKE_YTDLP: 'probe-tree-hang', FAKE_YTDLP_PIDFILE: pidFile },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      child.stdout?.resume();
      child.stderr?.resume();
      const closed = new Promise<void>((done) => child.once('close', () => done()));
      const read = (): { self: number; child: number } | null => {
        if (!existsSync(pidFile)) return null;
        try {
          return JSON.parse(readFileSync(pidFile, 'utf8')) as { self: number; child: number };
        } catch {
          return null; // half written
        }
      };
      const seen = await waitFor(read, 15000);
      pids.push(seen.self, seen.child);
      expect(alive(seen.self)).toBe(true);
      expect(alive(seen.child)).toBe(true);

      killTree(child);
      await closed;

      await waitFor(() => !alive(seen.child), 10000);
      expect(alive(seen.self)).toBe(false);
      expect(alive(seen.child)).toBe(false);
    }, 40000);
  });
});
