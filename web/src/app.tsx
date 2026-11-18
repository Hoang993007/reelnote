import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, onUnauthenticated } from './lib/api';
import { SignIn } from './auth/sign-in';
import { clearCache } from './lib/resource';
import { currentUrl, navigate, parseRoute, paths, useLocation, type Route } from './lib/router';
import { SessionProvider, type Session } from './lib/session';
import { onBackOnline, startSaves, stopSaves } from './lib/saves';
import { overlay, toast } from './lib/shell-state';
import { useStore } from './lib/store';
import type { Me } from './lib/types';
import { usePage } from './lib/data';
import { TopBar, Rail } from './shell/frame';
import { StatusBar, Toasts, OfflineBanner } from './shell/status';
import { MenuHost } from './shell/menu';
import { KeyboardSheet } from './shell/keyboard-sheet';
import { useGlobalKeys } from './shell/global-keys';
import { SourceDialogHost } from './source/source-dialog';
import { DeletePageHost } from './source/delete-page-dialog';
import { ChangePasswordHost } from './auth/change-password';
import { LookupKeysHost } from './auth/lookup-keys';
import { SearchPalette } from './search/search-palette';
import { HomeView } from './home/home-view';
import { SourceView } from './source/source-view';
import { PageView } from './page/page-view';
import { PeopleView } from './people/people-view';
import { plural } from './lib/format';

type Auth = { state: 'loading' } | { state: 'signed-out' } | { state: 'signed-in'; me: Me } | { state: 'error'; message: string };

export function App() {
  const [auth, setAuth] = useState<Auth>({ state: 'loading' });
  const { url } = useLocation();
  const route = useMemo(() => parseRoute(url), [url]);

  const loadMe = useCallback(async () => {
    try {
      setAuth({ state: 'signed-in', me: await api<Me>('/auth/me') });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setAuth({ state: 'signed-out' });
      else setAuth({ state: 'error', message: 'Can’t reach Reelnote. Check that the PC is on, then reload.' });
    }
  }, []);

  useEffect(() => { void loadMe(); }, [loadMe]);

  // A session that ended (expired, signed out elsewhere, account removed): sign-in, then back to this URL.
  useEffect(() => onUnauthenticated(() => {
    stopSaves();
    clearCache();
    setAuth({ state: 'signed-out' });
  }), []);

  useEffect(() => onBackOnline((saved) => toast(saved ? `Back online. Saved ${plural(saved, 'change')}.` : 'Back online')), []);

  const signedIn = auth.state === 'signed-in' ? auth.me : null;
  useEffect(() => {
    if (!signedIn) return;
    startSaves(signedIn.user.id);
    if (route.name === 'login') navigate(route.next && route.next.startsWith('/') && !route.next.startsWith('//') ? route.next : paths.home(), { replace: true });
    // Starting saves once per signed-in user is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  useEffect(() => {
    if (auth.state === 'signed-out' && route.name !== 'login') navigate(paths.login(currentUrl()), { replace: true });
  }, [auth.state, route.name]);

  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    stopSaves();
    clearCache();
    setAuth({ state: 'signed-out' });
    navigate(paths.login(), { replace: true });
  }, []);

  const session = useMemo<Session | null>(() => signedIn && {
    me: signedIn.user,
    ownerName: signedIn.ownerName ?? 'the owner',
    isOwner: signedIn.user.role === 'owner',
    signOut,
  }, [signedIn, signOut]);

  useEffect(() => { document.body.classList.toggle('is-login', auth.state !== 'signed-in'); }, [auth.state]);

  if (auth.state === 'loading') return <div className="boot" aria-busy="true" />;
  if (auth.state === 'error') return <main className="login"><div className="login-card"><h1 className="login-brand">Reelnote</h1><p role="alert">{auth.message}</p>
    <button type="button" className="btn btn-primary" onClick={() => void loadMe()}>Try again</button></div></main>;
  if (!session) return <SignIn onSignedIn={(me) => setAuth({ state: 'signed-in', me })} />;
  return <SessionProvider value={session}><Shell route={route} /></SessionProvider>;
}

function Shell({ route }: { route: Route }) {
  const open = useStore(overlay);
  const page = usePage(route.name === 'page' ? route.id : null).data;
  const activeSourceId = route.name === 'source' ? route.id : route.name === 'page' ? page?.sourceId ?? null : null;
  useGlobalKeys(route, activeSourceId);

  return <div className="app">
    <TopBar route={route} />
    <div className="main">
      <Rail route={route} activeSourceId={activeSourceId} />
      <div className={`view view-${route.name}`} id="view">
        <View route={route} />
      </div>
    </div>
    <StatusBar />
    <OfflineBanner />
    <Toasts />
    <MenuHost />
    <SourceDialogHost />
    <DeletePageHost />
    <ChangePasswordHost />
    <LookupKeysHost />
    {open?.kind === 'keys' ? <KeyboardSheet /> : null}
    {open?.kind === 'search' ? <SearchPalette key={`${open.mode}:${open.scope}:${open.query}`} open={open} activeSourceId={activeSourceId} /> : null}
  </div>;
}

function View({ route }: { route: Route }) {
  switch (route.name) {
    case 'home': return <HomeView />;
    case 'source': return <SourceView key={route.id} sourceId={route.id} tab={route.tab} />;
    case 'page': return <PageView key={route.id} route={route} />;
    case 'people': return <PeopleView />;
    case 'login': return null;
    default: return <div className="view-scroll"><div className="home"><div className="empty"><h3>Nothing here</h3>
      <p>This address does not lead anywhere in Reelnote.</p><div className="empty-actions"><a className="btn btn-primary" href="/">Go to Home</a></div></div></div></div>;
  }
}
