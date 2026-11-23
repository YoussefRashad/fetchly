import { useCallback, useEffect, useRef, useState } from 'react';
import { isLanguageSetting, isThemeSetting } from '../../../shared/i18n';
import type { BinStatus, PairingsView, ServerStatus, Settings } from '../../../shared/types';
import { S } from '../strings';
import { decodeQuality, encodeQuality, parseLangs, qualityOptions } from './quality';

interface Props {
  settings: Settings;
  onSaved(s: Settings): void;
  onClose(): void;
}

const EMPTY_VIEW: PairingsView = { pairings: [], codeOpen: false, unsaved: false };

/**
 * The "Browser" panel: the server state, pairing with a code, the paired browsers and Unpair.
 * Pairing is offered only while the server listens on the port in the form (a changed port is saved first).
 */
function BrowserPanel({ draftPort }: { draftPort: number }) {
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [view, setView] = useState<PairingsView>(EMPTY_VIEW);
  const [code, setCode] = useState<{ text: string; until: number } | null>(null);
  // Monotonic (performance.now()), so a change of the Windows clock does not move the countdown.
  const [now, setNow] = useState(() => performance.now());
  const [error, setError] = useState<string | null>(null);
  // False once the panel is unmounted: a pairings() answer that arrives later is ignored.
  const alive = useRef(true);

  const refresh = useCallback(() => {
    void window.fetchly.pairings().then((v) => {
      if (alive.current) setView(v);
    });
  }, []);

  useEffect(() => {
    alive.current = true;
    const stop = window.fetchly.onStatus((s) => setServer(s.server));
    void window.fetchly.status().then((s) => setServer(s.server));
    refresh();
    // Polled every second for as long as the panel is shown: nothing pushes pairing changes (a pairing or an
    // unpair over HTTP, a failed write), so this is how the list and the unsaved line stay current.
    const timer = setInterval(refresh, 1000);
    return () => {
      alive.current = false;
      clearInterval(timer);
      stop();
    };
  }, [refresh]);

  // The countdown of the shown code.
  useEffect(() => {
    if (!code) return undefined;
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, [code]);

  // The code was used, cancelled or ended in the main process: the string is dead.
  useEffect(() => {
    if (!view.codeOpen) setCode(null);
  }, [view.codeOpen]);

  async function start() {
    setError(null);
    const res = await window.fetchly.pairingStart();
    if (!res.ok) {
      setError(res.error);
    } else {
      const at = performance.now();
      setNow(at);
      setCode({ text: res.value.pairingString, until: at + res.value.lifetimeMs });
    }
    refresh();
  }

  async function cancel() {
    setCode(null);
    await window.fetchly.pairingCancel();
    refresh();
  }

  async function unpair(id: string) {
    setError(null);
    const res = await window.fetchly.unpair(id);
    if (!res.ok) setError(res.error);
    refresh();
  }

  const listening = server?.state === 'listening';
  const canPair = server?.state === 'listening' && server.port === draftPort;
  const left = code ? Math.max(0, Math.ceil((code.until - now) / 1000)) : 0;

  let line: string;
  if (server === null) line = S.serverChecking;
  else if (server.state === 'listening') line = S.serverListening(server.port);
  else if (server.state === 'portBusy') line = S.serverPortBusy(server.port);
  else line = server.message;

  return (
    <>
      <h3>{S.browserTitle}</h3>
      <p className="note">{line}</p>
      {code ? (
        <div className="row">
          {left > 0 ? (
            <>
              <span>{S.pairEnter}</span>
              <strong style={{ fontFamily: 'monospace', fontSize: '1.25em', userSelect: 'all' }}>{code.text}</strong>
              <small>{S.pairExpiresIn(left)}</small>
            </>
          ) : (
            <span>{S.pairExpired}</span>
          )}
          <button type="button" onClick={() => void cancel()}>
            {S.pairCancel}
          </button>
        </div>
      ) : (
        <>
          <button type="button" disabled={!canPair} onClick={() => void start()}>
            {S.pairBrowser}
          </button>
          {listening && !canPair && <small>{S.pairSaveFirst}</small>}
        </>
      )}
      {view.pairings.length === 0 ? (
        <p className="muted">{S.noPairings}</p>
      ) : (
        <ul className="tools">
          {view.pairings.map((p) => (
            <li key={p.id}>
              <strong>{p.label}</strong> <span>{S.pairedAt(new Date(p.pairedAt).toLocaleString())}</span>{' '}
              <button type="button" onClick={() => void unpair(p.id)}>
                {S.unpair}
              </button>
            </li>
          ))}
        </ul>
      )}
      {view.unsaved && (
        <p className="error" role="status">
          {S.pairingsUnsaved}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

export function SettingsDialog({ settings, onSaved, onClose }: Props) {
  const [draft, setDraft] = useState(settings);
  const [langs, setLangs] = useState(settings.subtitleLangs.join(', '));
  const [bins, setBins] = useState<BinStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateNote, setUpdateNote] = useState<string | null>(null);

  useEffect(() => {
    void window.fetchly.binaries().then(setBins);
  }, []);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function browse() {
    const picked = await window.fetchly.pickFolder();
    if (picked) set('downloadDir', picked);
  }

  async function save() {
    setError(null);
    const res = await window.fetchly.setSettings({ ...draft, subtitleLangs: parseLangs(langs) });
    if (!res.ok) return setError(res.error);
    onSaved(res.value);
    onClose();
  }

  async function update() {
    setUpdating(true);
    setUpdateNote(null);
    const res = await window.fetchly.updateYtDlp();
    setUpdating(false);
    setUpdateNote(res.ok ? S.updatedTo(res.value) : res.error);
    void window.fetchly.binaries().then(setBins);
  }

  return (
    <div className="backdrop" role="dialog" aria-modal="true" aria-label={S.settingsTitle}>
      <div className="dialog">
        <h2>{S.settingsTitle}</h2>

        <h3>{S.appearance}</h3>
        <div className="row">
          <label>
            {S.language}
            <select value={draft.language} onChange={(e) => isLanguageSetting(e.target.value) && set('language', e.target.value)}>
              <option value="system">{S.languageSystem}</option>
              {/* Each language is named in itself, so it can be found from either. */}
              <option value="en" lang="en">
                English
              </option>
              <option value="ar" lang="ar">
                العربية
              </option>
            </select>
          </label>
          <label>
            {S.theme}
            <select value={draft.theme} onChange={(e) => isThemeSetting(e.target.value) && set('theme', e.target.value)}>
              <option value="system">{S.themeSystem}</option>
              <option value="light">{S.themeLight}</option>
              <option value="dark">{S.themeDark}</option>
            </select>
          </label>
        </div>

        <label>
          {S.downloadDir}
          <span className="row">
            <input type="text" dir="ltr" value={draft.downloadDir} onChange={(e) => set('downloadDir', e.target.value)} spellCheck={false} />
            <button type="button" onClick={() => void browse()}>
              {S.browse}
            </button>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.askEveryTime} onChange={(e) => set('askEveryTime', e.target.checked)} />
          {S.askEveryTime}
        </label>

        <label>
          {S.maxConcurrent}
          <input
            type="number"
            dir="ltr"
            min={1}
            max={8}
            value={draft.maxConcurrent}
            onChange={(e) => set('maxConcurrent', Number(e.target.value))}
          />
        </label>
        <label>
          {S.speedLimit}
          <input
            type="number"
            dir="ltr"
            min={0}
            step={50}
            value={draft.speedLimitKbps}
            onChange={(e) => set('speedLimitKbps', Number(e.target.value))}
          />
          <small>{S.speedLimitHint}</small>
        </label>

        <label>
          {S.defaultQuality}
          <select value={encodeQuality(draft.defaultQuality)} onChange={(e) => set('defaultQuality', decodeQuality(e.target.value))}>
            {qualityOptions(null).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {S.defaultSubtitles}
          <input type="text" dir="ltr" value={langs} onChange={(e) => setLangs(e.target.value)} spellCheck={false} />
          <small>{S.subtitlesHint}</small>
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.preferMp4Max1080} onChange={(e) => set('preferMp4Max1080', e.target.checked)} />
          {S.preferMp4}
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.autoResumeOnStart} onChange={(e) => set('autoResumeOnStart', e.target.checked)} />
          {S.autoResume}
        </label>

        <label>
          {S.serverPort}
          <input
            type="number"
            min={1024}
            max={65535}
            value={Number.isFinite(draft.serverPort) ? draft.serverPort : ''}
            onChange={(e) => set('serverPort', e.target.valueAsNumber)}
          />
          <small>{S.serverPortHint}</small>
        </label>

        <BrowserPanel draftPort={draft.serverPort} />

        <h3>{S.tools}</h3>
        <ul className="tools">
          {bins.map((b) => (
            <li key={b.name}>
              <strong>{b.name}</strong> <span>{b.installed ? (b.version ?? '') : S.notInstalled}</span>
            </li>
          ))}
        </ul>
        <button type="button" disabled={updating} onClick={() => void update()}>
          {updating ? S.updating : S.updateYtDlp}
        </button>
        {updateNote && <p className="note">{updateNote}</p>}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            {S.close}
          </button>
          <button type="button" className="primary" onClick={() => void save()}>
            {S.save}
          </button>
        </div>
      </div>
    </div>
  );
}
