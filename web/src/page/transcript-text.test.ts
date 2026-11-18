import { describe, expect, it } from 'vitest';
import { transcriptAsText, transcriptWithTimes } from './transcript-text';

const cues = [
  { startSec: 310, endSec: 314, text: 'students are lining up to ask a question,' },
  { startSec: 314, endSec: 319, text: "they're raising  their hands in the room," },
  { startSec: 326, endSec: 335, text: 'The answer is in chapter two.' },
  { startSec: 335, endSec: 336, text: '   ' },
];

describe('transcript text', () => {
  it('joins lines into paragraphs that break at a pause of 2 s or more', () => {
    expect(transcriptAsText(cues)).toBe(
      "students are lining up to ask a question, they're raising their hands in the room,\n\nThe answer is in chapter two.",
    );
  });

  it('keeps one timed line per subtitle and drops empty ones', () => {
    expect(transcriptWithTimes(cues).split('\n')).toEqual([
      '05:10  students are lining up to ask a question,',
      "05:14  they're raising their hands in the room,",
      '05:26  The answer is in chapter two.',
    ]);
  });
});
