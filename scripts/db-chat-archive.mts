/**
 * Does the archive actually round-trip through the real database.
 *
 * `npm run db:invariants` checks the schema with raw SQL; this checks the layer
 * above it — `lib/chat-archive.ts` and `lib/db.ts` as the routes call them —
 * against the live Supabase instance. It exists because two things here are
 * only provable with a real Postgres in the loop:
 *
 * - `RenderCache.products` is a `Map`, and `JSON.stringify` renders a Map as
 *   `{}` silently. A unit test proves `encodeTurn` converts it; only a real
 *   `jsonb` column proves the conversion survives the column.
 * - `loadChat` scopes by address *in the WHERE clause* rather than in a caller.
 *   A fake would pass that test whatever the SQL said.
 *
 * It writes one row with a fixed UUID and deletes it, and prints how many rows
 * it left behind so the cleanup is visible rather than assumed. Connection
 * problems report the SQLSTATE, never the URL.
 *
 *   npm run db:archive
 */
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(new URL('../apps/web', import.meta.url).pathname, false, { info() {}, error() {} });

if (!(process.env.DATABASE_URL ?? '').trim()) {
  console.error('DATABASE_URL is not set in apps/web/.env — nothing to check against.');
  process.exit(2);
}

const { db, loadChat, chatsOf, resetDb } = await import('../apps/web/lib/db.ts');
const { archiveChat, chatTitle } = await import('../apps/web/lib/chat-archive.ts');

const ID = '11111111-2222-3333-4444-555555555555';
const MINE = `G${'A'.repeat(55)}`;
const THEIRS = `G${'B'.repeat(55)}`;
const turn = { messages: [{ role: 'user', content: 'fideos' }], cache: { products: new Map([['sku-1', { sku: 'sku-1' }]]) } };

let failed = 0;
const ok = (name: string, cond: boolean) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) failed++; };

try {
  // mainnet, because that is where a transcript is written at all: preview
  // keeps no records (lib/app-mode.ts) and `archiveChat` answers 'preview'
  // without dialling anything. The row is deleted in the finally below either
  // way, so this touches the same table the app does and leaves nothing.
  const outcome = await archiveChat({ id: ID, network: 'mainnet', address: MINE, turn: turn as never, title: chatTitle('  fideos\n  y salsa ') });
  ok('archiveChat reports saved against the real database', outcome === 'saved');

  const mine = await loadChat(ID, MINE);
  ok('the owner reads it back', Boolean(mine));
  ok('the network came back', mine?.network === 'mainnet');
  const t = mine?.transcript as { v: number; products: [string, unknown][] };
  ok('jsonb kept the v:1 codec', t?.v === 1);
  ok('the product Map survived jsonb', Array.isArray(t?.products) && t.products[0]?.[0] === 'sku-1');

  ok('RULE: another wallet reads nothing', (await loadChat(ID, THEIRS)) === undefined);

  const list = await chatsOf('mainnet', MINE, 5);
  ok('it appears in the list with its title', list.some((c) => c.id === ID && c.title === 'fideos y salsa'));

  // A second turn must not rename it, and must replace the transcript.
  await archiveChat({ id: ID, network: 'mainnet', address: MINE, turn: { messages: [{ role: 'user', content: 'y queso' }], cache: { products: new Map() } } as never, title: 'y queso' });
  const again = await chatsOf('mainnet', MINE, 5);
  ok('the title is the first one, not the latest', again.find((c) => c.id === ID)?.title === 'fideos y salsa');
  const after = (await loadChat(ID, MINE))?.transcript as { messages: { content: string }[] };
  ok('the transcript is the latest', after?.messages?.[0]?.content === 'y queso');
} catch (e) {
  const err = e as { code?: string; message?: string };
  console.error(`db error: ${err.code ?? ''} ${err.message ?? String(e)}`);
  failed++;
} finally {
  await db()`delete from chat where id = ${ID}`.catch(() => {});
  const left = await db()`select count(*)::int as n from chat where id = ${ID}`.catch(() => [{ n: -1 }]);
  console.log(`rows left behind: ${left[0].n}`);
  await resetDb();
}
process.exit(failed ? 1 : 0);
