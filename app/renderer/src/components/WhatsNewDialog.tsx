import type { FC } from 'react';
import type { UpdateNotice } from '@shared/update';

interface Props {
  notice: UpdateNotice;
  onDismiss: () => void;
}

function notesToLines(notes: string): string[] {
  return notes
    .replace(/\r\n?/g, '\n')
    .split(/\n+|\s+[•*]\s+|\s+[-–—]\s+/)
    .map((line) => line.replace(/^\s*(?:[-*•]+\s*)/, '').trim())
    .filter(Boolean);
}

export const WhatsNewDialog: FC<Props> = ({ notice, onDismiss }) => {
  const entries = notice.releaseNotes ? notesToLines(notice.releaseNotes) : [];

  return (
    <div className="modal-backdrop whats-new-backdrop">
      <section className="card whats-new-dialog" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
        <span className="section-kicker">UPDATE COMPLETE</span>
        <h2 id="whats-new-title">What’s new in v{notice.version}?</h2>
        <p className="sub">Here’s what changed since your last version.</p>
        {entries.length ? (
          <ul className="whats-new-list">
            {entries.map((entry, index) => <li key={`${index}:${entry}`}>{entry}</li>)}
          </ul>
        ) : (
          <p className="whats-new-empty">No release notes were published for this version.</p>
        )}
        <div className="row whats-new-actions">
          <button type="button" className="primary" autoFocus onClick={onDismiss}>Got it</button>
        </div>
      </section>
    </div>
  );
};
