import { describe, expect, it } from 'vitest';
import { compareVideoFiles, parseVideoFileName } from '../video-file-name-parser.js';

describe('parseVideoFileName', () => {
  it.each([
    [
      '01 - Introduction to the course in Italian ｜ Jane Doe ｜ Weekly Webinar [kivylKx71Lk] [EN dub].mp4',
      { order: 1, date: null, title: 'Introduction to the course in Italian ｜ Jane Doe ｜ Weekly Webinar' },
    ],
    [
      '2026-03-22 Mehrmals wöchentlich zeige ich die einfachsten Lern-Se... (DWL1y2ajcFf) [EN dub].mp4',
      { order: null, date: '2026-03-22', title: 'Mehrmals wöchentlich zeige ich die einfachsten Lern-Se...' },
    ],
    ['07-EN - Statistics basics.mp4', { order: 7, date: null, title: 'Statistics basics' }],
    ['13b - Edges in geometry (2a parte) [-NDba49lsNA] [EN dub].mp4', { order: 13, date: null, title: 'Edges in geometry (2a parte)' }],
    ['1. Lezione 1.mp4', { order: 1, date: null, title: 'Lezione 1' }],
    ['2.5 Gamma.mp4', { order: null, date: null, title: '2.5 Gamma' }],
    [
      '[example.com] Jane Doe - Blood,Sweat & Study Q1.mp4',
      { order: null, date: null, title: '[example.com] Jane Doe - Blood,Sweat & Study Q1' },
    ],
    ['lesson.mp4', { order: null, date: null, title: 'lesson' }],
    ['LESSON.MP4', { order: null, date: null, title: 'LESSON' }],
    ['2026-02-30 Not a date.mp4', { order: null, date: null, title: '2026-02-30 Not a date' }],
    ['03 - .mp4', { order: 3, date: null, title: '03 -' }],
  ])('reads %j', (name, expected) => {
    expect(parseVideoFileName(name)).toEqual(expected);
  });
});

describe('compareVideoFiles', () => {
  it('sorts mixed names in natural, case-insensitive order', () => {
    const names = ['10 - Ten.mp4', '2 - Two.mp4', 'b.mp4', '01 - One.mp4', 'A.mp4', '2026-03-22 Dated.mp4'];
    expect([...names].sort(compareVideoFiles)).toEqual([
      '01 - One.mp4', '2 - Two.mp4', '10 - Ten.mp4', '2026-03-22 Dated.mp4', 'A.mp4', 'b.mp4',
    ]);
  });

  it('orders names that differ only in case deterministically', () => {
    expect(compareVideoFiles('a.mp4', 'A.mp4')).not.toBe(0);
    expect(Math.sign(compareVideoFiles('a.mp4', 'A.mp4'))).toBe(-Math.sign(compareVideoFiles('A.mp4', 'a.mp4')));
  });
});
