'use client';

import { useEffect, useRef, useState } from 'react';

import {
  dismissOnboarding,
  faucetLinkEnabled,
  onboardingCopy,
  requestFaucet,
  shouldShowOnboarding,
  stepText,
  type FaucetStep,
} from '../lib/onboarding.ts';
import { useWallet } from '../lib/use-wallet.ts';
import { useLang } from './LangProvider';

/** First-visit beta explainer. See lib/onboarding.ts: once, and only the button closes it. */
export function BetaOnboarding() {
  const copy = onboardingCopy(useLang());
  const linked = faucetLinkEnabled(useWallet());
  const dialogRef = useRef<HTMLDivElement>(null);
  // Decided after mount: the server has no localStorage, and rendering it on
  // the server would flash it for returning testers.
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(shouldShowOnboarding(typeof window === 'undefined' ? null : window.localStorage));
  }, []);

  useEffect(() => {
    if (!show) return;
    const root = dialogRef.current;
    root?.focus();
    const onKey = (event: KeyboardEvent) => {
      // The button is the only exit. Escape must not dismiss it.
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea')].filter(
        (el) => !el.hasAttribute('disabled'),
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [show]);

  if (!show) return null;
  return (
    <div className="onb-backdrop" data-testid="beta-onboarding-backdrop">
      <div
        ref={dialogRef}
        className="onb"
        role="dialog"
        aria-modal="true"
        aria-labelledby="beta-onboarding-title"
        tabIndex={-1}
        data-testid="beta-onboarding"
      >
        {/* The full card at every width. .onb-short stays in the DOM, hidden. */}
        <div className="onb-body">
          <h2 className="onb-title" id="beta-onboarding-title">
            {copy.title}
          </h2>
          <ol className="onb-steps">
            {copy.steps.map((s) => (
              <li key={stepText(s)}>{typeof s === 'string' ? s : <FaucetText step={s} linked={linked} />}</li>
            ))}
          </ol>
        </div>
        <p className="onb-short" data-testid="beta-onboarding-compact">
          <FaucetText step={copy.compact} linked={linked} />
        </p>
        <div className="onb-foot">
          <p className="onb-note">{copy.note}</p>
          <div className="onb-actions">
            <button
              type="button"
              className="btn"
              data-testid="beta-onboarding-dismiss"
              onClick={() => {
                dismissOnboarding(window.localStorage);
                setShow(false);
              }}
            >
              <span className="onb-label-full">{copy.dismiss}</span>
              <span className="onb-label-short">{copy.dismissShort}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Signed in, "faucet" opens the top bar's FaucetConfirm (the card stays up).
 * Signed out it is plain text: the fund button does not exist yet either.
 */
function FaucetText({ step, linked }: { step: FaucetStep; linked: boolean }) {
  return (
    <>
      {step.before}
      {linked ? (
        <button
          type="button"
          className="onb-link"
          data-testid="beta-onboarding-faucet"
          aria-haspopup="dialog"
          onClick={() => requestFaucet(window)}
        >
          {step.link}
        </button>
      ) : (
        step.link
      )}
      {step.after}
    </>
  );
}
