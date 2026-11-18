import { useState } from 'react';
import { keys } from '../lib/data';
import { plural } from '../lib/format';
import { invalidate } from '../lib/resource';
import { navigate, paths } from '../lib/router';
import { failureText, send } from '../lib/saves';
import { useSession } from '../lib/session';
import { toast } from '../lib/shell-state';
import { useStore } from '../lib/store';
import type { Page } from '../lib/types';
import { Dialog } from '../shell/dialog';
import { deletePageDialog } from './delete-page-state';

/** Confirms deleting a page (owner): its notes and frames go for good; the video files stay in the library. */
export function DeletePageHost() {
  const open = useStore(deletePageDialog);
  return open ? <DeletePageDialog key={open.page.id} {...open} /> : null;
}

function DeletePageDialog({ page, leave }: { page: Page; leave: boolean }) {
  const { ownerName } = useSession();
  const [busy, setBusy] = useState(false);
  const close = () => deletePageDialog.set(null);

  const remove = async () => {
    setBusy(true);
    try {
      await send(`/pages/${page.id}`, { method: 'DELETE' });
      close();
      // Off the page first, so its view does not reload it and report it missing.
      if (leave) navigate(paths.source(page.sourceId), { replace: true });
      invalidate(keys.pages(page.sourceId), keys.source(page.sourceId), keys.sources, keys.recent, 'questions:', keys.insights(page.sourceId));
      toast(`Deleted “${page.title}”`);
    } catch (error) {
      toast(failureText(error, ownerName));
      setBusy(false);
    }
  };

  return <Dialog title="Delete this page?" onClose={close}>
    <div className="del-body">
      <p><strong>{page.title}</strong></p>
      <p>{page.blockCount ? `Its ${plural(page.blockCount, 'note')}, their frames and anyone else’s notes on it are deleted for good.`
        : 'It has no notes. Anyone else’s notes on it are deleted too.'}</p>
      <p className="muted">The video files stay in the library, so you can import them again.</p>
    </div>
    <footer className="dlg-foot"><span className="fill" />
      <button type="button" className="btn" onClick={close}>Cancel</button>
      <button type="button" className="btn btn-danger-solid" disabled={busy} onClick={() => void remove()}>Delete page</button>
    </footer>
  </Dialog>;
}
