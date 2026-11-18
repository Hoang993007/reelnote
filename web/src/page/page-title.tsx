import { useEffect, useRef, useState } from 'react';
import { keys } from '../lib/data';
import { invalidate, mutate } from '../lib/resource';
import { failureText, save } from '../lib/saves';
import { useSession } from '../lib/session';
import { toast } from '../lib/shell-state';
import type { Page } from '../lib/types';
import { useNotebook } from './notebook-context';

/** The page title, edited in place by those who may change the source (Enter or Esc ends; empty goes back). */
export function PageTitle({ page }: { page: Page }) {
  const { ownerName } = useSession();
  const { canWrite } = useNotebook();
  const [title, setTitle] = useState(page.title);
  const cancelled = useRef(false);
  useEffect(() => setTitle(page.title), [page.title]);
  if (!canWrite) return <h1 className="ptitle">{page.title}</h1>;
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      setTitle(page.title);
      return;
    }
    const next = title.trim();
    if (!next) { setTitle(page.title); return; }
    if (next === page.title) return;
    mutate<Page>(keys.page(page.id), (p) => ({ ...p, title: next }));
    mutate<Page[]>(keys.pages(page.sourceId), (list) => list.map((p) => (p.id === page.id ? { ...p, title: next } : p)));
    save('PUT', `/pages/${page.id}`, { title: next }, `title:${page.id}`).catch((error: unknown) => {
      toast(failureText(error, ownerName));
      invalidate(keys.page(page.id), keys.pages(page.sourceId));
    });
  };
  return <h1 className="ptitle-wrap">
    <textarea className="ptitle ptitle-in" rows={1} value={title} aria-label="Page title" spellCheck={false} id="page-title"
      ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
      onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Escape') cancelled.current = true;
          e.currentTarget.blur();
        }
      }} />
  </h1>;
}
