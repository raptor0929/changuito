import { DEFAULT_NETWORK, type NetworkId } from './deployments.ts';

/**
 * What the app calls each mode, everywhere a number or a button appears.
 *
 * Two reasons this is a module and not a handful of ternaries in JSX.
 *
 * The first is a bug it fixes. Every "no es plata real" string the app had
 * lived in faucet-copy.ts and faucet-policy.ts — surfaces a visitor only
 * reaches if they are on the faucet allowlist. Everybody else saw a test
 * balance labelled plainly "USDC", beside a button that says Pagar, with no
 * qualifier anywhere. The app was presenting play money as real money to
 * almost everyone who looked at it. Driving the qualifier off the *mode*
 * rather than off faucet access fixes that for every visitor at once.
 *
 * The second is that the chrome has to obey the same rule as the agent:
 * lib/agent/prompt.ts forbids the model from saying testnet, wallet, escrow
 * or blockchain to a user, and it would be a strange app where the model is
 * careful and the buttons are not. So the names are "modo prueba" and "modo
 * real", and a test asserts none of the forbidden words got in.
 */

export interface ModeCopy {
  network: NetworkId;
  /** The toggle's option, read by a screen reader as the state's name. */
  label: string;
  /** The same at phone width, where two full labels do not fit. */
  short: string;
  /** Sits beside the balance. The whole honesty fix is this string. */
  balanceUnit: string;
  /** One line under the balance, explaining what the number is. */
  hint: string;
  /** The confirm button in the payment modal. */
  payLabel: (amount: string) => string;
  /** Prefixed to the note above that button. */
  payNote: string;
  /** What the order panel says while the money is held. */
  holdNote: string;
}

const PRUEBA: ModeCopy = {
  network: 'testnet',
  label: 'Modo prueba',
  short: 'Prueba',
  balanceUnit: 'USDC de prueba',
  hint: 'No es plata real: podés probar todo el pago sin gastar nada.',
  payLabel: (amount) => `Probar el pago de ${amount}`,
  payNote: 'Esto es una prueba: no se mueve plata real.',
  holdNote: 'Es una prueba, así que no se reservó plata real.',
};

const REAL: ModeCopy = {
  network: 'mainnet',
  label: 'Modo real',
  short: 'Real',
  balanceUnit: 'USDC',
  hint: 'Es plata real. Revisá el monto antes de confirmar.',
  payLabel: (amount) => `Pagar ${amount} USDC`,
  payNote: '',
  holdNote: '',
};

const COPY: Record<NetworkId, ModeCopy> = { testnet: PRUEBA, mainnet: REAL };

export function modeCopy(net: NetworkId = DEFAULT_NETWORK): ModeCopy {
  return COPY[net];
}

/** Both, in the order the toggle shows them: the safe one first. */
export const MODES: readonly ModeCopy[] = [PRUEBA, REAL];

/**
 * Why the real option will not take a click. Two different reasons, because
 * "not for you" and "not yet for anyone" are different facts, and a control
 * that is dead for two reasons and says one thing is a control people ask
 * about instead of using.
 */
export type ModeLock = 'not-allowed' | 'not-ready';

export function modeLockedReason(why: ModeLock): string {
  if (why === 'not-ready') return 'El modo real todavía no está disponible.';
  return 'Tu cuenta no tiene habilitado el modo real.';
}
