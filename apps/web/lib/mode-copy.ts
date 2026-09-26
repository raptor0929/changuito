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
  /** The mode's name, read by a screen reader off the badge. */
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

/**
 * Both, safe one first. There is no toggle to order them for any more — see
 * ModeBadge — but the copy tests iterate this to check every mode's wording,
 * and that is worth more than the array's original caller.
 */
export const MODES: readonly ModeCopy[] = [PRUEBA, REAL];

/**
 * The masthead, for a visitor with no session — which is to say, preview.
 *
 * This replaces "Empezá a comprar", which was written when a signed-out
 * visitor could not do anything and had to sign in first. They can do
 * everything now: search, fill a basket, and watch a payment settle, on our
 * money. So the button is no longer an invitation to start, it is the door
 * out of the demo, and it has to say what is on the other side of it.
 *
 * It says "modo real" and not "iniciá sesión" because signing in is the
 * mechanism, not the consequence. The consequence is that the next payment
 * comes out of their own pocket, and a person who clicks a login button has
 * not agreed to that — they have agreed to log in.
 */
export const PREVIEW_MASTHEAD = {
  /** Sits under the badge, where the balance is in the other mode. */
  hint: 'Probá todo el pago con nuestra plata.',
  /** The crossing. */
  action: 'Cambiar a modo real',
} as const;

/**
 * When the number beside the balance cannot be read.
 *
 * Its own string because it used to be whatever the failure happened to say.
 * `useBalances` parsed the response body before checking the status, so a
 * gateway that answered with an HTML error page produced a SyntaxError, and
 * the hook painted its text — `Unexpected token '<', "<!DOCTYPE "…` — in red
 * beside the balance. A server message is written for whoever reads the log,
 * and it is in English, and it names machinery; none of that belongs on a
 * shopper's screen, whatever went wrong.
 *
 * So there is exactly one thing this says, and it is the only thing the
 * shopper can act on: we could not read it, and looking again is free. The
 * number itself already renders as `-` when there is nothing to show, so this
 * line is the explanation and not the absence.
 */
export const BALANCE = {
  unavailable: 'No pudimos leer tu saldo ahora. Probá de nuevo en un rato.',
} as const;

/**
 * The one-time step before the first real payment.
 *
 * Nobody asked for this and nobody will understand why it exists, so the copy
 * does not try to explain the ledger — it says what it costs (nothing), how
 * often it happens (once) and what happens if they would rather not (modo
 * prueba is still there). "Habilitar los dólares" rather than anything truer,
 * because the true word is on the forbidden list and the effect really is
 * that dollars can now reach the account.
 *
 * The way out used to be "seguir en modo prueba". It is not, any more: the
 * mode is the session (lib/app-mode.ts), so offering preview to somebody who
 * is signed in would mean signing them out to keep the promise. The way out
 * is now simply back to the basket, which is where they were.
 */
export const TRUSTLINE = {
  title: 'Falta un paso, una sola vez',
  body: 'Para poder recibir dólares en tu cuenta hay que habilitarlos. Es gratis, tarda unos segundos y no se vuelve a pedir.',
  action: 'Habilitar los dólares',
  working: 'Habilitando…',
  /** Shown when the signature was refused or the network said no. */
  failed: 'No se pudo habilitar. Podés volver a intentar, o dejarlo para después.',
  /** The way out, so a refusal is not a dead end. */
  back: 'Volver al carrito',
} as const;
