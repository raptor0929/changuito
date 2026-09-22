/**
 * Marketing copy and the only product handoff.
 *
 * The landing may link to the app and nowhere else. Paths, query strings and
 * tokens do not belong on that URL — the app origin is the whole destination.
 */

export const APP_URL = 'https://app.changuito.me';
export const SITE_URL = 'https://www.changuito.me';

export const HERO = {
  h1Lead: 'Pedí el súper',
  h1Rest: 'inteligente',
  sub: 'Changuito compara productos, arma el carrito y te deja listo para pagar.',
  pay: 'Pagá con tarjeta o USDC.',
  cta: 'Probar Changuito',
  secondary: 'Ver cómo funciona',
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
    title: 'Real',
    body: 'Precios reales de supermercado.',
  },
  {
    title: 'Local',
    body: 'Hecho para cómo se compra acá: pan, verdes, mate y todo el súper.',
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
  copyright: '© 2026 Changuito',
  siteLabel: 'www.changuito.me',
  appLabel: 'app.changuito.me',
} as const;

export const DESCRIPTION =
  'Changuito compara productos, arma el carrito y te deja listo para pagar. Pagá con tarjeta o USDC.';
