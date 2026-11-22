import { useEffect, useState } from 'react';
import type { BinStatus, Settings } from '../../../shared/types';
import { S } from '../strings';
import { decodeQuality, encodeQuality, parseLangs, qualityOptions } from './quality';

interface Props {
  settings: Settings;
  onSaved(s: Settings): void;
  onClose(): void;
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

        <label>
          {S.downloadDir}
          <span className="row">
            <input type="text" value={draft.downloadDir} onChange={(e) => set('downloadDir', e.target.value)} spellCheck={false} />
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
          <input type="text" value={langs} onChange={(e) => setLangs(e.target.value)} spellCheck={false} />
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
