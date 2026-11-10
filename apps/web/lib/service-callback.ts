/** Server callbacks authenticate in their route handler, without a shopper's browser cookie. */
export function isCheckoutServiceCallback(pathname: string, method: string): boolean {
  return pathname === '/api/checkout/events' && (method === 'GET' || method === 'POST');
}
