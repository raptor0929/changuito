import { allowedSources, OTHER_SOURCE } from './options.ts';

export type WaitlistField = 'name' | 'email' | 'source' | 'otherDetail' | 'whatsapp' | 'whatsappGroup';

export type FieldErrors = Partial<Record<WaitlistField, string>>;

export type WaitlistEntry = {
  name: string;
  email: string;
  source: string;
  otherDetail?: string;
  /** E.164, leading +. Argentina locals are stored as +54 9 … */
  whatsapp: string;
  whatsappGroup: boolean;
  createdAt: string;
  userAgent?: string;
};

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export type WaitlistInput = {
  name: string;
  email: string;
  source: string;
  otherDetail: string;
  whatsapp: string;
  whatsappGroup: string;
};

export function validateWaitlist(
  input: WaitlistInput,
  createdAt: string,
): { ok: true; entry: WaitlistEntry } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const name = cleanName(input.name);
  const email = input.email.trim().toLowerCase();
  const source = input.source.trim();
  const otherDetail = input.otherDetail.replace(/\s+/g, ' ').trim();
  const whatsappRaw = input.whatsapp.replace(/\s+/g, ' ').trim();
  const groupRaw = input.whatsappGroup.trim().toLowerCase();

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

  let whatsapp: string | undefined;
  if (!whatsappRaw) errors.whatsapp = 'Ingresá tu WhatsApp.';
  else {
    const normalized = normalizeWhatsapp(whatsappRaw);
    if (!normalized) errors.whatsapp = 'Ingresá un WhatsApp válido, con código de país.';
    else whatsapp = normalized;
  }

  let whatsappGroup: boolean | undefined;
  if (groupRaw === 'si' || groupRaw === 'sí' || groupRaw === 'true' || groupRaw === '1') {
    whatsappGroup = true;
  } else if (groupRaw === 'no' || groupRaw === 'false' || groupRaw === '0') {
    whatsappGroup = false;
  } else {
    errors.whatsappGroup = 'Decinos si querés sumarte al grupo de WhatsApp.';
  }

  if (Object.keys(errors).length > 0 || !whatsapp || whatsappGroup === undefined) {
    return { ok: false, errors };
  }

  const entry: WaitlistEntry = {
    name,
    email,
    source,
    whatsapp,
    whatsappGroup,
    createdAt,
  };
  if (source === OTHER_SOURCE) entry.otherDetail = otherDetail;
  return { ok: true, entry };
}

/**
 * Argentina-friendly phone check. Accepts +54, a bare 54, a trunk 0, and local
 * numbers. The mobile "15" after the area code is dropped and a "9" is added
 * so the stored value is E.164 (`+549…`). Other countries are kept when the
 * value already starts with +.
 */
export function normalizeWhatsapp(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed || !/^\+?[\d\s().-]+$/.test(trimmed)) return undefined;

  let digits = trimmed.replace(/\D/g, '');
  const plus = trimmed.startsWith('+') || digits.startsWith('00');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 8 || digits.length > 15) return undefined;

  if (plus && !digits.startsWith('54')) return `+${digits}`;

  if (digits.startsWith('54')) digits = digits.slice(2);
  const national = argentinaMobileNational(digits);
  if (!national) return undefined;
  return `+54${national}`;
}

function argentinaMobileNational(digits: string): string | undefined {
  let national = digits;
  if (national.startsWith('0')) national = national.slice(1);
  if (!national) return undefined;

  if (national.startsWith('9') && national.length > 11) {
    const body = withoutMobileFifteen(national.slice(1));
    if (body.length === 10) national = `9${body}`;
  } else if (!(national.startsWith('9') && national.length === 11)) {
    national = withoutMobileFifteen(national);
    if (national.length === 10) national = `9${national}`;
  }

  if (national.startsWith('9') && national.length === 11) return national;
  return undefined;
}

/** Drop the local mobile infix "15" that sits after the area code. */
function withoutMobileFifteen(national: string): string {
  if (national.startsWith('15') && national.length === 10) return `11${national.slice(2)}`;
  if (national.startsWith('11') && national.slice(2, 4) === '15') return `11${national.slice(4)}`;

  if (!national.startsWith('11') && national.length >= 12 && national.slice(4, 6) === '15') {
    const rest = national.slice(6);
    if (rest.length >= 6 && rest.length <= 8) return `${national.slice(0, 4)}${rest}`;
  }
  if (!national.startsWith('11') && national.length >= 11 && national.slice(3, 5) === '15') {
    const rest = national.slice(5);
    if (rest.length >= 6 && rest.length <= 8) return `${national.slice(0, 3)}${rest}`;
  }
  return national;
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
