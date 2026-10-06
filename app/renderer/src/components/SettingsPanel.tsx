import { useState, type FC } from 'react';
import { bridge, type BackgroundImage } from '../bridge';

export interface SettingsPanelProps {
  /** Resolved background, or null when the default dark theme is in use. */
  background: BackgroundImage | null;
  /** Re-read the persisted background from the main process. */
  refreshBackground: () => Promise<void>;
}

function describe(background: BackgroundImage | null): { title: string; detail: string } {
  if (!background) {
    return { title: 'Default dark theme', detail: 'No picture set — the app uses its built-in background.' };
  }
  if (background.broken) {
    return { title: background.name, detail: background.detail ?? 'That file cannot be shown. Pick it again.' };
  }
  return {
    title: background.name,
    detail: background.animated
      ? 'Animated GIF — it plays behind the app.'
      : 'Still image — stretched to cover the window.'
  };
}

/**
 * Settings tab. Options live here as cards; each one reads from and writes back
 * to the persisted app state (see `AppState` in shared/rpc.ts), so anything
 * added survives a restart.
 */
export const SettingsPanel: FC<SettingsPanelProps> = ({ background, refreshBackground }) => {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const { title, detail } = describe(background);
  const usable = Boolean(background && !background.broken && background.url);

  const run = async (op: 'pickBackgroundImage' | 'clearBackground'): Promise<void> => {
    setBusy(true);
    setNote(null);
    try {
      const result = await bridge.op(op);
      if (result.ok) {
        await refreshBackground();
        return;
      }
      // A closed file dialog is a normal outcome, not something to report.
      if (result.detail && result.detail !== 'cancelled') setNote(result.detail);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-root">
      <div className="section-heading">
        <div>
          <span className="section-kicker">TUNE THE BRIDGE</span>
          <h2>Settings</h2>
        </div>
      </div>

      <div className="card bg-card">
        <h2>App background</h2>
        <p className="sub">
          Paint a picture or an animated GIF behind the app. The file stays on this PC — nothing is
          uploaded — and removing it brings back the default dark theme.
        </p>
        <div className="bg-row">
          <div
            className={`bg-preview ${usable ? 'has-image' : ''}`}
            style={usable ? { backgroundImage: `url("${background!.url}")` } : undefined}
            title={background?.path || undefined}
            aria-hidden="true"
          >
            {usable ? null : <span>No background</span>}
          </div>
          <div className="bg-copy">
            <b>
              {title}
              {usable && background!.animated ? <span className="pill bg-badge">GIF · animated</span> : null}
            </b>
            <span>{detail}</span>
            {background?.path ? (
              <span className="bg-path" title={background.path}>
                {background.path}
              </span>
            ) : null}
            {note ? (
              <p className="bg-note" role="status">
                {note}
              </p>
            ) : null}
          </div>
          <div className="bg-actions">
            <button
              type="button"
              className="primary"
              onClick={() => void run('pickBackgroundImage')}
              disabled={busy}
            >
              {busy ? 'Working…' : usable ? 'Change…' : 'Choose image…'}
            </button>
            {background ? (
              <button type="button" onClick={() => void run('clearBackground')} disabled={busy}>
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>More options will live here</h2>
        <p className="sub">
          Toggles and sliders added to this tab show up here and are saved with your setup.
        </p>
      </div>
    </div>
  );
};