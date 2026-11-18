import { fmtTime } from '../lib/format';
import type { TranscriptCue } from '../lib/types';

/** A pause this long between two lines starts a new paragraph in the copied text. */
const PARAGRAPH_GAP_SEC = 2;

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The transcript as running text: subtitle lines joined into paragraphs at the pauses. */
export function transcriptAsText(cues: readonly TranscriptCue[]): string {
  const paragraphs: string[][] = [];
  let previousEnd = -Infinity;
  for (const cue of cues) {
    const text = clean(cue.text);
    if (!text) continue;
    if (!paragraphs.length || cue.startSec - previousEnd >= PARAGRAPH_GAP_SEC) paragraphs.push([]);
    paragraphs[paragraphs.length - 1].push(text);
    previousEnd = cue.endSec;
  }
  return paragraphs.map((words) => words.join(' ')).join('\n\n');
}

/** One line per subtitle, with its start time, as the transcript pane shows it. */
export function transcriptWithTimes(cues: readonly TranscriptCue[]): string {
  return cues.map((cue) => clean(cue.text) && `${fmtTime(cue.startSec)}  ${clean(cue.text)}`).filter(Boolean).join('\n');
}
