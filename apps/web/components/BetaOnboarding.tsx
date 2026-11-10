'use client';

import { useEffect, useState } from 'react';

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

/** First-visit beta explainer. See lib/onboarding.ts for why it is inline. */
export function BetaOnboarding() {
  const copy = onboardingCopy(useLang());
  const linked = faucetLinkEnabled(useWallet());
  // Decided after mount: the server has no localStorage, and rendering it on
  // the server would flash it for returning testers.
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(shouldShowOnboarding(typeof window === 'undefined' ? null : window.localStorage));
  }, []);

  if (!show) return null;
  return (
    <section className="onb" aria-label={copy.title} data-testid="beta-onboarding">
      {/* Desktop: the full card. Phones get .onb-short instead (globals.css). */}
      <div className="onb-body">
        <h2 className="onb-title">{copy.title}</h2>
        <ol className="onb-steps">
          {copy.steps.map((s) => (
            <li key={stepText(s)}>{typeof s === 'string' ? s : <FaucetText step={s} linked={linked} />}</li>
          ))}
        </ol>
        <p className="onb-note">{copy.note}</p>
      </div>
      <p className="onb-short" data-testid="beta-onboarding-compact">
        <FaucetText step={copy.compact} linked={linked} />
      </p>
      <div className="onb-actions">
        <button
          type="button"
          className="btn btn-sm"
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
    </section>
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
