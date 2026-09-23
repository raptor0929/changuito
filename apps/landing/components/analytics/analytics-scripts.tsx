import Script from 'next/script';

import {
  clarityBootstrap,
  clarityProjectId,
  gaBootstrap,
  gaMeasurementId,
  metaBootstrap,
  metaPixelId,
} from '../../lib/analytics.ts';

/**
 * Vendor tags, one each, and only when that id is configured.
 * GA4 config sends the first page_view (query string UTMs included).
 * Meta's snippet sends the first PageView. Clarity records on its own.
 */
export function AnalyticsScripts() {
  const ga = gaMeasurementId();
  const meta = metaPixelId();
  const clarity = clarityProjectId();
  if (!ga && !meta && !clarity) return null;

  return (
    <>
      {ga ? (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${ga}`} strategy="afterInteractive" />
          <Script id="changuito-ga4" strategy="afterInteractive">
            {gaBootstrap(ga)}
          </Script>
        </>
      ) : null}
      {meta ? (
        <Script id="changuito-meta" strategy="afterInteractive">
          {metaBootstrap(meta)}
        </Script>
      ) : null}
      {clarity ? (
        <Script id="changuito-clarity" strategy="afterInteractive">
          {clarityBootstrap(clarity)}
        </Script>
      ) : null}
    </>
  );
}
