import { isValidAdminIdentity, seedAdmins } from './admin.js';
import { migrate, openDatabase } from './db.js';
import { listTemplates, reauditAll } from './registry.js';
import { seed, seedCommunity } from './seed.js';

const USAGE = `Usage: cli <command>

Commands:
  init     Create the database and tables (safe to run again)
  seed     Publish the XO sample templates and the community templates, and set the Home spotlight (safe to run again)
  audit    Re-run the automated audit for every stored template
  list     Print every stored template with its badge
  admin-add <label> <identity>   Add a moderator (compressed public key, P2PKH address, or xpub)
  admin-list                     Print the moderator allowlist
  admin-remove <identity>        Remove a moderator

Environment: DATABASE_URL (PostgreSQL) or DATABASE_PATH (SQLite, default ./data/hub.db)`;

const command = process.argv[2];

if (!command || !['init', 'seed', 'audit', 'list', 'admin-add', 'admin-list', 'admin-remove'].includes(command)) {
    console.error(USAGE);
    process.exit(command ? 1 : 0);
}

const { db, description } = openDatabase();

await migrate(db);

if (command === 'init') {
    console.log(`Database ready: ${description}`);
} else if (command === 'seed') {
    const result = await seed(db);
    const community = await seedCommunity(db);

    console.log(
        `Seeded: ${result.published + community.published} published, ${result.alreadyPresent + community.alreadyPresent} already present.`,
    );
} else if (command === 'audit') {
    console.log(`Re-audited ${await reauditAll(db)} templates.`);
} else if (command === 'admin-add') {
    const [label, identity] = process.argv.slice(3);

    if (!label || !identity || !isValidAdminIdentity(identity)) {
        console.error('Usage: cli admin-add <label> <identity>. The identity must be a compressed public key, a P2PKH address, or an xpub.');
        process.exitCode = 1;
    } else {
        const result = await seedAdmins(db, `${label}=${identity}`);

        console.log(result.added.length > 0 ? `Added moderator "${label}".` : 'Not added: the label must be 1 to 64 characters.');
        process.exitCode = result.added.length > 0 ? 0 : 1;
    }
} else if (command === 'admin-list') {
    for (const admin of await db.selectFrom('admins').selectAll().orderBy('added_at').execute()) {
        console.log(`${admin.label.padEnd(20)} ${admin.address_or_pubkey}`);
    }
} else if (command === 'admin-remove') {
    const identity = process.argv[3];
    const result = identity ? await db.deleteFrom('admins').where('address_or_pubkey', '=', identity).executeTakeFirst() : undefined;
    const removed = Number(result?.numDeletedRows ?? 0);

    console.log(removed > 0 ? 'Moderator removed.' : 'No moderator with that identity.');
    process.exitCode = removed > 0 ? 0 : 1;
} else if (command === 'list') {
    const { items } = await listTemplates(db, { pageSize: 50, sort: 'name' });

    for (const item of items) {
        const counts = item.audit?.counts;

        console.log(
            `${item.identifier.slice(0, 12)}  ${item.badge.padEnd(12)}  ${item.name}` +
                (counts ? `  [pass ${counts.pass}, warn ${counts.warn}, fail ${counts.fail}, skipped ${counts.skipped}]` : ''),
        );
    }
}

await db.destroy();
