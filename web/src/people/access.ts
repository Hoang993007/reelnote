/** What a friend can open (`read`) and change (`write`); write implies read. */
export type Access = { read: number[]; write: number[] };

/** The access after one tick: opening is needed to edit, so unticking Open also drops Edit and ticking Edit adds Open. */
export function toggleAccess(access: Access, sourceId: number, column: 'read' | 'write', on: boolean): Access {
  const without = (ids: number[]) => ids.filter((id) => id !== sourceId);
  const withId = (ids: number[]) => (ids.includes(sourceId) ? ids : [...ids, sourceId]);
  if (column === 'read') return on ? { ...access, read: withId(access.read) } : { read: without(access.read), write: without(access.write) };
  return on ? { read: withId(access.read), write: withId(access.write) } : { ...access, write: without(access.write) };
}
