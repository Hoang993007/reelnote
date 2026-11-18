import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { fold } from '../lib/fold';
import { createStore, useStore } from '../lib/store';
import { Icon, type IconName } from './icons';

/**
 * Pop-over menus (design-spec §6.4): optional filter field and title, items with an icon or a check, a key
 * hint, a danger style, and an optional "Create “…”" row. ↑ ↓ Enter Esc; a click outside closes it; focus
 * goes back to where it was.
 */
export type MenuItem = { label: string; icon?: IconName; check?: boolean; hint?: string; danger?: boolean; run: () => void };
export type MenuOptions = {
  title?: string;
  placeholder?: string;
  alignRight?: boolean;
  /** A row that creates what was typed when nothing matches it exactly. */
  create?: { label: string; run: (text: string) => void };
};
type OpenMenu = { anchor: DOMRect; items: MenuItem[]; options: MenuOptions; restore: Element | null };

export const menuState = createStore<OpenMenu | null>(null);

export function openMenu(anchor: Element, items: MenuItem[], options: MenuOptions = {}): void {
  menuState.set({ anchor: anchor.getBoundingClientRect(), items, options, restore: document.activeElement });
}

export function closeMenu(restoreFocus = true): void {
  const open = menuState.get();
  menuState.set(null);
  if (restoreFocus && open?.restore instanceof HTMLElement && document.contains(open.restore)) open.restore.focus({ preventScroll: true });
}

export function MenuHost() {
  const open = useStore(menuState);
  return open ? <Menu key={`${open.anchor.x}:${open.anchor.y}:${open.items.length}`} open={open} /> : null;
}

function Menu({ open }: { open: OpenMenu }) {
  const { items, options } = open;
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const q = fold(query.trim().replace(/^#/, ''));
    const shown = items.filter((item) => !q || fold(item.label).includes(q));
    const text = query.trim();
    if (options.create && text && !items.some((item) => fold(item.label.replace(/^#/, '')) === q)) {
      shown.push({ label: `${options.create.label}: “${text.replace(/^#/, '')}”`, icon: 'plus', run: () => options.create!.run(text.replace(/^#/, '')) });
    }
    return shown;
  }, [items, options.create, query]);
  const active = Math.max(0, Math.min(index, list.length - 1));

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const { anchor } = open;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, options.alignRight ? anchor.right - w : anchor.left));
    const top = anchor.bottom + h + 8 > window.innerHeight ? Math.max(8, anchor.top - h - 4) : anchor.bottom + 4;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    (input.current ?? el).focus({ preventScroll: true });
  }, [open, options.alignRight]);

  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) closeMenu(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, []);

  const choose = (item: MenuItem | undefined) => {
    if (!item) return;
    closeMenu(true);
    item.run();
  };

  const onKey = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setIndex((active + step + list.length) % Math.max(1, list.length));
      return;
    }
    if (event.key === 'Enter') { event.preventDefault(); choose(list[active]); return; }
    if (event.key === 'Tab') { event.preventDefault(); closeMenu(true); }
  };

  return <div className="menu" role="menu" tabIndex={-1} ref={box} onKeyDown={onKey} aria-label={options.title ?? options.placeholder ?? 'Menu'}>
    {options.placeholder ? <input ref={input} className="menu-in" placeholder={options.placeholder} aria-label={options.placeholder}
      value={query} onChange={(e) => { setQuery(e.target.value); setIndex(0); }} /> : null}
    {options.title ? <div className="menu-title">{options.title}</div> : null}
    <div className="menu-items">
      {list.length ? list.map((item, i) => <button key={`${item.label}-${i}`} type="button" role="menuitem"
        className={`menu-it${i === active ? ' is-hi' : ''}${item.danger ? ' is-danger' : ''}`}
        onMouseEnter={() => setIndex(i)} onClick={() => choose(item)}>
        <span className="menu-ic">{item.check ? '✓' : item.icon ? <Icon name={item.icon} /> : null}</span>
        <span className="menu-l">{item.label}</span>
        {item.hint ? <kbd>{item.hint}</kbd> : null}
      </button>) : <div className="menu-empty">Nothing matches</div>}
    </div>
  </div>;
}
