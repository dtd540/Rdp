import type { FC } from 'react';

export const MeterBar: FC<{ label: string; peakDb: number | null; right?: string }> = ({
  label,
  peakDb,
  right
}) => {
  const db = peakDb ?? -100;
  const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  const live = peakDb !== null && db > -60;
  return (
    <div className="meter">
      <div className="label">
        <b>{label}</b>
        <span className="value">
          {right ?? (live ? `${Math.round(pct)}%` : '—')}
        </span>
      </div>
      <div className="bar">
        <div className="fill" style={{ width: `${live ? pct : 0}%` }} />
      </div>
    </div>
  );
};
