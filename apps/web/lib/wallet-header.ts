/**
 * The header a browser request carries to say which wallet it is acting for.
 *
 * The `chg_user` cookie names the wallet that last signed in *in this
 * browser*. When the shopper switches accounts, the new wallet's cookie is
 * minted a moment later, and in between a request carried the old one.
 * Requests that read or write per-account data say which wallet they mean,
 * and the server refuses (409 `session_mismatch`) when the cookie is for
 * another one. The client re-mints the cookie and retries.
 *
 * The header is a claim, never an identity: the cookie still decides who the
 * request is. A mismatch can only make a request fail, never act as someone.
 *
 * No imports, so client and server bundles both take it.
 */
export const WALLET_HEADER = 'x-chg-wallet';

export const SESSION_MISMATCH = 'session_mismatch';
