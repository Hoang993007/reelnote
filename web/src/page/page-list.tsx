import { useEffect, useRef, useState } from 'react';
import { fold } from '../lib/fold';
import { setPagesOpen } from '../lib/page-ui';
import { pad2 } from '../lib/format';
import { Link, paths } from '../lib/router';
import type { Page, Source } from '../lib/types';
import { Icon } from '../shell/icons';
import { ProgressMark, SourceAvatar } from '../shell/marks';

/** The page list (248 px; an overlay drawer below 1180 px): source header, filter, numbered pages, Insights and Questions. */
export function PageList({ source, pages, currentId, onPick }: { source: Source; pages: Page[]; currentId: number; onPick: () => void }) {
  const [filter, setFilter] = useState('');
  const list = useRef<HTMLOListElement>(null);
  const q = fold(filter.trim());
  useEffect(() => {
    list.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
  }, [currentId]);
  return <>
    <div className="pl-head">
      <div className="pl-top">
        <Link to={paths.source(source.id)} className="pl-src"><SourceAvatar source={source} size="sm" />
          <span><strong>{source.name}</strong>{source.author ? <span className="muted">{source.author}</span> : null}</span></Link>
        <button type="button" className="ibtn pl-hide" aria-label="Hide the page list (Ctrl \)" title="Hide the page list (Ctrl \)"
          onClick={() => setPagesOpen(false)}><Icon name="chevl" /></button>
      </div>
      <label className="filter-in"><Icon name="search" /><input placeholder="Filter pages" aria-label="Filter pages" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
    </div>
    <ol className="pl-list" ref={list}>
      {pages.map((p, i) => (q && !fold(p.title).includes(q) ? null : <li key={p.id}>
        <Link to={paths.page(p.id)} className={`pl-row${p.id === currentId ? ' is-on' : ''}`} aria-current={p.id === currentId ? 'page' : undefined} onClick={onPick}>
          <span className="pl-n mono">{pad2(i + 1)}</span><span className="pl-t">{p.title}</span>{p.videoCount ? <ProgressMark state={p.watchState} /> : null}
        </Link></li>))}
    </ol>
    <div className="pl-foot">
      <Link to={paths.source(source.id, 'insights')} className="pl-link"><Icon name="star" />Insights <span>{source.insightCount}</span></Link>
      <Link to={paths.source(source.id, 'questions')} className="pl-link"><Icon name="question" />Open questions <span>{source.openQuestionCount}</span></Link>
    </div>
  </>;
}
