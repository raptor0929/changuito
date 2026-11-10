'use client';

import { useEffect, useRef, useState } from 'react';

import { track, trackLoginStart } from '../lib/analytics';
import { GRANT_UNITS } from '../lib/faucet-policy.ts';
import { usdcAmount } from '../lib/faucet-copy.ts';
import { modeCopyFor, previewMasthead } from '../lib/mode-copy.ts';
import { OPEN_FAUCET_EVENT } from '../lib/onboarding.ts';
import { initials, profileCopy } from '../lib/profile-copy.ts';
import { ensureUserCookie, forgetUserCookie } from '../lib/session-login.ts';
import { postFaucet } from '../lib/faucet-client.ts';
import { wipeLocalAccount } from '../lib/local-account.ts';
import { useBalances } from '../lib/use-balances.ts';
import { useWallet } from '../lib/use-wallet.ts';
import { uiCopy } from '../lib/ui-copy.ts';
import { useLang } from './LangProvider';
import { useNetwork } from './NetworkProvider';
import { FaucetConfirm } from './FaucetConfirm';
import { ProfileModal } from './ProfileModal';
import { ReceiveModal } from './ReceiveModal';

/**
 * The wallet's half of the top bar, read right to left: the profile avatar,
 * the Pollar / Freighter wallet's testnet USDC balance, and Cargar USDC.
 * Everything else that used to sit in the card here — the address, the mode,
 * Mis compras and the way out — lives in the profile's General tab
 * (ProfileModal.tsx).
 *
 * Pollar lives behind `useWallet()` (lib/use-wallet.ts), so this renders the
 * same tree whether or not the build has a Pollar key; `enabled: false` is the
 * misconfiguration, not a signed-out visitor.
 */
export function WalletWidget() {
  const wallet = useWallet();
  const lang = useLang();
  const { network, mode: appMode } = useNetwork();
  const copy = uiCopy(lang).wallet;
  const mode = modeCopyFor(appMode, network, lang);
  const masthead = previewMasthead(lang);
  const address = wallet.address;
  const { data, loading, error, refresh } = useBalances(address);

  const [funding, setFunding] = useState(false);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [noteError, setNoteError] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [showingProfile, setShowingProfile] = useState(false);
  const profileButton = useRef<HTMLButtonElement>(null);
  const fundButton = useRef<HTMLButtonElement>(null);

  // The faucet's answer floats under the bar rather than growing it, so it
  // has to go away by itself.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(t);
  }, [note]);

  // The onboarding card's "faucet" link (BetaOnboarding.tsx) opens the same
  // confirm as the button below. It is only a link once signed in, and the
  // listener only acts with a wallet, so a signed-out event does nothing.
  useEffect(() => {
    if (!address || funding) return;
    const open = () => {
      setNote(null);
      setConfirming(true);
    };
    window.addEventListener(OPEN_FAUCET_EVENT, open);
    return () => window.removeEventListener(OPEN_FAUCET_EVENT, open);
  }, [address, funding]);

  const wasAuthed = useRef(wallet.authenticated);
  useEffect(() => {
    if (!wasAuthed.current && wallet.authenticated) {
      track('login_success');
      track('login');
    }
    wasAuthed.current = wallet.authenticated;
  }, [wallet.authenticated]);

  // After login, mint the httpOnly `chg_user` cookie from the Pollar SEP-53
  // signer, so /api/chat skips the guest limit and the checkout routes know
  // who is paying. Shared with the chat — see lib/session-login.ts.
  useEffect(() => {
    if (!address) return;
    track('payment_view', { state: 'ready' });
    // A phone-wallet path already posted its signed proof. Asking again with
    // a null signer would record a failed login. Unused on this chain.
    if (wallet.kind === 'mobile') return;
    let cancelled = false;
    void ensureUserCookie(address, wallet.accessToken).then((ok) => {
      if (!cancelled && !ok) track('login_fail', { code: 'session' });
    });
    return () => {
      cancelled = true;
    };
  }, [address, wallet.accessToken, wallet.kind]);

  // Signing out leaves nothing of this account in the browser: the session
  // cookie, the stored chats (history, carts, receipts, postcode), Pollar's
  // session, and — by reloading — everything held in memory.
  function signOut() {
    track('logout');
    setShowingProfile(false);
    forgetUserCookie();
    wipeLocalAccount();
    void fetch('/api/session/logout', { method: 'POST', credentials: 'same-origin' })
      .catch(() => null)
      .then(() => wallet.logout())
      .catch(() => null)
      .finally(() => window.location.reload());
  }

  async function fund() {
    if (!address) return;
    track('payment_start', { flow: 'faucet' });
    setFunding(true);
    setNote(null);
    setNoteError(false);
    try {
      await ensureUserCookie(address, wallet.accessToken);
      const res = await postFaucet({ address, sign: wallet.accessToken }, network);
      if (!res) throw new Error(copy.fundProofFailed);
      const json = await res.json().catch(() => ({}));
      // 429 carries a real answer ("you already have enough"), not a failure.
      if (!res.ok && res.status !== 429) throw new Error(json.message ?? json.error ?? `faucet failed (${res.status})`);
      track('payment_success', { flow: 'faucet', code: res.status === 429 ? 'enough' : 'ok' });
      track('faucet', { code: res.status === 429 ? 'enough' : 'ok' });
      setNoteError(false);
      setNote(json.note ?? copy.fundedAmount(usdcAmount(GRANT_UNITS, lang)));
      refresh();
    } catch (err) {
      track('payment_fail', { flow: 'faucet', code: 'error' });
      track('failure', { code: 'faucet' });
      setNoteError(true);
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setFunding(false);
    }
  }

  function showFailure(err: unknown) {
    setNoteError(true);
    setNote(err instanceof Error ? err.message : String(err));
  }

  function connectPhone() {
    setPhoneBusy(true);
    setNote(null);
    setNoteError(false);
    setSignedOut(false);
    trackLoginStart(() => {
      void wallet.loginMobile().catch(showFailure).finally(() => setPhoneBusy(false));
    });
  }

  if (!address) {
    const android = wallet.androidChoices && wallet.enabled;
    return (
      <div
        className={android ? 'topbar-wallet is-android' : wallet.enabled ? 'topbar-wallet' : 'topbar-wallet wallet-off'}
        title={wallet.enabled ? undefined : 'Falta NEXT_PUBLIC_POLLAR_API_KEY. Ver DEPLOY.md'}
      >
        {android ? (
          <span className="sr-only">{wallet.ready ? copy.androidLead : copy.verifying}</span>
        ) : wallet.enabled ? (
          <span className="topbar-muted topbar-hint">{masthead.hint}</span>
        ) : (
          <span className="topbar-muted">{copy.unconfigured}</span>
        )}
        {android ? (
          <>
            <button
              type="button"
              className="btn topbar-btn"
              data-testid="wallet-email"
              aria-label={copy.emailAria}
              disabled={!wallet.ready}
              onClick={() => trackLoginStart(() => wallet.login('email'))}
            >
              {copy.emailCta}
            </button>
            <button
              type="button"
              className="btn topbar-btn"
              data-testid="wallet-google"
              aria-label={copy.googleAria}
              disabled={!wallet.ready}
              onClick={() => trackLoginStart(() => wallet.login('google'))}
            >
              {copy.googleCta}
            </button>
            <button
              type="button"
              className="btn topbar-btn"
              data-testid="wallet-native"
              aria-label={copy.connectAria}
              aria-busy={phoneBusy || !wallet.ready}
              disabled={phoneBusy || !wallet.ready}
              onClick={connectPhone}
            >
              {phoneBusy ? copy.nativeBusy : copy.connectCta}
            </button>
          </>
        ) : wallet.enabled ? (
          <button
            type="button"
            className="btn topbar-btn"
            onClick={() => trackLoginStart(wallet.login)}
            disabled={!wallet.ready}
          >
            {masthead.action}
          </button>
        ) : null}
        {android ? null : (
          <button
            type="button"
            className="btn topbar-btn"
            data-testid="wallet-mobile"
            aria-label={copy.phoneAria}
            disabled={phoneBusy}
            onClick={connectPhone}
          >
            {copy.phoneCta}
          </button>
        )}
        {note ? (
          <p className={noteError ? 'topbar-toast is-error' : 'topbar-toast'} role={noteError ? 'alert' : 'status'}>
            {note}
          </p>
        ) : signedOut ? (
          <p className="topbar-toast" role="status">
            {copy.signedOut}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="topbar-wallet">
      {wallet.androidChoices && wallet.kind === 'privy' ? (
        <button
          type="button"
          className="btn topbar-btn"
          data-testid="wallet-link"
          aria-label={copy.linkAria}
          aria-busy={phoneBusy}
          disabled={phoneBusy || !wallet.ready}
          onClick={connectPhone}
        >
          {phoneBusy ? copy.nativeBusy : copy.linkCta}
        </button>
      ) : null}
      <button
        ref={fundButton}
        type="button"
        className="btn topbar-btn"
        data-testid="wallet-fund"
        aria-haspopup="dialog"
        onClick={() => {
          setNote(null);
          setConfirming(true);
        }}
        disabled={funding || confirming}
      >
        {funding ? copy.funding : copy.fundCta}
      </button>

      <span className="topbar-balance" data-testid="wallet-balance">
        <strong>{data ? data.usdcDisplay : '-'}</strong>
        <span className="topbar-unit">{mode.balanceUnit}</span>
        {loading ? <span className="sr-only">{copy.refreshing}</span> : null}
      </span>

      <button
        ref={profileButton}
        type="button"
        className="avatar"
        data-testid="wallet-profile"
        aria-label={profileCopy(lang).avatarAria}
        aria-haspopup="dialog"
        onClick={() => setShowingProfile(true)}
      >
        {initials(wallet.email, address)}
      </button>

      {error || note ? (
        <p className={error || noteError ? 'topbar-toast is-error' : 'topbar-toast'} role={error || noteError ? 'alert' : 'status'}>
          {error ?? note}
        </p>
      ) : null}

      {showingProfile ? (
        <ProfileModal
          address={address}
          email={wallet.email ?? null}
          onLogout={signOut}
          onSaved={() => {
            setShowingProfile(false);
            setNote(profileCopy(lang).saved);
            requestAnimationFrame(() => profileButton.current?.focus());
          }}
          onReceive={() => {
            setShowingProfile(false);
            setReceiving(true);
          }}
          onClose={() => {
            setShowingProfile(false);
            requestAnimationFrame(() => profileButton.current?.focus());
          }}
        />
      ) : null}

      {receiving ? (
        <ReceiveModal
          address={address}
          trustline="not-needed"
          enabling={false}
          enableError={null}
          onEnable={() => {}}
          onClose={() => {
            setReceiving(false);
            requestAnimationFrame(() => profileButton.current?.focus());
          }}
        />
      ) : null}

      {confirming ? (
        <FaucetConfirm
          balanceUnits={data ? BigInt(data.usdc) : null}
          onClose={() => {
            setConfirming(false);
            requestAnimationFrame(() => fundButton.current?.focus());
          }}
          onConfirm={() => {
            setConfirming(false);
            void fund();
          }}
        />
      ) : null}
    </div>
  );
}
