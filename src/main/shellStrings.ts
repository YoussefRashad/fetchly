import { fsi, type Lang } from '../shared/i18n';

/** Text the main process shows itself: tray menu and tooltip, notifications, the runnable-file dialog and the start-up notice. */
const EN = {
  trayOpen: 'Open',
  trayPauseAll: 'Pause all',
  trayResumeAll: 'Resume all',
  trayQuit: 'Quit',
  tooltipIdle: 'Fetchly',
  tooltipActive: (n: number) => `Fetchly · ${n} downloading`,
  /** A download's or playlist's title inside a notification. */
  subject: (title: string) => title,
  jobFinished: 'Download finished',
  jobFailed: 'Download failed',
  jobSkipped: 'Download skipped',
  groupFinished: 'Playlist finished',
  countFailed: (n: number) => `${n} failed`,
  countSkipped: (n: number) => `${n} skipped`,
  runnableTitle: 'Open a file that can run a program?',
  runnableMessage: (fileName: string) => `"${fileName}" can run a program or change this PC when it is opened.`,
  runnableDetail: 'Open it only if you trust the site it came from.',
  runnableOpen: 'Open',
  runnableCancel: 'Cancel',
  corruptNotice: (path: string) => `The saved download list could not be read and was set aside as ${path}. The list starts empty.`,
};

export type ShellStrings = typeof EN;

const AR: ShellStrings = {
  trayOpen: 'فتح',
  trayPauseAll: 'إيقاف الكل مؤقتًا',
  trayResumeAll: 'استئناف الكل',
  trayQuit: 'خروج',
  tooltipIdle: 'Fetchly',
  tooltipActive: (n) => `Fetchly · ${n} قيد التنزيل`,
  subject: (title) => fsi(title),
  jobFinished: 'اكتمل التنزيل',
  jobFailed: 'فشل التنزيل',
  jobSkipped: 'تم تخطي التنزيل',
  groupFinished: 'اكتملت قائمة التشغيل',
  countFailed: (n) => `فشل ${n}`,
  countSkipped: (n) => `تم تخطي ${n}`,
  runnableTitle: 'فتح ملف يمكنه تشغيل برنامج؟',
  runnableMessage: (fileName) => `يمكن للملف «${fsi(fileName)}» تشغيل برنامج أو تغيير هذا الكمبيوتر عند فتحه.`,
  runnableDetail: 'افتحه فقط إذا كنت تثق بالموقع الذي جاء منه.',
  runnableOpen: 'فتح',
  runnableCancel: 'إلغاء',
  corruptNotice: (path) => `تعذّرت قراءة قائمة التنزيلات المحفوظة، فنُقلت جانبًا باسم ${fsi(path)}. تبدأ القائمة فارغة.`,
};

export const SHELL_STRINGS: Readonly<Record<Lang, ShellStrings>> = { en: EN, ar: AR };

export function shellStrings(lang: Lang): ShellStrings {
  return SHELL_STRINGS[lang];
}
