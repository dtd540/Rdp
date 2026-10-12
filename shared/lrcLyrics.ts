export interface LyricCue {
  timeMs: number;
  text: string;
}

const MAX_LRC_BYTES = 2 * 1024 * 1024;
const MAX_CUES = 5000;
const MAX_LYRIC_LENGTH = 300;
const LRC_TAG = /\[(\d{1,6}:[0-5]\d(?:[.:]\d{1,3})?|offset:\s*-?\d+)\]/ig;

function safeLyricText(value: string): string {
  return value.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LYRIC_LENGTH);
}

export function normaliseLyricCues(raw: unknown): LyricCue[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_CUES).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const cue = item as Partial<LyricCue>;
    if (!Number.isSafeInteger(cue.timeMs) || (cue.timeMs ?? -1) < 0 || typeof cue.text !== 'string') return [];
    const text = safeLyricText(cue.text);
    return text ? [{ timeMs: cue.timeMs!, text }] : [];
  }).sort((a, b) => a.timeMs - b.timeMs);
}

export function parseLrcLyrics(contents: string): LyricCue[] {
  if (typeof contents !== 'string') throw new Error('Lyrics file must be text.');
  if (new TextEncoder().encode(contents).byteLength > MAX_LRC_BYTES) throw new Error('Lyrics files are limited to 2 MB.');

  let offsetMs = 0;
  const lines = contents.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const line of lines) {
    const offset = /^\s*\[offset:\s*(-?\d+)\s*\]\s*$/i.exec(line);
    if (offset) {
      const parsed = Number(offset[1]);
      if (Number.isSafeInteger(parsed)) offsetMs = parsed;
    }
  }

  const cues: LyricCue[] = [];
  const timestamp = /\[(\d{1,6}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g;
  for (const line of lines) {
    const lyric = safeLyricText(line.replace(LRC_TAG, ''));
    if (!lyric) continue;
    for (const stamp of line.matchAll(timestamp)) {
      const minutes = Number(stamp[1]);
      const seconds = Number(stamp[2]);
      const fraction = (stamp[3] ?? '').padEnd(3, '0').slice(0, 3);
      const timeMs = Math.max(0, minutes * 60_000 + seconds * 1000 + Number(fraction || 0) + offsetMs);
      if (!Number.isSafeInteger(timeMs)) continue;
      cues.push({ timeMs, text: lyric });
      if (cues.length > MAX_CUES) throw new Error('Lyrics files may contain at most 5,000 timed lines.');
    }
  }

  return cues.sort((a, b) => a.timeMs - b.timeMs);
}

export function lyricAtPosition(cues: LyricCue[], positionSeconds: number): string {
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0 || cues.length === 0) return '';
  const positionMs = positionSeconds * 1000;
  let low = 0;
  let high = cues.length - 1;
  let match = -1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    if (cues[middle].timeMs <= positionMs) {
      match = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match < 0 ? '' : cues[match].text;
}
