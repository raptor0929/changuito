import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STARTERS } from '../agent/prompt.ts';
import { EARLY_LOCATION_ASK, earlyLocationAsk, mentionsPostalCode } from '../agent/early-ask.ts';

const first = (text: string) => earlyLocationAsk({ hasLocation: false, firstMessage: true, text });

describe('mentionsPostalCode', () => {
  it('sees the ways people type a postal code', () => {
    for (const t of ['1414', 'CP 1414, Día', 'cp1414', 'estoy en 1414 palermo', 'C1414ABC', 'mi cpa es c1414abc']) {
      assert.equal(mentionsPostalCode(t), true, t);
    }
  });

  it('does not mistake prices and quantities for one', () => {
    for (const t of ['por menos de $10.000', 'con $10000', 'leche de 1 litro', '12 huevos', 'arroz 500g']) {
      assert.equal(mentionsPostalCode(t), false, t);
    }
  });
});

describe('earlyLocationAsk', () => {
  it('answers every starter chip at once, since none of them names a postal code', () => {
    // The QA path: a guest taps a starter and waited 40s for this question.
    for (const s of STARTERS) assert.equal(first(s), EARLY_LOCATION_ASK, s);
  });

  it('leaves a first message with a postal code to the model', () => {
    assert.equal(first('Compará leche en Día, CP 1414'), null);
  });

  it('only ever answers the first message', () => {
    // "no sé" after the question deserves a model that can help, not the same
    // question again.
    assert.equal(earlyLocationAsk({ hasLocation: false, firstMessage: false, text: 'no sé' }), null);
  });

  it('stays out of the way once the store is known', () => {
    assert.equal(earlyLocationAsk({ hasLocation: true, firstMessage: true, text: 'leche' }), null);
  });

  it('asks in voseo and names the stores the server can search', () => {
    assert.match(EARLY_LOCATION_ASK, /código postal/);
    assert.match(EARLY_LOCATION_ASK, /tenés|querés/);
    for (const store of ['Día', 'Jumbo', 'Disco', 'Carrefour']) assert.ok(EARLY_LOCATION_ASK.includes(store), store);
  });
});
