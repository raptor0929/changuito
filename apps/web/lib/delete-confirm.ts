/**
 * The body field POST /api/account/delete requires.
 *
 * A constant rather than something the shopper types: the profile dialog's
 * second step is the confirmation, and this string only stops a request that
 * never passed through that step. No server imports — the dialog bundles it.
 */
export const DELETE_CONFIRM = 'delete-my-changuito-account';
