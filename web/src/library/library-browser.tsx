import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import { send } from '../lib/saves';
import type { LibraryListing } from '../lib/types';
import { Icon } from '../shell/icons';

type RootState = { root: string | null; problem: string | null };

/** A Windows path under the library root, as a library-relative `/` path; null when it is outside. */
export function relativeToRoot(root: string, typed: string): string | null {
  const clean = typed.trim().replace(/[\\/]+$/, '');
  const base = root.replace(/[\\/]+$/, '');
  if (!clean) return '';
  if (clean.toLowerCase() === base.toLowerCase()) return '';
  if (clean.toLowerCase().startsWith(`${base.toLowerCase()}\\`) || clean.toLowerCase().startsWith(`${base.toLowerCase()}/`)) {
    return clean.slice(base.length + 1).replace(/\\/g, '/');
  }
  if (/^[a-zA-Z]:|^\\\\/.test(clean)) return null;
  return clean.replace(/\\/g, '/').replace(/^\/+/, '');
}

export const absolutePath = (root: string, rel: string) => (rel ? `${root.replace(/[\\/]+$/, '')}\\${rel.replace(/\//g, '\\')}` : root);

/**
 * Browses the owner's video library (`video_library_root`, read only): a folder path field with Scan, the
 * folder's sub-folders, and its .mp4 files for the caller to show. Asks for the root when it is not set.
 */
export function LibraryBrowser({ startDir, children }: { startDir: string; children: (listing: LibraryListing, open: (dir: string) => void) => ReactNode }) {
  const [root, setRoot] = useState<RootState | null>(null);
  const [dir, setDir] = useState(startDir);
  const [typed, setTyped] = useState('');
  const [listing, setListing] = useState<LibraryListing | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<RootState>('/video-library/root').then(setRoot, () => setRoot({ root: null, problem: 'unreachable' }));
  }, []);

  useEffect(() => {
    if (!root?.root || root.problem) return;
    let live = true;
    setBusy(true);
    setError('');
    api<LibraryListing>(`/video-library?dir=${encodeURIComponent(dir)}`).then((found) => {
      if (!live) return;
      setListing(found);
      setTyped(absolutePath(found.root, found.dir));
    }, (failure: unknown) => {
      if (!live) return;
      setError(failure instanceof ApiError ? failure.message : 'The folder cannot be read.');
      setListing(null);
      if (dir) setTyped(absolutePath(root.root!, dir));
    }).finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [dir, root]);

  if (!root) return <p className="muted">Reading the video library…</p>;
  if (!root.root || root.problem) return <RootField current={root.root} onSet={setRoot} />;

  const scan = () => {
    const rel = relativeToRoot(root.root!, typed);
    if (rel === null) { setError(`Pick a folder inside the video library (${root.root}).`); return; }
    setDir(rel);
  };

  return <div className="lib">
    <label className="field"><span>Folder on this PC</span>
      <span className="field-row">
        <input value={typed} spellCheck={false} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); scan(); } }} />
        <button type="button" className="btn" onClick={scan} disabled={busy}>Scan</button>
      </span></label>
    {error ? <div className="lg-err" role="alert">{error}</div> : null}
    {listing ? <>
      {listing.parent !== null || listing.folders.length ? <div className="lib-folders" role="group" aria-label="Folders">
        {listing.parent !== null ? <button type="button" className="chip" onClick={() => setDir(listing.parent ?? '')}><Icon name="up" />Up</button> : null}
        {listing.folders.map((f) => <button key={f.relPath} type="button" className="chip" onClick={() => setDir(f.relPath)}><Icon name="folder" />{f.name}</button>)}
      </div> : null}
      {children(listing, setDir)}
    </> : busy ? <p className="muted">Scanning…</p> : null}
  </div>;
}

function RootField({ current, onSet }: { current: string | null; onSet: (state: RootState) => void }) {
  const [value, setValue] = useState(current ?? 'E:\\Videos');
  const [error, setError] = useState('');
  const save = async () => {
    try {
      const result = await send<{ root: string }>('/video-library/root', { method: 'PUT', body: { root: value.trim() } });
      onSet({ root: result.root, problem: null });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'The folder could not be set.');
    }
  };
  return <div className="lib">
    <p>{current ? `The video library folder (${current}) is not reachable.` : 'Reelnote does not know where your videos are yet.'} Pick the folder that holds them; Reelnote only reads it.</p>
    <label className="field"><span>Video library folder</span>
      <span className="field-row"><input value={value} spellCheck={false} onChange={(e) => setValue(e.target.value)} />
        <button type="button" className="btn btn-primary" onClick={() => void save()}>Use this folder</button></span></label>
    {error ? <div className="lg-err" role="alert">{error}</div> : null}
  </div>;
}
