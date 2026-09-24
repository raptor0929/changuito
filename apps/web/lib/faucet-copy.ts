import { ENOUGH_UNITS, GRANT_UNITS } from './faucet-policy.ts';

/**
 * What the "Cargar USDC" confirmation says.
 *
 * The button used to mint on click, so two taps took an empty wallet to 100
 * USDC with nothing on screen saying that was happening. It is play money,
 * but the button sits beside a real payment flow, and an action that changes
 * a balance should say how much before it does.
 *
 * Amounts come from the policy the faucet route enforces, so the copy cannot
 * promise a grant the server will not make.
 */

const SCALE = 10_000_000n;

/** Token units as es-AR money: 500_000_000n -> "50,00". */
export function usdcAmount(units: bigint): string {
  const whole = units / SCALE;
  const cents = ((units % SCALE) * 100n) / SCALE;
  return `${whole.toLocaleString('es-AR')},${cents.toString().padStart(2, '0')}`;
}

export interface FaucetConfirmCopy {
  title: string;
  body: string;
  /** Absent when there is nothing to confirm: the wallet already has enough. */
  confirm?: string;
  dismiss: string;
}

export function faucetConfirmCopy(balanceUnits: bigint | null): FaucetConfirmCopy {
  const grant = usdcAmount(GRANT_UNITS);
  const enough = usdcAmount(ENOUGH_UNITS);

  if (balanceUnits !== null && balanceUnits >= ENOUGH_UNITS) {
    return {
      title: 'Ya tenés saldo de prueba',
      body: `Tenés ${usdcAmount(balanceUnits)} USDC de prueba, suficiente para completar una compra. La carga se habilita otra vez cuando bajás de ${enough} USDC.`,
      dismiss: 'Entendido',
    };
  }

  return {
    title: 'Cargar USDC de prueba',
    body: `Vamos a sumar ${grant} USDC de prueba a tu billetera para que pruebes el pago. No es plata real y no se puede retirar. Podés cargar de a ${grant} hasta llegar a ${enough} USDC.`,
    confirm: `Cargar ${grant} USDC`,
    dismiss: 'Cancelar',
  };
}
