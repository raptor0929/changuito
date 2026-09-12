import type { VtexOrderForm } from '../adapters/orderform.js';

/**
 * Making a recorded orderForm safe to keep.
 *
 * A fixture is a description of a screen, not a copy of somebody's identity,
 * and fixtures end up in a repository. This runs over every orderForm before
 * it reaches disk.
 *
 * It lives in its own module so it can be unit-tested: `record.ts` is a script
 * that opens a browser the moment it is imported, and a security-relevant
 * function must be testable without one.
 */

/**
 * Replaces personal values with same-shaped placeholders. Shape is kept because
 * the classifier reasons about presence and length ("is there a street?"), and
 * a fixture whose address is `null` would test the wrong thing.
 */
export function scrubOrderForm(of: VtexOrderForm | undefined): VtexOrderForm | undefined {
  if (!of) return undefined;
  const clone = JSON.parse(JSON.stringify(of)) as Record<string, unknown>;

  const profile = clone.clientProfileData as Record<string, unknown> | null | undefined;
  if (profile) {
    if (profile.email) profile.email = 'shopper@example.test';
    if (profile.firstName) profile.firstName = 'Nombre';
    if (profile.lastName) profile.lastName = 'Apellido';
    if (profile.document) profile.document = '00000000';
    if (profile.phone) profile.phone = '+540000000000';
    if (profile.corporateName) profile.corporateName = 'Empresa';
    delete profile.profileCompleteOnLoading;
  }

  const shipping = clone.shippingData as Record<string, unknown> | null | undefined;
  const scrubAddress = (a: Record<string, unknown> | null | undefined): void => {
    if (!a) return;
    if (a.street) a.street = 'Calle Ejemplo';
    if (a.number) a.number = '1234';
    if (a.complement) a.complement = 'Piso 1';
    if (a.reference) a.reference = 'Referencia';
    if (a.receiverName) a.receiverName = 'Nombre Apellido';
    if (a.addressId) a.addressId = 'addr-placeholder';
    if (a.geoCoordinates) a.geoCoordinates = [];
  };
  if (shipping) {
    scrubAddress(shipping.address as Record<string, unknown> | null);
    for (const a of (shipping.availableAddresses as Array<Record<string, unknown>> | undefined) ?? []) {
      scrubAddress(a);
    }
  }

  // Card data cannot be in an orderForm we recorded (we never type one here),
  // but paymentData carries tokens and bins, and none of that belongs on disk.
  if (clone.paymentData) {
    const pd = clone.paymentData as Record<string, unknown>;
    pd.availableAccounts = [];
    pd.availableTokens = [];
  }
  delete clone.orderFormId;

  return clone as VtexOrderForm;
}

