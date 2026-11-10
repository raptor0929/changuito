'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { DELETE_CONFIRM } from '../lib/delete-confirm.ts';
import { initials, profileCopy, type ProfileCopy } from '../lib/profile-copy.ts';
import { fetchAs, type Who } from '../lib/fetch-as.ts';
import type { PublicProfile } from '../lib/profile.ts';
import { useWallet } from '../lib/use-wallet.ts';
import { uiCopy } from '../lib/ui-copy.ts';
import { useLang } from './LangProvider';
import { Modal } from './Modal';
import { PasswordInput } from './PasswordInput';
import { Toast } from './Toast';
import { Purchases } from './Purchases';

/**
 * The profile dialog, opened from the avatar in the top bar. Tabs on the
 * left: General (who you are, what you bought, the way out) and the Día
 * details the checkout sandbox buys with (lib/profile.ts, stored encrypted).
 *
 * General holds what used to be loose in the bar — the address, the mode,
 * Mis compras and Cerrar sesión — so the bar can carry only the three things
 * a shopper reaches for mid-basket: load USDC, see the balance, open this.
 *
 * The password box is always empty. The server never sends the password back,
 * only `hasPassword`, so leaving the box empty keeps the saved one and typing
 * replaces it. What is typed lives in this component's state until Guardar,
 * and is cleared as soon as the server has it.
 */
export type ProfileTab = 'general' | 'dia';
const TABS: ProfileTab[] = ['general', 'dia'];

export function ProfileModal({
  onClose,
  address,
  email,
  onReceive,
  onLogout,
  onSaved,
  initialTab = 'general',
}: {
  onClose: () => void;
  address: string;
  email: string | null;
  /** Closes this dialog and opens the address QR. */
  onReceive: () => void;
  onLogout: () => void;
  /** The Día details were saved: the caller closes this dialog and says so. */
  onSaved?: () => void;
  initialTab?: ProfileTab;
}) {
  const copy = profileCopy(useLang());
  return (
    <ProfileDialog
      copy={copy}
      onClose={onClose}
      initialTab={initialTab}
      general={<ProfileGeneral copy={copy} address={address} email={email} onReceive={onReceive} onLogout={onLogout} />}
      dia={<ProfileLoader copy={copy} onSaved={onSaved} />}
    />
  );
}

/** The tabbed shell alone, with the panels passed in: what the dev fixtures render. */
export function ProfileDialog({
  copy,
  onClose,
  general,
  dia,
  initialTab = 'general',
  testId = 'profile-modal',
}: {
  copy: ProfileCopy;
  onClose: () => void;
  general: ReactNode;
  dia: ReactNode;
  initialTab?: ProfileTab;
  testId?: string;
}) {
  const [tab, setTab] = useState<ProfileTab>(initialTab);
  const tabRefs = useRef<Record<ProfileTab, HTMLButtonElement | null>>({
    general: null,
    dia: null,
  });

  // A vertical tablist: Up and Down move, Home and End jump, per WAI-ARIA.
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    const next =
      e.key === 'ArrowDown'
        ? TABS[(i + 1) % TABS.length]
        : e.key === 'ArrowUp'
          ? TABS[(i + TABS.length - 1) % TABS.length]
          : e.key === 'Home'
            ? TABS[0]
            : e.key === 'End'
              ? TABS[TABS.length - 1]
              : undefined;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <Modal title={copy.title} onClose={onClose} className="modal-profile" testId={testId}>
      <div className="profile-layout">
        <div className="tabs" role="tablist" aria-label={copy.title} aria-orientation="vertical" onKeyDown={onKey}>
          {TABS.map((t) => (
            <button
              key={t}
              ref={(el) => {
                tabRefs.current[t] = el;
              }}
              type="button"
              role="tab"
              id={`profile-tab-${t}`}
              className="tab"
              data-testid={`profile-tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`profile-panel-${t}`}
              tabIndex={tab === t ? 0 : -1}
              onClick={() => setTab(t)}
            >
              {t === 'general' ? copy.tabGeneral : copy.tabDia}
            </button>
          ))}
        </div>
        <div
          className="profile-panel"
          role="tabpanel"
          id={`profile-panel-${tab}`}
          aria-labelledby={`profile-tab-${tab}`}
        >
          {tab === 'general' ? general : dia}
        </div>
      </div>
    </Modal>
  );
}

/** Who this is, what they bought, and the way out. */
export function ProfileGeneral({
  copy,
  address,
  email,
  onReceive,
  onLogout,
}: {
  copy: ProfileCopy;
  address: string;
  email: string | null;
  onReceive: () => void;
  onLogout: () => void;
}) {
  const wallet = uiCopy(useLang()).wallet;
  return (
    <div className="profile-general" data-testid="profile-general">
      <div className="profile-who">
        <span className="avatar avatar-static" aria-hidden="true">
          {initials(email, address)}
        </span>
        <div className="profile-who-text">
          {email ? <strong className="profile-email">{email}</strong> : null}
          <span className="wallet-muted profile-addr-row">
            {copy.addressLabel}:{' '}
            <button
              type="button"
              className="wallet-addr"
              data-testid="wallet-receive"
              aria-haspopup="dialog"
              onClick={onReceive}
              title={wallet.addressTitle(address)}
            >
              {address}
            </button>
          </span>
        </div>
      </div>

      <section className="profile-orders" aria-labelledby="profile-orders-title">
        <h3 id="profile-orders-title" className="profile-section-title">
          {copy.ordersHeading}
        </h3>
        <Purchases embedded />
      </section>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" data-testid="wallet-logout" onClick={onLogout}>
          <LogoutIcon />
          {copy.signOut}
        </button>
      </div>

      <AccountDelete copy={copy} onLogout={onLogout} />
    </div>
  );
}

/**
 * Second step before anything is deleted. The confirm string travels in the
 * body so a stray POST cannot delete; the shopper sees a button, not the string.
 * When Privy's delete fails, the note stays on screen until they leave — a
 * reload would wipe it, and so would storing it under a `changuito:` key.
 */
function AccountDelete({ copy, onLogout }: { copy: ProfileCopy; onLogout: () => void }) {
  const wallet = useWallet();
  const [step, setStep] = useState<'idle' | 'confirm' | 'privy'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchAs({ address: wallet.address, sign: wallet.accessToken }, '/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ confirm: DELETE_CONFIRM }),
      });
      const json = (await res.json().catch(() => null)) as { privy?: string; message?: string } | null;
      if (!res.ok) {
        setError(json?.message || copy.deleteFailed);
        return;
      }
      if (json?.privy === 'failed') {
        setStep('privy');
        return;
      }
      onLogout();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.deleteFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-delete" aria-labelledby="account-delete-title">
      <h3 id="account-delete-title" className="profile-section-title">
        {copy.deleteHeading}
      </h3>
      {step === 'idle' ? (
        <button
          type="button"
          className="btn btn-warn"
          data-testid="account-delete"
          onClick={() => {
            setError(null);
            setStep('confirm');
          }}
        >
          {copy.deleteAccount}
        </button>
      ) : null}
      {step === 'confirm' ? (
        <div className="account-delete-panel">
          <p>{copy.deleteLead}</p>
          <p>{copy.deleteKeeps}</p>
          <a href="/privacidad">{copy.privacyLink}</a>
          {error ? (
            <p className="account-delete-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setStep('idle');
                setError(null);
              }}
              disabled={busy}
            >
              {copy.deleteCancel}
            </button>
            <button
              type="button"
              className="btn account-delete-confirm"
              data-testid="account-delete-confirm"
              onClick={() => {
                void confirmDelete();
              }}
              disabled={busy}
            >
              {busy ? copy.deleteWorking : copy.deleteConfirm}
            </button>
          </div>
        </div>
      ) : null}
      {step === 'privy' ? (
        <div className="account-delete-panel">
          <p role="alert">{copy.deletePrivyFailed}</p>
          <a href="/privacidad">{copy.privacyLink}</a>
          <button type="button" className="btn" onClick={onLogout}>
            {copy.deleteDone}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function LogoutIcon() {
  return (
    <svg className="wallet-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function ProfileLoader({ copy, onSaved }: { copy: ProfileCopy; onSaved?: () => void }) {
  const wallet = useWallet();
  const address = wallet.address;
  const sign = wallet.accessToken;
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read for *this* wallet (lib/fetch-as.ts): the session cookie can lag a
  // Privy account switch, and the answer would be the previous account's.
  useEffect(() => {
    let live = true;
    setProfile(null);
    setError(null);
    void fetchAs({ address, sign }, '/api/profile', { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!live) return;
        if (!res.ok) setError(body?.message ?? body?.error ?? copy.failed);
        else setProfile(body as PublicProfile);
      })
      .catch(() => live && setError(copy.failed));
    return () => {
      live = false;
    };
  }, [address, sign, copy.failed]);

  if (error) return <p className="pay-error" role="alert">{error}</p>;
  if (!profile) return <p className="ck-note">{copy.loading}</p>;
  // Keyed by wallet, so a switch starts the form from that wallet's profile.
  return (
    <ProfileForm
      key={address ?? 'none'}
      copy={copy}
      profile={profile}
      onSave={(patch) => saveProfile({ address, sign }, patch)}
      onSaved={onSaved}
    />
  );
}

async function saveProfile(who: Who, patch: Record<string, string>): Promise<PublicProfile> {
  const res = await fetchAs(who, '/api/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message ?? body?.error ?? '');
  return body as PublicProfile;
}

/** The form alone, with no fetching: what the dev fixtures render. */
export function ProfileForm({
  copy,
  profile,
  onSave,
  onSaved,
}: {
  copy: ProfileCopy;
  profile: PublicProfile;
  onSave: (patch: Record<string, string>) => Promise<PublicProfile>;
  /** Called after a successful save; without it the form shows its own toast. */
  onSaved?: () => void;
}) {
  const [saved, setSaved] = useState(profile);
  const [form, setForm] = useState({
    email: profile.email ?? '',
    password: '',
    dni: profile.dni ?? '',
    postcode: profile.postcode ?? '',
  });
  const [saving, setSaving] = useState(false);
  // Outcomes are toasts, not lines in the form: a success usually closes the
  // dialog (onSaved), and an error floats over it and fades.
  const [toast, setToast] = useState<{ id: number; tone: 'ok' | 'error'; message: string } | null>(null);
  const clearToast = useCallback(() => setToast(null), []);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setToast(null);
    try {
      const next = await onSave(form);
      setSaved(next);
      setForm((f) => ({ ...f, password: '' })); // the server has it now
      if (onSaved) onSaved();
      else setToast({ id: Date.now(), tone: 'ok', message: copy.saved });
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : copy.failed;
      setToast({ id: Date.now(), tone: 'error', message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="ck-pay" onSubmit={(e) => void submit(e)} data-testid="profile-form">
      <p className="ck-note">{copy.lead}</p>
      <div className="ck-form">
        <label>
          {copy.email}
          <input className="ck-input" type="email" autoComplete="off" value={form.email} onChange={set('email')} />
        </label>
        <label>
          {copy.password}
          <PasswordInput
            value={form.password}
            onChange={set('password')}
            placeholder={saved.hasPassword ? '••••••••' : ''}
            testId="profile-password"
          />
          <span className="ck-hint">{saved.hasPassword ? copy.passwordSaved : copy.passwordHint}</span>
        </label>
        <label>
          {copy.dni}
          <input className="ck-input" inputMode="numeric" autoComplete="off" value={form.dni} onChange={set('dni')} />
          <span className="ck-hint">{copy.dniHint}</span>
        </label>
        <label>
          {copy.postcode}
          <input className="ck-input" autoComplete="postal-code" value={form.postcode} onChange={set('postcode')} />
          <span className="ck-hint">{copy.postcodeHint}</span>
        </label>
      </div>
      {toast ? <Toast key={toast.id} message={toast.message} tone={toast.tone} onDone={clearToast} /> : null}
      <div className="modal-actions">
        <button type="submit" className="btn" disabled={saving} data-testid="profile-save">
          {saving ? copy.saving : copy.save}
        </button>
      </div>
    </form>
  );
}
