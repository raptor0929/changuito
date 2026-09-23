/**
 * Waitlist copy for failures.
 *
 * A field message names what the person has to fix. A server message never
 * does: the signup failed on our side and their data may be fine.
 */

export const SERVER_ERROR = 'No pudimos anotarte por un problema nuestro. Probá de nuevo en un rato.';

export const RATE_ERROR = 'Esperá un toque y volvé a intentar.';

export const NAME_MISSING = 'Completá tu nombre.';
export const NAME_SHORT = 'El nombre es muy corto.';
export const NAME_LONG = 'El nombre es muy largo.';
export const NAME_CHARS = 'Usá solo letras en el nombre.';
export const EMAIL_MISSING = 'Completá tu email.';
export const EMAIL_INVALID = 'Revisá tu email.';
export const SOURCE_MISSING = 'Elegí cómo te enteraste de nosotros.';
export const OTHER_MISSING = 'Contanos dónde, en pocas palabras.';
export const OTHER_LONG = 'Es muy largo. Dejalo en una oración.';
export const OTHER_CHARS = 'Sacale los caracteres raros y volvé a intentar.';
export const WHATSAPP_INVALID = 'Revisá tu WhatsApp (con código de país).';
export const GROUP_MISSING = 'Elegí si querés sumarte al grupo.';
export const TURNSTILE_MISSING = 'Completá la verificación (Turnstile) y probá de nuevo.';

/** No-JS redirect when the field is not one we know how to name. */
export const DATA_FALLBACK = 'Revisá los datos del formulario.';

const FIELD_ORDER = ['name', 'email', 'source', 'otherDetail', 'whatsapp', 'whatsappGroup', 'turnstile'] as const;

export type WaitlistErrorKey = (typeof FIELD_ORDER)[number];

const MESSAGE_CODE: Record<string, string> = {
  [NAME_MISSING]: 'name',
  [NAME_SHORT]: 'name-corto',
  [NAME_LONG]: 'name-largo',
  [NAME_CHARS]: 'name-letras',
  [EMAIL_MISSING]: 'email',
  [EMAIL_INVALID]: 'email-invalido',
  [SOURCE_MISSING]: 'source',
  [OTHER_MISSING]: 'other',
  [OTHER_LONG]: 'other-largo',
  [OTHER_CHARS]: 'other-raro',
  [WHATSAPP_INVALID]: 'whatsapp',
  [GROUP_MISSING]: 'grupo',
  [TURNSTILE_MISSING]: 'turnstile',
};

const CODE_MESSAGE: Record<string, string> = Object.fromEntries(
  Object.entries(MESSAGE_CODE).map(([message, code]) => [code, message]),
);

export function firstFieldKey(errors: Partial<Record<string, string | undefined>>): WaitlistErrorKey | undefined {
  for (const key of FIELD_ORDER) {
    if (errors[key]) return key;
  }
  return undefined;
}

/** Banner copy: the first invalid field, in form order. */
export function firstFieldMessage(errors: Partial<Record<string, string | undefined>>): string | undefined {
  const key = firstFieldKey(errors);
  return key ? errors[key] : undefined;
}

export function codeForMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;
  return MESSAGE_CODE[message];
}

/** Banner for a full-page POST, which cannot keep the inline errors. */
export function noticeFromQuery(estado?: string, campo?: string): string | undefined {
  if (estado === 'nuestro') return SERVER_ERROR;
  if (estado === 'espera') return RATE_ERROR;
  if (estado === 'datos' || estado === 'error') {
    if (campo && CODE_MESSAGE[campo]) return CODE_MESSAGE[campo];
    return DATA_FALLBACK;
  }
  return undefined;
}
