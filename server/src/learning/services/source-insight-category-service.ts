import { eq, asc } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { sourceInsightCategories } from '../../db/schema.js';
import { withUniqueConflict } from '../../lib/errors.js';
import type { SourceInsightCategory } from '../../db/schema.js';

export const sourceInsightCategoryService = {
  list(sourceId: number): SourceInsightCategory[] {
    return db.select()
      .from(sourceInsightCategories)
      .where(eq(sourceInsightCategories.sourceId, sourceId))
      .orderBy(asc(sourceInsightCategories.position), asc(sourceInsightCategories.createdAt))
      .all();
  },

  create(sourceId: number, data: { label: string; position?: number }): SourceInsightCategory {
    return withUniqueConflict(
      () => db.insert(sourceInsightCategories)
        .values({ sourceId, label: data.label.trim(), position: data.position ?? 0 })
        .returning()
        .get(),
      'Label already exists for this source',
    );
  },

};
