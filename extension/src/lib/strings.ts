/**
 * The popup's texts (plan section 5, N14, N26; A3 reuses them). TS tables, not _locales: the language
 * follows the browser through resolveLang('system', locale), with no switch.
 */
import { fsi, resolveLang } from '../../../src/shared/i18n';

// R2-2: the example code is isolated so that it reads port first inside Arabic text.
const EXAMPLE = fsi('38917-ABCD2345');

export const EN = {
  checking: 'Checking…',
  notPaired: 'Not paired',
  notPairedHint: 'In Fetchly, open Settings, press Pair a browser, then type the code here.',
  appNotRunning: 'Fetchly is not running',
  appNotRunningHint: 'Start Fetchly. If you changed its port, pair again.',
  wrongProgram: 'Another program uses this port',
  connected: 'Connected',
  version: 'Fetchly version',
  rateLimited: 'Fetchly is busy. Try again in a minute.',
  busy: 'Fetchly is showing another link',
  appError: 'Fetchly reported an error',
  mismatch: 'This extension and Fetchly could not communicate. Check that both are up to date.',
  slow: 'That took too long. Press Check again.',
  storageBlocked: 'This browser cannot keep the pairing safely',
  storageFailed: 'The pairing could not be saved. Pair again.',
  interrupted: 'No answer from the extension. If you were pairing, pair again, then remove the extra browser in Fetchly Settings.',
  badInput: `That is not a pairing code. It looks like ${EXAMPLE}.`,
  wrongCode: 'Wrong code. Check it and try again.',
  pairingClosed: 'No code is open in Fetchly, or it expired. Press Pair a browser again.',
  // Amendment 2 (AM2-1): the gate's reply to a pair or an unpair while another one runs.
  operationRunning: 'Another operation is running. Try again.',
  unpairedLocalOnly: 'Removed here. If Fetchly still lists this browser, unpair it in Settings.',
  codeLabel: 'Pairing code',
  nameLabel: 'Browser name',
  pairButton: 'Pair',
  pairAgain: 'Pair again',
  checkAgain: 'Check again',
  unpair: 'Unpair',
};

export type Strings = typeof EN;

export const AR: Strings = {
  checking: 'جارٍ التحقق…',
  notPaired: 'غير مربوط',
  notPairedHint: 'في Fetchly افتح الإعدادات واضغط «ربط متصفح»، ثم اكتب الرمز هنا.',
  appNotRunning: 'Fetchly لا يعمل',
  appNotRunningHint: 'شغّل Fetchly. إذا غيّرت المنفذ، اربط من جديد.',
  wrongProgram: 'برنامج آخر يستخدم هذا المنفذ',
  connected: 'متصل',
  version: 'إصدار Fetchly',
  rateLimited: 'Fetchly مشغول. حاول مرة أخرى بعد دقيقة.',
  busy: 'Fetchly يعرض رابطًا آخر',
  appError: 'Fetchly أبلغ عن خطأ',
  mismatch: 'تعذّر الاتصال بين هذه الإضافة و Fetchly. تأكد من أنهما بآخر إصدار.',
  slow: 'استغرق ذلك وقتًا طويلًا. اضغط «تحقق مرة أخرى».',
  storageBlocked: 'هذا المتصفح لا يستطيع حفظ الربط بأمان',
  storageFailed: 'تعذّر حفظ الربط. اربط من جديد.',
  interrupted: 'لا رد من الإضافة. إذا كنت تربط، اربط من جديد ثم احذف المتصفح الزائد من إعدادات Fetchly.',
  badInput: `هذا ليس رمز ربط. شكله مثل ${EXAMPLE}.`,
  wrongCode: 'الرمز غير صحيح. راجعه وحاول مرة أخرى.',
  pairingClosed: 'لا يوجد رمز مفتوح في Fetchly أو انتهت صلاحيته. اضغط «ربط متصفح» من جديد.',
  // PROVISIONAL for the owner (amendment 2).
  operationRunning: 'عملية أخرى قيد التنفيذ. حاول مرة أخرى.',
  unpairedLocalOnly: 'حُذف هنا. إذا ظل هذا المتصفح في قائمة Fetchly، ألغِ ربطه من الإعدادات.',
  codeLabel: 'رمز الربط',
  nameLabel: 'اسم المتصفح',
  pairButton: 'ربط',
  pairAgain: 'ربط من جديد',
  checkAgain: 'تحقق مرة أخرى',
  unpair: 'إلغاء الربط',
};

/** AR for an Arabic browser locale, EN for any other, empty or missing one. */
export function pick(locale: string | undefined): Strings {
  return resolveLang('system', locale) === 'ar' ? AR : EN;
}
