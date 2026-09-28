import { useState, type FormEvent } from 'react';
import { chooseExplorerName, useAuthStore } from '../store/authStore';
import { ApiError } from '../net/api';
import './LoginScreen.css';
import { SHIP_NAME } from './strings';

export function LoginScreen() {
  const authLoading = useAuthStore((s) => s.loading);
  const signIn = useAuthStore((s) => s.signIn);
  const [signingIn, setSigningIn] = useState(false);

  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      await signIn();
    } catch {
      setSigningIn(false);
    }
  };

  const busy = authLoading || signingIn;

  return (
    <div className="login-overlay">
      <div className="login-panel">
        <div className="login-title">EPHAPSE-CLASS WARP CRUISER | {SHIP_NAME}</div>
        <div className="login-divider" />
        {busy ? (
          <div className="login-status">Authenticating<span className="login-ellipsis" /></div>
        ) : (
          <>
            <div className="login-status">Authentication required to access navigation systems.</div>
            <button className="login-btn" onClick={handleSignIn}>
              Sign in with Google
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function ExplorerNameScreen() {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    chooseExplorerName(name).catch((err) => {
      setError(err instanceof ApiError ? err.message : 'Could not save the name');
      setSaving(false);
    });
  };

  return (
    <div className="login-overlay">
      <form className="login-panel" onSubmit={submit}>
        <div className="login-title">EPHAPSE-CLASS WARP CRUISER | {SHIP_NAME}</div>
        <div className="login-divider" />
        <div className="login-status">Enter the name other explorers will see on your first finds.</div>
        <input
          className="login-input"
          value={name}
          maxLength={24}
          autoFocus
          placeholder="Explorer name"
          disabled={saving}
          onChange={(event) => setName(event.target.value)}
        />
        {error && <div className="login-error">{error}</div>}
        <button className="login-btn" type="submit" disabled={saving || name.trim().length < 2}>
          {saving ? 'Registering' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
