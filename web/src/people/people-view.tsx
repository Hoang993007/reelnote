import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../lib/api';
import { keys, useAddresses, usePeople, useSources } from '../lib/data';
import { fmtWhen } from '../lib/format';
import { invalidate, mutate } from '../lib/resource';
import { failureText, send } from '../lib/saves';
import { useSession } from '../lib/session';
import { hints, toast } from '../lib/shell-state';
import type { Person } from '../lib/types';
import { Icon } from '../shell/icons';
import { PersonAvatar } from '../shell/marks';
import { toggleAccess, type Access } from './access';
import { SourceChecks } from './source-access';
import { connectionKind } from '../auth/sign-in';
import { copyText, generatePassword } from './people-tools';
import { ChangePasswordForm } from '../auth/change-password';

/** People and access (design-spec §5.8, owner only): who can open Reelnote, and which sources each person opens and edits. */
export function PeopleView() {
  const { isOwner } = useSession();
  const people = usePeople(isOwner);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [handoff, setHandoff] = useState<{ userId: number; password: string } | null>(null);
  useEffect(() => { hints.set([['Ctrl K', 'search'], ['?', 'all keys']]); }, []);

  if (!isOwner) return <div className="view-scroll"><div className="people"><div className="empty"><h3>Only the owner manages people</h3><p>Ask the owner if you need access to another source.</p></div></div></div>;
  const list = people.data ?? [];
  const selected = list.find((p) => p.id === selectedId) ?? list.find((p) => p.role === 'friend' && !p.disabled) ?? list[0];

  return <div className="view-scroll"><div className="people">
    <header className="ppl-head">
      <div><h1 className="src-title">People and access</h1><p className="src-meta">Who can open Reelnote, and which sources each person opens and edits.</p></div>
      <button type="button" className="btn btn-primary" onClick={() => { setAdding(true); setHandoff(null); }}><Icon name="plus" /> Add a person</button>
    </header>
    <div className="ppl-grid">
      <ul className="ppl-list">
        {list.map((p) => <li key={p.id}><button type="button" className={`ppl-row${!adding && selected?.id === p.id ? ' is-on' : ''}${p.disabled ? ' is-off' : ''}`}
          aria-current={!adding && selected?.id === p.id || undefined} onClick={() => { setSelectedId(p.id); setAdding(false); setHandoff(null); }}>
          <PersonAvatar name={p.displayName} owner={p.role === 'owner'} />
          <span className="row-main"><span className="row-t">{p.displayName}{p.role === 'owner' ? <span className="muted"> (you)</span> : null}</span>
            <span className="row-m">{p.role === 'owner' ? 'Owner' : p.disabled ? 'Removed' : `Friend · ${p.sourceIds.length} sources${p.writeSourceIds.length ? `, edits ${p.writeSourceIds.length}` : ''}`} · {p.lastSeenAt ? fmtWhen(p.lastSeenAt) : 'Never signed in'}</span></span>
        </button></li>)}
      </ul>
      <section className="ppl-detail" aria-live="polite">
        {adding ? <AddPerson onCancel={() => setAdding(false)} onCreated={(person, password) => { setAdding(false); setSelectedId(person.id); setHandoff({ userId: person.id, password }); }} />
          : selected ? (selected.role === 'owner' ? <OwnerCard person={selected} /> : <FriendCard key={selected.id} person={selected} handoff={handoff?.userId === selected.id ? handoff.password : null} />)
          : null}
      </section>
    </div>
    <Addresses />
  </div></div>;
}

function OwnerCard({ person }: { person: Person }) {
  const [open, setOpen] = useState(false);
  return <div className="ppl-card">
    <div className="ppl-id"><PersonAvatar name={person.displayName} owner large /><div><h2>{person.displayName}</h2><p className="muted">{person.email} · Owner</p></div></div>
    <p className="ppl-explain">You own this Reelnote. You see every source, make transcripts and AI notes on this PC, create accounts and choose what each person can open.</p>
    {open ? <ChangePasswordForm onDone={() => setOpen(false)} /> : <div className="ppl-acc"><button type="button" className="btn" onClick={() => setOpen(true)}>Change my password</button></div>}
  </div>;
}

function FriendCard({ person, handoff }: { person: Person; handoff: string | null }) {
  const { ownerName } = useSession();
  const sources = useSources().data ?? [];
  const addresses = useAddresses(true).data;
  const [temp, setTemp] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const fail = (error: unknown) => toast(failureText(error, ownerName));

  const access: Access = { read: person.sourceIds, write: person.writeSourceIds };
  const setAccess = async (next: Access, message?: string) => {
    mutate<Person[]>(keys.people, (list) => list.map((p) => (p.id === person.id ? { ...p, sourceIds: next.read, writeSourceIds: next.write } : p)));
    try {
      await send(`/admin/users/${person.id}/sources`, { method: 'PUT', body: { sourceIds: next.read, writeSourceIds: next.write } });
      if (message) toast(message);
    } catch (error) {
      fail(error);
      invalidate(keys.people);
    }
  };
  const resetPassword = async () => {
    const password = generatePassword();
    try {
      await send(`/admin/users/${person.id}/password`, { method: 'PUT', body: { password } });
      setTemp(password);
    } catch (error) {
      fail(error);
    }
  };
  const setDisabled = async (disabled: boolean) => {
    try {
      await send(`/admin/users/${person.id}/disabled`, { method: 'PUT', body: { disabled } });
      invalidate(keys.people);
      setConfirm(false);
      if (disabled) toast(`${person.displayName} removed`, { label: 'Undo', run: () => void setDisabled(false) });
      else toast(`${person.displayName} can sign in again`);
    } catch (error) {
      fail(error);
    }
  };
  // The address a friend can reach: Tailscale, else the home Wi-Fi; this PC's own address is no use to them.
  const address = addresses?.tailscale ?? addresses?.lan[0]
    ?? (connectionKind() === 'pc' ? '(not reachable from other devices yet: see Where Reelnote opens)' : location.origin);

  return <div className="ppl-card">
    <div className="ppl-id"><PersonAvatar name={person.displayName} owner={false} large />
      <div><h2>{person.displayName}</h2><p className="muted">{person.email} · Friend{person.disabled ? ' · Removed' : ''} · {person.lastSeenAt ? `Active ${fmtWhen(person.lastSeenAt).toLowerCase()}` : 'Never signed in'}</p></div></div>
    {person.disabled ? <div className="ppl-note"><strong>{person.displayName} cannot sign in.</strong><p>Their notes, progress and insights are kept.</p>
      <button type="button" className="btn" onClick={() => void setDisabled(false)}>Let {person.displayName} sign in again</button></div> : null}
    <p className="ppl-explain">{person.displayName} opens the sources ticked Open and sees every note on them. On a source ticked Edit, {person.displayName} also changes
      its details, pages, videos and everyone's notes; elsewhere only their own notes. Reading position and video progress are each person's own; private annotations never show.</p>
    {handoff && !person.disabled ? <div className="ppl-note" role="status"><strong>Account created. Send this to {person.displayName} yourself:</strong>
      <pre className="mono ppl-handoff" id="ppl-handoff">{`Address: ${address}\nEmail: ${person.email}\nTemporary password: ${handoff}`}</pre>
      <button type="button" className="btn" onClick={() => copyText(`Address: ${address}\nEmail: ${person.email}\nTemporary password: ${handoff}`, 'ppl-handoff')}>Copy</button></div> : null}
    <div className="sec-row"><h3 className="sec-h">Sources {person.displayName} can open <span className="count">{person.sourceIds.length} of {sources.length}</span></h3>
      <button type="button" className="linkbtn" onClick={() => void setAccess({ ...access, read: sources.map((s) => s.id) }, `${person.displayName} can now open every source`)}>Open all</button>
      <button type="button" className="linkbtn" onClick={() => void setAccess({ read: [], write: [] }, `${person.displayName} can no longer open any source`)}>None</button></div>
    <SourceChecks sources={sources} access={access} label={person.displayName}
      onToggle={(source, column, on) => void setAccess(toggleAccess(access, source.id, column, on),
        `${person.displayName} can ${on ? '' : 'no longer '}${column === 'read' ? 'open' : 'edit'} ${source.name}`)} />
    <h3 className="sec-h ppl-acc-h">Account</h3>
    <div className="ppl-acc">
      <button type="button" className="btn" onClick={() => void resetPassword()}>Reset password</button>
      {person.disabled ? null : <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>Remove {person.displayName}</button>}
    </div>
    {temp ? <div className="ppl-note" role="status"><strong>New password for {person.displayName}</strong>
      <p><span className="mono ppl-secret" id="ppl-secret">{temp}</span> <button type="button" className="linkbtn" onClick={() => copyText(temp, 'ppl-secret')}>Copy</button></p>
      <p className="muted">Shown once. Give it to {person.displayName} yourself. {person.displayName} is signed out on every device.</p></div> : null}
    {confirm ? <div className="ppl-note ppl-warn" role="alertdialog" aria-labelledby="rm-h"><strong id="rm-h">Remove {person.displayName}?</strong>
      <p>{person.displayName} can no longer sign in and is signed out everywhere. Notes written by {person.displayName} are kept, so you can undo this.</p>
      <div className="ppl-acc"><button type="button" className="btn" onClick={() => setConfirm(false)}>Cancel</button>
        <button type="button" className="btn btn-danger-solid" onClick={() => void setDisabled(true)}>Remove {person.displayName}</button></div></div> : null}
  </div>;
}

function AddPerson({ onCancel, onCreated }: { onCancel: () => void; onCreated: (person: Person, password: string) => void }) {
  const sources = useSources().data ?? [];
  const people = usePeople(true).data ?? [];
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(generatePassword);
  // A new person opens every source unless unticked here.
  const [picked, setPicked] = useState<Access | null>(null);
  const access = picked ?? { read: sources.map((s) => s.id), write: [] };
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const mail = email.trim().toLowerCase();
    const problem = !name.trim() ? 'Enter a name.' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) ? 'Enter a valid email.'
      : people.some((p) => p.email === mail) ? 'Someone already uses this email.' : password.trim().length < 10 ? 'Use a temporary password of at least 10 characters.' : '';
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const person = await send<Person>('/admin/users', { method: 'POST', body: { email: mail, displayName: name.trim(), password: password.trim() } });
      await send(`/admin/users/${person.id}/sources`, { method: 'PUT', body: { sourceIds: access.read, writeSourceIds: access.write } });
      invalidate(keys.people);
      onCreated({ ...person, sourceIds: access.read, writeSourceIds: access.write, lastSeenAt: null }, password.trim());
    } catch (failure) {
      setError(failure instanceof ApiError && failure.status === 409 ? 'Someone already uses this email.' : failure instanceof ApiError ? failure.message : 'The account could not be created.');
      setBusy(false);
    }
  };

  return <form className="ppl-card" onSubmit={(e) => void submit(e)} noValidate>
    <h2>Add a person</h2>
    <label className="field"><span>Name</span><input ref={nameRef} value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} /></label>
    <label className="field"><span>Email</span><input type="email" value={email} autoComplete="off" spellCheck={false} onChange={(e) => setEmail(e.target.value)} /></label>
    <label className="field"><span>Temporary password</span><span className="field-row">
      <input className="mono" value={password} spellCheck={false} onChange={(e) => setPassword(e.target.value)} />
      <button type="button" className="btn" onClick={() => setPassword(generatePassword())}>New one</button></span></label>
    <p className="muted">They sign in with it, then pick their own password from the account menu (Change my password).</p>
    {error ? <div className="lg-err" role="alert">{error}</div> : null}
    <h3 className="sec-h">Sources they can open and edit</h3>
    <SourceChecks sources={sources} access={access} onToggle={(s, column, on) => setPicked(toggleAccess(access, s.id, column, on))} />
    <div className="dlg-foot"><span className="fill" /><button type="button" className="btn" onClick={onCancel}>Cancel</button>
      <button type="submit" className="btn btn-primary" disabled={busy}>Create account</button></div>
  </form>;
}

function Addresses() {
  const data = useAddresses(true).data;
  const here = connectionKind();
  return <section className="ppl-addr" aria-labelledby="addr-h">
    <h3 className="sec-h" id="addr-h">Where Reelnote opens</h3>
    <dl>
      <div><dt>This PC</dt><dd className="mono">http://localhost:{data?.port ?? 3900}</dd><dd>Installed as an app window{here === 'pc' ? ' (you are here)' : ''}.</dd></div>
      <div><dt>Home Wi-Fi</dt><dd className="mono">{data?.lan.length ? data.lan.join(', ') : '—'}</dd>
        <dd className="warn">{data && !data.lan.length ? 'Not reachable from the Wi-Fi: the server listens on this PC only (REELNOTE_HOST).' : 'Not encrypted. Use it only on your own network.'}</dd></div>
      <div><dt>Tailscale</dt><dd className="mono">{data?.tailscale ?? '—'}</dd>
        <dd>{data?.tailscale ? 'Encrypted by Tailscale. Works away from home.' : 'Not set: put the Tailscale Serve address in REELNOTE_TAILSCALE_URL.'}</dd></div>
    </dl>
  </section>;
}
