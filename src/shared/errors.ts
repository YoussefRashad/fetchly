/**
 * The error codes the main process puts next to its English text, so the window can show the text in the language in
 * use. Every code has a kind:
 * - fixed: the text is a string;
 * - detail: the text is a function of a raw detail (an OS or tool message), which travels as `detail`;
 * - port: the text is a function of a port, which travels as `port` on a server status;
 * - reason: there is no text here; `error` is a reason token the window looks up in its reasons table.
 */
export type ErrorKind = 'fixed' | 'detail' | 'port' | 'reason';

/** Every code and its kind. */
export const ERROR_CODES = {
  badRequest: 'fixed',
  invalidLink: 'fixed',
  linkProblem: 'reason',
  unexpected: 'detail',
  toolsNotInstalled: 'fixed',
  toolsStarting: 'fixed',
  chooseFolder: 'fixed',
  subtitleLangs: 'fixed',
  selectOne: 'fixed',
  cannotWriteFolder: 'fixed',
  portInvalid: 'fixed',
  portChangeDeclined: 'fixed',
  settingsBusy: 'fixed',
  notListening: 'fixed',
  fourPaired: 'fixed',
  notPaired: 'fixed',
  unpairUnsaved: 'fixed',
  notFinished: 'fixed',
  fileGone: 'fixed',
  folderGone: 'fixed',
  closing: 'fixed',
  pauseNotConfirmed: 'fixed',
  cancelNotConfirmed: 'fixed',
  cutOff: 'fixed',
  deleteFailed: 'detail',
  savedNotApplied: 'detail',
  toolsStartFailed: 'detail',
  fileServiceStopped: 'fixed',
  serverStartFailed: 'fixed',
  serverBroken: 'fixed',
  serverStarting: 'fixed',
  serverStopped: 'fixed',
  portUnusable: 'port',
} as const satisfies Record<string, ErrorKind>;

export type ErrorCode = keyof typeof ERROR_CODES;

/** The codes of one kind. */
export type CodeOfKind<K extends ErrorKind> = { [C in ErrorCode]: (typeof ERROR_CODES)[C] extends K ? C : never }[ErrorCode];

/** The text of every code that is not a reason: a string, a function of the detail, or a function of the port. */
export type ErrorTexts = { [C in CodeOfKind<'fixed'>]: string } & { [C in CodeOfKind<'detail'>]: (detail: string) => string } & {
  [C in CodeOfKind<'port'>]: (port: number) => string;
};

/**
 * The English text of every code that is not a reason: the words English users saw before codes existed. The main
 * process builds every coded failure from it. Not `as const`: the Arabic dictionary must be able to hold other strings.
 */
export const ERROR_TEXT = {
  badRequest: 'That request is not valid',
  invalidLink: 'Enter a link that starts with http:// or https://',
  unexpected: (detail: string) => `Something went wrong: ${detail}`,
  toolsNotInstalled: 'Install the download tools first',
  toolsStarting: 'The download tools are still starting',
  chooseFolder: 'Choose a download folder',
  subtitleLangs: 'Subtitle languages must be codes like en or ar',
  selectOne: 'Select at least one item',
  cannotWriteFolder: 'cannot write to folder',
  portInvalid: 'Port must be a whole number from 1024 to 65535',
  portChangeDeclined: 'Settings were not saved: the port was not changed',
  settingsBusy: 'Settings are being saved',
  notListening: 'Pairing is possible only while Fetchly is listening for the browser',
  fourPaired: 'Four browsers are already paired. Unpair one first.',
  notPaired: 'This browser is not paired',
  unpairUnsaved: 'Unpaired, but the change is not saved yet; Fetchly keeps trying',
  notFinished: 'This download is not finished',
  fileGone: 'The file is no longer there',
  folderGone: 'The folder is no longer there',
  closing: 'Fetchly is closing',
  pauseNotConfirmed: 'Could not confirm that the download stopped. It is still listed as running; try again.',
  cancelNotConfirmed: 'Could not confirm that the download stopped, so nothing was deleted. It is still in the list; try again.',
  cutOff:
    'This download was cut off and Fetchly could not check that its old process is gone. End yt-dlp, ffmpeg and aria2c in Task Manager, then choose "They are gone" in the banner, or restart Fetchly.',
  deleteFailed: (detail: string) => `Could not delete the file: ${detail}`,
  savedNotApplied: (detail: string) => `Settings were saved, but the running downloads did not take them: ${detail}. Save again, or restart Fetchly.`,
  toolsStartFailed: (detail: string) => `The download tools could not be started: ${detail}`,
  fileServiceStopped: 'The file download service stopped',
  serverStartFailed: 'The browser connection could not start; save Settings to try again',
  serverBroken: 'The browser connection stopped working; save Settings to start it again',
  serverStarting: 'The browser connection is starting',
  serverStopped: 'The browser connection is stopped',
  portUnusable: (port: number) => `port ${port} cannot be used on this PC; choose another in Settings`,
} satisfies ErrorTexts;

/**
 * The start of the save error of the download list (a bare string, not coded): the window splits it off and
 * translates it, keeping the rest as the detail.
 */
export const SAVE_FAILED_PREFIX = 'could not save the download list: ';
