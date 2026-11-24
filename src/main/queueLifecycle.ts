import type { Settings, Snapshot } from '../shared/types';
import type { Engine } from './engines/engine';
import type { Aria2Daemon } from './engines/file';
import { Queue, type QueueDeps } from './jobs/queue';
import type { Store } from './jobs/store';

/** The file engine as the queue and an aria2 restart use it. */
export type FileSide = QueueDeps['file'] & { attach(daemon: Aria2Daemon): void };

export interface QueueLifecycleDeps {
  store: Store;
  /** The list read at app start: the first queue starts from it. */
  initial: Snapshot;
  /** The settings of this moment. */
  settings: () => Settings;
  /** Builds the engines for one queue around a running aria2. */
  engines: (daemon: Aria2Daemon) => { media: Engine; file: FileSide };
  /** Sends to the window. */
  send: (channel: string, ...args: unknown[]) => void;
  /** Attaches the tray to a queue. May throw. */
  attachTray: (queue: Queue) => void;
  /** Every save state of a wired queue: the text of the last failed save, or null. */
  onSaveState: (error: string | null) => void;
  /** Marks each finished download as coming from the internet (QueueDeps.markDownloaded). */
  markDownloaded?: (path: string, url: string) => void;
  /** The extras of each engine start (QueueDeps.extrasFor), handed to every queue built here. */
  extrasFor: QueueDeps['extrasFor'];
}

/** The queue steps EngineHost runs (F2): construct, wire, dispose; plus an aria2 restart. */
export interface QueueLifecycle {
  /** Constructs only: the engines and the queue, from the latest list. Synchronous; may throw. */
  createQueue: (daemon: Aria2Daemon, straysCleared: boolean) => Queue;
  /** All fallible wiring, in order: changes, save state, tray, auto-resume, the first push. May throw. */
  wireQueue: (queue: Queue) => void;
  /** Shuts the queue down. Its final list, cut-off marks included, is what the next createQueue starts from. */
  disposeQueue: (queue: Queue) => Promise<void>;
  /** Hands a restarted aria2 to the file engine of the wired queue. Throws when no queue is wired. */
  attachDaemon: (daemon: Aria2Daemon) => void;
}

/** Owns what the queue steps share: the list the next queue starts from and the file engine of the wired queue. No Electron here. */
export function createQueueLifecycle(deps: QueueLifecycleDeps): QueueLifecycle {
  /** The list the next queue starts from: the one read at start, then the final list of a disposed queue. */
  let initial = deps.initial;
  const fileOf = new WeakMap<Queue, FileSide>();
  /** The file engine of the wired queue; null until a wiring completed. */
  let wiredFile: FileSide | null = null;

  return {
    createQueue: (daemon, straysCleared) => {
      const { media, file } = deps.engines(daemon);
      const queue = new Queue({
        store: deps.store,
        media,
        file,
        initial,
        settings: deps.settings(),
        straysCleared,
        extrasFor: deps.extrasFor,
        ...(deps.markDownloaded ? { markDownloaded: deps.markDownloaded } : {}),
      });
      fileOf.set(queue, file);
      return queue;
    },

    wireQueue: (queue) => {
      queue.onChanged((s) => deps.send('fetchly:changed', s));
      queue.onSaveState(deps.onSaveState);
      deps.attachTray(queue);
      // resumeAllPaused passes over cut-off jobs.
      if (deps.settings().autoResumeOnStart) queue.resumeAllPaused();
      deps.send('fetchly:changed', queue.snapshot());
      // Only a queue whose wiring completed gets a restarted aria2.
      wiredFile = fileOf.get(queue) ?? null;
    },

    disposeQueue: async (queue) => {
      try {
        await queue.shutdown();
      } finally {
        // Taken after the shutdown, so the cut-off marks it saved are kept.
        initial = queue.snapshot();
      }
    },

    attachDaemon: (daemon) => {
      if (!wiredFile) throw new Error('the file engine is not running');
      wiredFile.attach(daemon);
    },
  };
}
