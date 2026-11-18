import { describe, expect, it } from 'vitest';
import { fold, splitMatch } from './fold';
import { fmtTime, fmtDuration } from './format';

describe('fold', () => {
  it('ignores case, accents and đ', () => {
    expect(fold('Hấp Thụ')).toBe('hap thu');
    expect(fold('Đồng hồ')).toBe('dong ho');
  });

  it('finds an accent-free query in accented text and keeps the accents', () => {
    expect(splitMatch('Lực hấp thụ ở đỉnh', 'hap thu')).toEqual({ before: 'Lực ', match: 'hấp thụ', after: ' ở đỉnh' });
    expect(splitMatch('Đỉnh phiên', '#dinh')).toEqual({ before: '', match: 'Đỉnh', after: ' phiên' });
    expect(splitMatch('abc', 'x')).toBeNull();
  });
});

describe('format', () => {
  it('writes times and lengths', () => {
    expect(fmtTime(1114)).toBe('18:34');
    expect(fmtTime(3725)).toBe('1:02:05');
    expect(fmtTime(Number.NaN)).toBe('00:00');
    expect(fmtDuration(2538)).toBe('42 min');
    expect(fmtDuration(3900)).toBe('1 h 5 min');
  });
});
