/**
 * A store request that does not go through Workers' fetch.
 *
 * fetch from a Worker adds a CF-Worker header and leaves from Cloudflare's
 * network. Día, Jumbo, Disco and Carrefour sit behind CloudFront, and that
 * request comes back as an HTML block instead of the JSON the adapter needs.
 * A TLS socket carries only the headers written here. Node never calls this:
 * the module that opens the socket is loaded only after a Worker fetch has
 * already failed to produce JSON.
 */

const MAX_BYTES = 2_000_000;

type Socket = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
};

type Connect = (
  address: string,
  options?: { secureTransport?: 'on' | 'off' | 'starttls' },
) => Socket;

async function connectTls(): Promise<Connect> {
  const mod = await import('cloudflare:sockets');
  return mod.connect;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

function headerEnd(buf: Uint8Array): number {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) return i;
  }
  return -1;
}

/** Turn one HTTP/1.1 message, headers included, into a status and a body. */
export function decodeHttpMessage(raw: Uint8Array): { status: number; headers: Headers; body: Uint8Array } {
  const at = headerEnd(raw);
  if (at < 0) throw new Error('store response had no header end');
  const head = new TextDecoder().decode(raw.subarray(0, at));
  const lines = head.split('\r\n');
  const status = Number(lines[0]?.split(' ')[1] ?? 0);
  const headers = new Headers();
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  let body = raw.subarray(at + 4);
  if ((headers.get('transfer-encoding') ?? '').includes('chunked')) body = unchunk(body);
  return { status, headers, body };
}

function unchunk(body: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let i = 0;
  const bytes = body;
  while (i < bytes.length) {
    let lineEnd = i;
    while (lineEnd + 1 < bytes.length && !(bytes[lineEnd] === 13 && bytes[lineEnd + 1] === 10)) lineEnd++;
    const sizeText = new TextDecoder().decode(bytes.subarray(i, lineEnd)).split(';')[0]?.trim() ?? '';
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size)) break;
    const start = lineEnd + 2;
    if (size === 0) break;
    parts.push(bytes.subarray(start, start + size));
    i = start + size + 2;
  }
  return concat(parts);
}

async function inflate(body: Uint8Array, encoding: string | null): Promise<string> {
  const codec = encoding?.includes('gzip') ? 'gzip' : encoding?.includes('deflate') ? 'deflate' : null;
  if (!codec || typeof DecompressionStream === 'undefined') return new TextDecoder().decode(body);
  const copy = new ArrayBuffer(body.byteLength);
  new Uint8Array(copy).set(body);
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream(codec));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

export async function socketExchange(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  redirects = 0,
): Promise<{ status: number; text: string; headers: Headers }> {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error(`refusing a non-https store request to ${u.host}`);
  const connect = await connectTls();
  const socket = connect(`${u.hostname}:443`, { secureTransport: 'on' });
  const lines = [
    `${init.method} ${u.pathname}${u.search} HTTP/1.1`,
    `Host: ${u.hostname}`,
    'Connection: close',
  ];
  for (const [name, value] of Object.entries(init.headers)) {
    if (name.toLowerCase().startsWith('cf-')) continue;
    lines.push(`${name}: ${value}`);
  }
  if (init.body !== undefined && !Object.keys(init.headers).some((n) => n.toLowerCase() === 'content-length')) {
    lines.push(`Content-Length: ${new TextEncoder().encode(init.body).byteLength}`);
  }
  const payload = `${lines.join('\r\n')}\r\n\r\n${init.body ?? ''}`;
  const writer = socket.writable.getWriter();
  await writer.write(new TextEncoder().encode(payload));
  await writer.close();

  const reader = socket.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) throw new Error(`store response from ${u.host} exceeded ${MAX_BYTES} bytes`);
    parts.push(value);
  }
  const decoded = decodeHttpMessage(concat(parts));
  if (decoded.status >= 300 && decoded.status < 400 && redirects < 2) {
    const location = decoded.headers.get('location');
    if (location) {
      return socketExchange(new URL(location, url).toString(), { ...init, method: 'GET', body: undefined }, redirects + 1);
    }
  }
  return {
    status: decoded.status,
    text: await inflate(decoded.body, decoded.headers.get('content-encoding')),
    headers: decoded.headers,
  };
}
