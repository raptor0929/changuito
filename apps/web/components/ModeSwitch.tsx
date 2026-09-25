'use client';

import { useRef } from 'react';

import type { NetworkId } from '../lib/deployments.ts';
import type { ModeCopy } from '../lib/mode-copy.ts';

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
 * Every option rendered here is one the caller has already decided this
 * visitor can use — see `modesFor`. There is no closed position, no
 * `aria-disabled` and no apology, because the alternative was a control that
 * was half dead for nearly everyone who saw it. With one mode left there is
 * nothing to choose, so the whole thing leaves rather than sitting in the
 * masthead as a button that cannot do anything. The balance keeps its
 * qualifier either way, which is the part that had to survive.
 */
export function ModeSwitch({
  network,
  modes,
  onChange,
}: {
  network: NetworkId;
  /** The options to offer, in order. Fewer than two renders nothing. */
  modes: readonly ModeCopy[];
  onChange: (net: NetworkId) => void;
}) {
  const group = useRef<HTMLDivElement>(null);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const at = modes.findIndex((m) => m.network === network);
    const next = modes[(at + step + modes.length) % modes.length];
    if (!next || next.network === network) return;
    onChange(next.network);
    // The roving tabindex moved with the selection; focus has to follow it.
    requestAnimationFrame(() => {
      group.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    });
  }

  if (modes.length < 2) return null;

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
        {modes.map((mode) => {
          const checked = mode.network === network;
          return (
            <button
              key={mode.network}
              type="button"
              role="radio"
              aria-checked={checked}
              // Roving tabindex: one stop for the group, not one per option.
              tabIndex={checked ? 0 : -1}
              className="mode-option"
              data-mode={mode.network}
              data-testid={`mode-${mode.network}`}
              onClick={() => {
                if (!checked) onChange(mode.network);
              }}
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
    </div>
  );
}
