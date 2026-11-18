import { useStore } from '../lib/store';
import { saveState, retryNow } from '../lib/saves';
import { dismissToast, hints, notice, toasts } from '../lib/shell-state';
import { useSession } from '../lib/session';
import { plural } from '../lib/format';
import { Icon } from './icons';

/** Status bar (28 px): key hints for the mode on the left; notices, save state and who is signed in on the right. */
export function StatusBar() {
  const { me, isOwner } = useSession();
  const keys = useStore(hints);
  const message = useStore(notice);
  return <footer className="statusbar">
    <div className="st-keys" aria-label="Keys for this screen">
      {keys.map(([key, what]) => <span key={key}><kbd>{key}</kbd> {what}</span>)}
    </div>
    <div className="st-right">
      {isOwner ? null : <span className="st-view">Signed in as {me.displayName} · friend</span>}
      {message ? <span role="status">{message}</span> : null}
      <SaveDot />
    </div>
  </footer>;
}

function SaveDot() {
  const { saving, offline, waiting } = useStore(saveState);
  if (offline) return <span className="st-save offline">{waiting ? `${plural(waiting, 'change')} waiting to save` : 'Offline'}</span>;
  return <span className={`st-save${saving ? ' saving' : ''}`}>{saving ? 'Saving…' : 'Saved'}</span>;
}

/** Toasts: bottom centre, above the status bar; one action at most (Undo). */
export function Toasts() {
  const list = useStore(toasts);
  return <div className="toasts" aria-live="polite">
    {list.map((t) => <div key={t.id} className="toast" role="status">
      <span>{t.text}</span>
      {t.action ? <button type="button" className="toast-btn" onClick={() => { dismissToast(t.id); t.action!.run(); }}>{t.action.label}</button> : null}
    </div>)}
  </div>;
}

/** Offline banner (design-spec §9): edits wait in this browser and save when the connection is back. */
export function OfflineBanner() {
  const { offline } = useStore(saveState);
  const { ownerName, isOwner } = useSession();
  if (!offline) return null;
  const whose = isOwner ? 'the Reelnote server' : `${ownerName}’s PC`;
  return <div className="banner" role="alert">
    <Icon name="wifi" />
    <span><strong>Can’t reach {whose}.</strong> Your changes stay in this browser and save when the connection is back.</span>
    <button type="button" className="btn" onClick={retryNow}>Try again</button>
  </div>;
}
