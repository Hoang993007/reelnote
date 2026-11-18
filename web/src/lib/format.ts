const two = (value: number) => String(value).padStart(2, '0');

/** Playback time as `mm:ss`, or `h:mm:ss` from an hour on; NaN or negative reads `00:00`. */
export function fmtTime(seconds: number | null | undefined): string {
  const total = seconds != null && Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours ? `${hours}:${two(minutes)}:${two(total % 60)}` : `${two(minutes)}:${two(total % 60)}`;
}

/** A length in minutes: "42 min", "1 h 5 min". */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '';
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

/** When something happened, in words: "Just now", "12 min ago", "Yesterday", "3 Oct". */
export function fmtWhen(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  // SQLite's datetime('now') has no zone and means UTC.
  const at = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(at)) return '';
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 2) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** Two letters for a monogram: the initials of the first two words, or the first two letters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? '?').slice(0, 2).toUpperCase();
}

export function fmtBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}
