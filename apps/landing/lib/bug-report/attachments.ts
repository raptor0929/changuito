/**
 * Optional photos and short clips on a bug report.
 *
 * The landing posts JSON to Apps Script, which uploads `adjuntos[].base64`
 * to Drive. Base64 grows the body by about a third, and the host rejects
 * requests around 4.5 MB, so the cap is 3 MB of files in total. A higher
 * cap would fail in production before this check can answer.
 */

export const MAX_FILES = 3;
export const MAX_FILE_BYTES = 3 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 3 * 1024 * 1024;
export const MAX_JSON_CHARS = 4_400_000;

export const FILE_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.jpg,.jpeg,.png,.webp,.gif,.mp4,.webm,.mov';

const FILE_MB = 3;
const TOTAL_MB = 3;

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/mov',
]);

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.mov']);

const EXT_FOR_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};

export type StoredAttachment = {
  name: string;
  mimeType: string;
  base64: string;
};

export function tooManyFilesMessage(): string {
  return `Podés adjuntar hasta ${MAX_FILES} archivos.`;
}

export function fileTooBigMessage(name: string): string {
  return `${name} pesa demasiado. Cada archivo puede tener hasta ${FILE_MB} MB.`;
}

export function totalTooBigMessage(): string {
  return `Entre todos pesan demasiado. El máximo es ${TOTAL_MB} MB.`;
}

export function wrongTypeMessage(name: string): string {
  return `${name} no sirve. Adjuntá una foto (JPG, PNG, WEBP o GIF) o un video (MP4, WEBM o MOV).`;
}

export function emptyFileMessage(name: string): string {
  return `${name} está vacío.`;
}

export function unreadableFileMessage(): string {
  return 'No pudimos leer ese archivo. Probá con otro.';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const tenths = Math.round((bytes / (1024 * 1024)) * 10) / 10;
  return `${String(tenths).replace('.', ',')} MB`;
}

/** Browser-side gate, before the file is encoded. Server checks the bytes again. */
export function clientFileError(
  file: { name: string; type: string; size: number },
  state: { count: number; bytes: number },
): string | undefined {
  const label = displayName(file.name);
  if (state.count >= MAX_FILES) return tooManyFilesMessage();
  if (file.size <= 0) return emptyFileMessage(label);
  if (!allowedClientType(file.name, file.type)) return wrongTypeMessage(label);
  if (file.size > MAX_FILE_BYTES) return fileTooBigMessage(label);
  if (state.bytes + file.size > MAX_TOTAL_BYTES) return totalTooBigMessage();
  return undefined;
}

export function validateAttachments(
  raw: unknown,
): { ok: true; adjuntos: StoredAttachment[] } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, adjuntos: [] };
  if (!Array.isArray(raw)) return { ok: false, error: unreadableFileMessage() };
  if (raw.length > MAX_FILES) return { ok: false, error: tooManyFilesMessage() };

  const adjuntos: StoredAttachment[] = [];
  let total = 0;
  for (const item of raw) {
    const parsed = asAttachment(item);
    if (!parsed) return { ok: false, error: unreadableFileMessage() };
    const label = displayName(parsed.name);
    const cleaned = stripDataUrl(parsed.base64);
    if (!cleaned) return { ok: false, error: emptyFileMessage(label) };
    if (cleaned.length > maxBase64Length(MAX_FILE_BYTES)) return { ok: false, error: fileTooBigMessage(label) };

    const bytes = decodeBase64(cleaned);
    if (!bytes || bytes.length === 0) return { ok: false, error: unreadableFileMessage() };
    if (bytes.length > MAX_FILE_BYTES) return { ok: false, error: fileTooBigMessage(label) };
    if (total + bytes.length > MAX_TOTAL_BYTES) return { ok: false, error: totalTooBigMessage() };

    const detected = detectMime(bytes);
    if (!detected) return { ok: false, error: wrongTypeMessage(label) };
    if (!mimeAgrees(parsed.mimeType, detected)) return { ok: false, error: wrongTypeMessage(label) };

    total += bytes.length;
    adjuntos.push({
      name: safeName(parsed.name, detected),
      mimeType: detected,
      base64: cleaned,
    });
  }

  return { ok: true, adjuntos };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) {
    binary += String.fromCharCode(...bytes.subarray(index, index + size));
  }
  return btoa(binary);
}

function asAttachment(value: unknown): { name: string; mimeType: string; base64: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.url === 'string' && typeof item.base64 !== 'string') return undefined;
  const name = typeof item.name === 'string' ? item.name : '';
  const mimeType =
    typeof item.mimeType === 'string' ? item.mimeType : typeof item.type === 'string' ? item.type : '';
  const base64 = typeof item.base64 === 'string' ? item.base64 : '';
  if (!base64) return undefined;
  return { name, mimeType, base64 };
}

function allowedClientType(name: string, type: string): boolean {
  const mime = normalizeMime(type);
  if (!mime || mime === 'application/octet-stream') return ALLOWED_EXT.has(extension(name));
  return ALLOWED_MIME.has(mime);
}

function mimeAgrees(declared: string, detected: string): boolean {
  const mime = normalizeMime(declared);
  if (!mime || mime === 'application/octet-stream') return true;
  if (mime === detected) return true;
  const video = mime === 'video/mp4' || mime === 'video/quicktime';
  const detectedVideo = detected === 'video/mp4' || detected === 'video/quicktime';
  return video && detectedVideo;
}

function normalizeMime(value: string): string {
  const mime = value.toLowerCase().split(';')[0].trim();
  if (mime === 'image/jpg' || mime === 'image/pjpeg') return 'image/jpeg';
  if (mime === 'video/mov') return 'video/quicktime';
  return mime;
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return '';
  return name.slice(dot).toLowerCase();
}

function displayName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.replace(/\s+/g, ' ').trim() || 'el archivo';
  return base.length > 40 ? `${base.slice(0, 37)}...` : base;
}

function safeName(name: string, mime: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  const stem = base
    .replace(/\.[^.]+$/, '')
    .replace(/[^\p{L}\p{N} ._()-]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${stem || 'adjunto'}${EXT_FOR_MIME[mime] ?? ''}`;
}

function stripDataUrl(value: string): string {
  const trimmed = value.trim().replace(/\s/g, '');
  const marker = 'base64,';
  const at = trimmed.indexOf(marker);
  if (trimmed.startsWith('data:') && at >= 0) return trimmed.slice(at + marker.length);
  return trimmed;
}

function maxBase64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

function decodeBase64(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return undefined;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
}

function detectMime(bytes: Uint8Array): string | undefined {
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (
    hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38]) &&
    bytes.length >= 6 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  if (hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    if (brand.startsWith('qt')) return 'video/quicktime';
    return 'video/mp4';
  }
  return undefined;
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  return true;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let text = '';
  for (let index = 0; index < length; index += 1) text += String.fromCharCode(bytes[start + index] ?? 0);
  return text;
}
