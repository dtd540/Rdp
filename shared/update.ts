export interface UpdateNotice {
  version: string;
  releaseNotes?: string;
}

export const RELEASE_NOTES_BY_VERSION: Record<string, string[]> = {
  '0.3.4': [
    'Save and restore your previous VoiceMeeter and Spotify audio routing settings.',
    'Confirm music-send changes only after VoiceMeeter acknowledges the updated routing.',
    'Fit chatbox messages more reliably and rotate selected templates in a safe, checked loop.'
  ],
  '0.3.5': [
    'See a one-time What’s New log after the app updates.',
    'Live meters now show simple percentage levels instead of negative dB values.',
    'Restored the Check for updates button in the sidebar.',
    'VoiceMeeter setup reads are more reliable while its audio engine is starting.'
  ]
};

export function normaliseAppVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

export function shouldShowWhatsNew(
  lastLaunchedVersion: string | null,
  lastSeenVersion: string | null,
  currentVersion: string,
  pendingNoticeVersion?: string | null,
  hasExistingSetup = false
): boolean {
  const current = normaliseAppVersion(currentVersion);
  if (lastSeenVersion !== null && normaliseAppVersion(lastSeenVersion) === current) return false;
  const upgradedSinceLastLaunch = lastLaunchedVersion !== null && normaliseAppVersion(lastLaunchedVersion) !== current;
  const firstLaunchOfExistingInstall = lastLaunchedVersion === null && hasExistingSetup;
  const hasPendingNotice = pendingNoticeVersion != null && normaliseAppVersion(pendingNoticeVersion) === current;
  return upgradedSinceLastLaunch || firstLaunchOfExistingInstall || hasPendingNotice;
}

export function whatsNewForVersion(version: string): UpdateNotice {
  const entries = RELEASE_NOTES_BY_VERSION[normaliseAppVersion(version)] ?? ['Bug fixes and improvements to keep your audio flowing.'];
  return { version: normaliseAppVersion(version), releaseNotes: entries.join('\n') };
}


export function normaliseReleaseNotes(value: unknown, version: string): string | undefined {
  const normalise = (notes: string) => notes.replace(/\r\n?/g, '\n').trim() || undefined;
  if (typeof value === 'string') return normalise(value);
  if (!Array.isArray(value)) return undefined;

  const notes = value
    .filter((entry): entry is { version?: unknown; note?: unknown } => typeof entry === 'object' && entry !== null)
    .filter((entry) => typeof entry.note === 'string' && (entry.version == null || entry.version === version))
    .map((entry) => normalise(entry.note as string))
    .filter((note): note is string => Boolean(note));
  return notes.length ? notes.join('\n\n') : undefined;
}

export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes?: string }
  | { state: 'not-available'; version: string }
  | { state: 'progress'; percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { state: 'downloaded'; version: string; releaseNotes?: string }
  | { state: 'error'; message: string };
