import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { applyEvent, initialState, resetIds, sendUser, type ChatState } from '../chat-state.ts';
import type { UiEvent } from '../protocol.ts';
import { pendingTool, progressCopy, SLOW_MS, VERY_SLOW_MS } from '../turn-progress.ts';

const run = (events: UiEvent[], from: ChatState = sendUser(initialState, 'leche 1414 día')) =>
  events.reduce(applyEvent, from);

beforeEach(resetIds);

describe('progressCopy stage', () => {
  it('says the message is on its way until the server acknowledges it', () => {
    assert.equal(progressCopy(run([]), 0).stage, 'Enviando tu mensaje…');
  });

  it('follows the server through received and the first hop', () => {
    assert.equal(progressCopy(run([{ t: 'status', stage: 'received' }]), 0).stage, 'Recibido. Preparando la búsqueda…');
    assert.equal(progressCopy(run([{ t: 'status', stage: 'thinking', hop: 0 }]), 0).stage, 'Pensando qué buscar…');
  });

  it('describes later hops as reading results, not reading the question', () => {
    assert.equal(progressCopy(run([{ t: 'status', stage: 'thinking', hop: 3 }]), 0).stage, 'Revisando lo que encontré…');
  });

  it('names the tool that is still running, in the trail’s own words', () => {
    const s = run([
      { t: 'status', stage: 'thinking', hop: 0 },
      { t: 'tool_start', id: 't1', name: 'search_products' },
    ]);
    assert.equal(pendingTool(s), 'search_products');
    assert.equal(progressCopy(s, 0).stage, 'Buscando productos…');
  });

  it('stops naming a tool once it reported back', () => {
    const s = run([
      { t: 'tool_start', id: 't1', name: 'search_products' },
      { t: 'tool_end', id: 't1', ok: true, ms: 900 },
      { t: 'status', stage: 'thinking', hop: 1 },
    ]);
    assert.equal(pendingTool(s), undefined);
    assert.equal(progressCopy(s, 0).stage, 'Revisando lo que encontré…');
  });

  it('never reports a tool from an earlier turn', () => {
    // A tool that never got its tool_end, left in the transcript by a turn
    // that was stopped. It is history, not something running now.
    const old = run([{ t: 'tool_start', id: 't1', name: 'search_products' }]);
    const next = sendUser({ ...old, streaming: false }, 'otra cosa');
    assert.equal(pendingTool(next), undefined);
  });

  it('says it is writing once reply text arrives', () => {
    const s = run([{ t: 'status', stage: 'thinking', hop: 0 }, { t: 'text', delta: 'Te' }]);
    assert.equal(progressCopy(s, 0).stage, 'Escribiendo la respuesta…');
  });

  it('owns up to a fallback without naming models', () => {
    const copy = progressCopy(run([{ t: 'status', stage: 'fallback', hop: 0 }]), 0).stage;
    assert.equal(copy, 'Probando por otro camino para no hacerte esperar…');
    assert.doesNotMatch(copy, /modelo|ollama|claude|sonnet/i);
  });
});

describe('progressCopy hint and clock', () => {
  const s = run([{ t: 'status', stage: 'thinking', hop: 0 }]);

  it('counts whole seconds and never goes negative', () => {
    assert.equal(progressCopy(s, 12_999).seconds, 12);
    assert.equal(progressCopy(s, -50).seconds, 0);
  });

  it('explains the wait only once it is long enough to need explaining', () => {
    assert.match(progressCopy(s, SLOW_MS - 1).hint, /Parar/);
    assert.match(progressCopy(s, SLOW_MS).hint, /supermercados/);
    assert.match(progressCopy(s, VERY_SLOW_MS).hint, /más que de costumbre/);
  });

  it('speaks voseo', () => {
    for (const ms of [0, SLOW_MS, VERY_SLOW_MS]) {
      assert.doesNotMatch(progressCopy(s, ms).hint, /\b(puedes|toca|espera)\b/i);
    }
  });
});
