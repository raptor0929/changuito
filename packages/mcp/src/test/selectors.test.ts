import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseConfirmation } from '../checkout/dia.js';
import { emptyPageState } from '../checkout/pagestate.js';
import {
  ADDRESS_FIELDS,
  BUTTONS,
  CARD_FIELDS,
  CREDIT_CARD_OPTION,
  looksLikeCardForm,
  matchesButton,
  matchesField,
  missingFields,
  OTP_FIELD,
} from '../checkout/selectors.js';

const field = (label: string, type = 'text') => ({ label, type, required: false, filled: false });

/** The Día payment step, as the extractor sees it. */
const CARD_PAGE = emptyPageState({
  url: 'https://diaonline.supermercadosdia.com.ar/checkout/#/payment',
  fields: [
    field('Número de tarjeta'),
    field('Nombre como figura en la tarjeta'),
    field('Vencimiento (MM/AA)'),
    field('Código de seguridad'),
    field('DNI del titular'),
    field('Cuotas', 'select'),
  ],
  buttons: ['Tarjeta de crédito', 'Tarjeta de débito', 'Finalizar compra'],
});

const ADDRESS_PAGE = emptyPageState({
  fields: [
    field('Código postal'),
    field('Calle'),
    field('Número'),
    field('Piso / Depto'),
    field('Teléfono'),
  ],
  buttons: ['Continuar'],
});

describe('address selectors', () => {
  it('finds every required address field on the shipping form', () => {
    assert.deepEqual(missingFields(ADDRESS_FIELDS, ADDRESS_PAGE), []);
  });

  it('does not mistake the street field for the house number', () => {
    const ps = emptyPageState({ fields: [field('Dirección: número')] });
    assert.equal(matchesField(ADDRESS_FIELDS.street!, ps), false, "'número' excludes it");
    assert.equal(matchesField(ADDRESS_FIELDS.number!, ps), true);
  });

  it('does not mistake a phone or document field for the house number', () => {
    for (const label of ['Número de teléfono', 'Número de documento']) {
      const ps = emptyPageState({ fields: [field(label)] });
      assert.equal(matchesField(ADDRESS_FIELDS.number!, ps), false, label);
    }
  });

  it('reports which required field is missing rather than failing silently', () => {
    const ps = emptyPageState({ fields: [field('Código postal')] });
    assert.deepEqual(missingFields(ADDRESS_FIELDS, ps).sort(), ['number', 'street']);
  });
});

describe('card selectors', () => {
  it('finds every required card field on the Día payment form', () => {
    assert.deepEqual(missingFields(CARD_FIELDS, CARD_PAGE), []);
    assert.equal(looksLikeCardForm(CARD_PAGE), true);
  });

  it('accepts the split month/year shape as well as the combined box', () => {
    const split = emptyPageState({
      fields: [field('Número de tarjeta'), field('Mes', 'select'), field('Año', 'select'), field('CVV')],
    });
    assert.equal(looksLikeCardForm(split), true);
  });

  it('does not think a cart page is a card form', () => {
    const cart = emptyPageState({ fields: [field('Código postal')], buttons: ['Finalizar compra'] });
    assert.equal(looksLikeCardForm(cart), false);
  });

  it('never mistakes the postal code for the security code', () => {
    const ps = emptyPageState({ fields: [field('Código postal')] });
    assert.equal(matchesField(CARD_FIELDS.cvv!, ps), false);
  });
});

describe('the payment-method choice', () => {
  it('picks "tarjeta de crédito"', () => {
    assert.equal(matchesButton(CREDIT_CARD_OPTION, CARD_PAGE), 'Tarjeta de crédito');
  });

  it('REFUSES débito and the local wallets — a prepaid BIN fails those', () => {
    for (const label of ['Tarjeta de débito', 'Efectivo', 'Transferencia', 'Mercado Pago', 'Cuenta DNI']) {
      const ps = emptyPageState({ buttons: [label] });
      assert.equal(matchesButton(CREDIT_CARD_OPTION, ps), undefined, label);
    }
  });
});

describe('buttons', () => {
  it('goes to checkout without ever pressing an add-to-cart button', () => {
    const ps = emptyPageState({ buttons: ['Agregar más productos', 'Finalizar compra'] });
    assert.equal(matchesButton(BUTTONS.goToCheckout!, ps), 'Finalizar compra');
  });

  it('the pay button never resolves to cancel or back', () => {
    const ps = emptyPageState({ buttons: ['Cancelar pago', 'Volver'] });
    assert.equal(matchesButton(BUTTONS.pay!, ps), undefined);
  });

  it('the OTP submit never resolves to "reenviar código"', () => {
    const ps = emptyPageState({ buttons: ['Reenviar código'] });
    assert.equal(matchesButton(BUTTONS.submitOtp!, ps), undefined, 'that would restart the 3-minute race');
  });

  it('finds an OTP field but not the card security code', () => {
    assert.equal(matchesField(OTP_FIELD, emptyPageState({ fields: [field('Código de verificación')] })), true);
    assert.equal(matchesField(OTP_FIELD, emptyPageState({ fields: [field('Código postal')] })), false);
  });
});

describe('parseConfirmation', () => {
  const host = 'diaonline.supermercadosdia.com.ar';

  it('prefers the orderGroup from the document', () => {
    const ps = emptyPageState({ url: `https://${host}/checkout/orderPlaced/?og=WRONG` });
    const c = parseConfirmation(host, ps, 'RIGHT-1');
    assert.equal(c.orderGroup, 'RIGHT-1');
    assert.match(c.statusUrl!, /og=RIGHT-1$/);
  });

  it('falls back to the URL when the SPA has moved on', () => {
    const ps = emptyPageState({ url: `https://${host}/checkout/orderPlaced/?og=OG-77` });
    assert.equal(parseConfirmation(host, ps).orderGroup, 'OG-77');
  });

  it('reads an order number out of the confirmation heading', () => {
    const ps = emptyPageState({ headings: ['¡Gracias! Tu pedido 1503291234-01 está confirmado'] });
    assert.equal(parseConfirmation(host, ps, 'OG-9').orderNumber, '1503291234-01');
  });

  it('returns no status link when there is nothing to link to', () => {
    assert.equal(parseConfirmation(host, emptyPageState()).statusUrl, undefined);
  });
});
