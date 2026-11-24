import type { Lang } from '../../shared/i18n';
import type { BinName, EntryReason, GroupVerb, JobVerb } from '../../shared/types';
import type { Filter } from './format';
import { AR } from './strings.ar';

/** One line of the install screen: a tool and what it does. */
type ToolLine = readonly [BinName, string];

/**
 * English text of the window. `S` holds the text of the language in use; read it inside
 * functions only, never into a module-level constant, or the text stays in the old language.
 */
export const EN = {
  appName: 'Fetchly',
  urlPlaceholder: 'Paste a video, playlist or file link',
  add: 'Add',
  checking: 'Checking…',
  settings: 'Settings',
  emptyTitle: 'Nothing here yet',
  emptyHint: 'Paste a link above to start a download.',
  emptyFilter: 'No downloads match this filter.',
  filters: { all: 'All', downloading: 'Downloading', paused: 'Paused', done: 'Done', failed: 'Failed' } satisfies Record<Filter, string>,
  verbs: {
    pause: 'Pause',
    resume: 'Resume',
    cancel: 'Cancel',
    retry: 'Retry',
    remove: 'Remove from list',
    removeWithFile: 'Delete file',
  } satisfies Record<JobVerb, string>,
  groupVerbs: { pause: 'Pause all', resume: 'Resume all', cancel: 'Cancel all' } satisfies Record<GroupVerb, string>,
  openFile: 'Open',
  openFolder: 'Open folder',
  confirmCancel: (title: string) => `Cancel "${title}"? What was downloaded so far will be deleted.`,
  confirmCancelGroup: (title: string) => `Cancel the rest of "${title}"? Finished files are kept; unfinished ones are deleted.`,
  confirmDeleteFile: (title: string) => `Delete the file of "${title}" from disk?`,
  items: (done: number, total: number) => `${done} / ${total}`,
  /** Formats the date-added column (Western digits in both languages). */
  dateLocale: 'en-GB',
  /** The list's column headings; the actions column has none. */
  columns: {
    name: 'File name',
    quality: 'Quality',
    size: 'Size',
    status: 'Status',
    speed: 'Speed',
    timeLeft: 'Time left',
    added: 'Added',
  },
  status: {
    queued: 'queued',
    starting: 'starting…',
    downloading: 'downloading',
    finishing: 'finishing…',
    done: 'done',
    failed: 'failed',
    failedWith: (reason: string) => `failed: ${reason}`,
    skipped: 'skipped',
    skippedWith: (reason: string) => `skipped: ${reason}`,
    paused: 'paused',
    pausedAt: (pct: number) => `paused ${pct}%`,
    cannotResume: 'cannot resume',
    waitingForCheck: 'waiting for a check',
    retrying: (attempt: number, max: number) => `retrying (${attempt}/${max})`,
  },
  /** Every reason the main process gives a failed or skipped job, by its English text. */
  reasons: {
    protected: 'protected',
    'login required': 'login required',
    'unavailable in region': 'unavailable in region',
    private: 'private',
    removed: 'removed',
    unavailable: 'unavailable',
    'disk full': 'disk full',
    'cannot write to folder': 'cannot write to folder',
    'unsupported site': 'unsupported site',
    'download failed': 'download failed',
    'finished without a file': 'finished without a file',
    'not a file download': 'not a file download',
    'not a media download': 'not a media download',
    'yt-dlp is not installed': 'yt-dlp is not installed',
    'timed out reading the link': 'timed out reading the link',
    'could not read the video information': 'could not read the video information',
    'file not found on server': 'file not found on server',
    'file already exists': 'file already exists',
    'download was removed': 'download was removed',
    'the download service stopped': 'the download service stopped',
    'the download service is not running': 'the download service is not running',
    'the sign-in sent with this link was not kept; send it again from the browser':
      'the sign-in sent with this link was not kept; send it again from the browser',
    'could not start the download': 'could not start the download',
  },
  size: {
    mediaHint: 'Size of the part downloading now; video and audio download separately.',
  },
  /** The quality column's word for "best available". */
  qualityBestShort: 'best',

  addTitle: 'Add download',
  quality: 'Quality',
  qualityBest: 'Best available',
  qualityMax: (h: number) => `Up to ${h}p`,
  qualityAudio: (f: string) => `Audio only (${f})`,
  folder: 'Save to',
  browse: 'Browse…',
  subtitles: 'Subtitles',
  subtitlesHint: 'Language codes separated by commas, for example: ar, en. Leave empty for none.',
  selectAll: 'Select all',
  selectNone: 'Select none',
  selected: (n: number, m: number) => `${n} of ${m} selected`,
  entryReasons: { private: 'private', removed: 'removed', unavailable: 'unavailable' } satisfies Record<EntryReason, string>,
  download: 'Download',
  close: 'Close',
  fileSize: 'Size',
  cannotResume: 'This server does not support resuming. If the download is interrupted it starts again from the beginning.',

  settingsTitle: 'Settings',
  appearance: 'Appearance',
  language: 'Language',
  languageSystem: 'System',
  theme: 'Theme',
  themeSystem: 'System',
  themeLight: 'Light',
  themeDark: 'Dark',
  downloadDir: 'Download folder',
  askEveryTime: 'Ask where to save every time',
  maxConcurrent: 'Downloads at the same time',
  speedLimit: 'Speed limit (KB/s, 0 = no limit)',
  speedLimitHint: 'Changing the limit restarts videos that are downloading; they continue from where they were.',
  autoResume: 'Continue paused downloads when the app starts',
  preferMp4: 'Always save video as mp4 (limits quality to 1080p)',
  defaultQuality: 'Default quality',
  defaultSubtitles: 'Default subtitles',
  save: 'Save',
  serverPort: 'Browser connection port',
  serverPortHint: 'Changing the port removes every paired browser; pair them again afterwards.',
  browserTitle: 'Browser',
  serverListening: (port: number) => `Listening for the browser extension on port ${port}.`,
  serverPortBusy: (port: number) => `Port ${port} is in use by another program. Choose another port and save.`,
  serverChecking: 'Checking the browser connection…',
  pairBrowser: 'Pair a browser',
  pairSaveFirst: 'Save the new port first, then pair.',
  pairEnter: 'Type this in the Fetchly extension popup:',
  pairExpiresIn: (seconds: number) => `Valid for ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
  pairExpired: 'This code has expired. Pair again for a new one.',
  pairCancel: 'Cancel',
  noPairings: 'No browser is paired.',
  pairedAt: (when: string) => `paired ${when}`,
  unpair: 'Unpair',
  pairingsUnsaved: 'Pairing changes are not saved to disk yet',
  tools: 'Download tools',
  notInstalled: 'not installed',
  updateYtDlp: 'Update yt-dlp',
  updating: 'Updating…',
  updatedTo: (v: string) => `yt-dlp is now ${v}`,

  installTitle: 'One-time setup',
  installBody:
    'Fetchly needs three free tools to download. They are fetched from their official GitHub release pages into the app’s own data folder, and yt-dlp and ffmpeg are checked against their published checksums; aria2 is checked against a checksum built into Fetchly.',
  installTools: [
    ['yt-dlp', 'reads video sites and downloads the streams'],
    ['ffmpeg', 'joins the video and audio into one file'],
    ['aria2c', 'downloads ordinary files over several connections'],
  ] as readonly [ToolLine, ToolLine, ToolLine],
  install: 'Install',
  installing: 'Installing…',
  retryInstall: 'Try again',

  portBusyBanner: (port: number) => `port ${port} is in use; change it in Settings`,
  cutOffBanner:
    'Some downloads were cut off and Fetchly could not check that their old processes are gone. End yt-dlp, ffmpeg and aria2c in Task Manager, then confirm.',
  retry: 'Retry',
  theyAreGone: 'They are gone',
  confirmStraysGone: 'Are yt-dlp, ffmpeg and aria2c no longer listed in Task Manager? The cut-off downloads can then be resumed.',
};

export type Strings = typeof EN;

/** The text in use; setLanguage swaps it. */
export const S: Strings = { ...EN };

/** Puts the text of `lang` into S. EN and AR themselves are never changed. */
export function setLanguage(lang: Lang): void {
  Object.assign(S, lang === 'ar' ? AR : EN);
}
