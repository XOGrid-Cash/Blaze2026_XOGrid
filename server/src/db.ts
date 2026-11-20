import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { Kysely, PostgresDialect, SqliteDialect, type ColumnDefinitionBuilder, type Generated } from 'kysely';
import pg from 'pg';

// Column types stay portable (TEXT / INTEGER only, no database-specific features), so the same schema and queries run
// on SQLite (local, tests, a single container) and PostgreSQL (hosted, e.g. Supabase). Only the connection and the
// auto-increment id column differ.

type Backend = 'sqlite' | 'postgres';

const backends = new WeakMap<object, Backend>();

export interface TemplatesTable {
    identifier: string;
    name: string;
    description: string;
    json: string;
    publisher: string;
    created_at: string;
    removed: number;
    removed_reason: string | null;
}

export interface TemplateCategoriesTable {
    identifier: string;
    category: string;
}

export interface AuditReportsTable {
    id: Generated<number>;
    identifier: string;
    checker_version: string;
    results_json: string;
    created_at: string;
}

export interface FlagsTable {
    id: Generated<number>;
    identifier: string;
    reason: string;
    reporter: string;
    status: string;
    created_at: string;
}

export interface ReviewsTable {
    id: Generated<number>;
    identifier: string;
    reviewer_address: string;
    /** Display name of the moderator who gave the review. Null for rows created before labels existed. */
    reviewer_label: string | null;
    signature: string | null;
    note: string;
    created_at: string;
}

export interface UserReviewsTable {
    id: Generated<number>;
    identifier: string;
    /** Compressed public key (hex) of the wallet that signed the review. */
    reviewer: string;
    rating: number;
    body: string;
    created_at: string;
    hidden: number;
    hidden_reason: string | null;
    /** On-chain receipt (see review-chain.ts). Null until the reviewer records one. */
    receipt_txid?: string | null;
    receipt_network?: string | null;
    receipt_confirmed?: number;
}

export interface AdminsTable {
    address_or_pubkey: string;
    label: string;
    added_at: string;
}

export interface SpotlightTable {
    identifier: string;
    blurb: string;
    position: number;
    added_at: string;
}

export interface ModerationLogTable {
    id: Generated<number>;
    actor: string;
    action: string;
    identifier: string | null;
    note: string;
    created_at: string;
}

export interface DatabaseSchema {
    templates: TemplatesTable;
    template_categories: TemplateCategoriesTable;
    audit_reports: AuditReportsTable;
    flags: FlagsTable;
    reviews: ReviewsTable;
    user_reviews: UserReviewsTable;
    admins: AdminsTable;
    spotlight: SpotlightTable;
    moderation_log: ModerationLogTable;
}

export type Db = Kysely<DatabaseSchema>;

/**
 * Opens (and creates, if needed) the SQLite database at the given path. Use ':memory:' for tests.
 */
export function createDb(path: string): Db {
    const sqlite = new Database(path);
    sqlite.pragma('foreign_keys = ON');

    if (path !== ':memory:') {
        sqlite.pragma('journal_mode = WAL');
    }

    const db = new Kysely<DatabaseSchema>({ dialect: new SqliteDialect({ database: sqlite }) });

    backends.set(db, 'sqlite');

    return db;
}

/** True when the connection string points at this machine, where TLS is normally off. */
function isLocalConnection(url: URL): boolean {
    return ['localhost', '127.0.0.1', '::1', '[::1]', ''].includes(url.hostname);
}

/**
 * Opens a PostgreSQL database from a connection string (for Supabase use the Session pooler string). TLS is on for
 * every remote host; Supabase presents its own certificate chain, so the certificate is encrypted-but-unverified
 * unless the string asks for sslmode=disable.
 */
export function createPostgresDb(connectionString: string): Db {
    const url = new URL(connectionString);
    const sslmode = url.searchParams.get('sslmode');

    // pg would turn sslmode=require into full certificate verification, which Supabase's chain fails, so decide here.
    url.searchParams.delete('sslmode');

    const useTls = sslmode !== 'disable' && !isLocalConnection(url);
    const pool = new pg.Pool({
        connectionString: url.toString(),
        ssl: useTls ? { rejectUnauthorized: false } : undefined,
        max: 5,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 15_000,
    });

    // An idle connection can be dropped by the host; without a handler that error would crash the whole server.
    pool.on('error', (error) => {
        console.error(`Database connection error (the pool reconnects on the next query): ${error.message}`);
    });

    const db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });

    backends.set(db, 'postgres');

    return db;
}

export interface OpenedDatabase {
    db: Db;
    backend: Backend;
    /** Safe to print: never contains a password. */
    description: string;
}

/**
 * Opens the database the environment asks for: PostgreSQL when DATABASE_URL is set, otherwise SQLite at DATABASE_PATH.
 */
export function openDatabase(env: Record<string, string | undefined> = process.env): OpenedDatabase {
    const databaseUrl = env.DATABASE_URL?.trim();

    if (databaseUrl) {
        const url = new URL(databaseUrl);

        return { db: createPostgresDb(databaseUrl), backend: 'postgres', description: `PostgreSQL at ${url.hostname}` };
    }

    const path = env.DATABASE_PATH ?? './data/hub.db';

    if (path !== ':memory:') {
        mkdirSync(dirname(path), { recursive: true });
    }

    return { db: createDb(path), backend: 'sqlite', description: `SQLite file ${path}` };
}

/**
 * Creates all tables if they do not exist yet. Safe to run on every start.
 */
export async function migrate(db: Db): Promise<void> {
    const backend = backends.get(db) ?? 'sqlite';
    // SQLite auto-increments an INTEGER primary key; PostgreSQL needs the SERIAL type for the same thing.
    const idType = backend === 'postgres' ? 'serial' : 'integer';
    const idColumn = (c: ColumnDefinitionBuilder): ColumnDefinitionBuilder => (backend === 'postgres' ? c.primaryKey() : c.primaryKey().autoIncrement());

    await db.schema
        .createTable('templates')
        .ifNotExists()
        .addColumn('identifier', 'text', (c) => c.primaryKey())
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('description', 'text', (c) => c.notNull())
        .addColumn('json', 'text', (c) => c.notNull())
        .addColumn('publisher', 'text', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull())
        .addColumn('removed', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('removed_reason', 'text')
        .execute();

    await db.schema
        .createTable('template_categories')
        .ifNotExists()
        .addColumn('identifier', 'text', (c) => c.notNull().references('templates.identifier'))
        .addColumn('category', 'text', (c) => c.notNull())
        .addPrimaryKeyConstraint('template_categories_pk', ['identifier', 'category'])
        .execute();

    await db.schema
        .createTable('audit_reports')
        .ifNotExists()
        .addColumn('id', idType, idColumn)
        .addColumn('identifier', 'text', (c) => c.notNull().references('templates.identifier'))
        .addColumn('checker_version', 'text', (c) => c.notNull())
        .addColumn('results_json', 'text', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull())
        .execute();

    await db.schema
        .createTable('flags')
        .ifNotExists()
        .addColumn('id', idType, idColumn)
        .addColumn('identifier', 'text', (c) => c.notNull().references('templates.identifier'))
        .addColumn('reason', 'text', (c) => c.notNull())
        .addColumn('reporter', 'text', (c) => c.notNull())
        .addColumn('status', 'text', (c) => c.notNull().defaultTo('open'))
        .addColumn('created_at', 'text', (c) => c.notNull())
        .execute();

    await db.schema
        .createTable('reviews')
        .ifNotExists()
        .addColumn('id', idType, idColumn)
        .addColumn('identifier', 'text', (c) => c.notNull().references('templates.identifier'))
        .addColumn('reviewer_address', 'text', (c) => c.notNull())
        .addColumn('reviewer_label', 'text')
        .addColumn('signature', 'text')
        .addColumn('note', 'text', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull())
        .execute();

    await db.schema
        .createTable('user_reviews')
        .ifNotExists()
        .addColumn('id', idType, idColumn)
        .addColumn('identifier', 'text', (c) => c.notNull().references('templates.identifier'))
        .addColumn('reviewer', 'text', (c) => c.notNull())
        .addColumn('rating', 'integer', (c) => c.notNull())
        .addColumn('body', 'text', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull())
        .addColumn('hidden', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('hidden_reason', 'text')
        .addColumn('receipt_txid', 'text')
        .addColumn('receipt_network', 'text')
        .addColumn('receipt_confirmed', 'integer', (c) => c.notNull().defaultTo(0))
        .addUniqueConstraint('user_reviews_one_per_wallet', ['identifier', 'reviewer'])
        .execute();

    await db.schema
        .createTable('admins')
        .ifNotExists()
        .addColumn('address_or_pubkey', 'text', (c) => c.primaryKey())
        .addColumn('label', 'text', (c) => c.notNull())
        .addColumn('added_at', 'text', (c) => c.notNull())
        .execute();

    await db.schema
        .createTable('spotlight')
        .ifNotExists()
        .addColumn('identifier', 'text', (c) => c.primaryKey().references('templates.identifier'))
        .addColumn('blurb', 'text', (c) => c.notNull())
        .addColumn('position', 'integer', (c) => c.notNull())
        .addColumn('added_at', 'text', (c) => c.notNull())
        .execute();

    await db.schema
        .createTable('moderation_log')
        .ifNotExists()
        .addColumn('id', idType, idColumn)
        .addColumn('actor', 'text', (c) => c.notNull())
        .addColumn('action', 'text', (c) => c.notNull())
        .addColumn('identifier', 'text')
        .addColumn('note', 'text', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull())
        .execute();

    await upgradeSchema(db);
}

/**
 * Adds columns introduced after the first release to databases created earlier. Uses Kysely introspection so the same
 * code works on SQLite and PostgreSQL.
 */
export async function upgradeSchema(db: Db): Promise<void> {
    const tables = await db.introspection.getTables();
    const reviews = tables.find((table) => table.name === 'reviews');

    if (reviews && !reviews.columns.some((column) => column.name === 'reviewer_label')) {
        await db.schema.alterTable('reviews').addColumn('reviewer_label', 'text').execute();
    }

    const userReviews = tables.find((table) => table.name === 'user_reviews');

    if (userReviews && !userReviews.columns.some((column) => column.name === 'receipt_txid')) {
        await db.schema.alterTable('user_reviews').addColumn('receipt_txid', 'text').execute();
        await db.schema.alterTable('user_reviews').addColumn('receipt_network', 'text').execute();
        await db.schema.alterTable('user_reviews').addColumn('receipt_confirmed', 'integer', (c) => c.notNull().defaultTo(0)).execute();
    }
}
