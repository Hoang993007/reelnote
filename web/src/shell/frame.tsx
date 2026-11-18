import { useRef } from 'react';
import { applyTheme, overlay, theme, type Theme } from '../lib/shell-state';
import { pageUi } from '../lib/page-ui';
import { useSession } from '../lib/session';
import { useStore } from '../lib/store';
import { Link, navigate, paths, type Route } from '../lib/router';
import { usePage, useSources } from '../lib/data';
import { openSourceDialog } from '../source/source-dialog-state';
import { Icon } from './icons';
import { SourceAvatar } from './marks';
import { openMenu } from './menu';
import { initials } from '../lib/format';
import { changePasswordOpen } from '../auth/change-password';
import { lookupKeysOpen } from '../auth/lookup-keys';

export function openThemeMenu(anchor: Element): void {
  const current = theme.get();
  const choices: Array<[Theme, string]> = [['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']];
  openMenu(anchor, choices.map(([value, label]) => ({ label, check: current === value, run: () => applyTheme(value) })), { alignRight: true, title: 'Theme' });
}

/** Top bar (48 px): wordmark, breadcrumb, search, page controls on a page, keys, theme, account. */
export function TopBar({ route }: { route: Route }) {
  const { me, isOwner, signOut } = useSession();
  const { pagesOpen, focus } = useStore(pageUi);
  const sources = useSources().data;
  const pageId = route.name === 'page' ? route.id : null;
  const page = usePage(pageId).data;
  const sourceId = route.name === 'source' ? route.id : page?.sourceId ?? null;
  const source = sources?.find((s) => s.id === sourceId);
  const themeBtn = useRef<HTMLButtonElement>(null);

  const accountMenu = (anchor: Element) => openMenu(anchor, [
    ...(isOwner ? [{ label: 'People and access', icon: 'users' as const, run: () => navigate(paths.people()) }] : []),
    { label: 'Theme', icon: 'moon' as const, run: () => themeBtn.current && openThemeMenu(themeBtn.current) },
    { label: 'Keyboard shortcuts', icon: 'keyboard' as const, hint: '?', run: () => overlay.set({ kind: 'keys' }) },
    { label: 'Change my password', icon: 'lock' as const, run: () => changePasswordOpen.set(true) },
    { label: 'Word lookup key', icon: 'search' as const, run: () => lookupKeysOpen.set(true) },
    { label: 'Sign out', icon: 'signout' as const, run: () => void signOut() },
  ], { alignRight: true, title: `${me.displayName} · ${isOwner ? 'Owner' : 'Friend'}` });

  return <header className="topbar">
    <Link to={paths.home()} className="brand">Reelnote</Link>
    <nav className="tb-crumb" aria-label="You are here">
      {source ? <><span className="tb-sep">/</span><Link to={paths.source(source.id)}>{source.name}</Link></> : null}
      {route.name === 'page' && page ? <><span className="tb-sep">/</span><span className="tb-cur">{page.title}</span></> : null}
      {route.name === 'people' ? <><span className="tb-sep">/</span><span className="tb-cur">People and access</span></> : null}
    </nav>
    <button type="button" className="search-btn" aria-label="Search (Ctrl K)"
      onClick={() => overlay.set({ kind: 'search', mode: 'all', scope: null, query: '' })}>
      <Icon name="search" /><span>Search notes, pages, sources</span><kbd>Ctrl K</kbd>
    </button>
    <div className="tb-right">
      {route.name === 'page' ? <>
        <button type="button" className="ibtn" aria-label="Page list (Ctrl \)" title="Page list (Ctrl \)" aria-pressed={pagesOpen}
          onClick={() => pageUi.set((s) => ({ ...s, pagesOpen: !s.pagesOpen }))}><Icon name="sidebar" /></button>
        <button type="button" className="ibtn tb-focus" aria-label="Focus writing (\)" title="Focus writing (\)" aria-pressed={focus}
          onClick={() => pageUi.set((s) => ({ ...s, focus: !s.focus }))}><Icon name="focus" /></button>
      </> : null}
      <button type="button" className="ibtn" aria-label="Keyboard shortcuts (?)" title="Keyboard shortcuts (?)" onClick={() => overlay.set({ kind: 'keys' })}><Icon name="keyboard" /></button>
      <button type="button" ref={themeBtn} className="ibtn" aria-label="Theme" title="Theme" onClick={(e) => openThemeMenu(e.currentTarget)}><Icon name="moon" /></button>
      <button type="button" className="me" aria-label={`Account: ${me.displayName}`} onClick={(e) => accountMenu(e.currentTarget)}>{initials(me.displayName)}</button>
    </div>
  </header>;
}

/** Rail (56 px): Home, the first nine sources (Alt 1–9), All sources, then Add source and People for the owner. */
export function Rail({ route, activeSourceId }: { route: Route; activeSourceId: number | null }) {
  const { isOwner } = useSession();
  const sources = useSources().data ?? [];
  return <nav className="rail" aria-label="Sources">
    <Link to={paths.home()} className={`rail-btn${route.name === 'home' ? ' is-on' : ''}`} title="Home (G H)" aria-label="Home"
      aria-current={route.name === 'home' ? 'page' : undefined}><Icon name="home" /></Link>
    <span className="rail-sep" />
    {sources.slice(0, 9).map((source, i) => <Link key={source.id} to={paths.source(source.id)}
      className={`rail-src${activeSourceId === source.id ? ' is-on' : ''}`} title={`${source.name} · Alt ${i + 1}`} aria-label={source.name}>
      <SourceAvatar source={source} size="md" /></Link>)}
    {sources.length > 9 ? <button type="button" className="rail-btn" title={`All ${sources.length} sources (G S)`} aria-label="All sources"
      onClick={() => overlay.set({ kind: 'search', mode: 'sources', scope: null, query: '' })}><Icon name="grid" /></button> : null}
    <span className="fill" />
    {isOwner ? <>
      <button type="button" className="rail-btn" title="Add a source" aria-label="Add a source" onClick={() => openSourceDialog(null)}><Icon name="plus" /></button>
      <Link to={paths.people()} className={`rail-btn${route.name === 'people' ? ' is-on' : ''}`} title="People and access" aria-label="People and access"><Icon name="users" /></Link>
    </> : null}
  </nav>;
}
