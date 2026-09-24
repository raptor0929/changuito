/**
 * The Pollar login modal's copy, in either language.
 *
 * The app rewrites Pollar's hardcoded English into Spanish after render
 * (apps/web/lib/pollar-es.ts, issue #51). These runs start the moment main
 * receives a merge, which can be before Vercel serves the new build, so each
 * matcher accepts the English string or its translation. Once production
 * has been Spanish for a while, the English halves can go.
 */
export const POLLAR = {
  subtitle: /^(Log in or sign up|Ingresá o creá tu cuenta)$/,
  emailPlaceholder: /^(you|tu)@email\.com$/,
  submit: /^(Submit|Continuar)$/,
  close: /^(Close|Cerrar)$/,
  codePrompt: /6-digit code|código de 6 dígitos/i,
} as const;
