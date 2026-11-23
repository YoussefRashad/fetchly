/**
 * The errors of the main process in the language in use. Each failure and each error status carries its English text
 * (`error` or `message`) and, when main knows it, a code (src/shared/errors.ts). A code the window does not know, or
 * one whose detail or port is missing, shows the text as it came: English, inside one isolate in Arabic.
 *
 * Pure; reads S inside each call, so a text built after setLanguage is in the new language. This is the one place of
 * the window that reads `.error` or `.message` (tests/renderer/consumers.test.ts).
 */
import { ERROR_CODES, SAVE_FAILED_PREFIX, type CodeOfKind, type ErrorCode } from '../../shared/errors';
import type { EngineStatus, ErrorInfo, Result, ServerStatus, Settings } from '../../shared/types';
import { knownReason } from './format';
import { S } from './strings';

/** The error variant of an engine or a server status. */
export type ErrorStatus = Extract<EngineStatus, { state: 'error' }> | Extract<ServerStatus, { state: 'error' }>;

/** A notice of App's dismissible banner: a string is already worded by main (the startup notice), an ErrorInfo is translated at render. */
export type Notice = string | ErrorInfo;

/** What a settings save means for the dialog: the saved settings, a notice for App, or the failure for its own line. */
export interface SettingsOutcome {
  saved: Settings | null;
  notice: ErrorInfo | null;
  failure: ErrorInfo | null;
}

/** A link-probe reason with a status number; the digits are kept as text, so English equals the reason (`007`). */
const SERVER_ANSWERED = /^server answered (\d+)$/u;

/** The text as it came when it is a string, else empty text (never the word "undefined"). */
const textOf = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The code when it is an own key of ERROR_CODES (never a prototype name), else null. */
const codeOf = (v: unknown): ErrorCode | null => (typeof v === 'string' && Object.hasOwn(ERROR_CODES, v) ? (v as ErrorCode) : null);

/** A link-probe reason: its table entry or retry count, else "server answered <n>", else the text as it came. */
function reasonOf(text: string): string {
  const known = knownReason(text);
  if (known !== null) return known;
  const answered = SERVER_ANSWERED.exec(text);
  if (answered) return S.errors.serverAnswered(answered[1] as string);
  return S.errors.other(text);
}

/** The text of a failed Result (or a warning) in the language in use. */
export function errorText(info: ErrorInfo): string {
  const text = textOf(info.error);
  const code = codeOf(info.code);
  if (code === null) return S.errors.other(text);
  switch (ERROR_CODES[code]) {
    case 'fixed':
      return S.errors[code as CodeOfKind<'fixed'>];
    case 'detail':
      return typeof info.detail === 'string' ? S.errors[code as CodeOfKind<'detail'>](info.detail) : S.errors.other(text);
    case 'reason':
      return reasonOf(text);
    default:
      // A port code: an ErrorInfo has no port.
      return S.errors.other(text);
  }
}

/** The text of an error status (engine or server) in the language in use. A reason code has no meaning here. */
export function statusMessage(status: ErrorStatus): string {
  const fields = status as { message?: unknown; code?: unknown; detail?: unknown; port?: unknown };
  const text = textOf(fields.message);
  const code = codeOf(fields.code);
  if (code === null) return S.errors.other(text);
  switch (ERROR_CODES[code]) {
    case 'fixed':
      return S.errors[code as CodeOfKind<'fixed'>];
    case 'detail':
      return typeof fields.detail === 'string' ? S.errors[code as CodeOfKind<'detail'>](fields.detail) : S.errors.other(text);
    case 'port':
      return Number.isInteger(fields.port) ? S.errors[code as CodeOfKind<'port'>](fields.port as number) : S.errors.other(text);
    default:
      return S.errors.other(text);
  }
}

/** The save error of the download list: the English prefix is translated, the rest is kept as its detail. */
export function saveErrorText(saveError: string): string {
  const text = textOf(saveError);
  if (text.startsWith(SAVE_FAILED_PREFIX)) return S.errors.saveFailed(text.slice(SAVE_FAILED_PREFIX.length));
  return S.errors.other(text);
}

/** The text of App's notice: a string as it is, an ErrorInfo through errorText. */
export function noticeText(notice: Notice): string {
  return typeof notice === 'string' ? notice : errorText(notice);
}

/** Splits the answer of setSettings: ok gives the saved settings and its warning as the notice; a failure gives only the failure. */
export function settingsOutcome(res: Result<Settings>): SettingsOutcome {
  if (res.ok) return { saved: res.value, notice: res.warning ?? null, failure: null };
  const failure: ErrorInfo = { error: res.error };
  if (res.code !== undefined) failure.code = res.code;
  if (res.detail !== undefined) failure.detail = res.detail;
  return { saved: null, notice: null, failure };
}
