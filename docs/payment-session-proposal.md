# Payment-session investigation and accepted direction

The accepted implementation is documented in [manual checkout](manual-checkout.md).
The fee is earned when the worker prepares checkout and makes the viewer available,
including when the shopper never opens it; merchant payment is a separate outcome.

The public probes on 2026-10-23 established that DIA's empty checkout rendered
inside a cross-origin iframe and loaded checkbox reCAPTCHA under the existing
sandbox allowlist. The observed `frame-ancestors` directive was report-only.
These unauthenticated probes did not establish successful card payment, authenticated
iframe session transfer, native challenge completion or bank redirects.

An iframe navigation to a DIA URL uses the shopper browser's cookies, rather than
the automation browser's session. The implemented approach embeds a viewer of the
running sandbox browser so login, basket, postcode and delivery are preserved.
The previous blanket project prohibition on native CAPTCHA support was removed.

Sources: [VTEX reCAPTCHA integration](https://developers.vtex.com/docs/guides/implementing-recaptcha-in-integrations),
[report-only CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy-Report-Only),
[noVNC](https://novnc.com/info.html).
