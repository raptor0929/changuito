/**
 * An opt-in switch read from the environment. Server-only.
 *
 * It exists because the obvious spelling is wrong. `Boolean(env.X)` and
 * `env.X !== undefined` are both true for the string "false", and a Vercel
 * variable set to `false` or `0` is exactly how somebody turns a thing *off*
 * in a dashboard that has no checkbox. Every flag here opens a door that is
 * otherwise shut, so the failure that matters is the one where a value meant
 * as "no" reads as "yes".
 *
 * So: an explicit short list of yes-words, everything else is no, including
 * empty, absent, "false", "0", "off" and anything misspelt. A flag nobody can
 * set by accident is the point.
 */
const YES = new Set(['1', 'true', 'yes', 'on']);

export function envFlag(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return YES.has((env[name] ?? '').trim().toLowerCase());
}
