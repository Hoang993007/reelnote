import { useState, type FormEvent } from 'react';
import { invalidate } from '../lib/resource';
import { keys } from '../lib/data';
import { send, failureText } from '../lib/saves';
import { toast } from '../lib/shell-state';
import { useStore } from '../lib/store';
import { navigate, paths } from '../lib/router';
import { useSession } from '../lib/session';
import type { Source, SourceKind } from '../lib/types';
import { Dialog } from '../shell/dialog';
import { SourceAvatar } from '../shell/marks';
import { sourceDialog } from './source-dialog-state';

export const SOURCE_COLORS = ['#2C47A0', '#6B4E9B', '#2F7366', '#8A5326', '#7A3B55', '#4A6328', '#2B6684', '#7A6420'];
export const KIND_LABEL: Record<SourceKind, string> = { mentor: 'Mentor', book: 'Book', channel: 'Channel', course: 'Course' };

/** Add or edit a source (owner): name, kind, author, description and monogram colour (design-spec §13). */
export function SourceDialogHost() {
  const open = useStore(sourceDialog);
  return open ? <SourceDialog key={open === 'new' ? 'new' : open.id} source={open === 'new' ? null : open} /> : null;
}

function SourceDialog({ source }: { source: Source | null }) {
  const { ownerName } = useSession();
  const [name, setName] = useState(source?.name ?? '');
  const [kind, setKind] = useState<SourceKind | ''>(source?.kind ?? '');
  const [author, setAuthor] = useState(source?.author ?? '');
  const [description, setDescription] = useState(source?.description ?? '');
  const [color, setColor] = useState(source?.color ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => sourceDialog.set(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError('Enter a name.');
    setBusy(true);
    const body = { name: name.trim(), kind: kind || null, author: author.trim(), description: description.trim(), ...(color ? { color } : {}) };
    try {
      const saved = await send<Source>(source ? `/sources/${source.id}` : '/sources', { method: source ? 'PUT' : 'POST', body });
      invalidate(keys.sources, keys.source(saved.id));
      close();
      toast(source ? 'Source saved' : `${saved.name} added`);
      if (!source) navigate(paths.source(saved.id));
    } catch (failure) {
      setError(failureText(failure, ownerName));
      setBusy(false);
    }
  };

  return <Dialog title={source ? `Edit ${source.name}` : 'Add a source'} onClose={close}>
    <form className="src-form" onSubmit={submit} noValidate>
      <div className="src-form-id">
        <SourceAvatar source={{ name: name || '?', color: color || SOURCE_COLORS[0] }} size="lg" />
        <label className="field fill"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></label>
      </div>
      <div className="field-pair">
        <label className="field"><span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as SourceKind | '')}>
            <option value="">—</option>
            {Object.entries(KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        <label className="field fill"><span>Author</span><input value={author} onChange={(e) => setAuthor(e.target.value)} autoComplete="off" /></label>
      </div>
      <label className="field"><span>Description</span><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <fieldset className="field swatches">
        <legend>Colour</legend>
        <div className="swatch-row">
          {SOURCE_COLORS.map((c) => <button key={c} type="button" className={`swatch swatch-src${(color || (!source ? '' : source.color)) === c ? ' is-on' : ''}`}
            aria-label={`Colour ${c}`} aria-pressed={color === c} ref={(el) => el?.style.setProperty('--sw', c)} onClick={() => setColor(c)} />)}
        </div>
      </fieldset>
      {error ? <div className="lg-err" role="alert">{error}</div> : null}
      <footer className="dlg-foot"><span className="fill" />
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{source ? 'Save' : 'Add source'}</button>
      </footer>
    </form>
  </Dialog>;
}
