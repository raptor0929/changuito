import { allowedSeverities } from './options.ts';

export type BugReportField = 'name' | 'email' | 'description' | 'context' | 'severity';

export type FieldErrors = Partial<Record<BugReportField, string>>;

export type BugReportEntry = {
  name: string;
  email: string;
  description: string;
  context?: string;
  severity?: string;
  createdAt: string;
};

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const DESCRIPTION_MIN = 8;
const DESCRIPTION_MAX = 2000;
const CONTEXT_MAX = 500;

export function validateBugReport(
  input: {
    name: string;
    email: string;
    description: string;
    context: string;
    severity: string;
  },
  createdAt: string,
): { ok: true; entry: BugReportEntry } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const name = cleanName(input.name);
  const email = input.email.trim().toLowerCase();
  const description = cleanBlock(input.description);
  const context = cleanBlock(input.context);
  const severity = input.severity.trim();

  if (!name) errors.name = 'Completá tu nombre.';
  else if (name.length < 2) errors.name = 'El nombre es muy corto.';
  else if (name.length > 80) errors.name = 'El nombre es muy largo.';
  else if (!isPersonName(name)) errors.name = 'Usá solo letras en el nombre.';

  if (!email || email.length > 254 || !EMAIL.test(email) || email.includes('..')) {
    errors.email = 'Ingresá un email válido.';
  }

  if (!description) errors.description = 'Contanos qué pasó.';
  else if (description.length < DESCRIPTION_MIN) errors.description = 'Contanos un poco más.';
  else if (description.length > DESCRIPTION_MAX) errors.description = 'Es muy largo. Dejalo en un mensaje.';
  else if (hasControlChars(description)) errors.description = 'Sacale los caracteres raros y volvé a intentar.';

  if (context) {
    if (context.length < 2) errors.context = 'Si lo completás, contanos un poco más.';
    else if (context.length > CONTEXT_MAX) errors.context = 'Es muy largo. Dejalo en una oración.';
    else if (hasControlChars(context)) errors.context = 'Sacale los caracteres raros y volvé a intentar.';
  }

  if (severity && !allowedSeverities().has(severity)) {
    errors.severity = 'Elegí una opción de la lista.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const entry: BugReportEntry = { name, email, description, createdAt };
  if (context) entry.context = context;
  if (severity) entry.severity = severity;
  return { ok: true, entry };
}

function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function cleanBlock(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function isPersonName(name: string): boolean {
  if (hasControlChars(name)) return false;
  if (/[<>]/.test(name)) return false;
  let letters = 0;
  for (const char of name) {
    if (/\p{L}/u.test(char)) {
      letters += 1;
      continue;
    }
    if (char === ' ' || char === "'" || char === '’' || char === '-' || char === '.') continue;
    return false;
  }
  return letters >= 2;
}

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 9 || code === 10) continue;
    if (code < 32 || code === 127) return true;
  }
  return false;
}
