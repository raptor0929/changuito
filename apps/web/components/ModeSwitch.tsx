'use client';

import { useRef, useState } from 'react';

import type { NetworkId } from '../lib/deployments.ts';
import { MODES } from '../lib/mode-copy.ts';

/**
 * Modo prueba / modo real, two lines above the number it governs.
 *
 * It is a radiogroup rather than a switch because both positions are named
 * states: "off" is not a fair name for modo prueba, and a screen reader
 * saying "switch, off" about the safe mode would be actively misleading.
 *
 * Arrow keys move between the options and only the selected one is tabbable,
 * which is what the radiogroup pattern requires and what a pair of plain
 * buttons would get wrong.
 *
 * A position that is closed carries `aria-disabled` rather than `disabled`:
 * disabled removes it from the accessibility tree, and somebody who cannot
 * use modo real should still be able to find out that it exists and why it
 * will not take their click. The reason appears when they try, not before —
 * most visitors will never be on the list, and a permanent apology in the
 * masthead is clutter that explains nothing they asked about.
 */
export function ModeSwitch({
  network,
  onChange,
  lockedReason,
}: {
  network: NetworkId;
  onChange: (net: NetworkId) => void;
  /** Why the real option is closed, or null when it is open. */
  lockedReason: string | null;
}) {
  const group = useRef<HTMLDivElement>(null);
  const [bumped, setBumped] = useState(false);

  const open = (net: NetworkId) => net === 'testnet' || lockedReason === null;

  function pick(net: NetworkId) {
    if (!open(net)) {
      setBumped(true);
      return;
    }
    if (net === network) return;
    setBumped(false);
    onChange(net);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const at = MODES.findIndex((m) => m.network === network);
    const next = MODES[(at + step + MODES.length) % MODES.length];
    if (!next) return;
    pick(next.network);
    // The roving tabindex moved with the selection; focus has to follow it.
    requestAnimationFrame(() => {
      group.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    });
  }

  return (
    <div className="wallet-mode">
      <div
        ref={group}
        className="mode-switch"
        role="radiogroup"
        aria-label="Modo de pago"
        onKeyDown={onKeyDown}
        data-testid="mode-switch"
      >
        {MODES.map((mode) => {
          const checked = mode.network === network;
          const closed = !open(mode.network);
          return (
            <button
              key={mode.network}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-disabled={closed || undefined}
              // Roving tabindex: one stop for the group, not one per option.
              tabIndex={checked ? 0 : -1}
              className="mode-option"
              data-mode={mode.network}
              data-testid={`mode-${mode.network}`}
              title={closed ? (lockedReason ?? undefined) : undefined}
              onClick={() => pick(mode.network)}
              // The two spans are one label at two widths, and CSS hides one
              // of them — which would leave the button nameless if the name
              // came from its contents.
              aria-label={mode.label}
            >
              <span className="mode-long" aria-hidden="true">
                {mode.label}
              </span>
              <span className="mode-short" aria-hidden="true">
                {mode.short}
              </span>
            </button>
          );
        })}
      </div>
      {bumped && lockedReason ? (
        <p className="mode-locked" role="status">
          {lockedReason}
        </p>
      ) : null}
    </div>
  );
}
