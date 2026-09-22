/**
 * Where someone heard about Changuito. Labels are the stored values.
 * Luma event names are copied exactly from the calendar export.
 */

export const SOCIAL_SOURCES = [
  'Instagram',
  'X (Twitter)',
  'LinkedIn',
  'TikTok',
  'YouTube',
  'Facebook',
  'WhatsApp',
  'Telegram',
  'Threads',
] as const;

export const NERDEARLA_SOURCE = 'Nerdearla';

export const EVENT_SOURCES = [
  'AI Founder Marketplace',
  'Astra Commons: Buenos Aires',
  'BrowserStack Meetup Buenos Aires: Master Accessibility & AI in QA',
  'Founders Fit Club — Edición 03',
  'SideQuest - LOVE.exe',
] as const;

export const OTHER_SOURCE = 'Otros';

export const SOURCE_GROUPS = [
  { id: 'social', label: 'Redes sociales', options: SOCIAL_SOURCES },
  { id: 'nerdearla', label: 'Nerdearla', options: [NERDEARLA_SOURCE] as const },
  { id: 'events', label: 'Eventos', options: EVENT_SOURCES },
  { id: 'other', label: 'Otros', options: [OTHER_SOURCE] as const },
] as const;

export function allowedSources(): ReadonlySet<string> {
  const values: string[] = [];
  for (const group of SOURCE_GROUPS) {
    for (const option of group.options) values.push(option);
  }
  return new Set(values);
}
