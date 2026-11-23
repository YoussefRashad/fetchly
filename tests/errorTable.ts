// The error-code table of the frozen plan docs/plans/2026-11-23-d-housekeeping.md (Commit B, item 2), written out
// as data for the specs: every code with its kind, its English text (byte for byte what the main process
// produces today) and its Arabic text. `fsi(x)` is the isolate the plan marks around x in its Arabic column.
// Shared by tests/errorCodes.test.ts and tests/renderer/errors.test.ts.
import type { ErrorCode } from '../src/shared/errors';
import { fsi } from '../src/shared/i18n';

export type Kind = 'fixed' | 'detail' | 'port' | 'reason';

/** Every code and its kind. Typed as a Record, so a code that is missing here or extra in the source fails typecheck. */
export const KINDS: Record<ErrorCode, Kind> = {
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
};

/** [code, English, Arabic] of every `fixed` code. */
export const FIXED: [ErrorCode, string, string][] = [
  ['badRequest', 'That request is not valid', 'هذا الطلب غير صالح'],
  ['invalidLink', 'Enter a link that starts with http:// or https://', `أدخل رابطًا يبدأ بـ ${fsi('http://')} أو ${fsi('https://')}`],
  ['toolsNotInstalled', 'Install the download tools first', 'ثبّت أدوات التنزيل أولًا'],
  ['toolsStarting', 'The download tools are still starting', 'ما زال تشغيل أدوات التنزيل جاريًا'],
  ['chooseFolder', 'Choose a download folder', 'اختر مجلدًا للتنزيل'],
  ['subtitleLangs', 'Subtitle languages must be codes like en or ar', `لغات الترجمة يجب أن تكون رموزًا مثل ${fsi('en')} أو ${fsi('ar')}`],
  ['selectOne', 'Select at least one item', 'حدّد عنصرًا واحدًا على الأقل'],
  ['cannotWriteFolder', 'cannot write to folder', 'تعذّرت الكتابة في المجلد'],
  ['portInvalid', 'Port must be a whole number from 1024 to 65535', `المنفذ يجب أن يكون عددًا صحيحًا من ${fsi('1024')} إلى ${fsi('65535')}`],
  ['portChangeDeclined', 'Settings were not saved: the port was not changed', 'لم تُحفظ الإعدادات: لم يتغيّر المنفذ'],
  ['settingsBusy', 'Settings are being saved', 'جارٍ حفظ الإعدادات'],
  ['notListening', 'Pairing is possible only while Fetchly is listening for the browser', 'الربط ممكن فقط أثناء انتظار Fetchly للمتصفح'],
  ['fourPaired', 'Four browsers are already paired. Unpair one first.', 'يوجد 4 متصفحات مربوطة بالفعل. ألغِ ربط أحدها أولًا.'],
  ['notPaired', 'This browser is not paired', 'هذا المتصفح غير مربوط'],
  ['unpairUnsaved', 'Unpaired, but the change is not saved yet; Fetchly keeps trying', 'أُلغي الربط، لكن التغيير لم يُحفظ بعد؛ يواصل Fetchly المحاولة'],
  ['notFinished', 'This download is not finished', 'هذا التنزيل لم يكتمل'],
  ['fileGone', 'The file is no longer there', 'الملف لم يعد موجودًا'],
  ['folderGone', 'The folder is no longer there', 'المجلد لم يعد موجودًا'],
  ['closing', 'Fetchly is closing', 'جارٍ إغلاق Fetchly'],
  [
    'pauseNotConfirmed',
    'Could not confirm that the download stopped. It is still listed as running; try again.',
    'تعذّر التأكد من توقف التنزيل. ما زال مدرجًا كتنزيل جارٍ؛ حاول مرة أخرى.',
  ],
  [
    'cancelNotConfirmed',
    'Could not confirm that the download stopped, so nothing was deleted. It is still in the list; try again.',
    'تعذّر التأكد من توقف التنزيل، فلم يُحذف شيء. ما زال في القائمة؛ حاول مرة أخرى.',
  ],
  [
    'cutOff',
    'This download was cut off and Fetchly could not check that its old process is gone. End yt-dlp, ffmpeg and aria2c in Task Manager, then choose "They are gone" in the banner, or restart Fetchly.',
    'انقطع هذا التنزيل، ولم يتمكن Fetchly من التحقق من انتهاء عمليته القديمة. أنهِ yt-dlp و ffmpeg و aria2c من إدارة المهام، ثم اختر «أُنهيت العمليات» في الشريط، أو أعد تشغيل Fetchly.',
  ],
  ['fileServiceStopped', 'The file download service stopped', 'توقفت خدمة تنزيل الملفات'],
  [
    'serverStartFailed',
    'The browser connection could not start; save Settings to try again',
    'تعذّر بدء الاتصال بالمتصفح؛ احفظ الإعدادات للمحاولة من جديد',
  ],
  [
    'serverBroken',
    'The browser connection stopped working; save Settings to start it again',
    'توقف الاتصال بالمتصفح عن العمل؛ احفظ الإعدادات لتشغيله من جديد',
  ],
  ['serverStarting', 'The browser connection is starting', 'جارٍ بدء الاتصال بالمتصفح'],
  ['serverStopped', 'The browser connection is stopped', 'الاتصال بالمتصفح متوقف'],
];

/** [code, English(detail), Arabic(detail)] of every `detail` code. */
export const DETAIL: [ErrorCode, (detail: string) => string, (detail: string) => string][] = [
  ['unexpected', (d) => `Something went wrong: ${d}`, (d) => `حدث خطأ: ${fsi(d)}`],
  ['deleteFailed', (d) => `Could not delete the file: ${d}`, (d) => `تعذّر حذف الملف: ${fsi(d)}`],
  [
    'savedNotApplied',
    (d) => `Settings were saved, but the running downloads did not take them: ${d}. Save again, or restart Fetchly.`,
    (d) => `حُفظت الإعدادات، لكن التنزيلات الجارية لم تأخذ بها: ${fsi(d)}. احفظ مرة أخرى، أو أعد تشغيل Fetchly.`,
  ],
  ['toolsStartFailed', (d) => `The download tools could not be started: ${d}`, (d) => `تعذّر تشغيل أدوات التنزيل: ${fsi(d)}`],
];

/** [code, English(port), Arabic(port)] of every `port` code. */
export const PORT: [ErrorCode, (port: number) => string, (port: number) => string][] = [
  [
    'portUnusable',
    (p) => `port ${p} cannot be used on this PC; choose another in Settings`,
    (p) => `لا يمكن استخدام المنفذ ${fsi(String(p))} على هذا الكمبيوتر؛ اختر منفذًا آخر من الإعدادات`,
  ],
];

/** The codes whose text is a function of the raw detail or port: where a stray value must never leak. */
export const NON_REASON_CODES: readonly ErrorCode[] = [...FIXED.map(([c]) => c), ...DETAIL.map(([c]) => c), ...PORT.map(([c]) => c)];

/** The three entries of `errors` that are not codes: [key, English, Arabic]. */
export const EXTRA = {
  other: [(t: string) => t, (t: string) => fsi(t)],
  saveFailed: [(d: string) => `could not save the download list: ${d}`, (d: string) => `تعذّر حفظ قائمة التنزيلات: ${fsi(d)}`],
  serverAnswered: [(n: string) => `server answered ${n}`, (n: string) => `ردّ الخادم بالرمز ${fsi(n)}`],
} as const;

/** The three reasons of the link probe that EN.reasons / AR.reasons gain: [English key, Arabic]. */
export const NEW_REASONS: [string, string][] = [
  ['could not reach the server', 'تعذّر الوصول إلى الخادم'],
  ['this link is a web page, not a file', 'هذا الرابط صفحة ويب وليس ملفًا'],
  ['yt-dlp stopped before it could read the link. Try again.', 'توقف yt-dlp قبل أن يقرأ الرابط. حاول مرة أخرى.'],
];
