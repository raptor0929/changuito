'use client';

import Script from 'next/script';
import { useEffect, useRef } from 'react';

import { ANALYTICS_IDS, analyticsConfigured, flushAnalytics, track } from '../lib/analytics';

/**
 * Loads GA4, Meta Pixel and Clarity only when a public id is set.
 * `session_start` fires once after the snippets that are configured
 * have defined their functions. PageView is the vendors' own hit.
 * CompleteRegistration is not sent from the shopper.
 */
export function Analytics() {
  const started = useRef(false);
  const ids = ANALYTICS_IDS;

  useEffect(() => {
    if (!analyticsConfigured(ids) || started.current) return;
    started.current = true;
    track('session_start');
    flushAnalytics();
  }, [ids]);

  if (!analyticsConfigured(ids)) return null;

  const ready = () => {
    flushAnalytics();
  };

  return (
    <>
      {ids.ga ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${ids.ga}`}
            strategy="afterInteractive"
          />
          <Script id="chg-ga4" strategy="afterInteractive" onLoad={ready}>
            {`window.dataLayer=window.dataLayer||[];
function gtag(){dataLayer.push(arguments);}
window.gtag=gtag;
gtag('js', new Date());
gtag('config', '${ids.ga}', { anonymize_ip: true });`}
          </Script>
        </>
      ) : null}
      {ids.meta ? (
        <>
          <Script id="chg-meta-pixel" strategy="afterInteractive" onLoad={ready}>
            {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${ids.meta}');
fbq('track','PageView');`}
          </Script>
          <noscript>
            <img
              alt=""
              height={1}
              width={1}
              style={{ display: 'none' }}
              src={`https://www.facebook.com/tr?id=${ids.meta}&ev=PageView&noscript=1`}
            />
          </noscript>
        </>
      ) : null}
      {ids.clarity ? (
        <Script id="chg-clarity" strategy="afterInteractive" onLoad={ready}>
          {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window,document,"clarity","script","${ids.clarity}");`}
        </Script>
      ) : null}
    </>
  );
}
