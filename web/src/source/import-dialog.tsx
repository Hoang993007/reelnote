import { useEffect, useState, type FormEvent } from 'react';
import { keys } from '../lib/data';
import { fmtBytes, plural } from '../lib/format';
import { invalidate } from '../lib/resource';
import { failureText, send } from '../lib/saves';
import { useSession } from '../lib/session';
import { toast } from '../lib/shell-state';
import type { LibraryListing, Source } from '../lib/types';
import { Dialog } from '../shell/dialog';
import { LibraryBrowser } from '../library/library-browser';

type ImportResult = { createdPageIds: number[]; attachedCount: number; skipped: unknown[] };

/**
 * Import a folder (design-spec §5.3): the folder's videos with a checkbox and an editable title each; the ticked
 * ones become pages, appended in file order. Transcripts come from each file's English (else Vietnamese) subtitle track.
 */
export function ImportDialog({ source, pageCount, onClose }: { source: Source; pageCount: number; onClose: () => void }) {
  const { ownerName } = useSession();
  return <Dialog title={`Import a folder into ${source.name}`} onClose={onClose} className="import">
    <LibraryBrowser startDir={source.videoFolder ?? ''}>
      {(listing) => <FolderFiles key={listing.dir} listing={listing} source={source} pageCount={pageCount} ownerName={ownerName} onClose={onClose} />}
    </LibraryBrowser>
  </Dialog>;
}

function FolderFiles({ listing, source, pageCount, ownerName, onClose }: { listing: LibraryListing; source: Source; pageCount: number; ownerName: string; onClose: () => void }) {
  const fresh = listing.files.filter((f) => !f.attachedTo);
  const [picked, setPicked] = useState(() => new Set(fresh.map((f) => f.relPath)));
  const [titles, setTitles] = useState(() => new Map(listing.files.map((f) => [f.relPath, f.parsed.title])));
  const [busy, setBusy] = useState(false);
  useEffect(() => setPicked(new Set(fresh.map((f) => f.relPath))), [listing.dir]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = picked.size;
  const all = fresh.length > 0 && n === fresh.length;
  const pickAll = (on: boolean) => setPicked(new Set(on ? fresh.map((f) => f.relPath) : []));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!n) return;
    setBusy(true);
    try {
      const files = listing.files.filter((f) => picked.has(f.relPath)).map((f) => ({ relPath: f.relPath, title: titles.get(f.relPath)?.trim() || f.parsed.title }));
      const result = await send<ImportResult>(`/sources/${source.id}/video-import`, { method: 'POST', body: { relDir: listing.dir, onePagePerVideo: true, files } });
      invalidate(keys.pages(source.id), keys.source(source.id), keys.sources);
      toast(`${plural(result.createdPageIds.length, 'page')} created.`);
      onClose();
    } catch (error) {
      toast(failureText(error, ownerName));
      setBusy(false);
    }
  };

  if (!listing.files.length) return <p className="muted">No .mp4 videos in this folder. Pick another folder above.</p>;
  if (listing.dir === '') return <p className="muted">Pick a folder inside the library: one of the folders above.</p>;
  return <form onSubmit={(e) => void submit(e)} className="imp-form">
    <p className="muted">Each video becomes one page, added after page {pageCount}. Titles come from file names; edit them now or later.
      The transcript is read from each file’s English or Vietnamese subtitle track.</p>
    <div className="imp-list" role="group" aria-label="Videos found">
      <div className="imp-head">
        <input type="checkbox" checked={all} disabled={!fresh.length} aria-label={all ? 'Select none' : 'Select all'} title={all ? 'Select none' : 'Select all'}
          ref={(el) => { if (el) el.indeterminate = n > 0 && !all; }} onChange={() => pickAll(!all)} />
        <span>Page title</span><span>Size</span></div>
      {listing.files.map((file) => <label key={file.relPath} className={`imp-row${file.attachedTo ? ' is-taken' : ''}`}>
        <input type="checkbox" checked={picked.has(file.relPath)} disabled={!!file.attachedTo}
          onChange={(e) => setPicked((s) => { const next = new Set(s); if (e.target.checked) next.add(file.relPath); else next.delete(file.relPath); return next; })} />
        <input className="imp-title" value={titles.get(file.relPath) ?? ''} disabled={!!file.attachedTo} aria-label={`Title for ${file.name}`}
          onChange={(e) => setTitles((m) => new Map(m).set(file.relPath, e.target.value))} />
        <span className="mono">{fmtBytes(file.sizeBytes)}</span>
        <span className="imp-file mono">{file.attachedTo ? `${file.name} · already on “${file.attachedTo.pageTitle}”` : file.name}</span>
      </label>)}
    </div>
    <footer className="dlg-foot"><span className="muted">{n} of {plural(fresh.length, 'video')} selected</span>
      <button type="button" className="linkbtn" disabled={all || !fresh.length} onClick={() => pickAll(true)}>Select all</button>
      <button type="button" className="linkbtn" disabled={!n} onClick={() => pickAll(false)}>Select none</button>
      <span className="fill" />
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="submit" className="btn btn-primary" disabled={!n || busy}>Create {plural(n, 'page')}</button>
    </footer>
  </form>;
}
