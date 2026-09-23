/**
 * Marketing copy.
 *
 * APP_URL is the shopper origin. It stays for SEO and docs.
 * During the controlled beta, visitor CTAs go to /whitelist on this site
 * and must not navigate to APP_URL.
 */

export const APP_URL = 'https://app.changuito.me';
export const SITE_URL = 'https://www.changuito.me';

export const HERO = {
  h1Lead: 'Pedí el súper',
  h1Rest: 'inteligente',
  sub: 'Changuito compara productos, arma el carrito y te deja listo para pagar.',
  pay: 'Pagá con tarjeta o USDC.',
  cta: 'Probar Changuito',
} as const;

export const NAV = [
  { href: '#como-funciona', label: 'Cómo funciona' },
  { href: '#pagos', label: 'Pagos' },
  { href: '#faq', label: 'Ayuda' },
] as const;

export const STEPS_TITLE = 'Así de simple';

export const STEPS = [
  {
    icon: 'ask',
    title: 'Pedile lo que necesitás',
    body: 'En lenguaje natural: la lista, una receta o lo de la juntada. Changuito busca y calcula con IA.',
  },
  {
    icon: 'compare',
    title: 'Compará precios reales',
    body: 'Changuito mira el súper y te muestra precios de verdad.',
  },
  {
    icon: 'confirm',
    title: 'Confirmá el carrito',
    body: 'Revisás lo que armó antes de seguir.',
  },
  {
    icon: 'pay',
    title: 'Pagá con tarjeta o USDC',
    body: 'Quedás listo para pagar con tarjeta o USDC.',
  },
] as const;

export const BENEFITS_TITLE = 'El súper, más simple';

export const BENEFITS = [
  {
    title: 'Simple',
    body: 'Armá el súper sin pensar. Changuito empuja el carrito con vos.',
  },
  {
    title: 'Sin pensar mucho',
    body: 'Contale para qué ocasión preparás la comida y para cuántas personas, y Changuito se encarga de cada detalle por vos.',
  },
  {
    title: 'Local',
    body: 'Changuito te ayuda a ahorrar comparando precios entre varios supermercados y armándote el carrito como más te convenga.',
  },
] as const;

/** Yellow callout and one FAQ answer. Do not repeat this sentence anywhere else. */
export const NO_CHARGE = 'Si la compra no se completa, no realizás ningún pago.';

export const PAYMENTS = {
  title: 'Pagá como te quede cómodo',
  lead: 'Pagá con tarjeta o USDC.',
  methods: [
    { title: 'Tarjeta', body: 'Pagá con tarjeta.' },
    { title: 'USDC', body: 'Pagá con USDC.' },
  ],
  assurance: NO_CHARGE,
} as const;

export const FAQ_TITLE = 'Preguntas frecuentes';

export const FAQ = [
  {
    q: '¿Es una app del súper?',
    a: 'No. Es un asistente de IA para el súper: le pedís en tu idioma lo que necesitás — una receta, una juntada, la lista de la semana — y Changuito busca, calcula y te arma el carrito.',
  },
  {
    q: '¿Cómo pago?',
    a: 'Con tarjeta o USDC.',
  },
  {
    q: '¿Qué pasa si falla la compra?',
    a: NO_CHARGE,
  },
  {
    q: '¿Para quién es?',
    a: 'Para quien hace el súper en Argentina y quiere hacerlo más fácil.',
  },
] as const;

export const BOFU = {
  title: 'El súper, más simple.',
  lead: 'Changuito compara productos, arma el carrito y te deja listo para pagar.',
} as const;

export const FOOTER = {
  legal: 'Changuito te ayuda a armar el súper. No es un supermercado.',
  siteLabel: 'www.changuito.me',
} as const;

/**
 * Credit line for every footer. The year and the mark live in this
 * sentence, so a second copyright line is not rendered. Link text is
 * the visible label, so the accessible name matches the screen.
 */
export const FOUNDERS = [
  { name: 'SimonethG', href: 'https://www.linkedin.com/in/simonethg/' },
  { name: 'Fabio', href: 'https://www.linkedin.com/in/fabio-laura-yavi/' },
] as const;

export const FOUNDER_TRUST = `© 2026 Changuito® · Hecho en 🇦🇷 por ${FOUNDERS[0].name} y ${FOUNDERS[1].name}.`;

/** Public social profiles. Keep labels short; aria-labels carry the brand. */
export const SOCIAL = [
  {
    href: 'https://x.com/appchanguito',
    label: 'X',
    ariaLabel: 'Changuito en X',
    icon: 'x',
  },
  {
    href: 'https://instagram.com/appchanguito',
    label: 'Instagram',
    ariaLabel: 'Changuito en Instagram',
    icon: 'instagram',
  },
] as const;

export const DESCRIPTION =
  'Changuito compara productos, arma el carrito y te deja listo para pagar. Pagá con tarjeta o USDC.';
