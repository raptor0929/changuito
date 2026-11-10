import type { Lang } from './lang.ts';

/** The profile dialog's words. */
export interface ProfileCopy {
  title: string;
  avatarAria: string;
  tabGeneral: string;
  tabDia: string;
  ordersHeading: string;
  signOut: string;
  addressLabel: string;
  lead: string;
  email: string;
  password: string;
  passwordSaved: string;
  passwordHint: string;
  dni: string;
  dniHint: string;
  postcode: string;
  postcodeHint: string;
  save: string;
  saving: string;
  saved: string;
  failed: string;
  loading: string;
  deleteHeading: string;
  deleteAccount: string;
  deleteLead: string;
  deleteKeeps: string;
  deleteConfirm: string;
  deleteCancel: string;
  deleteWorking: string;
  deleteFailed: string;
  deletePrivyFailed: string;
  deleteDone: string;
  privacyLink: string;
}

const ES: ProfileCopy = {
  title: 'Tu perfil',
  avatarAria: 'Abrir tu perfil',
  tabGeneral: 'General',
  tabDia: 'Mis datos de Día',
  ordersHeading: 'Mis compras',
  signOut: 'Cerrar sesión',
  addressLabel: 'Tu dirección',
  lead:
    'Con estos datos compramos en tu cuenta de Día cuando pagás con USDC. Se guardan cifrados y solo se usan para hacer tu pedido.',
  email: 'Email de Día',
  password: 'Contraseña de Día',
  passwordSaved: 'Guardada. Escribí una nueva para cambiarla.',
  passwordHint: 'No la mostramos nunca, ni a vos.',
  dni: 'DNI',
  dniHint: 'También se usa como documento del titular de la tarjeta.',
  postcode: 'Código postal',
  postcodeHint: 'Donde recibís el pedido. Cotizamos el envío acá.',
  save: 'Guardar',
  saving: 'Guardando…',
  saved: 'Listo, guardado.',
  failed: 'No pudimos guardar. Probá de nuevo.',
  loading: 'Cargando tu perfil…',
  deleteHeading: 'Eliminar cuenta y datos',
  deleteAccount: 'Eliminar cuenta y datos',
  deleteLead:
    'Se borra el perfil cifrado (email, contraseña, DNI y código postal de Día), los chats, los pedidos asociados, los checkouts guardados y el contador de uso. Se cierra la sesión y se limpia este navegador.',
  deleteKeeps: 'No podemos borrar tu cuenta de Día ni lo que ya quedó escrito en la cadena (el depósito en USDC).',
  deleteConfirm: 'Sí, eliminar',
  deleteCancel: 'Cancelar',
  deleteWorking: 'Eliminando…',
  deleteFailed: 'No pudimos eliminar la cuenta. Probá de nuevo.',
  deletePrivyFailed:
    'Los datos de Changuito ya se borraron. El ingreso por email no se pudo eliminar. Volvé a entrar para intentarlo de nuevo.',
  deleteDone: 'Listo',
  privacyLink: 'Política de privacidad',
};

const EN: ProfileCopy = {
  title: 'Your profile',
  avatarAria: 'Open your profile',
  tabGeneral: 'General',
  tabDia: 'My Día details',
  ordersHeading: 'My purchases',
  signOut: 'Sign out',
  addressLabel: 'Your address',
  lead:
    'We use these to buy in your Día account when you pay with USDC. They are stored encrypted and used only to place your order.',
  email: 'Día email',
  password: 'Día password',
  passwordSaved: 'Saved. Type a new one to change it.',
  passwordHint: 'We never show it, not even to you.',
  dni: 'DNI',
  dniHint: "Also used as the cardholder's document.",
  postcode: 'Postal code',
  postcodeHint: 'Where you get the order. Delivery is quoted here.',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Done, saved.',
  failed: "We couldn't save. Try again.",
  loading: 'Loading your profile…',
  deleteHeading: 'Delete account and data',
  deleteAccount: 'Delete account and data',
  deleteLead:
    'This deletes the encrypted profile (Día email, password, DNI and postal code), chats, associated orders, stored checkouts and the usage counter. It ends the session and clears this browser.',
  deleteKeeps: 'We cannot delete your Día account or what is already written on the chain (the USDC deposit).',
  deleteConfirm: 'Yes, delete',
  deleteCancel: 'Cancel',
  deleteWorking: 'Deleting…',
  deleteFailed: "We couldn't delete the account. Try again.",
  deletePrivyFailed:
    'Your Changuito data is already gone. The email sign-in could not be deleted. Sign in again to retry.',
  deleteDone: 'Done',
  privacyLink: 'Privacy policy',
};

/** GET/PUT /api/profile's 503: what happened, and that the saved details are safe. */
export const PROFILE_UNAVAILABLE = {
  es: 'Ahora no podemos abrir tu perfil. Tus datos siguen guardados y cifrados; probá de nuevo en unos minutos.',
  en: "We can't open your profile right now. Your details are still saved and encrypted; try again in a few minutes.",
} as const;

export function profileCopy(lang: Lang): ProfileCopy {
  return lang === 'en' ? EN : ES;
}

/** Two letters for the avatar: from the email's name part, else the wallet address. */
export function initials(email: string | null | undefined, address: string | null | undefined): string {
  const name = (email ?? '').split('@')[0] ?? '';
  const parts = name.split(/[._\-+\s]+/).filter((p) => /[a-z]/i.test(p));
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  if (parts[0]) return parts[0].replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase();
  return (address ?? '?').slice(0, 2).toUpperCase();
}
