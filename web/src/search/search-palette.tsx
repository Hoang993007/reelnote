import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { useRecent, useSources } from '../lib/data';
import { fold, splitMatch } from '../lib/fold';
import { fmtTime } from '../lib/format';
import { navigate, paths } from '../lib/router';
import { useSession } from '../lib/session';
import { applyTheme, overlay, type Overlay } from '../lib/shell-state';
import type { BlockHit, ContinuePage, SearchResult, Source } from '../lib/types';
import { Icon } from '../shell/icons';
import { ProgressMark, SourceAvatar } from '../shell/marks';
import { KIND_LABEL } from '../source/source-dialog';
import { openSourceDialog } from '../source/source-dialog-state';

type Item = { key: string; content: ReactNode; hint?: string; run: () => void | 'keep' };
type Group = { title: string; items: Item[]; total: number };

/** The match in <mark>, accent-insensitively ("hap thu" marks "hấp thụ"). */
function Highlight({ text, query }: { text: string; query: string }) {
  const parts = splitMatch(text, query);
  if (!parts) return <>{text}</>;
  return <>{parts.before}<mark>{parts.match}</mark>{parts.after}</>;
}

const NOTE_LIMIT = 8;
const NO_SOURCES: Source[] = [];
const NO_RECENT: ContinuePage[] = [];
const GROUP_LIMIT = 6;

/**
 * Search (design-spec §5.5): Ctrl K for all sources, / for this source (Tab toggles); empty query lists recent
 * pages and commands; a query lists Sources · Pages · Notes · Private annotations · Tags · Commands. G S opens it
 * as "Switch to a source". ↑ ↓ Enter Esc; focus goes back where it was.
 */
export function SearchPalette({ open, activeSourceId }: { open: NonNullable<Extract<Overlay, { kind: 'search' }>>; activeSourceId: number | null }) {
  const { isOwner } = useSession();
  const sources = useSources().data ?? NO_SOURCES;
  const recent = useRecent().data ?? NO_RECENT;
  const [query, setQuery] = useState(open.query);
  const [scope, setScope] = useState<number | null>(open.scope);
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<{ q: string; scope: number | null; data: SearchResult } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const restore = useRef<Element | null>(document.activeElement);
  const scopeSource = sources.find((s) => s.id === scope);
  const contextSource = sources.find((s) => s.id === (scope ?? activeSourceId)) ?? null;

  const close = () => {
    overlay.set(null);
    const el = restore.current;
    if (el instanceof HTMLElement && document.contains(el)) setTimeout(() => el.focus({ preventScroll: true }), 0);
  };

  const q = query.trim();
  useEffect(() => {
    if (open.mode === 'sources' || q.replace(/^#/, '').length < 1 || q.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q, limit: '24' });
      if (scope) params.set('sourceId', String(scope));
      api<SearchResult>(`/learning/search?${params}`, { signal: controller.signal }).then((data) => setResult({ q, scope, data }), () => undefined);
    }, 120);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [q, scope, open.mode]);

  const commands: Item[] = useMemo(() => {
    const list: Array<{ label: string; hint?: string; run: () => void }> = [{ label: 'Go to Home', hint: 'G H', run: () => navigate(paths.home()) }];
    if (contextSource) {
      list.push({ label: `Insights in ${contextSource.name}`, hint: 'G I', run: () => navigate(paths.source(contextSource.id, 'insights')) });
      list.push({ label: `Pages in ${contextSource.name}`, hint: 'G P', run: () => navigate(paths.source(contextSource.id, 'pages')) });
    }
    if (isOwner) {
      list.push({ label: 'Add a source', run: () => openSourceDialog(null) });
      list.push({ label: 'People and access', run: () => navigate(paths.people()) });
    }
    list.push({ label: 'Theme: light', run: () => applyTheme('light') }, { label: 'Theme: dark', run: () => applyTheme('dark') },
      { label: 'Theme: match system', run: () => applyTheme('system') }, { label: 'Keyboard shortcuts', hint: '?', run: () => overlay.set({ kind: 'keys' }) });
    return list.map((c) => ({ key: `cmd:${c.label}`, content: <span className="pal-t">{c.label}</span>, hint: c.hint, run: c.run }));
  }, [contextSource, isOwner]);

  const groups: Group[] = useMemo(() => {
    if (open.mode === 'sources') {
      const f = fold(q);
      const items = sources.map((s, i) => ({ s, i })).filter(({ s }) => !f || fold(`${s.name} ${s.author ?? ''}`).includes(f)).map(({ s, i }) => ({
        key: `s:${s.id}`, hint: i < 9 ? `Alt ${i + 1}` : undefined, run: () => navigate(paths.source(s.id)),
        content: <><SourceAvatar source={s} size="xs" /><span className="pal-t"><Highlight text={s.name} query={q} /></span>
          <span className="pal-m">{[s.kind ? KIND_LABEL[s.kind] : null, s.author].filter(Boolean).join(' · ')}</span></>,
      }));
      return [{ title: 'Sources', items, total: items.length }];
    }
    if (q.length < 2) {
      const pages = recent.filter((p) => !scope || p.sourceId === scope).map((p) => ({
        key: `p:${p.pageId}`, run: () => navigate(paths.page(p.pageId)),
        content: <><SourceAvatar source={{ name: p.sourceName, color: p.sourceColor }} size="xs" /><span className="pal-t">{p.pageTitle}</span>
          <span className="pal-m">{p.sourceName} · <ProgressMark state={p.watchState} /></span></>,
      }));
      return [{ title: 'Recent pages', items: pages, total: pages.length }, { title: 'Commands', items: commands, total: commands.length }];
    }
    if (!result || result.q !== q || result.scope !== scope) return [];
    const d = result.data;
    const noteItem = (hit: BlockHit, annotation: boolean): Item => ({
      key: `${annotation ? 'a' : 'n'}:${hit.blockId}`,
      run: () => navigate(hit.pageId ? paths.page(hit.pageId, { block: hit.blockId }) : paths.source(hit.sourceId, 'insights')),
      content: <><span className="pal-ic"><Icon name={annotation ? 'lock' : hit.kind === 'question' ? 'question' : 'note'} /></span>
        <span className="pal-t pal-read" lang="vi"><Highlight text={hit.snippet} query={q} /></span>
        <span className="pal-m">{hit.sourceName}{hit.pageTitle ? ` · ${hit.pageTitle}` : ' · Insight'}{hit.videoTimeSec != null ? <> · <span className="mono">{fmtTime(hit.videoTimeSec)}</span></> : null}</span></>,
    });
    const cmd = commands.filter((c) => fold(c.key.slice(4)).includes(fold(q)));
    return [
      { title: 'Sources', total: d.sources.total, items: d.sources.items.slice(0, GROUP_LIMIT).map((s) => ({ key: `s:${s.sourceId}`, run: () => navigate(paths.source(s.sourceId)),
        content: <><SourceAvatar source={{ name: s.name, color: s.color }} size="xs" /><span className="pal-t"><Highlight text={s.name} query={q} /></span>
          <span className="pal-m">{[s.kind ? KIND_LABEL[s.kind] : null, s.author].filter(Boolean).join(' · ')}</span></> })) },
      { title: 'Pages', total: d.pages.total, items: d.pages.items.slice(0, GROUP_LIMIT).map((p) => ({ key: `p:${p.pageId}`, run: () => navigate(paths.page(p.pageId)),
        content: <><SourceAvatar source={{ name: p.sourceName, color: p.sourceColor }} size="xs" /><span className="pal-t"><Highlight text={p.pageTitle} query={q} /></span>
          <span className="pal-m">{p.sourceName}</span></> })) },
      { title: 'Notes', total: d.notes.total, items: d.notes.items.slice(0, NOTE_LIMIT).map((hit) => noteItem(hit, false)) },
      { title: 'Private annotations', total: d.annotations.total, items: d.annotations.items.slice(0, GROUP_LIMIT).map((hit) => noteItem(hit, true)) },
      { title: 'Tags', total: d.tags.total, items: d.tags.items.slice(0, GROUP_LIMIT).map((t) => ({ key: `t:${t.tag}`,
        run: () => { setQuery(`#${t.tag}`); setIndex(0); return 'keep' as const; },
        content: <><span className="pal-t">#<Highlight text={t.tag} query={q} /></span><span className="pal-m">{t.count} block{t.count === 1 ? '' : 's'}</span></> })) },
      { title: 'Commands', total: cmd.length, items: cmd },
    ];
  }, [open.mode, q, sources, recent, scope, result, commands]);

  const shown = groups.filter((g) => g.items.length);
  const flat = shown.flatMap((g) => g.items);
  const active = Math.min(index, Math.max(0, flat.length - 1));
  const loading = open.mode !== 'sources' && q.length >= 2 && (!result || result.q !== q || result.scope !== scope);

  useEffect(() => {
    document.querySelector('.pal-it.is-hi')?.scrollIntoView({ block: 'nearest' });
  }, [active, shown.length]);

  const run = (item: Item | undefined) => {
    if (!item) return;
    if (item.run() === 'keep') return;
    overlay.set(null);
  };

  const onKey = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (flat.length) setIndex((active + (event.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length);
      return;
    }
    if (event.key === 'Enter') { event.preventDefault(); run(flat[active]); return; }
    if (event.key === 'Tab' && open.mode !== 'sources') {
      event.preventDefault();
      setScope((s) => (s ? null : activeSourceId));
      setIndex(0);
    }
  };

  let counter = -1;
  return createPortal(<div className="modal-back modal-top" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div className="palette" role="dialog" aria-modal="true" aria-label="Search" onKeyDown={onKey}>
      <div className="pal-in">
        <Icon name="search" />
        <input ref={input} autoFocus value={query} autoComplete="off" spellCheck={false} role="combobox" aria-expanded="true" aria-controls="pal-res"
          aria-activedescendant={flat.length ? `pal-${active}` : undefined}
          placeholder={open.mode === 'sources' ? 'Switch to a source…' : 'Search notes, pages, sources, #tags…'}
          onChange={(e) => { setQuery(e.target.value); setIndex(0); }} />
        {open.mode === 'sources' ? null : <button type="button" className={`scope${scope ? ' is-on' : ''}`} title="Tab switches scope"
          onClick={() => { setScope((s) => (s ? null : activeSourceId)); input.current?.focus(); }} disabled={!scope && !activeSourceId}>
          {scopeSource ? `In ${scopeSource.name}` : 'All sources'}</button>}
      </div>
      <div className="pal-res" id="pal-res" role="listbox" aria-label="Results" aria-busy={loading}>
        {shown.length ? shown.map((g) => <div key={g.title} className="pal-g" role="group" aria-label={g.title}>
          <div className="pal-gh">{g.title}{g.total > g.items.length ? <span> {g.items.length} of {g.total}</span> : null}</div>
          {g.items.map((item) => {
            counter += 1;
            const i = counter;
            return <div key={item.key} id={`pal-${i}`} className={`pal-it${i === active ? ' is-hi' : ''}`} role="option" aria-selected={i === active}
              onMouseMove={() => setIndex(i)} onClick={() => run(item)}>{item.content}{item.hint ? <kbd>{item.hint}</kbd> : null}</div>;
          })}
        </div>) : loading ? <div className="pal-empty muted">Searching…</div>
          : <div className="pal-empty">Nothing found for “{q}”{scopeSource ? <> in {scopeSource.name}. <button type="button" className="linkbtn" onClick={() => setScope(null)}>Search all sources</button></> : '.'}</div>}
      </div>
      <div className="pal-foot"><span><kbd>↑ ↓</kbd> move</span><span><kbd>Enter</kbd> open</span>{open.mode === 'sources' ? null : <span><kbd>Tab</kbd> scope</span>}
        <span><kbd>Esc</kbd> close</span><span className="fill" /><span>Accents optional: “hap thu” finds “hấp thụ”</span></div>
    </div>
  </div>, document.body);
}
