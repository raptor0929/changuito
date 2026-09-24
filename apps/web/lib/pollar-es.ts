/**
 * Spanish for the Pollar login modal.
 *
 * `@pollar/react` 0.11 hardcodes its copy in English and has no locale or
 * labels option, so "Log in or sign up" and "Submit" were the first words a
 * shopper read on the way to paying. This does not patch the package: it
 * rewrites exact, known strings inside Pollar's own overlay after React
 * renders them.
 *
 * Why that is safe enough to ship:
 * - Exact matches only. A string Pollar adds or rewords stays English rather
 *   than being half-translated.
 * - Scoped to `.pollar-overlay`. Nothing of ours is touched.
 * - React never reads text back. When it re-renders a node it overwrites the
 *   value, the observer sees that, and translates again; a translated value
 *   matches nothing, so it settles in one pass.
 *
 * Revisit when Pollar ships localization; this file should then be deleted.
 *
 * No imports, so it loads under `node --experimental-strip-types`.
 */

/** Keyed by the text as Pollar renders it (including its `…`), trimmed. */
export const POLLAR_TEXT_ES: Readonly<Record<string, string>> = {
  'Log in or sign up': 'Ingresá o creá tu cuenta',
  Submit: 'Continuar',
  'or continue with': 'o seguí con',
  'Create a new wallet': 'Crear una billetera nueva',
  'Log in with an existing wallet': 'Entrar con una billetera que ya tenés',
  'Loading...': 'Cargando…',
  'Could not load sign-in options. Check your connection and try again.':
    'No pudimos cargar las opciones para ingresar. Revisá tu conexión y probá de nuevo.',
  'Try again': 'Probar de nuevo',
  Cancel: 'Cancelar',
  Retry: 'Reintentar',
  'Protected by': 'Protegido por',
  'Enter the 6-digit code sent to': 'Ingresá el código de 6 dígitos que mandamos a',
  'your email': 'tu email',
  'Initializing\u2026': 'Iniciando…',
  'Sending\u2026': 'Enviando…',
  'Code sent \u2014 check your inbox': 'Te mandamos el código. Revisá tu email.',
  'Verifying\u2026': 'Verificando…',
  'Redirecting\u2026': 'Redirigiendo…',
  'Connecting wallet\u2026': 'Conectando la billetera…',
  'Confirm in your wallet\u2026': 'Confirmá en tu billetera…',
  'Wallet not installed': 'La billetera no está instalada',
  'Signing in with wallet\u2026': 'Ingresando con la billetera…',
  'Waiting for passkey\u2026': 'Esperando la llave de acceso…',
  'Creating your wallet\u2026': 'Creando tu billetera…',
  'Authenticating\u2026': 'Verificando tu cuenta…',
  'Welcome!': '¡Listo!',
  'Something went wrong. Please try again.': 'Algo salió mal. Probá de nuevo.',
};

/** Attributes that carry copy, and their translations. */
export const POLLAR_ATTR_ES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  placeholder: { 'you@email.com': 'tu@email.com' },
  'aria-label': { Close: 'Cerrar', Back: 'Volver' },
};

/** The overlay every Pollar modal renders into. */
export const POLLAR_SCOPE = '.pollar-overlay';

/**
 * The Spanish for `text`, keeping its surrounding whitespace, or null when it
 * is not a string we know. "Enter the 6-digit code sent to " ends in a space
 * that separates it from the address after it; losing that glues them.
 */
export function translatePollarText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const es = POLLAR_TEXT_ES[trimmed];
  if (es === undefined) return null;
  const start = text.indexOf(trimmed);
  return text.slice(0, start) + es + text.slice(start + trimmed.length);
}

export function translatePollarAttr(name: string, value: string): string | null {
  return POLLAR_ATTR_ES[name]?.[value] ?? null;
}

/** Translate every known string under `root`. Idempotent. */
export function translatePollarTree(root: Element): void {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const es = translatePollarText(n.nodeValue ?? '');
    if (es !== null) n.nodeValue = es;
  }
  for (const name of Object.keys(POLLAR_ATTR_ES)) {
    const hits = [root, ...Array.from(root.querySelectorAll(`[${name}]`))];
    for (const el of hits) {
      const value = el.getAttribute(name);
      if (value === null) continue;
      const es = translatePollarAttr(name, value);
      if (es !== null) el.setAttribute(name, es);
    }
  }
}
