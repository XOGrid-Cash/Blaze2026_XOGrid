import {
    faucetCashTemplate,
    multisigTemplate,
    p2pkhTemplate,
    wrapBCHChipnetTemplate,
    wrapBCHTemplate,
} from '@xo-cash/templates';
import { serializeTemplate } from '@xo-cash/utils';
import type { Db } from './db.js';
import { claimVoucherTemplate } from './templates/claim-voucher.js';
import { COMMUNITY_TEMPLATES } from './templates/community.js';
import { publishTemplate, setSpotlight } from './registry.js';

const SEED_PUBLISHER = 'xo-cash/templates';
const HUB_PUBLISHER = 'XOGrid';

/** Templates shipped by General Protocols in @xo-cash/templates. Add our own novel templates here as they are written. */
const SEED_TEMPLATES = [
    { template: p2pkhTemplate, spotlight: 'The reference wallet template: send and receive BCH and tokens with a single key.' },
    { template: faucetCashTemplate, spotlight: 'A covenant faucet that pays out a fixed amount per period, enforced on-chain.' },
    { template: multisigTemplate },
    { template: wrapBCHTemplate },
    { template: wrapBCHChipnetTemplate },
    {
        template: claimVoucherTemplate,
        publisher: HUB_PUBLISHER,
        spotlight: 'Original to this hub: lock satoshis to the hash of a secret code, and whoever knows the code can claim them.',
    },
] as const;

export interface SeedResult {
    published: number;
    alreadyPresent: number;
}

/** Publishes the seed templates (idempotent) and sets the Home spotlight. */
export async function seed(db: Db): Promise<SeedResult> {
    const result: SeedResult = { published: 0, alreadyPresent: 0 };
    let position = 0;

    for (const entry of SEED_TEMPLATES) {
        // The shipped templates contain bigint values, so pass them as extended JSON text rather than as objects.
        const publisher = 'publisher' in entry ? entry.publisher : SEED_PUBLISHER;
        const published = await publishTemplate(db, serializeTemplate(entry.template as never), publisher);

        if (published.created) {
            result.published += 1;
        } else {
            result.alreadyPresent += 1;
        }

        if ('spotlight' in entry) {
            await setSpotlight(db, published.identifier, entry.spotlight, position);
            position += 1;
        }
    }

    return result;
}



/**
 * Publishes the templates written for XOGrid (the templates/ folder) that the registry does not have yet. Unlike
 * seed(), this never touches the Home spotlight, so it is safe to run on every start of a live registry: it adds what
 * is missing and leaves moderator choices alone. A template a moderator removed stays removed.
 */
export async function seedCommunity(db: Db): Promise<SeedResult> {
    const result: SeedResult = { published: 0, alreadyPresent: 0 };

    for (const entry of COMMUNITY_TEMPLATES) {
        const published = await publishTemplate(db, entry.json, HUB_PUBLISHER);

        if (published.created) {
            result.published += 1;
        } else {
            result.alreadyPresent += 1;
        }
    }

    return result;
}
