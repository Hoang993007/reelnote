import { describe, expect, it } from 'vitest';
import { resolutionLabel } from './player-controls';

describe('resolutionLabel', () => {
  it('names the resolution by the short side, so a portrait reel reads like its landscape twin', () => {
    expect(resolutionLabel({ width: 1920, height: 1080 })).toBe('1080p');
    expect(resolutionLabel({ width: 1080, height: 1920 })).toBe('1080p');
    expect(resolutionLabel({ width: 1280, height: 720 })).toBe('720p');
  });
});
