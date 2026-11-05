'use client';

import type { AppMode } from '../lib/app-mode.ts';
import type { NetworkId } from '../lib/deployments.ts';
import { modeCopyFor, NETWORK_BADGE } from '../lib/mode-copy.ts';
import { useLang } from './LangProvider';

/**
 * Mode + network, stated rather than offered.
 *
 * This was a radiogroup with two positions. It is a label now, because the
 * mode stopped being a choice: it follows the Pollar session
 * (lib/app-mode.ts), so a control here could only ever disagree with who the
 * visitor is. A button that cannot change anything is worse than no button —
 * it invites a click and then explains itself.
 *
 * What had to survive the demotion is the *qualifier*. The whole honesty fix
 * in mode-copy.ts is that the word "de prueba" sits next to the number, not
 * in a footnote, so somebody looking at a balance knows whether it is money.
 * That is why this renders at all rather than the element simply going away.
 *
 * On testnet a second badge names the network, so a signed-in session is not
 * mistaken for mainnet just because the mode says "tu billetera".
 *
 * Still a wrapper div and not a bare element: the phone block in globals.css
 * branches on `.wallet:has(> .btn)` to tell the logged-out masthead from the
 * connected one, and a new direct child of `.wallet` flips that selector.
 */
export function ModeBadge({ network, mode }: { network: NetworkId; mode: AppMode }) {
  const lang = useLang();
  const copy = modeCopyFor(mode, network, lang);
  const netBadge = network === 'testnet' ? NETWORK_BADGE.testnet : null;
  // data-mode stays the network for the existing contrast rules (mainnet =
  // sunflower). Production on testnet keeps the neutral surface.
  const tone = mode === 'production' && network === 'mainnet' ? 'mainnet' : 'testnet';
  return (
    <div className="wallet-mode">
      <span className="mode-badge" data-mode={tone} data-testid="mode-badge">
        <span className="mode-long" aria-hidden="true">
          {copy.label}
        </span>
        <span className="mode-short" aria-hidden="true">
          {copy.short}
        </span>
        <span className="sr-only">{copy.label}</span>
      </span>
      {netBadge ? (
        <span className="network-badge" data-network="testnet" data-testid="network-badge">
          <span className="mode-long" aria-hidden="true">
            {netBadge.label}
          </span>
          <span className="mode-short" aria-hidden="true">
            {netBadge.short}
          </span>
          <span className="sr-only">{netBadge.label}</span>
        </span>
      ) : null}
    </div>
  );
}
