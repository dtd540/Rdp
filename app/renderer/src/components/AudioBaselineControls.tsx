import { useState, type FC } from 'react';
import { bridge, type AppState } from '../bridge';

interface Props {
  state: AppState;
  setState: (patch: Partial<AppState>) => Promise<AppState>;
}

export const AudioBaselineControls: FC<Props> = ({ state, setState }) => {
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState('');

  const save = async () => {
    setBusy(true);
    try {
      const result = await bridge.op('saveAudioBaseline');
      setDetail(result.detail ?? (result.ok ? 'Audio settings saved.' : 'Could not save audio settings.'));
      if (result.ok) {
        const next = await bridge.getState();
        await setState({ audioBaseline: next.audioBaseline });
      }
    } catch (error) {
      setDetail(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!state.audioBaseline || !window.confirm('Restore the saved Spotify output and VoiceMeeter settings?')) return;
    setBusy(true);
    try {
      const result = await bridge.op('restoreAudioBaseline');
      setDetail(result.detail ?? (result.ok ? 'Saved audio settings restored.' : 'Could not restore saved settings.'));
      if (result.ok) {
        const next = await bridge.getState();
        await setState({
          musicVolumeDb: next.musicVolumeDb,
          musicMutedToVrchat: next.musicMutedToVrchat,
          duckingEnabled: next.duckingEnabled
        });
      }
    } catch (error) {
      setDetail(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return <div className="audio-baseline-controls">
    <div className="row">
      <button type="button" className="small ghost" disabled={busy} onClick={() => void save()}>
        {busy ? 'Working…' : 'Save current audio settings'}
      </button>
      {state.audioBaseline && <button type="button" className="small" disabled={busy} onClick={() => void restore()}>
        Restore saved settings
      </button>}
    </div>
    <p className="hint">Save before routing. Restore returns Spotify and VoiceMeeter to your saved mix.</p>
    {detail && <p className="hint" role="status">{detail}</p>}
    {state.audioBaseline && <p className="hint">Saved {new Date(state.audioBaseline.capturedAt).toLocaleString()}.</p>}
  </div>;
};
