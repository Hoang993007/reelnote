/**
 * How far a viewer got through a page's videos, as the progress marks show it: 'full' when every video is
 * watched (furthest point at 90% of the duration, see page-video-progress-service.ts), 'half' when any is
 * started (past 5 s), else 'none' (a page without videos too).
 */
export type WatchState = 'full' | 'half' | 'none';

/** Started means past this second: opening a video is not watching it. */
export const STARTED_AFTER_SEC = 5;

/**
 * SQL: the watch state of the page aliased `page` for the viewer whose id is bound to `param` (a named
 * parameter such as `@viewerId`, or `?`). Never user input in either argument.
 */
export function pageWatchStateSql(page: string, param: string): string {
  return `(SELECT CASE
      WHEN COUNT(wv.id) = 0 THEN 'none'
      WHEN SUM(COALESCE(wp.completed, 0)) = COUNT(wv.id) THEN 'full'
      WHEN SUM(CASE WHEN wp.completed = 1 OR wp.furthest_sec > ${STARTED_AFTER_SEC} THEN 1 ELSE 0 END) > 0 THEN 'half'
      ELSE 'none' END
    FROM page_videos wv LEFT JOIN video_progress wp ON wp.page_video_id = wv.id AND wp.user_id = ${param}
    WHERE wv.page_id = ${page}.id)`;
}
