import { useMemo, useState } from 'react';
import type { ProbeResult, Settings } from '../../../shared/types';
import { errorText } from '../errors';
import { formatBytes } from '../format';
import { S } from '../strings';
import { decodeQuality, encodeQuality, parseLangs, qualityOptions } from './quality';

interface Props {
  url: string;
  probe: ProbeResult;
  settings: Settings;
  onClose(): void;
}

export function AddDialog({ url, probe, settings, onClose }: Props) {
  const maxHeight = probe.kind === 'media' && probe.heights.length > 0 ? Math.max(...probe.heights) : null;
  const options = useMemo(() => qualityOptions(maxHeight), [maxHeight]);
  const preferred = encodeQuality(settings.defaultQuality);

  const [quality, setQuality] = useState(options.some((o) => o.value === preferred) ? preferred : 'best');
  const [dir, setDir] = useState(settings.downloadDir);
  const [langs, setLangs] = useState(settings.subtitleLangs.join(', '));
  const available = probe.kind === 'playlist' ? probe.entries.filter((e) => !e.unavailable) : [];
  const [selected, setSelected] = useState<Set<number>>(() => new Set(available.map((e) => e.index)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = probe.kind === 'file' ? probe.fileName : probe.title;
  const nothingSelected = probe.kind === 'playlist' && selected.size === 0;

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  }

  async function browse() {
    const picked = await window.fetchly.pickFolder();
    if (picked) setDir(picked);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await window.fetchly.add({
      url,
      probe,
      quality: probe.kind === 'file' ? null : decodeQuality(quality),
      subtitleLangs: probe.kind === 'file' ? [] : parseLangs(langs),
      dir,
      selectedIndexes: probe.kind === 'playlist' ? [...selected].sort((a, b) => a - b) : null,
    });
    setBusy(false);
    if (res.ok) onClose();
    else setError(errorText(res));
  }

  return (
    <div className="backdrop" role="dialog" aria-modal="true" aria-label={S.addTitle}>
      <div className="dialog">
        <h2>{S.addTitle}</h2>
        <div className="probe-head">
          {probe.kind === 'media' && probe.thumbnail && <img src={probe.thumbnail} alt="" />}
          <strong dir="auto">{title}</strong>
        </div>

        {probe.kind === 'file' ? (
          <>
            <p>
              {S.fileSize}: <bdi dir="ltr">{formatBytes(probe.size)}</bdi>
            </p>
            {!probe.resumable && <p className="note">{S.cannotResume}</p>}
          </>
        ) : (
          <>
            <label>
              {S.quality}
              <select value={quality} onChange={(e) => setQuality(e.target.value)}>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {S.subtitles}
              <input type="text" dir="ltr" value={langs} onChange={(e) => setLangs(e.target.value)} spellCheck={false} />
              <small>{S.subtitlesHint}</small>
            </label>
          </>
        )}

        {probe.kind === 'playlist' && (
          <fieldset className="entries">
            <legend>{S.selected(selected.size, available.length)}</legend>
            <div className="entries-actions">
              <button type="button" onClick={() => setSelected(new Set(available.map((e) => e.index)))}>
                {S.selectAll}
              </button>
              <button type="button" onClick={() => setSelected(new Set())}>
                {S.selectNone}
              </button>
            </div>
            <ul>
              {probe.entries.map((entry) => (
                <li key={entry.index} className={entry.unavailable ? 'muted' : undefined}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={entry.unavailable}
                      checked={!entry.unavailable && selected.has(entry.index)}
                      onChange={() => toggle(entry.index)}
                    />
                    <span className="num">{entry.index}</span>
                    <span dir="auto">{entry.title}</span>
                    {entry.unavailable && <em>{S.entryReasons[entry.reason ?? 'unavailable']}</em>}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        <label>
          {S.folder}
          <span className="row">
            <input type="text" dir="ltr" value={dir} onChange={(e) => setDir(e.target.value)} spellCheck={false} />
            <button type="button" onClick={() => void browse()}>
              {S.browse}
            </button>
          </span>
        </label>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            {S.close}
          </button>
          <button type="button" className="primary" disabled={busy || nothingSelected || dir.trim() === ''} onClick={() => void submit()}>
            {S.download}
          </button>
        </div>
      </div>
    </div>
  );
}
