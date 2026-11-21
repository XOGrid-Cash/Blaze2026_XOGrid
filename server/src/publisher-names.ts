import type { Db } from './db.js';
import { RegistryError } from './registry.js';

// A name shown as a template's publisher, for one template. Two sources:
//   'publisher': typed by whoever published the template (optional, never overwrites anything);
//   'admin':     set by a moderator, and it wins over every other name for that template.
// A name an admin registered for the publisher's wallet (the users table) beats a self-chosen name, so an outsider
// cannot pass themselves off as a person a moderator has already named.

export const MIN_PUBLISHER_NAME = 2;
export const MAX_PUBLISHER_NAME = 40;

export type NameSource = 'publisher' | 'admin';

// Control characters, zero-width characters and the characters that flip text direction.
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/;

/**
 * Tidies a name from a request: extra spaces are collapsed. Nothing (missing, null or only spaces) means no name.
 * Anything that is not text, is too short or too long, or contains hidden characters is refused.
 */
export function normalizePublisherName(input: unknown): string | null {
    if (input === undefined || input === null) {
        return null;
    }

    if (typeof input !== 'string') {
        throw new RegistryError('The name must be text.', 400);
    }

    if (FORBIDDEN.test(input.replace(/\s/g, ' '))) {
        throw new RegistryError('The name contains characters that are not allowed.', 400);
    }

    const name = input.normalize('NFC').replace(/\s+/g, ' ').trim();

    if (name === '') {
        return null;
    }

    if (name.length < MIN_PUBLISHER_NAME || name.length > MAX_PUBLISHER_NAME) {
        throw new RegistryError(`The name must be ${MIN_PUBLISHER_NAME} to ${MAX_PUBLISHER_NAME} characters.`, 400);
    }

    return name;
}

export interface TemplateName {
    name: string;
    setBy: string;
}

/** Every template's own publisher name in one query, keyed by identifier. */
export async function loadTemplateNames(db: Db): Promise<Map<string, TemplateName>> {
    const names = new Map<string, TemplateName>();

    for (const row of await db.selectFrom('template_publisher_names').selectAll().execute()) {
        names.set(row.identifier, { name: row.name, setBy: row.set_by });
    }

    return names;
}

/** Replaces the name of one template. */
export async function setTemplateName(db: Db, identifier: string, name: string, setBy: NameSource): Promise<void> {
    await clearTemplateName(db, identifier);
    await db.insertInto('template_publisher_names').values({ identifier, name, set_by: setBy, updated_at: new Date().toISOString() }).execute();
}

/** Removes the name of one template, so the wallet's registered name or its address shows again. */
export async function clearTemplateName(db: Db, identifier: string): Promise<void> {
    await db.deleteFrom('template_publisher_names').where('identifier', '=', identifier).execute();
}
