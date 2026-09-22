import { allowedSources, OTHER_SOURCE } from './options.ts';

export type WaitlistField = 'name' | 'email' | 'source' | 'otherDetail';

export type FieldErrors = Partial<Record<WaitlistField, string>>;

export type WaitlistEntry = {
  name: string;
  email: string;
  source: string;
  otherDetail?: string;
  createdAt: string;
};

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export function validateWaitlist(
  input: { name: string; email: string; source: string; otherDetail: string },
  createdAt: string,
): { ok: true; entry: WaitlistEntry } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const name = cleanName(input.name);
  const email = input.email.trim().toLowerCase();
  const source = input.source.trim();
  const otherDetail = input.otherDetail.replace(/\s+/g, ' ').trim();

  if (!name) errors.name = 'Completá tu nombre.';
  else if (name.length < 2) errors.name = 'El nombre es muy corto.';
  else if (name.length > 80) errors.name = 'El nombre es muy largo.';
  else if (!isPersonName(name)) errors.name = 'Usá solo letras en el nombre.';

  if (!email || email.length > 254 || !EMAIL.test(email) || email.includes('..')) {
    errors.email = 'Ingresá un email válido.';
  }

  if (!allowedSources().has(source)) {
    errors.source = 'Elegí cómo te enteraste de nosotros.';
  }

  if (source === OTHER_SOURCE) {
    if (otherDetail.length < 2) errors.otherDetail = 'Contanos dónde, en pocas palabras.';
    else if (otherDetail.length > 160) errors.otherDetail = 'Es muy largo. Dejalo en una oración.';
    else if (hasControlChars(otherDetail)) errors.otherDetail = 'Sacale los caracteres raros y volvé a intentar.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const entry: WaitlistEntry = { name, email, source, createdAt };
  if (source === OTHER_SOURCE) entry.otherDetail = otherDetail;
  return { ok: true, entry };
}

function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
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
    if (code < 32 || code === 127) return true;
  }
  return false;
}
