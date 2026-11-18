import { useMemo, useRef, useState, type FormEvent } from 'react';
import { formData } from '../lib/api';
import { keys, splitTags, useCategories } from '../lib/data';
import { fold } from '../lib/fold';
import { fmtTime, fmtWhen, pad2 } from '../lib/format';
import { plainText } from '../lib/markdown';
import { invalidate } from '../lib/resource';
import { Link, paths } from '../lib/router';
import { failureText, send } from '../lib/saves';
import { useSession } from '../lib/session';
import { overlay, toast } from '../lib/shell-state';
import type { Block, InsightCategory, Insights, Page, Source } from '../lib/types';
import { Icon } from '../shell/icons';

type Origin = 'all' | 'pages' | 'standalone';
const NONE = 'No category';
const NO_CATEGORIES: InsightCategory[] = [];

/** Insights (design-spec §5.3): categories with counts, a filter, origin segments, New insight, groups per category. */
export function InsightsTab({ source, insights, pages }: { source: Source; insights: Insights | undefined; pages: Page[] }) {
  const { ownerName, me } = useSession();
  const myId = me.id;
  const categories = useCategories(source.id).data ?? NO_CATEGORIES;
  const [category, setCategory] = useState('all');
  const [origin, setOrigin] = useState<Origin>('all');
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);

  const all = useMemo(() => [...(insights?.pageBlocks ?? []), ...(insights?.standaloneBlocks ?? [])], [insights]);
  const labels = useMemo(() => {
    const list = categories.map((c) => c.label);
    for (const b of all) if (b.insightCategory && !list.includes(b.insightCategory)) list.push(b.insightCategory);
    if (all.some((b) => !b.insightCategory)) list.push(NONE);
    return list;
  }, [categories, all]);
  const catOf = (b: Block) => b.insightCategory ?? NONE;
  const q = fold(query.trim());
  const shown = all.filter((b) => (category === 'all' || catOf(b) === category)
    && (origin === 'all' || (origin === 'pages' ? b.pageId !== null : b.pageId === null))
    && (!q || fold(`${plainText(b.body)} ${b.tags ?? ''}`).includes(q)));
  const groups = labels.map((label) => [label, shown.filter((b) => catOf(b) === label)] as const).filter(([, items]) => items.length);
  const pageIndex = new Map(pages.map((p, i) => [p.id, i]));

  if (!insights) return null;
  return <div className="ins">
    <nav className="ins-cats" aria-label="Categories">
      <button type="button" className={`catbtn${category === 'all' ? ' is-on' : ''}`} aria-pressed={category === 'all'} onClick={() => setCategory('all')}>All <span>{all.length}</span></button>
      {labels.map((label) => <button key={label} type="button" className={`catbtn${category === label ? ' is-on' : ''}`} aria-pressed={category === label}
        onClick={() => setCategory(label)}>{label} <span>{all.filter((b) => catOf(b) === label).length}</span></button>)}
    </nav>
    <div className="ins-main">
      <div className="ins-bar">
        <label className="filter-in"><Icon name="search" /><input value={query} placeholder="Filter insights" aria-label="Filter insights" onChange={(e) => setQuery(e.target.value)} /></label>
        <div className="seg" role="group" aria-label="Where insights come from">
          {([['all', 'All'], ['pages', 'From pages'], ['standalone', 'Standalone']] as Array<[Origin, string]>).map(([key, label]) =>
            <button key={key} type="button" className={origin === key ? 'is-on' : ''} aria-pressed={origin === key} onClick={() => setOrigin(key)}>{label}</button>)}
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setComposing(true)}><Icon name="plus" /> New insight</button>
      </div>
      {composing ? <Composer source={source} labels={labels.filter((l) => l !== NONE)} initial={category !== 'all' && category !== NONE ? category : ''}
        onDone={() => setComposing(false)} ownerName={ownerName} /> : null}
      {groups.length ? groups.map(([label, items]) => <section key={label} className="ins-group">
        <h3 className="sec-h">{label} <span className="count">{items.length}</span></h3>
        {items.map((b) => <article key={b.id} className="insight">
          <p className="ins-text" lang="vi">{plainText(b.body) || (b.images.length ? 'Image' : '—')}</p>
          <div className="ins-meta">
            {b.authorId === myId ? <span className="who who-me">You</span> : <span className="who">{b.authorName ?? ownerName}</span>}
            {b.pageId ? <Link to={paths.page(b.pageId, { block: b.id })}>
              <span className="mono">{pad2((pageIndex.get(b.pageId) ?? 0) + 1)}</span> {b.pageTitle}{b.videoTimeSec != null ? <> · <span className="mono">{fmtTime(b.videoTimeSec)}</span></> : null}
            </Link> : <span>Standalone · {fmtWhen(b.createdAt)}</span>}
            {splitTags(b.tags).map((tag) => <button key={tag} type="button" className="chip" onClick={() => overlay.set({ kind: 'search', mode: 'all', scope: null, query: `#${tag}` })}>#{tag}</button>)}
          </div>
        </article>)}
      </section>) : <div className="empty"><h3>No insights match</h3><p>Mark any note as an insight with <kbd>I</kbd>, or write a standalone one here.</p></div>}
    </div>
  </div>;
}

function Composer({ source, labels, initial, onDone, ownerName }: { source: Source; labels: string[]; initial: string; onDone: () => void; ownerName: string }) {
  const [text, setText] = useState('');
  const [category, setCategory] = useState(initial || labels[0] || '');
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const add = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!text.trim()) { area.current?.focus(); return; }
    setBusy(true);
    try {
      await send(`/sources/${source.id}/blocks`, { method: 'POST', body: formData({ type: 'note', body: text.trim(), insightCategory: category || undefined }) });
      invalidate(keys.insights(source.id), keys.source(source.id), keys.sources);
      toast('Insight added');
      onDone();
    } catch (error) {
      toast(failureText(error, ownerName));
      setBusy(false);
    }
  };
  return <form className="composer" onSubmit={(e) => void add(e)}>
    <label className="sr" htmlFor="ins-text">Insight</label>
    <textarea id="ins-text" ref={area} rows={3} autoFocus placeholder="One idea, in your own words" value={text} lang="vi" onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void add(); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(); }
      }} />
    <div className="composer-row">
      <label htmlFor="ins-cat">Category</label>
      <select id="ins-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="">No category</option>
        {labels.map((label) => <option key={label} value={label}>{label}</option>)}
      </select>
      <span className="fill" />
      <button type="button" className="btn" onClick={onDone}>Cancel</button>
      <button type="submit" className="btn btn-primary" disabled={busy}>Add <kbd>Ctrl Enter</kbd></button>
    </div>
  </form>;
}
