/**
 * The popup: DOM glue only. It feeds clicks to popupModel and renders its state with textContent. Every
 * request and every secret stays in the service worker (E8d).
 */
import { dirOf, resolveLang } from '../../src/shared/i18n';
import { createPopupModel, type ModelState } from './lib/popupModel';
import { pick } from './lib/strings';
import { viewOf } from './lib/view';

const locale = chrome.i18n.getUILanguage();
const lang = resolveLang('system', locale);
const t = pick(locale);
document.documentElement.lang = lang;
document.documentElement.dir = dirOf(lang);

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`popup.html has no #${id}`);
  return found as T;
}

const title = el('title');
const hint = el('hint');
const versionRow = el('version-row');
const version = el('version');
const form = el<HTMLFormElement>('pair-form');
const code = el<HTMLInputElement>('code');
const name = el<HTMLInputElement>('name');
const checkAgain = el<HTMLButtonElement>('check-again');
const pairAgain = el<HTMLButtonElement>('pair-again');
const unpair = el<HTMLButtonElement>('unpair');

el('version-label').textContent = t.version;
el('code-label').textContent = t.codeLabel;
el('name-label').textContent = t.nameLabel;
el('pair').textContent = t.pairButton;
checkAgain.textContent = t.checkAgain;
pairAgain.textContent = t.pairAgain;
unpair.textContent = t.unpair;

function render(s: ModelState): void {
  const v = viewOf(s.reply, t);
  title.textContent = v.title;
  hint.textContent = v.hint;
  hint.hidden = v.hint === '';
  const appVersion = s.reply.state === 'connected' ? s.reply.appVersion : undefined;
  version.textContent = appVersion ?? '';
  versionRow.hidden = appVersion === undefined;
  form.hidden = !(v.showForm || s.formOpen);
  unpair.hidden = !v.showUnpair;
  checkAgain.hidden = !s.showCheckAgain;
  pairAgain.hidden = !s.showPairAgain;
}

const model = createPopupModel({
  send: (msg) => chrome.runtime.sendMessage(msg),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => {
    if (typeof handle === 'number') clearTimeout(handle);
  },
  onChange: render,
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  model.submit(code.value, name.value);
});
checkAgain.addEventListener('click', () => model.checkAgain());
pairAgain.addEventListener('click', () => model.pairAgain());
unpair.addEventListener('click', () => model.unpair());

model.open();
