import { describe, expect, it } from 'vitest';
import { toggleAccess } from './access';

describe('toggleAccess', () => {
  const start = { read: [1, 2], write: [2] };

  it('adds Open alone, and adds Open with Edit', () => {
    expect(toggleAccess(start, 3, 'read', true)).toEqual({ read: [1, 2, 3], write: [2] });
    expect(toggleAccess(start, 3, 'write', true)).toEqual({ read: [1, 2, 3], write: [2, 3] });
  });

  it('drops Edit with Open, and Edit alone', () => {
    expect(toggleAccess(start, 2, 'read', false)).toEqual({ read: [1], write: [] });
    expect(toggleAccess(start, 2, 'write', false)).toEqual({ read: [1, 2], write: [] });
  });

  it('does not repeat an id already ticked', () => {
    expect(toggleAccess(start, 2, 'write', true)).toEqual(start);
  });
});
