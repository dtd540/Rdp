import { useEffect, useState } from 'react';

/**
 * False while the window is hidden or minimised. The bridge stays alive in the
 * tray, so audio work that only feeds the UI (meters) can be paused then and
 * resumed when the window comes back.
 */
export function useWindowVisible(): boolean {
  const [visible, setVisible] = useState(() => !document.hidden);

  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  return visible;
}