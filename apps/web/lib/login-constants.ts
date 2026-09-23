/** Easy to change. Guests may send this many chat turns without logging in. */
export const FREE_TURNS = 3;

/** Softer IP ceiling: blocks sessionId-rotation abuse without locking a café. */
export const FREE_TURNS_PER_IP = FREE_TURNS * 10;

export const USER_COOKIE = 'chg_user';
export const LOGIN_REQUIRED = 'login_required' as const;

export const LOGIN_REQUIRED_MESSAGE =
  'Para seguir, iniciá sesión. Así podemos anotarte y seguir mejorando Changuito.';

/** Primary button on the soft-limit login gate. Rioplatense voseo. */
export const LOGIN_CTA = 'Iniciá sesión';
