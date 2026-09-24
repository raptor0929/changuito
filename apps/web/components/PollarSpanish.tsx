'use client';

import { useEffect } from 'react';

import { POLLAR_ATTR_ES, POLLAR_SCOPE, translatePollarTree } from '../lib/pollar-es.ts';

/**
 * Keeps Pollar's modals in Spanish. Renders nothing. See lib/pollar-es.ts for
 * why this is an observer and not a prop.
 *
 * The observer watches the whole body because the overlay mounts and unmounts
 * with the modal, but it does work only for records inside that overlay, so a
 * streaming chat reply costs one `closest()` per mutation.
 */
export function PollarSpanish() {
  useEffect(() => {
    const elementOf = (node: Node): Element | null =>
      node instanceof Element ? node : node.parentElement;

    document.querySelectorAll(POLLAR_SCOPE).forEach(translatePollarTree);

    const observer = new MutationObserver((records) => {
      const scopes = new Set<Element>();
      for (const r of records) {
        const inside = elementOf(r.target)?.closest(POLLAR_SCOPE);
        if (inside) scopes.add(inside);
        // The overlay itself arriving: it is the added node, or inside one.
        r.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          const overlay = n.closest(POLLAR_SCOPE) ?? n.querySelector(POLLAR_SCOPE);
          if (overlay) scopes.add(overlay);
        });
      }
      scopes.forEach(translatePollarTree);
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: Object.keys(POLLAR_ATTR_ES),
    });
    return () => observer.disconnect();
  }, []);

  return null;
}
