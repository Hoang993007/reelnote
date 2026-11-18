/**
 * Blocks a source's Insights tab lists: the source's standalone blocks plus page blocks flagged as
 * insights on that source's pages. One definition for the tab and every insight count.
 * `source` is a SQL expression for the source id (`?` or a column such as `s.id`), never user input;
 * a `?` must be bound twice. Expects the block table aliased as `b`.
 */
export function sourceInsightBlocksWhere(source: string): string {
  return `((b.source_id = ${source} AND b.page_id IS NULL)
    OR (b.is_insight = 1 AND b.page_id IN (SELECT ip.id FROM pages ip WHERE ip.source_id = ${source})))`;
}
