import { VtexAdapter, type VtexStoreConfig } from './vtex.js';
import type { RetailerAdapter } from './types.js';

/**
 * All four of these are VTEX IO storefronts, so they share one adapter and
 * differ only by config. salesChannel is deliberately NOT set: the adapter
 * discovers it per store at runtime (Cencosud = 32, the others = 1), which
 * keeps this table correct even if a store changes it.
 */
const VTEX_STORES: VtexStoreConfig[] = [
  { id: 'jumbo',     displayName: 'Jumbo',     host: 'www.jumbo.com.ar',                   locale: 'es-AR' },
  { id: 'disco',     displayName: 'Disco',     host: 'www.disco.com.ar',                   locale: 'es-AR' },
  { id: 'carrefour', displayName: 'Carrefour', host: 'www.carrefour.com.ar',               locale: 'es-AR' },
  { id: 'dia',       displayName: 'Día',       host: 'diaonline.supermercadosdia.com.ar',  locale: 'es-AR' },
];

const adapters = new Map<string, RetailerAdapter>(
  VTEX_STORES.map((c) => [c.id, new VtexAdapter(c)]),
);

export const RETAILER_IDS = [...adapters.keys()] as const;

/** Coto is researched but not implemented — different stack entirely. See research/03-coto-api.md */
export const UNSUPPORTED: Record<string, string> = {
  coto:
    'Coto is not on VTEX. Its search runs on Constructor.io and its cart on Oracle ATG ' +
    '(/rest/model/atg/actors/cCarritoActor/...), which is undocumented. Search is understood ' +
    'and reproducible (see probes/04_coto.sh); the cart is not implemented yet.',
};

export function getAdapter(id: string): RetailerAdapter {
  const a = adapters.get(id);
  if (a) return a;
  const why = UNSUPPORTED[id];
  throw new Error(
    why
      ? `Retailer "${id}" is not supported yet. ${why}`
      : `Unknown retailer "${id}". Supported: ${RETAILER_IDS.join(', ')}.`,
  );
}

export function listRetailers() {
  return VTEX_STORES.map((s) => ({ id: s.id, name: s.displayName, host: s.host }));
}
