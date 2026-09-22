/** Severity labels stored as the visitor wrote them. Empty means they skipped it. */
export const SEVERITIES = ['Molesta un poco', 'Me frena', 'No puedo seguir'] as const;

export function allowedSeverities(): Set<string> {
  return new Set(SEVERITIES);
}
