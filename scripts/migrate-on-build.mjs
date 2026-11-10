/**
 * The Workers build does not touch the database.
 *
 * A person runs `npm run db:migrate` from a machine that has DIRECT_URL.
 * This step used to refuse the build when that variable was missing. It no
 * longer reads DIRECT_URL and it applies no SQL, so a Workers build can
 * finish without a database configured.
 */
console.log('[migrate] skipped: the build does not apply or check SQL.');
