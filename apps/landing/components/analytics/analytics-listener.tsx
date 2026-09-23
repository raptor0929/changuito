'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { ctaIdFrom, outboundLabel, track, trackPageView } from '../../lib/analytics.ts';

/**
 * Skips the first path: the vendor snippets already sent that page view.
 * Clicks on the primary try CTA and on the public social / founder links
 * are recorded from the document so those anchors can stay server markup.
 */
export function AnalyticsListener() {
  const pathname = usePathname();
  const skipFirstView = useRef(true);

  useEffect(() => {
    if (skipFirstView.current) {
      skipFirstView.current = false;
      return;
    }
    trackPageView(pathname);
  }, [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a');
      if (!anchor) return;
      const cta = ctaIdFrom(anchor.getAttribute('data-testid'));
      if (cta) {
        track('cta_probar_click', { cta_id: cta });
        return;
      }
      const label = outboundLabel(anchor.href);
      if (label) track('outbound_click', { label });
    };

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  return null;
}
