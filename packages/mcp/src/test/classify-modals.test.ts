import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MODALS, actionFor, classifyModal, modalById } from '../checkout/classify/modals.js';
import { emptyPageState, findButton, hasField, hasText, signature, summarize } from '../checkout/pagestate.js';

const ps = emptyPageState;

describe('the screens we expect Día to show', () => {
  it('recognises a cookie banner and knows which button accepts it', () => {
    const p = ps({
      dialogText: ['Usamos cookies para mejorar tu experiencia'],
      buttons: ['Aceptar todas', 'Configurar'],
    });
    const v = classifyModal(p);
    assert.equal(v?.modalId, 'cookie_banner');
    assert.equal(v?.state, 'interstitial');
    assert.equal(actionFor(modalById('cookie_banner')!, p), 'Aceptar todas');
  });

  it('recognises the address-confirmation dialog', () => {
    const p = ps({
      headings: ['¿Es esta tu dirección de entrega?'],
      buttons: ['Confirmar dirección', 'Editar'],
    });
    const v = classifyModal(p);
    assert.equal(v?.modalId, 'address_confirm');
    assert.equal(actionFor(modalById('address_confirm')!, p), 'Confirmar dirección');
  });

  it('recognises the delivery-slot picker', () => {
    const v = classifyModal(ps({ headings: ['Elegí el día y horario de entrega'], buttons: ['Continuar'] }));
    assert.equal(v?.state, 'shipping_slot');
  });

  it('recognises a 3DS challenge by its heading', () => {
    const v = classifyModal(ps({ headings: ['Ingresá el código de verificación'], fields: [{ label: 'Código', type: 'text', required: true, filled: false }] }));
    assert.equal(v?.state, 'threeds');
  });

  it('recognises a 3DS challenge by the field alone, for a bare bank page', () => {
    const v = classifyModal(ps({ fields: [{ label: 'OTP', type: 'tel', required: true, filled: false }] }));
    assert.equal(v?.state, 'threeds');
  });

  it('recognises a decline', () => {
    const v = classifyModal(ps({ errors: ['Tu tarjeta fue rechazada por el banco'] }));
    assert.equal(v?.state, 'declined');
  });

  it('recognises the order-placed screen', () => {
    const v = classifyModal(ps({ headings: ['¡Gracias por tu compra!'], title: 'Pedido confirmado' }));
    assert.equal(v?.state, 'confirmation');
  });

  it('recognises a mid-checkout stock change', () => {
    const v = classifyModal(ps({ errors: ['Leche Descremada 1L quedó sin stock'] }));
    assert.equal(v?.state, 'cart_changed');
  });

  it('recognises being signed out', () => {
    const v = classifyModal(ps({ headings: ['Tu sesión ha expirado'], buttons: ['Iniciar sesión'] }));
    assert.equal(v?.state, 'session_expired');
  });

  it('treats a password field anywhere in checkout as being signed out', () => {
    const v = classifyModal(ps({ fields: [{ label: 'Contraseña', type: 'password', required: true, filled: false }] }));
    assert.equal(v?.state, 'session_expired');
  });
});

describe('upsells', () => {
  const upsell = ps({
    dialogText: ['¿Te puede interesar? Sumale estos productos a tu compra'],
    buttons: ['Agregar al carrito', 'No, gracias'],
  });

  it('is classified as a dismissible interstitial', () => {
    assert.equal(classifyModal(upsell)?.modalId, 'upsell');
  });

  it('picks the dismiss button and NOT the one that spends money', () => {
    assert.equal(actionFor(modalById('upsell')!, upsell), 'No, gracias');
  });

  it('needs an actual dialog — the words alone are not enough', () => {
    // "Te puede interesar" is a section heading on every product page.
    const notAModal = ps({ headings: ['Te puede interesar'], buttons: ['Agregar'] });
    assert.equal(classifyModal(notAModal)?.modalId, undefined);
  });
});

describe('precedence between overlapping screens', () => {
  it('a confirmation beats everything, including a leftover cookie banner', () => {
    const v = classifyModal(ps({
      headings: ['¡Gracias por tu compra!'],
      dialogText: ['Usamos cookies'],
      buttons: ['Aceptar'],
    }));
    assert.equal(v?.state, 'confirmation');
  });

  it('a decline beats a 3DS prompt still on the page behind it', () => {
    const v = classifyModal(ps({
      headings: ['Código de verificación'],
      errors: ['El pago fue rechazado'],
    }));
    assert.equal(v?.state, 'declined');
  });

  it('being signed out beats a slot picker', () => {
    const v = classifyModal(ps({
      headings: ['Elegí el día y horario', 'Tu sesión ha expirado'],
    }));
    assert.equal(v?.state, 'session_expired');
  });

  it('an out-of-stock notice beats an address confirmation', () => {
    const v = classifyModal(ps({
      headings: ['Confirmá tu dirección'],
      errors: ['Un producto quedó sin stock'],
    }));
    assert.equal(v?.state, 'cart_changed');
  });
});

describe('the registry as a whole', () => {
  it('says nothing about an ordinary product page', () => {
    assert.equal(classifyModal(ps({ title: 'Leche Descremada 1L', buttons: ['Agregar'] })), undefined);
  });

  it('says nothing about a blank page', () => {
    assert.equal(classifyModal(ps()), undefined);
  });

  it('has unique ids and sane priorities', () => {
    const ids = MODALS.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const m of MODALS) {
      assert.ok(m.priority > 0 && m.priority <= 100, m.id);
      assert.equal(typeof m.why, 'string');
    }
  });

  it('survives an entry whose matcher throws', () => {
    const original = MODALS[0].match;
    MODALS[0].match = () => { throw new Error('bad regex'); };
    try {
      assert.doesNotThrow(() => classifyModal(ps({ headings: ['¡Gracias por tu compra!'] })));
      assert.equal(classifyModal(ps({ headings: ['¡Gracias por tu compra!'] }))?.state, 'confirmation');
    } finally {
      MODALS[0].match = original;
    }
  });

  it('returns no action for a screen that has no button we recognise', () => {
    assert.equal(actionFor(modalById('cookie_banner')!, ps({ buttons: ['Qué?'] })), undefined);
  });

  it('returns no action for states that are not dismissible', () => {
    assert.equal(modalById('declined')!.action, undefined);
    assert.equal(modalById('threeds')!.action, undefined);
  });
});

describe('pagestate helpers', () => {
  it('searches across every text surface', () => {
    assert.equal(hasText(ps({ errors: ['algo salió mal'] }), /salió mal/), true);
    assert.equal(hasText(ps({ fields: [{ label: 'CP', type: 'text', required: false, filled: false }] }), /CP/), true);
    assert.equal(hasField(ps({ fields: [{ label: 'Número', type: 'text', required: false, filled: false }] }), /n[uú]mero/i), true);
  });

  it('finds a button by pattern', () => {
    assert.equal(findButton(ps({ buttons: ['Ir a pagar'] }), /pagar/i), 'Ir a pagar');
  });

  it('signature changes when the page changes', () => {
    const a = ps({ url: 'https://x/#/shipping', buttons: ['Continuar'] });
    const b = ps({ url: 'https://x/#/payment', buttons: ['Continuar'] });
    assert.notEqual(signature(a), signature(b));
    assert.equal(signature(a), signature({ ...a }));
  });

  it('signature ignores tiny text jitter, so a countdown is not progress', () => {
    const a = ps({ textLength: 5000 });
    const b = ps({ textLength: 5050 });
    assert.equal(signature(a), signature(b));
    assert.notEqual(signature(a), signature(ps({ textLength: 9000 })));
  });

  it('signature notices a field becoming filled', () => {
    const empty = ps({ fields: [{ label: 'Código', type: 'text', required: true, filled: false }] });
    const filled = ps({ fields: [{ label: 'Código', type: 'text', required: true, filled: true }] });
    assert.notEqual(signature(empty), signature(filled));
  });

  it('summarize is readable and mentions what the page asks for', () => {
    const text = summarize(ps({
      url: 'https://dia/checkout/#/payment',
      headings: ['Pagá tu compra'],
      fields: [{ label: 'Número de tarjeta', type: 'text', required: true, filled: false }],
      buttons: ['Pagar'],
      amounts: ['$ 6.180,00'],
    }));
    assert.match(text, /Asks for: Número de tarjeta/);
    assert.match(text, /Amounts: \$ 6\.180,00/);
  });
});
