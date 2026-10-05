import { useEffect, useState, type FC } from 'react';
import { bridge, type UpdateStatus } from '../bridge';

const formatBytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export const UpdateBanner: FC = () => {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let mounted = true;
    void bridge.updates.getStatus().then((value) => { if (mounted && value) setStatus(value); });
    const unsubscribe = bridge.on((method, params) => {
      if (method === 'updates:status') setStatus(params as UpdateStatus);
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  const check = async () => {
    setChecking(true);
    try {
      setStatus(await bridge.updates.check());
    } catch (error) {
      setStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setChecking(false);
    }
  };

  let message = '';
  let progress: number | null = null;
  if (status?.state === 'checking') message = 'Checking for updates…';
  else if (status?.state === 'available') message = `Update v${status.version} found; downloading…`;
  else if (status?.state === 'not-available') message = `You’re up to date · v${status.version}`;
  else if (status?.state === 'progress') {
    progress = Math.min(100, Math.max(0, status.percent));
    message = `Downloading update · ${progress.toFixed(0)}% · ${formatBytes(status.transferred)} / ${formatBytes(status.total)}`;
  }  else if (status?.state === 'downloaded') message = `Update v${status.version} is ready.`;
  else if (status?.state === 'error') message = '';


  return (
    <div className="update-control">
      <button type="button" className="small update-check-button" onClick={() => void check()} disabled={checking}>
        {checking ? 'Checking…' : 'Check for updates'}
      </button>
      {message ? <span className="update-control-status" role="status" aria-live="polite">{message}</span> : null}
      {progress !== null ? <progress className="update-control-progress" max="100" value={progress} aria-label="Update download progress" /> : null}
      {status?.state === 'downloaded' ? (
        <button type="button" className="small primary" onClick={() => void bridge.updates.install()}>
          Restart to update
        </button>
      ) : null}
    </div>
  );
};
