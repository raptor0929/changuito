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
 * Which modes to put in the control, given what the server answered.
 *
 * A mode nobody can use is not shown. The earlier version rendered modo real
 * always and greyed it out with a reason, which sounds more helpful and is
 * not: almost every visitor is in the greyed case, so the common experience
 * of the control was a dead half and an apology for a feature nobody had
 * asked about. Worse, the reason had to be *chosen*, and "not for you" and
 * "not yet for anyone" are answers about different subjects — which is how
 * a request still in flight ended up telling people their account was
 * refused. An option that is absent says none of that. Nothing is claimed
 * about the account, so nothing can be claimed wrongly.
 *
 * `usable` and not `allowed`: being on the list is no use while there is
 * nothing deployed to be on the list *for*.
 *
 * DEFAULT_NETWORK is always in the list, unconditionally — it is the safe
 * mode and the fallback, and a control with nothing in it is a bug in two
 * directions at once. ModeSwitch then hides itself when that is the only
 * one, because a radiogroup with a single option is a label wearing a
 * button's clothes.
 */
export function modesFor(
  access: Partial<Record<NetworkId, { usable: boolean } | null>> | null | undefined,
): readonly ModeCopy[] {
  return MODES.filter((m) => m.network === DEFAULT_NETWORK || access?.[m.network]?.usable === true);
}

/**
 * The one-time step before the first real payment.
 *
 * Nobody asked for this and nobody will understand why it exists, so the copy
 * does not try to explain the ledger — it says what it costs (nothing), how
 * often it happens (once) and what happens if they would rather not (modo
 * prueba is still there). "Habilitar los dólares" rather than anything truer,
 * because the true word is on the forbidden list and the effect really is
 * that dollars can now reach the account.
 */
export const TRUSTLINE = {
  title: 'Falta un paso, una sola vez',
  body: 'Para poder recibir dólares en tu cuenta hay que habilitarlos. Es gratis, tarda unos segundos y no se vuelve a pedir.',
  action: 'Habilitar los dólares',
  working: 'Habilitando…',
  /** Shown when the signature was refused or the network said no. */
  failed: 'No se pudo habilitar. Podés volver a intentar, o seguir en modo prueba.',
  /** The way out, so a refusal is not a dead end. */
  back: 'Seguir en modo prueba',
} as const;
