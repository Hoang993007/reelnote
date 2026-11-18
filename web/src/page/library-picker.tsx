import { useState } from 'react';
import { ApiError } from '../lib/api';
import { fmtBytes } from '../lib/format';
import { send } from '../lib/saves';
import type { PageVideo } from '../lib/types';
import { Dialog } from '../shell/dialog';
import { LibraryBrowser } from '../library/library-browser';

/** Owner: point a missing video at its file again ("Locate the file"), or add a video to a page. */
export function LibraryPicker({ mode, video, pageId, sourceFolder, onClose, onDone }: {
  mode: 'locate' | 'add';
  video: PageVideo | null;
  pageId: number;
  sourceFolder: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [error, setError] = useState('');
  const startDir = video ? video.relPath.split('/').slice(0, -1).join('/') : sourceFolder ?? '';
  const pick = async (relPath: string) => {
    try {
      if (mode === 'locate' && video) {
        await send(`/page-videos/${video.id}/file`, { method: 'PUT', body: { relPath } });
        onDone(`Linked to ${relPath}`);
      } else {
        await send(`/pages/${pageId}/videos`, { method: 'POST', body: { relPaths: [relPath] } });
        onDone('Video added to the page');
      }
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'That file could not be used.');
    }
  };
  return <Dialog title={mode === 'locate' ? 'Locate the video file' : 'Add a video to this page'} onClose={onClose}>
    {video ? <p className="muted">Was: <span className="mono">{video.relPath}</span></p> : null}
    <LibraryBrowser startDir={startDir}>
      {(listing) => listing.files.length ? <div className="imp-list" role="list">
        {listing.files.map((file) => <button key={file.relPath} type="button" className="imp-pick" role="listitem" disabled={!!file.attachedTo && file.attachedTo.pageId !== pageId}
          onClick={() => void pick(file.relPath)}>
          <span>{file.parsed.title}</span>
          <span className="mono muted">{file.attachedTo ? `On “${file.attachedTo.pageTitle}”` : fmtBytes(file.sizeBytes)}</span>
          <span className="imp-file mono">{file.name}</span>
        </button>)}
      </div> : <p className="muted">No .mp4 files in this folder.</p>}
    </LibraryBrowser>
    {error ? <div className="lg-err" role="alert">{error}</div> : null}
  </Dialog>;
}
