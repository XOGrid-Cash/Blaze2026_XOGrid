import { binToHex, decodeCashAddress, hash160, hexToBin } from '@bitauth/libauth';
import type { Db } from './db.js';
import { RegistryError } from './registry.js';

// Display names an admin gives to outside users (publishers, reviewers). The same wallet can appear as a public key
// (user reviews), a bitcoincash: address, a bchtest: address, or a token-aware address, so every form is reduced to
// the key's hash160 before it is stored or looked up.

export const MAX_NAME = 64;
export const MAX_ADDRESSES = 20;

/** The hash160 (hex) behind a public key or P2PKH CashAddress, or null for anything else ("anonymous", P2SH, junk). */
export function matchKeyOf(identity: string): string | null {
    const entry = identity.trim();

    if (/^(02|03)[0-9a-fA-F]{64}$/.test(entry)) {
        return binToHex(hash160(hexToBin(entry.toLowerCase())));
    }

    const bare = entry.includes(':') ? entry.slice(entry.indexOf(':') + 1) : entry;

    for (const candidate of [entry, `bitcoincash:${bare}`, `bchtest:${bare}`]) {
        const decoded = decodeCashAddress(candidate.toLowerCase());

        if (typeof decoded !== 'string') {
            return decoded.type === 'p2pkh' || decoded.type === 'p2pkhWithTokens' ? binToHex(decoded.payload) : null;
        }
    }

    return null;
}

/** Looks up the registered name for each identity. Identities without one are left out of the map. */
export async function resolveNames(db: Db, identities: Iterable<string>): Promise<Map<string, string>> {
    const keys = new Map<string, string>();

    for (const identity of identities) {
        const key = identity ? matchKeyOf(identity) : null;

        if (key) {
            keys.set(identity, key);
        }
    }

    const names = new Map<string, string>();

    if (keys.size === 0) {
        return names;
    }

    const rows = await db
        .selectFrom('user_addresses')
        .innerJoin('users', 'users.id', 'user_addresses.user_id')
        .select(['user_addresses.match_key', 'users.name'])
        .where('user_addresses.match_key', 'in', [...new Set(keys.values())])
        .execute();
    const byKey = new Map(rows.map((row) => [row.match_key, row.name]));

    for (const [identity, key] of keys) {
        const name = byKey.get(key);

        if (name) {
            names.set(identity, name);
        }
    }

    return names;
}

export interface NamedUser {
    id: number;
    name: string;
    createdAt: string;
    createdBy: string;
    addresses: { address: string; addedAt: string }[];
}

export async function listUsers(db: Db): Promise<NamedUser[]> {
    const users = await db.selectFrom('users').selectAll().orderBy('name', 'asc').execute();
    const addresses = await db.selectFrom('user_addresses').selectAll().orderBy('added_at', 'asc').execute();

    return users.map((user) => ({
        id: user.id,
        name: user.name,
        createdAt: user.created_at,
        createdBy: user.created_by,
        addresses: addresses.filter((row) => row.user_id === user.id).map((row) => ({ address: row.address, addedAt: row.added_at })),
    }));
}

function cleanName(value: unknown): string {
    const name = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim() : '';

    if (name.length < 2 || name.length > MAX_NAME) {
        throw new RegistryError(`name must be 2 to ${MAX_NAME} characters.`, 400);
    }

    return name;
}

async function assertNameFree(db: Db, name: string, exceptId?: number): Promise<void> {
    const taken = (await db.selectFrom('users').select(['id', 'name']).execute()).find(
        (user) => user.name.toLowerCase() === name.toLowerCase() && user.id !== exceptId,
    );

    if (taken) {
        throw new RegistryError(`The name "${taken.name}" is already in use.`, 409);
    }
}

/** Validates addresses and returns them with their match keys. Rejects ones registered to someone else. */
async function prepareAddresses(db: Db, values: unknown, userId?: number): Promise<{ address: string; matchKey: string }[]> {
    if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
        throw new RegistryError('addresses must be a list of strings.', 400);
    }

    const prepared = new Map<string, string>();

    for (const value of values as string[]) {
        const address = value.trim();

        if (!address) {
            continue;
        }

        const matchKey = matchKeyOf(address);

        if (!matchKey) {
            throw new RegistryError(`"${address.slice(0, 80)}" is not a P2PKH CashAddress or public key.`, 400);
        }

        if (!prepared.has(matchKey)) {
            prepared.set(matchKey, address);
        }
    }

    if (prepared.size > MAX_ADDRESSES) {
        throw new RegistryError(`A user can have at most ${MAX_ADDRESSES} addresses.`, 400);
    }

    if (prepared.size > 0) {
        const existing = await db
            .selectFrom('user_addresses')
            .innerJoin('users', 'users.id', 'user_addresses.user_id')
            .select(['user_addresses.address', 'user_addresses.user_id', 'users.name'])
            .where('user_addresses.match_key', 'in', [...prepared.keys()])
            .execute();
        const conflict = existing.find((row) => row.user_id !== userId);

        if (conflict) {
            throw new RegistryError(`${conflict.address} is already registered to "${conflict.name}".`, 409);
        }
    }

    return [...prepared].map(([matchKey, address]) => ({ address, matchKey }));
}

async function getUser(db: Db, id: number): Promise<NamedUser> {
    const user = (await listUsers(db)).find((candidate) => candidate.id === id);

    if (!user) {
        throw new RegistryError('User not found.', 404);
    }

    return user;
}

async function insertAddresses(db: Db, userId: number, addresses: { address: string; matchKey: string }[]): Promise<void> {
    const existing = new Set((await db.selectFrom('user_addresses').select('match_key').where('user_id', '=', userId).execute()).map((row) => row.match_key));
    const fresh = addresses.filter((entry) => !existing.has(entry.matchKey));

    if (existing.size + fresh.length > MAX_ADDRESSES) {
        throw new RegistryError(`A user can have at most ${MAX_ADDRESSES} addresses.`, 400);
    }

    for (const entry of fresh) {
        await db
            .insertInto('user_addresses')
            .values({ match_key: entry.matchKey, address: entry.address, user_id: userId, added_at: new Date().toISOString() })
            .execute();
    }
}

export async function createUser(db: Db, nameValue: unknown, addressValues: unknown, actor: string): Promise<NamedUser> {
    const name = cleanName(nameValue);

    await assertNameFree(db, name);

    const addresses = await prepareAddresses(db, addressValues ?? []);
    const inserted = await db
        .insertInto('users')
        .values({ name, created_at: new Date().toISOString(), created_by: actor })
        .returning('id')
        .executeTakeFirstOrThrow();

    await insertAddresses(db, inserted.id, addresses);

    return getUser(db, inserted.id);
}

export async function renameUser(db: Db, id: number, nameValue: unknown): Promise<{ before: string; user: NamedUser }> {
    const before = await getUser(db, id);
    const name = cleanName(nameValue);

    await assertNameFree(db, name, id);
    await db.updateTable('users').set({ name }).where('id', '=', id).execute();

    return { before: before.name, user: await getUser(db, id) };
}

export async function addUserAddresses(db: Db, id: number, addressValues: unknown): Promise<NamedUser> {
    await getUser(db, id);
    await insertAddresses(db, id, await prepareAddresses(db, addressValues, id));

    return getUser(db, id);
}

export async function removeUserAddress(db: Db, id: number, address: string): Promise<NamedUser> {
    await getUser(db, id);

    const matchKey = matchKeyOf(address);
    const result = matchKey
        ? await db.deleteFrom('user_addresses').where('user_id', '=', id).where('match_key', '=', matchKey).executeTakeFirst()
        : undefined;

    if (!result || Number(result.numDeletedRows) === 0) {
        throw new RegistryError('That address is not registered to this user.', 404);
    }

    return getUser(db, id);
}

export async function deleteUser(db: Db, id: number): Promise<NamedUser> {
    const user = await getUser(db, id);

    // Deleted explicitly too, so it works even where the database ignores ON DELETE CASCADE.
    await db.deleteFrom('user_addresses').where('user_id', '=', id).execute();
    await db.deleteFrom('users').where('id', '=', id).execute();

    return user;
}
