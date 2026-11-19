import { seedAdmins } from './admin.js';
import { buildApp } from './app.js';
import { migrate, openDatabase } from './db.js';
import { reauditStale } from './registry.js';
import { seed, seedCommunity } from './seed.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

// DATABASE_URL (PostgreSQL, e.g. Supabase) wins when set; otherwise a SQLite file at DATABASE_PATH is used.
const { db, description } = openDatabase();

console.log(`Database: ${description}`);

// Creating missing tables on every start is safe and means a fresh container works without a manual step.
await migrate(db);

// A brand-new database would show an empty hub, so load the XO sample templates the first time. Set SEED_ON_EMPTY=0 to skip.
if (process.env.SEED_ON_EMPTY !== '0' && (await db.selectFrom('templates').select('identifier').limit(1).execute()).length === 0) {
    const result = await seed(db);

    console.log(`Empty database: seeded ${result.published} sample templates.`);
}

// The templates in the repo's templates/ folder are added on every start, so a registry that already holds data gets
// new ones after a deploy. This only adds what is missing and never changes the spotlight. Set SEED_COMMUNITY=0 to skip.
if (process.env.SEED_COMMUNITY !== '0') {
    const community = await seedCommunity(db);

    if (community.published > 0) {
        console.log(`Published ${community.published} community template(s).`);
    }
}

// When the audit checks change, older reports are refreshed once so every template shows the current checks.
const reaudited = await reauditStale(db);

if (reaudited > 0) {
    console.log(`Re-audited ${reaudited} template(s) with the current checks.`);
}

// ADMIN_IDENTITIES is "label=identity" pairs, comma-separated; an identity is a public key, a P2PKH address or an xpub.
const admins = await seedAdmins(db, process.env.ADMIN_IDENTITIES);

if (admins.skipped.length > 0) {
    console.warn(`ADMIN_IDENTITIES: skipped invalid entries: ${admins.skipped.join(', ')}`);
}

console.log(`Moderators on the allowlist from ADMIN_IDENTITIES: ${admins.added.join(', ') || '(none)'}`);

const app = await buildApp(db, { logger: true, webDir: process.env.WEB_DIR ?? '../web/dist' });

await app.listen({ port, host });
