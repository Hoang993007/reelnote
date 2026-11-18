import { useState, type FormEvent } from 'react';
import { ApiError } from '../lib/api';
import { send } from '../lib/saves';
import { toast } from '../lib/shell-state';
import { createStore, useStore } from '../lib/store';
import { Dialog } from '../shell/dialog';

/** Change my password (everyone, from the account menu): current password, then the new one twice. */
export const changePasswordOpen = createStore(false);

export function ChangePasswordHost() {
  const open = useStore(changePasswordOpen);
  return open ? <Dialog title="Change my password" onClose={() => changePasswordOpen.set(false)}>
    <ChangePasswordForm onDone={() => changePasswordOpen.set(false)} />
  </Dialog> : null;
}

export function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!current) return setError('Enter your current password.');
    if (next.length < 10) return setError('Use a password of at least 10 characters.');
    if (next !== again) return setError('The two new passwords differ.');
    setBusy(true);
    try {
      await send('/auth/password', { method: 'PUT', body: { currentPassword: current, newPassword: next } });
      toast('Password changed. Your other devices are signed out.');
      onDone();
    } catch (failure) {
      setBusy(false);
      setError(failure instanceof ApiError && failure.code === 'invalid-credentials' ? 'Your current password is not right.'
        : failure instanceof ApiError ? failure.message : 'The password could not be changed.');
    }
  };
  return <form className="ppl-form" onSubmit={(e) => void submit(e)} noValidate>
    <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus /></label>
    <label className="field"><span>New password</span><input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
    <label className="field"><span>New password again</span><input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></label>
    {error ? <div className="lg-err" role="alert">{error}</div> : null}
    <div className="ppl-acc"><button type="button" className="btn" onClick={onDone}>Cancel</button>
      <button type="submit" className="btn btn-primary" disabled={busy}>Change password</button></div>
  </form>;
}
