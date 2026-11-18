import { firstParagraph } from '../lib/markdown';
import { fmtTime } from '../lib/format';
import { Link, paths } from '../lib/router';
import type { QuestionItem } from '../lib/types';
import { Icon } from '../shell/icons';

/** One open question: its text in the reading face, then where it is; opens the page at the block. */
export function QuestionRow({ q, withSource }: { q: QuestionItem; withSource?: boolean }) {
  const answered = q.questionState === 'answered';
  return <Link to={paths.page(q.pageId, { block: q.blockId })} className="row">
    <span className={`q-dot${answered ? ' is-done' : ''}`}><Icon name="question" /></span>
    <span className="row-main">
      <span className="row-t row-read">{firstParagraph(q.body) || 'Untitled question'}</span>
      <span className="row-m">
        {withSource ? `${q.sourceName} · ` : ''}{q.pageTitle}
        {q.videoTimeSec != null ? <> · <span className="mono">{fmtTime(q.videoTimeSec)}</span></> : null}
        {withSource ? null : ` · ${answered ? 'Answered' : 'Open'}`}
      </span>
    </span>
  </Link>;
}
