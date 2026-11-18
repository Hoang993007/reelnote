/** What a library video's file name says about it. */
export type ParsedVideoFileName = {
  /** Leading `NN - ` or `NN. ` (also `NNa - `, `NN-XX - `) lecture number; a part letter shares its number. */
  order: number | null;
  /** Leading `YYYY-MM-DD ` publish date. */
  date: string | null;
  title: string;
};

const MP4_EXTENSION = /\.mp4$/i;
/** Suffixes the video-translator pipeline appends, stripped from the end in this order. */
const TRAILING_SUFFIXES = [
  / \[EN dub\]$/,
  / \[[A-Za-z0-9_-]{11}\]$/, // YouTube id
  / \([A-Za-z0-9_-]{11}\)$/, // Instagram shortcode
];
const LEADING_ORDER = /^(\d{1,4})[a-z]?(?:-[A-Za-z]{2,3})?(?: - |\. )/;
const LEADING_DATE = /^(\d{4})-(\d{2})-(\d{2}) /;

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Splits a library file name into lecture number, date and display title; the stem is the fallback title. */
export function parseVideoFileName(name: string): ParsedVideoFileName {
  const stem = name.replace(MP4_EXTENSION, '');
  let rest = stem;
  for (const suffix of TRAILING_SUFFIXES) rest = rest.replace(suffix, '');

  let order: number | null = null;
  const orderMatch = LEADING_ORDER.exec(rest);
  if (orderMatch) {
    order = Number(orderMatch[1]);
    rest = rest.slice(orderMatch[0].length);
  }

  let date: string | null = null;
  const dateMatch = LEADING_DATE.exec(rest);
  if (dateMatch && isCalendarDate(Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3]))) {
    date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    rest = rest.slice(dateMatch[0].length);
  }

  return { order, date, title: rest.trim() || stem.trim() };
}

/** Natural file order (`2` before `10`, case-insensitive); exact text breaks ties so the order is stable. */
export function compareVideoFiles(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}
