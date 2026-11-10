declare module 'cloudflare:sockets' {
  export function connect(
    address: string,
    options?: { secureTransport?: 'on' | 'off' | 'starttls' },
  ): {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  };
}
